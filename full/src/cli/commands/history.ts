/**
 * CLI `specia history` — Security findings trend over time.
 *
 * Queries ~/.local/share/specia/analytics.db findings table
 * and shows severity trends grouped by week or month.
 */

import { Command } from "commander";
import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  dim,
  warn,
  jsonOutput,
  isJsonMode,
} from "../output.js";

interface FindingRow {
  week: string;
  critical: number;
  high: number;
  medium: number;
  low: number;
  total: number;
}

function getDbPath(): string {
  return path.join(os.homedir(), ".local", "share", "specia", "analytics.db");
}

function parseSinceDuration(since: string): Date {
  const now = new Date();
  const match = since.match(/^(\d+)([dwmy])$/);
  if (!match) throw new Error(`Invalid --since format: "${since}". Use e.g. 30d, 7d, 3m, 1y`);
  const [, num, unit] = match;
  const n = parseInt(num ?? "30", 10);
  switch (unit) {
    case "d": return new Date(now.getTime() - n * 86400000);
    case "w": return new Date(now.getTime() - n * 7 * 86400000);
    case "m": return new Date(now.getTime() - n * 30 * 86400000);
    case "y": return new Date(now.getTime() - n * 365 * 86400000);
    default:  return new Date(now.getTime() - 30 * 86400000);
  }
}

function renderAsciiBar(value: number, maxValue: number, width: number = 30): string {
  if (maxValue === 0) return " ".repeat(width);
  const filled = Math.round((value / maxValue) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

export function registerHistoryCommand(program: Command): void {
  program
    .command("history")
    .description("Show security findings trend over time")
    .option("--since <duration>", "filter by age (e.g. 30d, 90d, 6m, 1y)", "90d")
    .option("--project <path>", "filter by project path")
    .option("--format <fmt>", "output format: text or json", "text")
    .option("--json", "alias for --format json")
    .action((opts) => {
      const dbPath = getDbPath();
      if (!fs.existsSync(dbPath)) {
        if (isJsonMode() || opts.json || opts.format === "json") {
          jsonOutput({ status: "no_data", message: "No findings database found. Run specia done on a completed change first." });
        } else {
          warn("No findings history found.");
          dim("  Run `specia done` on a completed change to start tracking findings.");
          dim(`  Database will be created at: ${dbPath}`);
        }
        return;
      }

      let sinceDate: Date;
      try {
        sinceDate = parseSinceDuration(opts.since);
      } catch (e) {
        console.error(e instanceof Error ? e.message : String(e));
        process.exitCode = 1;
        return;
      }

      const db = new Database(dbPath, { readonly: true });

      try {
        // Weekly severity breakdown
        const rows = db.prepare(`
          SELECT
            strftime('%Y-W%W', timestamp) AS week,
            SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END) AS critical,
            SUM(CASE WHEN severity = 'high' THEN 1 ELSE 0 END) AS high,
            SUM(CASE WHEN severity = 'medium' THEN 1 ELSE 0 END) AS medium,
            SUM(CASE WHEN severity = 'low' THEN 1 ELSE 0 END) AS low,
            COUNT(*) AS total
          FROM findings
          WHERE timestamp >= ?
            ${opts.project ? "AND project_path = ?" : ""}
          GROUP BY week
          ORDER BY week ASC
        `).all(
          sinceDate.toISOString(),
          ...(opts.project ? [opts.project] : [])
        ) as FindingRow[];

        // Top threat categories
        const topCategories = db.prepare(`
          SELECT category, COUNT(*) AS cnt,
            SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END) AS critical
          FROM findings
          WHERE timestamp >= ?
            ${opts.project ? "AND project_path = ?" : ""}
          GROUP BY category
          ORDER BY critical DESC, cnt DESC
          LIMIT 5
        `).all(
          sinceDate.toISOString(),
          ...(opts.project ? [opts.project] : [])
        ) as { category: string; cnt: number; critical: number }[];

        // Overall summary
        const summary = db.prepare(`
          SELECT
            COUNT(DISTINCT change_name) AS changes,
            COUNT(*) AS total_findings,
            SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END) AS critical,
            SUM(CASE WHEN severity = 'high' THEN 1 ELSE 0 END) AS high,
            SUM(CASE WHEN severity = 'medium' THEN 1 ELSE 0 END) AS medium,
            SUM(CASE WHEN severity = 'low' THEN 1 ELSE 0 END) AS low
          FROM findings
          WHERE timestamp >= ?
            ${opts.project ? "AND project_path = ?" : ""}
        `).get(
          sinceDate.toISOString(),
          ...(opts.project ? [opts.project] : [])
        ) as { changes: number; total_findings: number; critical: number; high: number; medium: number; low: number };

        if (isJsonMode() || opts.json || opts.format === "json") {
          jsonOutput({ since: sinceDate.toISOString(), summary, weekly: rows, top_categories: topCategories });
          return;
        }

        // Text output
        console.log("");
        console.log("  📊 Security Findings History");
        console.log("  " + "─".repeat(50));
        console.log(`  Period: last ${opts.since}${opts.project ? ` · project: ${opts.project}` : ""}`);
        console.log(`  Changes archived: ${summary.changes ?? 0}`);
        console.log(`  Total findings:   ${summary.total_findings ?? 0}`);
        console.log(`  🔴 Critical: ${summary.critical ?? 0}  🟠 High: ${summary.high ?? 0}  🟡 Medium: ${summary.medium ?? 0}  🟢 Low: ${summary.low ?? 0}`);
        console.log("");

        if (rows.length === 0) {
          dim("  No findings in this period.");
        } else {
          const maxTotal = Math.max(...rows.map((r) => r.total));
          console.log("  Weekly trend (🔴 critical · 🟠 high · 🟡 medium · 🟢 low):");
          console.log("");
          for (const row of rows) {
            const bar = renderAsciiBar(row.total, maxTotal, 25);
            console.log(`  ${row.week}  ${bar}  ${String(row.total).padStart(3)} findings  (C:${row.critical} H:${row.high} M:${row.medium} L:${row.low})`);
          }
          console.log("");
        }

        if (topCategories.length > 0) {
          console.log("  Top threat categories:");
          for (const cat of topCategories) {
            console.log(`  · ${cat.category.padEnd(30)} ${cat.cnt} findings  (${cat.critical} critical)`);
          }
          console.log("");
        }

        // Trend analysis
        if (rows.length >= 2) {
          const firstHalf = rows.slice(0, Math.floor(rows.length / 2));
          const secondHalf = rows.slice(Math.floor(rows.length / 2));
          const avgFirst = firstHalf.reduce((a, r) => a + r.total, 0) / firstHalf.length;
          const avgSecond = secondHalf.reduce((a, r) => a + r.total, 0) / secondHalf.length;
          const trend = avgSecond < avgFirst * 0.8 ? "↘ improving" : avgSecond > avgFirst * 1.2 ? "↗ increasing" : "→ stable";
          console.log(`  Trend: ${trend} (avg ${avgFirst.toFixed(1)} → ${avgSecond.toFixed(1)} findings/week)`);
          console.log("");
        }

      } finally {
        db.close();
      }
    });
}
