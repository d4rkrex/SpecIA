/**
 * specia_design — Optional architecture design tool (two-phase).
 *
 * Phase 1 (no design_content): Returns a structured design prompt with
 * the proposal + spec as context, plus a design template for the agent to fill.
 *
 * Phase 2 (with design_content): Validates the content is non-trivial,
 * writes design.md, updates state.yaml.
 *
 * The design phase is OPTIONAL. Both paths work:
 * - Path A (no design): propose → spec → review → tasks → done
 * - Path B (with design): propose → spec → design → review → tasks → done
 *
 * v0.2: Design Decision 9 (DAG Branch), Decision 10 (Template-Driven)
 */

import { FileStore } from "../services/store.js";
import { renderDesignPrompt } from "../services/template.js";
import { tryRecall, tryStore, buildDesignHint, formatMemoryContext } from "../services/memory-ops.js";
import type { MemoryHint } from "../services/memory-ops.js";
import { DesignInputSchema } from "./schemas.js";
import { ok, fail, ErrorCodes } from "../types/tools.js";
import { estimateTokens, calculateEstimatedCost } from "../types/tools.js";
import type { ToolResult, TokenEstimate } from "../types/index.js";

/** Minimum length for design content to be considered non-trivial. */
const MIN_DESIGN_LENGTH = 50;

export interface DesignPromptResult {
  design_prompt: string;
  instructions: string;
  change_name: string;
  memory_context?: string[];
  memory_hint?: MemoryHint;
}

export interface DesignCompleteResult {
  design_path: string;
  change_name: string;
  message: string;
}

export async function handleDesign(
  args: unknown,
  rootDir: string,
): Promise<ToolResult<DesignPromptResult | DesignCompleteResult>> {
  const start = Date.now();
  const toolName = "specia_design";

  // Input validation
  const parsed = DesignInputSchema.safeParse(args);
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
      message: `Change "${input.change_name}" not found. Run specia_propose first.`,
    }], { change: input.change_name, duration_ms: Date.now() - start });
  }

  // Check spec exists (design requires spec)
  const specContent = store.readArtifact(input.change_name, "spec");
  if (!specContent) {
    return fail(toolName, [{
      code: ErrorCodes.MISSING_DEPENDENCY,
      message: "Spec must exist before creating a design. Run specia_spec first.",
      dependency: "spec",
    }], { change: input.change_name, duration_ms: Date.now() - start });
  }

  // Phase 2: agent is submitting design content
  if (input.design_content !== undefined && input.design_content !== null) {
    return await handleDesignContent(
      input.design_content,
      input.change_name,
      store,
      start,
    );
  }

  // Phase 1: generate design prompt with template
  const proposalContent = store.readArtifact(input.change_name, "proposal");
  if (!proposalContent) {
    return fail(toolName, [{
      code: ErrorCodes.MISSING_DEPENDENCY,
      message: "Proposal must exist before creating a design. Run specia_propose first.",
      dependency: "proposal",
    }], { change: input.change_name, duration_ms: Date.now() - start });
  }

  const designPrompt = renderDesignPrompt(
    input.change_name,
    proposalContent,
    specContent,
  );

  // Recall past design decisions for cross-session context
  const config = store.readConfig();
  const warnings: string[] = [];
  let memoryContext: string[] | undefined;
  const memoryHint = buildDesignHint(config.memory, config.project.name, input.change_name);

  const { data: pastDesigns, backend: memBackend, error: recallError } = await tryRecall(
    config.memory,
    `design architecture decisions patterns ${config.project.name}`,
    { scope: `specia/${config.project.name}`, limit: 5 },
  );
  if (pastDesigns.length > 0) {
    memoryContext = formatMemoryContext(pastDesigns);
    warnings.push(`memory_context: Found ${pastDesigns.length} past design(s) via ${memBackend}`);
  }
  if (recallError) {
    warnings.push(recallError);
  }

  // Token estimation: measure generated prompt size
  const promptTokensEst = estimateTokens(designPrompt);

  // Store Phase 1 prompt estimate in state.yaml for cross-phase tracking
  const currentState = store.getChangeState(input.change_name);
  if (currentState) {
    const estimates = [...(currentState.token_estimates ?? [])];
    estimates.push({
      phase: "design" as const,
      prompt_tokens_est: promptTokensEst,
      timestamp: new Date().toISOString(),
    });
    store.transitionPhase(input.change_name, currentState.phase, currentState.status, {
      token_estimates: estimates,
    });
  }

  return ok(
    toolName,
    {
      design_prompt: designPrompt,
      instructions: `Review the proposal and specification above, then fill in the design template with concrete architecture decisions. When ready, call specia_design again with the same change_name and your design document as design_content.`,
      change_name: input.change_name,
      memory_context: memoryContext,
      memory_hint: memBackend === "engram" ? memoryHint : undefined,
    } as DesignPromptResult,
    { change: input.change_name, duration_ms: Date.now() - start, prompt_tokens_est: promptTokensEst, warnings },
  );
}

// ── Phase 2: Validate and save design content ────────────────────────

async function handleDesignContent(
  designContent: string,
  changeName: string,
  store: FileStore,
  start: number,
): Promise<ToolResult<DesignCompleteResult>> {
  const toolName = "specia_design";

  // Validate content is non-trivial
  if (designContent.trim().length < MIN_DESIGN_LENGTH) {
    return fail(toolName, [{
      code: ErrorCodes.VALIDATION_ERROR,
      message: `Design content is too short (${designContent.trim().length} chars). A meaningful design document should be at least ${MIN_DESIGN_LENGTH} characters.`,
    }], { change: changeName, duration_ms: Date.now() - start });
  }

  // Token estimation: measure received result size
  const resultTokensEst = estimateTokens(designContent);

  try {
    // Write design.md
    store.writeArtifact(changeName, "design", designContent);

    // Complete Phase 2 token estimate: update pending estimate with result tokens
    const currentState = store.getChangeState(changeName);
    const estimates: TokenEstimate[] = [...(currentState?.token_estimates ?? [])];
    let estimatedCostUsd: number | undefined;
    const config = store.readConfig();
    // Find last pending estimate for this phase (ES2022-compatible reverse search)
    for (let i = estimates.length - 1; i >= 0; i--) {
      const e = estimates[i];
      if (e && e.phase === "design" && !e.result_tokens_est) {
        e.result_tokens_est = resultTokensEst;
        // v0.9: Calculate estimated cost if economics config is enabled
        const cost = calculateEstimatedCost(e.prompt_tokens_est, resultTokensEst, config.economics);
        if (cost !== undefined) {
          e.estimated_cost_usd = cost;
          estimatedCostUsd = cost;
        }
        break;
      }
    }

    // Transition to design phase complete with token estimates
    store.transitionPhase(changeName, "design", "complete", {
      token_estimates: estimates,
    });

    // Store design decisions in memory for cross-session context
    const designWarnings: string[] = [];
    const { error: storeError } = await tryStore(config.memory, designContent, {
      topic_key: `specia/${config.project.name}/design/${changeName}`,
      topic: "designs",
      summary: `Design for "${changeName}" in project ${config.project.name}`,
      importance: "medium",
    });
    if (storeError) {
      designWarnings.push(storeError);
    }

    return ok(
      toolName,
      {
        design_path: `.specia/changes/${changeName}/design.md`,
        change_name: changeName,
        message: `Design document saved. Next: run specia_review to perform the security review (design will be included as context).`,
      },
      { change: changeName, duration_ms: Date.now() - start, result_tokens_est: resultTokensEst, estimated_cost_usd: estimatedCostUsd, warnings: designWarnings.length > 0 ? designWarnings : undefined },
    );
  } catch (err) {
    return fail(toolName, [{
      code: ErrorCodes.IO_ERROR,
      message: `Failed to save design: ${err instanceof Error ? err.message : String(err)}`,
    }], { change: changeName, duration_ms: Date.now() - start });
  }
}
