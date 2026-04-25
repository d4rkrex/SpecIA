/**
 * SpecCacheService — Dual cache system for Layer 4a/4b results.
 *
 * Two separate cache key schemas:
 * - Layer 4a: SHA256(file_sha + spec_keywords_hash) — invalidates on file/keywords change
 * - Layer 4b: SHA256(file_sha + spec_hash + review_hash + posture) — invalidates on file/spec/review change
 *
 * Cache file: .specia/.guardian-spec-cache.json
 *
 * Spec refs: guardian-spec-aware — Domain 3 (Dual Cache System)
 * Design refs: guardian-spec-aware — Decision 6 (Dual Cache System Design)
 *
 * v0.4: Phase 4 implementation
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type {
  GuardianSpecCache,
  L4aCacheEntry,
  L4bCacheEntry,
} from "../types/guardian.js";

// ── Constants ────────────────────────────────────────────────────────

/** Current cache version. */
const CACHE_VERSION = "0.4.0";

/** Default cache file name. */
const CACHE_FILE = ".guardian-spec-cache.json";

// ── Service ──────────────────────────────────────────────────────────

/**
 * SpecCacheService manages Layer 4 validation cache.
 *
 * Provides separate caching for Layer 4a (heuristics) and Layer 4b (LLM),
 * with different invalidation rules and hit rate tracking.
 */
export class SpecCacheService {
  private cache: GuardianSpecCache;
  private readonly cachePath: string;

  // Hit/miss tracking
  private l4aHits = 0;
  private l4aMisses = 0;
  private l4bHits = 0;
  private l4bMisses = 0;

  constructor(private readonly speciaPath: string) {
    this.cachePath = path.join(speciaPath, CACHE_FILE);
    this.cache = this.loadCache();
  }

  // ── Cache Load/Save ──────────────────────────────────────────────────

  /**
   * Load cache from disk.
   *
   * Handles corrupted JSON, version mismatch, and missing cache gracefully.
   *
   * @returns Loaded cache or empty cache
   */
  private loadCache(): GuardianSpecCache {
    if (!fs.existsSync(this.cachePath)) {
      return this.createEmptyCache();
    }

    try {
      const content = fs.readFileSync(this.cachePath, "utf-8");
      const cache = JSON.parse(content) as GuardianSpecCache;

      // Validate version
      if (cache.version !== CACHE_VERSION) {
        console.warn(
          `[Guardian] Cache version mismatch (${cache.version} vs ${CACHE_VERSION}), invalidating cache`,
        );
        this.deleteCache();
        return this.createEmptyCache();
      }

      // Validate structure
      if (!cache.l4a_entries || !cache.l4b_entries) {
        console.warn("[Guardian] Invalid cache structure, invalidating cache");
        this.deleteCache();
        return this.createEmptyCache();
      }

      return cache;
    } catch (error) {
      console.warn("[Guardian] Cache corrupted, deleting and recreating:", error);
      this.deleteCache();
      return this.createEmptyCache();
    }
  }

  /**
   * Save cache to disk.
   *
   * Non-fatal — if save fails, validation continues without caching.
   */
  saveCache(): void {
    try {
      // Ensure directory exists
      if (!fs.existsSync(this.speciaPath)) {
        fs.mkdirSync(this.speciaPath, { recursive: true });
      }

      // Write cache with pretty-print
      fs.writeFileSync(
        this.cachePath,
        JSON.stringify(this.cache, null, 2),
        "utf-8",
      );
    } catch (error) {
      console.warn("[Guardian] Failed to save cache (non-fatal):", error);
    }
  }

  /**
   * Delete cache file.
   */
  private deleteCache(): void {
    try {
      if (fs.existsSync(this.cachePath)) {
        fs.unlinkSync(this.cachePath);
      }
    } catch (error) {
      console.warn("[Guardian] Failed to delete cache:", error);
    }
  }

  /**
   * Create empty cache structure.
   */
  private createEmptyCache(): GuardianSpecCache {
    return {
      version: CACHE_VERSION,
      l4a_entries: {},
      l4b_entries: {},
    };
  }

  // ── Layer 4a Cache Operations ────────────────────────────────────────

  /**
   * Get Layer 4a cache entry.
   *
   * @param cacheKey - Cache key from computeL4aCacheKey()
   * @returns Cache entry or null if not found
   */
  getL4aEntry(cacheKey: string): L4aCacheEntry | null {
    const entry = this.cache.l4a_entries[cacheKey] ?? null;
    if (entry) {
      this.l4aHits++;
    } else {
      this.l4aMisses++;
    }
    return entry;
  }

  /**
   * Set Layer 4a cache entry.
   *
   * @param entry - Cache entry to store
   */
  setL4aEntry(entry: L4aCacheEntry): void {
    this.cache.l4a_entries[entry.cache_key] = entry;
  }

  // ── Layer 4b Cache Operations ────────────────────────────────────────

  /**
   * Get Layer 4b cache entry.
   *
   * @param cacheKey - Cache key from computeL4bCacheKey()
   * @returns Cache entry or null if not found
   */
  getL4bEntry(cacheKey: string): L4bCacheEntry | null {
    const entry = this.cache.l4b_entries[cacheKey] ?? null;
    if (entry) {
      this.l4bHits++;
    } else {
      this.l4bMisses++;
    }
    return entry;
  }

  /**
   * Set Layer 4b cache entry.
   *
   * @param entry - Cache entry to store
   */
  setL4bEntry(entry: L4bCacheEntry): void {
    this.cache.l4b_entries[entry.cache_key] = entry;
  }

  // ── Cache Invalidation ───────────────────────────────────────────────

  /**
   * Invalidate all Layer 4b entries (e.g., on spec/review change).
   *
   * Layer 4a entries persist (they only depend on file + keywords).
   */
  invalidateL4b(): void {
    this.cache.l4b_entries = {};
  }

  /**
   * Invalidate all cache entries.
   */
  invalidateAll(): void {
    this.cache.l4a_entries = {};
    this.cache.l4b_entries = {};
  }

  // ── Cache Statistics ─────────────────────────────────────────────────

  /**
   * Get cache statistics.
   *
   * @returns Hit/miss counts and hit rates
   */
  getStats(): {
    l4a_hits: number;
    l4a_misses: number;
    l4b_hits: number;
    l4b_misses: number;
    l4a_hit_rate: string;
    l4b_hit_rate: string;
  } {
    const l4aTotal = this.l4aHits + this.l4aMisses;
    const l4bTotal = this.l4bHits + this.l4bMisses;

    const l4aRate =
      l4aTotal > 0 ? ((this.l4aHits / l4aTotal) * 100).toFixed(0) : "0";
    const l4bRate =
      l4bTotal > 0 ? ((this.l4bHits / l4bTotal) * 100).toFixed(0) : "0";

    return {
      l4a_hits: this.l4aHits,
      l4a_misses: this.l4aMisses,
      l4b_hits: this.l4bHits,
      l4b_misses: this.l4bMisses,
      l4a_hit_rate: `${l4aRate}%`,
      l4b_hit_rate: `${l4bRate}%`,
    };
  }

  /**
   * Reset statistics counters.
   */
  clearStats(): void {
    this.l4aHits = 0;
    this.l4aMisses = 0;
    this.l4bHits = 0;
    this.l4bMisses = 0;
  }

  /**
   * Get cache entry counts.
   */
  getCounts(): {
    l4a_entries: number;
    l4b_entries: number;
    total_entries: number;
  } {
    const l4aCount = Object.keys(this.cache.l4a_entries).length;
    const l4bCount = Object.keys(this.cache.l4b_entries).length;

    return {
      l4a_entries: l4aCount,
      l4b_entries: l4bCount,
      total_entries: l4aCount + l4bCount,
    };
  }
}
