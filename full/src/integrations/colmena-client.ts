/**
 * ColmenaClient — MCP client for Colmena integration.
 *
 * Connects to Colmena MCP server (if available) for shared multi-agent memory.
 * Provides graceful degradation — if Colmena is not available, returns empty results.
 *
 * Expected Colmena MCP tools:
 * - memory_search(query, project?, limit?)
 * - memory_save(title, content, project?, type?, scope?)
 * - memory_get(id)
 */

import type { ReviewMemory } from "./memory-adapter.js";

// ── Types ─────────────────────────────────────────────────────

interface ColmenaMemoryResult {
  id: number;
  title: string;
  content: string;
  type?: string;
  project?: string;
  scope?: string;
  timestamp: string;
  relevance?: number;
}

// ── ColmenaClient ─────────────────────────────────────────────

export class ColmenaClient {
  private static instance: ColmenaClient | null = null;
  private available = false;

  private constructor() {}

  static getInstance(): ColmenaClient {
    if (!ColmenaClient.instance) {
      ColmenaClient.instance = new ColmenaClient();
    }
    return ColmenaClient.instance;
  }

  /**
   * Check if Colmena is available.
   */
  async isAvailable(): Promise<boolean> {
    if (this.available) return true;

    try {
      const { existsSync } = await import("node:fs");
      const { homedir } = await import("node:os");
      const { join } = await import("node:path");

      // Check Claude Code config for Colmena MCP server
      const claudeConfig = join(homedir(), ".config", "claude", "claude_desktop_config.json");
      if (!existsSync(claudeConfig)) return false;

      const { readFile } = await import("node:fs/promises");
      const config = JSON.parse(await readFile(claudeConfig, "utf-8"));
      this.available = config.mcpServers?.colmena !== undefined;

      return this.available;
    } catch {
      return false;
    }
  }

  /**
   * Search Colmena shared memory.
   * 
   * NOTE: This assumes the agent runtime (Claude Code) will route the MCP call.
   * If called outside the agent context, this will fail gracefully.
   */
  async searchMemory(_query: string, _options: { project?: string; limit?: number } = {}): Promise<ColmenaMemoryResult[]> {
    if (!(await this.isAvailable())) {
      return [];
    }

    try {
      // In a real MCP context, this would be routed by the agent runtime.
      // For now, we'll use process.env to detect if we're in an agent context.
      if (!process.env.MCP_SERVER_NAME) {
        // Not in MCP context, cannot call Colmena tools directly
        return [];
      }

      // This is a placeholder — actual implementation would use MCP SDK
      // to call colmena.memory_search
      console.warn("ColmenaClient: Direct MCP calls not yet implemented. Use agent context.");
      return [];
    } catch (error) {
      console.error("ColmenaClient search error:", error);
      return [];
    }
  }

  /**
   * Save review to Colmena shared memory.
   */
  async saveReview(_review: ReviewMemory): Promise<void> {
    if (!(await this.isAvailable())) {
      return;
    }

    try {
      // In MCP context, this would call colmena.memory_save with serialized review
      if (!process.env.MCP_SERVER_NAME) {
        return;
      }

      // TODO: Implement actual MCP call
      // const content = this.serializeReview(review);
      // await mcpClient.call('colmena.memory_save', { title, content, ... });
      console.warn("ColmenaClient: Direct MCP calls not yet implemented. Use agent context.");
    } catch (error) {
      console.error("ColmenaClient save error:", error);
    }
  }

  /**
   * Serialize ReviewMemory to Colmena-compatible format.
   * Used when saving reviews to Colmena (via MCP in agent context).
   */
  serializeReview(review: ReviewMemory): string {
    const lines = [
      `# Security Review: ${review.changeName}`,
      "",
      `**Stack**: ${review.stack}`,
      `**Security Posture**: ${review.securityPosture}`,
      `**Timestamp**: ${review.timestamp}`,
      "",
      "## Top Findings",
      "",
      ...review.topFindings.map(f => `- ${f}`),
      "",
      "## Lessons Learned",
      "",
      ...review.lessonsLearned.map(l => `- ${l}`),
      "",
      "## Findings Detail",
      "",
      ...review.findings.map(f => 
        `- **${f.id}** [${f.severity}]: ${f.description || f.id}`
      ),
    ];

    return lines.join("\n");
  }

  /**
   * Parse Colmena memory results into ReviewMemory objects.
   */
  parseReviewFromMemory(result: ColmenaMemoryResult): ReviewMemory | null {
    try {
      // Extract metadata from content (basic markdown parsing)
      const content = result.content;
      const lines = content.split("\n");

      // Extract stack
      const stackLine = lines.find(l => l.startsWith("**Stack**:"));
      const stack = stackLine?.split(":")[1]?.trim() || "unknown";

      // Extract security posture
      const postureLine = lines.find(l => l.startsWith("**Security Posture**:"));
      const posture = (postureLine?.split(":")[1]?.trim() || "standard") as ReviewMemory["securityPosture"];

      // Extract change name from title
      const changeName = result.title.replace(/^Security Review:\s*/, "");

      return {
        changeName,
        timestamp: result.timestamp,
        stack,
        securityPosture: posture,
        findings: [], // Would need more complex parsing
        topFindings: [],
        lessonsLearned: [],
      };
    } catch {
      return null;
    }
  }
}
