/**
 * Bake commands — Project configuration shortcuts
 * 
 * Commands:
 * - specia bake create <name> [options]
 * - specia bake list
 * - specia bake show <name>
 * - specia bake delete <name>
 * - specia bake verify
 */

import { Command } from "commander";
import { BakeService, type BakedConfig } from "../../services/bake.js";
import { success, error, info, table, warn } from "../output.js";

export function registerBakeCommand(program: Command): void {
  const bake = program
    .command("bake")
    .description("Manage baked project configurations");

  // bake create
  bake
    .command("create <name>")
    .description("Create a new baked config")
    .requiredOption("--project-dir <path>", "Project directory (absolute path)")
    .option("--posture <level>", "Security posture (standard|elevated|paranoid)", "standard")
    .option("--memory <backend>", "Memory backend (alejandria|engram|local)", "local")
    .option("--provider <name>", "LLM provider (anthropic|openai)", "anthropic")
    .option("--api-key <key>", "API key (use env:VAR_NAME format for secrets)")
    .option("--model <name>", "LLM model name")
    .action(async (name: string, opts: {
      projectDir: string;
      posture?: string;
      memory?: string;
      provider?: string;
      apiKey?: string;
      model?: string;
    }) => {
      try {
        const service = new BakeService();

        // Validate posture
        if (opts.posture && !["standard", "elevated", "paranoid"].includes(opts.posture)) {
          error(`Invalid posture: ${opts.posture}. Must be standard, elevated, or paranoid.`);
          process.exitCode = 1;
          return;
        }

        // Validate memory backend
        if (opts.memory && !["alejandria", "engram", "local"].includes(opts.memory)) {
          error(`Invalid memory backend: ${opts.memory}. Must be alejandria, engram, or local.`);
          process.exitCode = 1;
          return;
        }

        // Validate provider
        if (opts.provider && !["anthropic", "openai"].includes(opts.provider)) {
          error(`Invalid provider: ${opts.provider}. Must be anthropic or openai.`);
          process.exitCode = 1;
          return;
        }

        // Warn if API key is not using env: reference
        if (opts.apiKey && !opts.apiKey.startsWith("env:")) {
          warn(
            "API key provided as literal value. This is NOT secure. " +
            "Use --api-key env:VAR_NAME instead to reference an environment variable."
          );
        }

        const config: BakedConfig = {
          project_dir: opts.projectDir,
          posture: opts.posture as "standard" | "elevated" | "paranoid",
          memory: opts.memory as "alejandria" | "engram" | "local",
          provider: opts.provider as "anthropic" | "openai",
          api_key: opts.apiKey,
          model: opts.model,
        };

        service.create(name, config);
        success(`Baked config '${name}' created at ~/.config/specia/baked.json`);
        info(`Use it with: specia @${name} <command>`);
      } catch (err) {
        error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });

  // bake list
  bake
    .command("list")
    .description("List all baked configs")
    .action(async () => {
      try {
        const service = new BakeService();
        const configs = service.list();

        if (configs.length === 0) {
          info("No baked configs found. Create one with: specia bake create <name>");
          return;
        }

        // Display as table with masked secrets
        const rows = configs.map(({ name, config }) => {
          const masked = BakeService.maskSecrets(config);
          return {
            name,
            project_dir: masked.project_dir,
            posture: masked.posture ?? "-",
            memory: masked.memory ?? "-",
            provider: masked.provider ?? "-",
            api_key: masked.api_key ?? "-",
          };
        });

        table(
          [
            { header: "NAME", key: "name", width: 15 },
            { header: "PROJECT_DIR", key: "project_dir", width: 40 },
            { header: "POSTURE", key: "posture", width: 10 },
            { header: "MEMORY", key: "memory", width: 10 },
            { header: "PROVIDER", key: "provider", width: 10 },
            { header: "API_KEY", key: "api_key", width: 20 },
          ],
          rows
        );

        info(`\nUse with: specia @<name> <command>`);
      } catch (err) {
        error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });

  // bake show
  bake
    .command("show <name>")
    .description("Show details for a specific baked config")
    .action(async (name: string) => {
      try {
        const service = new BakeService();
        const config = service.get(name);

        if (!config) {
          error(`Baked config '${name}' not found.`);
          info("Run 'specia bake list' to see available configs.");
          process.exitCode = 1;
          return;
        }

        const masked = BakeService.maskSecrets(config);

        console.log(`\nBaked Config: ${name}\n`);
        console.log(`  Project Dir:  ${masked.project_dir}`);
        console.log(`  Posture:      ${masked.posture ?? "(default)"}`);
        console.log(`  Memory:       ${masked.memory ?? "(default)"}`);
        console.log(`  Provider:     ${masked.provider ?? "(default)"}`);
        console.log(`  API Key:      ${masked.api_key ?? "(none)"}`);
        console.log(`  Model:        ${masked.model ?? "(default)"}`);
        console.log();
      } catch (err) {
        error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });

  // bake delete
  bake
    .command("delete <name>")
    .description("Delete a baked config")
    .action(async (name: string) => {
      try {
        const service = new BakeService();
        service.delete(name);
        success(`Baked config '${name}' deleted`);
      } catch (err) {
        error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });

  // bake verify
  bake
    .command("verify")
    .description("Verify integrity of baked configs")
    .action(async () => {
      try {
        const service = new BakeService();
        const result = service.verify();

        if (result.valid) {
          success(result.message);
        } else {
          warn(result.message);
          process.exitCode = 1;
        }
      } catch (err) {
        error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });
}
