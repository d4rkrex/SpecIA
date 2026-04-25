/**
 * specia_hook_install — Install Guardian pre-commit hook.
 *
 * Creates/modifies .git/hooks/pre-commit with marker blocks.
 * Idempotent — safe to run multiple times.
 *
 * v0.2: Design Decision 15 (Hook Management)
 */

import { FileStore } from "../services/store.js";
import { HookManager } from "../services/hook-manager.js";
import { HookInstallInputSchema } from "./schemas.js";
import { ok, fail, ErrorCodes } from "../types/tools.js";
import type { ToolResult } from "../types/index.js";
import type { InstallResult } from "../services/hook-manager.js";

export async function handleHookInstall(
  args: unknown,
  rootDir: string,
): Promise<ToolResult<InstallResult>> {
  const start = Date.now();
  const toolName = "specia_hook_install";

  // Input validation
  const parsed = HookInstallInputSchema.safeParse(args);
  if (!parsed.success) {
    return fail(
      toolName,
      parsed.error.issues.map((i) => ({
        code: ErrorCodes.VALIDATION_ERROR,
        message: i.message,
        field: i.path.join("."),
      })),
      { duration_ms: Date.now() - start },
    );
  }

  const input = parsed.data;
  const store = new FileStore(rootDir);

  // Check project is initialized
  if (!store.isInitialized()) {
    return fail(
      toolName,
      [
        {
          code: ErrorCodes.NOT_INITIALIZED,
          message:
            "Run specia_init first — .specia/config.yaml not found.",
        },
      ],
      { duration_ms: Date.now() - start },
    );
  }

  try {
    const hookManager = new HookManager(rootDir);
    const result = hookManager.installHook(input.mode);

    // v0.4: Update config.yaml with spec_validation if provided
    if (input.spec_validation) {
      const config = store.readConfig();
      config.guardian = config.guardian || {
        enabled: true,
        mode: input.mode,
        exclude: [],
        validation: {
          require_spec: true,
          require_review: true,
          require_mitigations: true,
        },
      };
      config.guardian.spec_validation = {
        ...config.guardian.spec_validation,
        ...input.spec_validation,
      };
      store.writeConfig(config);
    }

    const warnings: string[] = [];
    if (result.coexisting_hooks) {
      warnings.push(
        "Existing pre-commit hooks detected. Guardian was added alongside them using marker blocks.",
      );
    }
    if (input.spec_validation?.enabled) {
      warnings.push(
        "Layer 4 spec-aware validation enabled. Guardian will validate code against spec requirements.",
      );
    }

    return ok(toolName, result, {
      duration_ms: Date.now() - start,
      warnings,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : String(err);

    // Determine error code
    const code = message.includes("Not a git repository")
      ? ErrorCodes.NOT_GIT_REPO
      : ErrorCodes.HOOK_INSTALL_FAILED;

    return fail(toolName, [{ code, message }], {
      duration_ms: Date.now() - start,
    });
  }
}
