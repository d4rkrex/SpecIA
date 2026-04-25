/**
 * Audit Engine — post-implementation code audit service.
 *
 * Module-level pure functions (same pattern as review.ts):
 * - discoverChangedFiles() — git diff based code discovery
 * - readCodeFiles() — reads file contents from disk
 * - selectAndBudgetFiles() — priority-based file selection with token budgeting
 * - computeAuditHash() — SHA256 of audited code state
 * - generateAuditPrompt() — posture-driven prompt construction
 * - validateAuditResult() — LLM response validation (Phase 1)
 * - renderAuditMarkdown() — audit report markdown rendering
 * - parseAbuseCasesFromReview() — extracts abuse cases from review.md
 *
 * Spec refs: Domain 1, Domain 2, Domain 6, Domain 9
 * Design refs: Decision 1–6, 8, 10
 *
 * v0.3: /spec-audit feature. Phase 1 (types+validation), Phase 2 (core engine),
 *       Phase 3 (posture-driven prompt templates).
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";

import type {
  SecurityPosture,
  VtspecConfig,
  AuditResult,
  AuditPrompt,
  AuditSummary,
  CodeFile,
  RequirementVerification,
  AbuseCaseVerification,
  RequirementVerdict,
  AbuseCaseVerdict,
  OverallVerdict,
  RequirementsCoverage,
  AbuseCasesCoverage,
  AbuseCase,
} from "../types/index.js";

import { buildStandardAuditPrompt } from "../prompts/audit-standard.js";
import { buildElevatedAuditPrompt } from "../prompts/audit-elevated.js";
import { buildParanoidAuditPrompt } from "../prompts/audit-paranoid.js";

// ── Context Interface ────────────────────────────────────────────────

/**
 * Context passed to generateAuditPrompt().
 *
 * Spec refs: Domain 2 (AuditContext Interface)
 * Design refs: Decision 5 (AuditEngine API)
 */
export interface AuditContext {
  config: VtspecConfig;
  changeName: string;
  specContent: string;
  reviewContent: string;
  abuseCases: AbuseCase[];
  codeFiles: CodeFile[];
  designContent?: string;
  proposalContent?: string;
}

// ── Error Class ──────────────────────────────────────────────────────

/**
 * Structured validation error for audit results.
 *
 * Follows the ReviewValidationError pattern at review.ts:283-291.
 */
export class AuditValidationError extends Error {
  constructor(
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AuditValidationError";
  }
}

// ── Result Validation ────────────────────────────────────────────────

/**
 * Validate an audit result returned by the agent's LLM.
 *
 * Performs structural validation — ensures required fields are present
 * and correctly typed. Returns a fully typed AuditResult or throws
 * AuditValidationError.
 *
 * Spec refs: Domain 2 (Audit Result Validation — valid, missing, defaults)
 */
export function validateAuditResult(
  result: unknown,
  changeName: string,
  specHash: string,
  auditHash: string,
  posture: SecurityPosture,
): AuditResult {
  if (!result || typeof result !== "object") {
    throw new AuditValidationError("Audit result must be a JSON object");
  }

  const obj = result as Record<string, unknown>;

  // Validate requirements (required, must be non-empty array)
  const requirements = validateRequirements(obj.requirements);

  // Validate abuse cases (required field, may be empty array)
  const abuseCases = validateAbuseCases(obj.abuse_cases);

  // Validate summary (required)
  const summary = validateSummary(obj.summary, requirements, abuseCases);

  // ── Semantic Validation (Requirement 2: fix-empty-audit) ──────────
  // Beyond structural checks, verify that the audit contains substantive content.
  validateSemanticContent(requirements, abuseCases);

  return {
    change: changeName,
    posture,
    timestamp: new Date().toISOString(),
    spec_hash: specHash,
    audit_hash: auditHash,
    requirements,
    abuse_cases: abuseCases,
    summary,
  };
}

// ── Internal Validation Helpers ──────────────────────────────────────

const VALID_REQUIREMENT_VERDICTS: RequirementVerdict[] = ["pass", "fail", "partial", "skipped"];
const VALID_ABUSE_CASE_VERDICTS: AbuseCaseVerdict[] = ["verified", "unverified", "partial", "not_applicable"];
const VALID_OVERALL_VERDICTS: OverallVerdict[] = ["pass", "fail", "partial"];
const VALID_RISK_LEVELS = ["low", "medium", "high", "critical"] as const;

function validateRequirementVerdict(raw: unknown): RequirementVerdict {
  if (typeof raw === "string" && (VALID_REQUIREMENT_VERDICTS as readonly string[]).includes(raw)) {
    return raw as RequirementVerdict;
  }
  return "partial"; // closest safe default for invalid/unknown verdict
}

function validateAbuseCaseVerdict(raw: unknown): AbuseCaseVerdict {
  if (typeof raw === "string" && (VALID_ABUSE_CASE_VERDICTS as readonly string[]).includes(raw)) {
    return raw as AbuseCaseVerdict;
  }
  return "partial"; // closest safe default
}

function validateOverallVerdict(raw: unknown): OverallVerdict {
  if (typeof raw === "string" && (VALID_OVERALL_VERDICTS as readonly string[]).includes(raw)) {
    return raw as OverallVerdict;
  }
  return "partial"; // default to partial if invalid
}

function validateRiskLevel(raw: unknown): "low" | "medium" | "high" | "critical" {
  if (typeof raw === "string" && (VALID_RISK_LEVELS as readonly string[]).includes(raw)) {
    return raw as "low" | "medium" | "high" | "critical";
  }
  return "medium"; // default to medium if invalid/missing (matches review.ts pattern)
}

function validateRequirements(raw: unknown): RequirementVerification[] {
  if (!Array.isArray(raw)) {
    throw new AuditValidationError("Missing or invalid 'requirements' field — must be an array");
  }

  if (raw.length === 0) {
    throw new AuditValidationError("'requirements' array must not be empty");
  }

  return raw
    .filter((item): item is Record<string, unknown> => item && typeof item === "object")
    .map((item) => ({
      requirement_id: String(item.requirement_id ?? "UNKNOWN"),
      verdict: validateRequirementVerdict(item.verdict),
      evidence: String(item.evidence ?? ""),
      code_references: Array.isArray(item.code_references)
        ? item.code_references.map(String)
        : [],
      gaps: Array.isArray(item.gaps) ? item.gaps.map(String) : [],
      notes: String(item.notes ?? ""),
    }));
}

function validateAbuseCases(raw: unknown): AbuseCaseVerification[] {
  if (!Array.isArray(raw)) {
    // Abuse cases are required as a field but may be empty array
    return [];
  }

  return raw
    .filter((item): item is Record<string, unknown> => item && typeof item === "object")
    .map((item) => ({
      abuse_case_id: String(item.abuse_case_id ?? "AC-???"),
      verdict: validateAbuseCaseVerdict(item.verdict),
      evidence: String(item.evidence ?? ""),
      code_references: Array.isArray(item.code_references)
        ? item.code_references.map(String)
        : [],
      gaps: Array.isArray(item.gaps) ? item.gaps.map(String) : [],
      risk_if_unaddressed: String(item.risk_if_unaddressed ?? ""),
    }));
}

function validateSummary(
  raw: unknown,
  requirements: RequirementVerification[],
  abuseCases: AbuseCaseVerification[],
): AuditSummary {
  if (!raw || typeof raw !== "object") {
    throw new AuditValidationError("Missing or invalid 'summary' field");
  }

  const obj = raw as Record<string, unknown>;

  // Parse coverage or compute from arrays
  const reqCoverage = validateRequirementsCoverage(obj.requirements_coverage, requirements);
  const acCoverage = validateAbuseCasesCoverage(obj.abuse_cases_coverage, abuseCases);

  return {
    overall_verdict: validateOverallVerdict(obj.overall_verdict),
    requirements_coverage: reqCoverage,
    abuse_cases_coverage: acCoverage,
    risk_level: validateRiskLevel(obj.risk_level),
    recommendations: Array.isArray(obj.recommendations)
      ? obj.recommendations.map(String)
      : [],
  };
}

function validateRequirementsCoverage(
  raw: unknown,
  requirements: RequirementVerification[],
): RequirementsCoverage {
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    return {
      total: typeof obj.total === "number" ? obj.total : requirements.length,
      passed: typeof obj.passed === "number" ? obj.passed : 0,
      failed: typeof obj.failed === "number" ? obj.failed : 0,
      partial: typeof obj.partial === "number" ? obj.partial : 0,
      skipped: typeof obj.skipped === "number" ? obj.skipped : 0,
    };
  }

  // Compute from requirements array if coverage field is missing
  return {
    total: requirements.length,
    passed: requirements.filter((r) => r.verdict === "pass").length,
    failed: requirements.filter((r) => r.verdict === "fail").length,
    partial: requirements.filter((r) => r.verdict === "partial").length,
    skipped: requirements.filter((r) => r.verdict === "skipped").length,
  };
}

function validateAbuseCasesCoverage(
  raw: unknown,
  abuseCases: AbuseCaseVerification[],
): AbuseCasesCoverage {
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    return {
      total: typeof obj.total === "number" ? obj.total : abuseCases.length,
      verified: typeof obj.verified === "number" ? obj.verified : 0,
      unverified: typeof obj.unverified === "number" ? obj.unverified : 0,
      partial: typeof obj.partial === "number" ? obj.partial : 0,
      not_applicable: typeof obj.not_applicable === "number" ? obj.not_applicable : 0,
    };
  }

  // Compute from abuse cases array if coverage field is missing
  return {
    total: abuseCases.length,
    verified: abuseCases.filter((a) => a.verdict === "verified").length,
    unverified: abuseCases.filter((a) => a.verdict === "unverified").length,
    partial: abuseCases.filter((a) => a.verdict === "partial").length,
    not_applicable: abuseCases.filter((a) => a.verdict === "not_applicable").length,
  };
}

// ── Semantic Validation (Requirement 2: fix-empty-audit) ─────────────

/** Minimum evidence length for pass/fail verdicts to be considered substantive. */
const MIN_EVIDENCE_LENGTH = 20;

/**
 * Validate semantic content of an audit result beyond structural correctness.
 *
 * Enforces:
 * 1. At least one non-skipped requirement must exist and be substantiated
 * 2. Non-skipped requirements with pass/fail verdicts must have non-empty evidence (>= MIN_EVIDENCE_LENGTH chars)
 * 3. At least one non-skipped requirement must have non-empty code_references (with real content, not empty strings)
 * 4. code_references arrays must not contain only empty strings
 *
 * Spec refs: Requirement 2 (Semantic Audit Result Validation)
 * Security refs: AC-001 mitigation, S-01 mitigation
 */
function validateSemanticContent(
  requirements: RequirementVerification[],
  _abuseCases: AbuseCaseVerification[],
): void {
  // Get non-skipped requirements
  const nonSkipped = requirements.filter((r) => r.verdict !== "skipped");

  if (nonSkipped.length === 0) {
    throw new AuditValidationError(
      "At least one non-skipped requirement must exist — an audit with all requirements skipped is not substantive.",
    );
  }

  // Check evidence on pass/fail verdicts
  for (const req of nonSkipped) {
    if (req.verdict === "pass" || req.verdict === "fail") {
      if (!req.evidence || req.evidence.trim().length < MIN_EVIDENCE_LENGTH) {
        throw new AuditValidationError(
          `Requirement "${req.requirement_id}" has verdict "${req.verdict}" but evidence is too short (${req.evidence.trim().length} chars, minimum ${MIN_EVIDENCE_LENGTH}). Pass/fail verdicts must include substantive evidence.`,
        );
      }
    }
  }

  // Check that at least one non-skipped requirement has real code_references
  const hasAnyRealCodeRef = nonSkipped.some((req) => {
    if (!req.code_references || req.code_references.length === 0) return false;
    // Filter out empty/whitespace-only strings
    const realRefs = req.code_references.filter((ref) => ref.trim().length > 0);
    return realRefs.length > 0;
  });

  if (!hasAnyRealCodeRef) {
    throw new AuditValidationError(
      "At least one non-skipped requirement must have non-empty code_references to substantiate the audit. An audit with zero code references across all requirements indicates no real code analysis was performed.",
    );
  }

  // Check for code_references that contain only empty strings
  for (const req of nonSkipped) {
    if (req.code_references.length > 0) {
      const realRefs = req.code_references.filter((ref) => ref.trim().length > 0);
      if (realRefs.length === 0) {
        throw new AuditValidationError(
          `Requirement "${req.requirement_id}" has code_references that are all empty strings — references must contain actual file paths or code locations.`,
        );
      }
    }
  }
}

// ── Code Discovery ───────────────────────────────────────────────────

/** File extensions to always skip (binaries, assets, fonts). */
const IGNORED_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".webp",
  ".woff", ".woff2", ".ttf", ".eot",
  ".lock",
]);

/** File names to always skip (lockfiles, generated). */
const IGNORED_FILES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
]);

/** Directory prefixes to always skip (build output, deps). */
const IGNORED_DIRS = [
  "dist/", "build/", "node_modules/", ".next/", ".specia/",
];

/** Security-relevant file path patterns for Tier 2 prioritization. */
const SECURITY_PATTERN = /auth|crypto|token|session|password|secret|key|login|permission|role|sanitize|validate|escape/i;

/**
 * Detect the base branch of the repository.
 * Tries git symbolic-ref, falls back to "main".
 */
function detectBaseBranch(projectRoot: string): string {
  try {
    const ref = execSync("git symbolic-ref refs/remotes/origin/HEAD", {
      cwd: projectRoot,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return ref.replace("refs/remotes/origin/", "");
  } catch {
    return "main";
  }
}

/**
 * Filter a file path against ignored patterns.
 * Returns true if the file should be INCLUDED (not ignored).
 */
function isCodeFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  if (IGNORED_EXTENSIONS.has(ext)) return false;

  const basename = path.basename(filePath);
  if (IGNORED_FILES.has(basename)) return false;

  if (IGNORED_DIRS.some((dir) => filePath.startsWith(dir))) return false;

  return true;
}

/**
 * Discover files changed since the base branch using git diff.
 *
 * Falls back to reading state.yaml affected files if git diff fails.
 * Filters out non-code files (binaries, lockfiles, generated).
 *
 * Spec refs: Domain 6 (Git-Based File Discovery)
 * Design refs: Decision 4 (Code reading via git diff)
 */
export function discoverChangedFiles(
  changeName: string,
  baseBranch?: string,
  projectRoot?: string,
): string[] {
  const root = projectRoot ?? process.cwd();
  const base = baseBranch ?? detectBaseBranch(root);

  try {
    const output = execSync(`git diff ${base}...HEAD --name-only`, {
      cwd: root,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return output
      .trim()
      .split("\n")
      .filter(Boolean)
      .filter(isCodeFile);
  } catch {
    // Fallback: try reading state.yaml for scope hints
    try {
      const statePath = path.join(root, ".specia", "changes", changeName, "state.yaml");
      if (fs.existsSync(statePath)) {
        // Try to read proposal for scope paths as a last resort
        const proposalPath = path.join(root, ".specia", "changes", changeName, "proposal.md");
        if (fs.existsSync(proposalPath)) {
          const proposal = fs.readFileSync(proposalPath, "utf-8");
          const scopeMatch = proposal.match(/## Scope\s*\n((?:- .+\n?)*)/);
          if (scopeMatch?.[1]) {
            return scopeMatch[1]
              .split("\n")
              .map((line) => line.replace(/^- /, "").trim())
              .filter(Boolean)
              .filter(isCodeFile);
          }
        }
      }
    } catch {
      // All fallbacks failed
    }
    return [];
  }
}

/**
 * Read file contents from disk.
 *
 * Returns array of CodeFile objects with path, content, and estimated token count.
 * Skips missing files gracefully with a console warning.
 *
 * Spec refs: Domain 6 (File reading)
 */
export function readCodeFiles(files: string[], projectRoot: string): CodeFile[] {
  const result: CodeFile[] = [];

  for (const filePath of files) {
    try {
      const fullPath = path.join(projectRoot, filePath);
      if (!fs.existsSync(fullPath)) continue;
      const content = fs.readFileSync(fullPath, "utf-8");
      const tokens = Math.ceil(content.length / 4);
      result.push({ path: filePath, content, tokens });
    } catch {
      // Skip files that can't be read
    }
  }

  return result;
}

/**
 * Select and budget files based on priority tiers and token limits.
 *
 * Three-tier priority:
 *   Tier 1 — Files mentioned in spec content
 *   Tier 2 — Security-relevant files (auth, crypto, token, etc.)
 *   Tier 3 — Remaining files, largest first
 *
 * Token estimation: ceil(chars / 4)
 *
 * Spec refs: Domain 6 (File Prioritization, Token Limit Enforcement)
 * Design refs: Decision 5 (Token budget with priority-based file selection)
 */
export function selectAndBudgetFiles(
  files: CodeFile[],
  maxTokens: number,
  specContent?: string,
): CodeFile[] {
  // Categorize into tiers
  const tier1: CodeFile[] = []; // spec-mentioned
  const tier2: CodeFile[] = []; // security-relevant
  const tier3: CodeFile[] = []; // everything else

  for (const file of files) {
    if (specContent && specContent.includes(file.path)) {
      tier1.push(file);
    } else if (SECURITY_PATTERN.test(file.path)) {
      tier2.push(file);
    } else {
      tier3.push(file);
    }
  }

  // Sort tier3 by size descending (largest diffs = most interesting)
  tier3.sort((a, b) => b.tokens - a.tokens);

  // Merge in priority order
  const prioritized = [...tier1, ...tier2, ...tier3];

  // Apply token budget
  const selected: CodeFile[] = [];
  let totalTokens = 0;

  for (const file of prioritized) {
    if (totalTokens + file.tokens > maxTokens) continue;
    selected.push(file);
    totalTokens += file.tokens;
  }

  return selected;
}

// ── Code Hash ────────────────────────────────────────────────────────

/** The well-known SHA256 hash of the empty string — used as a sentinel to detect zero-file hashes. */
export const EMPTY_SHA256_SENTINEL = "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

/**
 * Compute a SHA256 hash representing the audited code state.
 *
 * Hash is computed as: sha256(sorted "filepath:sha256(content)" pairs joined by newlines).
 * Same pattern as computeSpecHash in cache.ts.
 *
 * Throws AuditValidationError when called with an empty file array,
 * because hashing zero files produces the empty-string SHA256 sentinel
 * which is meaningless for audit integrity.
 *
 * Spec refs: Domain 6 (Code Hash Computation), Requirement 3 (Audit Hash Integrity)
 * Design refs: Decision 8 (Smart caching via audit_hash)
 */
export function computeAuditHash(files: CodeFile[]): string {
  if (files.length === 0) {
    throw new AuditValidationError(
      "Cannot compute audit hash from zero files — audit hash requires at least one code file.",
    );
  }

  const entries = files
    .map((f) => `${f.path}:${createHash("sha256").update(f.content, "utf8").digest("hex")}`)
    .sort()
    .join("\n");
  const hash = "sha256:" + createHash("sha256").update(entries, "utf8").digest("hex");

  // Defensive check: reject the empty-string sentinel even if somehow computed
  if (hash === EMPTY_SHA256_SENTINEL) {
    throw new AuditValidationError(
      "Computed audit hash matches the empty-string SHA256 sentinel — this indicates zero effective file content was hashed.",
    );
  }

  return hash;
}

// ── Prompt Generation ────────────────────────────────────────────────

/**
 * Generate an audit prompt based on the project's security posture.
 *
 * Delegates to posture-specific prompt builders following the same
 * switch pattern as generateReviewPrompt() in review.ts.
 *
 * Spec refs: Domain 2 (AuditEngine Module), Domain 8 (Posture-Driven Audit Prompts)
 * Design refs: Decision 9 (Posture-driven prompt templates)
 */
export function generateAuditPrompt(ctx: AuditContext): AuditPrompt {
  const posture = ctx.config.security.posture;
  const base = {
    projectDescription: ctx.config.project.description,
    stack: ctx.config.project.stack,
    changeName: ctx.changeName,
    specContent: ctx.specContent,
    abuseCases: ctx.abuseCases,
    codeFiles: ctx.codeFiles,
    reviewContent: ctx.reviewContent,
    designContent: ctx.designContent,
    proposalContent: ctx.proposalContent,
  };

  switch (posture) {
    case "standard":
      return buildStandardAuditPrompt(base);
    case "elevated":
      return buildElevatedAuditPrompt(base);
    case "paranoid":
      return buildParanoidAuditPrompt(base);
    default: {
      const _exhaustive: never = posture;
      throw new Error(`Unknown posture: ${_exhaustive}`);
    }
  }
}

// ── Markdown Rendering ───────────────────────────────────────────────

/** Map requirement verdict to emoji for display. */
function requirementVerdictEmoji(verdict: RequirementVerdict): string {
  switch (verdict) {
    case "pass": return "\u{1F7E2}";   // 🟢
    case "fail": return "\u{1F534}";   // 🔴
    case "partial": return "\u{1F7E1}"; // 🟡
    case "skipped": return "\u{26AA}";  // ⚪
  }
}

/** Map abuse case verdict to emoji for display. */
function abuseCaseVerdictEmoji(verdict: AbuseCaseVerdict): string {
  switch (verdict) {
    case "verified": return "\u{2705}";       // ✅
    case "unverified": return "\u{274C}";     // ❌
    case "partial": return "\u{26A0}\u{FE0F}"; // ⚠️
    case "not_applicable": return "\u{2796}";  // ➖
  }
}

/**
 * Render a validated AuditResult as a markdown document (audit.md).
 *
 * Includes YAML frontmatter with machine-parseable metadata.
 *
 * Spec refs: Domain 2 (Audit Markdown Rendering), Domain 9 (Template Rendering)
 * Design refs: Decision 10 (renderAuditMarkdown inside audit.ts)
 */
export function renderAuditMarkdown(audit: AuditResult): string {
  const lines: string[] = [];

  // YAML frontmatter
  lines.push("---");
  lines.push(`change: "${audit.change}"`);
  lines.push(`timestamp: "${audit.timestamp}"`);
  lines.push(`posture: "${audit.posture}"`);
  lines.push(`spec_hash: "${audit.spec_hash}"`);
  lines.push(`audit_hash: "${audit.audit_hash}"`);
  lines.push(`overall_verdict: "${audit.summary.overall_verdict}"`);
  lines.push(`risk_level: "${audit.summary.risk_level}"`);
  lines.push("requirements_coverage:");
  lines.push(`  total: ${audit.summary.requirements_coverage.total}`);
  lines.push(`  passed: ${audit.summary.requirements_coverage.passed}`);
  lines.push(`  failed: ${audit.summary.requirements_coverage.failed}`);
  lines.push(`  partial: ${audit.summary.requirements_coverage.partial}`);
  lines.push(`  skipped: ${audit.summary.requirements_coverage.skipped}`);
  lines.push("abuse_cases_coverage:");
  lines.push(`  total: ${audit.summary.abuse_cases_coverage.total}`);
  lines.push(`  verified: ${audit.summary.abuse_cases_coverage.verified}`);
  lines.push(`  unverified: ${audit.summary.abuse_cases_coverage.unverified}`);
  lines.push(`  partial: ${audit.summary.abuse_cases_coverage.partial}`);
  lines.push(`  not_applicable: ${audit.summary.abuse_cases_coverage.not_applicable}`);
  lines.push("---");
  lines.push("");

  // Title
  lines.push(`# Spec Audit: ${audit.change}`);
  lines.push("");
  lines.push(
    `**Posture**: ${audit.posture} | **Verdict**: ${audit.summary.overall_verdict} | **Risk**: ${audit.summary.risk_level}`,
  );
  lines.push("");

  // Requirements Verification
  lines.push("## Requirements Verification");
  lines.push("");

  if (audit.requirements.length === 0) {
    lines.push("No requirements to verify.");
  } else {
    // Summary table
    lines.push("| Requirement | Verdict | Evidence |");
    lines.push("|-------------|---------|----------|");
    for (const req of audit.requirements) {
      const emoji = requirementVerdictEmoji(req.verdict);
      const evidence = req.evidence.length > 80
        ? req.evidence.substring(0, 77) + "..."
        : req.evidence;
      lines.push(`| ${req.requirement_id} | ${emoji} ${req.verdict} | ${evidence || "—"} |`);
    }
    lines.push("");

    // Detailed entries
    for (const req of audit.requirements) {
      const emoji = requirementVerdictEmoji(req.verdict);
      lines.push(`### ${req.requirement_id}: ${emoji} ${req.verdict}`);
      lines.push("");
      if (req.evidence) {
        lines.push(`**Evidence**: ${req.evidence}`);
        lines.push("");
      }
      if (req.code_references.length > 0) {
        lines.push(`**Code References**: ${req.code_references.join(", ")}`);
        lines.push("");
      }
      if (req.gaps.length > 0) {
        lines.push("**Gaps**:");
        for (const gap of req.gaps) {
          lines.push(`- ${gap}`);
        }
        lines.push("");
      }
      if (req.notes) {
        lines.push(`**Notes**: ${req.notes}`);
        lines.push("");
      }
    }
  }

  // Abuse Case Verification
  lines.push("## Abuse Case Verification");
  lines.push("");

  if (audit.abuse_cases.length === 0) {
    lines.push("No abuse cases from review.");
  } else {
    // Summary table
    lines.push("| Abuse Case | Verdict | Risk if Unaddressed |");
    lines.push("|------------|---------|---------------------|");
    for (const ac of audit.abuse_cases) {
      const emoji = abuseCaseVerdictEmoji(ac.verdict);
      const risk = ac.risk_if_unaddressed.length > 60
        ? ac.risk_if_unaddressed.substring(0, 57) + "..."
        : ac.risk_if_unaddressed;
      lines.push(`| ${ac.abuse_case_id} | ${emoji} ${ac.verdict} | ${risk || "—"} |`);
    }
    lines.push("");

    // Detailed entries
    for (const ac of audit.abuse_cases) {
      const emoji = abuseCaseVerdictEmoji(ac.verdict);
      lines.push(`### ${ac.abuse_case_id}: ${emoji} ${ac.verdict}`);
      lines.push("");
      if (ac.evidence) {
        lines.push(`**Evidence**: ${ac.evidence}`);
        lines.push("");
      }
      if (ac.code_references.length > 0) {
        lines.push(`**Code References**: ${ac.code_references.join(", ")}`);
        lines.push("");
      }
      if (ac.gaps.length > 0) {
        lines.push("**Gaps**:");
        for (const gap of ac.gaps) {
          lines.push(`- ${gap}`);
        }
        lines.push("");
      }
      if (ac.risk_if_unaddressed) {
        lines.push(`**Risk if Unaddressed**: ${ac.risk_if_unaddressed}`);
        lines.push("");
      }
    }
  }

  // Security Posture Assessment
  lines.push("## Security Posture Assessment");
  lines.push("");
  const rc = audit.summary.requirements_coverage;
  const ac = audit.summary.abuse_cases_coverage;
  lines.push(`- **Requirements**: ${rc.passed}/${rc.total} passed, ${rc.failed} failed, ${rc.partial} partial, ${rc.skipped} skipped`);
  lines.push(`- **Abuse Cases**: ${ac.verified}/${ac.total} verified, ${ac.unverified} unverified, ${ac.partial} partial, ${ac.not_applicable} N/A`);
  lines.push(`- **Risk Level**: ${audit.summary.risk_level}`);
  lines.push(`- **Overall Verdict**: ${audit.summary.overall_verdict}`);
  lines.push("");

  // Recommendations
  lines.push("## Recommendations");
  lines.push("");
  if (audit.summary.recommendations.length === 0) {
    lines.push("No recommendations — all verifications passed.");
  } else {
    for (const rec of audit.summary.recommendations) {
      lines.push(`- [ ] ${rec}`);
    }
  }
  lines.push("");

  return lines.join("\n");
}

// ── Abuse Case Parsing ───────────────────────────────────────────────

/**
 * Parse abuse cases from a review.md markdown file.
 *
 * Extracts structured abuse case data from the review document.
 * Falls back to empty array if parsing fails.
 *
 * Spec refs: Domain 2 (supporting — AuditContext requires abuseCases)
 * Design refs: Task 4.3
 */
export function parseAbuseCasesFromReview(reviewContent: string): AbuseCase[] {
  if (!reviewContent) return [];

  try {
    const abuseCases: AbuseCase[] = [];

    // Find abuse case sections: "### AC-NNN: Title"
    const acSectionRegex = /### (AC-\d+): (.+)\n([\s\S]*?)(?=\n### |\n## |\n$|$)/g;
    let match: RegExpExecArray | null;

    while ((match = acSectionRegex.exec(reviewContent)) !== null) {
      const id = match[1]!;
      const title = match[2]!.trim();
      const body = match[3]!;

      // Extract fields from the body
      const severity = extractField(body, "Severity")?.replace(/[🔴🟠🟡🟢⚪]\s*/g, "").toLowerCase().trim() ?? "medium";
      const goal = extractField(body, "Goal") ?? "";
      const technique = extractField(body, "Technique") ?? "";
      const preConditionsRaw = extractField(body, "Preconditions") ?? "";
      const impact = extractField(body, "Impact") ?? "";
      const mitigation = extractField(body, "Mitigation") ?? "";
      const strideCategory = extractField(body, "STRIDE") ?? "Unknown";
      const testableRaw = extractField(body, "Testable") ?? "No";
      const testHint = extractField(body, "Test Hint");

      const preconditions = preConditionsRaw === "None"
        ? []
        : preConditionsRaw.split(";").map((s) => s.trim()).filter(Boolean);

      abuseCases.push({
        id,
        title,
        severity: validateSeverityValue(severity),
        attacker_goal: goal,
        technique,
        preconditions,
        impact,
        mitigation,
        stride_category: strideCategory,
        testable: testableRaw.toLowerCase() === "yes",
        test_hint: testHint || undefined,
      });
    }

    return abuseCases;
  } catch {
    return [];
  }
}

/** Extract a markdown field value like "- **Field**: value" */
function extractField(body: string, fieldName: string): string | null {
  const regex = new RegExp(`\\*\\*${fieldName}\\*\\*:\\s*(.+)`, "i");
  const match = body.match(regex);
  return match?.[1]?.trim() ?? null;
}

// ── Staleness Detection ──────────────────────────────────────────────

/**
 * Determine whether a completed audit is stale.
 *
 * An audit is stale when the current code hash doesn't match the stored
 * audit_hash — meaning code changed after the audit was performed.
 *
 * Spec refs: Domain 7 (Audit Staleness Check)
 * Design refs: Decision 8 (Smart caching via audit_hash)
 */
export function isAuditStale(
  storedAuditHash: string | undefined,
  currentAuditHash: string,
): boolean {
  if (!storedAuditHash) return true; // never audited = considered stale
  return storedAuditHash !== currentAuditHash;
}

/** Validate severity string to typed value. */
function validateSeverityValue(raw: string): "low" | "medium" | "high" | "critical" {
  const valid = ["low", "medium", "high", "critical"];
  // Handle capitalized versions like "Critical", "High"
  const lower = raw.toLowerCase();
  if (valid.includes(lower)) {
    return lower as "low" | "medium" | "high" | "critical";
  }
  return "medium";
}
