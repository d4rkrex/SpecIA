/**
 * Tests for resolveJsonInput() and tryStdinJson() helpers.
 *
 * Covers:
 * - --result '<json>' (inline JSON)
 * - --result @file.json (file input)
 * - --result - (explicit stdin)
 * - Error messages with actionable tips
 * - tryStdinJson opportunistic behavior
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolveJsonInput, tryStdinJson } from "../../src/cli/output.js";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("resolveJsonInput", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `specia-test-resolve-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("inline JSON (--result '<json>')", () => {
    it("parses valid inline JSON", async () => {
      const result = await resolveJsonInput('{"key":"value"}', "review result");
      expect(result).toEqual({ ok: true, json: { key: "value" } });
    });

    it("parses complex nested JSON", async () => {
      const json = JSON.stringify({
        stride: { spoofing: { applicable: false, threats: [] } },
        summary: { risk_level: "low", total_findings: 0 },
      });
      const result = await resolveJsonInput(json, "review result");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect((result.json as Record<string, unknown>).stride).toBeDefined();
      }
    });

    it("returns error with tips for invalid inline JSON", async () => {
      const result = await resolveJsonInput("{broken json", "review result");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("Invalid JSON in --result");
        expect(result.error).toContain("--result @result.json");
        expect(result.error).toContain("--result -");
      }
    });

    it("returns error for shell-split JSON (partial object)", async () => {
      // Simulates what happens when shell splits: --result {"key": "value"}
      // Commander receives just {"key":
      const result = await resolveJsonInput('{"key":', "review result");
      expect(result.ok).toBe(false);
    });
  });

  describe("file input (--result @file.json)", () => {
    it("reads valid JSON from file", async () => {
      const filePath = join(tmpDir, "result.json");
      writeFileSync(filePath, '{"status":"success","count":42}');

      const result = await resolveJsonInput(`@${filePath}`, "review result");
      expect(result).toEqual({
        ok: true,
        json: { status: "success", count: 42 },
      });
    });

    it("returns error for non-existent file", async () => {
      const result = await resolveJsonInput("@/tmp/nonexistent-specia-test.json", "review result");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("nonexistent-specia-test.json");
      }
    });

    it("returns error for invalid JSON in file", async () => {
      const filePath = join(tmpDir, "bad.json");
      writeFileSync(filePath, "not valid json {{{");

      const result = await resolveJsonInput(`@${filePath}`, "review result");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("Invalid JSON in file");
      }
    });

    it("returns error for empty @ path", async () => {
      const result = await resolveJsonInput("@", "review result");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("Empty file path");
      }
    });

    it("returns error for directory path", async () => {
      const result = await resolveJsonInput(`@${tmpDir}`, "review result");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("not a regular file");
      }
    });
  });

  describe("explicit stdin (--result -)", () => {
    // Note: testing --result - fully requires mocking stdin, which is fragile.
    // The readStdinRaw function has a 5s timeout, so we test the timeout path.
    it("returns error when no stdin data arrives (TTY)", async () => {
      // In test environment, stdin is typically a TTY, so readStdinRaw times out
      // We accept this test may be slow (5s timeout) or may need skipping in CI
      // For now, we just verify the function exists and returns the right shape
      const result = await resolveJsonInput("-", "review result");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("stdin");
      }
    }, 10000);
  });
});

describe("tryStdinJson", () => {
  it("returns null when stdin is a TTY", async () => {
    // Save and mock stdin.isTTY
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      writable: true,
      configurable: true,
    });
    try {
      const result = await tryStdinJson();
      expect(result).toBeNull();
    } finally {
      Object.defineProperty(process.stdin, "isTTY", {
        value: originalIsTTY,
        writable: true,
        configurable: true,
      });
    }
  });
});
