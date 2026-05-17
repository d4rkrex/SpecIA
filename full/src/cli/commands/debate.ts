/**
 * CLI `specia debate <change-name>` — One-shot security finding debate.
 *
 * Dual mode:
 * - Auto (default): calls LLM directly if ANTHROPIC_API_KEY or OPENAI_API_KEY is set
 * - Manual (--manual): prints prompt for external LLM processing
 * - Result (--result): submits debate result JSON
 *
 * Phase 1: specia debate <change>             → auto-call LLM or print prompt
 * Phase 2: specia debate <change> --result @debate.json → write debate.md (manual only)
 */

import { Command } from "commander";
import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { autoDetectLlm } from "../llm-client.js";
import {
  success,
  error,
  info,
  dim,
  jsonOutput,
  isJsonMode,
  withSpinner,
  resolveJsonInput,
  tryStdinJson,
} from "../output.js";

// ── Helpers ──────────────────────────────────────────────────────────

function resolveVtspecRoot(): string | null {
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, ".specia"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Reuse the same last-merge detection as scan. */
function collectLastMergeDiff(): { code: string; description: string } {
  try {
    const mergeHash = execSync("git log --merges -n 1 --format=%H", {
      encoding: "utf-8", cwd: process.cwd(),
    }).trim();
    if (!mergeHash) return { code: "", description: "" };

    const mergeMsg = execSync(`git log -1 --format="%s" ${mergeHash}`, {
      encoding: "utf-8", cwd: process.cwd(),
    }).trim();
    const code = execSync(`git diff ${mergeHash}^1..${mergeHash}`, {
      encoding: "utf-8", cwd: process.cwd(),
    });
    const author = execSync(`git log -1 --format="%an <%ae>" ${mergeHash}`, {
      encoding: "utf-8", cwd: process.cwd(),
    }).trim();
    const date = execSync(`git log -1 --format="%ci" ${mergeHash}`, {
      encoding: "utf-8", cwd: process.cwd(),
    }).trim();

    return {
      code,
      description: `Last merge: "${mergeMsg}" by ${author} on ${date} (${mergeHash.slice(0, 8)})`,
    };
  } catch {
    return { code: "", description: "" };
  }
}

/** Prompt for scan+debate in one shot — for --last-merge / code without an existing review. */
function buildScanAndDebatePrompt(code: string, description: string): string {
  return `You are a senior application security engineer AND a security debate facilitator.

## Context
${description}

## Your task (TWO phases in one response)

### Phase 1 — Find security issues
Analyze the following code diff for security vulnerabilities. Focus on:
- STRIDE threats relevant to the code
- OWASP Top 10 applicability
- Top 5-8 most important findings

### Phase 2 — Debate each finding
For EACH finding you identified, simulate a structured three-perspective debate:
1. **Offensive Challenger**: Argues the finding is more severe/exploitable than it looks
2. **Defensive Validator**: Argues the finding is lower risk or already mitigated
3. **Judge**: Reaches consensus on actual severity and whether it needs human review

## Code to analyze:
\`\`\`diff
${code}
\`\`\`

## Required output (strict JSON, no markdown wrapper):
{
  "source": "${description}",
  "findings_debated": <number>,
  "debates": [
    {
      "finding_id": "S-01",
      "title": "<short title>",
      "original_severity": "high",
      "description": "<what the issue is>",
      "owasp": "A01:2021",
      "offensive_challenge": "<why it could be worse>",
      "defensive_response": "<why it might be lower risk>",
      "consensus_severity": "high",
      "consensus_reached": true,
      "calibration": "validated",
      "mitigation": "<recommended fix>",
      "notes": "<judge reasoning>"
    }
  ],
  "summary": {
    "escalated": <number>,
    "de_escalated": <number>,
    "validated": <number>,
    "needs_human_review": ["S-xx", ...]
  }
}

Return ONLY valid JSON. No text outside the JSON block.`;
}

/** Prompt for debate on an existing review.md (change-based flow). */

function buildDebatePrompt(changeName: string, reviewContent: string): string {
  return `You are facilitating a structured security finding debate for the change "${changeName}".

## Review under debate:
${reviewContent}

## Your task:
Simulate a structured three-perspective debate on every security finding in the review above.

### Roles:
1. **Offensive Challenger**: Argues the finding is more severe or likely than stated. Probes edge cases, real-world exploitability, and attacker motivation.
2. **Defensive Validator**: Argues the finding is properly scoped or lower severity given the architecture. Considers mitigating controls already in place.
3. **Judge**: Weighs both arguments and reaches a consensus on severity, calibration, and whether human review is needed.

### For each finding (threat ID T-xx or finding ID):
- Run through all three perspectives
- Determine consensus_severity (may differ from original)
- Classify calibration: "validated" | "escalated" | "de-escalated"
- Flag needs_human_review: true if consensus could not be reached

## Required output (strict JSON, no markdown wrapper):
{
  "findings_debated": <number>,
  "debates": [
    {
      "finding_id": "T-01",
      "original_severity": "high",
      "offensive_challenge": "<challenger's argument>",
      "defensive_response": "<validator's response>",
      "consensus_severity": "high",
      "consensus_reached": true,
      "calibration": "validated",
      "notes": "<judge's reasoning>"
    }
  ],
  "summary": {
    "escalated": <number>,
    "de_escalated": <number>,
    "validated": <number>,
    "needs_human_review": ["T-xx", ...]
  }
}

Return ONLY valid JSON. No text outside the JSON block.`;
}

// ── Result types ──────────────────────────────────────────────────────

interface DebateEntry {
  finding_id: string;
  original_severity: string;
  offensive_challenge: string;
  defensive_response: string;
  consensus_severity: string;
  consensus_reached: boolean;
  calibration: string;
  notes?: string;
}

interface DebateResult {
  findings_debated: number;
  debates: DebateEntry[];
  summary: {
    escalated: number;
    de_escalated: number;
    validated: number;
    needs_human_review: string[];
  };
}

function parseDebateResult(raw: unknown): DebateResult {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Result must be a JSON object");
  }
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.debates) || typeof obj.findings_debated !== "number") {
    throw new Error("Result must have 'findings_debated' (number) and 'debates' (array)");
  }
  return raw as DebateResult;
}

function renderDebateMarkdown(changeName: string, result: DebateResult): string {
  const lines: string[] = [
    `---`,
    `debate_timestamp: "${new Date().toISOString()}"`,
    `change: "${changeName}"`,
    `findings_debated: ${result.findings_debated}`,
    `escalated: ${result.summary.escalated}`,
    `de_escalated: ${result.summary.de_escalated}`,
    `validated: ${result.summary.validated}`,
    `---`,
    ``,
    `# Debate Report: ${changeName}`,
    ``,
    `**Generated:** ${new Date().toISOString()}`,
    `**Findings debated:** ${result.findings_debated}`,
    ``,
    `## Summary`,
    ``,
    `| Outcome | Count |`,
    `|---------|-------|`,
    `| Validated (unchanged) | ${result.summary.validated} |`,
    `| Escalated | ${result.summary.escalated} |`,
    `| De-escalated | ${result.summary.de_escalated} |`,
  ];

  if (result.summary.needs_human_review.length > 0) {
    lines.push(`| Needs human review | ${result.summary.needs_human_review.join(", ")} |`);
  }

  lines.push("", "## Finding Debates", "");

  for (const d of result.debates) {
    const consensusIcon = d.consensus_reached ? "✓" : "⚠";
    const calibLabel = d.calibration === "escalated"
      ? "↑ escalated"
      : d.calibration === "de-escalated"
      ? "↓ de-escalated"
      : "= validated";

    lines.push(
      `### ${d.finding_id} — ${d.original_severity} → ${d.consensus_severity} ${consensusIcon}`,
      ``,
      `**Calibration:** ${calibLabel}  `,
      `**Consensus reached:** ${d.consensus_reached}`,
      ``,
      `**⚔ Offensive Challenge:**`,
      d.offensive_challenge,
      ``,
      `**🛡 Defensive Response:**`,
      d.defensive_response,
      ``,
      `**⚖ Judge's Notes:**`,
      d.notes ?? "—",
      ``,
    );
  }

  return lines.join("\n");
}

// ── Command registration ──────────────────────────────────────────────

export function registerDebateCommand(program: Command): void {
  program
    .command("debate [change-name]")
    .description("Structured security debate — validates findings or scans+debates a merge/diff")
    .option("--last-merge", "Scan the last merged PR/MR and debate findings (no specia init needed)")
    .option("--diff <ref>", "Scan a git diff and debate findings (e.g. HEAD~1, main..HEAD)")
    .option("--manual", "Print debate prompt to stdout (skip LLM even if API key is set)")
    .option("--api", "Call LLM API directly (auto-detects ANTHROPIC_API_KEY / OPENAI_API_KEY)")
    .option("--model <model>", "LLM model override (e.g. claude-opus-4, gpt-4o)")
    .option("--result <json>", "Submit debate result: inline JSON, @file.json, or - for stdin")
    .action(async (changeName: string | undefined, opts: {
      lastMerge?: boolean;
      diff?: string;
      manual?: boolean;
      api?: boolean;
      model?: string;
      result?: string;
    }) => {
      const speciaRoot = resolveVtspecRoot();

      // ── Mode A: --last-merge or --diff (standalone, no specia needed) ──
      if (opts.lastMerge || opts.diff) {
        let code = "";
        let description = "";

        if (opts.lastMerge) {
          const merge = collectLastMergeDiff();
          code = merge.code;
          description = merge.description;
          if (!code.trim()) {
            error("No merge commits found. Try: specia debate --diff main..HEAD");
            process.exitCode = 1;
            return;
          }
          if (!isJsonMode()) console.error(`📋 ${description}`);
        } else if (opts.diff) {
          try {
            code = execSync(`git diff ${opts.diff}`, { encoding: "utf-8", cwd: process.cwd() });
            description = `Diff: ${opts.diff}`;
          } catch {
            error(`Failed to get diff for "${opts.diff}". Make sure you are inside a git repository.`);
            process.exitCode = 1;
            return;
          }
        }

        if (!code.trim()) {
          error("No code found in the diff.");
          process.exitCode = 1;
          return;
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        const debateId = `${timestamp}-debate`;

        // Phase 2: submit result
        if (opts.result !== undefined) {
          const resolved = await resolveJsonInput(opts.result, "debate result");
          if (!resolved.ok) { error(resolved.error); process.exitCode = 1; return; }
          return submitStandaloneDebateResult(resolved.json, debateId, description, speciaRoot);
        }

        const stdinJson = await tryStdinJson();
        if (stdinJson !== null) {
          return submitStandaloneDebateResult(stdinJson, debateId, description, speciaRoot);
        }

        // Phase 1: generate prompt
        const prompt = buildScanAndDebatePrompt(code, description);

        // Auto-detect LLM (skip if --manual)
        const llmClient = opts.manual ? null : autoDetectLlm(opts.model);
        if (llmClient) {
          if (!isJsonMode()) info("Calling LLM for scan + debate…");
          try {
            const llmResult = await (isJsonMode()
              ? llmClient.complete("You are a senior application security engineer and debate facilitator.", prompt)
              : withSpinner("Analyzing with LLM…", () =>
                  llmClient.complete("You are a senior application security engineer and debate facilitator.", prompt)
                )
            );
            const ts2 = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
            return submitStandaloneDebateResult(llmResult.result, `${ts2}-debate`, description, speciaRoot);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            error(`LLM call failed: ${msg}`);
            dim("  Falling back to manual mode:");
          }
        }

        if (isJsonMode()) {
          jsonOutput({ status: "prompt_generated", mode: "scan-and-debate", source: description, debate_prompt: prompt });
        } else {
          info("Scan + debate prompt generated.");
          dim(`  Source: ${description}`);
          dim("  Process with an LLM, then submit the result:");
          dim(`  specia debate --last-merge --result '<json>'`);
          dim(`  specia debate --last-merge --result @debate.json`);
          console.log("");
          console.log(prompt);
        }
        return;
      }

      // ── Mode B: existing change review.md ──
      if (!changeName) {
        error("Usage: specia debate <change-name>  OR  specia debate --last-merge");
        process.exitCode = 1;
        return;
      }

      if (!speciaRoot) {
        error("No .specia/ directory found. Run `specia init` first, or use --last-merge for standalone scanning.");
        process.exitCode = 1;
        return;
      }

      const reviewPath = path.join(speciaRoot, ".specia", "changes", changeName, "review.md");

      if (!fs.existsSync(reviewPath)) {
        error(`Review not found for change "${changeName}". Run: specia review ${changeName}`);
        process.exitCode = 1;
        return;
      }

      const reviewContent = fs.readFileSync(reviewPath, "utf-8");

      // Phase 2: submit result
      if (opts.result !== undefined) {
        const resolved = await resolveJsonInput(opts.result, "debate result");
        if (!resolved.ok) { error(resolved.error); process.exitCode = 1; return; }
        return submitDebateResult(resolved.json, changeName, speciaRoot);
      }

      const stdinJson = await tryStdinJson();
      if (stdinJson !== null) return submitDebateResult(stdinJson, changeName, speciaRoot);

      // Phase 1: generate prompt
      const prompt = buildDebatePrompt(changeName, reviewContent);

      // Auto-detect LLM (skip if --manual)
      const llmClientB = opts.manual ? null : autoDetectLlm(opts.model);
      if (llmClientB) {
        if (!isJsonMode()) info(`Calling LLM to debate findings for "${changeName}"…`);
        try {
          const llmResult = await (isJsonMode()
            ? llmClientB.complete("You are a senior application security engineer and debate facilitator.", prompt)
            : withSpinner("Debating findings with LLM…", () =>
                llmClientB.complete("You are a senior application security engineer and debate facilitator.", prompt)
              )
          );
          return submitDebateResult(llmResult.result, changeName, speciaRoot);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          error(`LLM call failed: ${msg}`);
          dim("  Falling back to manual mode:");
        }
      }

      if (isJsonMode()) {
        jsonOutput({ status: "prompt_generated", change_name: changeName, debate_prompt: prompt,
          instructions: `Submit result with: specia debate ${changeName} --result '<json>'` });
      } else {
        info(`Debate prompt generated for "${changeName}".`);
        dim(`  specia debate ${changeName} --result '<json>'`);
        dim(`  specia debate ${changeName} --result @debate.json`);
        console.log("");
        console.log(prompt);
      }
    });
}

function submitDebateResult(raw: unknown, changeName: string, speciaRoot: string): void {
  try {
    const result = parseDebateResult(raw);
    const markdown = renderDebateMarkdown(changeName, result);

    const changeDir = path.join(speciaRoot, ".specia", "changes", changeName);
    fs.mkdirSync(changeDir, { recursive: true });
    const debatePath = path.join(changeDir, "debate.md");
    fs.writeFileSync(debatePath, markdown, "utf-8");

    if (isJsonMode()) {
      jsonOutput({
        status: "success",
        change_name: changeName,
        debate_path: `.specia/changes/${changeName}/debate.md`,
        findings_debated: result.findings_debated,
        summary: result.summary,
      });
    } else {
      success(`Debate complete for "${changeName}"`);
      info(`  Findings debated: ${result.findings_debated}`);
      info(`  Validated: ${result.summary.validated} | Escalated: ${result.summary.escalated} | De-escalated: ${result.summary.de_escalated}`);
      if (result.summary.needs_human_review.length > 0) {
        info(`  Needs human review: ${result.summary.needs_human_review.join(", ")}`);
      }
      info(`  Path: .specia/changes/${changeName}/debate.md`);
    }
  } catch (err) {
    error(`Debate result invalid: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

function submitStandaloneDebateResult(
  raw: unknown,
  debateId: string,
  source: string,
  speciaRoot: string | null,
): void {
  try {
    const result = parseDebateResult(raw);
    const markdown = renderDebateMarkdown(source, result);

    // Save to .specia/debates/ or /tmp/specia-debates/
    const saveDir = speciaRoot
      ? path.join(speciaRoot, ".specia", "debates")
      : path.join(tmpdir(), "specia-debates");
    fs.mkdirSync(saveDir, { recursive: true });
    const reportPath = path.join(saveDir, `${debateId}.md`);
    fs.writeFileSync(reportPath, markdown, "utf-8");

    if (isJsonMode()) {
      jsonOutput({ status: "success", source, debate_path: reportPath,
        findings_debated: result.findings_debated, summary: result.summary });
    } else {
      success("Scan + debate complete.");
      info(`  Source: ${source}`);
      info(`  Findings debated: ${result.findings_debated}`);
      info(`  Validated: ${result.summary.validated} | Escalated: ${result.summary.escalated} | De-escalated: ${result.summary.de_escalated}`);
      if (result.summary.needs_human_review.length > 0) {
        info(`  ⚠ Needs human review: ${result.summary.needs_human_review.join(", ")}`);
      }
      info(`  Report: ${reportPath}`);
    }
  } catch (err) {
    error(`Debate result invalid: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}
