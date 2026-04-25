/**
 * Audit engine unit tests — validation, error class, type constraints,
 * code discovery, file budgeting, hash computation, prompt generation,
 * markdown rendering, and abuse case parsing.
 *
 * Phase 1: Tests for types, validation, and AuditValidationError.
 * Phase 2: Tests for AuditEngine core functions.
 *
 * Spec refs: Domain 1 (all Audit Types scenarios), Domain 2 (Audit Result Validation),
 *            Domain 6 (Code Reading), Domain 9 (Template Rendering)
 * Design refs: Decision 4-6, 8, 10
 *
 * v0.3: New file for /spec-audit feature.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  AuditValidationError,
  validateAuditResult,
  discoverChangedFiles,
  readCodeFiles,
  selectAndBudgetFiles,
  computeAuditHash,
  generateAuditPrompt,
  renderAuditMarkdown,
  parseAbuseCasesFromReview,
  isAuditStale,
  EMPTY_SHA256_SENTINEL,
} from "../../src/services/audit.js";
import type { AuditContext } from "../../src/services/audit.js";
import type {
  AuditResult,
  RequirementVerification,
  AbuseCaseVerification,
  AuditSummary,
  AuditPrompt,
  CodeFile,
  VtspecConfig,
} from "../../src/types/index.js";

// ── Test Helpers ─────────────────────────────────────────────────────

function makeMinimalAuditResult() {
  return {
    requirements: [
      {
        requirement_id: "REQ-001",
        verdict: "pass",
        evidence: "Validation middleware found on all routes",
        code_references: ["src/middleware/validate.ts:15"],
        gaps: [],
        notes: "",
      },
    ],
    abuse_cases: [],
    summary: {
      overall_verdict: "pass",
      requirements_coverage: {
        total: 1,
        passed: 1,
        failed: 0,
        partial: 0,
        skipped: 0,
      },
      abuse_cases_coverage: {
        total: 0,
        verified: 0,
        unverified: 0,
        partial: 0,
        not_applicable: 0,
      },
      risk_level: "low",
      recommendations: [],
    },
  };
}

function makeFullAuditResult() {
  return {
    requirements: [
      {
        requirement_id: "REQ-001",
        verdict: "pass",
        evidence: "Input validation on all endpoints",
        code_references: ["src/routes/api.ts:42", "src/middleware/validate.ts:10"],
        gaps: [],
        notes: "Using Zod for validation",
      },
      {
        requirement_id: "REQ-002",
        verdict: "fail",
        evidence: "Rate limiting not implemented",
        code_references: [],
        gaps: ["No rate limiter on /api/auth/login"],
        notes: "Critical for brute force prevention",
      },
      {
        requirement_id: "REQ-003",
        verdict: "partial",
        evidence: "Logging exists but missing audit trail",
        code_references: ["src/logger.ts:5"],
        gaps: ["No structured audit events"],
        notes: "",
      },
      {
        requirement_id: "REQ-004",
        verdict: "skipped",
        evidence: "",
        code_references: [],
        gaps: [],
        notes: "Infrastructure requirement — cannot verify from code alone",
      },
      {
        requirement_id: "REQ-005",
        verdict: "pass",
        evidence: "JWT token expiry set correctly",
        code_references: ["src/auth/token.ts:22"],
        gaps: [],
        notes: "",
      },
    ],
    abuse_cases: [
      {
        abuse_case_id: "AC-001",
        verdict: "verified",
        evidence: "Parameterized queries used throughout",
        code_references: ["src/db/queries.ts:15"],
        gaps: [],
        risk_if_unaddressed: "",
      },
      {
        abuse_case_id: "AC-002",
        verdict: "unverified",
        evidence: "",
        code_references: [],
        gaps: ["Session ID not regenerated after login"],
        risk_if_unaddressed: "Session fixation attack possible",
      },
      {
        abuse_case_id: "AC-003",
        verdict: "not_applicable",
        evidence: "Change does not expose any network endpoints",
        code_references: [],
        gaps: [],
        risk_if_unaddressed: "",
      },
    ],
    summary: {
      overall_verdict: "partial",
      requirements_coverage: {
        total: 5,
        passed: 2,
        failed: 1,
        partial: 1,
        skipped: 1,
      },
      abuse_cases_coverage: {
        total: 3,
        verified: 1,
        unverified: 1,
        partial: 0,
        not_applicable: 1,
      },
      risk_level: "high",
      recommendations: [
        "Add rate limiting to /api/auth/login",
        "Regenerate session ID after authentication",
      ],
    },
  };
}

// ── AuditValidationError ─────────────────────────────────────────────

describe("AuditValidationError", () => {
  it("is an instance of Error", () => {
    const err = new AuditValidationError("test error");
    expect(err).toBeInstanceOf(Error);
  });

  it("has name 'AuditValidationError'", () => {
    const err = new AuditValidationError("test");
    expect(err.name).toBe("AuditValidationError");
  });

  it("stores message correctly", () => {
    const err = new AuditValidationError("Something went wrong");
    expect(err.message).toBe("Something went wrong");
  });

  it("stores optional details", () => {
    const details = { field: "requirements", reason: "missing" };
    const err = new AuditValidationError("Validation failed", details);
    expect(err.details).toEqual(details);
  });

  it("defaults details to undefined", () => {
    const err = new AuditValidationError("test");
    expect(err.details).toBeUndefined();
  });
});

// ── validateAuditResult ──────────────────────────────────────────────

describe("validateAuditResult", () => {
  it("validates a minimal valid audit result", () => {
    const result = validateAuditResult(
      makeMinimalAuditResult(),
      "test-change",
      "sha256:spec123",
      "sha256:audit456",
      "standard",
    );

    expect(result.change).toBe("test-change");
    expect(result.posture).toBe("standard");
    expect(result.spec_hash).toBe("sha256:spec123");
    expect(result.audit_hash).toBe("sha256:audit456");
    expect(result.requirements).toHaveLength(1);
    expect(result.requirements[0]!.requirement_id).toBe("REQ-001");
    expect(result.requirements[0]!.verdict).toBe("pass");
    expect(result.abuse_cases).toEqual([]);
    expect(result.summary.overall_verdict).toBe("pass");
  });

  it("validates a full audit result with all fields", () => {
    const result = validateAuditResult(
      makeFullAuditResult(),
      "auth-refactor",
      "sha256:spec789",
      "sha256:audit012",
      "elevated",
    );

    expect(result.change).toBe("auth-refactor");
    expect(result.posture).toBe("elevated");
    expect(result.requirements).toHaveLength(5);
    expect(result.abuse_cases).toHaveLength(3);
    expect(result.summary.overall_verdict).toBe("partial");
    expect(result.summary.risk_level).toBe("high");
    expect(result.summary.recommendations).toHaveLength(2);
  });

  it("sets timestamp to current ISO string", () => {
    const before = new Date().toISOString();
    const result = validateAuditResult(
      makeMinimalAuditResult(),
      "test",
      "h",
      "h",
      "standard",
    );
    const after = new Date().toISOString();
    expect(result.timestamp >= before).toBe(true);
    expect(result.timestamp <= after).toBe(true);
  });

  it("validates audit result with empty abuse cases", () => {
    const raw = makeMinimalAuditResult();
    raw.abuse_cases = [];
    const result = validateAuditResult(raw, "test", "h", "h", "standard");
    expect(result.abuse_cases).toEqual([]);
    expect(result.summary.overall_verdict).toBe("pass");
  });

  // ── Error cases ──────────────────────────────────────────────────

  it("throws AuditValidationError for null input", () => {
    expect(() =>
      validateAuditResult(null, "x", "h", "h", "standard"),
    ).toThrow(AuditValidationError);
  });

  it("throws AuditValidationError for non-object input", () => {
    expect(() =>
      validateAuditResult("not an object", "x", "h", "h", "standard"),
    ).toThrow(AuditValidationError);
  });

  it("throws when requirements field is missing", () => {
    const raw = { summary: {}, abuse_cases: [] };
    expect(() =>
      validateAuditResult(raw, "x", "h", "h", "standard"),
    ).toThrow(AuditValidationError);
    expect(() =>
      validateAuditResult(raw, "x", "h", "h", "standard"),
    ).toThrow(/requirements/);
  });

  it("throws when requirements is not an array", () => {
    const raw = { requirements: "not-array", abuse_cases: [], summary: {} };
    expect(() =>
      validateAuditResult(raw, "x", "h", "h", "standard"),
    ).toThrow(AuditValidationError);
  });

  it("throws when requirements array is empty", () => {
    const raw = { requirements: [], abuse_cases: [], summary: { overall_verdict: "pass" } };
    expect(() =>
      validateAuditResult(raw, "x", "h", "h", "standard"),
    ).toThrow(AuditValidationError);
    expect(() =>
      validateAuditResult(raw, "x", "h", "h", "standard"),
    ).toThrow(/empty/);
  });

  it("throws when summary field is missing", () => {
    const raw = {
      requirements: [{ requirement_id: "REQ-001", verdict: "pass" }],
      abuse_cases: [],
    };
    expect(() =>
      validateAuditResult(raw, "x", "h", "h", "standard"),
    ).toThrow(AuditValidationError);
    expect(() =>
      validateAuditResult(raw, "x", "h", "h", "standard"),
    ).toThrow(/summary/);
  });

  // ── Graceful defaults ────────────────────────────────────────────

  it("defaults invalid requirement verdict to 'partial'", () => {
    const raw = makeMinimalAuditResult();
    (raw.requirements[0] as Record<string, unknown>).verdict = "maybe";
    const result = validateAuditResult(raw, "x", "h", "h", "standard");
    expect(result.requirements[0]!.verdict).toBe("partial");
  });

  it("defaults invalid abuse case verdict to 'partial'", () => {
    const raw = makeFullAuditResult();
    (raw.abuse_cases[0] as Record<string, unknown>).verdict = "unknown-status";
    const result = validateAuditResult(raw, "x", "h", "h", "standard");
    expect(result.abuse_cases[0]!.verdict).toBe("partial");
  });

  it("defaults invalid overall verdict to 'partial'", () => {
    const raw = makeMinimalAuditResult();
    (raw.summary as Record<string, unknown>).overall_verdict = "success";
    const result = validateAuditResult(raw, "x", "h", "h", "standard");
    expect(result.summary.overall_verdict).toBe("partial");
  });

  it("defaults invalid risk_level to 'medium'", () => {
    const raw = makeMinimalAuditResult();
    (raw.summary as Record<string, unknown>).risk_level = "extreme";
    const result = validateAuditResult(raw, "x", "h", "h", "standard");
    expect(result.summary.risk_level).toBe("medium");
  });

  it("defaults missing code_references to empty array (caught by semantic validation)", () => {
    const raw = makeMinimalAuditResult();
    delete (raw.requirements[0] as Record<string, unknown>).code_references;
    // v0.6: With semantic validation, a result with zero code_references across all
    // non-skipped requirements is rejected. The structural default still works,
    // but semantic validation catches the empty result.
    expect(() =>
      validateAuditResult(raw, "x", "h", "h", "standard"),
    ).toThrow(AuditValidationError);
    expect(() =>
      validateAuditResult(raw, "x", "h", "h", "standard"),
    ).toThrow(/code_references/);
  });

  it("defaults missing gaps to empty array", () => {
    const raw = makeMinimalAuditResult();
    delete (raw.requirements[0] as Record<string, unknown>).gaps;
    const result = validateAuditResult(raw, "x", "h", "h", "standard");
    expect(result.requirements[0]!.gaps).toEqual([]);
  });

  it("defaults missing notes to empty string", () => {
    const raw = makeMinimalAuditResult();
    delete (raw.requirements[0] as Record<string, unknown>).notes;
    const result = validateAuditResult(raw, "x", "h", "h", "standard");
    expect(result.requirements[0]!.notes).toBe("");
  });

  it("defaults missing requirement_id to 'UNKNOWN'", () => {
    const raw = makeMinimalAuditResult();
    delete (raw.requirements[0] as Record<string, unknown>).requirement_id;
    const result = validateAuditResult(raw, "x", "h", "h", "standard");
    expect(result.requirements[0]!.requirement_id).toBe("UNKNOWN");
  });

  it("defaults missing abuse_case_id to 'AC-???'", () => {
    const raw = makeFullAuditResult();
    delete (raw.abuse_cases[0] as Record<string, unknown>).abuse_case_id;
    const result = validateAuditResult(raw, "x", "h", "h", "standard");
    expect(result.abuse_cases[0]!.abuse_case_id).toBe("AC-???");
  });

  it("defaults abuse_cases to empty array when field is not an array", () => {
    const raw = makeMinimalAuditResult();
    (raw as Record<string, unknown>).abuse_cases = "not-an-array";
    const result = validateAuditResult(raw, "x", "h", "h", "standard");
    expect(result.abuse_cases).toEqual([]);
  });

  it("computes requirements_coverage from requirements when coverage field is missing", () => {
    const raw = makeFullAuditResult();
    delete (raw.summary as Record<string, unknown>).requirements_coverage;
    const result = validateAuditResult(raw, "x", "h", "h", "standard");
    expect(result.summary.requirements_coverage.total).toBe(5);
    expect(result.summary.requirements_coverage.passed).toBe(2);
    expect(result.summary.requirements_coverage.failed).toBe(1);
    expect(result.summary.requirements_coverage.partial).toBe(1);
    expect(result.summary.requirements_coverage.skipped).toBe(1);
  });

  it("computes abuse_cases_coverage from abuse_cases when coverage field is missing", () => {
    const raw = makeFullAuditResult();
    delete (raw.summary as Record<string, unknown>).abuse_cases_coverage;
    const result = validateAuditResult(raw, "x", "h", "h", "standard");
    expect(result.summary.abuse_cases_coverage.total).toBe(3);
    expect(result.summary.abuse_cases_coverage.verified).toBe(1);
    expect(result.summary.abuse_cases_coverage.unverified).toBe(1);
    expect(result.summary.abuse_cases_coverage.not_applicable).toBe(1);
  });

  it("defaults missing recommendations to empty array", () => {
    const raw = makeMinimalAuditResult();
    delete (raw.summary as Record<string, unknown>).recommendations;
    const result = validateAuditResult(raw, "x", "h", "h", "standard");
    expect(result.summary.recommendations).toEqual([]);
  });

  it("filters out non-object entries from requirements", () => {
    const raw = makeMinimalAuditResult();
    (raw as Record<string, unknown>).requirements = [
      { requirement_id: "REQ-001", verdict: "pass", evidence: "Validation middleware found on all routes", code_references: ["src/auth.ts:10"], gaps: [], notes: "" },
      "not-an-object",
      null,
      42,
    ];
    const result = validateAuditResult(raw, "x", "h", "h", "standard");
    expect(result.requirements).toHaveLength(1);
  });

  it("filters out non-object entries from abuse_cases", () => {
    const raw = makeFullAuditResult();
    (raw as Record<string, unknown>).abuse_cases = [
      { abuse_case_id: "AC-001", verdict: "verified" },
      "not-valid",
      null,
    ];
    const result = validateAuditResult(raw, "x", "h", "h", "standard");
    expect(result.abuse_cases).toHaveLength(1);
  });

  it("defaults missing risk_if_unaddressed to empty string", () => {
    const raw = makeFullAuditResult();
    delete (raw.abuse_cases[0] as Record<string, unknown>).risk_if_unaddressed;
    const result = validateAuditResult(raw, "x", "h", "h", "standard");
    expect(result.abuse_cases[0]!.risk_if_unaddressed).toBe("");
  });

  it("works with all three postures", () => {
    for (const posture of ["standard", "elevated", "paranoid"] as const) {
      const result = validateAuditResult(
        makeMinimalAuditResult(),
        "test",
        "h",
        "h",
        posture,
      );
      expect(result.posture).toBe(posture);
    }
  });
});

// ── Type compilation checks ──────────────────────────────────────────

describe("Audit type compilation", () => {
  it("RequirementVerification type is usable", () => {
    const rv: RequirementVerification = {
      requirement_id: "REQ-001",
      verdict: "pass",
      evidence: "Code found",
      code_references: ["src/file.ts:10"],
      gaps: [],
      notes: "",
    };
    expect(rv.requirement_id).toBe("REQ-001");
    expect(rv.verdict).toBe("pass");
  });

  it("AbuseCaseVerification type is usable", () => {
    const av: AbuseCaseVerification = {
      abuse_case_id: "AC-001",
      verdict: "verified",
      evidence: "Parameterized queries found",
      code_references: ["src/db.ts:5"],
      gaps: [],
      risk_if_unaddressed: "",
    };
    expect(av.abuse_case_id).toBe("AC-001");
    expect(av.verdict).toBe("verified");
  });

  it("AuditSummary type is usable", () => {
    const summary: AuditSummary = {
      overall_verdict: "pass",
      requirements_coverage: { total: 1, passed: 1, failed: 0, partial: 0, skipped: 0 },
      abuse_cases_coverage: { total: 0, verified: 0, unverified: 0, partial: 0, not_applicable: 0 },
      risk_level: "low",
      recommendations: [],
    };
    expect(summary.overall_verdict).toBe("pass");
  });

  it("AuditPrompt type is usable", () => {
    const prompt: AuditPrompt = {
      system_instructions: "You are an auditor",
      analysis_request: "Audit this code",
      output_schema: { type: "object" },
      context: {
        project_description: "Test project",
        stack: "TypeScript",
        change_name: "test-change",
        spec_content: "# Spec",
      },
    };
    expect(prompt.context.change_name).toBe("test-change");
  });

  it("CodeFile type is usable", () => {
    const file: CodeFile = {
      path: "src/index.ts",
      content: "console.log('hello');",
      tokens: 6,
    };
    expect(file.tokens).toBe(6);
  });

  it("AuditResult type is usable", () => {
    const result: AuditResult = {
      change: "test",
      posture: "standard",
      timestamp: "2025-01-01T00:00:00.000Z",
      spec_hash: "sha256:abc",
      audit_hash: "sha256:def",
      requirements: [],
      abuse_cases: [],
      summary: {
        overall_verdict: "pass",
        requirements_coverage: { total: 0, passed: 0, failed: 0, partial: 0, skipped: 0 },
        abuse_cases_coverage: { total: 0, verified: 0, unverified: 0, partial: 0, not_applicable: 0 },
        risk_level: "low",
        recommendations: [],
      },
    };
    expect(result.change).toBe("test");
  });
});

// ══════════════════════════════════════════════════════════════════════
// Phase 2: AuditEngine Core Functions
// ══════════════════════════════════════════════════════════════════════

// ── Mock setup for child_process and fs ──────────────────────────────

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    default: actual,
    existsSync: vi.fn(actual.existsSync),
    readFileSync: vi.fn(actual.readFileSync),
  };
});

import { execSync } from "node:child_process";
import * as fs from "node:fs";

// ── discoverChangedFiles ─────────────────────────────────────────────

describe("discoverChangedFiles", () => {
  beforeEach(() => {
    vi.mocked(execSync).mockReset();
    vi.mocked(fs.existsSync).mockReset();
    vi.mocked(fs.readFileSync).mockReset();
  });

  it("parses git diff output and returns file paths", () => {
    vi.mocked(execSync).mockReturnValue(
      "src/index.ts\nsrc/utils.ts\nREADME.md\n",
    );
    // Note: README.md is NOT filtered by discoverChangedFiles (only binaries/lockfiles/dirs are)
    const files = discoverChangedFiles("test-change", "main", "/project");
    expect(files).toContain("src/index.ts");
    expect(files).toContain("src/utils.ts");
  });

  it("filters out binary/image files", () => {
    vi.mocked(execSync).mockReturnValue(
      "src/index.ts\nassets/logo.png\nfonts/Inter.woff2\nicons/favicon.ico\nimage.jpg\nphoto.jpeg\nanimation.gif\ndiagram.svg\nimage.webp\n",
    );
    const files = discoverChangedFiles("test-change", "main", "/project");
    expect(files).toEqual(["src/index.ts"]);
  });

  it("filters out lockfiles", () => {
    vi.mocked(execSync).mockReturnValue(
      "src/index.ts\npackage-lock.json\nyarn.lock\npnpm-lock.yaml\nGemfile.lock\n",
    );
    const files = discoverChangedFiles("test-change", "main", "/project");
    expect(files).toContain("src/index.ts");
    expect(files).not.toContain("package-lock.json");
    expect(files).not.toContain("yarn.lock");
    expect(files).not.toContain("pnpm-lock.yaml");
    expect(files).not.toContain("Gemfile.lock");
  });

  it("filters out generated directories", () => {
    vi.mocked(execSync).mockReturnValue(
      "src/index.ts\ndist/bundle.js\nbuild/output.js\nnode_modules/pkg/index.js\n.next/cache/data.json\n",
    );
    const files = discoverChangedFiles("test-change", "main", "/project");
    expect(files).toEqual(["src/index.ts"]);
  });

  it("returns empty array when git diff has no output", () => {
    vi.mocked(execSync).mockReturnValue("\n");
    const files = discoverChangedFiles("test-change", "main", "/project");
    expect(files).toEqual([]);
  });

  it("returns empty array when git diff fails and no fallback exists", () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error("git not available");
    });
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const files = discoverChangedFiles("test-change", "main", "/project");
    expect(files).toEqual([]);
  });

  it("uses provided baseBranch parameter", () => {
    vi.mocked(execSync).mockReturnValue("src/file.ts\n");
    discoverChangedFiles("test-change", "develop", "/project");
    expect(vi.mocked(execSync)).toHaveBeenCalledWith(
      "git diff develop...HEAD --name-only",
      expect.objectContaining({ cwd: "/project" }),
    );
  });

  it("detects base branch when baseBranch not provided", () => {
    // First call: detectBaseBranch via symbolic-ref
    vi.mocked(execSync)
      .mockReturnValueOnce("refs/remotes/origin/develop\n") // detectBaseBranch
      .mockReturnValueOnce("src/file.ts\n"); // git diff
    const files = discoverChangedFiles("test-change", undefined, "/project");
    expect(files).toContain("src/file.ts");
  });

  it("falls back to 'main' when detectBaseBranch fails", () => {
    vi.mocked(execSync)
      .mockImplementationOnce(() => { throw new Error("no remote"); }) // detectBaseBranch fails
      .mockReturnValueOnce("src/file.ts\n"); // git diff with main
    const files = discoverChangedFiles("test-change", undefined, "/project");
    expect(files).toContain("src/file.ts");
    expect(vi.mocked(execSync)).toHaveBeenCalledWith(
      "git diff main...HEAD --name-only",
      expect.objectContaining({ cwd: "/project" }),
    );
  });
});

// ── readCodeFiles ────────────────────────────────────────────────────

describe("readCodeFiles", () => {
  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReset();
    vi.mocked(fs.readFileSync).mockReset();
  });

  it("reads existing files and returns CodeFile objects", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue("const x = 1;");
    const files = readCodeFiles(["src/index.ts"], "/project");
    expect(files).toHaveLength(1);
    expect(files[0]!.path).toBe("src/index.ts");
    expect(files[0]!.content).toBe("const x = 1;");
    expect(files[0]!.tokens).toBe(Math.ceil("const x = 1;".length / 4));
  });

  it("skips missing files gracefully", () => {
    vi.mocked(fs.existsSync)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);
    vi.mocked(fs.readFileSync).mockReturnValue("content");
    const files = readCodeFiles(["src/exists.ts", "src/missing.ts"], "/project");
    expect(files).toHaveLength(1);
    expect(files[0]!.path).toBe("src/exists.ts");
  });

  it("computes tokens as ceil(chars / 4)", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    // 100 chars → 25 tokens
    vi.mocked(fs.readFileSync).mockReturnValue("a".repeat(100));
    const files = readCodeFiles(["file.ts"], "/project");
    expect(files[0]!.tokens).toBe(25);

    // 101 chars → 26 tokens (ceil)
    vi.mocked(fs.readFileSync).mockReturnValue("a".repeat(101));
    const files2 = readCodeFiles(["file.ts"], "/project");
    expect(files2[0]!.tokens).toBe(26);
  });

  it("handles read errors gracefully", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error("permission denied");
    });
    const files = readCodeFiles(["src/secret.ts"], "/project");
    expect(files).toHaveLength(0);
  });

  it("returns empty array for empty input", () => {
    const files = readCodeFiles([], "/project");
    expect(files).toEqual([]);
  });
});

// ── selectAndBudgetFiles ─────────────────────────────────────────────

describe("selectAndBudgetFiles", () => {
  function makeCodeFile(filePath: string, tokens: number): CodeFile {
    return {
      path: filePath,
      content: "x".repeat(tokens * 4),
      tokens,
    };
  }

  it("returns all files when within budget", () => {
    const files = [
      makeCodeFile("src/index.ts", 100),
      makeCodeFile("src/utils.ts", 200),
    ];
    const selected = selectAndBudgetFiles(files, 1000);
    expect(selected).toHaveLength(2);
  });

  it("respects token budget by excluding files that exceed it", () => {
    const files = [
      makeCodeFile("src/small.ts", 100),
      makeCodeFile("src/medium.ts", 500),
      makeCodeFile("src/large.ts", 600),
    ];
    const selected = selectAndBudgetFiles(files, 700);
    // All are Tier 3, sorted by size descending: large(600), medium(500), small(100)
    // large(600) fits. medium(500) would make 1100 > 700, skip. small(100) makes 700, fits.
    expect(selected).toHaveLength(2);
    expect(selected.map((f) => f.path)).toEqual(["src/large.ts", "src/small.ts"]);
  });

  it("prioritizes spec-mentioned files (Tier 1)", () => {
    const files = [
      makeCodeFile("src/other.ts", 100),
      makeCodeFile("src/auth.ts", 100),  // security-relevant (Tier 2)
      makeCodeFile("src/mentioned.ts", 100), // spec-mentioned (Tier 1)
    ];
    const specContent = "The system must implement src/mentioned.ts for validation.";
    const selected = selectAndBudgetFiles(files, 250, specContent);
    // Budget allows 2 files: Tier1 (mentioned) + Tier2 (auth), other excluded
    expect(selected).toHaveLength(2);
    expect(selected[0]!.path).toBe("src/mentioned.ts"); // Tier 1 first
    expect(selected[1]!.path).toBe("src/auth.ts"); // Tier 2 second
  });

  it("prioritizes security-relevant files (Tier 2) over regular files", () => {
    const files = [
      makeCodeFile("src/regular.ts", 100),
      makeCodeFile("src/auth/login.ts", 100),
      makeCodeFile("src/crypto/hash.ts", 100),
      makeCodeFile("src/components/button.ts", 100),
    ];
    const selected = selectAndBudgetFiles(files, 300);
    // Tier 2: auth/login.ts + crypto/hash.ts. Tier 3: regular + button sorted by size (same size)
    expect(selected).toHaveLength(3);
    expect(selected[0]!.path).toBe("src/auth/login.ts");
    expect(selected[1]!.path).toBe("src/crypto/hash.ts");
  });

  it("sorts Tier 3 files by size descending", () => {
    const files = [
      makeCodeFile("src/small.ts", 50),
      makeCodeFile("src/large.ts", 200),
      makeCodeFile("src/medium.ts", 100),
    ];
    const selected = selectAndBudgetFiles(files, 10000);
    // All tier 3, sorted by token count desc
    expect(selected[0]!.path).toBe("src/large.ts");
    expect(selected[1]!.path).toBe("src/medium.ts");
    expect(selected[2]!.path).toBe("src/small.ts");
  });

  it("handles empty file list", () => {
    const selected = selectAndBudgetFiles([], 10000);
    expect(selected).toEqual([]);
  });

  it("handles zero token budget", () => {
    const files = [makeCodeFile("src/file.ts", 100)];
    const selected = selectAndBudgetFiles(files, 0);
    expect(selected).toEqual([]);
  });

  it("matches security patterns in file paths", () => {
    const securityFiles = [
      "src/auth.ts", "src/crypto.ts", "src/token.ts",
      "src/session.ts", "src/password.ts", "src/secret.ts",
      "src/validate.ts", "src/sanitize.ts", "src/escape.ts",
      "src/permission.ts", "src/role.ts", "src/login.ts",
    ];
    const files = securityFiles.map((p) => makeCodeFile(p, 10));
    const nonSecFile = makeCodeFile("src/utils.ts", 10);

    const selected = selectAndBudgetFiles([nonSecFile, ...files], 10000);
    // All security files should come before utils.ts
    const utilsIndex = selected.findIndex((f) => f.path === "src/utils.ts");
    expect(utilsIndex).toBe(selected.length - 1);
  });
});

// ── computeAuditHash ─────────────────────────────────────────────────

describe("computeAuditHash", () => {
  it("returns a sha256-prefixed hash", () => {
    const files: CodeFile[] = [
      { path: "src/index.ts", content: "hello", tokens: 2 },
    ];
    const hash = computeAuditHash(files);
    expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("produces identical hash for same files", () => {
    const files: CodeFile[] = [
      { path: "src/a.ts", content: "aaa", tokens: 1 },
      { path: "src/b.ts", content: "bbb", tokens: 1 },
    ];
    const hash1 = computeAuditHash(files);
    const hash2 = computeAuditHash(files);
    expect(hash1).toBe(hash2);
  });

  it("produces identical hash regardless of file order (deterministic)", () => {
    const filesAB: CodeFile[] = [
      { path: "src/a.ts", content: "aaa", tokens: 1 },
      { path: "src/b.ts", content: "bbb", tokens: 1 },
    ];
    const filesBA: CodeFile[] = [
      { path: "src/b.ts", content: "bbb", tokens: 1 },
      { path: "src/a.ts", content: "aaa", tokens: 1 },
    ];
    expect(computeAuditHash(filesAB)).toBe(computeAuditHash(filesBA));
  });

  it("produces different hash when file content changes", () => {
    const files1: CodeFile[] = [
      { path: "src/a.ts", content: "original", tokens: 2 },
    ];
    const files2: CodeFile[] = [
      { path: "src/a.ts", content: "modified", tokens: 2 },
    ];
    expect(computeAuditHash(files1)).not.toBe(computeAuditHash(files2));
  });

  it("produces different hash when a file is added", () => {
    const files1: CodeFile[] = [
      { path: "src/a.ts", content: "aaa", tokens: 1 },
    ];
    const files2: CodeFile[] = [
      { path: "src/a.ts", content: "aaa", tokens: 1 },
      { path: "src/b.ts", content: "bbb", tokens: 1 },
    ];
    expect(computeAuditHash(files1)).not.toBe(computeAuditHash(files2));
  });

  it("throws AuditValidationError for empty file list (fix-empty-audit)", () => {
    expect(() => computeAuditHash([])).toThrow(AuditValidationError);
    expect(() => computeAuditHash([])).toThrow(/zero files/);
  });

  it("even whitespace changes produce different hash", () => {
    const files1: CodeFile[] = [
      { path: "src/a.ts", content: "hello world", tokens: 3 },
    ];
    const files2: CodeFile[] = [
      { path: "src/a.ts", content: "hello  world", tokens: 3 },
    ];
    expect(computeAuditHash(files1)).not.toBe(computeAuditHash(files2));
  });
});

// ── generateAuditPrompt ──────────────────────────────────────────────

describe("generateAuditPrompt", () => {
  function makeAuditContext(overrides?: Partial<AuditContext>): AuditContext {
    return {
      config: {
        version: "0.3.0",
        project: { name: "test", description: "Test project", stack: "TypeScript", conventions: [] },
        security: { posture: "standard" },
        memory: { backend: "local" },
      } as VtspecConfig,
      changeName: "test-change",
      specContent: "# Spec\n## Requirement 1\nImplement authentication",
      reviewContent: "# Review\n## Abuse Cases",
      abuseCases: [],
      codeFiles: [
        { path: "src/auth.ts", content: "export function login() {}", tokens: 7 },
      ],
      ...overrides,
    };
  }

  it("returns an AuditPrompt with all required fields", () => {
    const prompt = generateAuditPrompt(makeAuditContext());
    expect(prompt.system_instructions).toBeTruthy();
    expect(prompt.analysis_request).toBeTruthy();
    expect(prompt.output_schema).toBeTruthy();
    expect(prompt.context).toBeTruthy();
  });

  it("includes spec content in analysis_request", () => {
    const ctx = makeAuditContext({ specContent: "## Authentication\nMust validate JWT tokens" });
    const prompt = generateAuditPrompt(ctx);
    expect(prompt.analysis_request).toContain("## Authentication");
    expect(prompt.analysis_request).toContain("Must validate JWT tokens");
  });

  it("includes code files in analysis_request", () => {
    const ctx = makeAuditContext({
      codeFiles: [
        { path: "src/auth.ts", content: "function login() { return true; }", tokens: 10 },
      ],
    });
    const prompt = generateAuditPrompt(ctx);
    expect(prompt.analysis_request).toContain("src/auth.ts");
    expect(prompt.analysis_request).toContain("function login()");
  });

  it("includes abuse cases in analysis_request when present", () => {
    const ctx = makeAuditContext({
      abuseCases: [
        {
          id: "AC-001",
          severity: "high",
          title: "SQL Injection",
          attacker_goal: "inject SQL",
          technique: "concatenation",
          preconditions: [],
          impact: "data leak",
          mitigation: "parameterized queries",
          stride_category: "Tampering",
          testable: true,
        },
      ],
    });
    const prompt = generateAuditPrompt(ctx);
    expect(prompt.analysis_request).toContain("AC-001");
    expect(prompt.analysis_request).toContain("inject SQL");
  });

  it("handles missing abuse cases gracefully", () => {
    const ctx = makeAuditContext({ abuseCases: [] });
    const prompt = generateAuditPrompt(ctx);
    expect(prompt.analysis_request).toContain("No abuse cases");
  });

  it("includes design content when present", () => {
    const ctx = makeAuditContext({ designContent: "## Architecture\nUsing microservices" });
    const prompt = generateAuditPrompt(ctx);
    expect(prompt.analysis_request).toContain("## Architecture Design");
    expect(prompt.analysis_request).toContain("Using microservices");
  });

  it("includes proposal content when present", () => {
    const ctx = makeAuditContext({ proposalContent: "## Intent\nRefactor auth" });
    const prompt = generateAuditPrompt(ctx);
    expect(prompt.analysis_request).toContain("## Proposal");
    expect(prompt.analysis_request).toContain("Refactor auth");
  });

  it("populates context fields correctly", () => {
    const ctx = makeAuditContext();
    const prompt = generateAuditPrompt(ctx);
    expect(prompt.context.project_description).toBe("Test project");
    expect(prompt.context.stack).toBe("TypeScript");
    expect(prompt.context.change_name).toBe("test-change");
    expect(prompt.context.spec_content).toBeTruthy();
  });

  it("output_schema requires requirements, abuse_cases, and summary", () => {
    const prompt = generateAuditPrompt(makeAuditContext());
    const schema = prompt.output_schema as Record<string, unknown>;
    expect(schema.required).toContain("requirements");
    expect(schema.required).toContain("abuse_cases");
    expect(schema.required).toContain("summary");
  });

  it("system_instructions mention verification methodology", () => {
    const prompt = generateAuditPrompt(makeAuditContext());
    expect(prompt.system_instructions).toContain("verify");
    expect(prompt.system_instructions).toContain("requirement");
    expect(prompt.system_instructions).toContain("abuse case");
  });

  it("works with all three postures", () => {
    for (const posture of ["standard", "elevated", "paranoid"] as const) {
      const ctx = makeAuditContext({
        config: {
          version: "0.3.0",
          project: { name: "test", description: "Test", stack: "TS", conventions: [] },
          security: { posture },
          memory: { backend: "local" },
        } as VtspecConfig,
      });
      const prompt = generateAuditPrompt(ctx);
      expect(prompt.system_instructions).toBeTruthy();
    }
  });
});

// ── renderAuditMarkdown ──────────────────────────────────────────────

describe("renderAuditMarkdown", () => {
  function makeAuditResult(overrides?: Partial<AuditResult>): AuditResult {
    return {
      change: "auth-refactor",
      posture: "standard",
      timestamp: "2025-04-05T12:00:00.000Z",
      spec_hash: "sha256:spec123",
      audit_hash: "sha256:audit456",
      requirements: [
        {
          requirement_id: "REQ-001",
          verdict: "pass",
          evidence: "Validation found",
          code_references: ["src/auth.ts:10"],
          gaps: [],
          notes: "",
        },
      ],
      abuse_cases: [],
      summary: {
        overall_verdict: "pass",
        requirements_coverage: { total: 1, passed: 1, failed: 0, partial: 0, skipped: 0 },
        abuse_cases_coverage: { total: 0, verified: 0, unverified: 0, partial: 0, not_applicable: 0 },
        risk_level: "low",
        recommendations: [],
      },
      ...overrides,
    };
  }

  it("produces markdown with YAML frontmatter", () => {
    const md = renderAuditMarkdown(makeAuditResult());
    expect(md).toMatch(/^---\n/);
    expect(md).toContain('change: "auth-refactor"');
    expect(md).toContain('posture: "standard"');
    expect(md).toContain('overall_verdict: "pass"');
    expect(md).toContain('audit_hash: "sha256:audit456"');
    expect(md).toContain('spec_hash: "sha256:spec123"');
  });

  it("renders title with change name", () => {
    const md = renderAuditMarkdown(makeAuditResult());
    expect(md).toContain("# Spec Audit: auth-refactor");
  });

  it("renders Requirements Verification section", () => {
    const md = renderAuditMarkdown(makeAuditResult());
    expect(md).toContain("## Requirements Verification");
    expect(md).toContain("REQ-001");
    expect(md).toContain("pass");
  });

  it("renders Abuse Case Verification section", () => {
    const md = renderAuditMarkdown(makeAuditResult());
    expect(md).toContain("## Abuse Case Verification");
  });

  it("shows 'No abuse cases from review.' when abuse_cases is empty", () => {
    const md = renderAuditMarkdown(makeAuditResult({ abuse_cases: [] }));
    expect(md).toContain("No abuse cases from review.");
  });

  it("renders abuse cases when present", () => {
    const md = renderAuditMarkdown(makeAuditResult({
      abuse_cases: [
        {
          abuse_case_id: "AC-001",
          verdict: "verified",
          evidence: "Parameterized queries used",
          code_references: ["src/db.ts:15"],
          gaps: [],
          risk_if_unaddressed: "",
        },
        {
          abuse_case_id: "AC-002",
          verdict: "unverified",
          evidence: "",
          code_references: [],
          gaps: ["No session regeneration"],
          risk_if_unaddressed: "Session fixation possible",
        },
      ],
      summary: {
        overall_verdict: "partial",
        requirements_coverage: { total: 1, passed: 1, failed: 0, partial: 0, skipped: 0 },
        abuse_cases_coverage: { total: 2, verified: 1, unverified: 1, partial: 0, not_applicable: 0 },
        risk_level: "medium",
        recommendations: ["Fix session regeneration"],
      },
    }));
    expect(md).toContain("AC-001");
    expect(md).toContain("AC-002");
    expect(md).toContain("verified");
    expect(md).toContain("unverified");
    expect(md).toContain("Session fixation possible");
  });

  it("renders Security Posture Assessment section", () => {
    const md = renderAuditMarkdown(makeAuditResult());
    expect(md).toContain("## Security Posture Assessment");
    expect(md).toContain("Requirements");
    expect(md).toContain("Abuse Cases");
    expect(md).toContain("Risk Level");
    expect(md).toContain("Overall Verdict");
  });

  it("renders Recommendations section", () => {
    const md = renderAuditMarkdown(makeAuditResult({
      summary: {
        overall_verdict: "fail",
        requirements_coverage: { total: 2, passed: 1, failed: 1, partial: 0, skipped: 0 },
        abuse_cases_coverage: { total: 0, verified: 0, unverified: 0, partial: 0, not_applicable: 0 },
        risk_level: "high",
        recommendations: ["Add rate limiting", "Fix input validation"],
      },
    }));
    expect(md).toContain("## Recommendations");
    expect(md).toContain("- [ ] Add rate limiting");
    expect(md).toContain("- [ ] Fix input validation");
  });

  it("renders 'No recommendations' when list is empty", () => {
    const md = renderAuditMarkdown(makeAuditResult());
    expect(md).toContain("No recommendations");
  });

  it("renders requirement verdict emojis correctly", () => {
    const md = renderAuditMarkdown(makeAuditResult({
      requirements: [
        { requirement_id: "R-1", verdict: "pass", evidence: "found", code_references: [], gaps: [], notes: "" },
        { requirement_id: "R-2", verdict: "fail", evidence: "missing", code_references: [], gaps: [], notes: "" },
        { requirement_id: "R-3", verdict: "partial", evidence: "some", code_references: [], gaps: [], notes: "" },
        { requirement_id: "R-4", verdict: "skipped", evidence: "", code_references: [], gaps: [], notes: "" },
      ],
      summary: {
        overall_verdict: "partial",
        requirements_coverage: { total: 4, passed: 1, failed: 1, partial: 1, skipped: 1 },
        abuse_cases_coverage: { total: 0, verified: 0, unverified: 0, partial: 0, not_applicable: 0 },
        risk_level: "medium",
        recommendations: [],
      },
    }));
    expect(md).toContain("\u{1F7E2}"); // 🟢 pass
    expect(md).toContain("\u{1F534}"); // 🔴 fail
    expect(md).toContain("\u{1F7E1}"); // 🟡 partial
    expect(md).toContain("\u{26AA}");  // ⚪ skipped
  });

  it("renders requirement details (evidence, code_references, gaps, notes)", () => {
    const md = renderAuditMarkdown(makeAuditResult({
      requirements: [
        {
          requirement_id: "REQ-001",
          verdict: "partial",
          evidence: "Found validation on 3 of 5 endpoints",
          code_references: ["src/routes.ts:10", "src/routes.ts:25"],
          gaps: ["Missing validation on /api/upload", "Missing validation on /api/delete"],
          notes: "Using Zod for schema validation",
        },
      ],
      summary: {
        overall_verdict: "partial",
        requirements_coverage: { total: 1, passed: 0, failed: 0, partial: 1, skipped: 0 },
        abuse_cases_coverage: { total: 0, verified: 0, unverified: 0, partial: 0, not_applicable: 0 },
        risk_level: "medium",
        recommendations: [],
      },
    }));
    expect(md).toContain("Found validation on 3 of 5 endpoints");
    expect(md).toContain("src/routes.ts:10, src/routes.ts:25");
    expect(md).toContain("Missing validation on /api/upload");
    expect(md).toContain("Using Zod for schema validation");
  });

  it("frontmatter includes requirements_coverage and abuse_cases_coverage", () => {
    const md = renderAuditMarkdown(makeAuditResult({
      summary: {
        overall_verdict: "partial",
        requirements_coverage: { total: 5, passed: 3, failed: 1, partial: 1, skipped: 0 },
        abuse_cases_coverage: { total: 3, verified: 2, unverified: 1, partial: 0, not_applicable: 0 },
        risk_level: "medium",
        recommendations: [],
      },
    }));
    expect(md).toContain("  total: 5");
    expect(md).toContain("  passed: 3");
    expect(md).toContain("  failed: 1");
    expect(md).toContain("  verified: 2");
    expect(md).toContain("  unverified: 1");
  });

  it("YAML frontmatter is parseable", () => {
    const md = renderAuditMarkdown(makeAuditResult());
    const fmMatch = md.match(/^---\n([\s\S]*?)\n---/);
    expect(fmMatch).toBeTruthy();
    // Basic check: contains key-value pairs
    expect(fmMatch![1]).toContain("change:");
    expect(fmMatch![1]).toContain("timestamp:");
    expect(fmMatch![1]).toContain("overall_verdict:");
  });
});

// ── parseAbuseCasesFromReview ────────────────────────────────────────

describe("parseAbuseCasesFromReview", () => {
  it("parses abuse cases from well-formed review markdown", () => {
    const review = `## Abuse Cases

| ID | Severity | Goal | STRIDE |
|----|----------|------|--------|

### AC-001: SQL Injection via user input

- **Severity**: \u{1F534} critical
- **Goal**: Inject malicious SQL queries
- **Technique**: String concatenation in SQL queries
- **Preconditions**: Unvalidated user input
- **Impact**: Full database compromise
- **Mitigation**: Use parameterized queries
- **STRIDE**: Tampering
- **Testable**: Yes
- **Test Hint**: Send a single quote in input fields

### AC-002: Session Fixation

- **Severity**: \u{1F7E0} high
- **Goal**: Hijack user sessions
- **Technique**: Force known session ID before login
- **Preconditions**: Session not regenerated on login
- **Impact**: Account takeover
- **Mitigation**: Regenerate session ID after authentication
- **STRIDE**: Spoofing
- **Testable**: No

## Mitigations Required
`;

    const abuseCases = parseAbuseCasesFromReview(review);
    expect(abuseCases).toHaveLength(2);

    expect(abuseCases[0]!.id).toBe("AC-001");
    expect(abuseCases[0]!.title).toBe("SQL Injection via user input");
    expect(abuseCases[0]!.severity).toBe("critical");
    expect(abuseCases[0]!.attacker_goal).toBe("Inject malicious SQL queries");
    expect(abuseCases[0]!.technique).toBe("String concatenation in SQL queries");
    expect(abuseCases[0]!.mitigation).toBe("Use parameterized queries");
    expect(abuseCases[0]!.stride_category).toBe("Tampering");
    expect(abuseCases[0]!.testable).toBe(true);
    expect(abuseCases[0]!.test_hint).toBe("Send a single quote in input fields");

    expect(abuseCases[1]!.id).toBe("AC-002");
    expect(abuseCases[1]!.severity).toBe("high");
    expect(abuseCases[1]!.testable).toBe(false);
    expect(abuseCases[1]!.test_hint).toBeUndefined();
  });

  it("returns empty array for empty content", () => {
    expect(parseAbuseCasesFromReview("")).toEqual([]);
  });

  it("returns empty array for review without abuse cases section", () => {
    const review = `# Security Review
## STRIDE Analysis
Some findings here.
## Mitigations Required
- Fix auth
`;
    expect(parseAbuseCasesFromReview(review)).toEqual([]);
  });

  it("returns empty array for malformed review content", () => {
    expect(parseAbuseCasesFromReview("not a review at all {}[]")).toEqual([]);
  });

  it("handles preconditions with semicolons", () => {
    const review = `### AC-001: Test

- **Severity**: medium
- **Goal**: Test goal
- **Technique**: Test technique
- **Preconditions**: Cond 1; Cond 2; Cond 3
- **Impact**: Test impact
- **Mitigation**: Test mitigation
- **STRIDE**: Tampering
- **Testable**: No

## Done
`;
    const abuseCases = parseAbuseCasesFromReview(review);
    expect(abuseCases).toHaveLength(1);
    expect(abuseCases[0]!.preconditions).toEqual(["Cond 1", "Cond 2", "Cond 3"]);
  });

  it("handles 'None' preconditions", () => {
    const review = `### AC-001: Test

- **Severity**: low
- **Goal**: Test
- **Technique**: Test
- **Preconditions**: None
- **Impact**: None
- **Mitigation**: None
- **STRIDE**: Unknown
- **Testable**: No

## End
`;
    const abuseCases = parseAbuseCasesFromReview(review);
    expect(abuseCases[0]!.preconditions).toEqual([]);
  });

  it("defaults severity to medium for unknown values", () => {
    const review = `### AC-001: Test

- **Severity**: extreme
- **Goal**: Test
- **Technique**: Test
- **Preconditions**: None
- **Impact**: None
- **Mitigation**: None
- **STRIDE**: Unknown
- **Testable**: No

## End
`;
    const abuseCases = parseAbuseCasesFromReview(review);
    expect(abuseCases[0]!.severity).toBe("medium");
  });
});

// ── Phase 5: Staleness Detection ─────────────────────────────────────

describe("isAuditStale", () => {
  it("returns true when no stored hash exists (never audited)", () => {
    expect(isAuditStale(undefined, "sha256:current")).toBe(true);
  });

  it("returns false when hashes match (fresh audit)", () => {
    expect(isAuditStale("sha256:abc123", "sha256:abc123")).toBe(false);
  });

  it("returns true when hashes differ (code changed)", () => {
    expect(isAuditStale("sha256:old", "sha256:new")).toBe(true);
  });
});
