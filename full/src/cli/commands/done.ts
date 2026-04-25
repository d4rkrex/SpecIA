/**
 * CLI `specia done` — Archive a completed change.
 *
 * Copies spec to .specia/specs/ with review frontmatter,
 * removes the change directory.
 * Calls FileStore.archiveChange directly.
 *
 * v0.7: Accepts "audit" phase (parity with MCP tool), adds --force flag,
 *       validates change-name with kebab-case regex (E-01),
 *       uses verified archiveChange() return path.
 * Design refs: Decision 18, Decision 20
 */

import * as path from "node:path";
import { Command } from "commander";
import { FileStore } from "../../services/store.js";
import {
  success,
  error,
  warn,
  info,
  jsonOutput,
  isJsonMode,
} from "../output.js";
import { sanitizeInput, ValidationError } from "../security/validators.js";

/** Kebab-case regex — must match changeNameSchema in tools/schemas.ts (E-01). */
const CHANGE_NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function registerDoneCommand(program: Command): void {
  program
    .command("done <change-name>")
    .description("Archive a completed change")
    .option("--force", "Emergency override — bypass the mandatory audit gate")
    .action(async (changeName: string, opts: { force?: boolean }) => {
      // SECURITY: Sanitize change name (Mitigation AC-001, T-02)
      try {
        changeName = sanitizeInput(changeName, "change_name");
      } catch (err) {
        if (err instanceof ValidationError) {
          error(`Invalid change name: ${err.message}`);
        } else {
          error(`Validation failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        process.exitCode = 1;
        return;
      }
      
      const rootDir = process.cwd();
      const store = new FileStore(rootDir);

      // E-01 / AC-001: Validate change name before any filesystem operation
      if (!CHANGE_NAME_RE.test(changeName)) {
        error(
          `Invalid change name "${changeName}". ` +
          `Must be lowercase kebab-case (e.g., auth-refactor).`,
        );
        process.exitCode = 1;
        return;
      }

      if (!store.isInitialized()) {
        error("Not initialized. Run `specia init` first.");
        process.exitCode = 1;
        return;
      }

      // Check change exists
      const state = store.getChangeState(changeName);
      if (!state) {
        error(`Change "${changeName}" not found.`);
        process.exitCode = 1;
        return;
      }

      // v0.7: Accept either "tasks" or "audit" phase as archivable (parity with MCP tool)
      const isReady =
        (state.phase === "tasks" || state.phase === "audit") &&
        state.status === "complete";

      if (!isReady) {
        error(
          `Change "${changeName}" is not ready for archival. ` +
          `Current: ${state.phase} (${state.status}). ` +
          `All phases through "tasks" must be complete.`,
        );
        process.exitCode = 1;
        return;
      }

      // v0.7: Enforce mandatory audit gate (parity with MCP tool)
      const auditPolicy = state.audit_policy ?? "required";
      const auditCompleted = state.phases_completed.includes("audit");

      if (auditPolicy === "required" && !auditCompleted) {
        if (opts.force) {
          warn("EMERGENCY OVERRIDE: Audit gate bypassed via --force flag.");
        } else {
          error(
            `Post-implementation audit is mandatory for change "${changeName}". ` +
            `Run \`specia audit ${changeName}\` first, or use --force to override.`,
          );
          process.exitCode = 1;
          return;
        }
      }

      try {
        const archivedAbsPath = store.archiveChange(changeName, { force: opts.force });
        const archivedRelPath = path.relative(rootDir, archivedAbsPath);

        if (isJsonMode()) {
          jsonOutput({
            status: "success",
            change_name: changeName,
            archived_path: archivedRelPath,
          });
        } else {
          success(`Change "${changeName}" archived.`);
          info(`  Spec: ${archivedRelPath}`);
        }
      } catch (err) {
        error(`Failed to archive: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
        return;
      }
    });
}
