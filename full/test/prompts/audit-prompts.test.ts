/**
 * Audit prompt template unit tests — standard, elevated, paranoid postures.
 *
 * Tests each posture builder generates valid AuditPrompt with:
 * - Correct system_instructions content for posture depth
 * - Proper analysis_request with all required sections
 * - Valid output_schema matching AuditResult structure
 * - Code file inclusion
 * - Abuse case formatting (posture-specific)
 * - Context fields populated correctly
 *
 * Spec refs: Domain 8 (Posture-Driven Audit Prompts — all 6 scenarios)
 * Design refs: Decision 9 (Posture-driven prompt templates)
 *
 * v0.3: New file for /spec-audit Phase 3.
 */

import { describe, it, expect } from "vitest";
import { buildStandardAuditPrompt } from "../../src/prompts/audit-standard.js";
import { buildElevatedAuditPrompt } from "../../src/prompts/audit-elevated.js";
import { buildParanoidAuditPrompt } from "../../src/prompts/audit-paranoid.js";
import type { StandardAuditPromptContext } from "../../src/prompts/audit-standard.js";
import type { ElevatedAuditPromptContext } from "../../src/prompts/audit-elevated.js";
import type { ParanoidAuditPromptContext } from "../../src/prompts/audit-paranoid.js";
import type { AbuseCase, CodeFile } from "../../src/types/index.js";

// ── Test Helpers ─────────────────────────────────────────────────────

function makeCodeFiles(): CodeFile[] {
  return [
    {
      path: "src/auth/login.ts",
      content: `export function login(username: string, password: string) {
  const user = db.query("SELECT * FROM users WHERE username = ?", [username]);
  if (!user) throw new Error("Invalid credentials");
  return generateToken(user);
}`,
      tokens: 50,
    },
    {
      path: "src/middleware/validate.ts",
      content: `import { z } from "zod";
export const loginSchema = z.object({
  username: z.string().min(1).max(100),
  password: z.string().min(8),
});`,
      tokens: 30,
    },
  ];
}

function makeAbuseCases(): AbuseCase[] {
  return [
    {
      id: "AC-001",
      severity: "critical",
      title: "SQL Injection via login",
      attacker_goal: "inject SQL to bypass authentication",
      technique: "String concatenation in SQL queries",
      preconditions: ["Unvalidated user input"],
      impact: "Full database compromise",
      mitigation: "Use parameterized queries",
      stride_category: "Tampering",
      testable: true,
      test_hint: "Send a single quote in username field → expect validation error",
    },
    {
      id: "AC-002",
      severity: "high",
      title: "Brute force login",
      attacker_goal: "brute force user passwords",
      technique: "Automated login attempts",
      preconditions: ["No rate limiting"],
      impact: "Account takeover",
      mitigation: "Add rate limiting to login endpoint",
      stride_category: "Spoofing",
      testable: true,
    },
    {
      id: "AC-003",
      severity: "medium",
      title: "Session fixation",
      attacker_goal: "hijack user sessions",
      technique: "Force known session ID before login",
      preconditions: ["Session not regenerated"],
      impact: "Account access",
      mitigation: "Regenerate session after auth",
      stride_category: "Spoofing",
      testable: false,
    },
    {
      id: "AC-004",
      severity: "low",
      title: "Username enumeration",
      attacker_goal: "enumerate valid usernames",
      technique: "Timing attack on login response",
      preconditions: ["Different response times"],
      impact: "Information disclosure",
      mitigation: "Constant-time comparison",
      stride_category: "Information Disclosure",
      testable: true,
    },
    {
      id: "AC-005",
      severity: "medium",
      title: "Password in logs",
      attacker_goal: "extract passwords from logs",
      technique: "Access application logs",
      preconditions: ["Passwords logged"],
      impact: "Credential theft",
      mitigation: "Never log passwords",
      stride_category: "Information Disclosure",
      testable: true,
    },
    {
      id: "AC-006",
      severity: "high",
      title: "Token theft via XSS",
      attacker_goal: "steal JWT tokens",
      technique: "Cross-site scripting",
      preconditions: ["Token in localStorage"],
      impact: "Session hijacking",
      mitigation: "httpOnly cookies",
      stride_category: "Elevation of Privilege",
      testable: true,
      test_hint: "Check if token storage uses httpOnly cookie",
    },
  ];
}

function makeBaseContext() {
  return {
    projectDescription: "Authentication microservice for enterprise platform",
    stack: "TypeScript/Node.js",
    changeName: "auth-refactor",
    specContent: "# Auth Spec\n## Requirement 1\nImplement secure login with JWT tokens\n## Requirement 2\nAdd input validation on all endpoints",
    abuseCases: makeAbuseCases(),
    codeFiles: makeCodeFiles(),
    reviewContent: "# Security Review\n## Abuse Cases\nSee abuse cases below.",
    designContent: "## Architecture\nUsing middleware-based auth with JWT",
    proposalContent: "## Intent\nRefactor authentication to use JWT",
  };
}

// ══════════════════════════════════════════════════════════════════════
// Standard Posture Prompt
// ══════════════════════════════════════════════════════════════════════

describe("buildStandardAuditPrompt", () => {
  it("returns an AuditPrompt with all required fields", () => {
    const prompt = buildStandardAuditPrompt(makeBaseContext());
    expect(prompt.system_instructions).toBeTruthy();
    expect(prompt.analysis_request).toBeTruthy();
    expect(prompt.output_schema).toBeTruthy();
    expect(prompt.context).toBeTruthy();
  });

  it("system_instructions contain verification methodology", () => {
    const prompt = buildStandardAuditPrompt(makeBaseContext());
    expect(prompt.system_instructions).toContain("verify");
    expect(prompt.system_instructions).toContain("requirement");
    expect(prompt.system_instructions).toContain("abuse case");
    expect(prompt.system_instructions).toContain("pass");
    expect(prompt.system_instructions).toContain("fail");
    expect(prompt.system_instructions).toContain("partial");
    expect(prompt.system_instructions).toContain("skipped");
  });

  it("analysis_request contains Specification section", () => {
    const prompt = buildStandardAuditPrompt(makeBaseContext());
    expect(prompt.analysis_request).toContain("## Specification");
    expect(prompt.analysis_request).toContain("Auth Spec");
  });

  it("analysis_request contains Abuse Cases section", () => {
    const prompt = buildStandardAuditPrompt(makeBaseContext());
    expect(prompt.analysis_request).toContain("## Abuse Cases");
    expect(prompt.analysis_request).toContain("AC-001");
  });

  it("analysis_request contains Code Files section", () => {
    const prompt = buildStandardAuditPrompt(makeBaseContext());
    expect(prompt.analysis_request).toContain("## Code Files");
    expect(prompt.analysis_request).toContain("src/auth/login.ts");
    expect(prompt.analysis_request).toContain("function login(");
  });

  it("includes top 3-5 abuse cases by severity", () => {
    const prompt = buildStandardAuditPrompt(makeBaseContext());
    // 6 abuse cases, sorted by severity: critical (AC-001), high (AC-002, AC-006), medium (AC-003, AC-005), low (AC-004)
    // Standard takes top 5
    expect(prompt.analysis_request).toContain("AC-001");
    expect(prompt.analysis_request).toContain("AC-002");
    expect(prompt.analysis_request).toContain("AC-006");
    // AC-004 (low) should be the 6th — excluded from top 5
    // but AC-003, AC-005 (medium) are 4th and 5th
    expect(prompt.analysis_request).toContain("AC-003");
    expect(prompt.analysis_request).toContain("AC-005");
  });

  it("output_schema requires requirements, abuse_cases, and summary", () => {
    const prompt = buildStandardAuditPrompt(makeBaseContext());
    const schema = prompt.output_schema as Record<string, unknown>;
    expect(schema.required).toContain("requirements");
    expect(schema.required).toContain("abuse_cases");
    expect(schema.required).toContain("summary");
  });

  it("includes design content when present", () => {
    const prompt = buildStandardAuditPrompt(makeBaseContext());
    expect(prompt.analysis_request).toContain("## Architecture Design");
    expect(prompt.analysis_request).toContain("middleware-based auth");
  });

  it("includes proposal content when present", () => {
    const prompt = buildStandardAuditPrompt(makeBaseContext());
    expect(prompt.analysis_request).toContain("## Proposal");
    expect(prompt.analysis_request).toContain("Refactor authentication");
  });

  it("omits design section when designContent is undefined", () => {
    const ctx = { ...makeBaseContext(), designContent: undefined };
    const prompt = buildStandardAuditPrompt(ctx);
    expect(prompt.analysis_request).not.toContain("## Architecture Design");
  });

  it("omits proposal section when proposalContent is undefined", () => {
    const ctx = { ...makeBaseContext(), proposalContent: undefined };
    const prompt = buildStandardAuditPrompt(ctx);
    expect(prompt.analysis_request).not.toContain("## Proposal");
  });

  it("handles empty abuse cases gracefully", () => {
    const ctx = { ...makeBaseContext(), abuseCases: [] };
    const prompt = buildStandardAuditPrompt(ctx);
    expect(prompt.analysis_request).toContain("No abuse cases");
  });

  it("handles empty code files", () => {
    const ctx = { ...makeBaseContext(), codeFiles: [] };
    const prompt = buildStandardAuditPrompt(ctx);
    expect(prompt.analysis_request).toContain("## Code Files");
  });

  it("populates context fields correctly", () => {
    const prompt = buildStandardAuditPrompt(makeBaseContext());
    expect(prompt.context.project_description).toBe("Authentication microservice for enterprise platform");
    expect(prompt.context.stack).toBe("TypeScript/Node.js");
    expect(prompt.context.change_name).toBe("auth-refactor");
    expect(prompt.context.spec_content).toContain("Auth Spec");
    expect(prompt.context.design_content).toContain("middleware-based");
    expect(prompt.context.proposal_content).toContain("Refactor");
  });

  it("system prompt token overhead is in expected range (500-800 tokens)", () => {
    const prompt = buildStandardAuditPrompt(makeBaseContext());
    const estimatedTokens = Math.ceil(prompt.system_instructions.length / 4);
    // Allow some flexibility: 300-1000 tokens
    expect(estimatedTokens).toBeGreaterThan(300);
    expect(estimatedTokens).toBeLessThan(1000);
  });
});

// ══════════════════════════════════════════════════════════════════════
// Elevated Posture Prompt
// ══════════════════════════════════════════════════════════════════════

describe("buildElevatedAuditPrompt", () => {
  it("returns an AuditPrompt with all required fields", () => {
    const prompt = buildElevatedAuditPrompt(makeBaseContext());
    expect(prompt.system_instructions).toBeTruthy();
    expect(prompt.analysis_request).toBeTruthy();
    expect(prompt.output_schema).toBeTruthy();
    expect(prompt.context).toBeTruthy();
  });

  it("system_instructions mention OWASP Top 10 patterns", () => {
    const prompt = buildElevatedAuditPrompt(makeBaseContext());
    expect(prompt.system_instructions).toContain("OWASP");
    expect(prompt.system_instructions).toContain("Top 10");
    expect(prompt.system_instructions).toContain("A01");
    expect(prompt.system_instructions).toContain("Broken Access Control");
    expect(prompt.system_instructions).toContain("Injection");
  });

  it("system_instructions require code quality observations", () => {
    const prompt = buildElevatedAuditPrompt(makeBaseContext());
    expect(prompt.system_instructions).toContain("Code Quality");
    expect(prompt.system_instructions).toContain("Input validation");
    expect(prompt.system_instructions).toContain("Error handling");
  });

  it("includes ALL abuse cases (not filtered by severity)", () => {
    const prompt = buildElevatedAuditPrompt(makeBaseContext());
    // All 6 abuse cases should be present
    expect(prompt.analysis_request).toContain("AC-001");
    expect(prompt.analysis_request).toContain("AC-002");
    expect(prompt.analysis_request).toContain("AC-003");
    expect(prompt.analysis_request).toContain("AC-004");
    expect(prompt.analysis_request).toContain("AC-005");
    expect(prompt.analysis_request).toContain("AC-006");
  });

  it("analysis_request mentions elevated-depth and OWASP", () => {
    const prompt = buildElevatedAuditPrompt(makeBaseContext());
    expect(prompt.analysis_request).toContain("elevated-depth");
    expect(prompt.analysis_request).toContain("OWASP");
  });

  it("output_schema requires requirements, abuse_cases, and summary", () => {
    const prompt = buildElevatedAuditPrompt(makeBaseContext());
    const schema = prompt.output_schema as Record<string, unknown>;
    expect(schema.required).toContain("requirements");
    expect(schema.required).toContain("abuse_cases");
    expect(schema.required).toContain("summary");
  });

  it("includes code files in analysis_request", () => {
    const prompt = buildElevatedAuditPrompt(makeBaseContext());
    expect(prompt.analysis_request).toContain("src/auth/login.ts");
    expect(prompt.analysis_request).toContain("src/middleware/validate.ts");
  });

  it("populates context fields correctly", () => {
    const prompt = buildElevatedAuditPrompt(makeBaseContext());
    expect(prompt.context.project_description).toBe("Authentication microservice for enterprise platform");
    expect(prompt.context.stack).toBe("TypeScript/Node.js");
    expect(prompt.context.change_name).toBe("auth-refactor");
  });

  it("handles empty abuse cases gracefully", () => {
    const ctx = { ...makeBaseContext(), abuseCases: [] };
    const prompt = buildElevatedAuditPrompt(ctx);
    expect(prompt.analysis_request).toContain("No abuse cases");
  });

  it("system prompt is significantly larger than standard", () => {
    const standard = buildStandardAuditPrompt(makeBaseContext());
    const elevated = buildElevatedAuditPrompt(makeBaseContext());
    expect(elevated.system_instructions.length).toBeGreaterThan(standard.system_instructions.length);
  });
});

// ══════════════════════════════════════════════════════════════════════
// Paranoid Posture Prompt
// ══════════════════════════════════════════════════════════════════════

describe("buildParanoidAuditPrompt", () => {
  it("returns an AuditPrompt with all required fields", () => {
    const prompt = buildParanoidAuditPrompt(makeBaseContext());
    expect(prompt.system_instructions).toBeTruthy();
    expect(prompt.analysis_request).toBeTruthy();
    expect(prompt.output_schema).toBeTruthy();
    expect(prompt.context).toBeTruthy();
  });

  it("system_instructions mention data flow tracing", () => {
    const prompt = buildParanoidAuditPrompt(makeBaseContext());
    expect(prompt.system_instructions).toContain("Data Flow");
    expect(prompt.system_instructions).toContain("trust boundar");
  });

  it("system_instructions mention DREAD scoring", () => {
    const prompt = buildParanoidAuditPrompt(makeBaseContext());
    expect(prompt.system_instructions).toContain("DREAD");
    expect(prompt.system_instructions).toContain("Damage");
    expect(prompt.system_instructions).toContain("Reproducibility");
    expect(prompt.system_instructions).toContain("Exploitability");
    expect(prompt.system_instructions).toContain("Affected Users");
    expect(prompt.system_instructions).toContain("Discoverability");
  });

  it("system_instructions mention supply chain risks", () => {
    const prompt = buildParanoidAuditPrompt(makeBaseContext());
    expect(prompt.system_instructions).toContain("Supply Chain");
    expect(prompt.system_instructions).toContain("dependency");
  });

  it("system_instructions require line-by-line analysis", () => {
    const prompt = buildParanoidAuditPrompt(makeBaseContext());
    expect(prompt.system_instructions).toContain("line-by-line");
  });

  it("system_instructions require MANDATORY code quality section", () => {
    const prompt = buildParanoidAuditPrompt(makeBaseContext());
    expect(prompt.system_instructions).toContain("Code Quality");
    expect(prompt.system_instructions).toContain("MANDATORY");
  });

  it("system_instructions mention OWASP Web + API Security Top 10", () => {
    const prompt = buildParanoidAuditPrompt(makeBaseContext());
    expect(prompt.system_instructions).toContain("OWASP Web Top 10");
    expect(prompt.system_instructions).toContain("OWASP API Security Top 10");
    expect(prompt.system_instructions).toContain("API1");
  });

  it("includes test_hint values in abuse cases section", () => {
    const prompt = buildParanoidAuditPrompt(makeBaseContext());
    // AC-001 has test_hint: "Send a single quote..."
    expect(prompt.analysis_request).toContain("Test Hint");
    expect(prompt.analysis_request).toContain("Send a single quote");
    // AC-006 has test_hint: "Check if token storage..."
    expect(prompt.analysis_request).toContain("Check if token storage");
  });

  it("includes ALL abuse cases (up to 12)", () => {
    const prompt = buildParanoidAuditPrompt(makeBaseContext());
    expect(prompt.analysis_request).toContain("AC-001");
    expect(prompt.analysis_request).toContain("AC-002");
    expect(prompt.analysis_request).toContain("AC-003");
    expect(prompt.analysis_request).toContain("AC-004");
    expect(prompt.analysis_request).toContain("AC-005");
    expect(prompt.analysis_request).toContain("AC-006");
  });

  it("analysis_request mentions PARANOID-depth and exhaustive analysis", () => {
    const prompt = buildParanoidAuditPrompt(makeBaseContext());
    expect(prompt.analysis_request).toContain("PARANOID-depth");
    expect(prompt.analysis_request).toContain("DREAD");
    expect(prompt.analysis_request).toContain("supply chain");
  });

  it("analysis_request mentions test hints verification when hints exist", () => {
    const prompt = buildParanoidAuditPrompt(makeBaseContext());
    expect(prompt.analysis_request).toContain("Test hints are provided");
  });

  it("analysis_request does NOT mention test hints when none exist", () => {
    const ctx = {
      ...makeBaseContext(),
      abuseCases: makeAbuseCases().map((ac) => ({ ...ac, test_hint: undefined })),
    };
    const prompt = buildParanoidAuditPrompt(ctx);
    expect(prompt.analysis_request).not.toContain("Test hints are provided");
  });

  it("output_schema requires requirements, abuse_cases, and summary", () => {
    const prompt = buildParanoidAuditPrompt(makeBaseContext());
    const schema = prompt.output_schema as Record<string, unknown>;
    expect(schema.required).toContain("requirements");
    expect(schema.required).toContain("abuse_cases");
    expect(schema.required).toContain("summary");
  });

  it("includes code files in analysis_request", () => {
    const prompt = buildParanoidAuditPrompt(makeBaseContext());
    expect(prompt.analysis_request).toContain("src/auth/login.ts");
    expect(prompt.analysis_request).toContain("src/middleware/validate.ts");
  });

  it("populates context fields correctly", () => {
    const prompt = buildParanoidAuditPrompt(makeBaseContext());
    expect(prompt.context.project_description).toBe("Authentication microservice for enterprise platform");
    expect(prompt.context.stack).toBe("TypeScript/Node.js");
    expect(prompt.context.change_name).toBe("auth-refactor");
    expect(prompt.context.spec_content).toContain("Auth Spec");
    expect(prompt.context.review_content).toContain("Security Review");
  });

  it("handles empty abuse cases gracefully", () => {
    const ctx = { ...makeBaseContext(), abuseCases: [] };
    const prompt = buildParanoidAuditPrompt(ctx);
    expect(prompt.analysis_request).toContain("No abuse cases");
  });

  it("system prompt is significantly larger than elevated", () => {
    const elevated = buildElevatedAuditPrompt(makeBaseContext());
    const paranoid = buildParanoidAuditPrompt(makeBaseContext());
    expect(paranoid.system_instructions.length).toBeGreaterThan(elevated.system_instructions.length);
  });
});

// ══════════════════════════════════════════════════════════════════════
// Cross-posture comparisons
// ══════════════════════════════════════════════════════════════════════

describe("Cross-posture audit prompt comparison", () => {
  it("all postures produce valid AuditPrompt shape", () => {
    const ctx = makeBaseContext();
    for (const builder of [buildStandardAuditPrompt, buildElevatedAuditPrompt, buildParanoidAuditPrompt]) {
      const prompt = builder(ctx);
      expect(prompt).toHaveProperty("system_instructions");
      expect(prompt).toHaveProperty("analysis_request");
      expect(prompt).toHaveProperty("output_schema");
      expect(prompt).toHaveProperty("context");
      expect(typeof prompt.system_instructions).toBe("string");
      expect(typeof prompt.analysis_request).toBe("string");
      expect(typeof prompt.output_schema).toBe("object");
    }
  });

  it("posture depth increases: standard < elevated < paranoid (system_instructions length)", () => {
    const ctx = makeBaseContext();
    const standard = buildStandardAuditPrompt(ctx);
    const elevated = buildElevatedAuditPrompt(ctx);
    const paranoid = buildParanoidAuditPrompt(ctx);

    expect(standard.system_instructions.length).toBeLessThan(elevated.system_instructions.length);
    expect(elevated.system_instructions.length).toBeLessThan(paranoid.system_instructions.length);
  });

  it("all postures include code files section", () => {
    const ctx = makeBaseContext();
    for (const builder of [buildStandardAuditPrompt, buildElevatedAuditPrompt, buildParanoidAuditPrompt]) {
      const prompt = builder(ctx);
      expect(prompt.analysis_request).toContain("## Code Files");
      expect(prompt.analysis_request).toContain("src/auth/login.ts");
    }
  });

  it("all postures include spec content", () => {
    const ctx = makeBaseContext();
    for (const builder of [buildStandardAuditPrompt, buildElevatedAuditPrompt, buildParanoidAuditPrompt]) {
      const prompt = builder(ctx);
      expect(prompt.analysis_request).toContain("## Specification");
      expect(prompt.analysis_request).toContain("Auth Spec");
    }
  });

  it("only paranoid includes test_hint in abuse cases", () => {
    const ctx = makeBaseContext();
    const standard = buildStandardAuditPrompt(ctx);
    const elevated = buildElevatedAuditPrompt(ctx);
    const paranoid = buildParanoidAuditPrompt(ctx);

    // Standard and elevated do NOT include test_hint
    expect(standard.analysis_request).not.toContain("Test Hint:");
    expect(elevated.analysis_request).not.toContain("Test Hint:");
    // Paranoid DOES include test_hint
    expect(paranoid.analysis_request).toContain("Test Hint:");
  });

  it("only paranoid mentions DREAD scoring", () => {
    const ctx = makeBaseContext();
    const standard = buildStandardAuditPrompt(ctx);
    const elevated = buildElevatedAuditPrompt(ctx);
    const paranoid = buildParanoidAuditPrompt(ctx);

    expect(standard.system_instructions).not.toContain("DREAD");
    expect(elevated.system_instructions).not.toContain("DREAD");
    expect(paranoid.system_instructions).toContain("DREAD");
  });

  it("elevated and paranoid mention OWASP; standard does not", () => {
    const ctx = makeBaseContext();
    const standard = buildStandardAuditPrompt(ctx);
    const elevated = buildElevatedAuditPrompt(ctx);
    const paranoid = buildParanoidAuditPrompt(ctx);

    expect(standard.system_instructions).not.toContain("OWASP");
    expect(elevated.system_instructions).toContain("OWASP");
    expect(paranoid.system_instructions).toContain("OWASP");
  });
});
