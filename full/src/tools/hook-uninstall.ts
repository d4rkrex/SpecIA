/**
 * specia_hook_uninstall — Remove Guardian pre-commit hook.
 *
 * Removes the Guardian marker block from .git/hooks/pre-commit.
 * Preserves other hooks (husky, lint-staged, etc.).
 *
 * v0.2: Design Decision 15 (Hook Management)
 */

import { FileStore } from "../services/store.js";
import { HookManager } from "../services/hook-manager.js";
import { HookUninstallInputSchema } from "./schemas.js";
import { ok, fail, ErrorCodes } from "../types/tools.js";
import type { ToolResult } from "../types/index.js";
import type { UninstallResult } from "../services/hook-manager.js";

export async function handleHookUninstall(
  args: unknown,
  rootDir: string,
): Promise<ToolResult<UninstallResult>> {
  const start = Date.now();
  const toolName = "specia_hook_uninstall";

  // Input validation (empty schema but still validate)
  const parsed = HookUninstallInputSchema.safeParse(args);
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
    const result = hookManager.uninstallHook();

    const warnings: string[] = [];
    if (result.had_other_hooks) {
      warnings.push(
        "Other pre-commit hooks were preserved. Only the Guardian block was removed.",
      );
    }

    return ok(toolName, result, {
      duration_ms: Date.now() - start,
      warnings,
    });
  } catch (err) {
    return fail(
      toolName,
      [
        {
          code: ErrorCodes.IO_ERROR,
          message: err instanceof Error ? err.message : String(err),
        },
      ],
      { duration_ms: Date.now() - start },
    );
  }
}
