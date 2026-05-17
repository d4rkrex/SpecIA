/**
 * CLI `specia scan` — Ad-hoc security scan without full specia workflow.
 *
 * Quick STRIDE-lite analysis for PR reviews, commits, or specific files.
 * No spec required. Generates a prompt (manual mode) or accepts a result.
 *
 * Scans are saved to .specia/scans/ relative to specia root.
 */

import { Command } from "commander";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import {
  success,
  error,
  warn,
  info,
  dim,
  jsonOutput,
  isJsonMode,
  resolveJsonInput,
  tryStdinJson,
  table,
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

function ensureScansDir(speciaRoot: string): string {
  const scansDir = path.join(speciaRoot, ".specia", "scans");
  fs.mkdirSync(scansDir, { recursive: true });
  return scansDir;
}

function collectDiffCode(diffRef?: string): string {
  try {
    if (diffRef) {
      return execSync(`git diff ${diffRef}`, { encoding: "utf-8", cwd: process.cwd() });
    }
    return execSync("git diff --staged", { encoding: "utf-8", cwd: process.cwd() });
  } catch {
    return "";
  }
}

function collectLastMergeDiff(): { code: string; description: string } {
  try {
    // Find the last merge commit
    const mergeHash = execSync("git log --merges -n 1 --format=%H", {
      encoding: "utf-8",
      cwd: process.cwd(),
    }).trim();

    if (!mergeHash) {
      return { code: "", description: "" };
    }

    // Get merge commit message for context
    const mergeMsg = execSync(`git log -1 --format="%s" ${mergeHash}`, {
      encoding: "utf-8",
      cwd: process.cwd(),
    }).trim();

    // Diff: what the merge brought in (merge parent 2 vs merge parent 1)
    const code = execSync(`git diff ${mergeHash}^1..${mergeHash}`, {
      encoding: "utf-8",
      cwd: process.cwd(),
    });

    // Get branch/author info if available
    const author = execSync(`git log -1 --format="%an <%ae>" ${mergeHash}`, {
      encoding: "utf-8",
      cwd: process.cwd(),
    }).trim();

    const date = execSync(`git log -1 --format="%ci" ${mergeHash}`, {
      encoding: "utf-8",
      cwd: process.cwd(),
    }).trim();

    const description = `Last merge: "${mergeMsg}" by ${author} on ${date} (${mergeHash.slice(0, 8)})`;
    return { code, description };
  } catch {
    return { code: "", description: "" };
  }
}

function collectFileCode(filePaths: string[]): string {
  const parts: string[] = [];
  for (const fp of filePaths) {
    const abs = path.isAbsolute(fp) ? fp : path.join(process.cwd(), fp);
    if (!fs.existsSync(abs)) {
      warn(`File not found: ${fp}`);
      continue;
    }
    const content = fs.readFileSync(abs, "utf-8");
    parts.push(`\n\`\`\`\n// File: ${fp}\n${content}\n\`\`\``);
  }
  return parts.join("\n");
}

function buildScanPrompt(code: string, posture: string): string {
  const depth = posture === "paranoid"
    ? "exhaustive — cover all STRIDE categories deeply, map every finding to OWASP, provide 10+ findings"
    : posture === "elevated"
    ? "thorough — full STRIDE analysis, OWASP Top 10 mapping, up to 8 findings"
    : "standard — top 5 most important security findings only";

  return `You are a senior application security engineer. Analyze the following code changes for security vulnerabilities.

## Analysis depth: ${depth}

## Code to analyze:
${code || "(no code provided — analyze general patterns if possible)"}

## Instructions:
1. Apply STRIDE threat modeling (Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service, Elevation of Privilege)
2. Map relevant findings to OWASP Top 10 (2021) categories
3. Focus on the most impactful findings — prioritize exploitability and business impact
4. Assign finding IDs as S-01, S-02, etc.

## Required output (strict JSON, no markdown wrapper):
{
  "summary": {
    "risk_level": "critical|high|medium|low",
    "findings_count": <number>
  },
  "findings": [
    {
      "id": "S-01",
      "severity": "critical|high|medium|low",
      "title": "<concise title>",
      "description": "<what the vulnerability is and where in the code>",
      "mitigation": "<specific remediation steps>",
      "owasp": "<e.g. A01:2021 - Broken Access Control>"
    }
  ]
}

Return ONLY valid JSON. No explanation outside the JSON block.`;
}

// ── Result schema (lenient validation) ───────────────────────────────

interface ScanFinding {
  id: string;
  severity: string;
  title: string;
  description: string;
  mitigation: string;
  owasp?: string;
}

interface ScanResult {
  summary: { risk_level: string; findings_count: number };
  findings: ScanFinding[];
}

function parseScanResult(raw: unknown): ScanResult {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Result must be a JSON object");
  }
  const obj = raw as Record<string, unknown>;
  if (!obj.summary || !Array.isArray(obj.findings)) {
    throw new Error("Result must have 'summary' and 'findings' fields");
  }
  return raw as ScanResult;
}

function renderScanMarkdown(result: ScanResult, meta: { timestamp: string; posture: string; source: string }): string {
  const lines: string[] = [
    `---`,
    `scan_timestamp: "${meta.timestamp}"`,
    `risk_level: "${result.summary.risk_level}"`,
    `findings_count: ${result.summary.findings_count}`,
    `posture: "${meta.posture}"`,
    `source: "${meta.source}"`,
    `---`,
    ``,
    `# Security Scan Report`,
    ``,
    `**Date:** ${meta.timestamp}`,
    `**Risk Level:** ${result.summary.risk_level.toUpperCase()}`,
    `**Findings:** ${result.summary.findings_count}`,
    `**Posture:** ${meta.posture}`,
    ``,
    `## Findings`,
    ``,
    `| ID | Severity | Title | OWASP |`,
    `|----|----------|-------|-------|`,
  ];

  for (const f of result.findings) {
    lines.push(`| ${f.id} | ${f.severity} | ${f.title} | ${f.owasp ?? "—"} |`);
  }

  lines.push("", "## Details", "");
  for (const f of result.findings) {
    lines.push(
      `### ${f.id} — ${f.title}`,
      ``,
      `**Severity:** ${f.severity}  `,
      `**OWASP:** ${f.owasp ?? "—"}`,
      ``,
      `**Description:**`,
      f.description,
      ``,
      `**Mitigation:**`,
      f.mitigation,
      ``,
    );
  }

  return lines.join("\n");
}

// ── Command registration ──────────────────────────────────────────────

export function registerScanCommand(program: Command): void {
  program
    .command("scan")
    .description("Ad-hoc security scan — works on any git repo, no specia init needed")
    .option("--last-merge", "Scan the last merged PR/MR (most common use case)")
    .option("--diff <ref>", "Scan diff vs a git ref (e.g. HEAD~1, main, origin/main)")
    .option("--files <paths>", "Comma-separated list of files to scan")
    .option("--posture <posture>", "Security posture: standard|elevated|paranoid", "standard")
    .option("--manual", "Print prompt to stdout for manual LLM use (default behavior)")
    .option("--result <json>", "Submit result: inline JSON, @file.json, or - for stdin")
    .option("--json", "JSON output throughout")
    .action(async (opts: {
      lastMerge?: boolean;
      diff?: string;
      files?: string;
      posture?: string;
      manual?: boolean;
      result?: string;
      json?: boolean;
    }) => {
      const posture = (opts.posture ?? "standard") as string;
      const speciaRoot = resolveVtspecRoot(); // null = no .specia/, that's fine
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const scanId = `${timestamp}-scan`;

      // Collect code
      let code = "";
      let source = "staged";
      let sourceDescription = "";

      if (opts.lastMerge) {
        const result = collectLastMergeDiff();
        code = result.code;
        source = "last-merge";
        sourceDescription = result.description;
        if (!code.trim()) {
          console.error("✗ No merge commits found in this repository.");
          console.error("  Try: specia scan --diff main..HEAD");
          process.exitCode = 1;
          return;
        }
        if (!opts.json) {
          console.error(`📋 ${sourceDescription}`);
        }
      } else if (opts.files) {
        const filePaths = opts.files.split(",").map((f) => f.trim()).filter(Boolean);
        code = collectFileCode(filePaths);
        source = `files:${filePaths.join(",")}`;
      } else if (opts.diff !== undefined) {
        code = collectDiffCode(opts.diff);
        source = `diff:${opts.diff}`;
      } else {
        code = collectDiffCode();
        source = "staged";
      }

      if (!code.trim() && !opts.lastMerge) {
        warn("No code collected. Use --last-merge, --diff <ref>, --files <paths>, or stage changes with git add.");
        warn("Quick start: specia scan --last-merge");
      }

      // Phase 2: submit result
      if (opts.result !== undefined) {
        const resolved = await resolveJsonInput(opts.result, "scan result");
        if (!resolved.ok) {
          error(resolved.error);
          process.exitCode = 1;
          return;
        }
        return submitScanResult(resolved.json, scanId, posture, source, speciaRoot);
      }

      // Opportunistic stdin
      const stdinJson = await tryStdinJson();
      if (stdinJson !== null) {
        return submitScanResult(stdinJson, scanId, posture, source, speciaRoot);
      }

      // Generate prompt
      const prompt = buildScanPrompt(code, posture);

      // Save stub (to .specia/scans/ if available, else /tmp)
      const fallbackDir = path.join(tmpdir(), "specia-scans");
      const saveDir = speciaRoot
        ? ensureScansDir(speciaRoot)
        : (fs.mkdirSync(fallbackDir, { recursive: true }), fallbackDir);
      const stubPath = path.join(saveDir, `${scanId}.json`);
      const stub = {
        scan_id: scanId,
        status: "pending",
        posture,
        source,
        source_description: sourceDescription || undefined,
        created_at: new Date().toISOString(),
      };
      fs.writeFileSync(stubPath, JSON.stringify(stub, null, 2), "utf-8");

      if (isJsonMode() || opts.json) {
        jsonOutput({
          status: "prompt_generated",
          scan_id: scanId,
          posture,
          source,
          scan_prompt: prompt,
          instructions: `Process with LLM, then run: specia scan --result '<json>'`,
        });
      } else {
        info("Security scan prompt generated.");
        dim(`  Stub saved: ${speciaRoot ? `.specia/scans/${scanId}.json` : stubPath}`);
        dim("  Process with an LLM, then submit the result:");
        dim(`  specia scan --result '<json>'`);
        dim(`  specia scan --result @result.json`);
        dim(`  echo '<json>' | specia scan`);
        console.log("");
        console.log(prompt);
      }
    });
}

function submitScanResult(
  raw: unknown,
  scanId: string,
  posture: string,
  source: string,
  speciaRoot: string | null,
): void {
  try {
    const result = parseScanResult(raw);
    const timestamp = new Date().toISOString();
    const markdown = renderScanMarkdown(result, { timestamp, posture, source });

    if (speciaRoot) {
      const scansDir = ensureScansDir(speciaRoot);
      const reportPath = path.join(scansDir, `${scanId}.md`);
      fs.writeFileSync(reportPath, markdown, "utf-8");

      // Update stub to complete
      const stubPath = path.join(scansDir, `${scanId}.json`);
      if (fs.existsSync(stubPath)) {
        const stub = JSON.parse(fs.readFileSync(stubPath, "utf-8")) as Record<string, unknown>;
        stub.status = "complete";
        stub.completed_at = timestamp;
        stub.risk_level = result.summary.risk_level;
        stub.findings_count = result.summary.findings_count;
        fs.writeFileSync(stubPath, JSON.stringify(stub, null, 2), "utf-8");
      }
    }

    if (isJsonMode()) {
      jsonOutput({
        status: "success",
        scan_id: scanId,
        risk_level: result.summary.risk_level,
        findings_count: result.summary.findings_count,
        ...(speciaRoot ? { report_path: `.specia/scans/${scanId}.md` } : {}),
      });
    } else {
      success(`Scan complete — Risk: ${result.summary.risk_level.toUpperCase()}`);
      info(`  Findings: ${result.summary.findings_count}`);
      if (speciaRoot) {
        info(`  Report: .specia/scans/${scanId}.md`);
      }
      console.log("");
      table(
        [
          { header: "ID", key: "id", width: 6 },
          { header: "Severity", key: "severity", width: 10 },
          { header: "Title", key: "title", width: 50 },
          { header: "OWASP", key: "owasp", width: 20 },
        ],
        result.findings.map((f) => ({
          id: f.id,
          severity: f.severity,
          title: f.title,
          owasp: f.owasp ?? "—",
        })),
      );
    }
  } catch (err) {
    error(`Scan result invalid: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}
