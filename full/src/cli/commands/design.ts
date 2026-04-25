/**
 * CLI `specia design` — Optional architecture design document.
 *
 * Reads design content from stdin or --content flag.
 * Calls FileStore directly.
 * Design refs: Decision 9, Decision 18, Decision 20
 */

import { Command } from "commander";
import { FileStore } from "../../services/store.js";
import { renderDesignPrompt } from "../../services/template.js";
import {
  success,
  error,
  info,
  dim,
  jsonOutput,
  isJsonMode,
  readStdin,
} from "../output.js";
import { sanitizeInput } from "../security/validators.js";

/** Minimum length for design content to be considered non-trivial. */
const MIN_DESIGN_LENGTH = 50;

export function registerDesignCommand(program: Command): void {
  program
    .command("design <change-name>")
    .description("Create or update the architecture design document (optional)")
    .option("--content <content>", "Design content (markdown)")
    .option("--prompt", "Show the design prompt template instead of saving")
    .action(async (changeName: string, opts: {
      content?: string;
      prompt?: boolean;
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

      // Check change exists
      const state = store.getChangeState(changeName);
      if (!state) {
        error(`Change "${changeName}" not found. Run \`specia propose\` first.`);
        process.exitCode = 1;
        return;
      }

      // Check spec exists
      const specContent = store.readArtifact(changeName, "spec");
      if (!specContent) {
        error("Spec must exist before creating a design. Run `specia spec` first.");
        process.exitCode = 1;
        return;
      }

      // Prompt mode: show design template
      if (opts.prompt) {
        const proposalContent = store.readArtifact(changeName, "proposal");
        if (!proposalContent) {
          error("Proposal must exist before creating a design.");
          process.exitCode = 1;
          return;
        }

        const designPrompt = renderDesignPrompt(changeName, proposalContent, specContent);

        if (isJsonMode()) {
          jsonOutput({
            status: "success",
            change_name: changeName,
            design_prompt: designPrompt,
          });
        } else {
          console.log(designPrompt);
        }
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
        error("Design content is required. Use --content, pipe via stdin, or use --prompt to see the template.");
        process.exitCode = 1;
        return;
      }

      // Validate non-trivial content
      if (content.trim().length < MIN_DESIGN_LENGTH) {
        error(`Design content is too short (${content.trim().length} chars). Minimum: ${MIN_DESIGN_LENGTH}.`);
        process.exitCode = 1;
        return;
      }

      try {
        store.writeArtifact(changeName, "design", content);
        store.transitionPhase(changeName, "design", "complete");
      } catch (err) {
        error(`Failed to save design: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
        return;
      }

      if (isJsonMode()) {
        jsonOutput({
          status: "success",
          change_name: changeName,
          design_path: `.specia/changes/${changeName}/design.md`,
        });
      } else {
        success(`Design saved for "${changeName}"`);
        info(`  Path: .specia/changes/${changeName}/design.md`);
        dim("  Design is optional. It will be included as context in the security review.");
        info(`  Next: specia review ${changeName}`);
      }
    });
}
