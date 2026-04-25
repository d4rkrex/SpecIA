/**
 * Tests for SpecCacheService.
 *
 * Phase 4: Dual Cache System tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { SpecCacheService } from "../../src/services/spec-cache.js";
import type { L4aCacheEntry, L4bCacheEntry } from "../../src/types/guardian.js";

describe("SpecCacheService", () => {
  const testDir = path.join(__dirname, "../fixtures/temp/spec-cache-test");
  let service: SpecCacheService;

  beforeEach(() => {
    // Create test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
    fs.mkdirSync(testDir, { recursive: true });

    service = new SpecCacheService(testDir);
  });

  afterEach(() => {
    // Clean up
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  describe("Layer 4a cache operations", () => {
    it("should return null for cache miss", () => {
      const entry = service.getL4aEntry("nonexistent-key");
      expect(entry).toBeNull();
    });

    it("should store and retrieve Layer 4a entry", () => {
      const entry: L4aCacheEntry = {
        file: "src/auth/login.ts",
        cache_key: "test-key-4a",
        result: "pass",
        evidence_score: 5,
        evidence_sources: [
          {
            type: "function_name",
            weight: 3,
            match: "authenticateUser",
            location: "src/auth/login.ts:10",
          },
        ],
        timestamp: new Date().toISOString(),
      };

      service.setL4aEntry(entry);
      const retrieved = service.getL4aEntry("test-key-4a");

      expect(retrieved).toEqual(entry);
    });

    it("should track Layer 4a cache hits and misses", () => {
      service.getL4aEntry("miss-1"); // Miss
      service.getL4aEntry("miss-2"); // Miss

      const entry: L4aCacheEntry = {
        file: "test.ts",
        cache_key: "hit-key",
        result: "pass",
        evidence_score: 1,
        evidence_sources: [],
        timestamp: new Date().toISOString(),
      };
      service.setL4aEntry(entry);

      service.getL4aEntry("hit-key"); // Hit
      service.getL4aEntry("hit-key"); // Hit

      const stats = service.getStats();
      expect(stats.l4a_hits).toBe(2);
      expect(stats.l4a_misses).toBe(2);
      expect(stats.l4a_hit_rate).toBe("50%");
    });
  });

  describe("Layer 4b cache operations", () => {
    it("should return null for cache miss", () => {
      const entry = service.getL4bEntry("nonexistent-key");
      expect(entry).toBeNull();
    });

    it("should store and retrieve Layer 4b entry", () => {
      const entry: L4bCacheEntry = {
        file: "src/auth/login.ts",
        cache_key: "test-key-4b",
        verdict: "pass",
        failed_requirements: [],
        failed_abuse_cases: [],
        timestamp: new Date().toISOString(),
      };

      service.setL4bEntry(entry);
      const retrieved = service.getL4bEntry("test-key-4b");

      expect(retrieved).toEqual(entry);
    });

    it("should track Layer 4b cache hits and misses", () => {
      service.getL4bEntry("miss-1"); // Miss

      const entry: L4bCacheEntry = {
        file: "test.ts",
        cache_key: "hit-key",
        verdict: "fail",
        failed_requirements: ["REQ-001"],
        failed_abuse_cases: [],
        timestamp: new Date().toISOString(),
      };
      service.setL4bEntry(entry);

      service.getL4bEntry("hit-key"); // Hit
      service.getL4bEntry("hit-key"); // Hit
      service.getL4bEntry("hit-key"); // Hit

      const stats = service.getStats();
      expect(stats.l4b_hits).toBe(3);
      expect(stats.l4b_misses).toBe(1);
      expect(stats.l4b_hit_rate).toBe("75%");
    });
  });

  describe("Cache persistence", () => {
    it("should persist cache to disk", () => {
      const entry: L4aCacheEntry = {
        file: "test.ts",
        cache_key: "persist-key",
        result: "pass",
        evidence_score: 3,
        evidence_sources: [],
        timestamp: new Date().toISOString(),
      };

      service.setL4aEntry(entry);
      service.saveCache();

      // Create new service instance to load from disk
      const newService = new SpecCacheService(testDir);
      const retrieved = newService.getL4aEntry("persist-key");

      expect(retrieved).toEqual(entry);
    });

    it("should handle corrupted cache file gracefully", () => {
      // Write corrupted JSON
      const cachePath = path.join(testDir, ".guardian-spec-cache.json");
      fs.writeFileSync(cachePath, "{ invalid json", "utf-8");

      // Should create new cache without crashing
      const newService = new SpecCacheService(testDir);
      const entry = newService.getL4aEntry("any-key");

      expect(entry).toBeNull();
    });

    it("should invalidate cache on version mismatch", () => {
      const cachePath = path.join(testDir, ".guardian-spec-cache.json");
      const oldCache = {
        version: "0.3.0",
        l4a_entries: { "old-key": { file: "test.ts" } },
        l4b_entries: {},
      };

      fs.writeFileSync(cachePath, JSON.stringify(oldCache), "utf-8");

      // Should invalidate and create fresh cache
      const newService = new SpecCacheService(testDir);
      const entry = newService.getL4aEntry("old-key");

      expect(entry).toBeNull();
    });
  });

  describe("Cache invalidation", () => {
    it("should invalidate Layer 4b entries only", () => {
      const l4aEntry: L4aCacheEntry = {
        file: "test.ts",
        cache_key: "l4a-key",
        result: "pass",
        evidence_score: 2,
        evidence_sources: [],
        timestamp: new Date().toISOString(),
      };

      const l4bEntry: L4bCacheEntry = {
        file: "test.ts",
        cache_key: "l4b-key",
        verdict: "pass",
        failed_requirements: [],
        failed_abuse_cases: [],
        timestamp: new Date().toISOString(),
      };

      service.setL4aEntry(l4aEntry);
      service.setL4bEntry(l4bEntry);

      service.invalidateL4b();

      // Layer 4a should persist
      expect(service.getL4aEntry("l4a-key")).toEqual(l4aEntry);
      // Layer 4b should be invalidated
      expect(service.getL4bEntry("l4b-key")).toBeNull();
    });

    it("should invalidate all entries", () => {
      const l4aEntry: L4aCacheEntry = {
        file: "test.ts",
        cache_key: "l4a-key",
        result: "pass",
        evidence_score: 2,
        evidence_sources: [],
        timestamp: new Date().toISOString(),
      };

      const l4bEntry: L4bCacheEntry = {
        file: "test.ts",
        cache_key: "l4b-key",
        verdict: "pass",
        failed_requirements: [],
        failed_abuse_cases: [],
        timestamp: new Date().toISOString(),
      };

      service.setL4aEntry(l4aEntry);
      service.setL4bEntry(l4bEntry);

      service.invalidateAll();

      expect(service.getL4aEntry("l4a-key")).toBeNull();
      expect(service.getL4bEntry("l4b-key")).toBeNull();
    });
  });

  describe("Cache statistics", () => {
    it("should calculate hit rate correctly", () => {
      const entry: L4aCacheEntry = {
        file: "test.ts",
        cache_key: "key",
        result: "pass",
        evidence_score: 1,
        evidence_sources: [],
        timestamp: new Date().toISOString(),
      };
      service.setL4aEntry(entry);

      // 3 hits, 1 miss → 75% hit rate
      service.getL4aEntry("key");
      service.getL4aEntry("key");
      service.getL4aEntry("key");
      service.getL4aEntry("miss");

      const stats = service.getStats();
      expect(stats.l4a_hit_rate).toBe("75%");
    });

    it("should return 0% for no cache operations", () => {
      const stats = service.getStats();
      expect(stats.l4a_hit_rate).toBe("0%");
      expect(stats.l4b_hit_rate).toBe("0%");
    });

    it("should clear statistics", () => {
      const entry: L4aCacheEntry = {
        file: "test.ts",
        cache_key: "key",
        result: "pass",
        evidence_score: 1,
        evidence_sources: [],
        timestamp: new Date().toISOString(),
      };
      service.setL4aEntry(entry);
      service.getL4aEntry("key");

      let stats = service.getStats();
      expect(stats.l4a_hits).toBe(1);

      service.clearStats();
      stats = service.getStats();
      expect(stats.l4a_hits).toBe(0);
      expect(stats.l4a_misses).toBe(0);
    });

    it("should count cache entries", () => {
      service.setL4aEntry({
        file: "test1.ts",
        cache_key: "key1",
        result: "pass",
        evidence_score: 1,
        evidence_sources: [],
        timestamp: new Date().toISOString(),
      });

      service.setL4aEntry({
        file: "test2.ts",
        cache_key: "key2",
        result: "flag",
        evidence_score: 0,
        evidence_sources: [],
        timestamp: new Date().toISOString(),
      });

      service.setL4bEntry({
        file: "test3.ts",
        cache_key: "key3",
        verdict: "pass",
        failed_requirements: [],
        failed_abuse_cases: [],
        timestamp: new Date().toISOString(),
      });

      const counts = service.getCounts();
      expect(counts.l4a_entries).toBe(2);
      expect(counts.l4b_entries).toBe(1);
      expect(counts.total_entries).toBe(3);
    });
  });
});
