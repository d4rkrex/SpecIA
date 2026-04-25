/**
 * Memory Adapter: Unified interface for cross-session learning.
 * 
 * Priority:
 * 1. Alejandría (if installed) - enterprise memory with embeddings
 * 2. Colmena Memory (if installed) - shared multi-agent memory
 * 3. Engram (always available) - local fallback
 * 
 * Usage:
 *   const memory = await MemoryAdapter.getInstance();
 *   const pastReviews = await memory.searchReviews({ stack: 'node', limit: 5 });
 */

import type { FindingContext } from "../types/debate.js";
import { ColmenaClient } from "./colmena-client.js";

// ── Types ─────────────────────────────────────────────────────

export interface MemoryBackend {
  name: 'alejandria' | 'colmena' | 'engram';
  available: boolean;
  priority: number;
}

export interface ReviewMemory {
  changeName: string;
  timestamp: string;
  stack: string;
  securityPosture: 'standard' | 'elevated' | 'paranoid';
  findings: FindingContext[];
  topFindings: string[]; // Top 3-5 finding IDs
  lessonsLearned: string[]; // Key insights from this review
}

export interface SearchOptions {
  stack?: string;
  securityPosture?: 'standard' | 'elevated' | 'paranoid';
  limit?: number;
  minRelevance?: number; // 0-1 for semantic search
}

export interface MemorySearchResult {
  reviews: ReviewMemory[];
  backend: 'alejandria' | 'colmena' | 'engram';
  relevanceScores?: number[]; // If semantic search was used
}

// ── Memory Adapter ────────────────────────────────────────────

export class MemoryAdapter {
  private static instance: MemoryAdapter | null = null;
  private backend: MemoryBackend | null = null;

  private constructor() {}

  static async getInstance(): Promise<MemoryAdapter> {
    if (!MemoryAdapter.instance) {
      MemoryAdapter.instance = new MemoryAdapter();
      await MemoryAdapter.instance.detectBackend();
    }
    return MemoryAdapter.instance;
  }

  /**
   * Detect available memory backend (priority order).
   */
  private async detectBackend(): Promise<void> {
    // Try Alejandría first
    if (await this.isAlejandriaAvailable()) {
      this.backend = { name: 'alejandria', available: true, priority: 1 };
      return;
    }

    // Try Colmena second
    if (await this.isColmenaAvailable()) {
      this.backend = { name: 'colmena', available: true, priority: 2 };
      return;
    }

    // Fallback to Engram (always available)
    this.backend = { name: 'engram', available: true, priority: 3 };
  }

  private async isAlejandriaAvailable(): Promise<boolean> {
    try {
      // Check if Alejandría MCP server is reachable
      // TODO: Implement actual check (e.g., ping Alejandría server)
      const { existsSync } = await import("node:fs");
      const { homedir } = await import("node:os");
      const { join } = await import("node:path");
      
      // Check for Alejandría config
      const alejandriaConfig = join(homedir(), '.alejandria', 'config.json');
      return existsSync(alejandriaConfig);
    } catch {
      return false;
    }
  }

  private async isColmenaAvailable(): Promise<boolean> {
    const client = ColmenaClient.getInstance();
    return await client.isAvailable();
  }

  /**
   * Get current backend name.
   */
  getBackend(): 'alejandria' | 'colmena' | 'engram' {
    return this.backend?.name ?? 'engram';
  }

  /**
   * Search past security reviews for learning.
   */
  async searchReviews(options: SearchOptions = {}): Promise<MemorySearchResult> {
    const backend = this.getBackend();

    switch (backend) {
      case 'alejandria':
        return await this.searchViaAlejandria(options);
      case 'colmena':
        return await this.searchViaColmena(options);
      case 'engram':
        return await this.searchViaEngram(options);
    }
  }

  private async searchViaAlejandria(options: SearchOptions): Promise<MemorySearchResult> {
    // TODO: Implement Alejandría semantic search
    // For now, fallback to Engram
    console.warn('Alejandría integration not yet implemented, falling back to Engram');
    return await this.searchViaEngram(options);
  }

  private async searchViaColmena(options: SearchOptions): Promise<MemorySearchResult> {
    const client = ColmenaClient.getInstance();
    
    try {
      // Build search query
      const query = `security review ${options.stack || ''} ${options.securityPosture || ''}`.trim();
      
      // Search Colmena shared memory
      const results = await client.searchMemory(query, {
        project: 'specia-reviews',
        limit: options.limit || 5,
      });

      // Parse results into ReviewMemory format
      const reviews: ReviewMemory[] = results
        .map(r => client.parseReviewFromMemory(r))
        .filter((r): r is ReviewMemory => r !== null);

      // Calculate relevance scores if available
      const relevanceScores = results
        .map(r => r.relevance)
        .filter((s): s is number => s !== undefined);

      return {
        reviews,
        backend: 'colmena',
        relevanceScores: relevanceScores.length > 0 ? relevanceScores : undefined,
      };
    } catch (error) {
      console.warn('Colmena search failed, falling back to Engram:', error);
      return await this.searchViaEngram(options);
    }
  }

  private async searchViaEngram(_options: SearchOptions): Promise<MemorySearchResult> {
    // Use Engram memory search (if available in environment)
    // This would be called by the agent runtime, not directly by SpecIA
    
    try {
      // In agent context, we'd call mem_search here
      // For standalone SpecIA, return empty results
      if (!process.env.MCP_SERVER_NAME) {
        return {
          reviews: [],
          backend: 'engram',
        };
      }

      // Placeholder for actual Engram integration
      // In practice, the agent would call engram_mem_search MCP tool
      console.warn('Engram search requires agent context. Returning empty results.');
      return {
        reviews: [],
        backend: 'engram',
      };
    } catch {
      return {
        reviews: [],
        backend: 'engram',
      };
    }
  }


  /**
   * Save review to memory for future learning.
   */
  async saveReview(review: ReviewMemory): Promise<void> {
    const backend = this.getBackend();

    switch (backend) {
      case 'alejandria':
        await this.saveViaAlejandria(review);
        break;
      case 'colmena':
        await this.saveViaColmena(review);
        break;
      case 'engram':
        await this.saveViaEngram(review);
        break;
    }
  }

  private async saveViaAlejandria(review: ReviewMemory): Promise<void> {
    // TODO: Save to Alejandría with embeddings
    console.warn('Alejandría save not yet implemented, falling back to Engram');
    await this.saveViaEngram(review);
  }

  private async saveViaColmena(review: ReviewMemory): Promise<void> {
    const client = ColmenaClient.getInstance();
    
    try {
      await client.saveReview(review);
    } catch (error) {
      console.warn('Colmena save failed, falling back to Engram:', error);
      await this.saveViaEngram(review);
    }
  }

  private async saveViaEngram(_review: ReviewMemory): Promise<void> {
    // Save to Engram (requires agent context)
    try {
      if (!process.env.MCP_SERVER_NAME) {
        // Not in agent context, cannot save to Engram
        return;
      }

      // Placeholder for actual Engram save
      // In practice, the agent would call engram_mem_save MCP tool
      console.warn('Engram save requires agent context.');
    } catch {
      // Graceful failure
    }
  }

  /**
   * Extract learnings from past reviews for enrichment.
   */
  extractLearnings(reviews: ReviewMemory[]): string[] {
    const allLearnings = reviews.flatMap(r => r.lessonsLearned);
    
    // Deduplicate and return top learnings
    return [...new Set(allLearnings)].slice(0, 10);
  }

  /**
   * Get common patterns from past findings.
   */
  getCommonPatterns(reviews: ReviewMemory[]): Map<string, number> {
    const patterns = new Map<string, number>();
    
    for (const review of reviews) {
      for (const finding of review.findings) {
        const category = finding.category || 'unknown';
        patterns.set(category, (patterns.get(category) || 0) + 1);
      }
    }
    
    return patterns;
  }
}

// ── Helper: Enrich Review Prompt with Past Learnings ─────────

export async function enrichReviewPrompt(
  basePrompt: string,
  _changeName: string,
  stack: string,
  securityPosture: 'standard' | 'elevated' | 'paranoid'
): Promise<string> {
  const memory = await MemoryAdapter.getInstance();
  
  // Search for relevant past reviews
  const { reviews, backend } = await memory.searchReviews({
    stack,
    securityPosture,
    limit: 5,
    minRelevance: 0.7,
  });

  if (reviews.length === 0) {
    // No past reviews found, return base prompt
    return basePrompt;
  }

  // Extract learnings
  const learnings = memory.extractLearnings(reviews);
  const commonPatterns = memory.getCommonPatterns(reviews);

  // Build enrichment section
  const enrichment = [
    "",
    "## Cross-Session Learnings",
    "",
    `**Memory Backend**: ${backend}`,
    `**Past Reviews Analyzed**: ${reviews.length}`,
    "",
    "### Common Patterns Seen in Similar Reviews:",
    "",
    ...Array.from(commonPatterns.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([pattern, count]) => `- **${pattern}**: ${count} occurrences`),
    "",
    "### Key Learnings from Past Reviews:",
    "",
    ...learnings.slice(0, 5).map(l => `- ${l}`),
    "",
    "**Note**: Use these learnings to inform your analysis, but don't let them bias you. Every change is unique.",
    "",
  ].join("\n");

  // Insert enrichment before the main prompt content
  return basePrompt.replace(
    /^(# Security Review)/m,
    `${enrichment}\n$1`
  );
}
