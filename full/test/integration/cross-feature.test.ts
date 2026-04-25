/**
 * Cross-feature integration tests.
 *
 * Tests interactions between v0.2 features:
 * 1. Guardian + Design: verify Guardian checks design.md when present
 * 2. Shortcuts with design: /spec-ff and /spec-continue handle design
 * 3. Guardian runner (programmatic invocation)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";
import { FileStore } from "../../src/services/store.js";
import { GuardianService, DEFAULT_GUARDIAN_CONFIG } from "../../src/services/guardian.js";
import { run as runGuardian } from "../../src/guardian/runner.js";
import { handleInit } from "../../src/tools/init.js";
import { handlePropose } from "../../src/tools/propose.js";
import { handleSpec } from "../../src/tools/spec.js";
import { handleDesign } from "../../src/tools/design.js";
import { handleReview } from "../../src/tools/review.js";
import { handleTasks } from "../../src/tools/tasks.js";
import { handleContinue } from "../../src/tools/continue.js";
import { handleFf } from "../../src/tools/ff.js";
import { handleDone } from "../../src/tools/done.js";
import { computeSpecHash } from "../../src/services/cache.js";
import type { GuardianConfig } from "../../src/types/index.js";

let tmpDir: string;

const SAMPLE_REQUIREMENTS = [
  {
    name: "Payment processing",
    description: "Handle credit card payments securely",
    scenarios: [{
      name: "Successful charge",
      given: "valid card details",
      when: "charge is submitted",
      then: "payment is processed and receipt generated",
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
          title: "Card fraud",
          description: "Stolen card details",
          severity: "critical",
          mitigation: "Use tokenized payment",
          affected_components: ["payments"],
        }],
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
      mitigations_required: ["Use tokenized payment"],
    },
  };
}

const DESIGN_CONTENT = `# Design: payment-system

## Technical Approach

Use Stripe SDK for payment processing. All card data goes through Stripe's tokenization.

## Architecture Decisions

### Decision: Stripe over custom processing
**Choice**: Stripe SDK for all payment handling
**Rationale**: PCI-DSS compliance without managing card data ourselves

## Component Design

- PaymentController: Handles payment intents
- StripeService: Wrapper around Stripe SDK
`;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "specia-cross-"));
  execSync("git init -b main", { cwd: tmpDir, stdio: "pipe" });
  execSync("git config user.email 'test@test.com'", { cwd: tmpDir, stdio: "pipe" });
  execSync("git config user.name 'Test'", { cwd: tmpDir, stdio: "pipe" });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("Cross-feature: Guardian + Design phase", () => {
  it("Guardian passes when design phase is complete and all checks pass", async () => {
    // Complete workflow with design
    await handleInit({ project_description: "Payment service" }, tmpDir);
    await handlePropose({
      change_name: "payment-system",
      intent: "Add payment processing",
      scope: ["src/payments"],
    }, tmpDir);
    await handleSpec({
      change_name: "payment-system",
      requirements: SAMPLE_REQUIREMENTS,
    }, tmpDir);
    await handleDesign({
      change_name: "payment-system",
      design_content: DESIGN_CONTENT,
    }, tmpDir);

    const specPath = path.join(tmpDir, ".specia", "changes", "payment-system", "spec.md");
    const specContent = fs.readFileSync(specPath, "utf-8");
    const specHash = computeSpecHash(specContent);

    await handleReview({
      change_name: "payment-system",
      review_result: makeReviewResult("payment-system", specHash),
    }, tmpDir);

    await handleTasks({
      change_name: "payment-system",
    }, tmpDir);

    // Mark security mitigations as done (check off the checkboxes)
    const tasksPath = path.join(tmpDir, ".specia", "changes", "payment-system", "tasks.md");
    const tasksContent = fs.readFileSync(tasksPath, "utf-8");
    fs.writeFileSync(tasksPath, tasksContent.replace(/- \[ \] /g, "- [x] "));

    // Guardian validation
    const store = new FileStore(tmpDir);
    const guardian = new GuardianService(tmpDir, store);

    const result = await guardian.validateStagedFiles(
      ["src/payments/stripe.ts"],
      { ...DEFAULT_GUARDIAN_CONFIG, mode: "strict" },
    );

    expect(result.summary.violations).toBe(0);
    expect(result.results[0]!.status).toBe("pass");
  });

  it("Guardian detects stale review after spec changes", async () => {
    await handleInit({ project_description: "Test" }, tmpDir);
    await handlePropose({
      change_name: "stale-test",
      intent: "Test stale detection",
      scope: ["src/auth"],
    }, tmpDir);
    await handleSpec({
      change_name: "stale-test",
      requirements: SAMPLE_REQUIREMENTS,
    }, tmpDir);

    const specPath = path.join(tmpDir, ".specia", "changes", "stale-test", "spec.md");
    const specContent = fs.readFileSync(specPath, "utf-8");
    const specHash = computeSpecHash(specContent);

    await handleReview({
      change_name: "stale-test",
      review_result: makeReviewResult("stale-test", specHash),
    }, tmpDir);

    // Now modify the spec AFTER review
    const newSpec = specContent + "\n## New Section\nAdded after review.\n";
    fs.writeFileSync(specPath, newSpec);

    // Guardian should detect the review is stale
    const store = new FileStore(tmpDir);
    const guardian = new GuardianService(tmpDir, store);

    const reviewComplete = guardian.checkReviewComplete("stale-test");
    expect(reviewComplete).toBe(false); // Stale review = not complete
  });
});

describe("Cross-feature: Shortcuts with design", () => {
  it("specia_continue correctly sequences through design phase", async () => {
    await handleInit({ project_description: "Test" }, tmpDir);
    await handlePropose({
      change_name: "shortcut-test",
      intent: "Test shortcuts",
      scope: ["area"],
    }, tmpDir);

    // After proposal → next is spec
    let result = await handleContinue({ change_name: "shortcut-test" }, tmpDir);
    expect(result.data).toHaveProperty("next_tool", "specia_spec");

    // After spec → next is design (optional)
    await handleSpec({
      change_name: "shortcut-test",
      requirements: SAMPLE_REQUIREMENTS,
    }, tmpDir);

    result = await handleContinue({ change_name: "shortcut-test" }, tmpDir);
    expect(result.data).toHaveProperty("next_tool", "specia_design");
    expect(result.data).toHaveProperty("optional", true);

    // After design → next is review
    await handleDesign({
      change_name: "shortcut-test",
      design_content: DESIGN_CONTENT,
    }, tmpDir);

    result = await handleContinue({ change_name: "shortcut-test" }, tmpDir);
    expect(result.data).toHaveProperty("next_tool", "specia_review");

    // After review → next is tasks
    const specPath = path.join(tmpDir, ".specia", "changes", "shortcut-test", "spec.md");
    const specContent = fs.readFileSync(specPath, "utf-8");
    const specHash = computeSpecHash(specContent);

    await handleReview({
      change_name: "shortcut-test",
      review_result: makeReviewResult("shortcut-test", specHash),
    }, tmpDir);

    result = await handleContinue({ change_name: "shortcut-test" }, tmpDir);
    expect(result.data).toHaveProperty("next_tool", "specia_tasks");

    // After tasks → next is audit (mandatory by default)
    await handleTasks({ change_name: "shortcut-test" }, tmpDir);

    result = await handleContinue({ change_name: "shortcut-test" }, tmpDir);
    expect(result.data).toHaveProperty("next_tool", "specia_audit");
    expect(result.data).toHaveProperty("optional", false); // audit is mandatory by default
  });
});

describe("Cross-feature: Guardian runner (programmatic)", () => {
  it("runner exits 0 for non-specia project", async () => {
    // tmpDir has git but no .specia — runner should silently pass
    const exitCode = await runGuardian(["--root", tmpDir, "--mode", "strict"]);
    expect(exitCode).toBe(0);
  });

  it("runner exits 0 when guardian is disabled in config", async () => {
    await handleInit({ project_description: "Test" }, tmpDir);

    // Disable guardian in config
    const store = new FileStore(tmpDir);
    const config = store.readConfig();
    config.guardian = { ...DEFAULT_GUARDIAN_CONFIG, enabled: false };
    store.writeConfig(config);

    const exitCode = await runGuardian(["--root", tmpDir, "--mode", "strict"]);
    expect(exitCode).toBe(0);
  });

  it("runner exits 0 when no staged files", async () => {
    await handleInit({ project_description: "Test" }, tmpDir);

    // No staged files in git
    const exitCode = await runGuardian(["--root", tmpDir, "--mode", "warn"]);
    expect(exitCode).toBe(0);
  });
});

describe("Cross-feature: Guardian glob matching", () => {
  it("matches exact file paths", () => {
    const store = new FileStore(tmpDir);
    const guardian = new GuardianService(tmpDir, store);

    expect(guardian.matchGlob("src/main.ts", "src/main.ts")).toBe(true);
    expect(guardian.matchGlob("src/main.ts", "src/other.ts")).toBe(false);
  });

  it("matches directory prefixes", () => {
    const store = new FileStore(tmpDir);
    const guardian = new GuardianService(tmpDir, store);

    expect(guardian.matchGlob("node_modules/foo/bar.js", "node_modules")).toBe(true);
    expect(guardian.matchGlob("src/main.ts", "node_modules")).toBe(false);
  });

  it("matches wildcard patterns", () => {
    const store = new FileStore(tmpDir);
    const guardian = new GuardianService(tmpDir, store);

    expect(guardian.matchGlob("README.md", "*.md")).toBe(true);
    expect(guardian.matchGlob("src/main.ts", "*.md")).toBe(false);
    expect(guardian.matchGlob("test/unit/foo.test.ts", "test/**")).toBe(true);
  });
});

describe("Cross-feature: Guardian scope path extraction", () => {
  it("extracts scope paths from proposal content", () => {
    const store = new FileStore(tmpDir);
    const guardian = new GuardianService(tmpDir, store);

    const proposalContent = `# Proposal: test

## Scope

- src/auth
- src/middleware
- lib/utils

## Approach

Some approach.
`;

    const paths = guardian.extractScopePaths(proposalContent);
    expect(paths).toEqual(["src/auth", "src/middleware", "lib/utils"]);
  });

  it("returns empty array when no scope section", () => {
    const store = new FileStore(tmpDir);
    const guardian = new GuardianService(tmpDir, store);

    const proposalContent = `# Proposal: test

## Intent

Some intent.
`;

    const paths = guardian.extractScopePaths(proposalContent);
    expect(paths).toEqual([]);
  });
});

// ── v0.3: Audit + state machine integration ─────────────────────────

describe("Cross-feature: Audit state machine integration", () => {
  /** Pipeline helper for integration tests. */
  async function runFullPipeline(dir: string, changeName: string) {
    await handleInit({ project_description: "Integration test" }, dir);
    await handlePropose({
      change_name: changeName,
      intent: "Test audit integration",
      scope: ["src/feature"],
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

  it("specia_continue flows: tasks → audit (mandatory) → done", async () => {
    await runFullPipeline(tmpDir, "flow-test");

    // After tasks → suggest audit (mandatory by default)
    let result = await handleContinue({ change_name: "flow-test" }, tmpDir);
    expect(result.data).toHaveProperty("next_tool", "specia_audit");
    expect(result.data).toHaveProperty("optional", false);

    // Simulate audit completion
    const store = new FileStore(tmpDir);
    store.writeArtifact("flow-test", "audit", `---\noverall_verdict: "pass"\n---\n# Audit`);
    store.transitionPhase("flow-test", "audit", "complete", {
      audit_hash: "sha256:test",
      audit_posture: "standard",
    });

    // After audit → suggest done
    result = await handleContinue({ change_name: "flow-test" }, tmpDir);
    expect(result.data).toHaveProperty("next_tool", "specia_done");
  });

  it("specia_done archives with audit frontmatter when audit exists", async () => {
    await runFullPipeline(tmpDir, "archive-audit");

    const store = new FileStore(tmpDir);

    // Write audit.md with proper frontmatter and sections that pass validateAuditMinContent
    const auditMd = `---
change: "archive-audit"
timestamp: "2026-04-05T00:00:00.000Z"
posture: "standard"
spec_hash: "sha256:spec"
audit_hash: "sha256:code"
overall_verdict: "partial"
risk_level: "medium"
requirements_coverage:
  total: 5
  passed: 4
  failed: 1
  partial: 0
  skipped: 0
abuse_cases_coverage:
  total: 3
  verified: 2
  unverified: 1
  partial: 0
  not_applicable: 0
---

# Spec Audit: archive-audit

## Requirements Verification

### REQ-001 — Validate all input
**Verdict**: pass
**Evidence**: Input validation middleware implemented in src/feature.ts with proper sanitization.
**Code References**: src/feature.ts:42

### REQ-002 — Rate limiting
**Verdict**: fail
**Evidence**: No rate limiting middleware found in the codebase.

## Abuse Case Verification

### AC-001 — Brute force attack
**Verdict**: verified
**Evidence**: Rate limiting and account lockout mechanisms protect against brute force attacks.
**Code References**: src/middleware.ts:15
`;
    store.writeArtifact("archive-audit", "audit", auditMd);
    store.transitionPhase("archive-audit", "audit", "complete", {
      audit_hash: "sha256:code",
      audit_posture: "standard",
    });

    // Archive via done
    const result = await handleDone({ change_name: "archive-audit" }, tmpDir);
    expect(result.status).toBe("success");

    // Verify archived spec includes audit metadata
    const archivePath = path.join(tmpDir, ".specia", "specs", "archive-audit.md");
    const archived = fs.readFileSync(archivePath, "utf-8");

    expect(archived).toContain("audit_verdict");
    expect(archived).toContain("partial");
    expect(archived).toContain("audit_requirements_passed: 4");
    expect(archived).toContain("audit_requirements_total: 5");
    expect(archived).toContain("audit_abuse_cases_verified: 2");
    expect(archived).toContain("audit_abuse_cases_total: 3");
  });

  it("specia_done blocks without audit when audit_policy is required", async () => {
    await runFullPipeline(tmpDir, "no-audit-compat");

    // Archive directly from tasks phase — no audit, audit_policy is "required" by default
    const result = await handleDone({ change_name: "no-audit-compat" }, tmpDir);
    expect(result.status).toBe("error");
    expect(result.errors[0]!.code).toBe("AUDIT_REQUIRED");
  });

  it("specia_done works without audit when force override is used", async () => {
    await runFullPipeline(tmpDir, "no-audit-force");

    // Archive with force override
    const result = await handleDone({ change_name: "no-audit-force", force: true }, tmpDir);
    expect(result.status).toBe("success");

    // Warning about emergency override
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("EMERGENCY OVERRIDE"),
      ]),
    );

    // Archived spec should NOT have audit_* fields
    const archivePath = path.join(tmpDir, ".specia", "specs", "no-audit-force.md");
    const archived = fs.readFileSync(archivePath, "utf-8");
    expect(archived).not.toContain("audit_verdict");
    expect(archived).not.toContain("audit_requirements_passed");
  });

  it("specia_ff mentions audit availability after completion", async () => {
    await handleInit({ project_description: "ff test" }, tmpDir);

    // Run ff with intent/scope (gets through proposal)
    const ffResult = await handleFf({
      change_name: "ff-audit",
      intent: "Test ff audit mention",
      scope: ["src/"],
    }, tmpDir);

    // ff stops at spec (needs LLM input), but when it completes all phases
    // the message should mention audit
    // For this test, complete the pipeline and re-run ff
    if (ffResult.data && "stopped_at" in ffResult.data && ffResult.data.stopped_at === "spec") {
      // Manually complete the remaining phases
      await handleSpec({
        change_name: "ff-audit",
        requirements: SAMPLE_REQUIREMENTS,
      }, tmpDir);

      const specPath = path.join(tmpDir, ".specia", "changes", "ff-audit", "spec.md");
      const specContent = fs.readFileSync(specPath, "utf-8");
      const specHash = computeSpecHash(specContent);

      await handleReview({
        change_name: "ff-audit",
        review_result: makeReviewResult("ff-audit", specHash),
      }, tmpDir);
      await handleTasks({ change_name: "ff-audit" }, tmpDir);

      // Now run ff again — all phases done, should mention audit
      const ffResult2 = await handleFf({ change_name: "ff-audit" }, tmpDir);
      expect(ffResult2.status).toBe("success");
      if (ffResult2.data && "message" in ffResult2.data) {
        expect(ffResult2.data.message).toContain("specia_audit");
      }
    }
  });
});
