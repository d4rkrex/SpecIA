/**
 * specia_tasks — Generate implementation tasks from spec + review.
 *
 * HARD GATE: Refuses to run if review.md is missing.
 * Also checks for REVIEW_STALE (spec changed after review).
 * Injects security mitigations from review as tasks.
 *
 * Spec refs: Domain 2 (specia_tasks — all scenarios, including REVIEW_REQUIRED, REVIEW_STALE)
 * Design refs: Decision 3 (Mitigations feed into tasks)
 */

import { FileStore } from "../services/store.js";
import { computeSpecHash, isReviewStale } from "../services/cache.js";
import { renderTasks } from "../services/template.js";
import { generateApplyManifest } from "../services/apply-manifest.js";
import { tryRecall, formatMemoryContext } from "../services/memory-ops.js";
import { TasksInputSchema } from "./schemas.js";
import { ok, fail, ErrorCodes } from "../types/tools.js";
import type { ToolResult, AbuseCase } from "../types/index.js";

export interface TasksResult {
  tasks_path: string;
  manifest_path: string;
  apply_pattern: string;
  worker_count: number;
  total_tasks: number;
  mitigation_tasks: number;
  spec_requirements_used: boolean;
  review_findings_used: boolean;
}

export async function handleTasks(
  args: unknown,
  rootDir: string,
): Promise<ToolResult<TasksResult>> {
  const start = Date.now();
  const toolName = "specia_tasks";

  // Input validation
  const parsed = TasksInputSchema.safeParse(args);
  if (!parsed.success) {
    return fail(toolName, parsed.error.issues.map((i) => ({
      code: ErrorCodes.VALIDATION_ERROR,
      message: i.message,
      field: i.path.join("."),
    })), { duration_ms: Date.now() - start });
  }

  const input = parsed.data;
  const store = new FileStore(rootDir);

  // Check project is initialized
  if (!store.isInitialized()) {
    return fail(toolName, [{
      code: ErrorCodes.NOT_INITIALIZED,
      message: "Run specia_init first — .specia/config.yaml not found.",
    }], { change: input.change_name, duration_ms: Date.now() - start });
  }

  // Check spec exists
  const specContent = store.readArtifact(input.change_name, "spec");
  if (!specContent) {
    return fail(toolName, [{
      code: ErrorCodes.MISSING_DEPENDENCY,
      message: "Spec must exist before generating tasks. Run specia_spec first.",
      dependency: "spec",
    }], { change: input.change_name, duration_ms: Date.now() - start });
  }

  // HARD GATE: check review exists
  const reviewContent = store.readArtifact(input.change_name, "review");
  if (!reviewContent) {
    return fail(toolName, [{
      code: ErrorCodes.REVIEW_REQUIRED,
      message: "Security review is mandatory. Run specia_review before generating tasks.",
    }], { change: input.change_name, duration_ms: Date.now() - start });
  }

  // STALE CHECK: verify spec hasn't changed since review
  const currentSpecHash = computeSpecHash(specContent);
  if (isReviewStale(reviewContent, currentSpecHash)) {
    return fail(toolName, [{
      code: ErrorCodes.REVIEW_STALE,
      message: "Spec changed since last review. Re-run specia_review before generating tasks.",
    }], { change: input.change_name, duration_ms: Date.now() - start });
  }

  // Extract mitigations from review
  const { findings, mitigations, abuseCases } = extractReviewData(reviewContent);

  // v0.2: Read design.md if present — include as reference in tasks (Decision 11)
  const designContent = store.readArtifact(input.change_name, "design") ?? undefined;

  // Query memory for past related security context (any backend)
  const config = store.readConfig();
  let pastFindings: string[] | undefined;
  const { data: pastMemories, error: recallError } = await tryRecall(
    config.memory,
    `security findings mitigations ${config.project.name}`,
    { scope: `specia/${config.project.name}`, limit: 5 },
  );
  if (pastMemories.length > 0) {
    pastFindings = formatMemoryContext(pastMemories);
  }
  if (recallError) {
    // Silently continue — past findings are optional context
  }

  // Generate tasks.md
  try {
    const tasksContent = renderTasks({
      changeName: input.change_name,
      specContent,
      reviewFindings: findings,
      mitigationTasks: input.include_mitigations ? mitigations : [],
      pastFindings,
      designContent,
      abuseCases: input.include_mitigations ? abuseCases : undefined,
      createdAt: new Date().toISOString(),
    });

    store.writeArtifact(input.change_name, "tasks", tasksContent);

    // SpecIA T-01: Generate apply-manifest.yaml with integrity hashes
    const { yaml: manifestYaml, manifest } = generateApplyManifest({
      changeName: input.change_name,
      tasksContent,
      reviewContent,
    });
    store.writeManifest(input.change_name, "apply-manifest", manifestYaml);

    store.transitionPhase(input.change_name, "tasks", "complete");

    const mitigationCount = input.include_mitigations ? mitigations.length : 0;

    // v0.5: Audit reminder when audit_policy is "required"
    const taskWarnings: string[] = [];
    const currentState = store.getChangeState(input.change_name);
    const auditPolicy = currentState?.audit_policy ?? "required";
    if (auditPolicy === "required") {
      taskWarnings.push("⚠️ Post-implementation audit is mandatory for this change. Run specia_audit before specia_done.");
    }

    return ok(
      toolName,
      {
        tasks_path: `.specia/changes/${input.change_name}/tasks.md`,
        manifest_path: `.specia/changes/${input.change_name}/apply-manifest.yaml`,
        apply_pattern: manifest.pattern,
        worker_count: manifest.groups.length,
        total_tasks: mitigationCount,
        mitigation_tasks: mitigationCount,
        spec_requirements_used: true,
        review_findings_used: true,
      },
      { change: input.change_name, duration_ms: Date.now() - start, warnings: taskWarnings },
    );
  } catch (err) {
    return fail(toolName, [{
      code: ErrorCodes.IO_ERROR,
      message: `Failed to create tasks: ${err instanceof Error ? err.message : String(err)}`,
    }], { change: input.change_name, duration_ms: Date.now() - start });
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

interface ReviewData {
  findings: string[];
  mitigations: string[];
  abuseCases: AbuseCase[];
}

/**
 * Extract findings and mitigation tasks from review.md content.
 *
 * Parses the markdown structure to find:
 * - Threat entries (#### ID: Title blocks)
 * - Mitigation lines (- **Mitigation**: ...)
 * - Mitigation checklist items (- [ ] ...)
 */
function extractReviewData(reviewContent: string): ReviewData {
  const findings: string[] = [];
  const mitigations: string[] = [];
  const abuseCases: AbuseCase[] = [];

  const lines = reviewContent.split("\n");

  let currentThreatId = "";
  let currentThreatTitle = "";

  // Abuse case parsing state
  let inAbuseCaseBlock = false;
  let currentAbuseCase: Partial<AbuseCase> | null = null;

  for (const line of lines) {
    // Detect Abuse Cases section
    if (line.startsWith("## Abuse Cases")) {
      inAbuseCaseBlock = true;
      continue;
    }

    // Detect leaving abuse case section (next ## header)
    if (inAbuseCaseBlock && line.startsWith("## ") && !line.startsWith("## Abuse Cases")) {
      // Save any pending abuse case
      if (currentAbuseCase?.id) {
        abuseCases.push(finalizeAbuseCase(currentAbuseCase));
        currentAbuseCase = null;
      }
      inAbuseCaseBlock = false;
    }

    if (inAbuseCaseBlock) {
      // Match abuse case headers: ### AC-001: Title
      const acHeaderMatch = line.match(/^###\s+(AC-\d+):\s+(.+)/);
      if (acHeaderMatch?.[1] && acHeaderMatch[2]) {
        // Save previous abuse case if any
        if (currentAbuseCase?.id) {
          abuseCases.push(finalizeAbuseCase(currentAbuseCase));
        }
        currentAbuseCase = { id: acHeaderMatch[1], title: acHeaderMatch[2] };
        continue;
      }

      if (currentAbuseCase) {
        // Parse abuse case fields
        const severityMatch = line.match(/^\s*-\s+\*\*Severity\*\*:\s+(?:[\u{1F534}\u{1F7E0}\u{1F7E1}\u{1F7E2}\u{26AA}]\s*)?(\w+)/u);
        if (severityMatch?.[1]) {
          currentAbuseCase.severity = severityMatch[1].toLowerCase() as AbuseCase["severity"];
          continue;
        }
        const goalMatch = line.match(/^\s*-\s+\*\*Goal\*\*:\s+(.+)/);
        if (goalMatch?.[1]) {
          currentAbuseCase.attacker_goal = goalMatch[1];
          continue;
        }
        const techniqueMatch = line.match(/^\s*-\s+\*\*Technique\*\*:\s+(.+)/);
        if (techniqueMatch?.[1]) {
          currentAbuseCase.technique = techniqueMatch[1];
          continue;
        }
        const precondMatch = line.match(/^\s*-\s+\*\*Preconditions\*\*:\s+(.+)/);
        if (precondMatch?.[1]) {
          currentAbuseCase.preconditions = precondMatch[1].split("; ").filter(Boolean);
          continue;
        }
        const impactMatch = line.match(/^\s*-\s+\*\*Impact\*\*:\s+(.+)/);
        if (impactMatch?.[1]) {
          currentAbuseCase.impact = impactMatch[1];
          continue;
        }
        const mitigMatch = line.match(/^\s*-\s+\*\*Mitigation\*\*:\s+(.+)/);
        if (mitigMatch?.[1]) {
          currentAbuseCase.mitigation = mitigMatch[1];
          continue;
        }
        const strideMatch = line.match(/^\s*-\s+\*\*STRIDE\*\*:\s+(.+)/);
        if (strideMatch?.[1]) {
          currentAbuseCase.stride_category = strideMatch[1];
          continue;
        }
        const testableMatch = line.match(/^\s*-\s+\*\*Testable\*\*:\s+(.+)/);
        if (testableMatch?.[1]) {
          currentAbuseCase.testable = testableMatch[1].toLowerCase() === "yes";
          continue;
        }
        const hintMatch = line.match(/^\s*-\s+\*\*Test Hint\*\*:\s+(.+)/);
        if (hintMatch?.[1]) {
          currentAbuseCase.test_hint = hintMatch[1];
          continue;
        }
      }

      continue;
    }

    // Match threat headers: #### S-01: Title
    const threatMatch = line.match(/^####\s+(\S+):\s+(.+)/);
    if (threatMatch?.[1] && threatMatch[2]) {
      currentThreatId = threatMatch[1];
      currentThreatTitle = threatMatch[2];
      findings.push(`[${currentThreatId}] ${currentThreatTitle}`);
      continue;
    }

    // Match mitigation lines: - **Mitigation**: description
    const mitigationMatch = line.match(/^-\s+\*\*Mitigation\*\*:\s+(.+)/);
    if (mitigationMatch?.[1]) {
      const mitigationText = currentThreatId
        ? `[${currentThreatId}] ${mitigationMatch[1]}`
        : mitigationMatch[1];
      mitigations.push(mitigationText);
      continue;
    }

    // Match mitigation checklist items in the Mitigations Required section
    const checklistMatch = line.match(/^-\s+\[\s*\]\s+(.+)/);
    if (checklistMatch?.[1] && !mitigations.includes(checklistMatch[1])) {
      // Only add if not already captured from threat sections
      const text = checklistMatch[1];
      const exists = mitigations.some(m => m.includes(text));
      if (!exists) {
        mitigations.push(text);
      }
    }
  }

  // Save last pending abuse case
  if (currentAbuseCase?.id) {
    abuseCases.push(finalizeAbuseCase(currentAbuseCase));
  }

  return { findings, mitigations, abuseCases };
}

/** Convert a partial abuse case from markdown parsing into a complete AbuseCase. */
function finalizeAbuseCase(partial: Partial<AbuseCase>): AbuseCase {
  return {
    id: partial.id ?? "AC-???",
    severity: partial.severity ?? "medium",
    title: partial.title ?? "Unknown",
    attacker_goal: partial.attacker_goal ?? "",
    technique: partial.technique ?? "",
    preconditions: partial.preconditions ?? [],
    impact: partial.impact ?? "",
    mitigation: partial.mitigation ?? "",
    stride_category: partial.stride_category ?? "Unknown",
    testable: partial.testable ?? false,
    test_hint: partial.test_hint,
  };
}
