/**
 * Unified memory operations for SpecIA.
 *
 * Single entry point for all memory store/recall across phases.
 * Cascades: Alejandría (child process) → graceful no-op (local).
 *
 * When `backend === "engram"`, SpecIA's Node.js process cannot call
 * Engram directly (it's an MCP tool in the agent runtime). The tool
 * response includes `memory_hint` so the orchestrating agent can
 * perform memory operations using its own MCP tools.
 *
 * Design refs: Decision 4 (What Gets Stored Where)
 */

import { getMemoryClient } from "./memory.js";
import type { MemoryConfig } from "../types/config.js";
import type { Memory, StoreOpts, RecallOpts } from "../types/memory.js";

// ── Result Types ─────────────────────────────────────────────────────

export interface MemoryOpResult<T> {
  data: T;
  backend: "alejandria" | "engram" | "local";
  error?: string;
}

/**
 * Hint included in tool JSON responses so agents know what memory
 * operations to perform when backend is "engram".
 */
export interface MemoryHint {
  backend: "alejandria" | "engram" | "local";
  /** Suggested recall query for the agent to execute via MCP tools. */
  recall_query?: string;
  /** Suggested recall topic/scope for filtering. */
  recall_scope?: string;
  /** Suggested store topic_key for the agent to use. */
  store_topic_key?: string;
  /** Suggested store topic for the agent to use. */
  store_topic?: string;
  /** Suggested importance level. */
  store_importance?: StoreOpts["importance"];
}

// ── Core Operations ──────────────────────────────────────────────────

/**
 * Try to recall memories. Cascades: Alejandría → no-op.
 *
 * Uses semantic/content query + optional scope (topic filter).
 * Does NOT use topic_key as query — topic_key is for storage upsert.
 */
export async function tryRecall(
  config: MemoryConfig,
  query: string,
  opts?: RecallOpts,
): Promise<MemoryOpResult<Memory[]>> {
  if (config.backend === "alejandria") {
    try {
      const client = getMemoryClient(config);
      const results = await client.recall(query, opts);
      return { data: results, backend: "alejandria" };
    } catch (err) {
      return {
        data: [],
        backend: "alejandria",
        error: `alejandria_unavailable: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // "engram" and "local" backends: no direct recall from Node.js
  return { data: [], backend: config.backend === "engram" ? "engram" : "local" };
}

/**
 * Try to store a memory. Cascades: Alejandría → no-op.
 *
 * Returns the stored memory ID, or null if storage was skipped/failed.
 */
export async function tryStore(
  config: MemoryConfig,
  content: string,
  opts: StoreOpts,
): Promise<MemoryOpResult<string | null>> {
  if (config.backend === "alejandria") {
    try {
      const client = getMemoryClient(config);
      const id = await client.store(content, opts);
      return { data: id, backend: "alejandria" };
    } catch (err) {
      return {
        data: null,
        backend: "alejandria",
        error: `alejandria_unavailable: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // "engram" and "local": no direct store from Node.js
  return { data: null, backend: config.backend === "engram" ? "engram" : "local" };
}

// ── Hint Builders ────────────────────────────────────────────────────

/**
 * Build a memory hint for propose phase.
 * Tells the agent what to recall/store if using Engram.
 */
export function buildProposeHint(
  config: MemoryConfig,
  projectName: string,
  changeName: string,
  intent: string,
): MemoryHint {
  return {
    backend: config.backend === "engram" ? "engram" : config.backend,
    recall_query: `proposals architecture decisions ${intent}`,
    recall_scope: `specia/${projectName}`,
    store_topic_key: `specia/${projectName}/proposal/${changeName}`,
    store_topic: "proposals",
    store_importance: "medium",
  };
}

/**
 * Build a memory hint for spec phase.
 */
export function buildSpecHint(
  config: MemoryConfig,
  projectName: string,
  changeName: string,
): MemoryHint {
  return {
    backend: config.backend === "engram" ? "engram" : config.backend,
    recall_query: `spec requirements scenarios ${projectName}`,
    recall_scope: `specia/${projectName}`,
    store_topic_key: `specia/${projectName}/spec/${changeName}`,
    store_topic: "specs",
    store_importance: "medium",
  };
}

/**
 * Build a memory hint for design phase.
 */
export function buildDesignHint(
  config: MemoryConfig,
  projectName: string,
  changeName: string,
): MemoryHint {
  return {
    backend: config.backend === "engram" ? "engram" : config.backend,
    recall_query: `design architecture decisions patterns ${projectName}`,
    recall_scope: `specia/${projectName}`,
    store_topic_key: `specia/${projectName}/design/${changeName}`,
    store_topic: "designs",
    store_importance: "medium",
  };
}

/**
 * Build a memory hint for review phase.
 */
export function buildReviewHint(
  config: MemoryConfig,
  projectName: string,
  changeName: string,
): MemoryHint {
  return {
    backend: config.backend === "engram" ? "engram" : config.backend,
    recall_query: `security review findings vulnerabilities ${projectName}`,
    recall_scope: `specia/${projectName}`,
    store_topic_key: `specia/${projectName}/security/${changeName}`,
    store_topic: "security-review",
    store_importance: "high",
  };
}

/**
 * Build a memory hint for audit phase.
 */
export function buildAuditHint(
  config: MemoryConfig,
  projectName: string,
  changeName: string,
): MemoryHint {
  return {
    backend: config.backend === "engram" ? "engram" : config.backend,
    recall_query: `audit findings compliance ${projectName}`,
    recall_scope: `specia/${projectName}`,
    store_topic_key: `specia/${projectName}/audit/${changeName}`,
    store_topic: "spec-audit",
    store_importance: "medium",
  };
}

// ── Memory Context Formatting ────────────────────────────────────────

/**
 * Format recalled memories as context excerpts suitable for
 * inclusion in tool JSON responses.
 */
export function formatMemoryContext(memories: Memory[], maxExcerpts: number = 5): string[] {
  return memories
    .slice(0, maxExcerpts)
    .map((m) => m.summary ?? m.content.slice(0, 300));
}
