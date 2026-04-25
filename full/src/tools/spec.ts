/**
 * specia_spec — Write specifications for a change.
 *
 * Requires proposal to exist. Creates spec.md with requirements and scenarios.
 *
 * Spec refs: Domain 2 (specia_spec — all scenarios)
 * Design refs: Decision 2 (FileStore), Decision 6 (Tool Interface Contract)
 */

import { FileStore } from "../services/store.js";
import { renderSpec } from "../services/template.js";
import { tryRecall, tryStore, buildSpecHint, formatMemoryContext } from "../services/memory-ops.js";
import type { MemoryHint } from "../services/memory-ops.js";
import { SpecInputSchema } from "./schemas.js";
import { ok, fail, ErrorCodes } from "../types/tools.js";
import type { ToolResult } from "../types/index.js";

export interface SpecResult {
  spec_path: string;
  requirements_count: number;
  scenarios_count: number;
  memory_context?: string[];
  memory_hint?: MemoryHint;
}

export async function handleSpec(
  args: unknown,
  rootDir: string,
): Promise<ToolResult<SpecResult>> {
  const start = Date.now();
  const toolName = "specia_spec";
  const warnings: string[] = [];

  // Input validation
  const parsed = SpecInputSchema.safeParse(args);
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

  // Check proposal exists
  const proposal = store.readArtifact(input.change_name, "proposal");
  if (!proposal) {
    return fail(toolName, [{
      code: ErrorCodes.MISSING_DEPENDENCY,
      message: "Proposal must exist before writing spec. Run specia_propose first.",
      dependency: "proposal",
    }], { change: input.change_name, duration_ms: Date.now() - start });
  }

  // Count total scenarios
  const scenariosCount = input.requirements.reduce(
    (sum, req) => sum + req.scenarios.length,
    0,
  );

  // Recall similar specs for consistency (cross-session context)
  const config = store.readConfig();
  let memoryContext: string[] | undefined;
  const memoryHint = buildSpecHint(config.memory, config.project.name, input.change_name);

  const reqNames = input.requirements.map((r) => r.name).join(" ");
  const { data: pastSpecs, backend: memBackend, error: recallError } = await tryRecall(
    config.memory,
    `spec requirements scenarios ${reqNames} ${config.project.name}`,
    { scope: `specia/${config.project.name}`, limit: 5 },
  );
  if (pastSpecs.length > 0) {
    memoryContext = formatMemoryContext(pastSpecs);
    warnings.push(`memory_context: Found ${pastSpecs.length} related spec(s) via ${memBackend}`);
  }
  if (recallError) {
    warnings.push(recallError);
  }

  // Create spec.md
  try {
    const specContent = renderSpec({
      changeName: input.change_name,
      requirements: input.requirements,
      createdAt: new Date().toISOString(),
    });

    store.writeArtifact(input.change_name, "spec", specContent);
    store.transitionPhase(input.change_name, "spec", "complete");

    // Store spec in memory for future cross-session context
    const { error: storeError } = await tryStore(config.memory, specContent, {
      topic_key: `specia/${config.project.name}/spec/${input.change_name}`,
      topic: "specs",
      summary: `Spec for "${input.change_name}": ${input.requirements.length} requirements, ${scenariosCount} scenarios`,
      importance: "medium",
    });
    if (storeError) {
      warnings.push(storeError);
    }
  } catch (err) {
    return fail(toolName, [{
      code: ErrorCodes.IO_ERROR,
      message: `Failed to create spec: ${err instanceof Error ? err.message : String(err)}`,
    }], { change: input.change_name, duration_ms: Date.now() - start });
  }

  return ok(
    toolName,
    {
      spec_path: `.specia/changes/${input.change_name}/spec.md`,
      requirements_count: input.requirements.length,
      scenarios_count: scenariosCount,
      memory_context: memoryContext,
      memory_hint: memBackend === "engram" ? memoryHint : undefined,
    },
    { change: input.change_name, duration_ms: Date.now() - start, warnings },
  );
}
