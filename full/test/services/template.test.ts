/**
 * Template rendering unit tests.
 *
 * Spec refs: Domain 5 (Markdown artifact format)
 * Design refs: Decision 8 (template.ts)
 */

import { describe, it, expect } from "vitest";
import {
  renderContext,
  renderProposal,
  renderSpec,
  renderTasks,
} from "../../src/services/template.js";
import type { VtspecConfig } from "../../src/types/index.js";

// ── renderContext ────────────────────────────────────────────────────

describe("renderContext", () => {
  function makeConfig(): VtspecConfig {
    return {
      version: "0.1",
      project: {
        name: "my-project",
        description: "A cool project",
        stack: "TypeScript/Node.js",
        conventions: ["vitest", "ESM"],
      },
      security: { posture: "standard" },
      memory: { backend: "local" },
    };
  }

  it("includes project name as heading", () => {
    const md = renderContext(makeConfig());
    expect(md).toContain("# Project Context: my-project");
  });

  it("includes description section", () => {
    const md = renderContext(makeConfig());
    expect(md).toContain("A cool project");
  });

  it("includes stack section", () => {
    const md = renderContext(makeConfig());
    expect(md).toContain("TypeScript/Node.js");
  });

  it("lists conventions as bullet points", () => {
    const md = renderContext(makeConfig());
    expect(md).toContain("- vitest");
    expect(md).toContain("- ESM");
  });

  it("handles empty conventions", () => {
    const config = makeConfig();
    config.project.conventions = [];
    const md = renderContext(config);
    expect(md).toContain("*No conventions specified.*");
  });

  it("includes security posture", () => {
    const md = renderContext(makeConfig());
    expect(md).toContain("**standard**");
  });

  it("describes elevated posture correctly", () => {
    const config = makeConfig();
    config.security.posture = "elevated";
    const md = renderContext(config);
    expect(md).toContain("OWASP Top 10");
  });

  it("describes paranoid posture correctly", () => {
    const config = makeConfig();
    config.security.posture = "paranoid";
    const md = renderContext(config);
    expect(md).toContain("DREAD");
  });

  it("includes memory backend", () => {
    const md = renderContext(makeConfig());
    expect(md).toContain("local");
  });
});

// ── renderProposal ──────────────────────────────────────────────────

describe("renderProposal", () => {
  it("renders proposal heading with change name", () => {
    const md = renderProposal({
      changeName: "auth-refactor",
      intent: "Refactor auth module",
      scope: ["auth", "middleware"],
      createdAt: "2025-01-01T00:00:00.000Z",
    });
    expect(md).toContain("# Proposal: auth-refactor");
  });

  it("includes intent section", () => {
    const md = renderProposal({
      changeName: "x",
      intent: "Do the thing",
      scope: ["area1"],
      createdAt: "2025-01-01T00:00:00.000Z",
    });
    expect(md).toContain("## Intent");
    expect(md).toContain("Do the thing");
  });

  it("lists scope areas", () => {
    const md = renderProposal({
      changeName: "x",
      intent: "intent",
      scope: ["auth", "database", "api"],
      createdAt: "2025-01-01T00:00:00.000Z",
    });
    expect(md).toContain("- auth");
    expect(md).toContain("- database");
    expect(md).toContain("- api");
  });

  it("includes approach section when provided", () => {
    const md = renderProposal({
      changeName: "x",
      intent: "intent",
      scope: ["area"],
      approach: "Use strategy pattern",
      createdAt: "2025-01-01T00:00:00.000Z",
    });
    expect(md).toContain("## Approach");
    expect(md).toContain("Use strategy pattern");
  });

  it("omits approach section when not provided", () => {
    const md = renderProposal({
      changeName: "x",
      intent: "intent",
      scope: ["area"],
      createdAt: "2025-01-01T00:00:00.000Z",
    });
    expect(md).not.toContain("## Approach");
  });
});

// ── renderSpec ──────────────────────────────────────────────────────

describe("renderSpec", () => {
  it("renders specification heading", () => {
    const md = renderSpec({
      changeName: "add-logging",
      requirements: [],
      createdAt: "2025-01-01T00:00:00.000Z",
    });
    expect(md).toContain("# Specification: add-logging");
  });

  it("renders requirements with numbered headings", () => {
    const md = renderSpec({
      changeName: "x",
      requirements: [
        { name: "First", description: "Desc 1", scenarios: [] },
        { name: "Second", description: "Desc 2", scenarios: [] },
      ],
      createdAt: "2025-01-01T00:00:00.000Z",
    });
    expect(md).toContain("### 1. First");
    expect(md).toContain("### 2. Second");
  });

  it("renders scenarios in given/when/then format", () => {
    const md = renderSpec({
      changeName: "x",
      requirements: [
        {
          name: "Auth",
          description: "Authentication",
          scenarios: [
            {
              name: "Happy path",
              given: "valid credentials",
              when: "user logs in",
              then: "token is returned",
            },
          ],
        },
      ],
      createdAt: "2025-01-01T00:00:00.000Z",
    });
    expect(md).toContain("##### Happy path");
    expect(md).toContain("**GIVEN** valid credentials");
    expect(md).toContain("**WHEN** user logs in");
    expect(md).toContain("**THEN** token is returned");
  });
});

// ── renderTasks ─────────────────────────────────────────────────────

describe("renderTasks", () => {
  it("renders tasks heading", () => {
    const md = renderTasks({
      changeName: "my-feature",
      specContent: "# Spec",
      reviewFindings: [],
      mitigationTasks: [],
      createdAt: "2025-01-01T00:00:00.000Z",
    });
    expect(md).toContain("# Tasks: my-feature");
  });

  it("renders security mitigations as checklist", () => {
    const md = renderTasks({
      changeName: "x",
      specContent: "# Spec",
      reviewFindings: [],
      mitigationTasks: ["Validate JWT", "Add rate limiting"],
      createdAt: "2025-01-01T00:00:00.000Z",
    });
    expect(md).toContain("- [ ] Validate JWT");
    expect(md).toContain("- [ ] Add rate limiting");
  });

  it("renders no-mitigations message when empty", () => {
    const md = renderTasks({
      changeName: "x",
      specContent: "# Spec",
      reviewFindings: [],
      mitigationTasks: [],
      createdAt: "2025-01-01T00:00:00.000Z",
    });
    expect(md).toContain("No security mitigations required");
  });

  it("renders review findings reference", () => {
    const md = renderTasks({
      changeName: "x",
      specContent: "# Spec",
      reviewFindings: ["[S-01] Token spoofing"],
      mitigationTasks: ["Fix tokens"],
      createdAt: "2025-01-01T00:00:00.000Z",
    });
    expect(md).toContain("### Review Findings Reference");
    expect(md).toContain("- [S-01] Token spoofing");
  });

  it("renders past security context from Alejandria when provided", () => {
    const md = renderTasks({
      changeName: "x",
      specContent: "# Spec",
      reviewFindings: [],
      mitigationTasks: [],
      pastFindings: [
        "Auth service had JWT token replay vulnerability (auth-refactor)",
        "SQL injection in user search endpoint (api-hardening)",
      ],
      createdAt: "2025-01-01T00:00:00.000Z",
    });
    expect(md).toContain("## Past Security Context (from Alejandria)");
    expect(md).toContain("- Auth service had JWT token replay vulnerability (auth-refactor)");
    expect(md).toContain("- SQL injection in user search endpoint (api-hardening)");
  });

  it("omits past security context section when pastFindings is undefined", () => {
    const md = renderTasks({
      changeName: "x",
      specContent: "# Spec",
      reviewFindings: [],
      mitigationTasks: [],
      createdAt: "2025-01-01T00:00:00.000Z",
    });
    expect(md).not.toContain("Past Security Context");
  });

  it("omits past security context section when pastFindings is empty", () => {
    const md = renderTasks({
      changeName: "x",
      specContent: "# Spec",
      reviewFindings: [],
      mitigationTasks: [],
      pastFindings: [],
      createdAt: "2025-01-01T00:00:00.000Z",
    });
    expect(md).not.toContain("Past Security Context");
  });

  it("renders abuse case mitigation tasks with lock emoji and severity", () => {
    const md = renderTasks({
      changeName: "auth-feature",
      specContent: "# Spec",
      reviewFindings: [],
      mitigationTasks: [],
      abuseCases: [
        {
          id: "AC-001",
          severity: "critical",
          title: "JWT Token Forgery",
          attacker_goal: "Forge a JWT",
          technique: "Use leaked secret",
          preconditions: ["HS256 used"],
          impact: "Account takeover",
          mitigation: "Use RS256 with key rotation",
          stride_category: "Spoofing",
          testable: true,
          test_hint: "Send self-signed token",
        },
        {
          id: "AC-002",
          severity: "high",
          title: "Session Hijack",
          attacker_goal: "Steal refresh token",
          technique: "XSS + replay",
          preconditions: ["Tokens in localStorage"],
          impact: "Persistent access",
          mitigation: "Implement refresh token rotation + device binding",
          stride_category: "Elevation of Privilege",
          testable: true,
        },
      ],
      createdAt: "2025-01-01T00:00:00.000Z",
    });

    // Should contain the abuse case mitigation section
    expect(md).toContain("### Security Mitigations (from review)");
    expect(md).toContain("\u{1F512} AC-001: Use RS256 with key rotation (JWT Token Forgery");
    expect(md).toContain("\u{1F512} AC-002: Implement refresh token rotation + device binding (Session Hijack");
    expect(md).toContain("\u{1F534}"); // critical emoji
    expect(md).toContain("\u{1F7E0}"); // high emoji
  });

  it("omits abuse case section when abuseCases is undefined", () => {
    const md = renderTasks({
      changeName: "x",
      specContent: "# Spec",
      reviewFindings: [],
      mitigationTasks: ["Fix tokens"],
      createdAt: "2025-01-01T00:00:00.000Z",
    });
    expect(md).not.toContain("Security Mitigations (from review)");
    expect(md).toContain("- [ ] Fix tokens");
  });

  it("omits abuse case section when abuseCases is empty", () => {
    const md = renderTasks({
      changeName: "x",
      specContent: "# Spec",
      reviewFindings: [],
      mitigationTasks: [],
      abuseCases: [],
      createdAt: "2025-01-01T00:00:00.000Z",
    });
    expect(md).not.toContain("Security Mitigations (from review)");
    expect(md).toContain("No security mitigations required");
  });

  it("renders both abuse cases and regular mitigations when both present", () => {
    const md = renderTasks({
      changeName: "x",
      specContent: "# Spec",
      reviewFindings: [],
      mitigationTasks: ["Validate JWT"],
      abuseCases: [
        {
          id: "AC-001",
          severity: "medium",
          title: "Username Enumeration",
          attacker_goal: "Enumerate valid usernames",
          technique: "Observe error response differences",
          preconditions: ["Different error messages for valid/invalid users"],
          impact: "Information disclosure",
          mitigation: "Use generic error messages",
          stride_category: "Information Disclosure",
          testable: true,
        },
      ],
      createdAt: "2025-01-01T00:00:00.000Z",
    });
    expect(md).toContain("### Security Mitigations (from review)");
    expect(md).toContain("\u{1F512} AC-001");
    expect(md).toContain("- [ ] Validate JWT");
  });
});
