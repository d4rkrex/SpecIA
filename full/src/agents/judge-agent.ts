/**
 * Judge Agent — Impartial synthesizer in structured debate.
 *
 * Synthesizes consensus from offensive and defensive perspectives:
 * - Determine consensus severity
 * - Merge mitigation improvements
 * - Flag unresolved disagreements for human review
 */

import { DebateBaseAgent } from "./debate-base-agent.js";
import type {
  FindingContext,
  DebateRound,
  JudgeResponse,
} from "../types/debate.js";
import { judgeResponseSchema } from "../schemas/debate-response.js";
import { systemPrompt, debateInstructions } from "../prompts/debate-judge.js";

export class JudgeAgent extends DebateBaseAgent {
  constructor() {
    super("judge");
  }

  protected getPrompts(): { systemPrompt: string; debateInstructions: string } {
    return { systemPrompt, debateInstructions };
  }

  protected buildUserPrompt(
    finding: FindingContext,
    previousRounds: DebateRound[],
  ): string {
    const parts = [
      "## Finding Being Debated",
      `- ID: ${finding.id}`,
      `- Title: ${finding.title}`,
      `- Original Severity: ${finding.severity}`,
      `- Category: ${finding.category}`,
      "",
      "### Description",
      finding.description,
      "",
      "### Original Mitigation",
      finding.mitigation,
      "",
      "### Affected Components",
      finding.affectedComponents.join(", "),
      "",
      "## Debate Rounds",
      "",
    ];

    if (previousRounds.length === 0) {
      parts.push("**ERROR**: No debate rounds provided. Cannot synthesize.");
      return parts.join("\n");
    }

    parts.push(this.formatRoundHistory(previousRounds));
    parts.push("");
    parts.push(
      `**Your task**: Synthesize consensus from ${previousRounds.length} debate rounds.`,
    );
    parts.push(
      "Determine the most accurate severity, merge mitigation improvements, and flag unresolved disagreements.",
    );

    return parts.join("\n");
  }

  protected parseResponse(raw: unknown): JudgeResponse {
    // Validate with Zod
    const validated = judgeResponseSchema.parse(raw);
    return validated;
  }

  protected getOutputSchema(): { type: string; properties: Record<string, unknown>; } {
    return {
      type: "object",
      properties: {
        findingId: { type: "string" },
        synthesis: {
          type: "object",
          required: [
            "consensusSeverity",
            "consensusReached",
            "reasoning",
            "offensivePerspective",
            "defensivePerspective",
          ],
          properties: {
            consensusSeverity: {
              type: "string",
              enum: ["low", "medium", "high", "critical"],
            },
            consensusReached: { type: "boolean" },
            reasoning: { type: "string" },
            offensivePerspective: { type: "string" },
            defensivePerspective: { type: "string" },
          },
        },
        updatedMitigation: {
          type: "object",
          properties: {
            original: { type: "string" },
            refined: { type: "string" },
            improvements: { type: "array", items: { type: "string" } },
            creditsAgents: { type: "array", items: { type: "string" } },
          },
        },
        needsHumanReview: { type: "boolean" },
        unresolvedDisagreements: {
          type: "array",
          items: {
            type: "object",
            properties: {
              topic: { type: "string" },
              offensivePosition: { type: "string" },
              defensivePosition: { type: "string" },
            },
          },
        },
      },
    };
  }
}
