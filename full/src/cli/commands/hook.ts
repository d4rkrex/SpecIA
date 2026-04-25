/**
 * CLI `specia hook` — Guardian pre-commit hook management subcommands.
 *
 * Subcommands: install, uninstall, status
 * Calls HookManager service directly.
 * Design refs: Decision 15, Decision 18, Decision 20
 */

import { Command } from "commander";
import { FileStore } from "../../services/store.js";
import { HookManager } from "../../services/hook-manager.js";
import {
  success,
  error,
  warn,
  info,
  dim,
  jsonOutput,
  isJsonMode,
} from "../output.js";
import type { GuardianMode } from "../../types/index.js";

export function registerHookCommand(program: Command): void {
  const hook = program
    .command("hook")
    .description("Guardian pre-commit hook management");

  // ── install ────────────────────────────────────────────────────────
  hook
    .command("install")
    .description("Install the Guardian pre-commit hook")
    .option("--mode <mode>", "Hook mode: strict | warn", "warn")
    .option("--spec-aware", "Enable Layer 4 spec-aware validation", false)
    .action(async (opts: { mode: string; specAware: boolean }) => {
      const rootDir = process.cwd();
      const store = new FileStore(rootDir);

      if (!store.isInitialized()) {
        error("Not initialized. Run `specia init` first.");
        process.exitCode = 1;
        return;
      }

      const mode = (["strict", "warn"].includes(opts.mode)
        ? opts.mode
        : "warn") as GuardianMode;

      try {
        const hookManager = new HookManager(rootDir);
        const result = hookManager.installHook(mode);

        // v0.4: Update config if spec-aware requested
        if (opts.specAware) {
          const config = store.readConfig();
          config.guardian = config.guardian || {
            enabled: true,
            mode: "warn",
            exclude: [],
            validation: {
              require_spec: true,
              require_review: true,
              require_mitigations: true,
            },
          };
          config.guardian.spec_validation = {
            ...config.guardian.spec_validation,
            enabled: true,
          };
          store.writeConfig(config);
        }

        if (isJsonMode()) {
          jsonOutput(result);
        } else {
          success(`Guardian hook installed (${mode} mode)`);
          info(`  Path: ${result.hook_path}`);
          if (opts.specAware) {
            info(`  Layer 4 spec-aware validation: enabled`);
          }
          if (result.coexisting_hooks) {
            warn("Existing pre-commit hooks detected. Guardian was added alongside them.");
          }
        }
      } catch (err) {
        error(`Hook install failed: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
      }
    });

  // ── uninstall ──────────────────────────────────────────────────────
  hook
    .command("uninstall")
    .description("Remove the Guardian pre-commit hook")
    .action(async () => {
      const rootDir = process.cwd();
      const store = new FileStore(rootDir);

      if (!store.isInitialized()) {
        error("Not initialized. Run `specia init` first.");
        process.exitCode = 1;
        return;
      }

      try {
        const hookManager = new HookManager(rootDir);
        const result = hookManager.uninstallHook();

        if (isJsonMode()) {
          jsonOutput(result);
        } else {
          if (result.uninstalled) {
            success("Guardian hook removed.");
            if (result.had_other_hooks) {
              dim("Other pre-commit hooks were preserved.");
            }
          } else {
            info("Guardian hook was not installed.");
          }
        }
      } catch (err) {
        error(`Hook uninstall failed: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
      }
    });

  // ── status ─────────────────────────────────────────────────────────
  hook
    .command("status")
    .description("Check Guardian hook installation status")
    .action(async () => {
      const rootDir = process.cwd();
      const store = new FileStore(rootDir);

      if (!store.isInitialized()) {
        error("Not initialized. Run `specia init` first.");
        process.exitCode = 1;
        return;
      }

      try {
        const hookManager = new HookManager(rootDir);
        const status = hookManager.getHookStatus();

        if (isJsonMode()) {
          jsonOutput(status);
        } else {
          if (!status.git_repo) {
            warn("Not a git repository.");
          } else if (status.installed) {
            success(`Guardian hook installed (${status.mode} mode)`);
            info(`  Path: ${status.hook_path}`);
            
            // v0.4: Show Layer 4 status
            if (status.layer4_enabled !== undefined) {
              if (status.layer4_enabled) {
                info(`  Layer 4 spec-aware validation: enabled`);
                if (status.layer4_cache_stats) {
                  const { l4a_entries, l4b_entries } = status.layer4_cache_stats;
                  dim(`    Cache: ${l4a_entries} L4a entries, ${l4b_entries} L4b entries`);
                }
              } else {
                dim(`  Layer 4 spec-aware validation: disabled`);
              }
            }
          } else {
            info("Guardian hook is not installed.");
            dim("  Run `specia hook install` to enable.");
          }
        }
      } catch (err) {
        error(`Hook status check failed: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
      }
    });
}
