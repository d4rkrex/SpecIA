/**
 * CLI `specia audit` — Optional post-implementation code audit (manual or API mode).
 *
 * --manual: Generates audit prompt, user runs externally, then submits result.
 * --api: Sends prompt to LLM API (Anthropic/OpenAI) and validates result.
 *
 * Calls AuditEngine + FileStore directly (not tool handlers).
 * Design refs: Decision 13 (CLI command — specia audit)
 */

import { Command } from "commander";
import { FileStore } from "../../services/store.js";
import { computeSpecHash } from "../../services/cache.js";
import {
  generateAuditPrompt,
  validateAuditResult,
  renderAuditMarkdown,
  discoverChangedFiles,
  readCodeFiles,
  selectAndBudgetFiles,
  computeAuditHash,
  parseAbuseCasesFromReview,
  isAuditStale,
} from "../../services/audit.js";
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
import { sanitizeInput } from "../security/validators.js";

export function registerAuditCommand(program: Command): void {
  program
    .command("audit <change-name>")
    .description("Run optional post-implementation code audit")
    .option("--manual", "Generate prompt for external audit")
    .option("--api", "Send to LLM API for automated audit")
    .option("--provider <provider>", "LLM provider: anthropic | openai")
    .option("--model <model>", "LLM model override")
    .option("--force", "Force re-audit even if code unchanged")
    .option("--files <paths>", "Explicit file list (comma-separated)")
    .option("--posture <posture>", "Security posture: standard | elevated | paranoid")
    .option("--base-branch <branch>", "Base branch for git diff")
    .option("--result <json>", "Submit audit result: inline JSON, @file.json, or - for stdin")
    .option("--gate <threshold>", "Exit 1 if findings >= threshold (critical|high|medium|low)")
    .action(async (changeName: string, opts: {
      manual?: boolean;
      api?: boolean;
      provider?: string;
      model?: string;
      force?: boolean;
      files?: string;
      posture?: string;
      baseBranch?: string;
      result?: string;
      gate?: string;
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

      // Check tasks phase is complete
      const state = store.getChangeState(changeName);
      if (!state) {
        error(`Change "${changeName}" not found. Run \`specia propose\` first.`);
        process.exitCode = 1;
        return;
      }

      if (!state.phases_completed.includes("tasks")) {
        error("Tasks phase must be complete before running audit. Run `specia tasks` first.");
        process.exitCode = 1;
        return;
      }

      // Check spec exists
      const specContent = store.readArtifact(changeName, "spec");
      if (!specContent) {
        error("Spec must exist before running audit. Run `specia spec` first.");
        process.exitCode = 1;
        return;
      }

      const config = store.readConfig();
      const posture = (opts.posture as "standard" | "elevated" | "paranoid") ?? config.security.posture;
      const currentSpecHash = computeSpecHash(specContent);

      // Parse explicit files early so they're available for all code paths
      const explicitFiles = opts.files
        ? opts.files.split(",").map((f) => f.trim()).filter(Boolean)
        : undefined;

      // Phase 2: submitting audit result (manual mode)
      if (opts.result !== undefined) {
        const resolved = await resolveJsonInput(opts.result, "audit result");
        if (!resolved.ok) {
          error(resolved.error);
          process.exitCode = 1;
          return;
        }
        return submitAuditResult(
          store, changeName, resolved.json, currentSpecHash, posture, rootDir, undefined, opts.gate, explicitFiles,
        );
      }

      // Opportunistic stdin: submit if valid JSON, otherwise continue to prompt
      const stdinJson = await tryStdinJson();
      if (stdinJson !== null) {
        return submitAuditResult(
          store, changeName, stdinJson, currentSpecHash, posture, rootDir, undefined, opts.gate, explicitFiles,
        );
      }

      // Discover code files

      const changedFiles = explicitFiles ?? discoverChangedFiles(
        changeName,
        opts.baseBranch,
        rootDir,
      );

      const codeFiles = readCodeFiles(changedFiles, rootDir);
      const budgetedFiles = selectAndBudgetFiles(codeFiles, 100000, specContent);
      const auditHash = computeAuditHash(budgetedFiles);

      // Smart caching check
      if (
        !opts.force &&
        store.readArtifact(changeName, "audit") &&
        !isAuditStale(state.audit_hash, auditHash)
      ) {
        if (isJsonMode()) {
          jsonOutput({
            status: "cached",
            change_name: changeName,
            audit_path: `.specia/changes/${changeName}/audit.md`,
            message: "Audit cache hit — code unchanged.",
          });
        } else {
          warn("Audit cache hit — code unchanged since last audit. Use --force to re-audit.");
          info(`  Path: .specia/changes/${changeName}/audit.md`);
        }
        return;
      }

      // Read context artifacts
      const reviewContent = store.readArtifact(changeName, "review") ?? "";
      const abuseCases = parseAbuseCasesFromReview(reviewContent);
      const proposalContent = store.readArtifact(changeName, "proposal") ?? undefined;
      const designContent = store.readArtifact(changeName, "design") ?? undefined;

      // Build config override for posture
      const auditConfig = { ...config, security: { ...config.security, posture } };

      const prompt = generateAuditPrompt({
        config: auditConfig,
        changeName,
        specContent,
        reviewContent,
        abuseCases,
        codeFiles: budgetedFiles,
        designContent,
        proposalContent,
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
            `Running ${provider} code audit...`,
            () => client.audit(prompt),
          );

          return submitAuditResult(
            store, changeName, llmResult.result, currentSpecHash, posture, rootDir, llmResult, opts.gate, explicitFiles,
          );
        } catch (err) {
          error(`LLM audit failed: ${err instanceof Error ? err.message : String(err)}`);
          process.exitCode = 1;
          return;
        }
      }

      // Manual mode (default): output the prompt
      if (isJsonMode()) {
        jsonOutput({
          status: "prompt_generated",
          change_name: changeName,
          spec_hash: currentSpecHash,
          audit_hash: auditHash,
          audit_prompt: prompt,
          instructions: "Process this prompt with an LLM, then run: specia audit <name> --result '<json>'",
        });
      } else {
        info("Audit prompt generated.");
        dim("Process this with an LLM, then submit the result:");
        dim(`  specia audit ${changeName} --result '<json>'`);
        dim("  OR pipe the result: echo '<json>' | specia audit " + changeName);
        console.log("");
        console.log(prompt.analysis_request);
      }
    });
}

function submitAuditResult(
  store: FileStore,
  changeName: string,
  resultJson: unknown,
  specHash: string,
  posture: "standard" | "elevated" | "paranoid",
  rootDir: string,
  llmResult?: LlmResult,
  gateThreshold?: string,
  explicitFiles?: string[],
): void {
  try {
    // Compute audit hash from current code — use explicit files if provided
    const changedFiles = explicitFiles ?? discoverChangedFiles(changeName, undefined, rootDir);
    const codeFiles = readCodeFiles(changedFiles, rootDir);
    const auditHash = computeAuditHash(codeFiles);

    const audit = validateAuditResult(resultJson, changeName, specHash, auditHash, posture);
    const markdown = renderAuditMarkdown(audit);

    store.writeArtifact(changeName, "audit", markdown);

    // Build token estimate entry (Phase 2 token economics)
    const currentState = store.getChangeState(changeName);
    const estimates: TokenEstimate[] = [...(currentState?.token_estimates ?? [])];

    if (llmResult?.usage) {
      // Real API usage available — store both estimate and actual
      const promptTokensEst = estimateTokens(audit);
      const resultTokensEst = estimateTokens(resultJson as object);
      estimates.push({
        phase: "audit" as const,
        prompt_tokens_est: promptTokensEst,
        result_tokens_est: resultTokensEst,
        timestamp: new Date().toISOString(),
        actual_usage: llmResult.usage,
        source: "api",
        model: llmResult.model,
      });
    }

    store.transitionPhase(changeName, "audit", "complete", {
      audit_hash: auditHash,
      audit_posture: posture,
      token_estimates: estimates,
    });

    if (isJsonMode()) {
      jsonOutput({
        status: "success",
        change_name: changeName,
        audit_path: `.specia/changes/${changeName}/audit.md`,
        overall_verdict: audit.summary.overall_verdict,
        requirements_summary: `${audit.summary.requirements_coverage.passed}/${audit.summary.requirements_coverage.total} passed`,
        abuse_cases_summary: `${audit.summary.abuse_cases_coverage.verified}/${audit.summary.abuse_cases_coverage.total} verified`,
        ...(llmResult?.usage ? { token_usage: llmResult.usage } : {}),
      });
    } else {
      success(`Code audit complete for "${changeName}"`);
      info(`  Verdict: ${audit.summary.overall_verdict}`);
      info(`  Requirements: ${audit.summary.requirements_coverage.passed}/${audit.summary.requirements_coverage.total} passed, ${audit.summary.requirements_coverage.failed} failed`);
      info(`  Abuse cases: ${audit.summary.abuse_cases_coverage.verified}/${audit.summary.abuse_cases_coverage.total} verified, ${audit.summary.abuse_cases_coverage.unverified} unverified`);
      info(`  Risk: ${audit.summary.risk_level}`);
      if (llmResult?.usage) {
        info(`  Tokens: ${llmResult.usage.input_tokens} in / ${llmResult.usage.output_tokens} out (${llmResult.usage.total_tokens} total)`);
        if (llmResult.model) {
          dim(`  Model: ${llmResult.model}`);
        }
      }
      info(`  Path: .specia/changes/${changeName}/audit.md`);
      info(`  Next: specia done ${changeName}`);
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

      // Check if audit verdict is fail or partial with findings >= threshold
      const isFailure = audit.summary.overall_verdict === "fail";
      const isPartialWithHighFindings = audit.summary.overall_verdict === "partial" && (
        audit.summary.requirements_coverage.failed > 0 ||
        audit.summary.abuse_cases_coverage.unverified > 0
      );

      // Check risk level against threshold
      const riskLevels = ["critical", "high", "medium", "low"];
      const currentRiskLevel = riskLevels.indexOf(audit.summary.risk_level);
      const hasRiskAboveThreshold = currentRiskLevel !== -1 && currentRiskLevel <= thresholdLevel;

      if (isFailure || (isPartialWithHighFindings && hasRiskAboveThreshold)) {
        if (!isJsonMode()) {
          warn(`Security gate FAILED: Audit verdict '${audit.summary.overall_verdict}' with risk '${audit.summary.risk_level}'.`);
        }
        process.exitCode = 1;
      } else {
        if (!isJsonMode()) {
          success(`Security gate PASSED: Audit verdict '${audit.summary.overall_verdict}' meets threshold.`);
        }
        process.exitCode = 0;
      }
    }
  } catch (err) {
    error(`Audit validation failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}
