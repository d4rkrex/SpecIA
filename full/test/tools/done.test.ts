/**
 * specia_done handler unit tests — archival, error cases, audit integration.
 *
 * Spec refs: Domain 2 (specia_done — all scenarios),
 *            Domain 5 (specia_done Update — accept audit, warnings),
 *            Domain 7 (Staleness Warning on specia_done),
 *            Domain 10 (Audit in Archived Spec)
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
import { FileStore } from "../../src/services/store.js";

let tmpDir: string;

/** Full pipeline: init → propose → spec → review → tasks. */
async function setupCompletePipeline(dir: string, changeName = "done-test", skipAudit = false) {
  await handleInit({ project_description: "Test project" }, dir);
  await handlePropose(
    { change_name: changeName, intent: "Test intent", scope: ["area"], skip_audit: skipAudit },
    dir,
  );
  await handleSpec(
    {
      change_name: changeName,
      requirements: [
        {
          name: "Auth",
          description: "Authentication",
          scenarios: [
            { name: "Login", given: "creds", when: "login", then: "token" },
          ],
        },
      ],
    },
    dir,
  );
  await handleReview(
    {
      change_name: changeName,
      review_result: {
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
    },
    dir,
  );
  await handleTasks({ change_name: changeName }, dir);
}

/** Sample audit.md with frontmatter — must pass validateAuditMinContent (v0.6: blocking gate). */
const SAMPLE_AUDIT_MD = `---
change: "done-test"
timestamp: "2026-04-05T00:00:00.000Z"
posture: "standard"
spec_hash: "sha256:abc"
audit_hash: "sha256:def"
overall_verdict: "pass"
risk_level: "low"
requirements_coverage:
  total: 3
  passed: 3
  failed: 0
  partial: 0
  skipped: 0
abuse_cases_coverage:
  total: 2
  verified: 2
  unverified: 0
  partial: 0
  not_applicable: 0
---

# Spec Audit: done-test

**Posture**: standard | **Verdict**: pass | **Risk**: low

## Requirements Verification

| Requirement | Verdict | Evidence |
|-------------|---------|----------|
| REQ-001 | pass | Validation middleware found on all routes. Input sanitization present on login endpoint. |
| REQ-002 | pass | Rate limiting configured correctly with 100 req/min per IP. |
| REQ-003 | pass | Structured audit logging implemented for all auth events. |

## Abuse Case Verification

| Abuse Case | Verdict | Risk if Unaddressed |
|------------|---------|---------------------|
| AC-001 | verified | N/A — parameterized queries used throughout |
| AC-002 | verified | N/A — session regeneration implemented |

## Security Posture Assessment

- **Requirements**: 3/3 passed, 0 failed, 0 partial, 0 skipped
- **Abuse Cases**: 2/2 verified, 0 unverified, 0 partial, 0 N/A
- **Risk Level**: low
- **Overall Verdict**: pass

## Recommendations

No recommendations — all verifications passed.
`;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "specia-done-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("handleDone — successful archival", () => {
  it("archives change to specs/ and removes change directory", async () => {
    await setupCompletePipeline(tmpDir, "done-test", true); // skip_audit for backward compat test

    const result = await handleDone(
      { change_name: "done-test" },
      tmpDir,
    );

    expect(result.status).toBe("success");
    expect(result.data!.archived_path).toBe(".specia/specs/done-test.md");
    expect(result.meta.change).toBe("done-test");

    // Archived file exists
    const archivePath = path.join(tmpDir, ".specia", "specs", "done-test.md");
    expect(fs.existsSync(archivePath)).toBe(true);
    const content = fs.readFileSync(archivePath, "utf-8");
    expect(content).toContain("archived_at");
    expect(content).toContain("# Specification: done-test");

    // Change directory removed
    const changeDir = path.join(tmpDir, ".specia", "changes", "done-test");
    expect(fs.existsSync(changeDir)).toBe(false);
  });

  it("returns verified path from archiveChange (not hardcoded)", async () => {
    await setupCompletePipeline(tmpDir, "verified-path", true);

    const result = await handleDone(
      { change_name: "verified-path" },
      tmpDir,
    );

    expect(result.status).toBe("success");

    // The returned path must actually exist on disk
    const archivedPath = path.join(tmpDir, result.data!.archived_path);
    expect(fs.existsSync(archivedPath)).toBe(true);

    // Path is relative (no leading /)
    expect(result.data!.archived_path.startsWith("/")).toBe(false);
  });

  it("includes audit opt-out warning when archiving without audit", async () => {
    await setupCompletePipeline(tmpDir, "done-test", true); // skip_audit

    const result = await handleDone(
      { change_name: "done-test" },
      tmpDir,
    );

    expect(result.status).toBe("success");
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("opted out"),
      ]),
    );
  });
});

// ── v0.3: Audit phase archival ──────────────────────────────────────

describe("handleDone — v0.3 audit archival", () => {
  it("archives change when current phase is audit (complete)", async () => {
    await setupCompletePipeline(tmpDir, "audit-done");

    // Simulate completed audit
    const store = new FileStore(tmpDir);
    store.writeArtifact("audit-done", "audit", SAMPLE_AUDIT_MD.replace(/done-test/g, "audit-done"));
    store.transitionPhase("audit-done", "audit", "complete", {
      audit_hash: "sha256:def",
      audit_posture: "standard",
    });

    const result = await handleDone(
      { change_name: "audit-done" },
      tmpDir,
    );

    expect(result.status).toBe("success");
    expect(result.data!.archived_path).toBe(".specia/specs/audit-done.md");

    // Should NOT have audit skip warning
    const hasSkipWarning = result.warnings.some((w) => w.includes("Audit not performed"));
    expect(hasSkipWarning).toBe(false);

    // Change directory removed
    const changeDir = path.join(tmpDir, ".specia", "changes", "audit-done");
    expect(fs.existsSync(changeDir)).toBe(false);
  });

  it("includes audit frontmatter in archived spec when audit exists", async () => {
    await setupCompletePipeline(tmpDir, "audit-archive");

    // Simulate completed audit
    const store = new FileStore(tmpDir);
    store.writeArtifact("audit-archive", "audit", SAMPLE_AUDIT_MD.replace(/done-test/g, "audit-archive"));
    store.transitionPhase("audit-archive", "audit", "complete", {
      audit_hash: "sha256:def",
      audit_posture: "standard",
    });

    await handleDone({ change_name: "audit-archive" }, tmpDir);

    // Read archived spec
    const archivePath = path.join(tmpDir, ".specia", "specs", "audit-archive.md");
    const content = fs.readFileSync(archivePath, "utf-8");

    // Should contain audit_* prefixed fields
    expect(content).toContain("audit_verdict");
    expect(content).toContain("audit_hash");
    expect(content).toContain("audit_requirements_passed");
    expect(content).toContain("audit_requirements_total");
    expect(content).toContain("audit_abuse_cases_verified");
    expect(content).toContain("audit_abuse_cases_total");

    // Should also contain review frontmatter
    expect(content).toContain("review_");
  });

  it("does NOT include audit_* fields when audit was skipped", async () => {
    await setupCompletePipeline(tmpDir, "no-audit", true); // skip_audit

    await handleDone({ change_name: "no-audit" }, tmpDir);

    // Read archived spec
    const archivePath = path.join(tmpDir, ".specia", "specs", "no-audit.md");
    const content = fs.readFileSync(archivePath, "utf-8");

    // Should NOT contain audit_* prefixed fields
    expect(content).not.toContain("audit_verdict");
    expect(content).not.toContain("audit_hash");
    expect(content).not.toContain("audit_requirements_passed");
  });

  it("warns when audit is stale", async () => {
    await setupCompletePipeline(tmpDir, "stale-audit-done");

    // Simulate completed but stale audit
    const store = new FileStore(tmpDir);
    store.writeArtifact("stale-audit-done", "audit", SAMPLE_AUDIT_MD.replace(/done-test/g, "stale-audit-done"));
    store.transitionPhase("stale-audit-done", "audit", "complete", {
      audit_hash: "sha256:old-hash",
      audit_posture: "standard",
      audit_stale: true,
    });

    const result = await handleDone(
      { change_name: "stale-audit-done" },
      tmpDir,
    );

    expect(result.status).toBe("success");
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("stale"),
      ]),
    );
  });

  it("pre-audit change (tasks complete, no audit) archives normally with skip_audit", async () => {
    await setupCompletePipeline(tmpDir, "pre-audit", true); // skip_audit

    const result = await handleDone(
      { change_name: "pre-audit" },
      tmpDir,
    );

    // Should succeed — audit was opted out at propose time
    expect(result.status).toBe("success");
    expect(result.data!.archived_path).toBe(".specia/specs/pre-audit.md");

    // Archived file exists
    const archivePath = path.join(tmpDir, ".specia", "specs", "pre-audit.md");
    expect(fs.existsSync(archivePath)).toBe(true);
  });

  it("blocks done when audit_policy is required and no audit exists", async () => {
    await setupCompletePipeline(tmpDir, "audit-required");

    const result = await handleDone(
      { change_name: "audit-required" },
      tmpDir,
    );

    expect(result.status).toBe("error");
    expect(result.errors[0]!.code).toBe("AUDIT_REQUIRED");
    expect(result.errors[0]!.message).toContain("mandatory");
  });

  it("allows done with force override when audit is required but missing", async () => {
    await setupCompletePipeline(tmpDir, "force-done");

    const result = await handleDone(
      { change_name: "force-done", force: true },
      tmpDir,
    );

    expect(result.status).toBe("success");
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("EMERGENCY OVERRIDE"),
      ]),
    );
  });
});

describe("handleDone — error cases", () => {
  it("returns CHANGE_NOT_FOUND for non-existent change", async () => {
    await handleInit({ project_description: "Test" }, tmpDir);

    const result = await handleDone(
      { change_name: "nonexistent" },
      tmpDir,
    );

    expect(result.status).toBe("error");
    expect(result.errors[0]!.code).toBe("CHANGE_NOT_FOUND");
  });

  it("returns INCOMPLETE_CHANGE when tasks phase not complete", async () => {
    await handleInit({ project_description: "Test" }, tmpDir);
    await handlePropose(
      { change_name: "incomplete", intent: "intent", scope: ["a"] },
      tmpDir,
    );

    const result = await handleDone(
      { change_name: "incomplete" },
      tmpDir,
    );

    expect(result.status).toBe("error");
    expect(result.errors[0]!.code).toBe("INCOMPLETE_CHANGE");
  });

  it("returns INCOMPLETE_CHANGE when audit phase is in-progress", async () => {
    await setupCompletePipeline(tmpDir, "audit-wip");

    // Simulate in-progress audit
    const store = new FileStore(tmpDir);
    store.transitionPhase("audit-wip", "audit", "in-progress");

    const result = await handleDone(
      { change_name: "audit-wip" },
      tmpDir,
    );

    expect(result.status).toBe("error");
    expect(result.errors[0]!.code).toBe("INCOMPLETE_CHANGE");
  });

  it("returns NOT_INITIALIZED when project not initialized", async () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "specia-done-empty-"));

    const result = await handleDone(
      { change_name: "test-change" },
      emptyDir,
    );

    expect(result.status).toBe("error");
    expect(result.errors[0]!.code).toBe("NOT_INITIALIZED");

    fs.rmSync(emptyDir, { recursive: true, force: true });
  });

  it("returns VALIDATION_ERROR for invalid change name", async () => {
    const result = await handleDone(
      { change_name: "INVALID!!" },
      tmpDir,
    );

    expect(result.status).toBe("error");
    expect(result.errors[0]!.code).toBe("VALIDATION_ERROR");
  });
});

// ── v0.7: Post-write verification (fix-done-verification) ───────────

describe("handleDone — post-write verification", () => {
  it("returns IO_ERROR when archiveChange throws (spec missing)", async () => {
    await setupCompletePipeline(tmpDir, "throw-test", true);

    // Remove spec.md to cause archiveChange to throw
    const specPath = path.join(tmpDir, ".specia", "changes", "throw-test", "spec.md");
    fs.unlinkSync(specPath);

    const result = await handleDone(
      { change_name: "throw-test" },
      tmpDir,
    );

    expect(result.status).toBe("error");
    expect(result.errors[0]!.code).toBe("IO_ERROR");
    expect(result.errors[0]!.message).toContain("spec.md not found");
  });

  it("returns verified path from archiveChange (not hardcoded template)", async () => {
    await setupCompletePipeline(tmpDir, "verify-path", true);

    const result = await handleDone(
      { change_name: "verify-path" },
      tmpDir,
    );

    expect(result.status).toBe("success");

    // The returned path should be relative
    expect(result.data!.archived_path.startsWith("/")).toBe(false);

    // The file at the returned relative path must actually exist
    const fullPath = path.join(tmpDir, result.data!.archived_path);
    expect(fs.existsSync(fullPath)).toBe(true);

    // Must match the expected location
    expect(result.data!.archived_path).toBe(".specia/specs/verify-path.md");
  });

  it("returns IO_ERROR when archiveChange fails with write permissions", async () => {
    await setupCompletePipeline(tmpDir, "write-fail", true);

    // Make specs/ directory read-only to simulate write failure
    const specsDir = path.join(tmpDir, ".specia", "specs");
    fs.chmodSync(specsDir, 0o444);

    try {
      const result = await handleDone(
        { change_name: "write-fail" },
        tmpDir,
      );

      expect(result.status).toBe("error");
      expect(result.errors[0]!.code).toBe("IO_ERROR");
      expect(result.errors[0]!.message).toContain("Failed to archive");

      // Change directory must still exist (not deleted)
      const changeDir = path.join(tmpDir, ".specia", "changes", "write-fail");
      expect(fs.existsSync(changeDir)).toBe(true);
    } finally {
      fs.chmodSync(specsDir, 0o755);
    }
  });
});
