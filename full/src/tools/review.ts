/**
 * specia_review — Mandatory security review tool (two-phase).
 *
 * Phase 1 (no review_result): Constructs a structured review prompt
 * and returns it for the agent's LLM to process. Queries Alejandria
 * for past security findings to include as context.
 *
 * Phase 2 (with review_result): Validates the LLM's response,
 * writes review.md, updates state.yaml, stores findings in Alejandria.
 *
 * Smart caching: if spec hasn't changed, returns cached review.
 *
 * Spec refs: Domain 2 (specia_review — all scenarios),
 *            Domain 6 (Security Review Engine),
 *            Domain 7 (Security Context Accumulation, Past findings inform new review),
 *            Domain 8 (Smart Caching)
 * Design refs: Decision 3 (Two-Phase Review), Decision 4 (Alejandria),
 *              Decision 5 (Smart Caching)
 */

import { FileStore } from "../services/store.js";
import { computeSpecHash, shouldReReview } from "../services/cache.js";
import {
  generateReviewPrompt,
  validateReviewResult,
  renderReviewMarkdown,
  ReviewValidationError,
} from "../services/review.js";
import { tryRecall, tryStore } from "../services/memory-ops.js";
import { MemoryAdapter } from "../integrations/memory-adapter.js";
import { ReviewInputSchema } from "./schemas.js";
import { ok, fail, ErrorCodes } from "../types/tools.js";
import { estimateTokens, calculateEstimatedCost } from "../types/tools.js";
import type { ToolResult, ReviewPrompt, SecurityReview, TokenEstimate } from "../types/index.js";

export interface ReviewPromptResult {
  review_prompt: ReviewPrompt;
  spec_hash: string;
  instructions: string;
}

export interface ReviewCompleteResult {
  review_path: string;
  findings_count: number;
  risk_summary: string;
  cached: boolean;
}

export async function handleReview(
  args: unknown,
  rootDir: string,
): Promise<ToolResult<ReviewPromptResult | ReviewCompleteResult>> {
  const start = Date.now();
  const toolName = "specia_review";
  const warnings: string[] = [];

  // Input validation
  const parsed = ReviewInputSchema.safeParse(args);
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
      message: "Spec must exist before running review. Run specia_spec first.",
      dependency: "spec",
    }], { change: input.change_name, duration_ms: Date.now() - start });
  }

  const config = store.readConfig();
  const currentHash = computeSpecHash(specContent);
  const state = store.getChangeState(input.change_name);

  // Phase 2: agent is submitting review results
  if (input.review_result !== undefined && input.review_result !== null) {
    return handleReviewResult(
      input.review_result,
      input.change_name,
      currentHash,
      config.security.posture,
      store,
      config.project.name,
      start,
    );
  }

  // Smart caching check — skip if review.md exists and spec hasn't changed
  const existingReview = store.readArtifact(input.change_name, "review");
  if (
    existingReview &&
    !shouldReReview(currentHash, state, config.security.posture, input.force)
  ) {
    // Cache hit — return existing review
    return {
      status: "cached",
      data: {
        review_path: `.specia/changes/${input.change_name}/review.md`,
        findings_count: extractFindingsCount(existingReview),
        risk_summary: extractRiskLevel(existingReview),
        cached: true,
      },
      errors: [],
      warnings: ["Review cache hit — spec unchanged since last review. Use force: true to re-review."],
      meta: {
        tool: toolName,
        change: input.change_name,
        duration_ms: Date.now() - start,
        cache_hit: true,
      },
    };
  }

  // Phase 1: generate review prompt for the agent's LLM
  const proposalContent = store.readArtifact(input.change_name, "proposal") ?? undefined;

  // v0.2: Read design.md if present — include as additional context (Decision 11)
  const designContent = store.readArtifact(input.change_name, "design") ?? undefined;

  // Cross-session learning: recall past security findings (any backend)
  let pastFindings: string[] | undefined;
  try {
    // Try unified memory-ops first (Alejandría or no-op)
    const { data: pastMemories, backend: memBackend, error: recallError } = await tryRecall(
      config.memory,
      `security review findings vulnerabilities ${config.project.name}`,
      { scope: `specia/${config.project.name}`, limit: 10 },
    );

    if (pastMemories.length > 0) {
      pastFindings = pastMemories.map((m) => m.content);
      warnings.push(`memory_backend: Using ${memBackend} for cross-session learning`);
    } else if (recallError) {
      warnings.push(recallError);
    }

    // Fallback: try MemoryAdapter (Colmena or Engram) if no results yet
    if (!pastFindings) {
      const memory = await MemoryAdapter.getInstance();
      const { reviews, backend } = await memory.searchReviews({
        stack: config.project.stack,
        securityPosture: config.security.posture,
        limit: 5,
      });
      
      if (reviews.length > 0) {
        warnings.push(`memory_backend: Using ${backend} for cross-session learning (${reviews.length} past reviews)`);
        const learnings = memory.extractLearnings(reviews);
        const commonPatterns = memory.getCommonPatterns(reviews);
        
        pastFindings = [
          `## Past Review Learnings (${backend})`,
          "",
          "### Common Patterns:",
          ...Array.from(commonPatterns.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([pattern, count]) => `- ${pattern}: ${count} occurrences`),
          "",
          "### Key Insights:",
          ...learnings.map(l => `- ${l}`),
        ];
      }
    }
  } catch (err) {
    warnings.push(`memory_unavailable: ${err instanceof Error ? err.message : 'Could not retrieve past security findings'}`);
  }

  const prompt = generateReviewPrompt({
    config,
    changeName: input.change_name,
    specContent,
    proposalContent,
    designContent,
    pastFindings,
  });

  // Token estimation: measure generated prompt size
  const promptTokensEst = estimateTokens(prompt);

  // Store Phase 1 prompt estimate in state.yaml for cross-phase tracking
  const currentState = store.getChangeState(input.change_name);
  if (currentState) {
    const estimates = [...(currentState.token_estimates ?? [])];
    estimates.push({
      phase: "review" as const,
      prompt_tokens_est: promptTokensEst,
      timestamp: new Date().toISOString(),
    });
    store.transitionPhase(input.change_name, currentState.phase, currentState.status, {
      token_estimates: estimates,
    });
  }

  const result = ok(
    toolName,
    {
      review_prompt: prompt,
      spec_hash: currentHash,
      instructions: `Analyze the specification using the system_instructions and analysis_request above. Return a JSON object conforming to the output_schema. Then call specia_review again with the same change_name and the JSON as review_result.`,
    } as ReviewPromptResult,
    { change: input.change_name, duration_ms: Date.now() - start, warnings, prompt_tokens_est: promptTokensEst },
  );

  return result;
}

// ── Phase 2: Validate and save review result ─────────────────────────

async function handleReviewResult(
  reviewResult: unknown,
  changeName: string,
  specHash: string,
  posture: "standard" | "elevated" | "paranoid",
  store: FileStore,
  projectName: string,
  start: number,
): Promise<ToolResult<ReviewCompleteResult>> {
  const toolName = "specia_review";
  const warnings: string[] = [];

  try {
    // Validate the review result structure
    const review: SecurityReview = validateReviewResult(
      reviewResult,
      posture,
      changeName,
      specHash,
    );

    // Token estimation: measure received result size
    const resultTokensEst = estimateTokens(reviewResult as object);

    // Render to markdown
    const markdown = renderReviewMarkdown(review);

    // Write review.md atomically
    store.writeArtifact(changeName, "review", markdown);

    // v0.2: Compute design hash if design.md exists (Decision 10)
    const designContent = store.readArtifact(changeName, "design");
    const designHash = designContent ? computeSpecHash(designContent) : undefined;

    // Complete Phase 2 token estimate: update pending estimate with result tokens
    const currentState = store.getChangeState(changeName);
    const estimates: TokenEstimate[] = [...(currentState?.token_estimates ?? [])];
    let estimatedCostUsd: number | undefined;
    const config = store.readConfig();
    // Find last pending estimate for this phase (ES2022-compatible reverse search)
    for (let i = estimates.length - 1; i >= 0; i--) {
      const e = estimates[i];
      if (e && e.phase === "review" && !e.result_tokens_est) {
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

    // Update state with review hash, posture, optional design hash, and token estimates
    store.transitionPhase(changeName, "review", "complete", {
      review_hash: specHash,
      review_posture: posture,
      ...(designHash ? { design_hash: designHash } : {}),
      token_estimates: estimates,
    });

    // Store security findings in memory for cross-session accumulation
    {
      const findingsSummary = buildFindingsSummary(review);
      const { error: storeError } = await tryStore(config.memory, findingsSummary, {
        topic_key: `specia/${projectName}/security/${changeName}`,
        topic: "security-review",
        summary: `Security review for ${changeName}: ${review.summary.risk_level} risk, ${review.summary.total_findings} findings (${review.summary.critical_findings} critical)`,
        importance: review.summary.risk_level === "critical" ? "critical" : "high",
      });
      if (storeError) {
        warnings.push(storeError);
      }
    }

    return ok(
      toolName,
      {
        review_path: `.specia/changes/${changeName}/review.md`,
        findings_count: review.summary.total_findings,
        risk_summary: review.summary.risk_level,
        cached: false,
      },
      { change: changeName, duration_ms: Date.now() - start, warnings, result_tokens_est: resultTokensEst, estimated_cost_usd: estimatedCostUsd },
    );
  } catch (err) {
    if (err instanceof ReviewValidationError) {
      return fail(toolName, [{
        code: ErrorCodes.VALIDATION_ERROR,
        message: `Review result validation failed: ${err.message}`,
        details: err.details,
      }], { change: changeName, duration_ms: Date.now() - start });
    }

    return fail(toolName, [{
      code: ErrorCodes.IO_ERROR,
      message: `Failed to save review: ${err instanceof Error ? err.message : String(err)}`,
    }], { change: changeName, duration_ms: Date.now() - start });
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function extractFindingsCount(reviewContent: string): number {
  const match = reviewContent.match(/findings_count:\s*(\d+)/);
  return match?.[1] ? parseInt(match[1], 10) : 0;
}

function extractRiskLevel(reviewContent: string): string {
  const match = reviewContent.match(/risk_level:\s*"?(\w+)"?/);
  return match?.[1] ?? "unknown";
}

/**
 * Build a concise findings summary for Alejandria storage.
 * Includes STRIDE categories, threat details, and mitigations.
 */
function buildFindingsSummary(review: SecurityReview): string {
  const lines: string[] = [];
  lines.push(`# Security Review: ${review.change}`);
  lines.push(`Posture: ${review.posture} | Risk: ${review.summary.risk_level}`);
  lines.push(`Findings: ${review.summary.total_findings} total, ${review.summary.critical_findings} critical`);
  lines.push("");

  // Collect all threats across STRIDE categories
  const categories = [
    { name: "Spoofing", cat: review.stride.spoofing },
    { name: "Tampering", cat: review.stride.tampering },
    { name: "Repudiation", cat: review.stride.repudiation },
    { name: "Information Disclosure", cat: review.stride.information_disclosure },
    { name: "Denial of Service", cat: review.stride.denial_of_service },
    { name: "Elevation of Privilege", cat: review.stride.elevation_of_privilege },
  ];

  for (const { name, cat } of categories) {
    if (cat.applicable && cat.threats.length > 0) {
      lines.push(`## ${name}`);
      for (const t of cat.threats) {
        lines.push(`- [${t.severity}] ${t.id}: ${t.title} — ${t.mitigation}`);
      }
    }
  }

  if (review.summary.mitigations_required.length > 0) {
    lines.push("");
    lines.push("## Required Mitigations");
    for (const m of review.summary.mitigations_required) {
      lines.push(`- ${m}`);
    }
  }

  return lines.join("\n");
}
