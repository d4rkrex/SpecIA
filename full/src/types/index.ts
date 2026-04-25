export type {
  VtspecConfig,
  ProjectConfig,
  SecurityConfig,
  MemoryConfig,
  SecurityPosture,
  MemoryBackend,
  // v0.2 types
  GuardianConfig,
  GuardianMode,
  CliConfig,
  LlmProviderConfig,
  LlmProvider,
  WorkflowConfig,
  // v0.4 types
  GuardianSpecValidationConfig,
  // v0.9 types
  EconomicsConfig,
} from "./config.js";

export type {
  Phase,
  PhaseStatus,
  ArtifactType,
  ChangeState,
  ChangeInfo,
  PhaseHistoryEntry,
  AuditPolicy,
  TokenEstimate,
} from "./state.js";

export {
  ErrorCodes,
  ok,
  fail,
  estimateTokens,
  calculateEstimatedCost,
} from "./tools.js";
export type {
  ToolResponse,
  ToolResult,
  ToolError,
  ToolMeta,
  ErrorCode,
} from "./tools.js";

export type {
  SecurityReview,
  Threat,
  ThreatCategory,
  OwaspMapping,
  DreadScore,
  ReviewSummary,
  StrideAnalysis,
  ReviewPrompt,
  AbuseCase,
} from "./review.js";

export type {
  StoreOpts,
  RecallOpts,
  Memory,
} from "./memory.js";

export type {
  AuditResult,
  RequirementVerification,
  AbuseCaseVerification,
  AuditSummary,
  AuditPrompt,
  CodeFile,
  RequirementVerdict,
  AbuseCaseVerdict,
  OverallVerdict,
  RequirementsCoverage,
  AbuseCasesCoverage,
} from "./audit.js";

export type {
  // Layer 4a types
  CodeElements,
  RequirementKeywords,
  EvidenceSource,
  EvidenceScore,
  FlaggedRequirement,
  FlaggedAbuseCase,
  HeuristicResult,
  // Layer 4b types
  GuardianVerdict,
  GuardianAuditConfig,
  GuardianAuditResult,
  // Layer 4 combined types
  SpecMatchResult,
  // Cache types
  L4aCacheEntry,
  L4bCacheEntry,
  GuardianSpecCache,
  // Validation types
  FileValidation,
  ValidationResult,
  GuardianCacheEntry,
  GuardianCache,
} from "./guardian.js";

export type {
  DebateRole,
  DebateRound,
  OffensiveResponse,
  DefensiveResponse,
  JudgeResponse,
  DebateResult,
  AgentAnalysisMetadata,
  FindingContext,
  DebateState,
  DebateInProgress,
  DebatePrompt,
  DebateNextAction,
} from "./debate.js";

export type {
  ApplyManifest,
  ApplyPattern,
  TaskGroup,
} from "./apply-manifest.js";

export {
  MAX_PARALLEL_WORKERS,
  RESTRICTED_PATH_PATTERNS,
  DEFAULT_FORBIDDEN_PATHS,
} from "./apply-manifest.js";

// v0.9: CLI-specific types (re-exported for convenience)
export type {
  LLMUsage,
  LlmResult,
} from "../cli/llm-client.js";
