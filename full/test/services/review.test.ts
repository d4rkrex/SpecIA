/**
 * Review engine unit tests — prompt generation, validation, markdown rendering.
 *
 * Spec refs: Domain 6 (Three Depth Levels, Review Output Structure)
 * Design refs: Decision 3 (Two-Phase Review, ReviewEngine)
 */

import { describe, it, expect } from "vitest";
import {
  generateReviewPrompt,
  validateReviewResult,
  renderReviewMarkdown,
  ReviewValidationError,
  severityEmoji,
} from "../../src/services/review.js";
import type { VtspecConfig, SecurityReview } from "../../src/types/index.js";

function makeConfig(posture: "standard" | "elevated" | "paranoid" = "standard"): VtspecConfig {
  return {
    version: "0.1",
    project: {
      name: "test-project",
      description: "A test project for review testing",
      stack: "TypeScript/Node.js",
      conventions: [],
    },
    security: { posture },
    memory: { backend: "local" },
  };
}

// ── generateReviewPrompt ─────────────────────────────────────────────

describe("generateReviewPrompt", () => {
  it("generates a standard-posture prompt with all required fields", () => {
    const prompt = generateReviewPrompt({
      config: makeConfig("standard"),
      changeName: "auth-refactor",
      specContent: "# Spec\n\nSome requirements.",
    });

    expect(prompt.system_instructions).toBeTruthy();
    expect(prompt.analysis_request).toContain("auth-refactor");
    expect(prompt.output_schema).toBeTruthy();
    expect(prompt.context.change_name).toBe("auth-refactor");
    // Token optimization: spec content is in analysis_request, not context
    expect(prompt.analysis_request).toContain("Some requirements");
  });

  it("generates an elevated-posture prompt", () => {
    const prompt = generateReviewPrompt({
      config: makeConfig("elevated"),
      changeName: "api-auth",
      specContent: "# Spec",
    });

    expect(prompt.system_instructions).toBeTruthy();
    expect(prompt.output_schema).toBeTruthy();
  });

  it("generates a paranoid-posture prompt", () => {
    const prompt = generateReviewPrompt({
      config: makeConfig("paranoid"),
      changeName: "payment-flow",
      specContent: "# Spec",
    });

    expect(prompt.system_instructions).toBeTruthy();
    expect(prompt.output_schema).toBeTruthy();
  });

  it("includes proposal content when provided", () => {
    const prompt = generateReviewPrompt({
      config: makeConfig("standard"),
      changeName: "my-change",
      specContent: "# Spec",
      proposalContent: "# Proposal\n\nWe propose to do X.",
    });

    // Token optimization: proposal content is in analysis_request, context has metadata only
    expect(prompt.context.has_proposal).toBe(true);
    expect(prompt.analysis_request).toContain("We propose to do X");
  });
});

// ── validateReviewResult ─────────────────────────────────────────────

describe("validateReviewResult", () => {
  function makeMinimalReviewResult() {
    return {
      stride: {
        spoofing: { applicable: false, threats: [] },
        tampering: { applicable: false, threats: [] },
        repudiation: { applicable: false, threats: [] },
        information_disclosure: { applicable: false, threats: [] },
        denial_of_service: { applicable: false, threats: [] },
        elevation_of_privilege: { applicable: false, threats: [] },
      },
      summary: {
        risk_level: "low",
        total_findings: 0,
        critical_findings: 0,
        mitigations_required: [],
      },
    };
  }

  function makeReviewResultWithThreats() {
    return {
      stride: {
        spoofing: {
          applicable: true,
          threats: [
            {
              id: "S-01",
              title: "Token spoofing",
              description: "An attacker could forge JWT tokens",
              severity: "high",
              mitigation: "Validate token signatures server-side",
              affected_components: ["auth-middleware", "api-gateway"],
            },
          ],
        },
        tampering: { applicable: false, threats: [] },
        repudiation: { applicable: false, threats: [] },
        information_disclosure: { applicable: false, threats: [] },
        denial_of_service: { applicable: false, threats: [] },
        elevation_of_privilege: { applicable: false, threats: [] },
      },
      summary: {
        risk_level: "high",
        total_findings: 1,
        critical_findings: 0,
        mitigations_required: ["Validate token signatures server-side"],
      },
    };
  }

  it("validates a minimal valid review result", () => {
    const result = validateReviewResult(
      makeMinimalReviewResult(),
      "standard",
      "test-change",
      "sha256:abc",
    );

    expect(result.change).toBe("test-change");
    expect(result.posture).toBe("standard");
    expect(result.spec_hash).toBe("sha256:abc");
    expect(result.stride.spoofing.applicable).toBe(false);
    expect(result.summary.total_findings).toBe(0);
  });

  it("validates a review result with threats", () => {
    const result = validateReviewResult(
      makeReviewResultWithThreats(),
      "standard",
      "auth-change",
      "sha256:def",
    );

    expect(result.stride.spoofing.applicable).toBe(true);
    expect(result.stride.spoofing.threats).toHaveLength(1);
    expect(result.stride.spoofing.threats[0]!.id).toBe("S-01");
    expect(result.summary.risk_level).toBe("high");
  });

  it("throws ReviewValidationError for null input", () => {
    expect(() => validateReviewResult(null, "standard", "x", "h")).toThrow(
      ReviewValidationError,
    );
  });

  it("throws ReviewValidationError for non-object input", () => {
    expect(() =>
      validateReviewResult("not an object", "standard", "x", "h"),
    ).toThrow(ReviewValidationError);
  });

  it("throws when stride field is missing", () => {
    expect(() =>
      validateReviewResult({ summary: { risk_level: "low" } }, "standard", "x", "h"),
    ).toThrow(ReviewValidationError);
  });

  it("throws when summary field is missing", () => {
    const raw = makeMinimalReviewResult();
    delete (raw as Record<string, unknown>).summary;
    expect(() => validateReviewResult(raw, "standard", "x", "h")).toThrow(
      ReviewValidationError,
    );
  });

  it("defaults severity to medium for invalid severity values", () => {
    const raw = makeReviewResultWithThreats();
    (raw.stride.spoofing.threats[0] as Record<string, unknown>).severity = "invalid";
    const result = validateReviewResult(raw, "standard", "x", "h");
    expect(result.stride.spoofing.threats[0]!.severity).toBe("medium");
  });

  it("accepts OWASP mapping for elevated posture", () => {
    const raw = {
      ...makeMinimalReviewResult(),
      owasp_mapping: [
        {
          owasp_id: "A01:2021",
          owasp_name: "Broken Access Control",
          related_threats: ["S-01"],
          applicable: true,
        },
      ],
    };
    const result = validateReviewResult(raw, "elevated", "x", "h");
    expect(result.owasp_mapping).toHaveLength(1);
    expect(result.owasp_mapping![0]!.owasp_id).toBe("A01:2021");
  });

  it("accepts DREAD scores for paranoid posture", () => {
    const raw = {
      ...makeMinimalReviewResult(),
      owasp_mapping: [],
      dread_scores: [
        {
          threat_id: "S-01",
          damage: 8,
          reproducibility: 6,
          exploitability: 7,
          affected_users: 9,
          discoverability: 5,
        },
      ],
    };
    const result = validateReviewResult(raw, "paranoid", "x", "h");
    expect(result.dread_scores).toHaveLength(1);
    expect(result.dread_scores![0]!.total).toBeCloseTo(7.0);
  });

  it("clamps DREAD scores to 1-10 range", () => {
    const raw = {
      ...makeMinimalReviewResult(),
      dread_scores: [
        {
          threat_id: "S-01",
          damage: 15,        // should clamp to 10
          reproducibility: 0, // should clamp to 1
          exploitability: 5,
          affected_users: 5,
          discoverability: 5,
        },
      ],
    };
    const result = validateReviewResult(raw, "paranoid", "x", "h");
    expect(result.dread_scores![0]!.damage).toBe(10);
    expect(result.dread_scores![0]!.reproducibility).toBe(1);
  });
});

// ── renderReviewMarkdown ─────────────────────────────────────────────

describe("renderReviewMarkdown", () => {
  function makeReview(): SecurityReview {
    return {
      change: "test-change",
      posture: "standard",
      timestamp: "2025-01-01T00:00:00.000Z",
      spec_hash: "sha256:abc123",
      stride: {
        spoofing: {
          applicable: true,
          threats: [
            {
              id: "S-01",
              title: "Token spoofing",
              description: "Attacker forges tokens",
              severity: "high",
              mitigation: "Validate signatures",
              affected_components: ["auth"],
            },
          ],
        },
        tampering: { applicable: false, threats: [] },
        repudiation: { applicable: false, threats: [] },
        information_disclosure: { applicable: false, threats: [] },
        denial_of_service: { applicable: false, threats: [] },
        elevation_of_privilege: { applicable: false, threats: [] },
      },
      abuse_cases: [],
      summary: {
        risk_level: "high",
        total_findings: 1,
        critical_findings: 0,
        mitigations_required: ["Validate signatures"],
      },
    };
  }

  it("renders YAML frontmatter with spec_hash", () => {
    const md = renderReviewMarkdown(makeReview());
    expect(md).toContain("---");
    expect(md).toContain('spec_hash: "sha256:abc123"');
    expect(md).toContain('posture: "standard"');
    expect(md).toContain("findings_count: 1");
  });

  it("renders STRIDE sections", () => {
    const md = renderReviewMarkdown(makeReview());
    expect(md).toContain("## STRIDE Analysis");
    expect(md).toContain("### Spoofing");
    expect(md).toContain("#### S-01: Token spoofing");
    expect(md).toContain("**Severity**: high");
  });

  it("marks non-applicable categories", () => {
    const md = renderReviewMarkdown(makeReview());
    expect(md).toContain("*Not applicable to this change.*");
  });

  it("renders mitigations required section", () => {
    const md = renderReviewMarkdown(makeReview());
    expect(md).toContain("## Mitigations Required");
    expect(md).toContain("- [ ] Validate signatures");
  });

  it("renders OWASP mapping table for elevated posture", () => {
    const review = makeReview();
    review.posture = "elevated";
    review.owasp_mapping = [
      {
        owasp_id: "A01:2021",
        owasp_name: "Broken Access Control",
        related_threats: ["S-01"],
        applicable: true,
      },
    ];
    const md = renderReviewMarkdown(review);
    expect(md).toContain("## OWASP Top 10 Mapping");
    expect(md).toContain("A01:2021");
    expect(md).toContain("Broken Access Control");
  });

  it("renders DREAD scores table for paranoid posture", () => {
    const review = makeReview();
    review.posture = "paranoid";
    review.dread_scores = [
      {
        threat_id: "S-01",
        damage: 8,
        reproducibility: 6,
        exploitability: 7,
        affected_users: 9,
        discoverability: 5,
        total: 7.0,
      },
    ];
    const md = renderReviewMarkdown(review);
    expect(md).toContain("## DREAD Scores");
    expect(md).toContain("S-01");
    expect(md).toContain("7.0");
  });

  it("renders no-mitigations message when empty", () => {
    const review = makeReview();
    review.summary.mitigations_required = [];
    const md = renderReviewMarkdown(review);
    expect(md).toContain("No significant threats identified");
  });

  it("renders abuse cases section with summary table and details", () => {
    const review = makeReview();
    review.abuse_cases = [
      {
        id: "AC-001",
        severity: "critical",
        title: "JWT Token Forgery",
        attacker_goal: "Forge a JWT using HS256 with a leaked secret to impersonate any user",
        technique: "Extract the JWT secret from environment variables or config, sign arbitrary payloads",
        preconditions: ["HS256 algorithm used", "secret stored in accessible location"],
        impact: "Complete account takeover, any user can be impersonated",
        mitigation: "Use RS256 with key rotation, never store secrets in env vars accessible to frontend",
        stride_category: "Spoofing",
        testable: true,
        test_hint: "Send request with self-signed HS256 token → expect 401",
      },
      {
        id: "AC-002",
        severity: "high",
        title: "Session Hijack via Refresh Token",
        attacker_goal: "Steal a refresh token and reuse it from a different device",
        technique: "Intercept refresh token from localStorage or XSS, replay from attacker device",
        preconditions: ["Refresh tokens stored client-side", "No device binding"],
        impact: "Persistent unauthorized access to victim account",
        mitigation: "Implement refresh token rotation + device binding",
        stride_category: "Elevation of Privilege",
        testable: true,
      },
    ];
    const md = renderReviewMarkdown(review);

    // Summary table
    expect(md).toContain("## Abuse Cases");
    expect(md).toContain("| AC-001 |");
    expect(md).toContain("| AC-002 |");
    expect(md).toContain("Spoofing");
    expect(md).toContain("Elevation of Privilege");

    // Detail sections
    expect(md).toContain("### AC-001: JWT Token Forgery");
    expect(md).toContain("### AC-002: Session Hijack via Refresh Token");
    expect(md).toContain("- **Goal**: Forge a JWT");
    expect(md).toContain("- **Technique**: Extract the JWT");
    expect(md).toContain("- **Preconditions**: HS256 algorithm used; secret stored in accessible location");
    expect(md).toContain("- **Impact**: Complete account takeover");
    expect(md).toContain("- **Testable**: Yes");
    expect(md).toContain("- **Test Hint**: Send request with self-signed HS256 token");
  });

  it("omits abuse cases section when empty", () => {
    const review = makeReview();
    review.abuse_cases = [];
    const md = renderReviewMarkdown(review);
    expect(md).not.toContain("## Abuse Cases");
  });
});

// ── severityEmoji ────────────────────────────────────────────────────

describe("severityEmoji", () => {
  it("returns red circle for critical", () => {
    expect(severityEmoji("critical")).toBe("\u{1F534}");
  });

  it("returns orange circle for high", () => {
    expect(severityEmoji("high")).toBe("\u{1F7E0}");
  });

  it("returns yellow circle for medium", () => {
    expect(severityEmoji("medium")).toBe("\u{1F7E1}");
  });

  it("returns green circle for low", () => {
    expect(severityEmoji("low")).toBe("\u{1F7E2}");
  });

  it("returns white circle for unknown", () => {
    expect(severityEmoji("unknown")).toBe("\u{26AA}");
  });
});

// ── Abuse Cases in Prompts ───────────────────────────────────────────

describe("generateReviewPrompt — abuse case instructions", () => {
  it("standard prompt includes abuse case instructions (3-5)", () => {
    const prompt = generateReviewPrompt({
      config: makeConfig("standard"),
      changeName: "test",
      specContent: "# Spec",
    });

    expect(prompt.system_instructions).toContain("Abuse Cases (3-5)");
    expect(prompt.system_instructions).toContain("As an attacker, I want to");
    // Output schema should include abuse_cases
    const schema = prompt.output_schema as Record<string, unknown>;
    const props = (schema as { properties: Record<string, unknown> }).properties;
    expect(props).toHaveProperty("abuse_cases");
  });

  it("elevated prompt includes abuse case instructions (5-8)", () => {
    const prompt = generateReviewPrompt({
      config: makeConfig("elevated"),
      changeName: "test",
      specContent: "# Spec",
    });

    expect(prompt.system_instructions).toContain("Abuse Cases (5-8)");
    const schema = prompt.output_schema as Record<string, unknown>;
    const props = (schema as { properties: Record<string, unknown> }).properties;
    expect(props).toHaveProperty("abuse_cases");
  });

  it("paranoid prompt includes abuse case instructions (8-12) with test hints", () => {
    const prompt = generateReviewPrompt({
      config: makeConfig("paranoid"),
      changeName: "test",
      specContent: "# Spec",
    });

    expect(prompt.system_instructions).toContain("Abuse Cases (8-12)");
    expect(prompt.system_instructions).toContain("test_hint: REQUIRED");
    const schema = prompt.output_schema as Record<string, unknown>;
    const props = (schema as { properties: Record<string, unknown> }).properties;
    expect(props).toHaveProperty("abuse_cases");
  });
});

// ── validateReviewResult — abuse_cases ───────────────────────────────

describe("validateReviewResult — abuse_cases", () => {
  function makeMinimalResult() {
    return {
      stride: {
        spoofing: { applicable: false, threats: [] },
        tampering: { applicable: false, threats: [] },
        repudiation: { applicable: false, threats: [] },
        information_disclosure: { applicable: false, threats: [] },
        denial_of_service: { applicable: false, threats: [] },
        elevation_of_privilege: { applicable: false, threats: [] },
      },
      summary: {
        risk_level: "low",
        total_findings: 0,
        critical_findings: 0,
        mitigations_required: [],
      },
    };
  }

  it("defaults abuse_cases to empty array when not provided", () => {
    const result = validateReviewResult(
      makeMinimalResult(),
      "standard",
      "test",
      "sha256:abc",
    );
    expect(result.abuse_cases).toEqual([]);
  });

  it("validates abuse_cases when provided", () => {
    const raw = {
      ...makeMinimalResult(),
      abuse_cases: [
        {
          id: "AC-001",
          severity: "critical",
          title: "Token Forgery",
          attacker_goal: "Forge a JWT",
          technique: "Use leaked secret",
          preconditions: ["HS256 used"],
          impact: "Account takeover",
          mitigation: "Use RS256",
          stride_category: "Spoofing",
          testable: true,
          test_hint: "Send self-signed token",
        },
      ],
    };
    const result = validateReviewResult(raw, "standard", "test", "sha256:abc");
    expect(result.abuse_cases).toHaveLength(1);
    expect(result.abuse_cases[0]!.id).toBe("AC-001");
    expect(result.abuse_cases[0]!.severity).toBe("critical");
    expect(result.abuse_cases[0]!.testable).toBe(true);
    expect(result.abuse_cases[0]!.test_hint).toBe("Send self-signed token");
  });

  it("handles malformed abuse_cases gracefully", () => {
    const raw = {
      ...makeMinimalResult(),
      abuse_cases: [{ id: "AC-001" }, "not-an-object", null],
    };
    const result = validateReviewResult(raw, "standard", "test", "sha256:abc");
    expect(result.abuse_cases).toHaveLength(1);
    expect(result.abuse_cases[0]!.id).toBe("AC-001");
    expect(result.abuse_cases[0]!.severity).toBe("medium"); // defaults
  });

  it("defaults severity to medium for invalid severity in abuse case", () => {
    const raw = {
      ...makeMinimalResult(),
      abuse_cases: [
        {
          id: "AC-001",
          severity: "super-critical",
          title: "Bad Severity",
          attacker_goal: "Break things",
          technique: "Unknown",
          preconditions: [],
          impact: "Unknown",
          mitigation: "Unknown",
          stride_category: "Spoofing",
          testable: false,
        },
      ],
    };
    const result = validateReviewResult(raw, "standard", "test", "sha256:abc");
    expect(result.abuse_cases[0]!.severity).toBe("medium");
  });
});
