/**
 * Zod input validation schemas for all SpecIA tools.
 *
 * Spec refs: Domain 2 (all tool input parameters), Domain 10 (Exactly 4 Questions)
 *            Domain 7 (Spec Search)
 * Design refs: Decision 6 (all Zod schemas)
 */

import { z } from "zod";

/** Reusable: kebab-case change name (lowercase, digits, hyphens). */
const changeNameSchema = z
  .string()
  .min(1, "change_name is required")
  .regex(
    /^[a-z0-9]+(-[a-z0-9]+)*$/,
    "Change name must be lowercase kebab-case (e.g., auth-refactor)",
  );

// ── Core tool schemas ────────────────────────────────────────────────

export const InitInputSchema = z.object({
  project_description: z
    .string()
    .min(1, "project_description is required"),
  primary_stack: z.string().min(1).optional(),
  conventions: z.array(z.string()).default([]),
  security_posture: z
    .enum(["standard", "elevated", "paranoid"])
    .default("standard"),
  memory_backend: z
    .enum(["alejandria", "engram", "local"])
    .default("local"),
  /** v0.6: Automatically install Guardian pre-commit hook during init. Default: true. */
  install_hook: z
    .boolean()
    .default(true)
    .describe("Install Guardian pre-commit hook (default: true)"),
});

export const ProposeInputSchema = z.object({
  change_name: changeNameSchema,
  intent: z.string().min(1, "intent is required"),
  scope: z.array(z.string()).min(1, "scope must have at least one area"),
  approach: z.string().optional(),
  /** v0.5: Opt out of mandatory post-implementation audit. Default: false (audit required). */
  skip_audit: z.boolean().default(false),
});

export const SpecInputSchema = z.object({
  change_name: changeNameSchema,
  requirements: z
    .array(
      z.object({
        name: z.string().min(1),
        description: z.string().min(1),
        scenarios: z.array(
          z.object({
            name: z.string().min(1),
            given: z.string().min(1),
            when: z.string().min(1),
            then: z.string().min(1),
          }),
        ),
      }),
    )
    .min(1, "At least one requirement is needed"),
});

export const ReviewInputSchema = z.object({
  change_name: changeNameSchema,
  force: z.boolean().default(false),
  review_result: z.unknown().optional(),
});

export const TasksInputSchema = z.object({
  change_name: changeNameSchema,
  include_mitigations: z.boolean().default(true),
});

export const DoneInputSchema = z.object({
  change_name: changeNameSchema,
  /** v0.5: Emergency override — bypass the mandatory audit gate. Heavily logged. */
  force: z.boolean().default(false),
});

// ── Shortcut tool schemas ────────────────────────────────────────────

export const NewInputSchema = ProposeInputSchema;

export const ContinueInputSchema = z.object({
  change_name: changeNameSchema,
});

export const FfInputSchema = z.object({
  change_name: changeNameSchema,
  intent: z.string().optional(),
  scope: z.array(z.string()).optional(),
  approach: z.string().optional(),
  spec_content: z.string().optional(),
  /** v0.2: Optional design content. If provided, saves design.md during fast-forward. */
  design_content: z.string().optional(),
  /** v0.5: Opt out of mandatory post-implementation audit. Passed through to propose phase. */
  skip_audit: z.boolean().default(false),
});

// ── Alejandria integration tool schemas ──────────────────────────────

export const SearchInputSchema = z.object({
  query: z.string().min(1, "query is required"),
  limit: z.number().int().min(1).max(50).default(10),
});

// ── v0.2: Design phase schema ────────────────────────────────────────

export const DesignInputSchema = z.object({
  change_name: changeNameSchema,
  /** Phase 2: agent submits design content. If omitted, returns design prompt. */
  design_content: z.string().optional(),
});

// ── v0.2: Guardian hook schemas ──────────────────────────────────────

export const HookInstallInputSchema = z.object({
  mode: z.enum(["strict", "warn"]).default("warn"),
  exclude: z.array(z.string()).optional(),
  /** v0.4: Enable spec-aware validation (Layer 4). */
  spec_validation: z
    .object({
      enabled: z.boolean().optional(),
      enable_llm: z.boolean().optional(),
      llm_provider: z.enum(["anthropic", "openai"]).optional(),
      llm_model: z.string().optional(),
      llm_budget: z.number().int().min(1000).max(100000).optional(),
      cache_ttl: z.number().int().min(1).max(720).optional(),
      heuristic_threshold: z.number().min(0).max(1).optional(),
    })
    .optional(),
});

export const HookUninstallInputSchema = z.object({});

export const HookStatusInputSchema = z.object({});

// ── v0.3: Audit phase schema ─────────────────────────────────────────

export const AuditInputSchema = z.object({
  change_name: changeNameSchema,
  /** Phase 2: agent submits structured audit result. If omitted, returns audit prompt. */
  audit_result: z.unknown().optional(),
  /** Force re-audit even if cached (audit_hash matches). */
  force: z.boolean().default(false),
  /** Explicit file list override — skips git diff discovery. */
  files: z.array(z.string()).optional(),
  /** Maximum number of files to include in the audit. */
  max_files: z.number().int().min(1).max(200).default(50),
  /** Maximum estimated token count for file contents. */
  max_tokens: z.number().int().min(1000).max(500000).default(100000),
});

// ── v0.4: Structured Debate schema ───────────────────────────────────

export const DebateInputSchema = z.object({
  change_name: changeNameSchema,
  provider: z.enum(["anthropic", "openai"]).default("anthropic"),
  model: z.string().optional(),
  max_rounds: z.number().int().min(1).max(5).default(3),
  max_findings: z.number().int().min(1).max(50).default(10),
  /** Phase 2: agent's LLM response (offensive, defensive, or judge) */
  agent_response: z.unknown().optional(),
});

// ── v0.9: Stats schema ───────────────────────────────────────────────

export const StatsInputSchema = z.object({
  /** Optional: show stats for a specific change. If omitted, shows all changes. */
  change_name: changeNameSchema.optional(),
});

// ── Type exports ─────────────────────────────────────────────────────

export type InitInput = z.infer<typeof InitInputSchema>;
export type ProposeInput = z.infer<typeof ProposeInputSchema>;
export type SpecInput = z.infer<typeof SpecInputSchema>;
export type ReviewInput = z.infer<typeof ReviewInputSchema>;
export type TasksInput = z.infer<typeof TasksInputSchema>;
export type DoneInput = z.infer<typeof DoneInputSchema>;
export type NewInput = z.infer<typeof NewInputSchema>;
export type ContinueInput = z.infer<typeof ContinueInputSchema>;
export type FfInput = z.infer<typeof FfInputSchema>;
export type SearchInput = z.infer<typeof SearchInputSchema>;
// v0.2 type exports
export type DesignInput = z.infer<typeof DesignInputSchema>;
export type HookInstallInput = z.infer<typeof HookInstallInputSchema>;
export type HookUninstallInput = z.infer<typeof HookUninstallInputSchema>;
export type HookStatusInput = z.infer<typeof HookStatusInputSchema>;
// v0.3 type exports
export type AuditInput = z.infer<typeof AuditInputSchema>;
// v0.4 type exports
export type DebateInput = z.infer<typeof DebateInputSchema>;
// v0.9 type exports
export type StatsInput = z.infer<typeof StatsInputSchema>;
