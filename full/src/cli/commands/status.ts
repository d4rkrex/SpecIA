/**
 * CLI `specia status` — Show table of changes and their phases.
 *
 * This is a NEW CLI-only command (not an MCP tool).
 * Calls FileStore.listChanges directly.
 * Design refs: Decision 18
 */

import { Command } from "commander";
import { FileStore } from "../../services/store.js";
import {
  error,
  info,
  dim,
  jsonOutput,
  isJsonMode,
  table,
  phaseColor,
  statusColor,
} from "../output.js";

export function registerStatusCommand(program: Command): void {
  program
    .command("status")
    .description("Show all changes and their current phase/status")
    .option("--change <name>", "Show detailed status for a specific change")
    .action(async (opts: { change?: string }) => {
      const rootDir = process.cwd();
      const store = new FileStore(rootDir);

      if (!store.isInitialized()) {
        error("Not initialized. Run `specia init` first.");
        process.exitCode = 1;
        return;
      }

      // Detailed view for a specific change
      if (opts.change) {
        const state = store.getChangeState(opts.change);
        if (!state) {
          error(`Change "${opts.change}" not found.`);
          process.exitCode = 1;
          return;
        }

        if (isJsonMode()) {
          jsonOutput(state);
          return;
        }

        info(`Change: ${state.change}`);
        info(`  Phase: ${phaseColor(state.phase)}`);
        info(`  Status: ${statusColor(state.status)}`);
        info(`  Created: ${state.created}`);
        info(`  Updated: ${state.updated}`);

        // Show which artifacts exist
        const artifacts = ["proposal", "spec", "design", "review", "tasks"] as const;
        const existing = artifacts.filter(a => store.readArtifact(opts.change!, a) !== null);
        info(`  Artifacts: ${existing.join(", ") || "none"}`);

        // Show phases completed
        if (state.phases_completed.length > 0) {
          info(`  Completed: ${state.phases_completed.map(phaseColor).join(" → ")}`);
        }

        return;
      }

      // List all changes
      const changes = store.listChanges();

      if (isJsonMode()) {
        jsonOutput({ changes, total: changes.length });
        return;
      }

      if (changes.length === 0) {
        dim("No active changes. Run `specia propose <name>` to start.");
        return;
      }

      const config = store.readConfig();
      info(`Project: ${config.project.name} (${config.security.posture})`);
      console.log("");

      table(
        [
          { header: "Change", key: "name", width: 30 },
          { header: "Phase", key: "phase", width: 12, color: (v) => phaseColor(v.trim()) },
          { header: "Status", key: "status", width: 14, color: (v) => statusColor(v.trim()) },
          { header: "Updated", key: "updated", width: 24 },
        ],
        changes.map(c => ({
          name: c.name,
          phase: c.phase,
          status: c.status,
          updated: c.updated,
        })),
      );
    });
}
