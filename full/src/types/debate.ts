/**
 * Types for structured debate pattern (specia-structured-debate).
 *
 * Debate flow:
 * 1. Offensive agent challenges findings (escalate severity, find gaps)
 * 2. Defensive agent validates mitigations (confirm practicality, challenge inflation)
 * 3. Judge agent synthesizes consensus
 *
 * Inspired by Colmena debate pattern + Secure-Coding-Agent base structure.
 */

// ── Agent Roles ──────────────────────────────────────────────────────

export type DebateRole = "offensive" | "defensive" | "judge";

// ── Debate Round ─────────────────────────────────────────────────────

export interface DebateRound {
  roundNumber: number;
  agent: DebateRole;
  timestamp: string;
  response: OffensiveResponse | DefensiveResponse | JudgeResponse;
}

// ── Offensive Agent Response ────────────────────────────────────────

export interface OffensiveResponse {
  findingId: string;
  challenges: {
    severityEscalation?: {
      original: string;
      proposed: string;
      reasoning: string;
      attackScenarios: string[];
    };
    mitigationGaps?: {
      gap: string;
      bypassTechnique: string;
      edgeCases: string[];
    }[];
    hiddenVectors?: {
      vector: string;
      description: string;
      severity: string;
    }[];
  };
  verdict: "escalate" | "accept" | "needs_clarification";
}

// ── Defensive Agent Response ────────────────────────────────────────

export interface DefensiveResponse {
  findingId: string;
  validations: {
    mitigationEffectiveness?: {
      effective: boolean;
      reasoning: string;
      implementable: boolean;
      estimatedEffort?: string;
    };
    severityChallenge?: {
      challenged: boolean;
      reasoning: string;
      evidenceOfInflation?: string;
      realisticPreconditions: string[];
    };
    enhancedMitigation?: {
      original: string;
      enhanced: string;
      closesGaps: string[];
    };
  };
  verdict: "validated" | "inflated" | "needs_enhancement";
}

// ── Judge Agent Response ────────────────────────────────────────────

export interface JudgeResponse {
  findingId: string;
  synthesis: {
    consensusSeverity: string;
    consensusReached: boolean;
    reasoning: string;
    offensivePerspective: string;
    defensivePerspective: string;
  };
  updatedMitigation?: {
    original: string;
    refined: string;
    improvements: string[];
    creditsAgents: string[];
  };
  needsHumanReview: boolean;
  unresolvedDisagreements?: {
    topic: string;
    offensivePosition: string;
    defensivePosition: string;
  }[];
}

// ── Debate Result ───────────────────────────────────────────────────

export interface DebateResult {
  changeName: string;
  findingsDebated: number;
  totalRounds: number;
  debates: {
    finding: {
      id: string;
      title: string;
      originalSeverity: string;
    };
    rounds: DebateRound[];
    consensus: JudgeResponse | null; // null when max rounds reached without consensus
    roundsUsed: number;
  }[];
  metadata: {
    startedAt: string;
    completedAt: string;
    durationMs: number;
    modelsUsed: {
      offensive: string;
      defensive: string;
      judge: string;
    };
  };
}

// ── Agent Metadata ──────────────────────────────────────────────────

export interface AgentAnalysisMetadata {
  modelUsed: string;
  thinkingDurationMs?: number;
  totalTokens?: number;
  provider: "anthropic" | "openai";
  timestamp: string;
}

// ── Finding Context (input to agents) ──────────────────────────────

export interface FindingContext {
  id: string;
  title: string;
  description: string;
  severity: string;
  category: string;
  mitigation: string;
  affectedComponents: string[];
}

// ── Two-Phase Debate State (NEW) ────────────────────────────────────

/**
 * Debate state persisted between MCP calls.
 * Similar to review.ts two-phase pattern.
 */
export interface DebateState {
  changeName: string;
  currentFindingIndex: number;
  currentRound: number;
  findings: FindingContext[];
  debates: DebateInProgress[];
  maxRounds: number;
  maxFindings: number;
  startedAt: string;
}

export interface DebateInProgress {
  finding: {
    id: string;
    title: string;
    originalSeverity: string;
  };
  rounds: DebateRound[];
  consensus?: JudgeResponse;
  roundsUsed: number;
}

/**
 * Prompt returned to agent host for LLM execution.
 */
export interface DebatePrompt {
  agent: DebateRole;
  findingId: string;
  round: number;
  systemPrompt: string;
  userPrompt: string;
  context: {
    finding: FindingContext;
    previousRounds: DebateRound[];
  };
  outputSchema: {
    type: string;
    properties: Record<string, unknown>;
  };
}

/**
 * Next action in debate workflow.
 */
export type DebateNextAction = 
  | { action: "prompt"; prompt: DebatePrompt }
  | { action: "round_complete"; finding: string; round: number }
  | { action: "complete"; result: DebateResult };
