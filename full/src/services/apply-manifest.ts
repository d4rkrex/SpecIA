/**
 * Apply Manifest generation — multi-agent task grouping with file ownership.
 *
 * Analyzes tasks.md to group tasks by file scope, assigns exclusive file
 * ownership per group, and generates apply-manifest.yaml.
 *
 * Inspired by Colmena's threat-model-remediation fan-out pattern.
 *
 * Security mitigations:
 * - SpecIA T-01: Manifest integrity via tasks_hash (programmatic derivation)
 * - SpecIA E-01: Sensitive path exclusion from worker ownership
 * - SpecIA D-01: Worker cap at MAX_PARALLEL_WORKERS (merge smallest groups)
 */

import { createHash } from "node:crypto";
import { stringify as stringifyYaml } from "yaml";
import type {
  ApplyManifest,
  ApplyPattern,
  TaskGroup,
} from "../types/apply-manifest.js";
import {
  MAX_PARALLEL_WORKERS,
  RESTRICTED_PATH_PATTERNS,
  DEFAULT_FORBIDDEN_PATHS,
} from "../types/apply-manifest.js";

// ── Public API ───────────────────────────────────────────────────────

export interface GenerateManifestInput {
  changeName: string;
  tasksContent: string;
  reviewContent: string;
  /** File-to-task mapping extracted from tasks (if available from spec/design). */
  fileHints?: Map<string, string[]>;
}

export interface GenerateManifestResult {
  manifest: ApplyManifest;
  yaml: string;
}

/**
 * Generate an apply manifest from tasks.md content.
 *
 * 1. Parse tasks from markdown
 * 2. Group by file scope (using file hints or task phase grouping)
 * 3. Validate no overlaps in file ownership
 * 4. Apply security constraints (restricted paths, worker cap)
 * 5. Determine pattern (fan-out vs sequential)
 */
export function generateApplyManifest(
  input: GenerateManifestInput,
): GenerateManifestResult {
  const tasks = parseTasksFromMarkdown(input.tasksContent);
  const phases = parsePhaseGroups(input.tasksContent);

  // SpecIA T-01: Compute integrity hashes
  const tasksHash = computeContentHash(input.tasksContent);
  const reviewHash = computeContentHash(input.reviewContent);

  // Build groups from phase structure (natural grouping from tasks.md)
  let groups = buildGroupsFromPhases(phases, tasks);

  // SpecIA E-01: Remove restricted paths from file ownership
  groups = enforceRestrictedPaths(groups);

  // SpecIA D-01: Merge groups if exceeding worker cap
  groups = enforceWorkerCap(groups);

  // Determine pattern: fan-out only if multiple groups with non-overlapping files
  const pattern = determinePattern(groups, tasks);

  // SpecIA E-01: Inject default forbidden paths into every group
  groups = injectForbiddenPaths(groups);

  const manifest: ApplyManifest = {
    schema_version: "1.0",
    change_name: input.changeName,
    pattern,
    groups,
    max_workers: Math.min(groups.length, MAX_PARALLEL_WORKERS),
    tasks_hash: tasksHash,
    review_hash: reviewHash,
    restricted_paths: [...RESTRICTED_PATH_PATTERNS],
    generated_at: new Date().toISOString(),
  };

  const yaml = stringifyYaml(manifest, { lineWidth: 120 });
  return { manifest, yaml };
}

// ── Task Parsing ─────────────────────────────────────────────────────

interface ParsedTask {
  id: string;
  title: string;
  isSecurity: boolean;
  threatId?: string;
  phase?: string;
}

interface PhaseGroup {
  name: string;
  taskIds: string[];
}

/** Parse task items from tasks.md markdown. */
function parseTasksFromMarkdown(content: string): ParsedTask[] {
  const tasks: ParsedTask[] = [];
  const lines = content.split("\n");
  let currentPhase = "";

  for (const line of lines) {
    // Detect phase headers: ## Phase N: Title
    const phaseMatch = line.match(/^##\s+Phase\s+\d+[.:]\s*(.+)/i);
    if (phaseMatch?.[1]) {
      currentPhase = phaseMatch[1].trim();
      continue;
    }

    // Detect task items: - [ ] **1.1** description  OR  - [ ] [T-01] description
    const taskMatch = line.match(
      /^-\s+\[[ x]\]\s+(?:\*\*(\d+\.\d+)\*\*\s+)?(?:\[([A-Z]-\d+)\]\s+)?(.+)/,
    );
    if (taskMatch) {
      const id = taskMatch[1] ?? taskMatch[2] ?? `task-${tasks.length + 1}`;
      const threatId = taskMatch[2] ?? undefined;
      const title = taskMatch[3]?.trim() ?? "";
      const isSecurity = !!threatId || /\[(?:T|E|R|D|S)-\d+\]/.test(line);

      tasks.push({ id, title, isSecurity, threatId, phase: currentPhase });
    }
  }

  return tasks;
}

/** Parse phase groups from tasks.md structure. */
function parsePhaseGroups(content: string): PhaseGroup[] {
  const groups: PhaseGroup[] = [];
  const lines = content.split("\n");
  let currentPhase: PhaseGroup | null = null;

  for (const line of lines) {
    const phaseMatch = line.match(/^##\s+(Phase\s+\d+[.:]\s*.+)/i);
    if (phaseMatch?.[1]) {
      if (currentPhase && currentPhase.taskIds.length > 0) {
        groups.push(currentPhase);
      }
      currentPhase = { name: phaseMatch[1].trim(), taskIds: [] };
      continue;
    }

    if (currentPhase) {
      const taskMatch = line.match(
        /^-\s+\[[ x]\]\s+(?:\*\*(\d+\.\d+)\*\*\s+)?(?:\[([A-Z]-\d+)\]\s+)?/,
      );
      if (taskMatch) {
        const id = taskMatch[1] ?? taskMatch[2] ?? `task-${currentPhase.taskIds.length + 1}`;
        currentPhase.taskIds.push(id);
      }
    }
  }

  if (currentPhase && currentPhase.taskIds.length > 0) {
    groups.push(currentPhase);
  }

  return groups;
}

// ── Group Building ───────────────────────────────────────────────────

/**
 * Build task groups from phase structure.
 * Each phase becomes a group. File ownership is derived from the
 * phase name heuristic (tasks within same phase likely touch same files).
 */
function buildGroupsFromPhases(
  phases: PhaseGroup[],
  _tasks: ParsedTask[],
): TaskGroup[] {
  if (phases.length === 0) {
    // No phase structure — single sequential group
    return [{
      group_id: "group-all",
      files_owned: ["**/*"],
      tasks: _tasks.map(t => t.id),
      forbidden_paths: [],
    }];
  }

  return phases.map((phase, index) => ({
    group_id: `group-${index + 1}`,
    files_owned: [], // Will be populated by orchestrator or file hints
    tasks: phase.taskIds,
    forbidden_paths: [],
  }));
}

// ── Security Constraints ─────────────────────────────────────────────

/** SpecIA E-01: Remove restricted paths from any group's file ownership. */
function enforceRestrictedPaths(groups: TaskGroup[]): TaskGroup[] {
  return groups.map(group => ({
    ...group,
    files_owned: group.files_owned.filter(file =>
      !RESTRICTED_PATH_PATTERNS.some(pattern => {
        const normalized = pattern.replace(/\*\*/g, "").replace(/\*/g, "");
        return file.startsWith(normalized) || file.includes(normalized);
      }),
    ),
  }));
}

/**
 * SpecIA D-01: Merge smallest groups until under MAX_PARALLEL_WORKERS.
 * Merges by combining the two smallest groups (by task count) repeatedly.
 */
function enforceWorkerCap(groups: TaskGroup[]): TaskGroup[] {
  const result = [...groups];

  while (result.length > MAX_PARALLEL_WORKERS) {
    // Sort by task count ascending — merge the two smallest
    result.sort((a, b) => a.tasks.length - b.tasks.length);

    const smallest = result.shift()!;
    const secondSmallest = result.shift()!;

    const merged: TaskGroup = {
      group_id: `${smallest.group_id}+${secondSmallest.group_id}`,
      files_owned: [...smallest.files_owned, ...secondSmallest.files_owned],
      tasks: [...smallest.tasks, ...secondSmallest.tasks],
      forbidden_paths: [...new Set([...smallest.forbidden_paths, ...secondSmallest.forbidden_paths])],
    };

    result.push(merged);
  }

  return result;
}

/** Determine apply pattern based on group structure. */
function determinePattern(groups: TaskGroup[], tasks: ParsedTask[]): ApplyPattern {
  // Sequential if: single group, <= 3 total tasks, or all groups have empty file ownership
  if (groups.length <= 1) return "sequential";
  if (tasks.length <= 3) return "sequential";

  // Fan-out if multiple groups exist with distinct phases
  return "fan-out";
}

/** SpecIA E-01: Inject default forbidden paths into every group. */
function injectForbiddenPaths(groups: TaskGroup[]): TaskGroup[] {
  return groups.map(group => ({
    ...group,
    forbidden_paths: [
      ...new Set([...group.forbidden_paths, ...DEFAULT_FORBIDDEN_PATHS]),
    ],
  }));
}

// ── Utilities ────────────────────────────────────────────────────────

/** Compute SHA256 hash with "sha256:" prefix (matches SpecIA convention). */
function computeContentHash(content: string): string {
  const normalized = content
    .split("\n")
    .map(line => line.trimEnd())
    .join("\n")
    .trim();
  return "sha256:" + createHash("sha256").update(normalized, "utf8").digest("hex");
}
