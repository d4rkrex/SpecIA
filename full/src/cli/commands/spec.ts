/**
 * CLI `specia spec` — Write specifications for a change.
 *
 * Reads spec content from stdin (pipe support) or --content flag.
 * In the CLI context, spec content is plain markdown (not structured JSON).
 * Calls FileStore directly.
 * Design refs: Decision 18, Decision 20
 */

import { Command } from "commander";
import { FileStore } from "../../services/store.js";
import {
  success,
  error,
  info,
  jsonOutput,
  isJsonMode,
  readStdin,
} from "../output.js";
import { sanitizeInput } from "../security/validators.js";

export function registerSpecCommand(program: Command): void {
  program
    .command("spec <change-name>")
    .description("Write or update the specification for a change")
    .option("--content <content>", "Spec content (markdown)")
    .action(async (changeName: string, opts: {
      content?: string;
    }) => {
      // SECURITY: Sanitize change name (Mitigation AC-001, T-02)
      changeName = sanitizeInput(changeName, "change_name");
      
      const rootDir = process.cwd();
      const store = new FileStore(rootDir);

      if (!store.isInitialized()) {
        error("Not initialized. Run `specia init` first.");
        process.exitCode = 1;
        return;
      }

      // Check proposal exists
      const proposal = store.readArtifact(changeName, "proposal");
      if (!proposal) {
        error("Proposal must exist before writing spec. Run `specia propose` first.");
        process.exitCode = 1;
        return;
      }

      // Read content from flag or stdin
      let content = opts.content;
      if (!content) {
        const stdinContent = await readStdin();
        if (stdinContent) {
          content = stdinContent;
        }
      }

      if (!content) {
        error("Spec content is required. Use --content or pipe content via stdin.");
        process.exitCode = 1;
        return;
      }

      try {
        store.writeArtifact(changeName, "spec", content);
        store.transitionPhase(changeName, "spec", "complete");
      } catch (err) {
        error(`Failed to write spec: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
        return;
      }

      if (isJsonMode()) {
        jsonOutput({
          status: "success",
          change_name: changeName,
          spec_path: `.specia/changes/${changeName}/spec.md`,
        });
      } else {
        success(`Spec written for "${changeName}"`);
        info(`  Path: .specia/changes/${changeName}/spec.md`);
        info(`  Next: specia design ${changeName} (optional) or specia review ${changeName}`);
      }
    });
}
