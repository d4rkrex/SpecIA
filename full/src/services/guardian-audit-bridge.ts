/**
 * Layer 4b: Guardian Audit Bridge — LLM validation for flagged code.
 *
 * Module-level pure functions + adapter class for AuditEngine integration:
 * - buildFocusedPrompt() — Build targeted prompt with only flagged items
 * - validateWithLLM() — Call LLM API with focused validation request
 * - computeL4bCacheKey() — Cache key computation for Layer 4b
 * - validateViaAudit() — Main entry point (adapter pattern)
 *
 * Reuses AuditEngine patterns from audit.ts for code discovery and validation.
 *
 * Performance target: <10s when triggered
 *
 * Spec refs: guardian-spec-aware — Domain 2 (Layer 4b LLM Integration)
 * Design refs: guardian-spec-aware — Decision 5 (AuditEngine Integration)
 *
 * v0.4: Phase 3 implementation
 */

import { createHash } from "node:crypto";

import type {
  GuardianAuditConfig,
  GuardianAuditResult,
  GuardianVerdict,
} from "../types/guardian.js";
import type {
  VtspecConfig,
  AuditPrompt,
  CodeFile,
  AbuseCase,
} from "../types/index.js";
import {
  selectAndBudgetFiles,
  generateAuditPrompt,
  validateAuditResult,
  type AuditContext,
} from "./audit.js";

// ── Constants ────────────────────────────────────────────────────────

/** Default max tokens for Guardian Layer 4b (tight budget for speed). */
const DEFAULT_MAX_TOKENS = 10000;

/** Default max files for Guardian Layer 4b. */
const DEFAULT_MAX_FILES = 10;

// ── Helper Functions ─────────────────────────────────────────────────

/**
 * Build focused spec content with only flagged requirements.
 *
 * Parses spec.md line-by-line and extracts only the requirements
 * that were flagged by Layer 4a (zero evidence detected).
 *
 * This reduces token usage for Layer 4b validation.
 *
 * @param fullSpec - Complete spec.md content
 * @param requirementIds - Array of requirement IDs to include
 * @returns Focused spec content (reduced token count)
 */
function buildFocusedSpec(fullSpec: string, requirementIds: string[]): string {
  if (requirementIds.length === 0) {
    return fullSpec; // No filtering needed
  }

  const lines = fullSpec.split("\n");
  const focused: string[] = [];
  let inRequirement = false;
  let currentReqMatches = false;

  // Keep header sections (## Spec, ### Context, etc.)
  let headerSectionDone = false;

  for (const line of lines) {
    // Keep everything until first requirement
    if (!headerSectionDone && !line.startsWith("#### Requirement:")) {
      focused.push(line);
      continue;
    }

    // Detect requirement headers
    if (line.startsWith("#### Requirement:")) {
      headerSectionDone = true;
      inRequirement = true;
      const reqId = extractRequirementId(line);
      currentReqMatches = requirementIds.includes(reqId);
    }

    // Include line if we're in a matching requirement
    if (inRequirement && currentReqMatches) {
      focused.push(line);
    }

    // End of requirement section (next ## or ### header)
    if (line.startsWith("##") && !line.startsWith("####")) {
      inRequirement = false;
    }
  }

  return focused.join("\n");
}

/**
 * Build focused review content with only flagged abuse cases.
 *
 * Parses review.md line-by-line and extracts only the abuse cases
 * that were flagged by Layer 4a (missing defensive patterns).
 *
 * @param fullReview - Complete review.md content
 * @param abuseCaseIds - Array of abuse case IDs to include
 * @returns Focused review content
 */
function buildFocusedReview(fullReview: string, abuseCaseIds: string[]): string {
  if (abuseCaseIds.length === 0 || !fullReview) {
    return fullReview;
  }

  const lines = fullReview.split("\n");
  const focused: string[] = [];
  let inAbuseCase = false;
  let currentCaseMatches = false;

  // Keep header sections
  let headerSectionDone = false;

  for (const line of lines) {
    // Keep everything until first abuse case
    if (!headerSectionDone && !line.startsWith("### AC-")) {
      focused.push(line);
      continue;
    }

    // Detect abuse case headers (### AC-NNN:)
    if (line.startsWith("### AC-")) {
      headerSectionDone = true;
      inAbuseCase = true;
      const acId = extractAbuseCaseId(line);
      currentCaseMatches = abuseCaseIds.includes(acId);
    }

    // Include line if we're in a matching abuse case
    if (inAbuseCase && currentCaseMatches) {
      focused.push(line);
    }

    // End of abuse case section (next ## or ### header that's not AC-)
    if (line.startsWith("##") || (line.startsWith("### ") && !line.startsWith("### AC-"))) {
      inAbuseCase = false;
    }
  }

  return focused.join("\n");
}

/**
 * Extract requirement ID from requirement header line.
 *
 * Expected format: "#### Requirement: REQ-NNN — Description"
 *
 * @param line - Header line from spec.md
 * @returns Requirement ID (e.g., "REQ-001")
 */
function extractRequirementId(line: string): string {
  // Match "#### Requirement: REQ-NNN" or "#### Requirement: Description"
  const match = line.match(/####\s*Requirement:\s*([A-Z]+-\d+|[^\s—]+)/i);
  if (match?.[1]) {
    return match[1];
  }
  // Fallback: use entire line after "Requirement:"
  return line.replace(/####\s*Requirement:\s*/, "").trim();
}

/**
 * Extract abuse case ID from abuse case header line.
 *
 * Expected format: "### AC-NNN: Description"
 *
 * @param line - Header line from review.md
 * @returns Abuse case ID (e.g., "AC-001")
 */
function extractAbuseCaseId(line: string): string {
  const match = line.match(/###\s*(AC-\d+):/);
  if (match?.[1]) {
    return match[1];
  }
  // Fallback: use first word after ###
  return line.replace(/###\s*/, "").split(":")[0]?.trim() ?? "";
}

/**
 * Compute Layer 4b cache key.
 *
 * Cache key format: SHA256("l4b:" + fileSha + ":" + specHash + ":" + reviewHash + ":" + posture)
 *
 * Same format as AuditEngine cache to enable cache reuse.
 *
 * @param fileShas - Sorted array of file SHA256 hashes
 * @param specHash - SHA256 hash of spec content
 * @param reviewHash - SHA256 hash of review content
 * @param posture - Security posture (always "standard" for Guardian)
 * @returns Cache key (hex string)
 */
export function computeL4bCacheKey(
  fileShas: string[],
  specHash: string,
  reviewHash: string,
  posture: string,
): string {
  const canonical = `l4b:${fileShas.sort().join(",")}:${specHash}:${reviewHash}:${posture}`;
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/**
 * Call Anthropic API for LLM validation.
 *
 * Uses the same pattern as llm-client.ts for consistency.
 *
 * @param prompt - AuditPrompt to send
 * @param model - Model ID (e.g., "claude-3-5-haiku-20241022")
 * @returns Parsed JSON response
 * @throws Error on API failures, network errors, or missing API key
 */
async function callAnthropic(prompt: AuditPrompt, model: string): Promise<unknown> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY environment variable not set");
  }

  // Dynamic import — @anthropic-ai/sdk is optional
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mod: any;
  try {
    mod = await import("@anthropic-ai/sdk" as string);
  } catch {
    throw new Error("Anthropic SDK not installed. Run: npm install @anthropic-ai/sdk");
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const client = new mod.default({ apiKey });

  const userContent = buildUserMessage(prompt);

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const response = await client.messages.create({
    model,
    max_tokens: 8192,
    system: prompt.system_instructions,
    messages: [{ role: "user", content: userContent }],
  });

  // Extract text from response
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  const textBlock = response.content.find((block: { type: string }) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Anthropic response did not contain text content");
  }

  const text = (textBlock as { type: "text"; text: string }).text;
  return extractJson(text);
}

/**
 * Call OpenAI API for LLM validation.
 *
 * Uses the same pattern as llm-client.ts for consistency.
 *
 * @param prompt - AuditPrompt to send
 * @param model - Model ID (e.g., "gpt-4o-mini")
 * @returns Parsed JSON response
 * @throws Error on API failures, network errors, or missing API key
 */
async function callOpenAI(prompt: AuditPrompt, model: string): Promise<unknown> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY environment variable not set");
  }

  // Dynamic import — openai is optional
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mod: any;
  try {
    mod = await import("openai" as string);
  } catch {
    throw new Error("OpenAI SDK not installed. Run: npm install openai");
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const client = new mod.default({ apiKey });

  const userContent = buildUserMessage(prompt);

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const response = await client.chat.completions.create({
    model,
    max_tokens: 8192,
    messages: [
      { role: "system", content: prompt.system_instructions },
      { role: "user", content: userContent },
    ],
    response_format: { type: "json_object" },
  });

  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  const text = response.choices[0]?.message.content;
  if (!text) {
    throw new Error("OpenAI response did not contain content");
  }

  return extractJson(text as string);
}

/**
 * Build user message from audit prompt.
 *
 * Same format as llm-client.ts buildUserMessage().
 * The analysis_request already includes code files, spec, and review content.
 */
function buildUserMessage(prompt: AuditPrompt): string {
  const parts: string[] = [];
  parts.push(prompt.analysis_request);
  parts.push("");
  parts.push("## Required Output Schema");
  parts.push("```json");
  parts.push(JSON.stringify(prompt.output_schema, null, 2));
  parts.push("```");

  return parts.join("\n");
}

/**
 * Extract JSON from text that may contain markdown fences or prose.
 *
 * Same logic as llm-client.ts extractJson().
 */
function extractJson(text: string): unknown {
  // Try direct parse first
  try {
    return JSON.parse(text);
  } catch {
    // Try extracting from markdown code fence
    const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (fenceMatch?.[1]) {
      return JSON.parse(fenceMatch[1]);
    }

    // Try finding the first { ... } block
    const braceStart = text.indexOf("{");
    const braceEnd = text.lastIndexOf("}");
    if (braceStart !== -1 && braceEnd > braceStart) {
      return JSON.parse(text.slice(braceStart, braceEnd + 1));
    }

    throw new Error("Could not extract JSON from LLM response");
  }
}

// ── Main Validation Function ─────────────────────────────────────────

/**
 * Validate flagged items via AuditEngine integration.
 *
 * Main entry point for Layer 4b validation. Adapts Guardian config
 * to AuditEngine format, builds focused prompts, calls LLM, and maps
 * AuditResult to GuardianVerdict.
 *
 * @param context - Validation context with change artifacts and code files
 * @returns Guardian audit result with verdict and failed items
 * @throws Error on LLM API failures (caller should handle gracefully)
 */
export async function validateViaAudit(context: {
  speciaConfig: VtspecConfig;
  changeName: string;
  specContent: string;
  reviewContent: string | null;
  designContent: string | null;
  codeFiles: CodeFile[];
  config: GuardianAuditConfig;
}): Promise<GuardianAuditResult> {
  const startTime = Date.now();

  // Step 1: Select and budget files (tight budget for Guardian)
  const maxTokens = context.config.maxTokens ?? DEFAULT_MAX_TOKENS;
  const maxFiles = context.config.maxFiles ?? DEFAULT_MAX_FILES;

  const budgetedFiles = selectAndBudgetFiles(
    context.codeFiles.slice(0, maxFiles), // Hard limit on file count
    maxTokens,
    context.specContent,
  );

  if (budgetedFiles.length === 0) {
    // No files to validate — instant pass
    return {
      verdict: "pass",
      failedRequirements: [],
      failedAbuseCases: [],
      summary: "No code files to validate (all filtered or empty)",
      duration_ms: Date.now() - startTime,
    };
  }

  // Step 2: Build focused spec/review (only flagged requirements/abuse cases)
  const focusedSpec = buildFocusedSpec(
    context.specContent,
    context.config.focusRequirements.map((r) => r.requirementId),
  );

  const focusedReview = buildFocusedReview(
    context.reviewContent ?? "",
    context.config.focusAbuseCases.map((a) => a.abuseCaseId),
  );

  // Step 3: Map flagged abuse cases to AbuseCase format
  const abuseCases: AbuseCase[] = context.config.focusAbuseCases.map((ac) => ({
    id: ac.abuseCaseId,
    severity: "high", // All flagged abuse cases are high severity
    title: ac.description,
    attacker_goal: ac.description,
    technique: `Missing defensive pattern: ${ac.missingPattern}`,
    preconditions: [`File affected: ${ac.affectedFiles.join(", ")}`],
    impact: ac.mitigation,
    mitigation: ac.mitigation,
    stride_category: ac.category,
    testable: true,
  }));

  // Step 4: Build AuditContext
  const auditContext: AuditContext = {
    config: context.speciaConfig,
    changeName: context.changeName,
    specContent: focusedSpec,
    reviewContent: focusedReview,
    abuseCases,
    codeFiles: budgetedFiles,
    designContent: context.designContent ?? undefined,
  };

  // Step 5: Generate audit prompt (uses posture from config)
  const prompt = generateAuditPrompt(auditContext);

  // Step 6: Call LLM
  const llmProvider = context.config.llmProvider ?? "anthropic";
  const llmModel =
    context.config.llmModel ??
    (llmProvider === "anthropic" ? "claude-3-5-haiku-20241022" : "gpt-4o-mini");

  let llmResult: unknown;
  if (llmProvider === "anthropic") {
    llmResult = await callAnthropic(prompt, llmModel);
  } else {
    llmResult = await callOpenAI(prompt, llmModel);
  }

  // Step 7: Validate LLM response
  const specHash = createHash("sha256").update(focusedSpec, "utf8").digest("hex");
  const auditHash = "guardian-layer4b"; // Placeholder for Guardian context

  const auditResult = validateAuditResult(
    llmResult,
    context.changeName,
    specHash,
    auditHash,
    "standard",
  );

  // Step 8: Map AuditResult to GuardianVerdict
  const verdict = mapVerdict(auditResult.summary.overall_verdict);

  return {
    verdict,
    failedRequirements: auditResult.requirements
      .filter((r) => r.verdict === "fail")
      .map((r) => r.requirement_id),
    failedAbuseCases: auditResult.abuse_cases
      .filter((a) => a.verdict === "unverified")
      .map((a) => a.abuse_case_id),
    summary: buildSummary(auditResult, context.config),
    duration_ms: Date.now() - startTime,
  };
}

/**
 * Map AuditResult overall_verdict to GuardianVerdict.
 *
 * AuditEngine and Guardian use the same verdict schema, so this is a direct mapping.
 */
function mapVerdict(overallVerdict: "pass" | "fail" | "partial"): GuardianVerdict {
  return overallVerdict;
}

/**
 * Build summary text from AuditResult.
 */
function buildSummary(
  auditResult: {
    requirements: Array<{ requirement_id: string; verdict: string }>;
    abuse_cases: Array<{ abuse_case_id: string; verdict: string }>;
    summary: { overall_verdict: string };
  },
  config: GuardianAuditConfig,
): string {
  const failedReqs = auditResult.requirements.filter((r) => r.verdict === "fail").length;
  const failedACs = auditResult.abuse_cases.filter((a) => a.verdict === "unverified").length;

  const parts: string[] = [];
  parts.push(`Layer 4b validation: ${auditResult.summary.overall_verdict}`);

  if (failedReqs > 0) {
    parts.push(`${failedReqs} requirement(s) failed validation`);
  }

  if (failedACs > 0) {
    parts.push(`${failedACs} abuse case(s) unverified`);
  }

  if (config.focusRequirements.length > 0) {
    parts.push(`(checked ${config.focusRequirements.length} flagged requirement(s))`);
  }

  return parts.join(", ");
}
