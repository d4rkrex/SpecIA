/**
 * CLI `specia report` — Security posture compliance report.
 *
 * Aggregates archived SpecIA changes (specs/, audit.md, review.md)
 * into a markdown or JSON security posture report.
 *
 * Data sources:
 *   .specia/specs/*.md         — archived change proposals (frontmatter)
 *   .specia/specs/*.audit.md   — archived audit results (frontmatter)
 *   .specia/specs/*.review.md  — archived security reviews (frontmatter)
 */

import { Command } from "commander";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  success,
  error,
  info,
  warn,
  jsonOutput,
  isJsonMode,
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

/** Extract YAML frontmatter from a markdown file (--- block at top). */
function extractFrontmatter(content: string): Record<string, unknown> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  try {
    // Simple key: value parser (avoid importing yaml for lightweight use)
    const lines = (match[1] ?? "").split("\n");
    const result: Record<string, unknown> = {};
    for (const line of lines) {
      const colonIdx = line.indexOf(":");
      if (colonIdx === -1) continue;
      const key = line.slice(0, colonIdx).trim();
      const rawVal = line.slice(colonIdx + 1).trim();
      // Strip surrounding quotes
      const val = rawVal.replace(/^["']|["']$/g, "");
      result[key] = isNaN(Number(val)) || val === "" ? val : Number(val);
    }
    return result;
  } catch {
    return {};
  }
}

// ── Data types ────────────────────────────────────────────────────────

interface ChangeEntry {
  name: string;
  archived_at: string;
  risk_level: string;
  audit_verdict: string | null;
  review_findings: number;
  audit_requirements_passed: number;
  audit_requirements_total: number;
}

interface ReportData {
  generated_at: string;
  project: string;
  changes: ChangeEntry[];
  summary: {
    total_changes: number;
    audits_passed: number;
    audits_total: number;
    risk_distribution: Record<string, number>;
    overall_posture: string;
  };
}

// ── Report builder ────────────────────────────────────────────────────

function buildReportData(specsDir: string, since?: string, filterChange?: string): ReportData {
  if (!fs.existsSync(specsDir)) {
    return {
      generated_at: new Date().toISOString(),
      project: process.cwd(),
      changes: [],
      summary: {
        total_changes: 0,
        audits_passed: 0,
        audits_total: 0,
        risk_distribution: { critical: 0, high: 0, medium: 0, low: 0 },
        overall_posture: "GOOD",
      },
    };
  }

  const entries = fs.readdirSync(specsDir);
  // Collect base names: files that are *.md but not *.audit.md or *.review.md
  const baseNames = entries
    .filter((f) => f.endsWith(".md") && !f.endsWith(".audit.md") && !f.endsWith(".review.md"))
    .map((f) => f.slice(0, -3)); // remove .md

  const changes: ChangeEntry[] = [];

  for (const name of baseNames) {
    if (filterChange && name !== filterChange) continue;

    const specContent = fs.readFileSync(path.join(specsDir, `${name}.md`), "utf-8");
    const specFm = extractFrontmatter(specContent);

    const archivedAt = String(specFm.archived_at ?? "");
    if (since && archivedAt && archivedAt < since) continue;

    // Read audit frontmatter
    const auditPath = path.join(specsDir, `${name}.audit.md`);
    let auditVerdict: string | null = null;
    let auditReqPassed = 0;
    let auditReqTotal = 0;
    if (fs.existsSync(auditPath)) {
      const auditFm = extractFrontmatter(fs.readFileSync(auditPath, "utf-8"));
      auditVerdict = String(auditFm.overall_verdict ?? "unknown");
      auditReqPassed = Number(auditFm.audit_requirements_passed ?? auditFm.requirements_passed ?? 0);
      auditReqTotal = Number(auditFm.audit_requirements_total ?? auditFm.requirements_total ?? 0);
      // Fallback: try coverage object fields from the spec frontmatter
      if (auditReqTotal === 0) {
        auditReqPassed = Number(specFm.audit_requirements_passed ?? 0);
        auditReqTotal = Number(specFm.audit_requirements_total ?? 0);
      }
    } else {
      // Try from spec frontmatter (archived with frontmatter)
      auditVerdict = specFm.audit_verdict ? String(specFm.audit_verdict) : null;
      auditReqPassed = Number(specFm.audit_requirements_passed ?? 0);
      auditReqTotal = Number(specFm.audit_requirements_total ?? 0);
    }

    // Read review frontmatter — findings count
    const reviewPath = path.join(specsDir, `${name}.review.md`);
    let reviewFindings = 0;
    if (fs.existsSync(reviewPath)) {
      const reviewFm = extractFrontmatter(fs.readFileSync(reviewPath, "utf-8"));
      reviewFindings = Number(reviewFm.total_findings ?? reviewFm.findings_count ?? 0);
    } else {
      // Try from spec frontmatter
      reviewFindings = Number(specFm.review_total_findings ?? specFm.review_findings_count ?? 0);
    }

    // Determine risk level
    const riskLevel = String(
      specFm.review_risk_level ??
      specFm.audit_risk_level ??
      specFm.risk_level ??
      "unknown"
    );

    changes.push({
      name,
      archived_at: archivedAt || "unknown",
      risk_level: riskLevel,
      audit_verdict: auditVerdict,
      review_findings: reviewFindings,
      audit_requirements_passed: auditReqPassed,
      audit_requirements_total: auditReqTotal,
    });
  }

  // Sort by archived_at descending
  changes.sort((a, b) => b.archived_at.localeCompare(a.archived_at));

  // Build summary
  const riskDist: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 };
  let auditsTotal = 0;
  let auditsPassed = 0;
  let hasCritical = false;
  let hasFailedAudit = false;
  let hasHigh = false;

  for (const ch of changes) {
    const r = ch.risk_level.toLowerCase();
    riskDist[r] = (riskDist[r] ?? 0) + 1;
    if (r === "critical") hasCritical = true;
    if (r === "high") hasHigh = true;
    if (ch.audit_verdict) {
      auditsTotal++;
      if (ch.audit_verdict === "pass") auditsPassed++;
      else hasFailedAudit = true;
    }
  }

  let overallPosture: string;
  if (hasCritical || hasFailedAudit) {
    overallPosture = "NEEDS_ATTENTION";
  } else if (hasHigh) {
    overallPosture = "FAIR";
  } else {
    overallPosture = "GOOD";
  }

  return {
    generated_at: new Date().toISOString(),
    project: process.cwd(),
    changes,
    summary: {
      total_changes: changes.length,
      audits_passed: auditsPassed,
      audits_total: auditsTotal,
      risk_distribution: riskDist,
      overall_posture: overallPosture,
    },
  };
}

function renderMarkdownReport(data: ReportData): string {
  const { summary, changes } = data;
  const auditPct = summary.audits_total > 0
    ? Math.round((summary.audits_passed / summary.audits_total) * 100)
    : 100;

  const riskLine = Object.entries(summary.risk_distribution)
    .filter(([, count]) => count > 0)
    .map(([level, count]) => `${level}:${count}`)
    .join(", ") || "none";

  const lines: string[] = [
    `# SpecIA Security Posture Report`,
    ``,
    `**Generated:** ${data.generated_at}`,
    `**Project:** ${data.project}`,
    ``,
    `## Executive Summary`,
    ``,
    `- **Changes reviewed:** ${summary.total_changes}`,
    `- **Audits passed:** ${summary.audits_passed}/${summary.audits_total} (${auditPct}%)`,
    `- **Risk distribution:** ${riskLine}`,
    `- **Overall posture:** ${summary.overall_posture}`,
    ``,
    `## Changes Overview`,
    ``,
    `| Change | Archived | Risk | Audit | Findings |`,
    `|--------|----------|------|-------|----------|`,
  ];

  for (const ch of changes) {
    const date = ch.archived_at.slice(0, 10);
    const verdict = ch.audit_verdict ?? "—";
    lines.push(`| ${ch.name} | ${date} | ${ch.risk_level} | ${verdict} | ${ch.review_findings} |`);
  }

  lines.push("", "## Findings by Risk Level", "");

  for (const level of ["critical", "high", "medium", "low"]) {
    const inLevel = changes.filter((c) => c.risk_level.toLowerCase() === level);
    lines.push(`### ${level.charAt(0).toUpperCase() + level.slice(1)} (${inLevel.length})`);
    if (inLevel.length > 0) {
      lines.push("");
      for (const ch of inLevel) {
        lines.push(`- **${ch.name}** — archived ${ch.archived_at.slice(0, 10)}, audit: ${ch.audit_verdict ?? "none"}`);
      }
    }
    lines.push("");
  }

  lines.push("## Timeline", "");
  for (const ch of changes) {
    lines.push(`- \`${ch.archived_at.slice(0, 10)}\` **${ch.name}** — ${ch.risk_level} risk, ${ch.review_findings} findings`);
  }

  lines.push("", "## Audit Coverage", "");
  lines.push(`| Change | Req Passed | Req Total | Verdict |`);
  lines.push(`|--------|-----------|-----------|---------|`);
  for (const ch of changes) {
    if (ch.audit_verdict) {
      lines.push(`| ${ch.name} | ${ch.audit_requirements_passed} | ${ch.audit_requirements_total} | ${ch.audit_verdict} |`);
    }
  }

  return lines.join("\n");
}

// ── Command registration ──────────────────────────────────────────────

export function registerReportCommand(program: Command): void {
  program
    .command("report")
    .description("Generate security posture compliance report from archived changes")
    .option("--output <file>", "Write report to file instead of stdout")
    .option("--format <fmt>", "Output format: markdown|json", "markdown")
    .option("--since <date>", "Filter by date (ISO 8601, e.g. 2026-01-01)")
    .option("--change <name>", "Single change deep-dive")
    .option("--json", "JSON output (same as --format json)")
    .action((opts: {
      output?: string;
      format?: string;
      since?: string;
      change?: string;
      json?: boolean;
    }) => {
      const speciaRoot = resolveVtspecRoot();

      if (!speciaRoot) {
        error("No .specia/ directory found. Run `specia init` first.");
        process.exitCode = 1;
        return;
      }

      const specsDir = path.join(speciaRoot, ".specia", "specs");
      const useJson = opts.json || opts.format === "json" || isJsonMode();

      let data: ReportData;
      try {
        data = buildReportData(specsDir, opts.since, opts.change);
      } catch (err) {
        error(`Failed to build report: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
        return;
      }

      if (data.changes.length === 0) {
        if (useJson) {
          jsonOutput({ status: "empty", message: "No archived changes found.", data });
        } else {
          warn("No archived changes found in .specia/specs/.");
          info("  Archive a change first with: specia done <change-name>");
        }
        return;
      }

      if (useJson) {
        const output = JSON.stringify(data, null, 2);
        if (opts.output) {
          fs.writeFileSync(opts.output, output, "utf-8");
          success(`Report written to ${opts.output}`);
        } else {
          console.log(output);
        }
        return;
      }

      const markdown = renderMarkdownReport(data);

      if (opts.output) {
        fs.writeFileSync(opts.output, markdown, "utf-8");
        success(`Report written to ${opts.output}`);
        info(`  Changes: ${data.summary.total_changes}`);
        info(`  Posture: ${data.summary.overall_posture}`);
      } else {
        console.log(markdown);
      }
    });
}
