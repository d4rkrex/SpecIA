/**
 * Zod schema validation tests.
 *
 * Spec refs: Domain 9 (Validation error with field info),
 *            Domain 10 (Missing required fields, Team size NOT asked)
 */

import { describe, it, expect } from "vitest";
import {
  InitInputSchema,
  ProposeInputSchema,
  SpecInputSchema,
  ReviewInputSchema,
  TasksInputSchema,
  DoneInputSchema,
  NewInputSchema,
  ContinueInputSchema,
  FfInputSchema,
  AuditInputSchema,
} from "../../src/tools/schemas.js";

// ── InitInputSchema ──────────────────────────────────────────────────

describe("InitInputSchema", () => {
  it("accepts valid full input", () => {
    const result = InitInputSchema.safeParse({
      project_description: "A web API for payments",
      primary_stack: "TypeScript/Node.js",
      conventions: ["vitest", "ESM"],
      security_posture: "elevated",
      memory_backend: "alejandria",
    });
    expect(result.success).toBe(true);
  });

  it("applies defaults for optional fields", () => {
    const result = InitInputSchema.safeParse({
      project_description: "My project",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.conventions).toEqual([]);
      expect(result.data.security_posture).toBe("standard");
      expect(result.data.memory_backend).toBe("local");
    }
  });

  it("rejects missing project_description", () => {
    const result = InitInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects invalid security_posture", () => {
    const result = InitInputSchema.safeParse({
      project_description: "x",
      security_posture: "relaxed",
    });
    expect(result.success).toBe(false);
  });

  it("does NOT accept team_size (Cross-Domain constraint)", () => {
    const result = InitInputSchema.safeParse({
      project_description: "x",
      team_size: 5,
    });
    // Zod strict mode is not on, so extra fields are stripped — the key point is
    // team_size is NOT in the schema and would not appear in parsed output.
    if (result.success) {
      expect((result.data as Record<string, unknown>)["team_size"]).toBeUndefined();
    }
  });
});

// ── ProposeInputSchema ───────────────────────────────────────────────

describe("ProposeInputSchema", () => {
  it("accepts valid proposal input", () => {
    const result = ProposeInputSchema.safeParse({
      change_name: "auth-refactor",
      intent: "Refactor authentication to use JWT",
      scope: ["src/auth", "src/middleware"],
      approach: "Replace express-session with jsonwebtoken",
    });
    expect(result.success).toBe(true);
  });

  it("rejects non-kebab-case change name", () => {
    const result = ProposeInputSchema.safeParse({
      change_name: "Auth_Refactor",
      intent: "x",
      scope: ["src/auth"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects change name with uppercase", () => {
    const result = ProposeInputSchema.safeParse({
      change_name: "Auth",
      intent: "x",
      scope: ["src"],
    });
    expect(result.success).toBe(false);
  });

  it("accepts single-word kebab-case name", () => {
    const result = ProposeInputSchema.safeParse({
      change_name: "auth",
      intent: "x",
      scope: ["src"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty scope array", () => {
    const result = ProposeInputSchema.safeParse({
      change_name: "test",
      intent: "x",
      scope: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing intent", () => {
    const result = ProposeInputSchema.safeParse({
      change_name: "test",
      scope: ["src"],
    });
    expect(result.success).toBe(false);
  });
});

// ── SpecInputSchema ──────────────────────────────────────────────────

describe("SpecInputSchema", () => {
  it("accepts valid spec input", () => {
    const result = SpecInputSchema.safeParse({
      change_name: "my-feature",
      requirements: [
        {
          name: "User login",
          description: "Users can log in with email and password",
          scenarios: [
            {
              name: "Valid credentials",
              given: "A registered user",
              when: "They submit valid credentials",
              then: "They receive a JWT token",
            },
          ],
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty requirements array", () => {
    const result = SpecInputSchema.safeParse({
      change_name: "test",
      requirements: [],
    });
    expect(result.success).toBe(false);
  });
});

// ── ReviewInputSchema ────────────────────────────────────────────────

describe("ReviewInputSchema", () => {
  it("accepts minimal review input", () => {
    const result = ReviewInputSchema.safeParse({
      change_name: "my-feature",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.force).toBe(false);
    }
  });

  it("accepts review with result (phase 2)", () => {
    const result = ReviewInputSchema.safeParse({
      change_name: "my-feature",
      review_result: { stride: {}, summary: {} },
    });
    expect(result.success).toBe(true);
  });

  it("accepts force flag", () => {
    const result = ReviewInputSchema.safeParse({
      change_name: "my-feature",
      force: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.force).toBe(true);
    }
  });
});

// ── TasksInputSchema ─────────────────────────────────────────────────

describe("TasksInputSchema", () => {
  it("accepts valid input with defaults", () => {
    const result = TasksInputSchema.safeParse({
      change_name: "my-feature",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.include_mitigations).toBe(true);
    }
  });
});

// ── DoneInputSchema ──────────────────────────────────────────────────

describe("DoneInputSchema", () => {
  it("accepts valid input", () => {
    const result = DoneInputSchema.safeParse({
      change_name: "my-feature",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing change_name", () => {
    const result = DoneInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

// ── Shortcut schemas ─────────────────────────────────────────────────

describe("NewInputSchema", () => {
  it("matches ProposeInputSchema (alias)", () => {
    const result = NewInputSchema.safeParse({
      change_name: "my-feature",
      intent: "Do stuff",
      scope: ["src"],
    });
    expect(result.success).toBe(true);
  });
});

describe("ContinueInputSchema", () => {
  it("accepts change_name only", () => {
    const result = ContinueInputSchema.safeParse({
      change_name: "my-feature",
    });
    expect(result.success).toBe(true);
  });
});

describe("FfInputSchema", () => {
  it("accepts minimal input", () => {
    const result = FfInputSchema.safeParse({
      change_name: "my-feature",
    });
    expect(result.success).toBe(true);
  });

  it("accepts full input with spec content", () => {
    const result = FfInputSchema.safeParse({
      change_name: "my-feature",
      intent: "Do the thing",
      scope: ["src/auth"],
      approach: "Use JWT",
      spec_content: "# Spec\n\n## Requirements",
    });
    expect(result.success).toBe(true);
  });
});

// ── AuditInputSchema (v0.3) ──────────────────────────────────────────

describe("AuditInputSchema", () => {
  it("accepts minimal Phase 1 input with defaults", () => {
    const result = AuditInputSchema.safeParse({
      change_name: "auth-refactor",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.force).toBe(false);
      expect(result.data.max_files).toBe(50);
      expect(result.data.max_tokens).toBe(100000);
      expect(result.data.audit_result).toBeUndefined();
      expect(result.data.files).toBeUndefined();
    }
  });

  it("accepts Phase 2 input with audit_result", () => {
    const result = AuditInputSchema.safeParse({
      change_name: "auth-refactor",
      audit_result: { requirements: [], abuse_cases: [], summary: {} },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.audit_result).toBeTruthy();
    }
  });

  it("accepts force flag", () => {
    const result = AuditInputSchema.safeParse({
      change_name: "my-change",
      force: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.force).toBe(true);
    }
  });

  it("accepts explicit files list", () => {
    const result = AuditInputSchema.safeParse({
      change_name: "my-change",
      files: ["src/auth.ts", "src/middleware.ts"],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.files).toEqual(["src/auth.ts", "src/middleware.ts"]);
    }
  });

  it("accepts custom max_files and max_tokens", () => {
    const result = AuditInputSchema.safeParse({
      change_name: "my-change",
      max_files: 100,
      max_tokens: 200000,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.max_files).toBe(100);
      expect(result.data.max_tokens).toBe(200000);
    }
  });

  it("rejects non-kebab-case change name", () => {
    const result = AuditInputSchema.safeParse({
      change_name: "Auth Refactor",
    });
    expect(result.success).toBe(false);
  });

  it("rejects change name with uppercase", () => {
    const result = AuditInputSchema.safeParse({
      change_name: "AuthRefactor",
    });
    expect(result.success).toBe(false);
  });

  it("rejects max_files exceeding 200", () => {
    const result = AuditInputSchema.safeParse({
      change_name: "foo",
      max_files: 500,
    });
    expect(result.success).toBe(false);
  });

  it("rejects max_files below 1", () => {
    const result = AuditInputSchema.safeParse({
      change_name: "foo",
      max_files: 0,
    });
    expect(result.success).toBe(false);
  });

  it("rejects max_tokens exceeding 500000", () => {
    const result = AuditInputSchema.safeParse({
      change_name: "foo",
      max_tokens: 1000000,
    });
    expect(result.success).toBe(false);
  });

  it("rejects max_tokens below 1000", () => {
    const result = AuditInputSchema.safeParse({
      change_name: "foo",
      max_tokens: 500,
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer max_files", () => {
    const result = AuditInputSchema.safeParse({
      change_name: "foo",
      max_files: 50.5,
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing change_name", () => {
    const result = AuditInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
