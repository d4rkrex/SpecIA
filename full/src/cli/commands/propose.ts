/**
 * CLI `specia propose` — Create a new change proposal.
 *
 * Reads content from stdin (pipe support) or --intent flag.
 * Calls FileStore + renderProposal directly.
 * Design refs: Decision 18, Decision 20
 */

import { Command } from "commander";
import { FileStore } from "../../services/store.js";
import { renderProposal } from "../../services/template.js";
import {
  success,
  error,
  info,
  jsonOutput,
  isJsonMode,
  readStdin,
} from "../output.js";
import { sanitizeInput } from "../security/validators.js";

export function registerProposeCommand(program: Command): void {
  program
    .command("propose <change-name>")
    .description("Create a new change proposal")
    .option("--intent <intent>", "Intent / purpose of the change")
    .option("--scope <areas...>", "Scope areas affected")
    .option("--approach <approach>", "Implementation approach")
    .action(async (changeName: string, opts: {
      intent?: string;
      scope?: string[];
      approach?: string;
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

      // Check duplicate
      const existing = store.getChangeState(changeName);
      if (existing) {
        error(`Change "${changeName}" already exists.`);
        process.exitCode = 1;
        return;
      }

      // Try reading intent from stdin if not provided
      let intent = opts.intent;
      if (!intent) {
        const stdinContent = await readStdin();
        if (stdinContent) {
          intent = stdinContent;
        }
      }

      if (!intent) {
        error("Intent is required. Use --intent or pipe content via stdin.");
        process.exitCode = 1;
        return;
      }

      const scope = opts.scope ?? ["general"];

      try {
        const proposalContent = renderProposal({
          changeName,
          intent,
          scope,
          approach: opts.approach,
          createdAt: new Date().toISOString(),
        });

        store.writeArtifact(changeName, "proposal", proposalContent);
        store.transitionPhase(changeName, "proposal", "complete");
      } catch (err) {
        error(`Failed to create proposal: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
        return;
      }

      if (isJsonMode()) {
        jsonOutput({
          status: "success",
          change_name: changeName,
          proposal_path: `.specia/changes/${changeName}/proposal.md`,
        });
      } else {
        success(`Proposal created for "${changeName}"`);
        info(`  Path: .specia/changes/${changeName}/proposal.md`);
        info(`  Next: specia spec ${changeName}`);
      }
    });
}
