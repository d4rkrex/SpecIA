/**
 * Offensive Agent — Adversarial challenger in structured debate.
 *
 * Challenges security findings from attacker perspective:
 * - Escalate severity where impact is underestimated
 * - Identify mitigation bypass techniques
 * - Surface hidden attack vectors
 */

import { DebateBaseAgent } from "./debate-base-agent.js";
import type {
  FindingContext,
  DebateRound,
  OffensiveResponse,
} from "../types/debate.js";
import { offensiveResponseSchema } from "../schemas/debate-response.js";
import { systemPrompt, debateInstructions } from "../prompts/debate-offensive.js";

export class OffensiveAgent extends DebateBaseAgent {
  constructor() {
    super("offensive");
  }

  protected getPrompts(): {
    systemPrompt: string;
    debateInstructions: string;
  } {
    return {
      systemPrompt,
      debateInstructions,
    };
  }

  protected buildUserPrompt(
    finding: FindingContext,
    previousRounds: DebateRound[],
  ): string {
    const parts = [
      "## Finding to Challenge",
      `- ID: ${finding.id}`,
      `- Title: ${finding.title}`,
      `- Current Severity: ${finding.severity}`,
      `- Category: ${finding.category}`,
      "",
      "### Description",
      finding.description,
      "",
      "### Proposed Mitigation",
      finding.mitigation,
      "",
      "### Affected Components",
      finding.affectedComponents.join(", "),
      "",
    ];

    if (previousRounds.length > 0) {
      parts.push("## Previous Debate Rounds", "");
      parts.push(this.formatRoundHistory(previousRounds));
      parts.push("");
      parts.push(
        "**Your task**: Respond to the defensive agent's counterarguments.",
      );
    } else {
      parts.push(
        "**Your task**: Challenge this finding from an offensive security perspective.",
      );
    }

    return parts.join("\n");
  }

  protected parseResponse(raw: unknown): OffensiveResponse {
    // Validate with Zod
    const validated = offensiveResponseSchema.parse(raw);

    // Additional validation: ensure findingId matches
    // (This would be checked by orchestrator, but good to have here too)

    return validated;
  }

  protected getOutputSchema(): {
    type: string;
    properties: Record<string, unknown>;
  } {
    return {
      type: "object",
      properties: {
        findingId: { type: "string" },
        challenges: {
          type: "object",
          properties: {
            severityEscalation: {
              type: "object",
              properties: {
                original: {
                  type: "string",
                  enum: ["low", "medium", "high", "critical"],
                },
                proposed: {
                  type: "string",
                  enum: ["low", "medium", "high", "critical"],
                },
                reasoning: { type: "string" },
                attackScenarios: { type: "array", items: { type: "string" } },
              },
            },
            mitigationGaps: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  gap: { type: "string" },
                  bypassTechnique: { type: "string" },
                  edgeCases: { type: "array", items: { type: "string" } },
                },
              },
            },
            hiddenVectors: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  vector: { type: "string" },
                  description: { type: "string" },
                  severity: {
                    type: "string",
                    enum: ["low", "medium", "high", "critical"],
                  },
                },
              },
            },
          },
        },
        verdict: {
          type: "string",
          enum: ["escalate", "accept", "needs_clarification"],
        },
      },
    };
  }
}
