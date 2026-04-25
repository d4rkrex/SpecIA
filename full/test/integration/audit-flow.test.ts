/**
 * Integration tests: Full audit flow + edge cases.
 *
 * Phase 7 of /spec-audit feature:
 * 1. Full workflow: init → propose → spec → review → tasks → audit → done
 * 2. Workflow skipping audit: init → propose → spec → review → tasks → done
 * 3. Cache and staleness edge cases
 * 4. Large file set edge cases (in audit.test.ts — these are flow-level)
 * 5. Error recovery: Phase 2 without Phase 1, invalid audit results
 * 6. Backward compatibility for pre-audit changes
 *
 * Spec refs: Domain 3 (specia_audit), Domain 5 (State Machine),
 *            Domain 7 (Staleness), Domain 10 (Archival)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";
import { FileStore } from "../../src/services/store.js";
import { handleInit } from "../../src/tools/init.js";
import { handlePropose } from "../../src/tools/propose.js";
import { handleSpec } from "../../src/tools/spec.js";
import { handleReview } from "../../src/tools/review.js";
import { handleTasks } from "../../src/tools/tasks.js";
import { handleAudit } from "../../src/tools/audit.js";
import { handleDone } from "../../src/tools/done.js";
import { handleContinue } from "../../src/tools/continue.js";
import { computeSpecHash } from "../../src/services/cache.js";
import type { AuditPromptResult, AuditCompleteResult } from "../../src/tools/audit.js";

let tmpDir: string;

const SAMPLE_REQUIREMENTS = [
  {
    name: "Authentication",
    description: "Handle user login with JWT",
    scenarios: [{
      name: "Successful login",
      given: "valid credentials",
      when: "user submits login form",
      then: "JWT token returned",
    }],
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
          title: "Token forgery",
          description: "Attacker forges JWT tokens",
          severity: "high",
          mitigation: "Use strong signing keys",
          affected_components: ["auth"],
        }],
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
        title: "JWT Token Forgery",
        attacker_goal: "Forge valid tokens",
        technique: "Key brute-force",
        preconditions: ["Weak signing key"],
        impact: "Full account takeover",
        mitigation: "Use RS256 with strong keys",
        stride_category: "Spoofing",
        testable: true,
        test_hint: "Try signing with common weak keys",
      },
    ],
    summary: {
      risk_level: "high",
      total_findings: 1,
      critical_findings: 0,
      mitigations_required: ["Use strong signing keys"],
    },
  };
}

function makeMinimalAuditResult() {
  return {
    requirements: [
      {
        requirement_id: "REQ-001",
        verdict: "pass",
        evidence: "JWT validation middleware found on all routes",
        code_references: ["src/middleware/auth.ts:15"],
        gaps: [],
        notes: "",
      },
    ],
    abuse_cases: [
      {
        abuse_case_id: "AC-001",
        verdict: "verified",
        evidence: "RS256 with 2048-bit key used for JWT signing",
        code_references: ["src/auth/jwt.ts:10"],
        gaps: [],
        risk_if_unaddressed: "",
      },
    ],
    summary: {
      overall_verdict: "pass",
      requirements_coverage: {
        total: 1, passed: 1, failed: 0, partial: 0, skipped: 0,
      },
      abuse_cases_coverage: {
        total: 1, verified: 1, unverified: 0, partial: 0, not_applicable: 0,
      },
      risk_level: "low",
      recommendations: [],
    },
  };
}

function makePartialAuditResult() {
  return {
    requirements: [
      {
        requirement_id: "REQ-001",
        verdict: "pass",
        evidence: "Authentication handler found and validated on login endpoint",
        code_references: ["src/auth.ts:10"],
        gaps: [],
        notes: "",
      },
      {
        requirement_id: "REQ-002",
        verdict: "fail",
        evidence: "Rate limiting is not implemented on any endpoint",
        code_references: [],
        gaps: ["No rate limiter on login endpoint"],
        notes: "Critical for brute force prevention",
      },
    ],
    abuse_cases: [
      {
        abuse_case_id: "AC-001",
        verdict: "unverified",
        evidence: "",
        code_references: [],
        gaps: ["Weak key detected"],
        risk_if_unaddressed: "Token forgery possible",
      },
    ],
    summary: {
      overall_verdict: "fail",
      requirements_coverage: {
        total: 2, passed: 1, failed: 1, partial: 0, skipped: 0,
      },
      abuse_cases_coverage: {
        total: 1, verified: 0, unverified: 1, partial: 0, not_applicable: 0,
      },
      risk_level: "high",
      recommendations: [
        "Add rate limiting to login endpoint",
        "Replace signing key with RS256 2048-bit key",
      ],
    },
  };
}

/**
 * Create a minimal git repo with a source file so that discoverChangedFiles
 * finds at least one code file. Required after fix-empty-audit which rejects
 * zero-file audits.
 */
function setupGitRepoWithSourceFile(dir: string) {
  // Initialize git repo
  execSync("git init -b main", { cwd: dir, stdio: "pipe" });
  execSync("git config user.email 'test@test.com'", { cwd: dir, stdio: "pipe" });
  execSync("git config user.name 'Test'", { cwd: dir, stdio: "pipe" });

  // Create a source file
  const srcDir = path.join(dir, "src");
  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(path.join(srcDir, "auth.ts"), "export function login() { return true; }\n");

  // Create initial commit on main branch
  execSync("git add -A", { cwd: dir, stdio: "pipe" });
  execSync("git commit -m 'initial'", { cwd: dir, stdio: "pipe" });

  // Create a change on a feature branch so git diff main...HEAD shows the file
  execSync("git checkout -b feature", { cwd: dir, stdio: "pipe" });
  fs.writeFileSync(path.join(srcDir, "auth.ts"), "export function login() { return true; }\nexport function logout() {}\n");
  execSync("git add -A", { cwd: dir, stdio: "pipe" });
  execSync("git commit -m 'add auth feature'", { cwd: dir, stdio: "pipe" });
}

/** Run the pipeline up to tasks phase. */
async function setupProjectWithTasks(dir: string, changeName: string) {
  setupGitRepoWithSourceFile(dir);
  await handleInit({ project_description: "Integration test project" }, dir);
  await handlePropose({
    change_name: changeName,
    intent: "Add JWT authentication",
    scope: ["src/auth"],
  }, dir);
  await handleSpec({
    change_name: changeName,
    requirements: SAMPLE_REQUIREMENTS,
  }, dir);

  const specPath = path.join(dir, ".specia", "changes", changeName, "spec.md");
  const specContent = fs.readFileSync(specPath, "utf-8");
  const specHash = computeSpecHash(specContent);

  await handleReview({
    change_name: changeName,
    review_result: makeReviewResult(changeName, specHash),
  }, dir);

  await handleTasks({ change_name: changeName }, dir);
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "specia-audit-flow-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ══════════════════════════════════════════════════════════════════════
// Task 7.1: Full workflow integration test
// ══════════════════════════════════════════════════════════════════════

describe("Integration: Full audit flow — propose → spec → review → tasks → audit → done", () => {
  it("completes the entire workflow with audit and archives correctly", async () => {
    await setupProjectWithTasks(tmpDir, "full-audit");

    // Phase 1: get audit prompt
    const phase1 = await handleAudit(
      { change_name: "full-audit" },
      tmpDir,
    );
    expect(phase1.status).toBe("success");
    const promptData = phase1.data as AuditPromptResult;
    expect(promptData.audit_prompt).toBeTruthy();
    expect(promptData.spec_hash).toMatch(/^sha256:/);
    expect(promptData.audit_hash).toMatch(/^sha256:/);

    // Phase 2: submit audit result
    const phase2 = await handleAudit(
      {
        change_name: "full-audit",
        audit_result: makeMinimalAuditResult(),
      },
      tmpDir,
    );
    expect(phase2.status).toBe("success");
    const auditData = phase2.data as AuditCompleteResult;
    expect(auditData.overall_verdict).toBe("pass");
    expect(auditData.cached).toBe(false);

    // Verify audit.md was written
    const auditPath = path.join(tmpDir, ".specia", "changes", "full-audit", "audit.md");
    expect(fs.existsSync(auditPath)).toBe(true);
    const auditContent = fs.readFileSync(auditPath, "utf-8");
    expect(auditContent).toContain("# Spec Audit: full-audit");
    expect(auditContent).toContain("REQ-001");
    expect(auditContent).toContain("AC-001");

    // Verify state.yaml has audit fields
    const statePath = path.join(tmpDir, ".specia", "changes", "full-audit", "state.yaml");
    const stateContent = fs.readFileSync(statePath, "utf-8");
    expect(stateContent).toContain("phase: audit");
    expect(stateContent).toContain("status: complete");
    expect(stateContent).toContain("audit_hash:");

    // Continue should suggest done
    const continueResult = await handleContinue({ change_name: "full-audit" }, tmpDir);
    expect(continueResult.data).toHaveProperty("next_tool", "specia_done");

    // Archive via done — should include audit metadata
    const doneResult = await handleDone({ change_name: "full-audit" }, tmpDir);
    expect(doneResult.status).toBe("success");

    // Verify archived spec includes audit frontmatter
    const archivedPath = path.join(tmpDir, ".specia", "specs", "full-audit.md");
    expect(fs.existsSync(archivedPath)).toBe(true);
    const archivedContent = fs.readFileSync(archivedPath, "utf-8");
    expect(archivedContent).toContain("audit_verdict");
    expect(archivedContent).toContain("pass");

    // Verify change directory was removed
    const changeDir = path.join(tmpDir, ".specia", "changes", "full-audit");
    expect(fs.existsSync(changeDir)).toBe(false);
  });

  it("audit with fail verdict still archives correctly via done", async () => {
    await setupProjectWithTasks(tmpDir, "fail-audit");

    // Submit a failing audit result
    await handleAudit(
      {
        change_name: "fail-audit",
        audit_result: makePartialAuditResult(),
      },
      tmpDir,
    );

    // Verify audit.md contains fail verdict
    const auditPath = path.join(tmpDir, ".specia", "changes", "fail-audit", "audit.md");
    const auditContent = fs.readFileSync(auditPath, "utf-8");
    expect(auditContent).toContain("fail");
    expect(auditContent).toContain("Recommendations");

    // Archive — should succeed even with fail verdict
    const doneResult = await handleDone({ change_name: "fail-audit" }, tmpDir);
    expect(doneResult.status).toBe("success");

    // Archived spec includes fail verdict
    const archived = fs.readFileSync(
      path.join(tmpDir, ".specia", "specs", "fail-audit.md"),
      "utf-8",
    );
    expect(archived).toContain("audit_verdict");
    expect(archived).toContain("fail");
  });
});

// ══════════════════════════════════════════════════════════════════════
// Task 7.2: Edge case tests
// ══════════════════════════════════════════════════════════════════════

describe("Integration: Audit edge cases", () => {
  it("audit with no abuse cases (review had none) — still works", async () => {
    // Set up with a review that has NO abuse cases
    setupGitRepoWithSourceFile(tmpDir);
    await handleInit({ project_description: "No abuse case test" }, tmpDir);
    await handlePropose({
      change_name: "no-abuse",
      intent: "Simple feature",
      scope: ["src/feature"],
    }, tmpDir);
    await handleSpec({
      change_name: "no-abuse",
      requirements: SAMPLE_REQUIREMENTS,
    }, tmpDir);

    const specPath = path.join(tmpDir, ".specia", "changes", "no-abuse", "spec.md");
    const specContent = fs.readFileSync(specPath, "utf-8");
    const specHash = computeSpecHash(specContent);

    // Review WITHOUT abuse_cases field
    await handleReview({
      change_name: "no-abuse",
      review_result: {
        change: "no-abuse",
        posture: "standard",
        timestamp: new Date().toISOString(),
        spec_hash: specHash,
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
      },
    }, tmpDir);
    await handleTasks({ change_name: "no-abuse" }, tmpDir);

    // Audit Phase 2 with empty abuse cases
    const auditResult = await handleAudit(
      {
        change_name: "no-abuse",
        audit_result: {
          requirements: [{
            requirement_id: "REQ-001",
            verdict: "pass",
            evidence: "Feature implemented correctly with proper validation",
            code_references: ["src/auth.ts:1"],
            gaps: [],
            notes: "",
          }],
          abuse_cases: [],
          summary: {
            overall_verdict: "pass",
            requirements_coverage: { total: 1, passed: 1, failed: 0, partial: 0, skipped: 0 },
            abuse_cases_coverage: { total: 0, verified: 0, unverified: 0, partial: 0, not_applicable: 0 },
            risk_level: "low",
            recommendations: [],
          },
        },
      },
      tmpDir,
    );

    expect(auditResult.status).toBe("success");

    // Verify audit.md says "No abuse cases from review."
    const auditContent = fs.readFileSync(
      path.join(tmpDir, ".specia", "changes", "no-abuse", "audit.md"),
      "utf-8",
    );
    expect(auditContent).toContain("No abuse cases from review.");
  });

  it("audit when tasks not complete — returns TASKS_NOT_COMPLETE", async () => {
    setupGitRepoWithSourceFile(tmpDir);
    await handleInit({ project_description: "Test" }, tmpDir);
    await handlePropose({
      change_name: "no-tasks",
      intent: "Test",
      scope: ["src/"],
    }, tmpDir);
    await handleSpec({
      change_name: "no-tasks",
      requirements: SAMPLE_REQUIREMENTS,
    }, tmpDir);

    const specPath = path.join(tmpDir, ".specia", "changes", "no-tasks", "spec.md");
    const specContent = fs.readFileSync(specPath, "utf-8");
    const specHash = computeSpecHash(specContent);

    await handleReview({
      change_name: "no-tasks",
      review_result: makeReviewResult("no-tasks", specHash),
    }, tmpDir);
    // NOTE: No handleTasks call — tasks phase not complete

    const result = await handleAudit({ change_name: "no-tasks" }, tmpDir);
    expect(result.status).toBe("error");
    expect(result.errors[0]!.code).toBe("TASKS_NOT_COMPLETE");
  });

  it("Phase 2 called directly (without Phase 1) — should still work", async () => {
    await setupProjectWithTasks(tmpDir, "direct-p2");

    // Submit Phase 2 directly without calling Phase 1 first
    const result = await handleAudit(
      {
        change_name: "direct-p2",
        audit_result: makeMinimalAuditResult(),
      },
      tmpDir,
    );

    // v0.6: Phase 2 re-discovers files — this works because git repo exists
    expect(result.status).toBe("success");
    const data = result.data as AuditCompleteResult;
    expect(data.overall_verdict).toBe("pass");
    expect(data.cached).toBe(false);
  });

  it("invalid audit result from LLM — validation error, can retry", async () => {
    await setupProjectWithTasks(tmpDir, "invalid-result");

    // Submit invalid audit result
    const result1 = await handleAudit(
      {
        change_name: "invalid-result",
        audit_result: { not_valid: true },
      },
      tmpDir,
    );
    expect(result1.status).toBe("error");
    expect(result1.errors[0]!.code).toBe("VALIDATION_ERROR");

    // Retry with valid result — should succeed
    const result2 = await handleAudit(
      {
        change_name: "invalid-result",
        audit_result: makeMinimalAuditResult(),
      },
      tmpDir,
    );
    expect(result2.status).toBe("success");
  });

  it("backward compatibility — changes with skip_audit archive without audit", async () => {
    // Use a custom setup with skip_audit: true
    setupGitRepoWithSourceFile(tmpDir);
    await handleInit({ project_description: "Integration test project" }, tmpDir);
    await handlePropose({
      change_name: "pre-audit",
      intent: "Add JWT authentication",
      scope: ["src/auth"],
      skip_audit: true,
    }, tmpDir);
    await handleSpec({
      change_name: "pre-audit",
      requirements: SAMPLE_REQUIREMENTS,
    }, tmpDir);
    const specPath = path.join(tmpDir, ".specia", "changes", "pre-audit", "spec.md");
    const specContent = fs.readFileSync(specPath, "utf-8");
    const specHash = computeSpecHash(specContent);
    await handleReview({
      change_name: "pre-audit",
      review_result: makeReviewResult("pre-audit", specHash),
    }, tmpDir);
    await handleTasks({ change_name: "pre-audit" }, tmpDir);

    // Archive directly from tasks phase — no audit
    const result = await handleDone({ change_name: "pre-audit" }, tmpDir);
    expect(result.status).toBe("success");

    // Warning about opted-out audit
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("opted out"),
      ]),
    );

    // Archived spec should NOT have audit_* fields
    const archived = fs.readFileSync(
      path.join(tmpDir, ".specia", "specs", "pre-audit.md"),
      "utf-8",
    );
    expect(archived).not.toContain("audit_verdict");
    expect(archived).not.toContain("audit_requirements_passed");
  });
});

// ══════════════════════════════════════════════════════════════════════
// Task 7.3: Cache and staleness edge cases
// ══════════════════════════════════════════════════════════════════════

describe("Integration: Audit cache and staleness", () => {
  it("cache hit — same code returns cached status", async () => {
    await setupProjectWithTasks(tmpDir, "cache-test");

    // Complete audit
    await handleAudit(
      {
        change_name: "cache-test",
        audit_result: makeMinimalAuditResult(),
      },
      tmpDir,
    );

    // Call Phase 1 again — should be cached
    const result = await handleAudit(
      { change_name: "cache-test" },
      tmpDir,
    );
    expect(result.status).toBe("cached");
    const data = result.data as AuditCompleteResult;
    expect(data.cached).toBe(true);
  });

  it("force flag bypasses cache", async () => {
    await setupProjectWithTasks(tmpDir, "force-test");

    // Complete audit
    await handleAudit(
      {
        change_name: "force-test",
        audit_result: makeMinimalAuditResult(),
      },
      tmpDir,
    );

    // Force re-audit
    const result = await handleAudit(
      { change_name: "force-test", force: true },
      tmpDir,
    );
    expect(result.status).toBe("success");
    const data = result.data as AuditPromptResult;
    expect(data.audit_prompt).toBeTruthy();
  });

  it("stale audit warning on done when audit_stale flag is set", async () => {
    await setupProjectWithTasks(tmpDir, "stale-test");

    // Complete audit
    await handleAudit(
      {
        change_name: "stale-test",
        audit_result: makeMinimalAuditResult(),
      },
      tmpDir,
    );

    // Manually set audit_stale in state.yaml
    const store = new FileStore(tmpDir);
    const state = store.getChangeState("stale-test")!;
    store.transitionPhase("stale-test", "audit", "complete", {
      ...state,
      audit_hash: state.audit_hash,
      audit_posture: state.audit_posture,
      audit_stale: true,
    });

    // Done should warn about stale audit
    const result = await handleDone({ change_name: "stale-test" }, tmpDir);
    expect(result.status).toBe("success");
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("stale"),
      ]),
    );
  });
});

// ══════════════════════════════════════════════════════════════════════
// Task 7.5: Cross-feature regression tests
// ══════════════════════════════════════════════════════════════════════

describe("Integration: Cross-feature regressions with audit", () => {
  it("specia_continue for non-audit phases unchanged", async () => {
    setupGitRepoWithSourceFile(tmpDir);
    await handleInit({ project_description: "Regression test" }, tmpDir);
    await handlePropose({
      change_name: "regression",
      intent: "Test",
      scope: ["src/"],
    }, tmpDir);

    // After proposal → spec (unchanged)
    let result = await handleContinue({ change_name: "regression" }, tmpDir);
    expect(result.data).toHaveProperty("next_tool", "specia_spec");

    // After spec → design (optional, unchanged)
    await handleSpec({
      change_name: "regression",
      requirements: SAMPLE_REQUIREMENTS,
    }, tmpDir);
    result = await handleContinue({ change_name: "regression" }, tmpDir);
    expect(result.data).toHaveProperty("next_tool", "specia_design");
    expect(result.data).toHaveProperty("optional", true);
  });

  it("specia_done works for tasks-complete changes with force override", async () => {
    await setupProjectWithTasks(tmpDir, "no-audit-done");

    // Archive from tasks — audit_policy is "required" by default, so use force
    const result = await handleDone({ change_name: "no-audit-done", force: true }, tmpDir);
    expect(result.status).toBe("success");
    expect(result.data).toHaveProperty("archived_path");
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("EMERGENCY OVERRIDE"),
      ]),
    );
  });

  it("multiple changes can be in different phases independently", async () => {
    setupGitRepoWithSourceFile(tmpDir);
    await handleInit({ project_description: "Multi-change test" }, tmpDir);

    // Change 1: full pipeline with audit
    await handlePropose({
      change_name: "change-one",
      intent: "First change",
      scope: ["src/a"],
    }, tmpDir);
    await handleSpec({
      change_name: "change-one",
      requirements: SAMPLE_REQUIREMENTS,
    }, tmpDir);

    const spec1 = fs.readFileSync(
      path.join(tmpDir, ".specia", "changes", "change-one", "spec.md"),
      "utf-8",
    );
    await handleReview({
      change_name: "change-one",
      review_result: makeReviewResult("change-one", computeSpecHash(spec1)),
    }, tmpDir);
    await handleTasks({ change_name: "change-one" }, tmpDir);
    await handleAudit({
      change_name: "change-one",
      audit_result: makeMinimalAuditResult(),
    }, tmpDir);

    // Change 2: still in spec phase
    await handlePropose({
      change_name: "change-two",
      intent: "Second change",
      scope: ["src/b"],
    }, tmpDir);
    await handleSpec({
      change_name: "change-two",
      requirements: SAMPLE_REQUIREMENTS,
    }, tmpDir);

    // Continue on change-one → done
    const r1 = await handleContinue({ change_name: "change-one" }, tmpDir);
    expect(r1.data).toHaveProperty("next_tool", "specia_done");

    // Continue on change-two → design (optional)
    const r2 = await handleContinue({ change_name: "change-two" }, tmpDir);
    expect(r2.data).toHaveProperty("next_tool", "specia_design");

    // Archive change-one while change-two is still in-progress
    const done = await handleDone({ change_name: "change-one" }, tmpDir);
    expect(done.status).toBe("success");

    // Change-two should still exist and be unaffected
    const state2 = new FileStore(tmpDir).getChangeState("change-two");
    expect(state2).toBeTruthy();
    expect(state2!.phase).toBe("spec");
  });
});
