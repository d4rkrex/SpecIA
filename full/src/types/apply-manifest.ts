/**
 * Apply Manifest types — multi-agent apply orchestration.
 *
 * Defines the schema for apply-manifest.yaml, which controls how the
 * orchestrator spawns workers during the apply phase.
 *
 * Inspired by Colmena's mission manifest + threat-model-remediation pattern.
 *
 * SpecIA T-01: Manifest integrity via tasks_hash
 * SpecIA E-01: Sensitive path exclusion via RESTRICTED_PATH_PATTERNS
 * SpecIA D-01: Worker cap at MAX_PARALLEL_WORKERS
 */

/** Apply pattern — controls single vs multi-worker execution. */
export type ApplyPattern = "sequential" | "fan-out";

/**
 * A group of tasks with exclusive file ownership.
 * Workers receive exactly one group and may only modify files_owned.
 */
export interface TaskGroup {
  /** Unique group identifier (e.g., "group-1", "group-orchestrator"). */
  group_id: string;
  /** Files this worker group owns exclusively. Glob patterns supported. */
  files_owned: string[];
  /** Task identifiers from tasks.md assigned to this group. */
  tasks: string[];
  /** Paths the worker MUST NOT modify. Always includes .specia/. */
  forbidden_paths: string[];
}

/**
 * Apply manifest — generated after tasks.md, read by orchestrator.
 *
 * Schema for .specia/changes/{name}/apply-manifest.yaml
 */
export interface ApplyManifest {
  /** Schema version for forward compatibility. */
  schema_version: "1.0";
  /** Change name this manifest belongs to. */
  change_name: string;
  /** Apply pattern: "sequential" (single worker) or "fan-out" (parallel). */
  pattern: ApplyPattern;
  /** Task groups with exclusive file ownership. */
  groups: TaskGroup[];
  /** Maximum parallel workers allowed. */
  max_workers: number;
  /** SHA256 hash of tasks.md content — integrity check (SpecIA T-01). */
  tasks_hash: string;
  /** SHA256 hash of review.md — tamper detection (SpecIA E-01). */
  review_hash: string;
  /** Paths restricted from ALL workers — only orchestrator may touch. */
  restricted_paths: string[];
  /** ISO 8601 timestamp of manifest generation. */
  generated_at: string;
  /** Optional: Colmena role IDs for runtime permission enforcement (R-007). */
  colmena_roles?: Record<string, string>;
}

// SpecIA D-01: Cap parallel workers to prevent token exhaustion
export const MAX_PARALLEL_WORKERS = 5;

// SpecIA E-01: Sensitive paths excluded from worker ownership
export const RESTRICTED_PATH_PATTERNS = [
  ".specia/",
  ".specia/**",
  "*.env",
  ".env*",
  "*secret*",
  "*credential*",
  "*auth-config*",
  "*.key",
  "*.pem",
  "*.p12",
  "*.pfx",
] as const;

/**
 * Default forbidden paths injected into every worker group.
 * SpecIA E-01: Workers must never modify .specia/ artifacts.
 */
export const DEFAULT_FORBIDDEN_PATHS = [
  ".specia/",
  ".specia/**",
] as const;
