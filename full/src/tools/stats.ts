/**
 * specia_stats — Token usage and cost summary for changes.
 *
 * Reads token_estimates[] from state.yaml and economics config
 * to produce a structured token economics report.
 *
 * Two modes:
 * - Single change (change_name provided): detailed per-phase breakdown with totals.
 * - All changes (change_name omitted): summary per change with grand totals.
 *
 * Handles gracefully: no token estimates, economics not configured, change not found,
 * archived changes without state.yaml.
 *
 * Spec refs: Phase 4 (Token Economics — specia_stats tool)
 */

import { FileStore } from "../services/store.js";
import { StatsInputSchema } from "./schemas.js";
import { ok, fail, ErrorCodes } from "../types/tools.js";
import type { ToolResult, TokenEstimate } from "../types/index.js";

// ── Response types ───────────────────────────────────────────────────

export interface PhaseStats {
  phase: string;
  prompt_tokens_est: number;
  result_tokens_est: number;
  total_tokens_est: number;
  estimated_cost_usd?: number;
  source?: "estimate" | "api";
  model?: string;
  timestamp: string;
}

export interface ChangeTotals {
  prompt_tokens_est: number;
  result_tokens_est: number;
  total_tokens_est: number;
  estimated_cost_usd?: number;
  phases_tracked: number;
}

export interface SingleChangeStats {
  change: string;
  phases: PhaseStats[];
  totals: ChangeTotals;
  economics_configured: boolean;
}

export interface ChangeSummary {
  change: string;
  total_tokens_est: number;
  estimated_cost_usd?: number;
  phases_tracked: number;
}

export interface GrandTotals {
  total_tokens_est: number;
  estimated_cost_usd?: number;
  changes_tracked: number;
  phases_tracked: number;
}

export interface AllChangesStats {
  changes: ChangeSummary[];
  grand_totals: GrandTotals;
  economics_configured: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Round to 6 decimal places. Returns undefined if input is undefined. */
function round6(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  return Math.round(value * 1000000) / 1000000;
}

/** Build per-phase stats from token estimates. */
function buildPhaseStats(estimates: TokenEstimate[]): PhaseStats[] {
  return estimates.map((est) => {
    const resultTokens = est.result_tokens_est ?? 0;
    return {
      phase: est.phase,
      prompt_tokens_est: est.prompt_tokens_est,
      result_tokens_est: resultTokens,
      total_tokens_est: est.prompt_tokens_est + resultTokens,
      ...(est.estimated_cost_usd !== undefined && {
        estimated_cost_usd: round6(est.estimated_cost_usd),
      }),
      ...(est.source !== undefined && { source: est.source }),
      ...(est.model !== undefined && { model: est.model }),
      timestamp: est.timestamp,
    };
  });
}

/** Compute totals from phase stats. */
function computeTotals(phases: PhaseStats[], economicsConfigured: boolean): ChangeTotals {
  let promptTotal = 0;
  let resultTotal = 0;
  let costTotal = 0;
  let hasCost = false;

  for (const p of phases) {
    promptTotal += p.prompt_tokens_est;
    resultTotal += p.result_tokens_est;
    if (p.estimated_cost_usd !== undefined) {
      costTotal += p.estimated_cost_usd;
      hasCost = true;
    }
  }

  return {
    prompt_tokens_est: promptTotal,
    result_tokens_est: resultTotal,
    total_tokens_est: promptTotal + resultTotal,
    ...(hasCost && economicsConfigured && {
      estimated_cost_usd: round6(costTotal),
    }),
    phases_tracked: phases.length,
  };
}

// ── Handler ─────────────────────────────────────────────────────────

export async function handleStats(
  args: unknown,
  rootDir: string,
): Promise<ToolResult<SingleChangeStats | AllChangesStats>> {
  const start = Date.now();
  const toolName = "specia_stats";

  // Input validation
  const parsed = StatsInputSchema.safeParse(args);
  if (!parsed.success) {
    return fail(toolName, parsed.error.issues.map((i) => ({
      code: ErrorCodes.VALIDATION_ERROR,
      message: i.message,
      field: i.path.join("."),
    })), { duration_ms: Date.now() - start });
  }

  const input = parsed.data;
  const store = new FileStore(rootDir);

  // Check project is initialized
  if (!store.isInitialized()) {
    return fail(toolName, [{
      code: ErrorCodes.NOT_INITIALIZED,
      message: "Run specia_init first — .specia/config.yaml not found.",
    }], { duration_ms: Date.now() - start });
  }

  const config = store.readConfig();
  const economicsConfigured = config.economics?.enabled === true;

  // ── Single change mode ──────────────────────────────────────────
  if (input.change_name) {
    const state = store.getChangeState(input.change_name);
    if (!state) {
      return fail(toolName, [{
        code: ErrorCodes.CHANGE_NOT_FOUND,
        message: `Change "${input.change_name}" not found.`,
      }], { change: input.change_name, duration_ms: Date.now() - start });
    }

    const estimates = state.token_estimates ?? [];
    const phases = buildPhaseStats(estimates);
    const totals = computeTotals(phases, economicsConfigured);

    return ok(
      toolName,
      {
        change: input.change_name,
        phases,
        totals,
        economics_configured: economicsConfigured,
      } as SingleChangeStats,
      { change: input.change_name, duration_ms: Date.now() - start },
    );
  }

  // ── All changes mode ────────────────────────────────────────────
  const changeInfos = store.listChanges();
  const changes: ChangeSummary[] = [];
  let grandTokens = 0;
  let grandCost = 0;
  let grandHasCost = false;
  let grandPhases = 0;

  for (const info of changeInfos) {
    // getChangeState is safe — listChanges already verified directory exists
    const state = store.getChangeState(info.name);
    if (!state) continue; // Defensive: skip if state disappeared

    const estimates = state.token_estimates ?? [];
    const phases = buildPhaseStats(estimates);
    const totals = computeTotals(phases, economicsConfigured);

    changes.push({
      change: info.name,
      total_tokens_est: totals.total_tokens_est,
      ...(totals.estimated_cost_usd !== undefined && {
        estimated_cost_usd: totals.estimated_cost_usd,
      }),
      phases_tracked: totals.phases_tracked,
    });

    grandTokens += totals.total_tokens_est;
    if (totals.estimated_cost_usd !== undefined) {
      grandCost += totals.estimated_cost_usd;
      grandHasCost = true;
    }
    grandPhases += totals.phases_tracked;
  }

  return ok(
    toolName,
    {
      changes,
      grand_totals: {
        total_tokens_est: grandTokens,
        ...(grandHasCost && economicsConfigured && {
          estimated_cost_usd: round6(grandCost),
        }),
        changes_tracked: changes.length,
        phases_tracked: grandPhases,
      },
      economics_configured: economicsConfigured,
    } as AllChangesStats,
    { duration_ms: Date.now() - start },
  );
}
