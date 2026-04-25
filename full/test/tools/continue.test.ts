/**
 * specia_continue handler unit tests.
 *
 * Spec refs: Domain 3 (specia_continue — all scenarios),
 *            Domain 5 (specia_continue Update — audit flow)
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
import { handleContinue } from "../../src/tools/continue.js";
import { FileStore } from "../../src/services/store.js";

let tmpDir: string;

const SAMPLE_REQUIREMENTS = [
  {
    name: "User login",
    description: "Users can log in with email/password",
    scenarios: [
      {
        name: "Successful login",
        given: "valid credentials",
        when: "user submits login form",
        then: "user is authenticated",
      },
    ],
  },
];

const SAMPLE_REVIEW_RESULT = {
  change: "test-change",
  posture: "standard",
  timestamp: new Date().toISOString(),
  spec_hash: "", // will be set dynamically
  stride: {
    spoofing: { applicable: true, threats: [{ id: "S-01", title: "Credential stuffing", description: "Attackers may use stolen credentials", severity: "high", mitigation: "Rate limiting", affected_components: ["auth"] }] },
    tampering: { applicable: false, threats: [] },
    repudiation: { applicable: false, threats: [] },
    information_disclosure: { applicable: false, threats: [] },
    denial_of_service: { applicable: false, threats: [] },
    elevation_of_privilege: { applicable: false, threats: [] },
  },
  summary: {
    risk_level: "medium",
    total_findings: 1,
    critical_findings: 0,
    mitigations_required: ["Implement rate limiting on login endpoint"],
  },
};

/** Helper: run propose → spec → review → tasks pipeline. */
async function setupThroughTasks(dir: string, changeName = "my-change") {
  await handlePropose({
    change_name: changeName,
    intent: "Do something",
    scope: ["area"],
  }, dir);
  await handleSpec({
    change_name: changeName,
    requirements: SAMPLE_REQUIREMENTS,
  }, dir);

  const specPath = path.join(dir, ".specia", "changes", changeName, "spec.md");
  const specContent = fs.readFileSync(specPath, "utf-8");
  const { computeSpecHash } = await import("../../src/services/cache.js");
  const hash = computeSpecHash(specContent);

  await handleReview({
    change_name: changeName,
    review_result: { ...SAMPLE_REVIEW_RESULT, spec_hash: hash },
  }, dir);
  await handleTasks({ change_name: changeName }, dir);
}

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "specia-continue-"));
  await handleInit({ project_description: "Test project" }, tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("handleContinue", () => {
  it("returns CHANGE_NOT_FOUND for nonexistent change", async () => {
    const result = await handleContinue(
      { change_name: "nonexistent" },
      tmpDir,
    );

    expect(result.status).toBe("error");
    expect(result.errors[0]!.code).toBe("CHANGE_NOT_FOUND");
  });

  it("returns NOT_INITIALIZED when project not initialized", async () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "specia-empty-"));

    const result = await handleContinue(
      { change_name: "test" },
      emptyDir,
    );

    expect(result.status).toBe("error");
    expect(result.errors[0]!.code).toBe("NOT_INITIALIZED");

    fs.rmSync(emptyDir, { recursive: true, force: true });
  });

  it("returns VALIDATION_ERROR for invalid change name", async () => {
    const result = await handleContinue(
      { change_name: "Bad Name!" },
      tmpDir,
    );

    expect(result.status).toBe("error");
    expect(result.errors[0]!.code).toBe("VALIDATION_ERROR");
  });

  it("recommends specia_spec after proposal is complete", async () => {
    await handlePropose({
      change_name: "my-change",
      intent: "Do something",
      scope: ["area"],
    }, tmpDir);

    const result = await handleContinue(
      { change_name: "my-change" },
      tmpDir,
    );

    expect(result.status).toBe("success");
    expect(result.data).toHaveProperty("next_tool", "specia_spec");
    expect(result.data).toHaveProperty("current_phase", "proposal");
  });

  it("recommends specia_design (optional) after spec is complete", async () => {
    await handlePropose({
      change_name: "my-change",
      intent: "Do something",
      scope: ["area"],
    }, tmpDir);
    await handleSpec({
      change_name: "my-change",
      requirements: SAMPLE_REQUIREMENTS,
    }, tmpDir);

    const result = await handleContinue(
      { change_name: "my-change" },
      tmpDir,
    );

    expect(result.status).toBe("success");
    // v0.2: After spec, design is suggested as optional next step
    expect(result.data).toHaveProperty("next_tool", "specia_design");
    expect(result.data).toHaveProperty("current_phase", "spec");
    expect(result.data).toHaveProperty("optional", true);
  });

  it("recommends specia_tasks after review is complete", async () => {
    await handlePropose({
      change_name: "my-change",
      intent: "Do something",
      scope: ["area"],
    }, tmpDir);
    await handleSpec({
      change_name: "my-change",
      requirements: SAMPLE_REQUIREMENTS,
    }, tmpDir);

    // Get spec hash for review
    const specPath = path.join(tmpDir, ".specia", "changes", "my-change", "spec.md");
    const specContent = fs.readFileSync(specPath, "utf-8");
    const { computeSpecHash } = await import("../../src/services/cache.js");
    const hash = computeSpecHash(specContent);

    // Submit review
    await handleReview({
      change_name: "my-change",
      review_result: { ...SAMPLE_REVIEW_RESULT, spec_hash: hash },
    }, tmpDir);

    const result = await handleContinue(
      { change_name: "my-change" },
      tmpDir,
    );

    expect(result.status).toBe("success");
    expect(result.data).toHaveProperty("next_tool", "specia_tasks");
    expect(result.data).toHaveProperty("current_phase", "review");
  });

  it("suggests specia_audit (mandatory) when tasks are done and audit_policy is required", async () => {
    await setupThroughTasks(tmpDir);

    const result = await handleContinue(
      { change_name: "my-change" },
      tmpDir,
    );

    expect(result.status).toBe("success");
    expect(result.data).toHaveProperty("next_tool", "specia_audit");
    expect(result.data).toHaveProperty("optional", false);
    expect((result.data as { message: string }).message).toContain("MANDATORY");
  });
});

// ── v0.3: Audit phase transitions ────────────────────────────────────

describe("handleContinue — v0.3 audit phase", () => {
  it("suggests specia_done after audit is complete", async () => {
    await setupThroughTasks(tmpDir, "audit-change");

    // Simulate audit completion by transitioning state
    const store = new FileStore(tmpDir);
    store.writeArtifact("audit-change", "audit", "---\noverall_verdict: pass\n---\n# Audit");
    store.transitionPhase("audit-change", "audit", "complete", {
      audit_hash: "sha256:abc123",
      audit_posture: "standard",
    });

    const result = await handleContinue(
      { change_name: "audit-change" },
      tmpDir,
    );

    expect(result.status).toBe("success");
    // After audit complete, it should return "all done" suggesting specia_done
    expect(result.data).toHaveProperty("next_tool", "specia_done");
    expect((result.data as { message: string }).message).toContain("specia_done");
  });

  it("suggests re-running audit with force when audit is stale", async () => {
    await setupThroughTasks(tmpDir, "stale-audit");

    // Simulate a completed but stale audit
    const store = new FileStore(tmpDir);
    store.writeArtifact("stale-audit", "audit", "---\noverall_verdict: pass\n---\n# Audit");
    // Transition to tasks with stale flag set (as if code changed after audit)
    store.transitionPhase("stale-audit", "tasks", "complete", {
      audit_hash: "sha256:old-hash",
      audit_posture: "standard",
      audit_stale: true,
    });

    const result = await handleContinue(
      { change_name: "stale-audit" },
      tmpDir,
    );

    expect(result.status).toBe("success");
    expect(result.data).toHaveProperty("next_tool", "specia_audit");
    // audit is mandatory by default (audit_policy: "required")
    expect(result.data).toHaveProperty("optional", false);
    expect((result.data as { message: string }).message).toContain("stale");
    expect((result.data as { next_params: string }).next_params).toContain("force: true");
  });

  it("suggests retry when audit phase has failed", async () => {
    await setupThroughTasks(tmpDir, "failed-audit");

    // Simulate audit failure
    const store = new FileStore(tmpDir);
    store.transitionPhase("failed-audit", "audit", "failed");

    const result = await handleContinue(
      { change_name: "failed-audit" },
      tmpDir,
    );

    expect(result.status).toBe("success");
    expect(result.data).toHaveProperty("next_tool", "specia_audit");
    expect(result.data).toHaveProperty("current_status", "failed");
    expect((result.data as { message: string }).message).toContain("failed");
    expect((result.data as { message: string }).message).toContain("Retry");
  });
});
