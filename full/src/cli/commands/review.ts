/**
 * CLI `specia review` — Mandatory security review (manual or API mode).
 *
 * --manual: Generates review prompt, user reviews externally, then submits result.
 * --api: Sends prompt to LLM API (Anthropic/OpenAI) and validates result.
 *
 * Calls ReviewEngine + FileStore directly (not tool handlers).
 * Design refs: Decision 18, Decision 19, Decision 20
 */

import { Command } from "commander";
import { FileStore } from "../../services/store.js";
import { computeSpecHash, shouldReReview } from "../../services/cache.js";
import {
  generateReviewPrompt,
  validateReviewResult,
  renderReviewMarkdown,
} from "../../services/review.js";
import { createLlmClient, type LlmResult } from "../llm-client.js";
import { estimateTokens } from "../../types/tools.js";
import type { TokenEstimate } from "../../types/state.js";
import {
  success,
  error,
  warn,
  info,
  dim,
  jsonOutput,
  isJsonMode,
  withSpinner,
  resolveJsonInput,
  tryStdinJson,
} from "../output.js";
import { sanitizeInput, ValidationError } from "../security/index.js";

export function registerReviewCommand(program: Command): void {
  program
    .command("review <change-name>")
    .description("Run mandatory security review")
    .option("--manual", "Generate prompt for external review")
    .option("--api", "Send to LLM API for automated review")
    .option("--provider <provider>", "LLM provider: anthropic | openai")
    .option("--model <model>", "LLM model override")
    .option("--force", "Force re-review even if spec unchanged")
    .option("--result <json>", "Submit review result: inline JSON, @file.json, or - for stdin")
    .option("--gate <threshold>", "Exit 1 if findings >= threshold (critical|high|medium|low)")
    .action(async (changeName: string, opts: {
      manual?: boolean;
      api?: boolean;
      provider?: string;
      model?: string;
      force?: boolean;
      result?: string;
      gate?: string;
    }) => {
      // Validate change name (REQ-MIT-001: prevent SQL injection in analytics)
      try {
        changeName = sanitizeInput(changeName, "change_name");
      } catch (err) {
        if (err instanceof ValidationError) {
          error(`Invalid change name: ${err.message}`);
        } else {
          error(`Validation failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        process.exitCode = 1;
        return;
      }
      
      const rootDir = process.cwd();
      const store = new FileStore(rootDir);

      if (!store.isInitialized()) {
        error("Not initialized. Run `specia init` first.");
        process.exitCode = 1;
        return;
      }

      // Check spec exists
      const specContent = store.readArtifact(changeName, "spec");
      if (!specContent) {
        error("Spec must exist before running review. Run `specia spec` first.");
        process.exitCode = 1;
        return;
      }

      const config = store.readConfig();
      const currentHash = computeSpecHash(specContent);
      const state = store.getChangeState(changeName);

      // Phase 2: submitting review result (manual mode)
      if (opts.result !== undefined) {
        const resolved = await resolveJsonInput(opts.result, "review result");
        if (!resolved.ok) {
          error(resolved.error);
          process.exitCode = 1;
          return;
        }
        return submitReviewResult(
          store, changeName, resolved.json, currentHash,
          config.security.posture, undefined, opts.gate,
        );
      }

      // Opportunistic stdin: submit if valid JSON, otherwise continue to prompt
      const stdinJson = await tryStdinJson();
      if (stdinJson !== null) {
        return submitReviewResult(
          store, changeName, stdinJson, currentHash,
          config.security.posture, undefined, opts.gate,
        );
      }

      // Smart caching check
      if (
        !opts.force &&
        store.readArtifact(changeName, "review") &&
        !shouldReReview(currentHash, state, config.security.posture, false)
      ) {
        if (isJsonMode()) {
          jsonOutput({
            status: "cached",
            change_name: changeName,
            review_path: `.specia/changes/${changeName}/review.md`,
            message: "Review cache hit — spec unchanged.",
          });
        } else {
          warn("Review cache hit — spec unchanged since last review. Use --force to re-review.");
          info(`  Path: .specia/changes/${changeName}/review.md`);
        }
        return;
      }

      // Generate review prompt
      const proposalContent = store.readArtifact(changeName, "proposal") ?? undefined;
      const designContent = store.readArtifact(changeName, "design") ?? undefined;

      const prompt = generateReviewPrompt({
        config,
        changeName,
        specContent,
        proposalContent,
        designContent,
      });

      // API mode: send to LLM
      if (opts.api) {
        const provider = (opts.provider ?? config.cli?.llm?.provider ?? "") as "anthropic" | "openai";
        if (!provider || !["anthropic", "openai"].includes(provider)) {
          error("LLM provider required. Use --provider <anthropic|openai> or configure in .specia/config.yaml.");
          process.exitCode = 1;
          return;
        }

        const apiKeyEnv = config.cli?.llm?.api_key_env ?? (
          provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"
        );
        const apiKey = process.env[apiKeyEnv];
        if (!apiKey) {
          error(`API key not found. Set ${apiKeyEnv} environment variable.`);
          process.exitCode = 1;
          return;
        }

        const model = opts.model ?? config.cli?.llm?.model;

        try {
          const client = createLlmClient({ provider, apiKey, model });

          const llmResult: LlmResult = await withSpinner(
            `Running ${provider} security review...`,
            () => client.review(prompt),
          );

          return submitReviewResult(
            store, changeName, llmResult.result, currentHash,
            config.security.posture, llmResult, opts.gate,
          );
        } catch (err) {
          error(`LLM review failed: ${err instanceof Error ? err.message : String(err)}`);
          process.exitCode = 1;
          return;
        }
      }

      // Manual mode (default): output the prompt
      if (isJsonMode()) {
        jsonOutput({
          status: "prompt_generated",
          change_name: changeName,
          spec_hash: currentHash,
          review_prompt: prompt,
          instructions: "Process this prompt with an LLM, then run: specia review <name> --result '<json>'",
        });
      } else {
        info("Security review prompt generated.");
        dim("Process this with an LLM, then submit the result:");
        dim(`  specia review ${changeName} --result '<json>'`);
        dim(`  specia review ${changeName} --result @result.json`);
        dim(`  specia review ${changeName} --result -  (then paste JSON)`);
        dim("  OR pipe the result: echo '<json>' | specia review " + changeName);
        console.log("");
        console.log(prompt.analysis_request);
      }
    });
}

function submitReviewResult(
  store: FileStore,
  changeName: string,
  resultJson: unknown,
  specHash: string,
  posture: "standard" | "elevated" | "paranoid",
  llmResult?: LlmResult,
  gateThreshold?: string,
): void {
  try {
    const review = validateReviewResult(resultJson, posture, changeName, specHash);
    const markdown = renderReviewMarkdown(review);

    store.writeArtifact(changeName, "review", markdown);

    // Compute design hash if design exists
    const designContent = store.readArtifact(changeName, "design");
    const designHash = designContent ? computeSpecHash(designContent) : undefined;

    // Build token estimate entry (Phase 2 token economics)
    const currentState = store.getChangeState(changeName);
    const estimates: TokenEstimate[] = [...(currentState?.token_estimates ?? [])];

    if (llmResult?.usage) {
      // Real API usage available — store both estimate and actual
      const promptTokensEst = estimateTokens(review);
      const resultTokensEst = estimateTokens(resultJson as object);
      estimates.push({
        phase: "review" as const,
        prompt_tokens_est: promptTokensEst,
        result_tokens_est: resultTokensEst,
        timestamp: new Date().toISOString(),
        actual_usage: llmResult.usage,
        source: "api",
        model: llmResult.model,
      });
    }

    store.transitionPhase(changeName, "review", "complete", {
      review_hash: specHash,
      review_posture: posture,
      ...(designHash ? { design_hash: designHash } : {}),
      token_estimates: estimates,
    });

    if (isJsonMode()) {
      jsonOutput({
        status: "success",
        change_name: changeName,
        review_path: `.specia/changes/${changeName}/review.md`,
        findings_count: review.summary.total_findings,
        risk_level: review.summary.risk_level,
        ...(llmResult?.usage ? { token_usage: llmResult.usage } : {}),
      });
    } else {
      success(`Security review complete for "${changeName}"`);
      info(`  Risk level: ${review.summary.risk_level}`);
      info(`  Findings: ${review.summary.total_findings} (${review.summary.critical_findings} critical)`);
      if (llmResult?.usage) {
        info(`  Tokens: ${llmResult.usage.input_tokens} in / ${llmResult.usage.output_tokens} out (${llmResult.usage.total_tokens} total)`);
        if (llmResult.model) {
          dim(`  Model: ${llmResult.model}`);
        }
      }
      info(`  Path: .specia/changes/${changeName}/review.md`);
      info(`  Next: specia tasks ${changeName}`);
    }

    // Apply security gate if threshold is provided
    if (gateThreshold) {
      const thresholds = ["critical", "high", "medium", "low"];
      const thresholdLevel = thresholds.indexOf(gateThreshold.toLowerCase());
      
      if (thresholdLevel === -1) {
        error(`Invalid gate threshold: ${gateThreshold}. Must be: critical, high, medium, or low.`);
        process.exitCode = 1;
        return;
      }

      // Check if any finding meets or exceeds the threshold
      const hasFindingsAboveThreshold = review.stride.spoofing.threats.some(
        (t) => thresholds.indexOf(t.severity) <= thresholdLevel
      ) ||
      review.stride.tampering.threats.some(
        (t) => thresholds.indexOf(t.severity) <= thresholdLevel
      ) ||
      review.stride.repudiation.threats.some(
        (t) => thresholds.indexOf(t.severity) <= thresholdLevel
      ) ||
      review.stride.information_disclosure.threats.some(
        (t) => thresholds.indexOf(t.severity) <= thresholdLevel
      ) ||
      review.stride.denial_of_service.threats.some(
        (t) => thresholds.indexOf(t.severity) <= thresholdLevel
      ) ||
      review.stride.elevation_of_privilege.threats.some(
        (t) => thresholds.indexOf(t.severity) <= thresholdLevel
      );

      if (hasFindingsAboveThreshold) {
        if (!isJsonMode()) {
          warn(`Security gate FAILED: Found findings at or above '${gateThreshold}' severity.`);
        }
        process.exitCode = 1;
      } else {
        if (!isJsonMode()) {
          success(`Security gate PASSED: No findings at or above '${gateThreshold}' severity.`);
        }
        process.exitCode = 0;
      }
    }
  } catch (err) {
    error(`Review validation failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}
