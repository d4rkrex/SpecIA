/**
 * CLI command: specia debate <change-name>
 *
 * Runs structured exchange debate on security review findings.
 */

import { Command } from "commander";
import ora from "ora";
import chalk from "chalk";
// import { DebateOrchestrator } from "../../services/debate-orchestrator.js"; // TEMPORARILY DISABLED
import { readFileSync } from "node:fs";
import { join } from "node:path";

export function registerDebateCommand(program: Command): void {
  program
    .command("debate <change-name>")
    .description("Run structured debate on security review findings")
    .option("--provider <provider>", "LLM provider (anthropic|openai)", "anthropic")
    .option("--model <model>", "LLM model to use")
    .option("--max-rounds <n>", "Maximum debate rounds per finding", "3")
    .option("--max-findings <n>", "Maximum findings to debate", "10")
    .action(async (changeName: string, options) => {
      const spinner = ora("Loading configuration...").start();

      try {
        // Load project config
        const speciaRoot = process.cwd();

        // Get API key from environment
        const apiKeyEnv =
          options.provider === "anthropic"
            ? "ANTHROPIC_API_KEY"
            : "OPENAI_API_KEY";
        const apiKey = process.env[apiKeyEnv];

        if (!apiKey) {
          spinner.fail(
            chalk.red(`Missing ${apiKeyEnv} environment variable`),
          );
          process.exit(1);
        }

        spinner.text = "Checking review status...";

        // Check if review exists
        const reviewPath = join(
          speciaRoot,
          ".specia",
          "changes",
          changeName,
          "review.md",
        );

        try {
          readFileSync(reviewPath, "utf-8");
        } catch {
          spinner.fail(
            chalk.red(
              `Review not found for change '${changeName}'. Run: specia review ${changeName}`,
            ),
          );
          process.exit(1);
        }

        spinner.succeed("Review found");
        spinner.fail(chalk.yellow("CLI debate command temporarily disabled - use MCP tool instead"));
        console.log(chalk.dim("\nThe debate feature has been refactored to two-phase pattern."));
        console.log(chalk.dim("Use the specia_debate MCP tool from your agent host (Claude Code, Copilot CLI)."));
        process.exit(1);

        /* TEMPORARILY DISABLED - TODO: Create DebateCliRunner wrapper
        const orchestrator = new DebateOrchestrator();

        const result = await orchestrator.debate(changeName, speciaRoot, {
          provider: options.provider as "anthropic" | "openai",
          apiKey,
          model: options.model,
          maxRounds: parseInt(options.maxRounds),
          maxFindings: parseInt(options.maxFindings),
        });

        spinner.succeed(
          chalk.green(
            `Debate complete! ${result.findingsDebated} findings debated in ${result.totalRounds} rounds`,
          ),
        );

        console.log(
          chalk.cyan(`\n📄 Review updated: .specia/changes/${changeName}/review.md`),
        );
        console.log(
          chalk.cyan(`📝 Transcript: .specia/changes/${changeName}/debate.md`),
        );

        // Show summary
        console.log(chalk.bold("\n🎯 Debate Summary:\n"));

        for (const debate of result.debates) {
          const consensusIcon = debate.consensus.synthesis.consensusReached
            ? "✅"
            : "⚠️";
          const severityColor =
            debate.consensus.synthesis.consensusSeverity === "critical"
              ? chalk.red
              : debate.consensus.synthesis.consensusSeverity === "high"
                ? chalk.yellow
                : chalk.blue;

          console.log(
            `${consensusIcon} ${chalk.bold(debate.finding.id)}: ${debate.finding.title}`,
          );
          console.log(
            `     ${chalk.gray("Original:")} ${debate.finding.originalSeverity} → ${chalk.gray("Consensus:")} ${severityColor(debate.consensus.synthesis.consensusSeverity)}`,
          );
          console.log(
            `     ${chalk.gray("Rounds:")} ${debate.roundsUsed}/${result.metadata.modelsUsed.offensive}`,
          );

          if (debate.consensus.needsHumanReview) {
            console.log(chalk.red(`     🔴 Needs human review`));
          }

          console.log();
        }

        console.log(
          chalk.dim(
            `Duration: ${(result.metadata.durationMs / 1000).toFixed(1)}s`,
          ),
        );
        */
      } catch (error) {
        spinner.fail(chalk.red("Debate failed"));
        console.error(error);
        process.exit(1);
      }
    });
}
