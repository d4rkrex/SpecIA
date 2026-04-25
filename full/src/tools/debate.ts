/**
 * MCP tool: specia_debate — TWO-PHASE PATTERN
 *
 * Phase 1: Returns debate prompt for agent host to execute
 * Phase 2: Accepts agent response, returns next prompt or completion
 *
 * Similar to specia_review two-phase pattern.
 */

import { DebateOrchestrator } from "../services/debate-orchestrator.js";
import { ok, fail, ErrorCodes } from "../types/tools.js";
import { estimateTokens, calculateEstimatedCost } from "../types/tools.js";
import type { ToolResult, DebatePrompt } from "../types/index.js";
import { DebateInputSchema } from "./schemas.js";
import type { DebateResult } from "../types/debate.js";
import { FileStore } from "../services/store.js";

// ── Result Types ─────────────────────────────────────────────────────

/** Phase 1 result: prompt for agent host's LLM */
export interface DebatePromptResult {
  debate_prompt: DebatePrompt;
  instructions: string;
  progress: {
    finding_index: number;
    total_findings: number;
    current_round: number;
    max_rounds: number;
  };
}

/** Phase 2 result: debate complete confirmation */
export interface DebateCompleteResult {
  debate_summary: {
    findings_debated: number;
    total_rounds: number;
    duration_ms: number;
  };
  consensus: Array<{
    finding_id: string;
    finding_title: string;
    original_severity: string;
    consensus_severity: string;
    consensus_reached: boolean;
    needs_human_review: boolean;
    rounds_used: number;
  }>;
  files_updated: {
    review: string;
    transcript: string;
  };
}

// ── Main Handler ─────────────────────────────────────────────────────

export async function handleVtspecDebate(
  args: unknown,
  speciaRoot: string,
): Promise<ToolResult<DebatePromptResult | DebateCompleteResult>> {
  const startTime = Date.now();
  const toolName = "specia_debate";

  // Input validation
  const parsed = DebateInputSchema.safeParse(args);
  if (!parsed.success) {
    return fail(
      toolName,
      parsed.error.issues.map((i) => ({
        code: ErrorCodes.VALIDATION_ERROR,
        message: i.message,
        field: i.path.join("."),
      })),
      { duration_ms: Date.now() - startTime }
    );
  }

  const { change_name, max_rounds, max_findings, agent_response } = parsed.data;

  try {
    const orchestrator = new DebateOrchestrator();

    const nextAction = await orchestrator.next(change_name, speciaRoot, {
      maxRounds: max_rounds,
      maxFindings: max_findings,
      agentResponse: agent_response as any, // Type validated by orchestrator
    });

    if (nextAction.action === "prompt") {
      // Phase 1: Return prompt for agent host
      const { prompt } = nextAction;

      // Token estimation: measure generated prompt size
      const promptTokensEst = estimateTokens(prompt);
      
      return ok<DebatePromptResult>(
        toolName,
        {
          debate_prompt: prompt,
          instructions: buildInstructions(prompt),
          progress: {
            finding_index: 0, // TODO: Extract from state
            total_findings: 0, // TODO: Extract from state
            current_round: prompt.round,
            max_rounds: max_rounds ?? 3,
          },
        },
        { change: change_name, duration_ms: Date.now() - startTime, prompt_tokens_est: promptTokensEst }
      );
    } else {
      // Phase 2: Debate complete
      if (nextAction.action !== "complete") {
        throw new Error("Unexpected action: expected complete or prompt");
      }
      
      const result: DebateResult = nextAction.result;

      // Token estimation: measure received agent response size
      const resultTokensEst = agent_response ? estimateTokens(agent_response as object) : undefined;

      // v0.9: Calculate estimated cost for this round if economics is enabled
      // For debate, we estimate the agent_response as output tokens only (no prompt reference in completion phase)
      let estimatedCostUsd: number | undefined;
      if (resultTokensEst !== undefined) {
        try {
          const store = new FileStore(speciaRoot);
          if (store.isInitialized()) {
            const config = store.readConfig();
            // Cost based on response tokens only — prompt cost was reported in Phase 1
            estimatedCostUsd = calculateEstimatedCost(0, resultTokensEst, config.economics);
          }
        } catch {
          // Config read failure is non-fatal for cost calculation
        }
      }

      return ok<DebateCompleteResult>(
        toolName,
        {
          debate_summary: {
            findings_debated: result.findingsDebated,
            total_rounds: result.totalRounds,
            duration_ms: result.metadata.durationMs,
          },
          consensus: result.debates.map((d: any) => ({
            finding_id: d.finding.id,
            finding_title: d.finding.title,
            original_severity: d.finding.originalSeverity,
            consensus_severity: d.consensus?.synthesis.consensusSeverity ?? "unresolved",
            consensus_reached: d.consensus?.synthesis.consensusReached ?? false,
            needs_human_review: d.consensus?.needsHumanReview ?? true,
            rounds_used: d.roundsUsed,
          })),
          files_updated: {
            review: `.specia/changes/${change_name}/review.md`,
            transcript: `.specia/changes/${change_name}/debate.md`,
          },
        },
        { change: change_name, duration_ms: Date.now() - startTime, ...(resultTokensEst !== undefined && { result_tokens_est: resultTokensEst }), ...(estimatedCostUsd !== undefined && { estimated_cost_usd: estimatedCostUsd }) }
      );
    }
  } catch (err) {
    if (err instanceof Error) {
      if (err.message.includes("ENOENT")) {
        return fail(
          toolName,
          [{ code: ErrorCodes.CHANGE_NOT_FOUND, message: `Change '${change_name}' not found or review.md missing` }],
          { change: change_name, duration_ms: Date.now() - startTime }
        );
      }
      return fail(
        toolName,
        [{ code: ErrorCodes.INTERNAL_ERROR, message: err.message }],
        { change: change_name, duration_ms: Date.now() - startTime }
      );
    }
    return fail(
      toolName,
      [{ code: ErrorCodes.INTERNAL_ERROR, message: String(err) }],
      { change: change_name, duration_ms: Date.now() - startTime }
    );
  }
}

// ── Helper Functions ─────────────────────────────────────────────────

function buildInstructions(prompt: DebatePrompt): string {
  return `
Execute the ${prompt.agent} agent prompt below and return the JSON response.

**Agent**: ${prompt.agent}
**Finding**: ${prompt.findingId}
**Round**: ${prompt.round}

After receiving the LLM's JSON response, call specia_debate again with:
- change_name: (same)
- agent_response: (the JSON from LLM)

The debate will continue until consensus is reached or max rounds completed.
`.trim();
}
