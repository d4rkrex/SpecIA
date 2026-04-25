/**
 * Smart caching — SHA256 content hashing for review results.
 *
 * Determines whether a security review needs to be re-run by comparing
 * the SHA256 hash of the current spec.md with the hash stored at review time.
 *
 * Spec refs: Domain 8 (SHA256 Content Hashing, Stale Review Detection)
 * Design refs: Decision 5 (Smart Caching)
 */

import { createHash } from "node:crypto";
import type { ChangeState, SecurityPosture } from "../types/index.js";

/**
 * Compute a SHA256 hash of spec content with normalization.
 *
 * Normalization: trim trailing whitespace per line, collapse to single
 * trailing newline. This prevents whitespace-only edits from invalidating
 * the cache (Design Decision 5).
 */
export function computeSpecHash(specContent: string): string {
  const normalized = specContent
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
  return (
    "sha256:" +
    createHash("sha256").update(normalized, "utf8").digest("hex")
  );
}

/**
 * Determine whether a review needs to be re-run.
 *
 * Re-review is needed when:
 * 1. force flag is true
 * 2. No previous review hash exists (never reviewed)
 * 3. Spec content changed (hash mismatch)
 * 4. Security posture changed since last review
 *
 * Spec refs: Domain 8 (Cache hit/miss scenarios)
 * Design refs: Decision 5 (What triggers re-review)
 */
export function shouldReReview(
  currentHash: string,
  state: ChangeState | null,
  posture: SecurityPosture,
  force: boolean,
): boolean {
  if (force) return true;
  if (!state?.review_hash) return true; // never reviewed
  if (state.review_hash !== currentHash) return true; // spec changed
  if (state.review_posture !== posture) return true; // posture changed
  return false;
}

/**
 * Check if a review is stale relative to the current spec content.
 * Used by specia_tasks to enforce the REVIEW_STALE gate.
 *
 * Returns true if the review's spec_hash does NOT match the current spec hash.
 *
 * Spec refs: Domain 8 (Stale Review Detection by specia_tasks)
 */
export function isReviewStale(
  reviewContent: string,
  currentSpecHash: string,
): boolean {
  // Extract spec_hash from review.md YAML frontmatter
  const match = reviewContent.match(/^---\n([\s\S]*?)\n---/);
  if (!match?.[1]) return true; // no frontmatter = stale

  const hashMatch = match[1].match(/spec_hash:\s*"?([^"\n]+)"?/);
  if (!hashMatch?.[1]) return true; // no hash = stale

  return hashMatch[1].trim() !== currentSpecHash;
}
