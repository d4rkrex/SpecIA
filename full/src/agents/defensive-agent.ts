/**
 * Defensive Agent — Pragmatic validator in structured debate.
 *
 * Validates security findings from defensive perspective:
 * - Confirm mitigation effectiveness
 * - Challenge unrealistic severity escalations
 * - Propose enhanced mitigations for valid gaps
 */

import { DebateBaseAgent } from "./debate-base-agent.js";
import type {
  FindingContext,
  DebateRound,
  DefensiveResponse,
} from "../types/debate.js";
import { defensiveResponseSchema } from "../schemas/debate-response.js";
import { systemPrompt, debateInstructions } from "../prompts/debate-defensive.js";

export class DefensiveAgent extends DebateBaseAgent {
  constructor() {
    super("defensive");
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
      "## Finding to Validate",
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
        "**Your task**: Validate the mitigation and respond to offensive agent's challenges.",
      );
    } else {
      parts.push(
        "**Your task**: Validate this finding from a defensive/pragmatic perspective.",
      );
    }

    return parts.join("\n");
  }

  protected parseResponse(raw: unknown): DefensiveResponse {
    // Validate with Zod
    const validated = defensiveResponseSchema.parse(raw);
    return validated;
  }

  protected getOutputSchema(): { type: string; properties: Record<string, unknown>; } {
    return {
      type: "object",
      properties: {
        findingId: { type: "string" },
        validations: {
          type: "object",
          properties: {
            mitigationEffectiveness: {
              type: "object",
              properties: {
                effective: { type: "boolean" },
                reasoning: { type: "string" },
                implementable: { type: "boolean" },
                estimatedEffort: {
                  type: "string",
                  enum: ["low", "medium", "high"],
                },
              },
            },
            severityChallenge: {
              type: "object",
              properties: {
                challenged: { type: "boolean" },
                reasoning: { type: "string" },
                evidenceOfInflation: { type: "string" },
                realisticPreconditions: {
                  type: "array",
                  items: { type: "string" },
                },
              },
            },
            enhancedMitigation: {
              type: "object",
              properties: {
                original: { type: "string" },
                enhanced: { type: "string" },
                closesGaps: { type: "array", items: { type: "string" } },
              },
            },
          },
        },
        verdict: {
          type: "string",
          enum: ["validated", "inflated", "needs_enhancement"],
        },
      },
    };
  }
}
