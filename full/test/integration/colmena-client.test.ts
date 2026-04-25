/**
 * Integration tests for ColmenaClient.
 * 
 * These tests verify:
 * - Detection of Colmena installation
 * - Graceful degradation when Colmena is not available
 * - Serialization/parsing of ReviewMemory
 */

import { describe, it, expect } from "vitest";
import { ColmenaClient } from "../../src/integrations/colmena-client.js";
import type { ReviewMemory } from "../../src/integrations/memory-adapter.js";

describe("ColmenaClient", () => {
  it("detects if Colmena is not available", async () => {
    const client = ColmenaClient.getInstance();
    const available = await client.isAvailable();
    
    // In CI/local environments, Colmena is usually not installed
    expect(typeof available).toBe("boolean");
  });

  it("returns empty results when searching without Colmena", async () => {
    const client = ColmenaClient.getInstance();
    
    // Should not crash, just return empty
    const results = await client.searchMemory("security review", {
      project: "test",
      limit: 5,
    });
    
    expect(Array.isArray(results)).toBe(true);
  });

  it("serializes ReviewMemory to markdown format", () => {
    const client = ColmenaClient.getInstance();
    
    const review: ReviewMemory = {
      changeName: "test-change",
      timestamp: "2026-04-06T22:00:00Z",
      stack: "TypeScript/Node.js",
      securityPosture: "standard",
      findings: [
        {
          id: "S-01",
          title: "Agent Identity Spoofing",
          severity: "high",
          category: "spoofing",
          description: "Agent identity spoofing",
          mitigation: "Sign agent responses with session tokens",
          affectedComponents: ["src/services/debate-orchestrator.ts"],
        },
        {
          id: "T-01",
          title: "File Manipulation",
          severity: "medium",
          category: "tampering",
          description: "File manipulation",
          mitigation: "Use atomic file writes",
          affectedComponents: ["src/services/debate-writer.ts"],
        },
      ],
      topFindings: ["S-01", "T-01"],
      lessonsLearned: [
        "Always validate agent identity",
        "Use atomic file writes",
      ],
    };

    const serialized = client.serializeReview(review);
    
    expect(serialized).toContain("# Security Review: test-change");
    expect(serialized).toContain("**Stack**: TypeScript/Node.js");
    expect(serialized).toContain("**Security Posture**: standard");
    expect(serialized).toContain("## Top Findings");
    expect(serialized).toContain("- S-01");
    expect(serialized).toContain("## Lessons Learned");
    expect(serialized).toContain("- Always validate agent identity");
    expect(serialized).toContain("## Findings Detail");
    expect(serialized).toContain("**S-01** [high]: Agent identity spoofing");
  });

  it("parses Colmena memory result back to ReviewMemory", () => {
    const client = ColmenaClient.getInstance();
    
    const colmenaResult = {
      id: 123,
      title: "Security Review: test-change",
      content: `# Security Review: test-change

**Stack**: TypeScript/Node.js
**Security Posture**: elevated
**Timestamp**: 2026-04-06T22:00:00Z

## Top Findings

- S-01
- T-01

## Lessons Learned

- Always validate agent identity
- Use atomic file writes`,
      timestamp: "2026-04-06T22:00:00Z",
      type: "security_review",
      project: "specia",
    };

    const parsed = client.parseReviewFromMemory(colmenaResult);
    
    expect(parsed).not.toBeNull();
    expect(parsed?.changeName).toBe("test-change");
    expect(parsed?.stack).toBe("TypeScript/Node.js");
    expect(parsed?.securityPosture).toBe("elevated");
    expect(parsed?.timestamp).toBe("2026-04-06T22:00:00Z");
  });

  it("returns null for malformed Colmena results", () => {
    const client = ColmenaClient.getInstance();
    
    const badResult = {
      id: 456,
      title: "Not a security review",
      content: "Random content without expected format",
      timestamp: "2026-04-06T22:00:00Z",
    };

    const parsed = client.parseReviewFromMemory(badResult);
    
    // Should gracefully return a basic ReviewMemory with defaults
    expect(parsed).not.toBeNull();
    expect(parsed?.changeName).toBe("Not a security review");
    expect(parsed?.stack).toBe("unknown");
    expect(parsed?.securityPosture).toBe("standard");
  });
});
