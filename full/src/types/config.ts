/**
 * VT-Spec configuration types.
 * Maps to .vtspec/config.yaml schema (Design Decision 2).
 *
 * v0.2: Added GuardianConfig, CliConfig, WorkflowConfig (Decisions 15, 18, 9).
 */

/** Security posture controls review depth, not whether review happens. */
export type SecurityPosture = "standard" | "elevated" | "paranoid";

/** Memory backend — Alejandria/Engram enhance but are never required. */
export type MemoryBackend = "alejandria" | "engram" | "local" | "auto";

/** Guardian hook validation mode. */
export type GuardianMode = "strict" | "warn";

/** LLM provider for CLI review. */
export type LlmProvider = "anthropic" | "openai";

/** Memory configuration block in config.yaml. */
export interface MemoryConfig {
  backend: MemoryBackend;
  /** Command to spawn Alejandria MCP server (when backend is "alejandria"). */
  alejandria_cmd?: string;
}

/** Security configuration block in config.yaml. */
export interface SecurityConfig {
  posture: SecurityPosture;
}

/** Project configuration block in config.yaml. */
export interface ProjectConfig {
  name: string;
  description: string;
  stack: string;
  conventions: string[];
}

/**
 * v0.4: Guardian spec-aware validation configuration (Layer 4).
 * Optional — absent means Layer 4 disabled.
 */
export interface GuardianSpecValidationConfig {
  /** Enable Layer 4a + 4b (both heuristics and LLM). Default: false. */
  enabled?: boolean;
  /** Disable Layer 4b (heuristics-only mode). Default: false. */
  enable_layer4?: boolean;
  /** Enable LLM validation (Layer 4b). Default: false. */
  enable_llm?: boolean;
  /** LLM provider for Layer 4b. Default: 'anthropic'. */
  llm_provider?: "anthropic" | "openai";
  /** LLM model for Layer 4b. Default: 'claude-3-5-haiku-20241022'. */
  llm_model?: string;
  /** Max tokens for Layer 4b prompt. Default: 10000. */
  llm_budget?: number;
  /** Cache TTL in hours. Default: 168 (7 days). */
  cache_ttl?: number;
  /** Heuristic confidence threshold (0-1). Default: 0.5. */
  heuristic_threshold?: number;
}

/**
 * v0.2: Guardian pre-commit hook configuration (Design Decision 15).
 * Controls spec compliance enforcement at commit time.
 * v0.4: Added optional spec_validation for Layer 4.
 */
export interface GuardianConfig {
  enabled: boolean;
  mode: GuardianMode;
  exclude: string[];
  validation: {
    require_spec: boolean;
    require_review: boolean;
    require_mitigations: boolean;
  };
  /** v0.4: Strict mode enforces spec-aware validation. Optional — absent means disabled. */
  strict_mode?: boolean;
  /** v0.4: Spec-aware validation (Layer 4). Optional — absent means disabled. */
  spec_validation?: GuardianSpecValidationConfig;
}

/**
 * v0.2: LLM provider configuration for CLI review (Design Decision 19).
 */
export interface LlmProviderConfig {
  provider: LlmProvider;
  model?: string;
  api_key_env: string;
}

/**
 * v0.2: CLI configuration block (Design Decision 18).
 */
export interface CliConfig {
  editor?: string;
  llm?: LlmProviderConfig;
}

/**
 * v0.2: Workflow configuration (Design Decision 9).
 */
export interface WorkflowConfig {
  include_design: boolean;
}

/**
 * v0.9: Token economics configuration (Phase 3).
 * Optional — when absent or disabled, no cost estimation is performed.
 * Pricing is per-token in USD. Use model provider's published rates.
 */
export interface EconomicsConfig {
  enabled: boolean;
  /** Cost per input token in USD (e.g. 0.000003 = $3/1M tokens). */
  input_cpt: number;
  /** Cost per output token in USD (e.g. 0.000015 = $15/1M tokens). */
  output_cpt: number;
  /** Multiplier for cache write tokens relative to input_cpt (default 1.25). */
  cache_write_ratio?: number;
  /** Multiplier for cache read tokens relative to input_cpt (default 0.1). */
  cache_read_ratio?: number;
}

/**
 * Per-phase LLM model routing configuration.
 *
 * Maps each VT-Spec phase to a preferred model identifier. The orchestrating agent
 * reads the model hint from the phase's generated prompt and routes accordingly.
 * Inspired by Gentle-AI's per-phase model assignment pattern.
 *
 * Values are free-form strings validated against /^[a-zA-Z0-9\-\.\/:]+$/ (max 100 chars).
 * VT-Spec does not verify model existence — only format is validated.
 */
export interface ModelsConfig {
  spec?: string;
  design?: string;
  review?: string;
  tasks?: string;
  audit?: string;
}

/** v2.6: VeriScan telemetry integration configuration. */
export interface VeriScanConfig {
  webhook_url: string;
}

/**
 * Root VT-Spec configuration — the full schema for .vtspec/config.yaml.
 *
 * Spec refs: Domain 5 (config.yaml Schema), Domain 10 (Exactly 4 Questions)
 * Design refs: Decision 2
 * v0.2: Added optional guardian, cli, workflow sections.
 * v2.4: Added optional models section for per-phase model routing.
 */
export interface VtspecConfig {
  version: string;
  project: ProjectConfig;
  security: SecurityConfig;
  memory: MemoryConfig;
  /** v0.2: Guardian pre-commit hook settings. Optional — absent means disabled. */
  guardian?: GuardianConfig;
  /** v0.2: CLI settings. Optional — absent means CLI review API mode unavailable. */
  cli?: CliConfig;
  /** v0.2: Workflow settings. Optional — absent means design phase skipped by default. */
  workflow?: WorkflowConfig;
  /** v0.9: Token economics / cost estimation. Optional — absent means no cost tracking. */
  economics?: EconomicsConfig;
  /** v2.4: Per-phase LLM model routing. Optional — absent means no model preference. */
  models?: ModelsConfig;
  /** v2.6: VeriScan telemetry integration. Optional — fail-silent, zero dev impact. */
  veriscan?: VeriScanConfig;
}
