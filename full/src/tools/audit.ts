/**
 * specia_audit — Optional post-implementation code audit tool (two-phase).
 *
 * Phase 1 (no audit_result): Discovers code files, reads specs + abuse cases,
 * constructs a posture-driven audit prompt, returns it for the agent's LLM.
 *
 * Phase 2 (with audit_result): Validates the LLM's response,
 * writes audit.md, updates state.yaml, stores findings in Alejandria.
 *
 * Smart caching: if code hasn't changed (audit_hash matches), returns cached audit.
 *
 * Spec refs: Domain 3 (specia_audit — all scenarios),
 *            Domain 2 (AuditEngine Service),
 *            Domain 6 (Code Reading),
 *            Domain 7 (Staleness Detection),
 *            Domain 11 (Alejandria Integration)
 * Design refs: Decision 3 (Two-Phase Audit), Decision 4 (Code Reading),
 *              Decision 5 (Token Budget), Decision 8 (Smart Caching)
 */

import * as crypto from "node:crypto";
import { FileStore } from "../services/store.js";
import { computeSpecHash } from "../services/cache.js";
import {
  generateAuditPrompt,
  validateAuditResult,
  renderAuditMarkdown,
  discoverChangedFiles,
  readCodeFiles,
  selectAndBudgetFiles,
  computeAuditHash,
  parseAbuseCasesFromReview,
  AuditValidationError,
} from "../services/audit.js";
import { tryRecall, tryStore } from "../services/memory-ops.js";
import { AuditInputSchema } from "./schemas.js";
import { ok, fail, ErrorCodes } from "../types/tools.js";
import { estimateTokens, calculateEstimatedCost } from "../types/tools.js";
import type { ToolResult, AuditPrompt, AuditResult, TokenEstimate } from "../types/index.js";

// ── Result Types ─────────────────────────────────────────────────────

/** Phase 1 result: prompt for the agent's LLM. */
export interface AuditPromptResult {
  audit_prompt: AuditPrompt;
  spec_hash: string;
  audit_hash: string;
  instructions: string;
}

/** Phase 2 result: audit complete confirmation. */
export interface AuditCompleteResult {
  audit_path: string;
  overall_verdict: string;
  requirements_summary: string;
  abuse_cases_summary: string;
  cached: boolean;
}

// ── Main Handler ─────────────────────────────────────────────────────

export async function handleAudit(
  args: unknown,
  rootDir: string,
): Promise<ToolResult<AuditPromptResult | AuditCompleteResult>> {
  const start = Date.now();
  const toolName = "specia_audit";
  const warnings: string[] = [];

  // Input validation
  const parsed = AuditInputSchema.safeParse(args);
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

  // Check change exists
  const state = store.getChangeState(input.change_name);
  if (!state) {
    return fail(toolName, [{
      code: ErrorCodes.CHANGE_NOT_FOUND,
      message: `Change "${input.change_name}" not found. Run specia_propose first.`,
    }], { change: input.change_name, duration_ms: Date.now() - start });
  }

  // Check tasks phase is complete
  if (!state.phases_completed.includes("tasks")) {
    return fail(toolName, [{
      code: ErrorCodes.TASKS_NOT_COMPLETE,
      message: "Tasks phase must be complete before running audit. Run specia_tasks first.",
      dependency: "tasks",
    }], { change: input.change_name, duration_ms: Date.now() - start });
  }

  // Check spec exists
  const specContent = store.readArtifact(input.change_name, "spec");
  if (!specContent) {
    return fail(toolName, [{
      code: ErrorCodes.MISSING_DEPENDENCY,
      message: "Spec must exist before running audit. Run specia_spec first.",
      dependency: "spec",
    }], { change: input.change_name, duration_ms: Date.now() - start });
  }

  const config = store.readConfig();
  const currentSpecHash = computeSpecHash(specContent);

  // Phase 2: agent is submitting audit results
  if (input.audit_result !== undefined && input.audit_result !== null) {
    return handleAuditResult(
      input.audit_result,
      input.change_name,
      currentSpecHash,
      config.security.posture,
      store,
      config.project.name,
      rootDir,
      start,
      input.files,
    );
  }

  // Discover and read code files
  const changedFiles = input.files ?? discoverChangedFiles(
    input.change_name,
    undefined,
    rootDir,
  );

  const codeFiles = readCodeFiles(
    changedFiles.slice(0, input.max_files),
    rootDir,
  );

  const budgetedFiles = selectAndBudgetFiles(
    codeFiles,
    input.max_tokens,
    specContent,
  );

  // ── Requirement 1: Zero-file rejection (fix-empty-audit) ──────────
  // If zero files remain after discovery → filter → budget, FAIL immediately.
  // Do NOT proceed to Phase 2 with an empty audit.
  if (budgetedFiles.length === 0) {
    return fail(toolName, [{
      code: ErrorCodes.ZERO_FILES_DISCOVERED,
      message: `No code files found for audit of change "${input.change_name}". ` +
        (changedFiles.length === 0
          ? "Git diff returned zero changed files. "
          : codeFiles.length === 0
            ? `${changedFiles.length} file(s) discovered but none were readable. `
            : `${codeFiles.length} file(s) discovered but all were excluded by token budget (max_tokens: ${input.max_tokens}). `) +
        "Provide explicit file paths via the 'files' parameter, or ensure code files exist on disk.",
    }], { change: input.change_name, duration_ms: Date.now() - start });
  }

  // Compute audit hash from selected code files
  const auditHash = computeAuditHash(budgetedFiles);

  // Smart caching check — skip if audit.md exists and code hasn't changed
  const existingAudit = store.readArtifact(input.change_name, "audit");
  if (
    existingAudit &&
    !shouldReAudit(auditHash, state.audit_hash, state.audit_posture, config.security.posture, input.force)
  ) {
    // Cache hit — return existing audit summary
    return {
      status: "cached",
      data: {
        audit_path: `.specia/changes/${input.change_name}/audit.md`,
        overall_verdict: extractFrontmatterValue(existingAudit, "overall_verdict"),
        requirements_summary: extractRequirementsSummary(existingAudit),
        abuse_cases_summary: extractAbuseCasesSummary(existingAudit),
        cached: true,
      },
      errors: [],
      warnings: ["Audit cache hit — code unchanged since last audit. Use force: true to re-audit."],
      meta: {
        tool: toolName,
        change: input.change_name,
        duration_ms: Date.now() - start,
        cache_hit: true,
      },
    };
  }

  // Phase 1: generate audit prompt for the agent's LLM

  // Read review.md and parse abuse cases
  const reviewContent = store.readArtifact(input.change_name, "review") ?? "";
  const abuseCases = parseAbuseCasesFromReview(reviewContent);

  // Read optional context artifacts
  const proposalContent = store.readArtifact(input.change_name, "proposal") ?? undefined;
  const designContent = store.readArtifact(input.change_name, "design") ?? undefined;

  if (budgetedFiles.length < codeFiles.length) {
    const excluded = codeFiles.length - budgetedFiles.length;
    warnings.push(`${excluded} file(s) excluded due to token budget (${input.max_tokens} max tokens).`);
  }

  // Query memory for past audit findings to enrich context (any backend)
  const { data: pastAuditMemories, error: recallError } = await tryRecall(
    config.memory,
    `audit findings compliance ${config.project.name}`,
    { scope: `specia/${config.project.name}`, limit: 5 },
  );
  if (pastAuditMemories.length > 0) {
    warnings.push(`Found ${pastAuditMemories.length} past audit finding(s) in memory for context.`);
  }
  if (recallError) {
    warnings.push(recallError);
  }

  const prompt = generateAuditPrompt({
    config,
    changeName: input.change_name,
    specContent,
    reviewContent,
    abuseCases,
    codeFiles: budgetedFiles,
    designContent,
    proposalContent,
  });

  // Token estimation: measure generated prompt size
  const promptTokensEst = estimateTokens(prompt);

  // Store Phase 1 prompt estimate in state.yaml for cross-phase tracking
  if (state) {
    const estimates = [...(state.token_estimates ?? [])];
    estimates.push({
      phase: "audit" as const,
      prompt_tokens_est: promptTokensEst,
      timestamp: new Date().toISOString(),
    });
    store.transitionPhase(input.change_name, state.phase, state.status, {
      token_estimates: estimates,
    });
  }

  const result = ok(
    toolName,
    {
      audit_prompt: prompt,
      spec_hash: currentSpecHash,
      audit_hash: auditHash,
      instructions: `Analyze the specification, abuse cases, and code using the system_instructions and analysis_request above. Return a JSON object conforming to the output_schema. Then call specia_audit again with the same change_name and the JSON as audit_result.`,
    } as AuditPromptResult,
    { change: input.change_name, duration_ms: Date.now() - start, warnings, prompt_tokens_est: promptTokensEst },
  );

  return result;
}

// ── Phase 2: Validate and save audit result ──────────────────────────

async function handleAuditResult(
  auditResultRaw: unknown,
  changeName: string,
  specHash: string,
  posture: "standard" | "elevated" | "paranoid",
  store: FileStore,
  projectName: string,
  rootDir: string,
  start: number,
  explicitFiles?: string[],
): Promise<ToolResult<AuditCompleteResult>> {
  const toolName = "specia_audit";
  const warnings: string[] = [];

  try {
    // Re-discover code files to compute current audit hash for storage
    // Use explicit files if provided (avoids zero-file bug with new/untracked files)
    const changedFiles = explicitFiles ?? discoverChangedFiles(changeName, undefined, rootDir);
    const codeFiles = readCodeFiles(changedFiles, rootDir);

    // ── Requirement 3: Reject zero files during Phase 2 re-discovery ──
    if (codeFiles.length === 0) {
      return fail(toolName, [{
        code: ErrorCodes.ZERO_FILES_DISCOVERED,
        message: `Audit hash could not be validated: zero code files found during Phase 2 verification for change "${changeName}". ` +
          "This may indicate code was merged or removed between Phase 1 and Phase 2.",
      }], { change: changeName, duration_ms: Date.now() - start });
    }

    const auditHash = computeAuditHash(codeFiles);

    // ── T-01 / E-01: Phase 1→2 hash consistency check (TOCTOU mitigation) ──
    // Retrieve Phase 1 audit_hash from state (set during Phase 1 if we stored it)
    const existingState = store.getChangeState(changeName);
    const phase1Hash = existingState?.audit_hash;
    if (phase1Hash && phase1Hash !== auditHash) {
      warnings.push(
        `⚠️ AUDIT_HASH_MISMATCH: Code changed between Phase 1 and Phase 2. ` +
        `Phase 1 hash: ${phase1Hash.substring(0, 20)}..., Phase 2 hash: ${auditHash.substring(0, 20)}... ` +
        `The audit analysis was performed on a different code state than what is now on disk. ` +
        `Consider re-running the audit to ensure consistency.`,
      );
    }

    // Validate the audit result structure + semantic content
    const audit: AuditResult = validateAuditResult(
      auditResultRaw,
      changeName,
      specHash,
      auditHash,
      posture,
    );

    // Token estimation: measure received result size
    const resultTokensEst = estimateTokens(auditResultRaw as object);

    // Render to markdown
    const markdown = renderAuditMarkdown(audit);

    // Write audit.md atomically
    store.writeArtifact(changeName, "audit", markdown);

    // ── T-02: Store audit.md content hash in state for tamper detection ──
    const auditContentHash = "sha256:" + crypto.createHash("sha256")
      .update(markdown, "utf-8")
      .digest("hex");

    // Complete Phase 2 token estimate: update pending estimate with result tokens
    const currentState = store.getChangeState(changeName);
    const estimates: TokenEstimate[] = [...(currentState?.token_estimates ?? [])];
    let estimatedCostUsd: number | undefined;
    const config = store.readConfig();
    // Find last pending estimate for this phase (ES2022-compatible reverse search)
    for (let i = estimates.length - 1; i >= 0; i--) {
      const e = estimates[i];
      if (e && e.phase === "audit" && !e.result_tokens_est) {
        e.result_tokens_est = resultTokensEst;
        // v0.9: Calculate estimated cost if economics config is enabled
        const cost = calculateEstimatedCost(e.prompt_tokens_est, resultTokensEst, config.economics);
        if (cost !== undefined) {
          e.estimated_cost_usd = cost;
          estimatedCostUsd = cost;
        }
        break;
      }
    }

    // Update state with audit hash, posture, content hash, and token estimates
    store.transitionPhase(changeName, "audit", "complete", {
      audit_hash: auditHash,
      audit_posture: posture,
      audit_content_hash: auditContentHash,
      token_estimates: estimates,
    });

    // Store audit findings in memory for cross-session accumulation
    const findingsSummary = buildAuditFindingsSummary(audit);
    const { error: storeError } = await tryStore(config.memory, findingsSummary, {
      topic_key: `specia/${projectName}/audit/${changeName}`,
      topic: "spec-audit",
      summary: `Spec audit for ${changeName}: ${audit.summary.overall_verdict} verdict, ${audit.summary.requirements_coverage.total} requirements (${audit.summary.requirements_coverage.passed} passed), ${audit.summary.abuse_cases_coverage.total} abuse cases (${audit.summary.abuse_cases_coverage.verified} verified)`,
      importance: audit.summary.overall_verdict === "fail" ? "high" : "medium",
    });
    if (storeError) {
      warnings.push(storeError);
    }

    const rc = audit.summary.requirements_coverage;
    const ac = audit.summary.abuse_cases_coverage;

    return ok(
      toolName,
      {
        audit_path: `.specia/changes/${changeName}/audit.md`,
        overall_verdict: audit.summary.overall_verdict,
        requirements_summary: `${rc.passed}/${rc.total} passed, ${rc.failed} failed, ${rc.partial} partial, ${rc.skipped} skipped`,
        abuse_cases_summary: `${ac.verified}/${ac.total} verified, ${ac.unverified} unverified, ${ac.partial} partial, ${ac.not_applicable} N/A`,
        cached: false,
      },
      { change: changeName, duration_ms: Date.now() - start, warnings, result_tokens_est: resultTokensEst, estimated_cost_usd: estimatedCostUsd },
    );
  } catch (err) {
    if (err instanceof AuditValidationError) {
      return fail(toolName, [{
        code: ErrorCodes.VALIDATION_ERROR,
        message: `Audit result validation failed: ${err.message}`,
        details: err.details,
      }], { change: changeName, duration_ms: Date.now() - start });
    }

    return fail(toolName, [{
      code: ErrorCodes.IO_ERROR,
      message: `Failed to save audit: ${err instanceof Error ? err.message : String(err)}`,
    }], { change: changeName, duration_ms: Date.now() - start });
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Determine whether an audit needs to be re-run.
 *
 * Re-audit is needed when:
 * 1. force flag is true
 * 2. No previous audit hash exists (never audited)
 * 3. Code state changed (hash mismatch)
 * 4. Security posture changed since last audit
 */
function shouldReAudit(
  currentHash: string,
  storedHash: string | undefined,
  storedPosture: string | undefined,
  currentPosture: string,
  force: boolean,
): boolean {
  if (force) return true;
  if (!storedHash) return true; // never audited
  if (storedHash !== currentHash) return true; // code changed
  if (storedPosture !== currentPosture) return true; // posture changed
  return false;
}

/** Extract a value from YAML frontmatter. */
function extractFrontmatterValue(content: string, key: string): string {
  const match = content.match(new RegExp(`${key}:\\s*"?([^"\\n]+)"?`));
  return match?.[1]?.trim() ?? "unknown";
}

/** Extract requirements summary from audit.md frontmatter. */
function extractRequirementsSummary(content: string): string {
  const passed = content.match(/  passed: (\d+)/)?.[1] ?? "0";
  const total = content.match(/requirements_coverage:\n  total: (\d+)/)?.[1] ?? "0";
  const failed = content.match(/  failed: (\d+)/)?.[1] ?? "0";
  return `${passed}/${total} passed, ${failed} failed`;
}

/** Extract abuse cases summary from audit.md frontmatter. */
function extractAbuseCasesSummary(content: string): string {
  const verified = content.match(/  verified: (\d+)/)?.[1] ?? "0";
  const total = content.match(/abuse_cases_coverage:\n  total: (\d+)/)?.[1] ?? "0";
  const unverified = content.match(/  unverified: (\d+)/)?.[1] ?? "0";
  return `${verified}/${total} verified, ${unverified} unverified`;
}

/**
 * Build a concise audit findings summary for Alejandria storage.
 */
function buildAuditFindingsSummary(audit: AuditResult): string {
  const lines: string[] = [];
  lines.push(`# Spec Audit: ${audit.change}`);
  lines.push(`Posture: ${audit.posture} | Verdict: ${audit.summary.overall_verdict} | Risk: ${audit.summary.risk_level}`);
  lines.push("");

  const rc = audit.summary.requirements_coverage;
  lines.push(`## Requirements (${rc.passed}/${rc.total} passed)`);
  for (const req of audit.requirements) {
    if (req.verdict !== "pass") {
      lines.push(`- [${req.verdict}] ${req.requirement_id}: ${req.evidence || req.gaps.join(", ")}`);
    }
  }

  if (audit.abuse_cases.length > 0) {
    const ac = audit.summary.abuse_cases_coverage;
    lines.push("");
    lines.push(`## Abuse Cases (${ac.verified}/${ac.total} verified)`);
    for (const abCase of audit.abuse_cases) {
      if (abCase.verdict !== "verified" && abCase.verdict !== "not_applicable") {
        lines.push(`- [${abCase.verdict}] ${abCase.abuse_case_id}: ${abCase.risk_if_unaddressed || abCase.gaps.join(", ")}`);
      }
    }
  }

  if (audit.summary.recommendations.length > 0) {
    lines.push("");
    lines.push("## Recommendations");
    for (const rec of audit.summary.recommendations) {
      lines.push(`- ${rec}`);
    }
  }

  return lines.join("\n");
}
