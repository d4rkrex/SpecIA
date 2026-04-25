/**
 * CLI `specia config` — Configuration management subcommands.
 *
 * Subcommands: show, set
 * Calls FileStore directly.
 * Design refs: Decision 18, Decision 20
 */

import { Command } from "commander";
import { FileStore } from "../../services/store.js";
import {
  success,
  error,
  info,
  dim,
  jsonOutput,
  isJsonMode,
} from "../output.js";
import type { VtspecConfig } from "../../types/index.js";

export function registerConfigCommand(program: Command): void {
  const config = program
    .command("config")
    .description("Configuration management");

  // ── show ────────────────────────────────────────────────────────────
  config
    .command("show")
    .description("Show current configuration")
    .action(async () => {
      const rootDir = process.cwd();
      const store = new FileStore(rootDir);

      if (!store.isInitialized()) {
        error("Not initialized. Run `specia init` first.");
        process.exitCode = 1;
        return;
      }

      try {
        const cfg = store.readConfig();

        if (isJsonMode()) {
          jsonOutput(cfg);
        } else {
          info("SpecIA Configuration:");
          info(`  Version: ${cfg.version}`);
          info(`  Project: ${cfg.project.name}`);
          info(`  Description: ${cfg.project.description}`);
          info(`  Stack: ${cfg.project.stack}`);
          info(`  Posture: ${cfg.security.posture}`);
          info(`  Memory: ${cfg.memory.backend}`);

          if (cfg.project.conventions.length > 0) {
            info(`  Conventions: ${cfg.project.conventions.join(", ")}`);
          }

          if (cfg.guardian) {
            info(`  Guardian: ${cfg.guardian.enabled ? "enabled" : "disabled"} (${cfg.guardian.mode})`);
          }

          if (cfg.cli?.llm) {
            info(`  LLM: ${cfg.cli.llm.provider}${cfg.cli.llm.model ? ` (${cfg.cli.llm.model})` : ""}`);
          }

          if (cfg.workflow) {
            info(`  Design phase: ${cfg.workflow.include_design ? "enabled" : "disabled"}`);
          }
        }
      } catch (err) {
        error(`Failed to read config: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
      }
    });

  // ── set ─────────────────────────────────────────────────────────────
  config
    .command("set <key> <value>")
    .description("Set a configuration value (e.g., security.posture standard)")
    .action(async (key: string, value: string) => {
      const rootDir = process.cwd();
      const store = new FileStore(rootDir);

      if (!store.isInitialized()) {
        error("Not initialized. Run `specia init` first.");
        process.exitCode = 1;
        return;
      }

      try {
        const cfg = store.readConfig();
        const updated = applyConfigUpdate(cfg, key, value);

        if (!updated) {
          error(`Unknown config key: ${key}`);
          dim("  Supported keys: security.posture, memory.backend, project.description, project.stack, workflow.include_design, cli.llm.provider, cli.llm.model, cli.llm.api_key_env, guardian.enabled, guardian.mode");
          process.exitCode = 1;
          return;
        }

        store.writeConfig(cfg);

        if (isJsonMode()) {
          jsonOutput({ status: "success", key, value });
        } else {
          success(`Set ${key} = ${value}`);
        }
      } catch (err) {
        error(`Failed to update config: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
      }
    });
}

// ── Helpers ──────────────────────────────────────────────────────────

function applyConfigUpdate(cfg: VtspecConfig, key: string, value: string): boolean {
  switch (key) {
    case "security.posture":
      if (!["standard", "elevated", "paranoid"].includes(value)) {
        throw new Error(`Invalid posture: ${value}. Must be: standard, elevated, paranoid.`);
      }
      cfg.security.posture = value as "standard" | "elevated" | "paranoid";
      return true;

    case "memory.backend":
      if (!["local", "alejandria", "engram"].includes(value)) {
        throw new Error(`Invalid backend: ${value}. Must be: local, alejandria, engram.`);
      }
      cfg.memory.backend = value as "local" | "alejandria" | "engram";
      return true;

    case "project.description":
      cfg.project.description = value;
      return true;

    case "project.stack":
      cfg.project.stack = value;
      return true;

    case "workflow.include_design":
      cfg.workflow = cfg.workflow ?? { include_design: false };
      cfg.workflow.include_design = value === "true";
      return true;

    case "cli.llm.provider":
      if (!["anthropic", "openai"].includes(value)) {
        throw new Error(`Invalid provider: ${value}. Must be: anthropic, openai.`);
      }
      cfg.cli = cfg.cli ?? {};
      cfg.cli.llm = cfg.cli.llm ?? { provider: value as "anthropic" | "openai", api_key_env: value === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY" };
      cfg.cli.llm.provider = value as "anthropic" | "openai";
      return true;

    case "cli.llm.model":
      cfg.cli = cfg.cli ?? {};
      cfg.cli.llm = cfg.cli.llm ?? { provider: "anthropic", api_key_env: "ANTHROPIC_API_KEY" };
      cfg.cli.llm.model = value;
      return true;

    case "cli.llm.api_key_env":
      cfg.cli = cfg.cli ?? {};
      cfg.cli.llm = cfg.cli.llm ?? { provider: "anthropic", api_key_env: value };
      cfg.cli.llm.api_key_env = value;
      return true;

    case "guardian.enabled":
      cfg.guardian = cfg.guardian ?? { enabled: true, mode: "warn", exclude: [], validation: { require_spec: true, require_review: true, require_mitigations: true } };
      cfg.guardian.enabled = value === "true";
      return true;

    case "guardian.mode":
      if (!["strict", "warn"].includes(value)) {
        throw new Error(`Invalid mode: ${value}. Must be: strict, warn.`);
      }
      cfg.guardian = cfg.guardian ?? { enabled: true, mode: value as "strict" | "warn", exclude: [], validation: { require_spec: true, require_review: true, require_mitigations: true } };
      cfg.guardian.mode = value as "strict" | "warn";
      return true;

    default:
      return false;
  }
}
