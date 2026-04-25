/**
 * Security validation layer for SpecIA CLI
 * 
 * Foundation layer providing:
 * - Input validation and sanitization
 * - Path traversal prevention
 * - Safe YAML parsing
 * - Environment variable allowlisting
 * - Resource limits and rate limiting
 * 
 * Usage:
 * ```typescript
 * import { validatePath, sanitizeInput, validateYaml } from "./security/index.js";
 * 
 * // Validate user-provided path
 * const safePath = validatePath(userInput, process.cwd());
 * 
 * // Sanitize change name before database query
 * const cleanName = sanitizeInput(changeName, "change_name");
 * 
 * // Parse YAML config safely
 * const config = validateYaml(yamlContent, ConfigSchema);
 * ```
 */

export {
  validatePath,
  sanitizeInput,
  validateYaml,
  validateEnvVars,
  DEFAULT_ENV_ALLOWLIST,
  ValidationError,
} from "./validators.js";

export {
  FILE_LIMITS,
  DATABASE_LIMITS,
  LLM_LIMITS,
  RateLimiter,
  analyticsRateLimiter,
  llmRateLimiter,
  withTimeout,
  TimeoutError,
  RateLimitError,
} from "./limits.js";
