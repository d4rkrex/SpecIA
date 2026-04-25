/**
 * CLI `specia init` — Interactive project initialization.
 *
 * Prompts for 4 questions, calls FileStore + DetectService directly.
 * Design refs: Decision 18, Decision 20
 */

import { Command } from "commander";
import { FileStore } from "../../services/store.js";
import { detectStack } from "../../services/detect.js";
import { renderContext } from "../../services/template.js";
import { buildNextSteps } from "../../tools/init.js";
import {
  success,
  error,
  info,
  dim,
  jsonOutput,
  isJsonMode,
} from "../output.js";
import type { VtspecConfig, SecurityPosture, MemoryBackend } from "../../types/index.js";
import { sanitizeInput, ValidationError } from "../security/index.js";

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Initialize SpecIA in the current project")
    .option("--description <desc>", "Project description")
    .option("--stack <stack>", "Primary stack")
    .option("--posture <posture>", "Security posture: standard | elevated | paranoid", "standard")
    .option("--memory <backend>", "Memory backend: local | alejandria | engram", "local")
    .option("--conventions <items>", "Comma-separated conventions", "")
    .action(async (opts: {
      description?: string;
      stack?: string;
      posture: string;
      memory: string;
      conventions: string;
    }) => {
      const rootDir = process.cwd();
      const store = new FileStore(rootDir);

      if (store.isInitialized()) {
        error(".specia/ already exists. Already initialized.");
        process.exitCode = 1;
        return;
      }

      // Detect stack
      const detection = detectStack(rootDir);

      // Validate and sanitize inputs (REQ-MIT-001)
      let description: string;
      let stack: string;
      try {
        const rawDescription = opts.description ?? `Project in ${rootDir.split("/").pop() ?? "directory"}`;
        description = sanitizeInput(rawDescription, "description");
        
        const rawStack = opts.stack ?? detection.detected ?? "Unknown";
        stack = sanitizeInput(rawStack, "stack");
      } catch (err) {
        if (err instanceof ValidationError) {
          error(`Invalid input: ${err.message}`);
        } else {
          error(`Validation failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        process.exitCode = 1;
        return;
      }
      
      const posture = (["standard", "elevated", "paranoid"].includes(opts.posture)
        ? opts.posture
        : "standard") as SecurityPosture;
      const backend = (["local", "alejandria", "engram"].includes(opts.memory)
        ? opts.memory
        : "local") as MemoryBackend;
      const conventions = opts.conventions
        ? opts.conventions.split(",").map((s) => s.trim()).filter(Boolean)
        : [];

      if (detection.detected && !opts.stack) {
        dim(`Auto-detected stack: ${detection.detected}`);
      }

      const config: VtspecConfig = {
        version: "0.2",
        project: {
          name: rootDir.split("/").pop() ?? "project",
          description,
          stack,
          conventions,
        },
        security: { posture },
        memory: { backend },
      };

      try {
        store.ensureDirectoryStructure();
        store.writeConfig(config);
        store.writeContext(renderContext(config));
      } catch (err) {
        error(`Failed to initialize: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
        return;
      }

      // Build next-steps guidance using hardcoded constants.
      // Security: posture name is NOT interpolated — only a boolean flag is used. (Review: I-02)
      const isEnhancedPosture = posture === "elevated" || posture === "paranoid";
      const nextSteps = buildNextSteps(isEnhancedPosture);

      if (isJsonMode()) {
        jsonOutput({
          status: "success",
          config_path: ".specia/config.yaml",
          context_path: ".specia/context.md",
          stack,
          posture,
          next_steps: nextSteps,
        });
      } else {
        success("SpecIA initialized!");
        info(`  Stack: ${stack}`);
        info(`  Posture: ${posture}`);
        info(`  Config: .specia/config.yaml`);
        info("");
        info("Next steps:");
        // Print the next-steps guidance (hardcoded constant, no user input interpolated)
        for (const line of nextSteps.split("\n").slice(2)) {
          dim(line);
        }
      }
    });
}
