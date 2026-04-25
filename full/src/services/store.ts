/**
 * FileStore — .specia/ directory management.
 *
 * All file writes are atomic: write to .tmp file, then rename.
 * This is the source of truth for SpecIA artifacts.
 *
 * Spec refs: Domain 5 (Directory Structure, Atomic File Writes)
 * Design refs: Decision 2 (FileStore Service API)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import type {
  VtspecConfig,
  ChangeState,
  ChangeInfo,
  ArtifactType,
  Phase,
  PhaseStatus,
} from "../types/index.js";

/** The well-known SHA256 hash of the empty string — sentinel value for zero-file audits. */
const EMPTY_SHA256_SENTINEL = "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

const SPECIA_DIR = ".specia";
const CONFIG_FILE = "config.yaml";
const CONTEXT_FILE = "context.md";
const CHANGES_DIR = "changes";
const SPECS_DIR = "specs";
const STATE_FILE = "state.yaml";

/**
 * Zod schema for config.yaml validation (QA fix: runtime validation on read).
 * Matches VtspecConfig interface — validates shape on disk to catch corruption.
 *
 * v0.2: Added optional guardian, cli, workflow sections (backward compatible).
 */
const ConfigSchema = z.object({
  version: z.string(),
  project: z.object({
    name: z.string(),
    description: z.string(),
    stack: z.string(),
    conventions: z.array(z.string()).default([]),
  }),
  security: z.object({
    posture: z.enum(["standard", "elevated", "paranoid"]),
  }),
  memory: z.object({
    backend: z.enum(["alejandria", "engram", "local"]),
    alejandria_cmd: z.string().optional(),
  }),
  // v0.2: Guardian hook config (optional — absent means disabled)
  guardian: z
    .object({
      enabled: z.boolean().default(true),
      mode: z.enum(["strict", "warn"]).default("warn"),
      exclude: z.array(z.string()).default([]),
      validation: z
        .object({
          require_spec: z.boolean().default(true),
          require_review: z.boolean().default(true),
          require_mitigations: z.boolean().default(true),
        })
        .default({}),
    })
    .optional(),
  // v0.2: CLI config (optional — absent means CLI review API mode unavailable)
  cli: z
    .object({
      editor: z.string().optional(),
      llm: z
        .object({
          provider: z.enum(["anthropic", "openai"]),
          model: z.string().optional(),
          api_key_env: z.string(),
        })
        .optional(),
    })
    .optional(),
  // v0.2: Workflow config (optional — absent means design phase skipped)
  workflow: z
    .object({
      include_design: z.boolean().default(false),
    })
    .optional(),
  // v0.9: Token economics config (optional — absent means no cost estimation)
  economics: z
    .object({
      enabled: z.boolean().default(false),
      input_cpt: z.number().nonnegative(),
      output_cpt: z.number().nonnegative(),
      cache_write_ratio: z.number().nonnegative().optional(),
      cache_read_ratio: z.number().nonnegative().optional(),
    })
    .optional(),
});

/**
 * Zod schema for state.yaml validation (T-01: prevent state.yaml tampering).
 * Validates shape on disk to catch corruption or manual edits.
 *
 * v0.5: Added audit_policy field with strict enum validation.
 */
const ChangeStateSchema = z.object({
  change: z.string(),
  phase: z.enum(["proposal", "spec", "design", "review", "tasks", "audit"]),
  status: z.enum(["complete", "in-progress", "failed"]),
  created: z.string(),
  updated: z.string(),
  phases_completed: z.array(z.enum(["proposal", "spec", "design", "review", "tasks", "audit"])).default([]),
  history: z.array(z.object({
    phase: z.enum(["proposal", "spec", "design", "review", "tasks", "audit"]),
    status: z.enum(["complete", "in-progress", "failed"]),
    timestamp: z.string(),
  })).default([]),
  review_hash: z.string().optional(),
  review_posture: z.string().optional(),
  design_hash: z.string().optional(),
  review_stale: z.boolean().optional(),
  audit_hash: z.string().optional(),
  audit_posture: z.string().optional(),
  audit_stale: z.boolean().optional(),
  audit_policy: z.enum(["required", "skipped"]).optional(),
  audit_content_hash: z.string().optional(),
  archived_with_force: z.boolean().optional(),
  token_estimates: z.array(z.object({
    phase: z.enum(["proposal", "spec", "design", "review", "tasks", "audit"]),
    prompt_tokens_est: z.number(),
    result_tokens_est: z.number().optional(),
    timestamp: z.string(),
    estimated_cost_usd: z.number().optional(),
    actual_usage: z.object({
      input_tokens: z.number(),
      output_tokens: z.number(),
      cache_creation_tokens: z.number().optional(),
      cache_read_tokens: z.number().optional(),
      total_tokens: z.number(),
    }).optional(),
    source: z.enum(["estimate", "api"]).optional(),
    model: z.string().optional(),
  })).optional(),
}).passthrough(); // Allow extra fields to pass through for forward compatibility

export class FileStore {
  private readonly speciaPath: string;

  constructor(readonly rootDir: string) {
    this.speciaPath = path.join(rootDir, SPECIA_DIR);
  }

  // ── Project-level ──────────────────────────────────────────────────

  /** Check if .specia/config.yaml exists. */
  isInitialized(): boolean {
    return fs.existsSync(path.join(this.speciaPath, CONFIG_FILE));
  }

  /** Read and parse .specia/config.yaml with Zod validation. */
  readConfig(): VtspecConfig {
    const raw = fs.readFileSync(
      path.join(this.speciaPath, CONFIG_FILE),
      "utf-8",
    );
    const parsed = parseYaml(raw);
    const result = ConfigSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(
        `Invalid config.yaml: ${result.error.issues.map((i) => i.message).join(", ")}`,
      );
    }
    return result.data as VtspecConfig;
  }

  /** Write config.yaml atomically. */
  writeConfig(config: VtspecConfig): void {
    const filePath = path.join(this.speciaPath, CONFIG_FILE);
    this.atomicWrite(filePath, stringifyYaml(config));
  }

  /** Read .specia/context.md as plain string. Returns null if missing. */
  readContext(): string | null {
    const filePath = path.join(this.speciaPath, CONTEXT_FILE);
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, "utf-8");
  }

  /** Write context.md atomically. */
  writeContext(content: string): void {
    const filePath = path.join(this.speciaPath, CONTEXT_FILE);
    this.atomicWrite(filePath, content);
  }

  /**
   * Ensure the full .specia/ directory structure exists.
   * Called by specia_init.
   */
  ensureDirectoryStructure(): void {
    fs.mkdirSync(path.join(this.speciaPath, CHANGES_DIR), { recursive: true });
    fs.mkdirSync(path.join(this.speciaPath, SPECS_DIR), { recursive: true });
  }

  // ── Change-level ───────────────────────────────────────────────────

  /** List all changes with their current state. */
  listChanges(): ChangeInfo[] {
    const changesPath = path.join(this.speciaPath, CHANGES_DIR);
    if (!fs.existsSync(changesPath)) return [];

    const entries = fs.readdirSync(changesPath, { withFileTypes: true });
    const changes: ChangeInfo[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const state = this.getChangeState(entry.name);
      if (state) {
        changes.push({
          name: state.change,
          phase: state.phase,
          status: state.status,
          updated: state.updated,
        });
      }
    }

    return changes;
  }

  /** Read state.yaml for a change. Returns null if change doesn't exist.
   * v0.5: Validates with Zod schema (T-01: prevent state.yaml tampering). */
  getChangeState(name: string): ChangeState | null {
    const filePath = path.join(
      this.speciaPath,
      CHANGES_DIR,
      name,
      STATE_FILE,
    );
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = parseYaml(raw);
    const result = ChangeStateSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(
        `Invalid state.yaml for change "${name}": ${result.error.issues.map((i) => i.message).join(", ")}`,
      );
    }
    return result.data as ChangeState;
  }

  /**
   * Write state.yaml for a change.
   * Enforces history[] append on phase transitions.
   * v0.5: Enforces audit_policy immutability (T-02).
   *
   * @param existingState Optional pre-read state to avoid redundant file read.
   *                      If not provided, reads from disk.
   */
  setChangeState(name: string, state: ChangeState, existingState?: ChangeState | null): void {
    const changeDir = path.join(this.speciaPath, CHANGES_DIR, name);
    fs.mkdirSync(changeDir, { recursive: true });

    // Use provided existing state or read from disk
    const existing = existingState !== undefined ? existingState : this.getChangeState(name);

    // T-02: Enforce audit_policy immutability — once set, it cannot be changed
    if (
      existing?.audit_policy !== undefined &&
      state.audit_policy !== undefined &&
      state.audit_policy !== existing.audit_policy
    ) {
      throw new Error(
        `Cannot change audit_policy from "${existing.audit_policy}" to "${state.audit_policy}" — audit_policy is immutable after proposal creation.`,
      );
    }

    // T-03: Reject empty SHA256 sentinel as audit_hash value (fix-empty-audit)
    if (state.audit_hash === EMPTY_SHA256_SENTINEL) {
      throw new Error(
        `Cannot store the empty-string SHA256 sentinel as audit_hash — this indicates zero files were hashed. ` +
        `audit_hash: ${EMPTY_SHA256_SENTINEL}`,
      );
    }

    // Preserve audit_policy from existing state if new state doesn't specify it
    if (existing?.audit_policy !== undefined && state.audit_policy === undefined) {
      state.audit_policy = existing.audit_policy;
    }

    if (
      existing &&
      (existing.phase !== state.phase || existing.status !== state.status)
    ) {
      // Append current state to history before overwriting
      state.history = [
        ...(state.history ?? []),
        {
          phase: existing.phase,
          status: existing.status,
          timestamp: existing.updated,
        },
      ];
    }

    state.updated = new Date().toISOString();
    const filePath = path.join(changeDir, STATE_FILE);
    this.atomicWrite(filePath, stringifyYaml(state));
  }

  /** Read an artifact file (proposal.md, spec.md, etc.). Returns null if missing. */
  readArtifact(change: string, artifact: ArtifactType): string | null {
    const filePath = path.join(
      this.speciaPath,
      CHANGES_DIR,
      change,
      `${artifact}.md`,
    );
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, "utf-8");
  }

  /** Write an artifact file atomically. */
  writeArtifact(
    change: string,
    artifact: ArtifactType,
    content: string,
  ): void {
    const changeDir = path.join(this.speciaPath, CHANGES_DIR, change);
    fs.mkdirSync(changeDir, { recursive: true });
    const filePath = path.join(changeDir, `${artifact}.md`);
    this.atomicWrite(filePath, content);
  }

  /**
   * Write a YAML manifest file atomically (e.g., apply-manifest.yaml).
   * Returns the relative path to the manifest file.
   */
  writeManifest(
    change: string,
    manifestName: string,
    content: string,
  ): string {
    const changeDir = path.join(this.speciaPath, CHANGES_DIR, change);
    fs.mkdirSync(changeDir, { recursive: true });
    const filePath = path.join(changeDir, `${manifestName}.yaml`);
    this.atomicWrite(filePath, content);
    return `.specia/changes/${change}/${manifestName}.yaml`;
  }

  /**
   * Read a YAML manifest file. Returns null if missing.
   */
  readManifest(change: string, manifestName: string): string | null {
    const filePath = path.join(
      this.speciaPath,
      CHANGES_DIR,
      change,
      `${manifestName}.yaml`,
    );
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, "utf-8");
  }

  /**
   * Archive a completed change:
   * 1. Copy spec.md to .specia/specs/{name}.md with review + audit frontmatter
   * 2. v0.6: Preserve full audit.md as .specia/specs/{name}.audit.md (R-01, AC-004)
   * 3. v0.6: Preserve full review.md as .specia/specs/{name}.review.md (R-01)
   * 4. Remove changes/{name}/ directory
   *
   * v0.3: Include audit frontmatter when audit.md exists (Design Decision 14).
   * v0.6: Preserve full audit and review artifacts; record force flag usage.
   */
  /**
   * Archive a completed change:
   * 1. Copy spec.md to .specia/specs/{name}.md with review + audit frontmatter
   * 2. v0.6: Preserve full audit.md as .specia/specs/{name}.audit.md (R-01, AC-004)
   * 3. v0.6: Preserve full review.md as .specia/specs/{name}.review.md (R-01)
   * 4. Remove changes/{name}/ directory
   *
   * v0.7: Returns the absolute path to the archived spec file (fix-done-verification).
   *       Throws on write failure. On partial failure (spec archived but change dir
   *       removal fails), returns the archived path but propagates the rmSync error.
   *
   * @returns Absolute path to the archived spec file
   */
  archiveChange(name: string, opts?: { force?: boolean }): string {
    const changeDir = path.join(this.speciaPath, CHANGES_DIR, name);
    const spec = this.readArtifact(name, "spec");
    const review = this.readArtifact(name, "review");
    const audit = this.readArtifact(name, "audit");

    if (!spec) {
      throw new Error(`Cannot archive change "${name}": spec.md not found`);
    }

    // Build archived spec with review + audit frontmatter
    let archivedContent = "";
    if (review || audit || opts?.force) {
      archivedContent += "---\n";
      archivedContent += `archived_at: "${new Date().toISOString()}"\n`;
      archivedContent += `change: "${name}"\n`;

      // D-01 / AC-003: Record force flag usage in archived frontmatter
      if (opts?.force) {
        archivedContent += `archived_with_force: true\n`;
      }

      // Review frontmatter (prefixed with review_)
      if (review) {
        const reviewFrontmatter = this.extractYamlFrontmatter(review);
        if (reviewFrontmatter) {
          for (const [key, value] of Object.entries(reviewFrontmatter)) {
            archivedContent += `review_${key}: ${JSON.stringify(value)}\n`;
          }
        }
      }

      // Audit frontmatter (prefixed with audit_)
      // Spec refs: Domain 10 (Audit in Archived Spec)
      if (audit) {
        const auditFrontmatter = this.extractYamlFrontmatter(audit);
        if (auditFrontmatter) {
          // Extract specific audit fields for the archive
          const fieldMap: Record<string, string> = {
            overall_verdict: "audit_verdict",
            timestamp: "audit_timestamp",
            audit_hash: "audit_hash",
            posture: "audit_posture",
          };

          for (const [srcKey, destKey] of Object.entries(fieldMap)) {
            if (auditFrontmatter[srcKey] !== undefined) {
              archivedContent += `${destKey}: ${JSON.stringify(auditFrontmatter[srcKey])}\n`;
            }
          }

          // Extract coverage counts from nested frontmatter
          const reqCov = auditFrontmatter.requirements_coverage as
            Record<string, number> | undefined;
          if (reqCov) {
            archivedContent += `audit_requirements_passed: ${reqCov.passed ?? 0}\n`;
            archivedContent += `audit_requirements_total: ${reqCov.total ?? 0}\n`;
          }

          const abCov = auditFrontmatter.abuse_cases_coverage as
            Record<string, number> | undefined;
          if (abCov) {
            archivedContent += `audit_abuse_cases_verified: ${abCov.verified ?? 0}\n`;
            archivedContent += `audit_abuse_cases_total: ${abCov.total ?? 0}\n`;
          }
        }
      }

      archivedContent += "---\n\n";
    }
    archivedContent += spec;

    const archivePath = path.join(this.speciaPath, SPECS_DIR, `${name}.md`);
    this.atomicWrite(archivePath, archivedContent);

    // R-01 / AC-004: Preserve full audit.md as a separate archived file
    if (audit) {
      const auditArchivePath = path.join(this.speciaPath, SPECS_DIR, `${name}.audit.md`);
      this.atomicWrite(auditArchivePath, audit);
    }

    // R-01: Preserve full review.md as a separate archived file
    if (review) {
      const reviewArchivePath = path.join(this.speciaPath, SPECS_DIR, `${name}.review.md`);
      this.atomicWrite(reviewArchivePath, review);
    }

    // Remove change directory — on failure, spec is already archived (recoverable state)
    fs.rmSync(changeDir, { recursive: true, force: true });

    return archivePath;
  }

  // ── Helpers ────────────────────────────────────────────────────────

  /** Atomic write: write to .tmp, then rename. */
  private atomicWrite(filePath: string, content: string): void {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });

    const tmpPath = `${filePath}.${crypto.randomBytes(4).toString("hex")}.tmp`;
    try {
      fs.writeFileSync(tmpPath, content, "utf-8");
      fs.renameSync(tmpPath, filePath);
    } catch (err) {
      // Clean up temp file if rename failed
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        // Ignore cleanup errors
      }
      throw err;
    }
  }

  /** Extract YAML frontmatter from a markdown string. */
  private extractYamlFrontmatter(
    markdown: string,
  ): Record<string, unknown> | null {
    const match = markdown.match(/^---\n([\s\S]*?)\n---/);
    if (!match?.[1]) return null;
    try {
      return parseYaml(match[1]) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  // ── Phase transition helpers ───────────────────────────────────────

  /**
   * Convenience: update phase + status, creating state if needed.
   * Handles history append automatically via setChangeState.
   * v0.5: Strips audit_policy from extra to prevent accidental overwrite (T-02).
   */
  transitionPhase(
    name: string,
    phase: Phase,
    status: PhaseStatus,
    extra?: Partial<ChangeState>,
  ): void {
    const existing = this.getChangeState(name);
    const now = new Date().toISOString();

    // T-02: Strip audit_policy from extra spread to prevent overwriting via transitionPhase.
    // Only the propose phase (initial setChangeState with no existing state) may set audit_policy.
    const { audit_policy: _stripped, ...safeExtra } = extra ?? {};

    const newState: ChangeState = {
      change: name,
      phase,
      status,
      created: existing?.created ?? now,
      updated: now,
      phases_completed: existing?.phases_completed ?? [],
      history: existing?.history ?? [],
      ...safeExtra,
    };

    // Preserve audit_policy from existing state
    if (existing?.audit_policy !== undefined) {
      newState.audit_policy = existing.audit_policy;
    }

    // Add to phases_completed if completing a phase
    if (
      status === "complete" &&
      !newState.phases_completed.includes(phase)
    ) {
      newState.phases_completed = [...newState.phases_completed, phase];
    }

    this.setChangeState(name, newState, existing);
  }
}
