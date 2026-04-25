/**
 * specia_hook_status — Check Guardian pre-commit hook status.
 *
 * Reports whether the hook is installed, its mode, and path.
 *
 * v0.2: Design Decision 15 (Hook Management)
 */

import { FileStore } from "../services/store.js";
import { HookManager } from "../services/hook-manager.js";
import { HookStatusInputSchema } from "./schemas.js";
import { ok, fail, ErrorCodes } from "../types/tools.js";
import type { ToolResult } from "../types/index.js";
import type { HookStatus } from "../services/hook-manager.js";

export async function handleHookStatus(
  args: unknown,
  rootDir: string,
): Promise<ToolResult<HookStatus>> {
  const start = Date.now();
  const toolName = "specia_hook_status";

  // Input validation (empty schema)
  const parsed = HookStatusInputSchema.safeParse(args);
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
    const status = hookManager.getHookStatus();

    return ok(toolName, status, {
      duration_ms: Date.now() - start,
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
