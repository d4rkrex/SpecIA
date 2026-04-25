/**
 * Security validation utilities
 * 
 * Implements all input validation and sanitization mitigations from security review.
 * REF: .specia/changes/cli-mcp2cli-redesign/review.md
 */

import path from "path";
import fs from "fs";

/**
 * Validates change name against strict pattern
 * Mitigation: T-02 (SQL injection), AC-001
 * Pattern: ^[a-z0-9]+(-[a-z0-9]+)*$
 */
export function validateChangeName(name: string): { valid: boolean; error?: string } {
  const pattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;
  
  if (!pattern.test(name)) {
    return {
      valid: false,
      error: `Invalid change name '${name}'. Must match pattern: ^[a-z0-9]+(-[a-z0-9]+)*$`
    };
  }
  
  return { valid: true };
}

/**
 * Validates baked config name against strict pattern
 * Mitigation: EOP-01 (Command injection), AC-002
 * Pattern: ^[a-z0-9-]+$
 */
export function validateBakedConfigName(name: string): { valid: boolean; error?: string } {
  const pattern = /^[a-z0-9-]+$/;
  
  if (!pattern.test(name)) {
    return {
      valid: false,
      error: `Invalid baked config name '${name}'. Must match pattern: ^[a-z0-9-]+$ (no special characters, shell metacharacters, or @prefix)`
    };
  }
  
  return { valid: true };
}

/**
 * Validates and normalizes project directory path
 * Mitigation: ID-03 (Path traversal)
 * 
 * Requirements:
 * - Must be absolute path
 * - Resolve symlinks
 * - Directory must exist and be readable
 */
export function validateProjectDir(dir: string): { valid: boolean; normalizedPath?: string; error?: string } {
  // Must be absolute
  if (!path.isAbsolute(dir)) {
    return {
      valid: false,
      error: `Project directory must be absolute path, got: ${dir}`
    };
  }
  
  // Resolve symlinks
  let normalizedPath: string;
  try {
    normalizedPath = fs.realpathSync(dir);
  } catch (err) {
    return {
      valid: false,
      error: `Failed to resolve path '${dir}': ${err instanceof Error ? err.message : String(err)}`
    };
  }
  
  // Must exist
  if (!fs.existsSync(normalizedPath)) {
    return {
      valid: false,
      error: `Directory does not exist: ${normalizedPath}`
    };
  }
  
  // Must be directory
  const stat = fs.statSync(normalizedPath);
  if (!stat.isDirectory()) {
    return {
      valid: false,
      error: `Path is not a directory: ${normalizedPath}`
    };
  }
  
  // Check readable (access check)
  try {
    fs.accessSync(normalizedPath, fs.constants.R_OK);
  } catch {
    return {
      valid: false,
      error: `Directory is not readable: ${normalizedPath}`
    };
  }
  
  return { valid: true, normalizedPath };
}

/**
 * Sanitizes field value for secret detection
 * Mitigation: ID-01 (Secrets exposure in baked configs)
 * 
 * Detects plaintext secrets and enforces env: prefix for sensitive fields
 */
export function sanitizeSecretField(fieldName: string, value: string, sensitiveFields: string[] = ['api_key', 'token', 'password', 'secret']): { valid: boolean; error?: string } {
  const isSensitive = sensitiveFields.some(field => fieldName.toLowerCase().includes(field));
  
  if (!isSensitive) {
    return { valid: true };
  }
  
  // Sensitive field must use env: prefix
  if (!value.startsWith('env:')) {
    return {
      valid: false,
      error: `Sensitive field '${fieldName}' must use env: prefix (e.g., env:ANTHROPIC_API_KEY). Got plaintext value.`
    };
  }
  
  return { valid: true };
}

/**
 * Masks secret values in output
 * Mitigation: ID-01 (Secrets exposure in baked configs)
 */
export function maskSecret(value: string): string {
  if (value.startsWith('env:')) {
    return value; // env references are safe
  }
  return '***';
}

/**
 * Sanitizes file path to relative path only
 * Mitigation: ID-02 (Source code leakage in analytics export)
 */
export function sanitizeFilePath(absolutePath: string, projectRoot: string): string {
  if (absolutePath.startsWith(projectRoot)) {
    return path.relative(projectRoot, absolutePath);
  }
  // If outside project root, return basename only
  return path.basename(absolutePath);
}

/**
 * Hard-caps debate rounds regardless of input
 * Mitigation: DOS-02 (LLM API quota exhaustion)
 */
export const MAX_DEBATE_ROUNDS = 5;

export function capDebateRounds(userInput: number): number {
  return Math.min(userInput, MAX_DEBATE_ROUNDS);
}

/**
 * Database size limits
 * Mitigation: DOS-01 (Analytics database bloat)
 */
export const MAX_DB_SIZE_BYTES = 100 * 1024 * 1024; // 100MB

export function checkDatabaseSize(dbPath: string): { withinLimit: boolean; currentSize: number; maxSize: number } {
  if (!fs.existsSync(dbPath)) {
    return { withinLimit: true, currentSize: 0, maxSize: MAX_DB_SIZE_BYTES };
  }
  
  const stat = fs.statSync(dbPath);
  return {
    withinLimit: stat.size < MAX_DB_SIZE_BYTES,
    currentSize: stat.size,
    maxSize: MAX_DB_SIZE_BYTES
  };
}
