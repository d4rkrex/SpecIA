/**
 * Zod schemas for debate agent responses.
 * Validates LLM outputs before processing.
 */

import { z } from "zod";

// ── Offensive Agent Response Schema ─────────────────────────────────

export const offensiveResponseSchema = z.object({
  findingId: z.string(),
  challenges: z.object({
    severityEscalation: z
      .object({
        original: z.enum(["low", "medium", "high", "critical"]),
        proposed: z.enum(["low", "medium", "high", "critical"]),
        reasoning: z.string(),
        attackScenarios: z.array(z.string()),
      })
      .optional(),
    mitigationGaps: z
      .array(
        z.object({
          gap: z.string(),
          bypassTechnique: z.string(),
          edgeCases: z.array(z.string()),
        }),
      )
      .optional(),
    hiddenVectors: z
      .array(
        z.object({
          vector: z.string(),
          description: z.string(),
          severity: z.enum(["low", "medium", "high", "critical"]),
        }),
      )
      .optional(),
  }),
  verdict: z.enum(["escalate", "accept", "needs_clarification"]),
});

// ── Defensive Agent Response Schema ─────────────────────────────────

export const defensiveResponseSchema = z.object({
  findingId: z.string(),
  validations: z.object({
    mitigationEffectiveness: z
      .object({
        effective: z.boolean(),
        reasoning: z.string(),
        implementable: z.boolean(),
        estimatedEffort: z.enum(["low", "medium", "high"]).optional(),
      })
      .optional(),
    severityChallenge: z
      .object({
        challenged: z.boolean(),
        reasoning: z.string(),
        evidenceOfInflation: z.string().optional(),
        realisticPreconditions: z.array(z.string()),
      })
      .optional(),
    enhancedMitigation: z
      .object({
        original: z.string(),
        enhanced: z.string(),
        closesGaps: z.array(z.string()),
      })
      .optional(),
  }),
  verdict: z.enum(["validated", "inflated", "needs_enhancement"]),
});

// ── Judge Agent Response Schema ─────────────────────────────────────

export const judgeResponseSchema = z.object({
  findingId: z.string(),
  synthesis: z.object({
    consensusSeverity: z.enum(["low", "medium", "high", "critical"]),
    consensusReached: z.boolean(),
    reasoning: z.string(),
    offensivePerspective: z.string(),
    defensivePerspective: z.string(),
  }),
  updatedMitigation: z
    .object({
      original: z.string(),
      refined: z.string(),
      improvements: z.array(z.string()),
      creditsAgents: z.array(z.string()),
    })
    .optional(),
  needsHumanReview: z.boolean(),
  unresolvedDisagreements: z
    .array(
      z.object({
        topic: z.string(),
        offensivePosition: z.string(),
        defensivePosition: z.string(),
      }),
    )
    .optional(),
});

// ── Type exports ────────────────────────────────────────────────────

export type OffensiveResponseSchema = z.infer<typeof offensiveResponseSchema>;
export type DefensiveResponseSchema = z.infer<typeof defensiveResponseSchema>;
export type JudgeResponseSchema = z.infer<typeof judgeResponseSchema>;
