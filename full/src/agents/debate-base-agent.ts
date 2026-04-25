/**
 * Base class for debate agents (offensive, defensive, judge).
 *
 * Refactored to TWO-PHASE pattern:
 * - Phase 1: buildPrompt() returns structured prompt for agent host to execute
 * - Phase 2: parseResponse() validates agent host's LLM response
 *
 * NO direct LLM API calls — delegates to agent host (Claude Code, Copilot CLI).
 *
 * Architecture refs: specia-structured-debate spec, specia_review two-phase pattern
 * Code reuse: Adapted from Secure-Coding-Agent BaseAgent (removed LLM client)
 */

import type {
  DebateRole,
  FindingContext,
  DebateRound,
  OffensiveResponse,
  DefensiveResponse,
  JudgeResponse,
  DebatePrompt,
} from "../types/debate.js";

export abstract class DebateBaseAgent {
  protected readonly role: DebateRole;

  constructor(role: DebateRole) {
    this.role = role;
  }

  /**
   * Get system prompt and debate instructions.
   * Subclasses must implement this to return their role-specific prompts.
   * @abstract
   */
  protected abstract getPrompts(): {
    systemPrompt: string;
    debateInstructions: string;
  };

  /**
   * Build debate prompt for agent host to execute.
   * TWO-PHASE PATTERN: Returns prompt, does NOT call LLM.
   *
   * @param finding - The finding to debate
   * @param previousRounds - Previous debate rounds for this finding
   * @param round - Current round number
   * @returns Structured prompt for agent host
   */
  async buildPrompt(
    finding: FindingContext,
    previousRounds: DebateRound[],
    round: number,
  ): Promise<DebatePrompt> {
    const { systemPrompt, debateInstructions } = this.getPrompts();
    const systemPromptFull = `${systemPrompt}\n\n${debateInstructions}`;
    const userPrompt = this.buildUserPrompt(finding, previousRounds);

    return {
      agent: this.role,
      findingId: finding.id,
      round,
      systemPrompt: systemPromptFull,
      userPrompt,
      context: {
        finding,
        previousRounds,
      },
      outputSchema: this.getOutputSchema(),
    };
  }

  /**
   * Validate agent host's LLM response.
   * TWO-PHASE PATTERN: Parses response returned by agent host.
   *
   * @param rawResponse - Raw text/JSON from agent host's LLM call
   * @returns Validated agent response
   */
  async validateResponse(
    rawResponse: string | object,
  ): Promise<OffensiveResponse | DefensiveResponse | JudgeResponse> {
    // If rawResponse is already an object, use it directly
    const parsed = typeof rawResponse === "string" 
      ? JSON.parse(this.extractJSON(rawResponse))
      : rawResponse;

    // Delegate to subclass for schema validation
    return this.parseResponse(parsed);
  }

  /**
   * Subclasses MUST implement: build the user prompt for this debate round.
   * @abstract
   */
  protected abstract buildUserPrompt(
    finding: FindingContext,
    previousRounds: DebateRound[],
  ): string;

  /**
   * Subclasses MUST implement: validate and transform the LLM response.
   * Should use Zod schema validation.
   * @abstract
   */
  protected abstract parseResponse(
    raw: unknown,
  ): OffensiveResponse | DefensiveResponse | JudgeResponse;

  /**
   * Subclasses MUST implement: provide the JSON schema for LLM output.
   * @abstract
   */
  protected abstract getOutputSchema(): {
    type: string;
    properties: Record<string, unknown>;
  };

  /**
   * Extract JSON from LLM response text.
   * The model might wrap JSON in markdown code fences.
   *
   * Copied from Secure-Coding-Agent BaseAgent.
   */
  protected extractJSON(text: string): string {
    // Try to find ```json ... ``` block
    const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (fenceMatch && fenceMatch[1]) return fenceMatch[1].trim();

    // Try to find raw JSON object
    const braceStart = text.indexOf("{");
    const braceEnd = text.lastIndexOf("}");
    if (braceStart !== -1 && braceEnd > braceStart) {
      return text.slice(braceStart, braceEnd + 1);
    }

    // Return as-is and let JSON.parse handle the error
    return text;
  }

  /**
   * Generate a round summary for logging/debugging.
   */
  protected formatRoundHistory(rounds: DebateRound[]): string {
    if (rounds.length === 0) return "No previous rounds.";

    return rounds
      .map((r) => {
        const responseStr = JSON.stringify(r.response);
        return `Round ${r.roundNumber} [${r.agent}]: ${responseStr.substring(0, 100)}...`;
      })
      .join("\n");
  }
}
