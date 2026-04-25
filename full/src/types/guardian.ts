/**
 * Guardian pre-commit hook types.
 *
 * v0.2: Guardian metadata validation (Layers 1-3)
 * v0.4: Guardian spec-aware validation (Layer 4)
 *
 * Spec refs: guardian-spec-aware — all domains
 * Design refs: guardian-spec-aware — Decisions 1-10
 */

// ── Layer 4a: Heuristic Validation Types ─────────────────────────────

/** AST-extracted code elements for heuristic matching. */
export interface CodeElements {
  functionNames: Array<{ name: string; line: number }>;
  imports: Array<{ source: string; line: number }>;
  typeNames: Array<{ name: string; line: number }>;
  classNames: Array<{ name: string; line: number }>;
  variableNames: Array<{ name: string; line: number }>;
}

/** Requirement keywords extracted from spec for heuristic matching. */
export interface RequirementKeywords {
  requirementId: string;
  keywords: Set<string>;
  phrases: Set<string>;
}

/** Evidence source type and weight for heuristic scoring. */
export interface EvidenceSource {
  type: "function_name" | "import" | "type_def" | "class_name" | "variable";
  weight: number;
  match: string;
  location: string; // file:line
}

/** Evidence score result from Layer 4a heuristic analysis. */
export interface EvidenceScore {
  score: number;
  sources: EvidenceSource[];
}

/** Requirement flagged by Layer 4a for Layer 4b validation. */
export interface FlaggedRequirement {
  requirementId: string;
  keywords: string[];
  reason: "zero_evidence";
}

/** Abuse case flagged by Layer 4a for Layer 4b validation. */
export interface FlaggedAbuseCase {
  abuseCaseId: string;
  category: string;
  description: string;
  mitigation: string;
  affectedFiles: string[];
  missingPattern: string;
}

/** Layer 4a heuristic validation result. */
export interface HeuristicResult {
  file: string;
  result: "pass" | "flag"; // 'flag' → trigger Layer 4b
  evidence_score: number;
  evidence_sources: EvidenceSource[];
  flagged_requirements: FlaggedRequirement[];
  flagged_abuse_cases: FlaggedAbuseCase[];
}

// ── Layer 4b: LLM Validation Types ───────────────────────────────────

/** Guardian verdict from Layer 4b LLM validation. */
export type GuardianVerdict = "pass" | "fail" | "partial";

/** Guardian-specific audit configuration for Layer 4b. */
export interface GuardianAuditConfig {
  maxTokens: number;
  maxFiles: number;
  llmProvider: "anthropic" | "openai";
  llmModel: string;
  focusRequirements: FlaggedRequirement[];
  focusAbuseCases: FlaggedAbuseCase[];
}

/** Guardian audit result from Layer 4b. */
export interface GuardianAuditResult {
  verdict: GuardianVerdict;
  failedRequirements: string[];
  failedAbuseCases: string[];
  summary: string;
  duration_ms: number;
}

// ── Layer 4: Combined Result Types ───────────────────────────────────

/** Layer 4 (4a + 4b) combined validation result. */
export interface SpecMatchResult {
  status: "pass" | "warn" | "fail";
  layer: "4a" | "4b" | "bypass";
  cached?: boolean;
  evidence_score?: number;
  verdict?: GuardianVerdict;
  summary?: string;
  reason?: string;
  error?: string;
  degraded?: boolean; // true if Layer 4b failed gracefully
  /** v0.4: Flagged requirements for error formatting */
  flagged_requirements?: Array<{
    requirement_name: string;
    reason: string;
    evidence?: string[];
  }>;
  /** v0.4: Flagged abuse cases for error formatting */
  flagged_abuse_cases?: Array<{
    abuse_case_name: string;
    reason: string;
    evidence?: string[];
  }>;
}

// ── Cache Types ──────────────────────────────────────────────────────

/** Layer 4a cache entry. */
export interface L4aCacheEntry {
  file: string;
  cache_key: string;
  result: "pass" | "flag";
  evidence_score: number;
  evidence_sources: EvidenceSource[];
  timestamp: string;
}

/** Layer 4b cache entry. */
export interface L4bCacheEntry {
  file: string;
  cache_key: string;
  verdict: GuardianVerdict;
  failed_requirements: string[];
  failed_abuse_cases: string[];
  timestamp: string;
}

/** Guardian spec-aware cache structure. */
export interface GuardianSpecCache {
  version: string;
  l4a_entries: Record<string, L4aCacheEntry>;
  l4b_entries: Record<string, L4bCacheEntry>;
}

// ── Guardian Validation Types ────────────────────────────────────────

/** File validation result from Guardian. */
export interface FileValidation {
  file: string;
  status: "pass" | "warn" | "fail";
  change?: string;
  reason?: string;
  checks: {
    spec_exists: boolean | null;
    review_complete: boolean | null;
    mitigations_done: boolean | null;
    spec_match?: boolean | null; // v0.4: Layer 4 result
  };
  spec_match_details?: SpecMatchResult; // v0.4: Layer 4 details
}

/** Guardian validation result for all staged files. */
export interface ValidationResult {
  status: "pass" | "warn" | "fail";
  files: FileValidation[];
  summary: {
    total: number;
    passed: number;
    warned: number;
    failed: number;
  };
  mode: "strict" | "warn";
}

// ── Guardian Cache Types (Layers 1-3) ────────────────────────────────

/** Cache entry for Guardian metadata validation (Layers 1-3). */
export interface GuardianCacheEntry {
  file: string;
  change: string;
  hash: string; // SHA256 of file content
  result: "pass" | "warn" | "fail";
  timestamp: string;
  checks: {
    spec_exists: boolean;
    review_complete: boolean;
    mitigations_done: boolean;
  };
}

/** Guardian metadata cache structure (Layers 1-3). */
export interface GuardianCache {
  version: string;
  entries: Record<string, GuardianCacheEntry>;
}
