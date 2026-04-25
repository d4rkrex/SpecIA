/**
 * specia_continue — Resume at the next incomplete phase for a change.
 *
 * Reads state.yaml to determine the current phase, then returns
 * structured guidance for the agent to execute the next phase.
 * Does NOT auto-execute phases (that would require LLM reasoning) —
 * instead returns the next tool call the agent should make.
 *
 * v0.2: After spec completes, suggests specia_design as optional next step.
 * The agent can call specia_review directly to skip design (Decision 9).
 *
 * v0.3: After tasks completes, suggests specia_audit as optional next step.
 * After audit completes, suggests specia_done. Includes staleness detection.
 *
 * Spec refs: Domain 3 (specia_continue — all scenarios),
 *            Domain 5 (specia_continue Update),
 *            Domain 7 (Staleness Detection — stale audit suggestion)
 * Design refs: Decision 7 (Orchestration pattern), Decision 9 (Optional design),
 *              Decision 7 v0.3 (State machine — "audit" optional between tasks/done)
 */

import { FileStore } from "../services/store.js";
import { ContinueInputSchema } from "./schemas.js";
import { ok, fail, ErrorCodes } from "../types/tools.js";
import type { ToolResult, Phase, ChangeState, TokenEstimate } from "../types/index.js";

export interface ContinueResult {
  current_phase: Phase;
  current_status: string;
  next_tool: string;
  next_params: string;
  message: string;
  /** v0.2: When true, the suggested next step can be skipped. */
  optional?: boolean;
  /** v0.9: Brief token usage summary when token_estimates exist. */
  token_summary?: string;
}

export interface ContinueAllDoneResult {
  message: string;
  change_name: string;
  next_tool: string;
  /** v0.9: Brief token usage summary when token_estimates exist. */
  token_summary?: string;
}

/**
 * v0.9: Build a brief token usage summary string from token estimates.
 * Returns undefined if no estimates exist.
 *
 * Example: "Token usage so far: review ~11.7K tokens, audit ~29.8K tokens (total ~41.5K, est. $0.00022)"
 */
function formatTokenSummary(estimates: TokenEstimate[] | undefined, economicsEnabled: boolean): string | undefined {
  if (!estimates || estimates.length === 0) return undefined;

  const parts: string[] = [];
  let totalTokens = 0;
  let totalCost = 0;
  let hasCost = false;

  for (const est of estimates) {
    const resultTokens = est.result_tokens_est ?? 0;
    const phaseTotal = est.prompt_tokens_est + resultTokens;
    totalTokens += phaseTotal;

    parts.push(`${est.phase} ~${formatK(phaseTotal)} tokens`);

    if (est.estimated_cost_usd !== undefined) {
      totalCost += est.estimated_cost_usd;
      hasCost = true;
    }
  }

  let summary = `Token usage so far: ${parts.join(", ")} (total ~${formatK(totalTokens)}`;
  if (hasCost && economicsEnabled) {
    summary += `, est. $${totalCost.toFixed(6)}`;
  }
  summary += ")";

  return summary;
}

/** Format a token count as K (e.g. 11700 -> "11.7K", 500 -> "0.5K"). */
function formatK(tokens: number): string {
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}K`;
  }
  return `${(tokens / 1000).toFixed(1)}K`;
}

/**
 * Determine the next tool and params based on current phase.
 *
 * v0.2: After spec, suggests design (optional) instead of always review.
 * After design, suggests review. All other transitions unchanged.
 *
 * v0.3: After tasks, suggests audit (optional). After audit, suggests done.
 * If audit is stale, suggests re-running audit.
 */
function getNextStep(
  phase: Phase,
  changeName: string,
  store: FileStore,
  state: ChangeState,
): { tool: string; params: string; message: string; optional?: boolean } {
  switch (phase) {
    case "proposal":
      return {
        tool: "specia_spec",
        params: '{ change_name, requirements: [{ name, description, scenarios: [{ name, given, when, then }] }] }',
        message: `Phase "proposal" is complete. Next: call specia_spec with change_name: "${changeName}".`,
      };

    case "spec": {
      // After spec, suggest design as optional next step (Decision 9)
      // Check if design already exists — if so, skip to review
      const designExists = store.readArtifact(changeName, "design") !== null;
      if (designExists) {
        return {
          tool: "specia_review",
          params: `{ change_name: "${changeName}" }`,
          message: `Phase "spec" is complete. Design already exists. Next: call specia_review with change_name: "${changeName}".`,
        };
      }
      return {
        tool: "specia_design",
        params: `{ change_name: "${changeName}" }`,
        message: `Phase "spec" is complete. Next suggested: specia_design (optional). You can skip to specia_review directly.`,
        optional: true,
      };
    }

    case "design":
      return {
        tool: "specia_review",
        params: `{ change_name: "${changeName}" }`,
        message: `Phase "design" is complete. Next: call specia_review with change_name: "${changeName}".`,
      };

    case "review":
      return {
        tool: "specia_tasks",
        params: `{ change_name: "${changeName}" }`,
        message: `Phase "review" is complete. Next: call specia_tasks with change_name: "${changeName}".`,
      };

    case "tasks": {
      // v0.5: After tasks, suggest audit based on audit_policy
      const auditPolicy = state.audit_policy ?? "required"; // default for backward compat
      const isMandatory = auditPolicy === "required";

      if (state.audit_stale) {
        return {
          tool: "specia_audit",
          params: `{ change_name: "${changeName}", force: true }`,
          message: `Phase "tasks" is complete. Audit is stale (code changed since last audit). ${isMandatory ? "Audit is MANDATORY for this change." : "Suggested: re-run specia_audit."} You can ${isMandatory ? "not" : ""} skip to specia_done directly.`,
          optional: !isMandatory,
        };
      }
      return {
        tool: "specia_audit",
        params: `{ change_name: "${changeName}" }`,
        message: isMandatory
          ? `Phase "tasks" is complete. Post-implementation audit is MANDATORY for this change. Run specia_audit before specia_done.`
          : `Phase "tasks" is complete. Next suggested: specia_audit (optional). You can skip to specia_done directly.`,
        optional: !isMandatory,
      };
    }

    case "audit":
      return {
        tool: "specia_done",
        params: `{ change_name: "${changeName}" }`,
        message: `Phase "audit" is complete. Next: call specia_done with change_name: "${changeName}".`,
      };
  }
}

export async function handleContinue(
  args: unknown,
  rootDir: string,
): Promise<ToolResult<ContinueResult | ContinueAllDoneResult>> {
  const start = Date.now();
  const toolName = "specia_continue";

  // Input validation
  const parsed = ContinueInputSchema.safeParse(args);
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
    }], { change: input.change_name, duration_ms: Date.now() - start });
  }

  // Check change exists
  const state = store.getChangeState(input.change_name);
  if (!state) {
    return fail(toolName, [{
      code: ErrorCodes.CHANGE_NOT_FOUND,
      message: `Change "${input.change_name}" not found.`,
    }], { change: input.change_name, duration_ms: Date.now() - start });
  }

  // v0.9: Read economics config for token summary
  const config = store.readConfig();
  const economicsEnabled = config.economics?.enabled === true;
  const tokenSummary = formatTokenSummary(state.token_estimates, economicsEnabled);

  // If current phase is audit and complete, all done
  if (state.phase === "audit" && state.status === "complete") {
    return ok(
      toolName,
      {
        message: "All phases complete. Run specia_done to archive.",
        change_name: input.change_name,
        next_tool: "specia_done",
        ...(tokenSummary !== undefined && { token_summary: tokenSummary }),
      } as ContinueAllDoneResult,
      { change: input.change_name, duration_ms: Date.now() - start },
    );
  }

  // If current phase failed, suggest retrying the same phase
  if (state.status === "failed") {
    const retryTool = `specia_${state.phase}`;

    return ok(
      toolName,
      {
        current_phase: state.phase,
        current_status: state.status,
        next_tool: retryTool,
        next_params: `{ change_name: "${input.change_name}" }`,
        message: `Phase "${state.phase}" failed. Retry with ${retryTool}.`,
        ...(tokenSummary !== undefined && { token_summary: tokenSummary }),
      } as ContinueResult,
      { change: input.change_name, duration_ms: Date.now() - start },
    );
  }

  // Determine next step using dynamic logic
  const next = getNextStep(state.phase, input.change_name, store, state);

  return ok(
    toolName,
    {
      current_phase: state.phase,
      current_status: state.status,
      next_tool: next.tool,
      next_params: next.params,
      message: next.message,
      ...(next.optional !== undefined ? { optional: next.optional } : {}),
      ...(tokenSummary !== undefined && { token_summary: tokenSummary }),
    } as ContinueResult,
    { change: input.change_name, duration_ms: Date.now() - start },
  );
}
