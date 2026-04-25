/**
 * Security review types — STRIDE, OWASP, DREAD.
 *
 * Spec refs: Domain 6 (Three Depth Levels, Review Output Structure)
 * Design refs: Decision 3 (SecurityReview, Threat, OwaspMapping, DreadScore)
 */

import type { SecurityPosture } from "./config.js";

/** Individual threat identified during STRIDE analysis. */
export interface Threat {
  /** e.g., "S-01" */
  id: string;
  title: string;
  description: string;
  severity: "low" | "medium" | "high" | "critical";
  mitigation: string;
  affected_components: string[];
}

/** STRIDE category analysis result. */
export interface ThreatCategory {
  applicable: boolean;
  threats: Threat[];
}

/** OWASP Top 10 mapping entry (elevated + paranoid). */
export interface OwaspMapping {
  /** e.g., "A01:2021" */
  owasp_id: string;
  /** e.g., "Broken Access Control" */
  owasp_name: string;
  /** STRIDE threat IDs that map to this category. */
  related_threats: string[];
  applicable: boolean;
}

/** DREAD score per threat (paranoid only). */
export interface DreadScore {
  threat_id: string;
  damage: number; // 1-10
  reproducibility: number; // 1-10
  exploitability: number; // 1-10
  affected_users: number; // 1-10
  discoverability: number; // 1-10
  total: number; // average
}

/** Abuse case — attacker-centric scenario derived from STRIDE analysis. */
export interface AbuseCase {
  /** e.g., "AC-001", "AC-002" */
  id: string;
  severity: "critical" | "high" | "medium" | "low";
  /** Short description of the abuse case. */
  title: string;
  /** "As an attacker, I want to..." */
  attacker_goal: string;
  /** How the attack would work. */
  technique: string;
  /** What must be true for this attack to succeed. */
  preconditions: string[];
  /** What happens if the attack succeeds. */
  impact: string;
  /** How to prevent this attack. */
  mitigation: string;
  /** Which STRIDE category this maps to. */
  stride_category: string;
  /** Whether this can be automated as a security test. */
  testable: boolean;
  /** How to test this (for future /spec-audit). Present for paranoid posture. */
  test_hint?: string;
}

/** Review summary for frontmatter and task generation. */
export interface ReviewSummary {
  risk_level: "low" | "medium" | "high" | "critical";
  total_findings: number;
  critical_findings: number;
  mitigations_required: string[];
}

/** STRIDE analysis categories. */
export interface StrideAnalysis {
  spoofing: ThreatCategory;
  tampering: ThreatCategory;
  repudiation: ThreatCategory;
  information_disclosure: ThreatCategory;
  denial_of_service: ThreatCategory;
  elevation_of_privilege: ThreatCategory;
}

/**
 * Full security review result.
 *
 * Spec refs: Domain 6 (Machine-parseable review)
 * Design refs: Decision 3
 */
export interface SecurityReview {
  change: string;
  posture: SecurityPosture;
  timestamp: string; // ISO 8601
  spec_hash: string; // SHA256 of spec.md at review time

  stride: StrideAnalysis;

  /** Only present for elevated / paranoid. */
  owasp_mapping?: OwaspMapping[];

  /** Only present for paranoid. */
  dread_scores?: DreadScore[];

  /** Abuse cases derived from the security analysis. */
  abuse_cases: AbuseCase[];

  summary: ReviewSummary;
}

/** Prompt constructed by the review engine for the agent's LLM. */
export interface ReviewPrompt {
  system_instructions: string;
  analysis_request: string;
  output_schema: object;
  /**
   * Context metadata for the review prompt.
   * Token optimization: full content is in analysis_request only.
   * I-01: uses generic field names to avoid leaking internal API structure.
   */
  context: {
    change_name: string;
    stack: string;
    has_proposal: boolean;
    has_design: boolean;
    has_past_findings?: boolean;
  };
}
