/**
 * Security validation layer for CLI inputs
 * 
 * Foundation layer implementing core security mitigations:
 * - REQ-MIT-001: Input sanitization (injection prevention)
 * - REQ-MIT-002: Path traversal prevention
 * - REQ-MIT-003: Safe YAML parsing
 * - REQ-MIT-008: Environment variable allowlist
 * 
 * Ref: .specia/changes/cli-mcp2cli-redesign/review.md
 * Findings: AC-001, AC-002, AC-003, T-02, T-03, ID-03, EOP-01
 */

import path from "path";
import fs from "fs";
import * as yaml from "yaml";
import { z } from "zod";

/**
 * Validates and sanitizes file paths to prevent traversal attacks
 * 
 * Mitigation: REQ-MIT-002, ID-03, AC-002
 * Findings: [ID-03] Path traversal in project_dir
 * 
 * @param inputPath - User-provided path (may be relative or absolute)
 * @param allowedBase - Base directory that path must be within
 * @returns Normalized safe path or throws ValidationError
 */
export function validatePath(inputPath: string, allowedBase: string): string {
  if (!inputPath || inputPath.trim() === "") {
    throw new ValidationError("Path cannot be empty");
  }

  // Resolve to absolute path
  const absolutePath = path.isAbsolute(inputPath)
    ? path.resolve(inputPath)
    : path.resolve(allowedBase, inputPath);

  // Normalize and resolve symlinks
  let normalizedPath: string;
  try {
    normalizedPath = fs.realpathSync(absolutePath);
  } catch {
    // Path doesn't exist yet - use path.resolve to normalize
    normalizedPath = path.resolve(absolutePath);
  }

  // Resolve allowedBase
  const normalizedBase = path.resolve(allowedBase);

  // Ensure path is within allowed base (prevent traversal)
  if (!normalizedPath.startsWith(normalizedBase)) {
    throw new ValidationError(
      `Path traversal detected: '${inputPath}' resolves outside allowed base '${allowedBase}'`
    );
  }

  // Block suspicious patterns
  const suspiciousPatterns = [
    /\.\./,           // parent directory references
    /~[\/\\]/,        // home directory expansion
    /\$\{/,           // variable expansion
    /\$\(/,           // command substitution
    /[<>|&;`]/,       // shell metacharacters
  ];

  for (const pattern of suspiciousPatterns) {
    if (pattern.test(inputPath)) {
      throw new ValidationError(
        `Suspicious pattern detected in path: '${inputPath}'`
      );
    }
  }

  return normalizedPath;
}

/**
 * Sanitizes string input to prevent injection attacks
 * 
 * Mitigation: REQ-MIT-001, AC-001, AC-002, T-02, EOP-01
 * Findings: [AC-001] SQL injection, [AC-002] Command injection, [T-02] Analytics SQL injection
 * 
 * Blocks:
 * - SQL injection patterns
 * - Shell metacharacters
 * - Command substitution
 * - Path traversal sequences
 * - Control characters
 * 
 * @param input - User-provided string
 * @param context - Context for error messages (e.g., "change_name", "config_name")
 * @returns Sanitized string or throws ValidationError
 */
export function sanitizeInput(input: string, context: string = "input"): string {
  if (typeof input !== "string") {
    throw new ValidationError(`${context} must be a string, got ${typeof input}`);
  }

  if (input.length === 0) {
    throw new ValidationError(`${context} cannot be empty`);
  }

  if (input.length > 255) {
    throw new ValidationError(`${context} exceeds maximum length of 255 characters`);
  }

  // Block SQL injection patterns
  const sqlPatterns = [
    /['";]/,                    // SQL string delimiters
    /--/,                       // SQL comments
    /\/\*/,                     // SQL block comments
    /\bOR\b/i,                  // SQL OR keyword
    /\bAND\b/i,                 // SQL AND keyword
    /\bDROP\b/i,                // SQL DROP
    /\bDELETE\b/i,              // SQL DELETE
    /\bUPDATE\b/i,              // SQL UPDATE
    /\bINSERT\b/i,              // SQL INSERT
    /\bSELECT\b/i,              // SQL SELECT
    /\bUNION\b/i,               // SQL UNION
    /\bEXEC\b/i,                // SQL EXEC
    /\bEXECUTE\b/i,             // SQL EXECUTE
    /\bCREATE\b/i,              // SQL CREATE
    /\bALTER\b/i,               // SQL ALTER
  ];

  for (const pattern of sqlPatterns) {
    if (pattern.test(input)) {
      throw new ValidationError(
        `${context} contains forbidden SQL pattern: '${input}'`
      );
    }
  }

  // Block shell metacharacters and command injection
  const shellMetachars = [
    /[;&|`$()]/,               // Shell command separators and substitution
    /\$\{/,                     // Variable expansion
    /\$\(/,                     // Command substitution
    /<\(/,                      // Process substitution
    />\(/,                      // Process substitution
  ];

  for (const pattern of shellMetachars) {
    if (pattern.test(input)) {
      throw new ValidationError(
        `${context} contains forbidden shell metacharacter: '${input}'`
      );
    }
  }

  // Block path traversal
  if (input.includes("..") || input.includes("./") || input.includes(".\\")) {
    throw new ValidationError(
      `${context} contains path traversal sequence: '${input}'`
    );
  }

  // Block control characters (except newlines in specific contexts)
  // eslint-disable-next-line no-control-regex
  const controlCharPattern = /[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/;
  if (controlCharPattern.test(input)) {
    throw new ValidationError(
      `${context} contains control characters: '${input}'`
    );
  }

  // Block null bytes
  if (input.includes("\0")) {
    throw new ValidationError(
      `${context} contains null byte: '${input}'`
    );
  }

  return input;
}

/**
 * Safe YAML parsing wrapper with code execution prevention
 * 
 * Mitigation: REQ-MIT-003, AC-003, T-03
 * Findings: [AC-003] YAML deserialization RCE, [T-03] YAML config injection
 * 
 * Features:
 * - Forces SAFE_SCHEMA (no !!js/function, !!js/undefined tags)
 * - Schema validation with Zod
 * - Size limits
 * 
 * @param content - YAML string to parse
 * @param schema - Optional Zod schema for validation
 * @param maxSizeBytes - Maximum allowed size (default 1MB)
 * @returns Parsed object or throws ValidationError
 */
export function validateYaml<T = unknown>(
  content: string,
  schema?: z.ZodType<T>,
  maxSizeBytes: number = 1024 * 1024
): T {
  if (!content || content.trim() === "") {
    throw new ValidationError("YAML content cannot be empty");
  }

  // Check size limit
  const sizeBytes = Buffer.byteLength(content, "utf8");
  if (sizeBytes > maxSizeBytes) {
    throw new ValidationError(
      `YAML content exceeds maximum size of ${maxSizeBytes} bytes (got ${sizeBytes})`
    );
  }

  // Parse with SAFE schema (no code execution)
  let parsed: unknown;
  try {
    // yaml.load() defaults to safe schema in yaml@2.x
    // Explicitly verify no custom tags
    if (content.includes("!!js/") || content.includes("!!python/")) {
      throw new ValidationError(
        "YAML content contains forbidden code execution tags (!!js/*, !!python/*)"
      );
    }

    parsed = yaml.parse(content, {
      strict: true,
      uniqueKeys: true,
      maxAliasCount: 100, // Prevent billion laughs attack
    });
  } catch (err) {
    throw new ValidationError(
      `Invalid YAML: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // Validate against schema if provided
  if (schema) {
    try {
      return schema.parse(parsed);
    } catch (err) {
      if (err instanceof z.ZodError) {
        throw new ValidationError(
          `YAML validation failed: ${err.errors.map(e => `${e.path.join(".")}: ${e.message}`).join(", ")}`
        );
      }
      throw new ValidationError(
        `YAML validation failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return parsed as T;
}

/**
 * Validates and filters environment variables against allowlist
 * 
 * Mitigation: REQ-MIT-008
 * Prevents arbitrary environment variable access that could leak secrets
 * 
 * @param env - Environment object to validate
 * @param allowlist - Array of allowed variable names (supports prefix wildcards like "SPECIA_*")
 * @returns Filtered environment object
 */
export function validateEnvVars(
  env: Record<string, string | undefined>,
  allowlist: string[]
): Record<string, string | undefined> {
  const filtered: Record<string, string | undefined> = {};

  for (const key of Object.keys(env)) {
    let allowed = false;

    for (const pattern of allowlist) {
      if (pattern.endsWith("*")) {
        // Prefix wildcard match
        const prefix = pattern.slice(0, -1);
        if (key.startsWith(prefix)) {
          allowed = true;
          break;
        }
      } else if (pattern === key) {
        // Exact match
        allowed = true;
        break;
      }
    }

    if (allowed) {
      filtered[key] = env[key];
    }
  }

  return filtered;
}

/**
 * Default environment variable allowlist for SpecIA
 * 
 * Includes:
 * - Standard tool config (EDITOR, PAGER, SHELL)
 * - LLM API keys (ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.)
 * - SpecIA specific variables (SPECIA_*)
 * - CI/CD indicators (CI, GITHUB_ACTIONS, etc.)
 */
export const DEFAULT_ENV_ALLOWLIST = [
  // Standard environment
  "HOME",
  "USER",
  "SHELL",
  "PATH",
  "EDITOR",
  "PAGER",
  "TERM",
  "LANG",
  "LC_*",
  
  // LLM API keys
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "GEMINI_API_KEY",
  
  // SpecIA specific
  "SPECIA_*",
  
  // CI/CD indicators
  "CI",
  "CONTINUOUS_INTEGRATION",
  "GITHUB_ACTIONS",
  "GITLAB_CI",
  "JENKINS_HOME",
  "CIRCLECI",
  "TRAVIS",
  
  // Node.js
  "NODE_ENV",
  "NODE_OPTIONS",
];

/**
 * Custom error class for validation failures
 */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
    Error.captureStackTrace(this, ValidationError);
  }
}
