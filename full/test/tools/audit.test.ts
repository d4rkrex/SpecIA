/**
 * specia_audit handler unit tests — two-phase audit, caching, error cases.
 *
 * Spec refs: Domain 3 (specia_audit — all scenarios),
 *            Domain 7 (Staleness Detection),
 *            Domain 11 (Alejandria Integration)
 * Design refs: Decision 3 (Two-Phase Audit), Decision 8 (Smart Caching)
 *
 * v0.3: New file for /spec-audit feature Phase 4.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";
import { handleInit } from "../../src/tools/init.js";
import { handlePropose } from "../../src/tools/propose.js";
import { handleSpec } from "../../src/tools/spec.js";
import { handleReview } from "../../src/tools/review.js";
import { handleTasks } from "../../src/tools/tasks.js";
import { handleAudit } from "../../src/tools/audit.js";
import type { AuditPromptResult, AuditCompleteResult } from "../../src/tools/audit.js";

let tmpDir: string;

/** Minimal review result for setting up a reviewed change. */
function makeMinimalReviewResult() {
  return {
    stride: {
      spoofing: {
        applicable: true,
        threats: [
          {
            id: "S-01",
            title: "Token spoofing",
            description: "Attacker forges tokens",
            severity: "high",
            mitigation: "Validate token signatures",
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
    abuse_cases: [
      {
        id: "AC-001",
        severity: "high",
        title: "Token forgery",
        attacker_goal: "Forge JWT tokens",
        technique: "Key brute-force",
        preconditions: ["Weak key"],
        impact: "Full account takeover",
        mitigation: "Use strong keys",
        stride_category: "Spoofing",
        testable: true,
        test_hint: "Try signing with common keys",
      },
    ],
    summary: {
      risk_level: "high",
      total_findings: 1,
      critical_findings: 0,
      mitigations_required: ["Validate token signatures"],
    },
  };
}

/**
 * Create a minimal git repo with a source file so discoverChangedFiles works.
 */
function setupGitRepoWithSourceFile(dir: string) {
  execSync("git init -b main", { cwd: dir, stdio: "pipe" });
  execSync("git config user.email 'test@test.com'", { cwd: dir, stdio: "pipe" });
  execSync("git config user.name 'Test'", { cwd: dir, stdio: "pipe" });
  const srcDir = path.join(dir, "src");
  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(path.join(srcDir, "auth.ts"), "export function login() { return true; }\n");
  execSync("git add -A", { cwd: dir, stdio: "pipe" });
  execSync("git commit -m 'initial'", { cwd: dir, stdio: "pipe" });
  execSync("git checkout -b feature", { cwd: dir, stdio: "pipe" });
  fs.writeFileSync(path.join(srcDir, "auth.ts"), "export function login() { return true; }\nexport function logout() {}\n");
  execSync("git add -A", { cwd: dir, stdio: "pipe" });
  execSync("git commit -m 'add auth feature'", { cwd: dir, stdio: "pipe" });
}

/** Set up a project through the full pipeline: init → propose → spec → review → tasks. */
async function setupProjectWithTasks(dir: string, changeName = "test-change") {
  setupGitRepoWithSourceFile(dir);
  await handleInit({ project_description: "Test project" }, dir);
  await handlePropose(
    { change_name: changeName, intent: "Test intent", scope: ["src/auth"] },
    dir,
  );
  await handleSpec(
    {
      change_name: changeName,
      requirements: [
        {
          name: "Auth",
          description: "Authentication module",
          scenarios: [
            {
              name: "Login",
              given: "valid credentials",
              when: "user logs in",
              then: "token returned",
            },
          ],
        },
      ],
    },
    dir,
  );
  // Submit review (Phase 2 directly)
  await handleReview(
    {
      change_name: changeName,
      review_result: makeMinimalReviewResult(),
    },
    dir,
  );
  // Generate tasks
  await handleTasks(
    { change_name: changeName },
    dir,
  );
}

/** Minimal valid audit result for Phase 2 submission. */
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
    abuse_cases: [
      {
        abuse_case_id: "AC-001",
        verdict: "verified",
        evidence: "Strong key used for JWT signing",
        code_references: ["src/auth/jwt.ts:10"],
        gaps: [],
        risk_if_unaddressed: "",
      },
    ],
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
        total: 1,
        verified: 1,
        unverified: 0,
        partial: 0,
        not_applicable: 0,
      },
      risk_level: "low",
      recommendations: [],
    },
  };
}

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "specia-audit-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── Phase 1: Prompt Generation ──────────────────────────────────────

describe("handleAudit — Phase 1 (prompt generation)", () => {
  it("returns an audit prompt when no audit_result provided", async () => {
    await setupProjectWithTasks(tmpDir);

    const result = await handleAudit(
      { change_name: "test-change" },
      tmpDir,
    );

    expect(result.status).toBe("success");
    expect(result.data).not.toBeNull();

    const data = result.data as AuditPromptResult;
    expect(data.audit_prompt).toBeTruthy();
    expect(data.spec_hash).toBeTruthy();
    expect(data.audit_hash).toBeTruthy();
    expect(data.instructions).toBeTruthy();

    expect(data.audit_prompt.system_instructions).toBeTruthy();
    expect(data.audit_prompt.analysis_request).toBeTruthy();
    expect(data.audit_prompt.output_schema).toBeTruthy();
  });

  it("includes spec_hash and audit_hash in Phase 1 response", async () => {
    await setupProjectWithTasks(tmpDir);

    const result = await handleAudit(
      { change_name: "test-change" },
      tmpDir,
    );

    expect(result.status).toBe("success");
    const data = result.data as AuditPromptResult;
    expect(data.spec_hash).toMatch(/^sha256:/);
    expect(data.audit_hash).toMatch(/^sha256:/);
  });

  it("instructions tell agent to call specia_audit again with audit_result", async () => {
    await setupProjectWithTasks(tmpDir);

    const result = await handleAudit(
      { change_name: "test-change" },
      tmpDir,
    );

    const data = result.data as AuditPromptResult;
    expect(data.instructions).toContain("specia_audit");
    expect(data.instructions).toContain("audit_result");
  });
});

// ── Phase 1: Error Cases ────────────────────────────────────────────

describe("handleAudit — Phase 1 error cases", () => {
  it("returns NOT_INITIALIZED when project not initialized", async () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "specia-audit-empty-"));

    const result = await handleAudit(
      { change_name: "test-change" },
      emptyDir,
    );

    expect(result.status).toBe("error");
    expect(result.errors[0]!.code).toBe("NOT_INITIALIZED");

    fs.rmSync(emptyDir, { recursive: true, force: true });
  });

  it("returns CHANGE_NOT_FOUND when change does not exist", async () => {
    await handleInit({ project_description: "Test" }, tmpDir);

    const result = await handleAudit(
      { change_name: "nonexistent" },
      tmpDir,
    );

    expect(result.status).toBe("error");
    expect(result.errors[0]!.code).toBe("CHANGE_NOT_FOUND");
  });

  it("returns TASKS_NOT_COMPLETE when tasks phase not finished", async () => {
    await handleInit({ project_description: "Test" }, tmpDir);
    await handlePropose(
      { change_name: "no-tasks", intent: "intent", scope: ["a"] },
      tmpDir,
    );
    await handleSpec(
      {
        change_name: "no-tasks",
        requirements: [
          {
            name: "R1",
            description: "desc",
            scenarios: [{ name: "S1", given: "g", when: "w", then: "t" }],
          },
        ],
      },
      tmpDir,
    );
    // Review but NO tasks
    await handleReview(
      { change_name: "no-tasks", review_result: makeMinimalReviewResult() },
      tmpDir,
    );

    const result = await handleAudit(
      { change_name: "no-tasks" },
      tmpDir,
    );

    expect(result.status).toBe("error");
    expect(result.errors[0]!.code).toBe("TASKS_NOT_COMPLETE");
  });

  it("returns VALIDATION_ERROR for invalid input", async () => {
    await setupProjectWithTasks(tmpDir);

    const result = await handleAudit(
      { change_name: "INVALID NAME" },
      tmpDir,
    );

    expect(result.status).toBe("error");
    expect(result.errors[0]!.code).toBe("VALIDATION_ERROR");
  });
});

// ── Phase 2: Result Submission ──────────────────────────────────────

describe("handleAudit — Phase 2 (result submission)", () => {
  it("validates and saves audit result, creates audit.md", async () => {
    await setupProjectWithTasks(tmpDir);

    const result = await handleAudit(
      {
        change_name: "test-change",
        audit_result: makeMinimalAuditResult(),
      },
      tmpDir,
    );

    expect(result.status).toBe("success");
    const data = result.data as AuditCompleteResult;
    expect(data.audit_path).toBe(".specia/changes/test-change/audit.md");
    expect(data.overall_verdict).toBe("pass");
    expect(data.cached).toBe(false);
    expect(data.requirements_summary).toContain("1/1 passed");
    expect(data.abuse_cases_summary).toContain("1/1 verified");

    // Verify audit.md exists and has correct content
    const auditPath = path.join(tmpDir, ".specia", "changes", "test-change", "audit.md");
    expect(fs.existsSync(auditPath)).toBe(true);
    const content = fs.readFileSync(auditPath, "utf-8");
    expect(content).toContain("audit_hash:");
    expect(content).toContain("spec_hash:");
    expect(content).toContain("# Spec Audit: test-change");
    expect(content).toContain("REQ-001");
    expect(content).toContain("AC-001");
  });

  it("updates state.yaml with audit phase complete", async () => {
    await setupProjectWithTasks(tmpDir);

    await handleAudit(
      {
        change_name: "test-change",
        audit_result: makeMinimalAuditResult(),
      },
      tmpDir,
    );

    // Read state.yaml and verify
    const statePath = path.join(tmpDir, ".specia", "changes", "test-change", "state.yaml");
    const stateContent = fs.readFileSync(statePath, "utf-8");
    expect(stateContent).toContain("phase: audit");
    expect(stateContent).toContain("status: complete");
    expect(stateContent).toContain("audit_hash:");
    expect(stateContent).toContain("audit_posture:");
  });

  it("returns VALIDATION_ERROR for invalid audit_result", async () => {
    await setupProjectWithTasks(tmpDir);

    const result = await handleAudit(
      {
        change_name: "test-change",
        audit_result: "not a json object",
      },
      tmpDir,
    );

    expect(result.status).toBe("error");
    expect(result.errors[0]!.code).toBe("VALIDATION_ERROR");
    expect(result.errors[0]!.message).toContain("validation failed");
  });

  it("returns VALIDATION_ERROR when requirements missing from audit_result", async () => {
    await setupProjectWithTasks(tmpDir);

    const result = await handleAudit(
      {
        change_name: "test-change",
        audit_result: { summary: {}, abuse_cases: [] },
      },
      tmpDir,
    );

    expect(result.status).toBe("error");
    expect(result.errors[0]!.code).toBe("VALIDATION_ERROR");
  });
});

// ── Smart Caching ───────────────────────────────────────────────────

describe("handleAudit — Smart Caching", () => {
  it("returns cached status when code unchanged since last audit", async () => {
    await setupProjectWithTasks(tmpDir);

    // Phase 2: submit audit result
    await handleAudit(
      {
        change_name: "test-change",
        audit_result: makeMinimalAuditResult(),
      },
      tmpDir,
    );

    // Phase 1 again: should get cache hit
    const result = await handleAudit(
      { change_name: "test-change" },
      tmpDir,
    );

    expect(result.status).toBe("cached");
    const data = result.data as AuditCompleteResult;
    expect(data.cached).toBe(true);
    expect(data.overall_verdict).toBeTruthy();
  });

  it("bypasses cache when force is true", async () => {
    await setupProjectWithTasks(tmpDir);

    // Submit audit
    await handleAudit(
      {
        change_name: "test-change",
        audit_result: makeMinimalAuditResult(),
      },
      tmpDir,
    );

    // Force re-audit
    const result = await handleAudit(
      { change_name: "test-change", force: true },
      tmpDir,
    );

    // Should return a new prompt, not cached
    expect(result.status).toBe("success");
    const data = result.data as AuditPromptResult;
    expect(data.audit_prompt).toBeTruthy();
  });
});

// ── Meta assertions ─────────────────────────────────────────────────

describe("handleAudit — meta", () => {
  it("includes tool name and change in meta", async () => {
    await setupProjectWithTasks(tmpDir);

    const result = await handleAudit(
      { change_name: "test-change" },
      tmpDir,
    );

    expect(result.meta.tool).toBe("specia_audit");
    expect(result.meta.change).toBe("test-change");
    expect(typeof result.meta.duration_ms).toBe("number");
  });

  it("records duration_ms in meta for all responses", async () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "specia-audit-meta-"));

    const result = await handleAudit(
      { change_name: "test" },
      emptyDir,
    );

    expect(typeof result.meta.duration_ms).toBe("number");
    expect(result.meta.duration_ms).toBeGreaterThanOrEqual(0);

    fs.rmSync(emptyDir, { recursive: true, force: true });
  });
});
