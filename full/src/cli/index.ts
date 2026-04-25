/**
 * SpecIA CLI — Main entry point.
 *
 * Registers all commands with commander.js, handles global flags (--json, --quiet).
 * This is the thin CLI layer — all business logic lives in services/.
 *
 * Design refs: Decision 18 (CLI Architecture), Decision 20 (Services Direct)
 */

import { Command } from "commander";
import { setJsonMode, setQuietMode } from "./output.js";
import { registerInitCommand } from "./commands/init.js";
import { registerProposeCommand } from "./commands/propose.js";
import { registerSpecCommand } from "./commands/spec.js";
import { registerDesignCommand } from "./commands/design.js";
import { registerReviewCommand } from "./commands/review.js";
import { registerTasksCommand } from "./commands/tasks.js";
import { registerDoneCommand } from "./commands/done.js";
import { registerSearchCommand } from "./commands/search.js";
import { registerStatusCommand } from "./commands/status.js";
import { registerHookCommand } from "./commands/hook.js";
import { registerConfigCommand } from "./commands/config.js";
import { registerAuditCommand } from "./commands/audit.js";
import { registerListCommand } from "./commands/list.js";
import { registerStatsCommand } from "./commands/stats.js";
import { registerBakeCommand } from "./commands/bake.js";
import { BakeService } from "../services/bake.js";
// import { registerDebateCommand } from "./commands/debate.js";

const program = new Command();

program
  .name("specia")
  .description("Security-aware spec-driven development CLI")
  .version("2.3.1")
  .option("--json", "Output structured JSON")
  .option("--quiet", "Suppress non-essential output")
  .hook("preAction", (_thisCommand, actionCommand) => {
    // Walk up to root to find global opts
    let cmd: Command | null = actionCommand;
    while (cmd) {
      const parentOpts = cmd.opts();
      if (parentOpts.json) setJsonMode(true);
      if (parentOpts.quiet) setQuietMode(true);
      cmd = cmd.parent;
    }
  });

// Register all commands
registerInitCommand(program);
registerProposeCommand(program);
registerSpecCommand(program);
registerDesignCommand(program);
registerReviewCommand(program);
registerTasksCommand(program);
registerDoneCommand(program);
registerSearchCommand(program);
registerStatusCommand(program);
registerHookCommand(program);
registerConfigCommand(program);
registerAuditCommand(program);
registerListCommand(program);
registerStatsCommand(program);
registerBakeCommand(program);
// registerDebateCommand(program);

// Handle @shortcut syntax before parsing
async function handleShortcut() {
  const args = process.argv.slice(2);
  const [shortcut, remainingArgs] = BakeService.parseShortcut(args);

  if (shortcut) {
    try {
      const service = new BakeService();
      const { config, warnings } = service.apply(shortcut);

      // Show warnings
      for (const warning of warnings) {
        console.error(warning);
      }

      // Change working directory - MITIGATION: S-01 shows path before execution
      console.error(`📁 Changing directory to: ${config.project_dir}`);
      process.chdir(config.project_dir);

      // Apply config as environment variables (CLI will pick them up)
      if (config.posture) process.env.SPECIA_POSTURE = config.posture;
      if (config.memory) process.env.SPECIA_MEMORY = config.memory;
      if (config.provider) process.env.SPECIA_PROVIDER = config.provider;
      if (config.model) process.env.SPECIA_MODEL = config.model;
      
      // Resolve API key if present (ONLY for runtime use, never for display)
      if (config.api_key) {
        const resolved = BakeService.resolveEnvReference(config.api_key);
        if (resolved) {
          if (config.provider === "openai") {
            process.env.OPENAI_API_KEY = resolved;
          } else {
            process.env.ANTHROPIC_API_KEY = resolved;
          }
        }
      }

      // Replace args for commander - ensure argv[0] and argv[1] are defined
      const node = process.argv[0] ?? "node";
      const script = process.argv[1] ?? "specia";
      process.argv = [node, script, ...remainingArgs];
    } catch (err) {
      console.error(`Error applying baked config: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  }

  // Parse and run
  program.parseAsync(process.argv).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}

handleShortcut();
