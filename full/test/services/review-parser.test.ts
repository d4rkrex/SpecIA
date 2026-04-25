/**
 * Tests for review-parser service (debate feature).
 *
 * Phase 0: Structured Debate — specia-structured-debate
 */

import { describe, it, expect } from "vitest";
import { parseReviewFindings, updateReviewWithDebate } from "../../src/services/review-parser.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

describe("Review Parser (Debate)", () => {
  const testDir = dirname(fileURLToPath(import.meta.url));
  const actualReviewPath = join(
    testDir,
    "..",
    "fixtures",
    "review-parser",
    "specia-structured-debate-review.md",
  );

  it("should parse real review.md from specia-structured-debate", () => {
    const reviewContent = readFileSync(actualReviewPath, "utf-8");
    const findings = parseReviewFindings(reviewContent);

    // specia-structured-debate has 8 STRIDE threats + 5 abuse cases = 13 findings
    expect(findings.length).toBeGreaterThanOrEqual(8);

    // Check STRIDE threat format
    const spoofingThreat = findings.find((f) => f.id === "S-01");
    expect(spoofingThreat).toBeDefined();
    expect(spoofingThreat?.title).toContain("Agent identity spoofing");
    expect(spoofingThreat?.severity).toBe("medium");
    expect(spoofingThreat?.category).toBe("Spoofing");
    expect(spoofingThreat?.mitigation).toContain("Sign agent responses");

    // Check high severity threat
    const tamperingThreat = findings.find((f) => f.id === "T-02");
    expect(tamperingThreat).toBeDefined();
    expect(tamperingThreat?.severity).toBe("high");
    expect(tamperingThreat?.category).toBe("Tampering");

    // Check abuse case (table format)
    const ac001 = findings.find((f) => f.id === "AC-001");
    expect(ac001).toBeDefined();
    expect(ac001?.category).toBe("Abuse Case");
    expect(ac001?.title).toContain("inject");
  });

  it("should extract all STRIDE categories", () => {
    const reviewContent = readFileSync(actualReviewPath, "utf-8");
    const findings = parseReviewFindings(reviewContent);

    const categories = new Set(findings.map((f) => f.category));
    
    // Should have STRIDE categories
    expect(categories.has("Spoofing")).toBe(true);
    expect(categories.has("Tampering")).toBe(true);
    expect(categories.has("Repudiation")).toBe(true);
    expect(categories.has("Information Disclosure")).toBe(true);
    expect(categories.has("Denial of Service")).toBe(true);
    expect(categories.has("Elevation of Privilege")).toBe(true);
    expect(categories.has("Abuse Case")).toBe(true);
  });

  it("should update review.md with debate consensus", () => {
    const mockReviewContent = `# Security Review: test-change

## STRIDE Analysis

### Spoofing

#### S-01: Test threat

- **Severity**: medium
- **Description**: Test description
- **Mitigation**: Test mitigation
- **Affected Components**: test.ts
`;

    const mockDebates = [
      {
        finding: {
          id: "S-01",
          title: "Test threat",
          originalSeverity: "medium",
        },
        consensus: {
          findingId: "S-01",
          synthesis: {
            consensusSeverity: "high",
            consensusReached: true,
            reasoning: "Offensive agent identified additional attack vectors",
            offensivePerspective: "This is more severe than initially assessed",
            defensivePerspective: "Agreed, mitigations are insufficient",
          },
          needsHumanReview: false,
        },
        rounds: [],
        roundsUsed: 2,
      },
    ];

    const updated = updateReviewWithDebate(mockReviewContent, mockDebates);

    expect(updated).toContain("##### Debate Consensus");
    expect(updated).toContain("**Consensus Severity**: high");
    expect(updated).toContain("**Consensus Reached**: ✅ Yes");
    expect(updated).toContain("additional attack vectors");
  });

  it("should handle multiple debate updates without duplication", () => {
    const mockReviewContent = `#### S-01: Test threat

- **Severity**: medium

##### Debate Consensus

- **Consensus Severity**: high
- **Consensus Reached**: ✅ Yes
- **Reasoning**: Old reasoning
`;

    const mockDebates = [
      {
        finding: {
          id: "S-01",
          title: "Test threat",
          originalSeverity: "medium",
        },
        consensus: {
          findingId: "S-01",
          synthesis: {
            consensusSeverity: "critical",
            consensusReached: true,
            reasoning: "New reasoning after re-debate",
            offensivePerspective: "Updated perspective",
            defensivePerspective: "Updated defensive view",
          },
          needsHumanReview: false,
        },
        rounds: [],
        roundsUsed: 3,
      },
    ];

    const updated = updateReviewWithDebate(mockReviewContent, mockDebates);

    // Should have only ONE consensus section
    const consensusMatches = updated.match(/##### Debate Consensus/g);
    expect(consensusMatches).toHaveLength(1);
    
    // Should have updated severity
    expect(updated).toContain("**Consensus Severity**: critical");
    expect(updated).toContain("New reasoning after re-debate");
    expect(updated).not.toContain("Old reasoning");
  });

  it("should mark findings needing human review", () => {
    const mockReviewContent = `#### S-01: Test threat

- **Severity**: medium
`;

    const mockDebates = [
      {
        finding: {
          id: "S-01",
          title: "Test threat",
          originalSeverity: "medium",
        },
        consensus: {
          findingId: "S-01",
          synthesis: {
            consensusSeverity: "medium",
            consensusReached: false,
            reasoning: "Agents could not reach agreement",
            offensivePerspective: "Should be high",
            defensivePerspective: "Should be low",
          },
          needsHumanReview: true,
          unresolvedDisagreements: [
            {
              topic: "Severity assessment",
              offensivePosition: "Escalate to high due to exploitability",
              defensivePosition: "Keep at medium due to strong mitigations",
            },
          ],
        },
        rounds: [],
        roundsUsed: 3,
      },
    ];

    const updated = updateReviewWithDebate(mockReviewContent, mockDebates);

    expect(updated).toContain("🔴 **Needs Human Review**");
    expect(updated).toContain("**Unresolved Disagreements**");
    expect(updated).toContain("Severity assessment");
    expect(updated).toContain("Escalate to high");
    expect(updated).toContain("Keep at medium");
  });

  it("should handle empty review.md gracefully", () => {
    const emptyContent = `# Security Review

No findings.`;

    const findings = parseReviewFindings(emptyContent);
    expect(findings).toHaveLength(0);
  });

  it("should handle malformed review.md gracefully", () => {
    const malformedContent = `# Security Review

## STRIDE Analysis

This is not a valid finding format.

Random text.
`;

    const findings = parseReviewFindings(malformedContent);
    expect(findings).toHaveLength(0);
  });
});
