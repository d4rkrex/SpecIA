/**
 * CLI `specia search` — Search past specs and security findings.
 *
 * Falls back to local file search when Alejandria is unavailable.
 * Calls FileStore + local search directly.
 * Design refs: Decision 18, Decision 20
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { Command } from "commander";
import { FileStore } from "../../services/store.js";
import {
  error,
  info,
  dim,
  jsonOutput,
  isJsonMode,
} from "../output.js";

interface SearchHit {
  change_name: string;
  type: string;
  excerpt: string;
  score: number;
}

export function registerSearchCommand(program: Command): void {
  program
    .command("search <query>")
    .description("Search past specs and security findings")
    .option("--limit <n>", "Max results", "10")
    .action(async (query: string, opts: { limit: string }) => {
      const rootDir = process.cwd();
      const store = new FileStore(rootDir);
      const limit = parseInt(opts.limit, 10) || 10;

      if (!store.isInitialized()) {
        error("Not initialized. Run `specia init` first.");
        process.exitCode = 1;
        return;
      }

      const results = searchLocalSpecs(rootDir, query, limit);

      if (isJsonMode()) {
        jsonOutput({
          query,
          results,
          total: results.length,
        });
      } else if (results.length === 0) {
        info(`No results found for "${query}".`);
      } else {
        info(`Found ${results.length} result(s) for "${query}":`);
        console.log("");

        for (const hit of results) {
          info(`  [${hit.type}] ${hit.change_name} (score: ${hit.score.toFixed(2)})`);
          dim(`    ${hit.excerpt.slice(0, 120)}${hit.excerpt.length > 120 ? "..." : ""}`);
          console.log("");
        }
      }
    });
}

// ── Local search ─────────────────────────────────────────────────────

function searchLocalSpecs(
  rootDir: string,
  query: string,
  limit: number,
): SearchHit[] {
  const results: SearchHit[] = [];
  const queryTerms = query.toLowerCase().split(/\s+/).filter(Boolean);

  // Search archived specs
  const specsDir = path.join(rootDir, ".specia", "specs");
  if (fs.existsSync(specsDir)) {
    try {
      const files = fs.readdirSync(specsDir).filter(f => f.endsWith(".md"));
      for (const file of files) {
        if (results.length >= limit) break;
        const content = fs.readFileSync(path.join(specsDir, file), "utf-8");
        const contentLower = content.toLowerCase();
        const matchCount = queryTerms.filter(t => contentLower.includes(t)).length;
        if (matchCount > 0) {
          results.push({
            change_name: file.replace(/\.md$/, ""),
            type: "spec",
            excerpt: extractExcerpt(content, queryTerms),
            score: matchCount / queryTerms.length,
          });
        }
      }
    } catch {
      // Ignore read errors
    }
  }

  // Search active changes (review.md for security findings)
  const changesDir = path.join(rootDir, ".specia", "changes");
  if (fs.existsSync(changesDir)) {
    try {
      const dirs = fs.readdirSync(changesDir, { withFileTypes: true });
      for (const dir of dirs) {
        if (results.length >= limit) break;
        if (!dir.isDirectory()) continue;

        const reviewPath = path.join(changesDir, dir.name, "review.md");
        if (fs.existsSync(reviewPath)) {
          const content = fs.readFileSync(reviewPath, "utf-8");
          const contentLower = content.toLowerCase();
          const matchCount = queryTerms.filter(t => contentLower.includes(t)).length;
          if (matchCount > 0) {
            results.push({
              change_name: dir.name,
              type: "security-finding",
              excerpt: extractExcerpt(content, queryTerms),
              score: matchCount / queryTerms.length,
            });
          }
        }
      }
    } catch {
      // Ignore read errors
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

function extractExcerpt(content: string, queryTerms: string[]): string {
  const contentLower = content.toLowerCase();
  for (const term of queryTerms) {
    const idx = contentLower.indexOf(term);
    if (idx !== -1) {
      const start = Math.max(0, idx - 100);
      const end = Math.min(content.length, idx + term.length + 400);
      let excerpt = content.slice(start, end).trim();
      if (start > 0) excerpt = "..." + excerpt;
      if (end < content.length) excerpt = excerpt + "...";
      return excerpt;
    }
  }
  return content.slice(0, 500);
}
