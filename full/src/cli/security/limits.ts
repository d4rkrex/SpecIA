/**
 * Resource limits and rate limiting constants
 * 
 * Foundation layer for DoS prevention and resource management:
 * - File size and count limits
 * - Database size limits
 * - API rate limiting
 * - Execution timeouts
 * 
 * Ref: .specia/changes/cli-mcp2cli-redesign/review.md
 * Findings: [DOS-01] Analytics database bloat, [DOS-02] LLM API quota exhaustion
 */

/**
 * File and directory limits
 */
export const FILE_LIMITS = {
  /** Maximum size for a single file read (10MB) */
  MAX_FILE_SIZE_BYTES: 10 * 1024 * 1024,
  
  /** Maximum size for YAML config files (1MB) */
  MAX_YAML_SIZE_BYTES: 1024 * 1024,
  
  /** Maximum number of files to process in batch operations */
  MAX_FILES_COUNT: 50,
  
  /** Maximum total size for audit file collection (100MB) */
  MAX_AUDIT_TOTAL_SIZE_BYTES: 100 * 1024 * 1024,
  
  /** Maximum line length in text files (avoid memory exhaustion) */
  MAX_LINE_LENGTH: 10_000,
} as const;

/**
 * Database limits
 * Mitigation: DOS-01 (Analytics database bloat)
 */
export const DATABASE_LIMITS = {
  /** Maximum database size before rotation required (100MB) */
  MAX_DB_SIZE_BYTES: 100 * 1024 * 1024,
  
  /** Maximum number of history databases to keep */
  MAX_HISTORY_FILES: 5,
  
  /** Maximum operations to store per change */
  MAX_OPERATIONS_PER_CHANGE: 1000,
  
  /** Auto-vacuum threshold (trigger cleanup at 80% capacity) */
  VACUUM_THRESHOLD_RATIO: 0.8,
} as const;

/**
 * LLM API rate limits
 * Mitigation: DOS-02 (LLM API quota exhaustion via debate loops)
 */
export const LLM_LIMITS = {
  /** Hard cap on debate rounds regardless of user input */
  MAX_DEBATE_ROUNDS: 5,
  
  /** Maximum concurrent LLM requests */
  MAX_CONCURRENT_REQUESTS: 3,
  
  /** Request timeout in milliseconds (2 minutes) */
  REQUEST_TIMEOUT_MS: 2 * 60 * 1000,
  
  /** Maximum prompt size in tokens (approximation) */
  MAX_PROMPT_TOKENS: 100_000,
  
  /** Maximum retry attempts on rate limit errors */
  MAX_RETRY_ATTEMPTS: 3,
  
  /** Backoff delay in ms (exponential: delay * 2^attempt) */
  RETRY_BACKOFF_MS: 1000,
} as const;

/**
 * Token usage tracking for rate limiting
 * 
 * Simple in-memory rate limiter for analytics tracking.
 * Prevents excessive operations in short time windows.
 */
export class RateLimiter {
  private operations: Map<string, number[]> = new Map();
  
  constructor(
    private readonly maxOperations: number,
    private readonly windowMs: number
  ) {}
  
  /**
   * Check if operation is allowed under rate limit
   * 
   * @param key - Operation identifier (e.g., "analytics:track")
   * @returns true if allowed, false if rate limited
   */
  isAllowed(key: string): boolean {
    const now = Date.now();
    const timestamps = this.operations.get(key) ?? [];
    
    // Remove expired timestamps outside the window (DOS-002 mitigation: periodic cleanup)
    const validTimestamps = timestamps.filter(ts => now - ts < this.windowMs);
    
    // DOS-002 mitigation: Cap array size to prevent unbounded growth
    const MAX_TIMESTAMPS_PER_KEY = 1000;
    if (validTimestamps.length > MAX_TIMESTAMPS_PER_KEY) {
      validTimestamps.splice(0, validTimestamps.length - MAX_TIMESTAMPS_PER_KEY);
    }
    
    if (validTimestamps.length >= this.maxOperations) {
      return false;
    }
    
    // Record new operation
    validTimestamps.push(now);
    this.operations.set(key, validTimestamps);
    
    return true;
  }
  
  /**
   * Get time until next operation is allowed (in ms)
   * Returns 0 if operation is currently allowed
   */
  timeUntilAllowed(key: string): number {
    const now = Date.now();
    const timestamps = this.operations.get(key) ?? [];
    
    if (timestamps.length < this.maxOperations) {
      return 0;
    }
    
    // Find oldest timestamp in window
    const oldestInWindow = timestamps[0];
    if (!oldestInWindow) {
      return 0;
    }
    
    const timeElapsed = now - oldestInWindow;
    
    if (timeElapsed >= this.windowMs) {
      return 0;
    }
    
    return this.windowMs - timeElapsed;
  }
  
  /**
   * Reset rate limit for a specific key
   */
  reset(key: string): void {
    this.operations.delete(key);
  }
  
  /**
   * Clear all rate limit tracking
   */
  resetAll(): void {
    this.operations.clear();
  }
}

/**
 * Default rate limiters for different operation types
 */

/** Analytics tracking rate limiter: 100 ops per minute */
export const analyticsRateLimiter = new RateLimiter(
  100, // max operations
  60 * 1000 // 1 minute window
);

/** LLM API rate limiter: 10 requests per minute */
export const llmRateLimiter = new RateLimiter(
  10, // max operations
  60 * 1000 // 1 minute window
);

/**
 * MCP Tool Rate Limits
 * 
 * Per-tool rate limits based on computational cost.
 * Mitigation: DOS-001 (MCP Tool Invocation Flood)
 * 
 * Tiering (R2 requirement):
 * - Cheap tools (status, search, hooks): 60/min
 * - Standard tools (propose, spec, tasks, done): 30/min
 * - Expensive tools (review, audit, debate): 10/min
 */
export const TOOL_RATE_LIMITS: Record<string, { maxOps: number; windowMs: number }> = {
  // Expensive tools - LLM-intensive operations
  'specia_review': { maxOps: 10, windowMs: 60 * 1000 },
  'specia_audit': { maxOps: 10, windowMs: 60 * 1000 },
  'specia_debate': { maxOps: 10, windowMs: 60 * 1000 },
  
  // Standard tools - file I/O and processing
  'specia_propose': { maxOps: 30, windowMs: 60 * 1000 },
  'specia_spec': { maxOps: 30, windowMs: 60 * 1000 },
  'specia_design': { maxOps: 30, windowMs: 60 * 1000 },
  'specia_tasks': { maxOps: 30, windowMs: 60 * 1000 },
  'specia_done': { maxOps: 30, windowMs: 60 * 1000 },
  'specia_init': { maxOps: 30, windowMs: 60 * 1000 },
  'specia_ff': { maxOps: 30, windowMs: 60 * 1000 },
  'specia_continue': { maxOps: 30, windowMs: 60 * 1000 },
  'specia_new': { maxOps: 30, windowMs: 60 * 1000 }, // Alias for propose
  
  // Cheap tools - read-only operations
  'specia_search': { maxOps: 60, windowMs: 60 * 1000 },
  'specia_hook_status': { maxOps: 60, windowMs: 60 * 1000 },
  'specia_hook_install': { maxOps: 60, windowMs: 60 * 1000 },
  'specia_hook_uninstall': { maxOps: 60, windowMs: 60 * 1000 },
  'specia_stats': { maxOps: 60, windowMs: 60 * 1000 },
} as const;

/**
 * Get rate limit configuration for a tool
 * EP-001 mitigation: Resolve aliases to canonical tool names
 */
export function getToolRateLimit(toolName: string): { maxOps: number; windowMs: number } {
  // EP-001: specia_new is an alias for specia_propose
  const canonicalName = toolName === 'specia_new' ? 'specia_propose' : toolName;
  
  return TOOL_RATE_LIMITS[canonicalName] ?? { maxOps: 30, windowMs: 60 * 1000 };
}

/** 
 * Global MCP tool rate limiter
 * Shared instance for all tool invocations
 * DOS-001 mitigation: Enforce rate limits on MCP tool invocations
 */
export const mcpToolRateLimiter = new RateLimiter(
  1000, // Global ceiling: 1000 ops/min across all tools
  60 * 1000
);

/**
 * Execution timeout helpers
 */

/**
 * Wraps a promise with a timeout
 * 
 * @param promise - Promise to execute
 * @param timeoutMs - Timeout in milliseconds
 * @param errorMessage - Custom error message on timeout
 * @returns Promise that rejects on timeout
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage: string = `Operation timed out after ${timeoutMs}ms`
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new TimeoutError(errorMessage)), timeoutMs);
    }),
  ]);
}

/**
 * Custom error for timeout violations
 */
export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
    Error.captureStackTrace(this, TimeoutError);
  }
}

/**
 * Custom error for rate limit violations
 */
export class RateLimitError extends Error {
  constructor(
    message: string,
    public readonly retryAfterMs: number
  ) {
    super(message);
    this.name = "RateLimitError";
    Error.captureStackTrace(this, RateLimitError);
  }
}
