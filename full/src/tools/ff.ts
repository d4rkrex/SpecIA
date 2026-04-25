/**
 * specia_ff — Fast-forward all remaining phases in sequence.
 *
 * Runs propose → spec → [design (optional)] → review → tasks,
 * skipping any phases already complete.
 * For phases requiring LLM input (spec, review), returns a structured
 * prompt the agent should process, along with which phases were completed
 * and which still need input.
 *
 * v0.2: Added optional design step between spec and review (Decision 12).
 *
 * Stops on first failure.
 *
 * Spec refs: Domain 3 (specia_ff — all scenarios)
 * Design refs: Decision 7 (Orchestration pattern), Decision 12 (Optional design in ff)
 */

import { FileStore } from "../services/store.js";
import { FfInputSchema } from "./schemas.js";
import { ok, fail, ErrorCodes } from "../types/tools.js";
import { handlePropose } from "./propose.js";
import { handleDesign } from "./design.js";
import { handleReview } from "./review.js";
import { handleTasks } from "./tasks.js";
import type { ToolResult } from "../types/index.js";

export interface FfResult {
  phases_completed: string[];
  phases_skipped: string[];
  stopped_at?: string;
  stopped_reason?: string;
  needs_input?: FfNeedsInput;
  tasks_path?: string;
  message: string;
}

export interface FfNeedsInput {
  phase: string;
  tool: string;
  description: string;
  params_hint: string;
  /** v0.2: Hint to skip this optional phase. */
  skip_hint?: string;
}

export async function handleFf(
  args: unknown,
  rootDir: string,
): Promise<ToolResult<FfResult>> {
  const start = Date.now();
  const toolName = "specia_ff";

  // Input validation
  const parsed = FfInputSchema.safeParse(args);
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

  const completed: string[] = [];
  const skipped: string[] = [];
  const ffWarnings: string[] = [];

  // E-01: Warn prominently if skip_audit is used via fast-forward
  if (input.skip_audit) {
    ffWarnings.push("⚠️ AUDIT OPT-OUT via fast-forward: skip_audit=true will disable the mandatory audit gate for this change. Post-implementation audit will NOT be required.");
  }

  // Get current state (may not exist yet — that's OK for propose)
  const state = store.getChangeState(input.change_name);

  // ── Phase 1: Propose ───────────────────────────────────────────────
  if (state?.phases_completed?.includes("proposal")) {
    skipped.push("proposal");
  } else {
    // Need intent and scope to propose
    if (!input.intent || !input.scope || input.scope.length === 0) {
      return ok(
        toolName,
        {
          phases_completed: completed,
          phases_skipped: skipped,
          stopped_at: "proposal",
          stopped_reason: "Missing required input for propose phase.",
          needs_input: {
            phase: "proposal",
            tool: "specia_propose",
            description: "Create a change proposal with intent and scope.",
            params_hint: `{ change_name: "${input.change_name}", intent: "...", scope: ["..."] }`,
          },
          message: "Fast-forward stopped: need intent and scope for proposal. Provide them or run specia_propose manually.",
        },
        { change: input.change_name, duration_ms: Date.now() - start },
      );
    }

    const proposeResult = await handlePropose({
      change_name: input.change_name,
      intent: input.intent,
      scope: input.scope,
      approach: input.approach,
      skip_audit: input.skip_audit,
    }, rootDir);

    if (proposeResult.status === "error") {
      return fail(toolName, proposeResult.errors, {
        change: input.change_name,
        duration_ms: Date.now() - start,
      });
    }
    completed.push("proposal");
  }

  // ── Phase 2: Spec ──────────────────────────────────────────────────
  const stateAfterPropose = store.getChangeState(input.change_name);
  if (stateAfterPropose?.phases_completed?.includes("spec")) {
    skipped.push("spec");
  } else {
    // Spec requires structured requirements — agent must provide them
    return ok(
      toolName,
      {
        phases_completed: completed,
        phases_skipped: skipped,
        stopped_at: "spec",
        stopped_reason: "Spec phase requires structured requirements from the agent/LLM.",
        needs_input: {
          phase: "spec",
          tool: "specia_spec",
          description: "Write specifications with requirements and Given/When/Then scenarios. Read the proposal first to understand the change.",
          params_hint: `{ change_name: "${input.change_name}", requirements: [{ name: "...", description: "...", scenarios: [{ name: "...", given: "...", when: "...", then: "..." }] }] }`,
        },
        message: `Fast-forward completed propose phase. Stopped at spec — this phase needs LLM-generated requirements. Call specia_spec with structured requirements, then call specia_ff again to continue.`,
      },
      { change: input.change_name, duration_ms: Date.now() - start },
    );
  }

  // ── Phase 2.5: Design (optional) ──────────────────────────────────
  // Design is optional. If review is already complete, design was implicitly
  // skipped so we should not block on it. Otherwise, offer the choice.
  const stateAfterSpec = store.getChangeState(input.change_name);
  const reviewAlreadyDone = stateAfterSpec?.phases_completed?.includes("review") ?? false;

  if (stateAfterSpec?.phases_completed?.includes("design")) {
    skipped.push("design");
  } else if (input.design_content) {
    // design_content provided — save it
    const designResult = await handleDesign({
      change_name: input.change_name,
      design_content: input.design_content,
    }, rootDir);

    if (designResult.status === "error") {
      return fail(toolName, designResult.errors, {
        change: input.change_name,
        duration_ms: Date.now() - start,
      });
    }
    completed.push("design");
  } else {
    // Check if design.md already exists on disk (created outside ff)
    const designExists = store.readArtifact(input.change_name, "design") !== null;
    if (designExists || reviewAlreadyDone) {
      // If review already done, design was implicitly skipped — don't block
      skipped.push("design");
    } else {
      // Design is optional — return needs_input with skip hint
      return ok(
        toolName,
        {
          phases_completed: completed,
          phases_skipped: skipped,
          stopped_at: "design",
          stopped_reason: "Optional: create architecture design before review.",
          needs_input: {
            phase: "design",
            tool: "specia_design",
            description: "Optional: create architecture design document. You can skip this step.",
            params_hint: `{ change_name: "${input.change_name}" }`,
            skip_hint: `To skip design, call specia_ff again with the same change_name (no design_content), or call specia_review directly.`,
          },
          message: `Fast-forward stopped at design (optional). To include design, call specia_design or provide design_content to specia_ff. To skip, call specia_ff again or specia_review directly.`,
        },
        { change: input.change_name, duration_ms: Date.now() - start },
      );
    }
  }

  // ── Phase 3: Review ────────────────────────────────────────────────
  const stateBeforeReview = store.getChangeState(input.change_name);
  if (stateBeforeReview?.phases_completed?.includes("review")) {
    skipped.push("review");
  } else {
    // Review is two-phase: first call returns prompt, agent processes, second call saves
    const reviewResult = await handleReview({
      change_name: input.change_name,
    }, rootDir);

    if (reviewResult.status === "error") {
      return fail(toolName, reviewResult.errors, {
        change: input.change_name,
        duration_ms: Date.now() - start,
      });
    }

    // If review returned a prompt (phase 1), agent needs to process it
    if (reviewResult.status === "cached") {
      // Cache hit — review already valid
      skipped.push("review");
    } else if (reviewResult.data && "review_prompt" in reviewResult.data) {
      return ok(
        toolName,
        {
          phases_completed: completed,
          phases_skipped: skipped,
          stopped_at: "review",
          stopped_reason: "Review phase returned a security analysis prompt. The agent must process it and submit the result.",
          needs_input: {
            phase: "review",
            tool: "specia_review",
            description: "Process the security review prompt and submit the analysis result. The review_prompt is in the previous specia_review response.",
            params_hint: `{ change_name: "${input.change_name}", review_result: { ...analysis JSON... } }`,
          },
          message: "Fast-forward stopped at review. The security review prompt has been generated. Process it with the LLM and call specia_review with review_result, then call specia_ff again.",
        },
        { change: input.change_name, duration_ms: Date.now() - start },
      );
    } else {
      // Review completed directly (phase 2 was already done somehow)
      completed.push("review");
    }
  }

  // ── Phase 4: Tasks ─────────────────────────────────────────────────
  const stateAfterReview = store.getChangeState(input.change_name);
  if (stateAfterReview?.phases_completed?.includes("tasks")) {
    skipped.push("tasks");
  } else {
    const tasksResult = await handleTasks({
      change_name: input.change_name,
    }, rootDir);

    if (tasksResult.status === "error") {
      return fail(toolName, tasksResult.errors, {
        change: input.change_name,
        duration_ms: Date.now() - start,
      });
    }
    completed.push("tasks");
  }

  // All phases done
  const tasksPath = `.specia/changes/${input.change_name}/tasks.md`;

  // v0.5: Check audit_policy for the final message
  const finalState = store.getChangeState(input.change_name);
  const auditPolicy = finalState?.audit_policy ?? "required";
  const auditNote = auditPolicy === "required"
    ? "Post-implementation audit is MANDATORY. Run specia_audit before specia_done."
    : "Audit was opted out. Run specia_done to archive.";

  return ok(
    toolName,
    {
      phases_completed: completed,
      phases_skipped: skipped,
      tasks_path: tasksPath,
      message: `Fast-forward complete. All phases done for "${input.change_name}". ${auditNote}`,
    },
    { change: input.change_name, duration_ms: Date.now() - start, warnings: ffWarnings },
  );
}
