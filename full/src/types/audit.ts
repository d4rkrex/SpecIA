/**
 * Audit types — post-implementation code verification.
 *
 * Spec refs: Domain 1 (Audit Types), Domain 2 (AuditPrompt Interface)
 * Design refs: Decision 6 (AuditResult type hierarchy — flat, spec-aligned)
 *
 * v0.3: New file for /spec-audit feature.
 */

import type { SecurityPosture } from "./config.js";

// ── Verdict Types ────────────────────────────────────────────────────

/** Per-requirement audit verdict. */
export type RequirementVerdict = "pass" | "fail" | "partial" | "skipped";

/** Per-abuse-case verification verdict. */
export type AbuseCaseVerdict = "verified" | "unverified" | "partial" | "not_applicable";

/** Overall audit verdict. */
export type OverallVerdict = "pass" | "fail" | "partial";

// ── Verification Interfaces ──────────────────────────────────────────

/** Per-requirement audit result. */
export interface RequirementVerification {
  /** Requirement ID or name from spec (e.g., "REQ-001" or requirement title). */
  requirement_id: string;
  verdict: RequirementVerdict;
  /** What code satisfies (or fails) this requirement. */
  evidence: string;
  /** file:line references to relevant code. */
  code_references: string[];
  /** What's missing or incomplete. */
  gaps: string[];
  /** Additional context. */
  notes: string;
}

/** Per-abuse-case audit result. */
export interface AbuseCaseVerification {
  /** Matches AbuseCase.id from review (e.g., "AC-001"). */
  abuse_case_id: string;
  verdict: AbuseCaseVerdict;
  /** What code addresses this abuse case. */
  evidence: string;
  /** file:line references. */
  code_references: string[];
  /** What's missing. */
  gaps: string[];
  /** Impact of leaving unverified. */
  risk_if_unaddressed: string;
}

// ── Coverage & Summary ───────────────────────────────────────────────

/** Aggregate requirement counts. */
export interface RequirementsCoverage {
  total: number;
  passed: number;
  failed: number;
  partial: number;
  skipped: number;
}

/** Aggregate abuse case counts. */
export interface AbuseCasesCoverage {
  total: number;
  verified: number;
  unverified: number;
  partial: number;
  not_applicable: number;
}

/** Aggregate audit counts and overall verdict. */
export interface AuditSummary {
  overall_verdict: OverallVerdict;
  requirements_coverage: RequirementsCoverage;
  abuse_cases_coverage: AbuseCasesCoverage;
  /** Assessed risk of unaddressed items. */
  risk_level: "low" | "medium" | "high" | "critical";
  /** Action items for failed/partial items. */
  recommendations: string[];
}

// ── Top-Level Result ─────────────────────────────────────────────────

/** Top-level audit result — produced by validateAuditResult(). */
export interface AuditResult {
  change: string;
  posture: SecurityPosture;
  timestamp: string; // ISO 8601
  spec_hash: string;
  audit_hash: string;
  requirements: RequirementVerification[];
  abuse_cases: AbuseCaseVerification[];
  summary: AuditSummary;
}

// ── Prompt Types ─────────────────────────────────────────────────────

/** Prompt constructed by the audit engine for the agent's LLM. */
export interface AuditPrompt {
  system_instructions: string;
  analysis_request: string;
  output_schema: object;
  context: {
    project_description: string;
    stack: string;
    change_name: string;
    spec_content: string;
    review_content?: string;
    design_content?: string;
    proposal_content?: string;
  };
}

/** Code file with estimated token count. */
export interface CodeFile {
  path: string;
  content: string;
  /** Estimated tokens: ceil(chars / 4). */
  tokens: number;
}
