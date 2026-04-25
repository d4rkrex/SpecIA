/**
 * specia_propose — Create a new change proposal.
 *
 * Creates .specia/changes/{name}/ with proposal.md and state.yaml.
 * v0.5: Sets audit_policy in state.yaml based on skip_audit parameter.
 *
 * Spec refs: Domain 2 (specia_propose — all scenarios)
 * Design refs: Decision 2 (FileStore), Decision 6 (Tool Interface Contract)
 */

import { FileStore } from "../services/store.js";
import { renderProposal } from "../services/template.js";
import { tryRecall, tryStore, buildProposeHint, formatMemoryContext } from "../services/memory-ops.js";
import type { MemoryHint } from "../services/memory-ops.js";
import { ProposeInputSchema } from "./schemas.js";
import { ok, fail, ErrorCodes } from "../types/tools.js";
import type { ToolResult, AuditPolicy } from "../types/index.js";

export interface ProposeResult {
  proposal_path: string;
  change_name: string;
  memory_context?: string[];
  memory_hint?: MemoryHint;
}

export async function handlePropose(
  args: unknown,
  rootDir: string,
): Promise<ToolResult<ProposeResult>> {
  const start = Date.now();
  const toolName = "specia_propose";
  const warnings: string[] = [];

  // Input validation
  const parsed = ProposeInputSchema.safeParse(args);
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

  // Check for duplicate change name
  const existingState = store.getChangeState(input.change_name);
  if (existingState) {
    return fail(toolName, [{
      code: ErrorCodes.CHANGE_EXISTS,
      message: `Change "${input.change_name}" already exists. Use a different name or delete the existing change.`,
    }], { change: input.change_name, duration_ms: Date.now() - start });
  }

  // v0.5: Determine audit_policy based on skip_audit parameter
  const auditPolicy: AuditPolicy = input.skip_audit ? "skipped" : "required";

  // R-01: Log opt-out decision if audit is being skipped
  if (input.skip_audit) {
    warnings.push(`⚠️ Audit opted out at proposal time (${new Date().toISOString()}). Post-implementation audit will NOT be required for this change.`);
  }

  // Recall past proposals/decisions for this project (cross-session context)
  const config = store.readConfig();
  let memoryContext: string[] | undefined;
  const memoryHint = buildProposeHint(config.memory, config.project.name, input.change_name, input.intent);

  const { data: pastMemories, backend: memBackend, error: recallError } = await tryRecall(
    config.memory,
    `proposals architecture decisions ${input.intent} ${input.scope.join(" ")}`,
    { scope: `specia/${config.project.name}`, limit: 5 },
  );
  if (pastMemories.length > 0) {
    memoryContext = formatMemoryContext(pastMemories);
    warnings.push(`memory_context: Found ${pastMemories.length} related memory(ies) via ${memBackend}`);
  }
  if (recallError) {
    warnings.push(recallError);
  }

  // Create proposal.md
  try {
    const proposalContent = renderProposal({
      changeName: input.change_name,
      intent: input.intent,
      scope: input.scope,
      approach: input.approach,
      createdAt: new Date().toISOString(),
    });

    store.writeArtifact(input.change_name, "proposal", proposalContent);

    // Set initial state with audit_policy — this is the ONLY place audit_policy is set
    const now = new Date().toISOString();
    const historyEntries = [];

    // R-01: Record audit opt-out decision in history if applicable
    if (input.skip_audit) {
      historyEntries.push({
        phase: "proposal" as const,
        status: "complete" as const,
        timestamp: now,
      });
    }

    store.setChangeState(input.change_name, {
      change: input.change_name,
      phase: "proposal",
      status: "complete",
      created: now,
      updated: now,
      phases_completed: ["proposal"],
      history: [],
      audit_policy: auditPolicy,
    });

    // Store proposal in memory for future cross-session context
    const { error: storeError } = await tryStore(config.memory, proposalContent, {
      topic_key: `specia/${config.project.name}/proposal/${input.change_name}`,
      topic: "proposals",
      summary: `Proposal for "${input.change_name}": ${input.intent}`,
      importance: "medium",
    });
    if (storeError) {
      warnings.push(storeError);
    }
  } catch (err) {
    return fail(toolName, [{
      code: ErrorCodes.IO_ERROR,
      message: `Failed to create proposal: ${err instanceof Error ? err.message : String(err)}`,
    }], { change: input.change_name, duration_ms: Date.now() - start });
  }

  return ok(
    toolName,
    {
      proposal_path: `.specia/changes/${input.change_name}/proposal.md`,
      change_name: input.change_name,
      memory_context: memoryContext,
      memory_hint: memBackend === "engram" ? memoryHint : undefined,
    },
    { change: input.change_name, duration_ms: Date.now() - start, warnings },
  );
}
