/**
 * End-to-end workflow tests.
 *
 * Tests complete flows: init → propose → spec → review → tasks → done
 * Tests shortcuts: new, ff, continue
 * Tests error paths: missing review, stale review
 * Tests Alejandria graceful degradation
 *
 * Spec refs: Cross-Domain Constraints (all 5)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { handleInit } from "../../src/tools/init.js";
import { handlePropose } from "../../src/tools/propose.js";
import { handleSpec } from "../../src/tools/spec.js";
import { handleReview } from "../../src/tools/review.js";
import { handleTasks } from "../../src/tools/tasks.js";
import { handleDone } from "../../src/tools/done.js";
import { handleContinue } from "../../src/tools/continue.js";
import { handleFf } from "../../src/tools/ff.js";
import { computeSpecHash } from "../../src/services/cache.js";

let tmpDir: string;

const SAMPLE_REQUIREMENTS = [
  {
    name: "User authentication",
    description: "Implement user login with email and password",
    scenarios: [
      {
        name: "Successful login",
        given: "a registered user with valid credentials",
        when: "the user submits the login form",
        then: "the user receives an auth token and is redirected",
      },
      {
        name: "Invalid password",
        given: "a registered user with wrong password",
        when: "the user submits the login form",
        then: "an error message is shown and no token is issued",
      },
    ],
  },
  {
    name: "Session management",
    description: "Handle user sessions with JWT tokens",
    scenarios: [
      {
        name: "Token expiration",
        given: "an expired JWT token",
        when: "the user makes an API request",
        then: "a 401 response is returned",
      },
    ],
  },
];

function makeReviewResult(changeName: string, specHash: string) {
  return {
    change: changeName,
    posture: "standard",
    timestamp: new Date().toISOString(),
    spec_hash: specHash,
    stride: {
      spoofing: {
        applicable: true,
        threats: [{
          id: "S-01",
          title: "Credential stuffing",
          description: "Automated attacks using stolen credentials",
          severity: "high",
          mitigation: "Implement rate limiting and account lockout",
          affected_components: ["auth", "login"],
        }],
      },
      tampering: {
        applicable: true,
        threats: [{
          id: "T-01",
          title: "JWT token manipulation",
          description: "Attacker modifies JWT payload",
          severity: "medium",
          mitigation: "Use strong signing algorithm (RS256)",
          affected_components: ["session"],
        }],
      },
      repudiation: { applicable: false, threats: [] },
      information_disclosure: { applicable: false, threats: [] },
      denial_of_service: { applicable: false, threats: [] },
      elevation_of_privilege: { applicable: false, threats: [] },
    },
    summary: {
      risk_level: "medium",
      total_findings: 2,
      critical_findings: 0,
      mitigations_required: [
        "Implement rate limiting and account lockout",
        "Use strong signing algorithm (RS256)",
      ],
    },
  };
}

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "specia-e2e-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("E2E: Full workflow — init → propose → spec → review → tasks → done", () => {
  it("completes the entire workflow end-to-end", async () => {
    // ── 1. Init ──
    const initResult = await handleInit({
      project_description: "Authentication microservice for the platform",
      primary_stack: "TypeScript/Node.js",
      conventions: ["Use vitest for testing"],
      security_posture: "standard",
    }, tmpDir);
    expect(initResult.status).toBe("success");
    expect(fs.existsSync(path.join(tmpDir, ".specia", "config.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".specia", "context.md"))).toBe(true);

    // ── 2. Propose ──
    const proposeResult = await handlePropose({
      change_name: "auth-system",
      intent: "Implement user authentication with JWT tokens",
      scope: ["auth", "session", "middleware"],
      approach: "Use bcrypt for password hashing, JWT for sessions",
      skip_audit: true, // Opt out of audit for this e2e flow test
    }, tmpDir);
    expect(proposeResult.status).toBe("success");
    expect(proposeResult.data!.change_name).toBe("auth-system");

    // ── 3. Spec ──
    const specResult = await handleSpec({
      change_name: "auth-system",
      requirements: SAMPLE_REQUIREMENTS,
    }, tmpDir);
    expect(specResult.status).toBe("success");
    expect(specResult.data!.requirements_count).toBe(2);
    expect(specResult.data!.scenarios_count).toBe(3);

    // ── 4. Review (two-phase) ──
    // Phase 1: get prompt
    const reviewPromptResult = await handleReview({
      change_name: "auth-system",
    }, tmpDir);
    expect(reviewPromptResult.status).toBe("success");
    expect(reviewPromptResult.data).toHaveProperty("review_prompt");
    expect(reviewPromptResult.data).toHaveProperty("spec_hash");

    // Phase 2: submit review result
    const specHash = (reviewPromptResult.data as { spec_hash: string }).spec_hash;
    const reviewResult = await handleReview({
      change_name: "auth-system",
      review_result: makeReviewResult("auth-system", specHash),
    }, tmpDir);
    expect(reviewResult.status).toBe("success");
    expect((reviewResult.data as { findings_count: number }).findings_count).toBe(2);

    // ── 5. Tasks ──
    const tasksResult = await handleTasks({
      change_name: "auth-system",
    }, tmpDir);
    expect(tasksResult.status).toBe("success");
    expect(tasksResult.data!.spec_requirements_used).toBe(true);
    expect(tasksResult.data!.review_findings_used).toBe(true);

    // Verify tasks.md contains mitigation tasks
    const tasksContent = fs.readFileSync(
      path.join(tmpDir, ".specia", "changes", "auth-system", "tasks.md"),
      "utf-8",
    );
    expect(tasksContent).toContain("rate limiting");

    // ── 6. Done ──
    const doneResult = await handleDone({
      change_name: "auth-system",
    }, tmpDir);
    expect(doneResult.status).toBe("success");
    expect(doneResult.data!.archived_path).toBe(".specia/specs/auth-system.md");

    // Verify archive
    const archivedPath = path.join(tmpDir, ".specia", "specs", "auth-system.md");
    expect(fs.existsSync(archivedPath)).toBe(true);
    const archived = fs.readFileSync(archivedPath, "utf-8");
    expect(archived).toContain("auth-system");

    // Verify change directory is cleaned up
    expect(fs.existsSync(path.join(tmpDir, ".specia", "changes", "auth-system"))).toBe(false);
  });
});

describe("E2E: Cross-domain constraint — Security Review is Mandatory", () => {
  it("specia_tasks refuses without review (REVIEW_REQUIRED)", async () => {
    await handleInit({ project_description: "Test" }, tmpDir);
    await handlePropose({
      change_name: "no-review",
      intent: "Skip review attempt",
      scope: ["area"],
    }, tmpDir);
    await handleSpec({
      change_name: "no-review",
      requirements: SAMPLE_REQUIREMENTS,
    }, tmpDir);

    // Try to generate tasks without review
    const result = await handleTasks({
      change_name: "no-review",
    }, tmpDir);

    expect(result.status).toBe("error");
    expect(result.errors[0]!.code).toBe("REVIEW_REQUIRED");
  });

  it("specia_tasks refuses with stale review (REVIEW_STALE)", async () => {
    await handleInit({ project_description: "Test" }, tmpDir);
    await handlePropose({
      change_name: "stale-review",
      intent: "Test stale review",
      scope: ["area"],
    }, tmpDir);
    await handleSpec({
      change_name: "stale-review",
      requirements: SAMPLE_REQUIREMENTS,
    }, tmpDir);

    // Get spec hash and do review
    const specPath = path.join(tmpDir, ".specia", "changes", "stale-review", "spec.md");
    const specContent = fs.readFileSync(specPath, "utf-8");
    const specHash = computeSpecHash(specContent);

    await handleReview({
      change_name: "stale-review",
      review_result: makeReviewResult("stale-review", specHash),
    }, tmpDir);

    // Now modify the spec (making the review stale)
    await handleSpec({
      change_name: "stale-review",
      requirements: [
        ...SAMPLE_REQUIREMENTS,
        {
          name: "New requirement added after review",
          description: "This makes the review stale",
          scenarios: [{
            name: "Test",
            given: "something",
            when: "changed",
            then: "review should be stale",
          }],
        },
      ],
    }, tmpDir);

    // Now try to generate tasks — should fail with REVIEW_STALE
    const result = await handleTasks({
      change_name: "stale-review",
    }, tmpDir);

    expect(result.status).toBe("error");
    expect(result.errors[0]!.code).toBe("REVIEW_STALE");
  });
});

describe("E2E: Phase DAG enforcement", () => {
  it("specia_spec refuses without proposal", async () => {
    await handleInit({ project_description: "Test" }, tmpDir);

    const result = await handleSpec({
      change_name: "no-proposal",
      requirements: SAMPLE_REQUIREMENTS,
    }, tmpDir);

    expect(result.status).toBe("error");
    expect(result.errors[0]!.code).toBe("MISSING_DEPENDENCY");
    expect(result.errors[0]!.dependency).toBe("proposal");
  });

  it("specia_review refuses without spec", async () => {
    await handleInit({ project_description: "Test" }, tmpDir);
    await handlePropose({
      change_name: "no-spec",
      intent: "test",
      scope: ["a"],
    }, tmpDir);

    const result = await handleReview({
      change_name: "no-spec",
    }, tmpDir);

    expect(result.status).toBe("error");
    expect(result.errors[0]!.code).toBe("MISSING_DEPENDENCY");
  });

  it("specia_done refuses incomplete change", async () => {
    await handleInit({ project_description: "Test" }, tmpDir);
    await handlePropose({
      change_name: "incomplete",
      intent: "test",
      scope: ["a"],
    }, tmpDir);

    const result = await handleDone({
      change_name: "incomplete",
    }, tmpDir);

    expect(result.status).toBe("error");
    expect(result.errors[0]!.code).toBe("INCOMPLETE_CHANGE");
  });
});

describe("E2E: Structured JSON output on all tools", () => {
  it("all tool responses have correct envelope structure", async () => {
    await handleInit({ project_description: "Test" }, tmpDir);

    const responses = [
      await handlePropose({ change_name: "json-test", intent: "test", scope: ["a"] }, tmpDir),
      await handleSpec({ change_name: "json-test", requirements: SAMPLE_REQUIREMENTS }, tmpDir),
      await handleContinue({ change_name: "json-test" }, tmpDir),
    ];

    for (const resp of responses) {
      // Every response has the envelope shape
      expect(resp).toHaveProperty("status");
      expect(resp).toHaveProperty("data");
      expect(resp).toHaveProperty("errors");
      expect(resp).toHaveProperty("warnings");
      expect(resp).toHaveProperty("meta");
      expect(resp.meta).toHaveProperty("tool");
      expect(typeof resp.meta.duration_ms).toBe("number");
      expect(["success", "error", "cached"]).toContain(resp.status);

      if (resp.status === "success") {
        expect(resp.data).not.toBeNull();
        expect(resp.errors).toHaveLength(0);
      }
      if (resp.status === "error") {
        expect(resp.errors.length).toBeGreaterThan(0);
        expect(resp.errors[0]).toHaveProperty("code");
        expect(resp.errors[0]).toHaveProperty("message");
      }
    }
  });
});

describe("E2E: File-first architecture — works without Alejandria", () => {
  it("complete workflow succeeds with memory_backend: local", async () => {
    const initResult = await handleInit({
      project_description: "Test project without Alejandria",
      memory_backend: "local",
    }, tmpDir);
    expect(initResult.status).toBe("success");

    // The entire workflow should work without Alejandria
    await handlePropose({
      change_name: "local-only",
      intent: "Test local-only flow",
      scope: ["area"],
    }, tmpDir);

    await handleSpec({
      change_name: "local-only",
      requirements: SAMPLE_REQUIREMENTS,
    }, tmpDir);

    const specPath = path.join(tmpDir, ".specia", "changes", "local-only", "spec.md");
    const specContent = fs.readFileSync(specPath, "utf-8");
    const specHash = computeSpecHash(specContent);

    await handleReview({
      change_name: "local-only",
      review_result: makeReviewResult("local-only", specHash),
    }, tmpDir);

    const tasksResult = await handleTasks({
      change_name: "local-only",
    }, tmpDir);
    expect(tasksResult.status).toBe("success");

    // No warnings about Alejandria since backend is "local"
    expect(tasksResult.warnings).not.toContain(
      expect.stringContaining("alejandria"),
    );
  });
});

describe("E2E: Shortcut tools", () => {
  it("specia_new creates a proposal (alias for specia_propose)", async () => {
    await handleInit({ project_description: "Test" }, tmpDir);

    // specia_new uses the same handler as specia_propose
    const result = await handlePropose({
      change_name: "new-change",
      intent: "Created via specia_new",
      scope: ["feature"],
    }, tmpDir);

    expect(result.status).toBe("success");
    expect(result.data!.change_name).toBe("new-change");
  });

  it("specia_continue navigates through the full workflow", async () => {
    await handleInit({ project_description: "Test" }, tmpDir);
    await handlePropose({
      change_name: "cont-test",
      intent: "Test continue",
      scope: ["area"],
    }, tmpDir);

    // Continue after proposal → should recommend spec
    let result = await handleContinue({ change_name: "cont-test" }, tmpDir);
    expect(result.status).toBe("success");
    expect(result.data).toHaveProperty("next_tool", "specia_spec");

    // Do spec, then continue → should recommend design (optional, v0.2)
    await handleSpec({
      change_name: "cont-test",
      requirements: SAMPLE_REQUIREMENTS,
    }, tmpDir);

    result = await handleContinue({ change_name: "cont-test" }, tmpDir);
    expect(result.status).toBe("success");
    expect(result.data).toHaveProperty("next_tool", "specia_design");
    expect(result.data).toHaveProperty("optional", true);
  });

  it("specia_ff runs multiple phases and stops at LLM-required step", async () => {
    await handleInit({ project_description: "Test" }, tmpDir);

    const result = await handleFf({
      change_name: "ff-flow",
      intent: "Test fast-forward",
      scope: ["area"],
    }, tmpDir);

    expect(result.status).toBe("success");
    // ff should complete propose, then stop at spec (needs LLM input)
    expect((result.data as { phases_completed: string[] }).phases_completed).toContain("proposal");
    expect(result.data).toHaveProperty("stopped_at", "spec");
  });
});
