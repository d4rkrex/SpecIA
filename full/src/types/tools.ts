/**
 * Tool response envelope and error types.
 * All SpecIA tools return ToolResponse<T>.
 *
 * Spec refs: Domain 9 (Response Envelope, Error Code Catalog)
 * Design refs: Decision 6
 */

/** Structured error object in tool responses. */
export interface ToolError {
  code: string;
  message: string;
  /** Which input field caused the error (for VALIDATION_ERROR). */
  field?: string;
  /** Which prior phase is missing (for MISSING_DEPENDENCY). */
  dependency?: string;
  /** Time in milliseconds until operation can be retried (for RATE_LIMIT_EXCEEDED). */
  retryAfterMs?: number;
  /** Additional details. */
  details?: unknown;
}

/** Metadata included in every tool response. */
export interface ToolMeta {
  tool: string;
  change?: string;
  duration_ms: number;
  cache_hit?: boolean;
  /** Estimated tokens in generated prompt (Phase 1 of two-phase tools). */
  prompt_tokens_est?: number;
  /** Estimated tokens in received result (Phase 2 of two-phase tools). */
  result_tokens_est?: number;
  /** v0.9: Estimated cost in USD for this phase (only when economics config is enabled). */
  estimated_cost_usd?: number;
}

/**
 * Universal response envelope for all SpecIA tools.
 *
 * Spec refs: Domain 9 (Successful response, Error response)
 */
export interface ToolResponse<T = unknown> {
  status: "success" | "error" | "cached";
  data: T | null;
  errors: ToolError[];
  warnings: string[];
  meta: ToolMeta;
}

/**
 * Convenience type alias: handlers that return either success data T or error (null).
 */
export type ToolResult<T> = ToolResponse<T | null>;

/**
 * All error codes used across SpecIA tools.
 *
 * Spec refs: Domain 9 (Error Code Catalog — all 12 codes)
 * v0.2: 8 new error codes (Design Phase, Guardian, CLI)
 */
export const ErrorCodes = {
  // v0.1 codes
  VALIDATION_ERROR: "VALIDATION_ERROR",
  NOT_INITIALIZED: "NOT_INITIALIZED",
  ALREADY_INITIALIZED: "ALREADY_INITIALIZED",
  CHANGE_EXISTS: "CHANGE_EXISTS",
  CHANGE_NOT_FOUND: "CHANGE_NOT_FOUND",
  MISSING_DEPENDENCY: "MISSING_DEPENDENCY",
  REVIEW_REQUIRED: "REVIEW_REQUIRED",
  REVIEW_STALE: "REVIEW_STALE",
  INCOMPLETE_CHANGE: "INCOMPLETE_CHANGE",
  INVALID_CONFIG: "INVALID_CONFIG",
  IO_ERROR: "IO_ERROR",
  ALEJANDRIA_UNAVAILABLE: "ALEJANDRIA_UNAVAILABLE",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  // v0.2 codes — Design Phase
  DESIGN_NOT_FOUND: "DESIGN_NOT_FOUND",
  // v0.2 codes — Guardian Hook
  NOT_GIT_REPO: "NOT_GIT_REPO",
  HOOK_INSTALL_FAILED: "HOOK_INSTALL_FAILED",
  GUARDIAN_VALIDATION_FAILED: "GUARDIAN_VALIDATION_FAILED",
  // v0.2 codes — CLI
  LLM_NOT_CONFIGURED: "LLM_NOT_CONFIGURED",
  LLM_API_ERROR: "LLM_API_ERROR",
  INVALID_REVIEW_RESULT: "INVALID_REVIEW_RESULT",
  EDITOR_ERROR: "EDITOR_ERROR",
  // v0.3 codes — Audit Phase
  TASKS_NOT_COMPLETE: "TASKS_NOT_COMPLETE",
  // v0.5 codes — Mandatory Audit Gate
  AUDIT_REQUIRED: "AUDIT_REQUIRED",
  // v0.6 codes — fix-empty-audit
  ZERO_FILES_DISCOVERED: "ZERO_FILES_DISCOVERED",
  AUDIT_CONTENT_INSUFFICIENT: "AUDIT_CONTENT_INSUFFICIENT",
  AUDIT_HASH_MISMATCH: "AUDIT_HASH_MISMATCH",
  // v2.0 codes — add-api-rate-limiting
  RATE_LIMIT_EXCEEDED: "RATE_LIMIT_EXCEEDED",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

// ── Token estimation ────────────────────────────────────────────────

/**
 * Estimate token count from text or object content.
 * Uses ceil(chars/4) heuristic matching Anthropic's approximation.
 * Already proven in audit.ts (line 481).
 */
export function estimateTokens(content: string | object): number {
  const text = typeof content === "string" ? content : JSON.stringify(content);
  return Math.ceil(text.length / 4);
}

/**
 * v0.9: Calculate estimated cost in USD from token counts and economics config.
 * Returns undefined if economics is not configured or not enabled.
 * Result is rounded to 6 decimal places.
 */
export function calculateEstimatedCost(
  promptTokens: number,
  resultTokens: number,
  economics: { enabled: boolean; input_cpt: number; output_cpt: number } | undefined,
): number | undefined {
  if (!economics?.enabled) return undefined;
  const cost = (promptTokens * economics.input_cpt) + (resultTokens * economics.output_cpt);
  return Math.round(cost * 1000000) / 1000000; // 6 decimal places
}

// ── Helper constructors ─────────────────────────────────────────────

/** Create a success response. */
export function ok<T>(
  tool: string,
  data: T,
  opts?: {
    change?: string;
    duration_ms?: number;
    warnings?: string[];
    prompt_tokens_est?: number;
    result_tokens_est?: number;
    estimated_cost_usd?: number;
  },
): ToolResponse<T> {
  return {
    status: "success",
    data,
    errors: [],
    warnings: opts?.warnings ?? [],
    meta: {
      tool,
      change: opts?.change,
      duration_ms: opts?.duration_ms ?? 0,
      ...(opts?.prompt_tokens_est !== undefined && { prompt_tokens_est: opts.prompt_tokens_est }),
      ...(opts?.result_tokens_est !== undefined && { result_tokens_est: opts.result_tokens_est }),
      ...(opts?.estimated_cost_usd !== undefined && { estimated_cost_usd: opts.estimated_cost_usd }),
    },
  };
}

/** Create an error response. */
export function fail(
  tool: string,
  errors: ToolError[],
  opts?: {
    change?: string;
    duration_ms?: number;
    warnings?: string[];
    prompt_tokens_est?: number;
    result_tokens_est?: number;
    estimated_cost_usd?: number;
  },
): ToolResponse<null> {
  return {
    status: "error",
    data: null,
    errors,
    warnings: opts?.warnings ?? [],
    meta: {
      tool,
      change: opts?.change,
      duration_ms: opts?.duration_ms ?? 0,
      ...(opts?.prompt_tokens_est !== undefined && { prompt_tokens_est: opts.prompt_tokens_est }),
      ...(opts?.result_tokens_est !== undefined && { result_tokens_est: opts.result_tokens_est }),
      ...(opts?.estimated_cost_usd !== undefined && { estimated_cost_usd: opts.estimated_cost_usd }),
    },
  };
}
