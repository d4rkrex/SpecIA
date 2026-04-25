/**
 * specia_init — Project initialization tool.
 *
 * Asks exactly 4 questions, auto-detects stack, creates .specia/ directory
 * with config.yaml and context.md. Optionally persists context to Alejandria.
 *
 * Spec refs: Domain 2 (specia_init — all scenarios), Domain 10 (Exactly 4 Questions)
 *            Domain 7 (Context persisted on init)
 * Design refs: Decision 2 (FileStore), Decision 1 (Tool handlers),
 *              Decision 4 (Alejandria context persistence)
 */

import * as path from "node:path";
import { FileStore } from "../services/store.js";
import { detectStack } from "../services/detect.js";
import { renderContext } from "../services/template.js";
import { tryStore } from "../services/memory-ops.js";
import { HookManager } from "../services/hook-manager.js";
import { InitInputSchema } from "./schemas.js";
import { ok, fail, ErrorCodes } from "../types/tools.js";
import type { ToolResult, VtspecConfig } from "../types/index.js";

export interface InitResult {
  config_path: string;
  context_path: string;
  detected_stack?: string;
  multiple_stacks?: boolean;
  stack_candidates?: string[];
  /** v0.6: Whether the Guardian pre-commit hook was installed during init. */
  hook_installed?: boolean;
  /** v0.6: Hook installation detail message. */
  hook_message?: string;
  next_steps: string;
}

// ── Hardcoded next-steps guidance (compile-time string constants) ────
// Security: These are string literals by design. NEVER interpolate
// user-controlled input (project description, config values, posture name)
// into these strings. This mitigates prompt injection risk for AI agents
// consuming SpecIA output. (Review: T-01, E-01, AC-001, AC-002)

const NEXT_STEPS_BASE = `SpecIA initialized. Next steps:

1. Create your first change proposal:
   specia_new (or specia_propose) with change_name, intent, and scope.

   Example:
     specia_new({ change_name: "add-auth", intent: "Add JWT authentication", scope: ["src/auth"] })

2. SpecIA workflow: propose → spec → review (mandatory) → tasks
   - specia_propose / specia_new: Create a change proposal
   - specia_spec: Write requirements and scenarios
   - specia_review: Mandatory security review (STRIDE + OWASP Top 10)
   - specia_tasks: Generate implementation tasks with security mitigations

3. Shortcuts:
   - specia_ff: Fast-forward through all phases in sequence
   - specia_continue: Resume at the next incomplete phase`;

const NEXT_STEPS_ENHANCED_POSTURE_SUFFIX =
  "\n\n4. Enhanced security review is enabled for this project. Reviews will include deeper threat analysis and more comprehensive abuse case scenarios.";

/**
 * Build the next_steps string. Uses only hardcoded constants.
 * The posture flag controls whether the enhanced-posture note is appended.
 * No user input is interpolated.
 */
export function buildNextSteps(isEnhancedPosture: boolean): string {
  if (isEnhancedPosture) {
    return NEXT_STEPS_BASE + NEXT_STEPS_ENHANCED_POSTURE_SUFFIX;
  }
  return NEXT_STEPS_BASE;
}

export async function handleInit(
  args: unknown,
  rootDir: string,
): Promise<ToolResult<InitResult>> {
  const start = Date.now();
  const toolName = "specia_init";

  // Input validation
  const parsed = InitInputSchema.safeParse(args);
  if (!parsed.success) {
    const issues = parsed.error.issues;
    return fail(toolName, issues.map((i) => ({
      code: ErrorCodes.VALIDATION_ERROR,
      message: i.message,
      field: i.path.join("."),
    })), { duration_ms: Date.now() - start });
  }

  const input = parsed.data;
  const store = new FileStore(rootDir);

  // Check if already initialized
  if (store.isInitialized()) {
    return fail(toolName, [{
      code: ErrorCodes.ALREADY_INITIALIZED,
      message: ".specia/ already exists. Delete it first or use a different project directory.",
    }], { duration_ms: Date.now() - start });
  }

  // Auto-detect stack if not provided
  const detection = detectStack(rootDir);
  const stack = input.primary_stack ?? detection.detected ?? "Unknown";

  const warnings: string[] = [];

  // Warn about auto-detection results
  if (!input.primary_stack) {
    if (detection.detected) {
      warnings.push(`Auto-detected stack: ${detection.detected}. Confirm or override with primary_stack parameter.`);
      if (detection.multiple) {
        warnings.push(`Multiple stacks detected: ${detection.candidates.join(", ")}. Using "${detection.detected}" as primary.`);
      }
    } else {
      warnings.push("Could not auto-detect stack. Using 'Unknown'. Provide primary_stack parameter to set it.");
    }
  }

  // Build config
  const config: VtspecConfig = {
    version: "0.1",
    project: {
      name: inferProjectName(rootDir),
      description: input.project_description,
      stack,
      conventions: input.conventions,
    },
    security: {
      posture: input.security_posture,
    },
    memory: {
      backend: input.memory_backend,
    },
  };

  // If security_posture was not explicitly provided, note the default
  // (Zod applies the default, so we check if input had it or not)
  // Actually Zod has already defaulted it — we can check via the raw args
  const rawArgs = args as Record<string, unknown>;
  if (!rawArgs?.security_posture) {
    warnings.push('Security posture defaulted to "standard".');
  }

  // Create directory structure and write files
  const contextContent = renderContext(config);
  try {
    store.ensureDirectoryStructure();
    store.writeConfig(config);
    store.writeContext(contextContent);
  } catch (err) {
    return fail(toolName, [{
      code: ErrorCodes.IO_ERROR,
      message: `Failed to create .specia/ directory: ${err instanceof Error ? err.message : String(err)}`,
    }], { duration_ms: Date.now() - start });
  }

  // Persist project context to memory (any backend)
  {
    const { data: stored, error: storeError } = await tryStore(config.memory, contextContent, {
      topic_key: `specia/${config.project.name}/context`,
      topic: "project-context",
      summary: `SpecIA project context for ${config.project.name}: ${config.project.stack}, posture=${config.security.posture}`,
      importance: "high",
    });
    if (storeError) {
      warnings.push(storeError);
    } else if (!stored && config.memory.backend !== "local") {
      warnings.push("alejandria_unavailable: Could not persist project context. Local files created successfully.");
    }
  }

  // v0.6: Optionally install Guardian pre-commit hook
  // Default: true (install). Skips silently if not a git repo.
  // Uses warn mode — does not block commits on first init.
  let hookInstalled: boolean | undefined;
  let hookMessage: string | undefined;

  if (input.install_hook) {
    try {
      const hookManager = new HookManager(rootDir);
      const hookResult = hookManager.installHook("warn");
      hookInstalled = true;
      hookMessage = "Guardian pre-commit hook installed (warn mode). Use specia_hook_install to customize.";
      if (hookResult.coexisting_hooks) {
        warnings.push("Existing pre-commit hooks detected. Guardian was added alongside them using marker blocks.");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("Not a git repository")) {
        // Not a git repo — skip silently, just inform
        hookInstalled = false;
        hookMessage = "Guardian hook skipped (not a git repository).";
      } else {
        // Unexpected error — warn but don't fail init
        hookInstalled = false;
        hookMessage = `Guardian hook installation failed: ${message}`;
        warnings.push(`hook_install_failed: ${message}`);
      }
    }
  }

  // Build next-steps guidance with hardcoded constants only.
  // Security posture check uses a boolean flag — the actual posture name
  // is NOT interpolated into the guidance text. (Review: I-02, AC-002)
  const isEnhancedPosture = config.security.posture === "elevated" || config.security.posture === "paranoid";
  const nextSteps = buildNextSteps(isEnhancedPosture);

  return ok(
    toolName,
    {
      config_path: ".specia/config.yaml",
      context_path: ".specia/context.md",
      detected_stack: detection.detected ?? undefined,
      multiple_stacks: detection.multiple || undefined,
      stack_candidates: detection.candidates.length > 0 ? detection.candidates : undefined,
      hook_installed: hookInstalled,
      hook_message: hookMessage,
      next_steps: nextSteps,
    },
    { duration_ms: Date.now() - start, warnings },
  );
}

function inferProjectName(rootDir: string): string {
  return path.basename(rootDir) || "unnamed-project";
}
