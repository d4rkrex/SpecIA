/**
 * Cache service unit tests — SHA256 hashing and staleness detection.
 *
 * Spec refs: Domain 8 (SHA256 Content Hashing, Stale Review Detection)
 * Design refs: Decision 5 (Smart Caching)
 */

import { describe, it, expect } from "vitest";
import {
  computeSpecHash,
  shouldReReview,
  isReviewStale,
} from "../../src/services/cache.js";
import type { ChangeState } from "../../src/types/index.js";

// ── computeSpecHash ──────────────────────────────────────────────────

describe("computeSpecHash", () => {
  it("returns a sha256:-prefixed hex string", () => {
    const hash = computeSpecHash("hello world");
    expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("produces consistent output for same input", () => {
    const a = computeSpecHash("# Spec\n\nSome content.\n");
    const b = computeSpecHash("# Spec\n\nSome content.\n");
    expect(a).toBe(b);
  });

  it("produces different output for different input", () => {
    const a = computeSpecHash("version 1");
    const b = computeSpecHash("version 2");
    expect(a).not.toBe(b);
  });

  it("normalizes trailing whitespace — trailing spaces ignored", () => {
    const a = computeSpecHash("line one  \nline two   \n");
    const b = computeSpecHash("line one\nline two\n");
    expect(a).toBe(b);
  });

  it("normalizes trailing newlines — extra trailing newlines ignored", () => {
    const a = computeSpecHash("content\n\n\n");
    const b = computeSpecHash("content");
    expect(a).toBe(b);
  });

  it("preserves internal leading whitespace (indented lines)", () => {
    // The final .trim() strips leading whitespace from the whole string,
    // but internal indented lines are preserved
    const a = computeSpecHash("line1\n  indented\nline3");
    const b = computeSpecHash("line1\nindented\nline3");
    expect(a).not.toBe(b);
  });
});

// ── shouldReReview ───────────────────────────────────────────────────

describe("shouldReReview", () => {
  const hash = "sha256:abc123";

  function makeState(overrides?: Partial<ChangeState>): ChangeState {
    return {
      change: "test",
      phase: "review",
      status: "complete",
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      phases_completed: ["proposal", "spec", "review"],
      history: [],
      review_hash: hash,
      review_posture: "standard",
      ...overrides,
    };
  }

  it("returns true when force is true", () => {
    expect(shouldReReview(hash, makeState(), "standard", true)).toBe(true);
  });

  it("returns true when state is null (never reviewed)", () => {
    expect(shouldReReview(hash, null, "standard", false)).toBe(true);
  });

  it("returns true when no review_hash exists", () => {
    const state = makeState({ review_hash: undefined });
    expect(shouldReReview(hash, state, "standard", false)).toBe(true);
  });

  it("returns true when hash mismatch (spec changed)", () => {
    const state = makeState({ review_hash: "sha256:different" });
    expect(shouldReReview(hash, state, "standard", false)).toBe(true);
  });

  it("returns true when posture changed", () => {
    const state = makeState({ review_posture: "standard" });
    expect(shouldReReview(hash, state, "elevated", false)).toBe(true);
  });

  it("returns false when hash and posture match (cache hit)", () => {
    expect(shouldReReview(hash, makeState(), "standard", false)).toBe(false);
  });
});

// ── isReviewStale ────────────────────────────────────────────────────

describe("isReviewStale", () => {
  const specHash = "sha256:abc123def456";

  it("returns false when frontmatter hash matches", () => {
    const review = `---\nspec_hash: "${specHash}"\nposture: "standard"\n---\n\n# Review`;
    expect(isReviewStale(review, specHash)).toBe(false);
  });

  it("returns true when frontmatter hash does not match", () => {
    const review = `---\nspec_hash: "sha256:old-hash"\n---\n\n# Review`;
    expect(isReviewStale(review, specHash)).toBe(true);
  });

  it("returns true when no frontmatter exists", () => {
    const review = "# Review\n\nNo frontmatter here.";
    expect(isReviewStale(review, specHash)).toBe(true);
  });

  it("returns true when frontmatter has no spec_hash", () => {
    const review = `---\nposture: "standard"\n---\n\n# Review`;
    expect(isReviewStale(review, specHash)).toBe(true);
  });

  it("handles unquoted spec_hash values", () => {
    const review = `---\nspec_hash: ${specHash}\n---\n\n# Review`;
    expect(isReviewStale(review, specHash)).toBe(false);
  });
});
