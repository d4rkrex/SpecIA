/**
 * Change state tracking types.
 * Maps to .specia/changes/{name}/state.yaml (Design Decision 2).
 *
 * v0.2: Added "design" to Phase and ArtifactType (Decision 9).
 * v0.3: Added "audit" to Phase and ArtifactType (spec-audit feature).
 */

/** Valid phases in the SpecIA workflow DAG. v0.3: includes optional "audit". */
export type Phase = "proposal" | "spec" | "design" | "review" | "tasks" | "audit";

/** Status of a phase. */
export type PhaseStatus = "complete" | "in-progress" | "failed";

/** Valid artifact types within a change directory. v0.3: includes "audit". */
export type ArtifactType = "proposal" | "spec" | "design" | "review" | "tasks" | "audit";

/** History entry in state.yaml — appended on each phase transition. */
export interface PhaseHistoryEntry {
  phase: Phase;
  status: PhaseStatus;
  timestamp: string; // ISO 8601
}

/** Audit policy for a change: "required" (default) or "skipped" (opt-out at propose time). */
export type AuditPolicy = "required" | "skipped";

/** Token estimation entry — records estimated and real token counts per phase. */
export interface TokenEstimate {
  phase: Phase;
  prompt_tokens_est: number;
  result_tokens_est?: number;
  timestamp: string; // ISO 8601
  /** v0.9: Estimated cost in USD (only populated when economics config is enabled). */
  estimated_cost_usd?: number;
  /** v0.9: Real token usage from LLM API response (CLI --api mode only). */
  actual_usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_tokens?: number; // Anthropic only
    cache_read_tokens?: number;     // Anthropic only
    total_tokens: number;
  };
  /** v0.9: Source of token data — "estimate" (heuristic) or "api" (real LLM API response). */
  source?: "estimate" | "api";
  /** v0.9: LLM model that produced this response (CLI --api mode only). */
  model?: string;
}

/**
 * Full state.yaml schema for a single change.
 *
 * Spec refs: Domain 5 (state.yaml Schema)
 * Design refs: Decision 2
 *
 * v0.5: Added audit_policy field for mandatory-audit gate.
 */
export interface ChangeState {
  change: string;
  phase: Phase;
  status: PhaseStatus;
  created: string; // ISO 8601
  updated: string; // ISO 8601
  phases_completed: Phase[];
  history: PhaseHistoryEntry[];
  /** SHA256 hash of spec.md at the time review was run. */
  review_hash?: string;
  /** Security posture used for the review. */
  review_posture?: string;
  /** v0.2: SHA256 hash of design.md at the time review was run. */
  design_hash?: string;
  /** v0.2: true if design.md changed after review was completed. */
  review_stale?: boolean;
  /** v0.3: SHA256 hash of audited code state at audit time. */
  audit_hash?: string;
  /** v0.3: Security posture used for the audit. */
  audit_posture?: string;
  /** v0.3: true if code changed after audit was completed. */
  audit_stale?: boolean;
  /** v0.5: Audit policy — "required" (default) or "skipped" (opt-out at propose time). Immutable after propose. */
  audit_policy?: AuditPolicy;
  /** v0.6: SHA256 hash of audit.md content at Phase 2 completion. Used for tamper detection (T-02). */
  audit_content_hash?: string;
  /** v0.6: Records that force flag was used during specia_done archival (D-01). */
  archived_with_force?: boolean;
  /** v0.8: Token estimation tracking — estimated token counts per phase. */
  token_estimates?: TokenEstimate[];
}

/** Summary info for listChanges() results. */
export interface ChangeInfo {
  name: string;
  phase: Phase;
  status: PhaseStatus;
  updated: string;
}
