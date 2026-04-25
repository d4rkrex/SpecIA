/**
 * specia_search — Search past specs and security findings via Alejandria.
 *
 * Queries Alejandria's semantic memory for archived specs and security
 * findings. Returns relevant excerpts with change names and context.
 * Falls back to local file search when Alejandria is unavailable.
 *
 * Spec refs: Domain 7 (Spec Search — across archived specs)
 * Design refs: Decision 4 (Alejandria, What Gets Stored Where)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { FileStore } from "../services/store.js";
import { tryRecall } from "../services/memory-ops.js";
import { SearchInputSchema } from "./schemas.js";
import { ok, fail, ErrorCodes } from "../types/tools.js";
import type { ToolResult } from "../types/index.js";

export interface SearchResultItem {
  change_name: string;
  type: "spec" | "security-finding" | "context";
  excerpt: string;
  score?: number;
  source: "alejandria" | "engram" | "local";
}

export interface SearchResult {
  query: string;
  results: SearchResultItem[];
  total: number;
}

export async function handleSearch(
  args: unknown,
  rootDir: string,
): Promise<ToolResult<SearchResult>> {
  const start = Date.now();
  const toolName = "specia_search";
  const warnings: string[] = [];

  // Input validation
  const parsed = SearchInputSchema.safeParse(args);
  if (!parsed.success) {
    return fail(toolName, parsed.error.issues.map((i) => ({
      code: ErrorCodes.VALIDATION_ERROR,
      message: i.message,
      field: i.path.join("."),
    })), { duration_ms: Date.now() - start });
  }

  const input = parsed.data;
  const store = new FileStore(rootDir);

  // Check project is initialized
  if (!store.isInitialized()) {
    return fail(toolName, [{
      code: ErrorCodes.NOT_INITIALIZED,
      message: "Run specia_init first — .specia/config.yaml not found.",
    }], { duration_ms: Date.now() - start });
  }

  const config = store.readConfig();
  const results: SearchResultItem[] = [];

  // Try memory backend first (Alejandría or other configured backend)
  if (config.memory.backend !== "local") {
    const { data: memories, backend: memBackend, error: recallError } = await tryRecall(
      config.memory,
      input.query,
      { limit: input.limit },
    );

    for (const mem of memories) {
      const topicKey = mem.topic_key ?? "";
      let type: SearchResultItem["type"] = "context";
      let changeName = "unknown";

      if (topicKey.includes("/spec/")) {
        type = "spec";
        changeName = topicKey.split("/spec/").pop() ?? "unknown";
      } else if (topicKey.includes("/security/")) {
        type = "security-finding";
        changeName = topicKey.split("/security/").pop() ?? "unknown";
      } else if (topicKey.includes("/context")) {
        type = "context";
        changeName = config.project.name;
      }

      results.push({
        change_name: changeName,
        type,
        excerpt: truncateExcerpt(mem.content, 500),
        score: mem.score,
        source: memBackend as SearchResultItem["source"],
      });
    }

    if (recallError) {
      warnings.push(recallError);
    }
  }

  // Fallback: search local archived specs
  if (results.length === 0) {
    const localResults = searchLocalSpecs(rootDir, input.query, input.limit);
    results.push(...localResults);
    if (config.memory.backend !== "local" && results.length > 0) {
      warnings.push("Results from local files only — Alejandria not available for semantic search.");
    }
  }

  return ok(
    toolName,
    {
      query: input.query,
      results,
      total: results.length,
    },
    { duration_ms: Date.now() - start, warnings },
  );
}

// ── Local Fallback ───────────────────────────────────────────────────

/**
 * Simple text-based search through .specia/specs/ directory.
 * Looks for query terms in archived spec files.
 */
function searchLocalSpecs(
  rootDir: string,
  query: string,
  limit: number,
): SearchResultItem[] {
  const specsDir = path.join(rootDir, ".specia", "specs");
  if (!fs.existsSync(specsDir)) return [];

  const results: SearchResultItem[] = [];
  const queryTerms = query.toLowerCase().split(/\s+/).filter(Boolean);

  try {
    const files = fs.readdirSync(specsDir).filter((f) => f.endsWith(".md"));

    for (const file of files) {
      if (results.length >= limit) break;

      const content = fs.readFileSync(path.join(specsDir, file), "utf-8");
      const contentLower = content.toLowerCase();

      // Check if any query term matches
      const matchCount = queryTerms.filter((term) =>
        contentLower.includes(term),
      ).length;

      if (matchCount > 0) {
        const changeName = file.replace(/\.md$/, "");
        const excerpt = extractRelevantExcerpt(content, queryTerms);

        results.push({
          change_name: changeName,
          type: "spec",
          excerpt,
          score: matchCount / queryTerms.length,
          source: "local",
        });
      }
    }
  } catch {
    // Ignore read errors
  }

  // Also search active changes
  const changesDir = path.join(rootDir, ".specia", "changes");
  if (fs.existsSync(changesDir)) {
    try {
      const dirs = fs.readdirSync(changesDir, { withFileTypes: true });
      for (const dir of dirs) {
        if (results.length >= limit) break;
        if (!dir.isDirectory()) continue;

        // Search review.md for security findings
        const reviewPath = path.join(changesDir, dir.name, "review.md");
        if (fs.existsSync(reviewPath)) {
          const content = fs.readFileSync(reviewPath, "utf-8");
          const contentLower = content.toLowerCase();
          const matchCount = queryTerms.filter((term) =>
            contentLower.includes(term),
          ).length;

          if (matchCount > 0) {
            results.push({
              change_name: dir.name,
              type: "security-finding",
              excerpt: extractRelevantExcerpt(content, queryTerms),
              score: matchCount / queryTerms.length,
              source: "local",
            });
          }
        }
      }
    } catch {
      // Ignore read errors
    }
  }

  // Sort by score descending
  results.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  return results.slice(0, limit);
}

/**
 * Extract a relevant excerpt around the first matching query term.
 */
function extractRelevantExcerpt(content: string, queryTerms: string[]): string {
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

  // No match found — return first 500 chars
  return truncateExcerpt(content, 500);
}

/**
 * Truncate content to maxLen characters.
 */
function truncateExcerpt(content: string, maxLen: number): string {
  if (content.length <= maxLen) return content;
  return content.slice(0, maxLen) + "...";
}
