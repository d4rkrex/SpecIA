/**
 * specia_ff handler unit tests.
 *
 * Spec refs: Domain 3 (specia_ff — all scenarios)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { handleInit } from "../../src/tools/init.js";
import { handlePropose } from "../../src/tools/propose.js";
import { handleSpec } from "../../src/tools/spec.js";
import { handleReview } from "../../src/tools/review.js";
import { handleFf } from "../../src/tools/ff.js";

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
  change: "ff-test",
  posture: "standard",
  timestamp: new Date().toISOString(),
  spec_hash: "",
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

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "specia-ff-"));
  await handleInit({ project_description: "Test project" }, tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("handleFf", () => {
  it("returns NOT_INITIALIZED when project not initialized", async () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "specia-empty-"));

    const result = await handleFf(
      { change_name: "test" },
      emptyDir,
    );

    expect(result.status).toBe("error");
    expect(result.errors[0]!.code).toBe("NOT_INITIALIZED");

    fs.rmSync(emptyDir, { recursive: true, force: true });
  });

  it("returns VALIDATION_ERROR for invalid change name", async () => {
    const result = await handleFf(
      { change_name: "Bad Name!" },
      tmpDir,
    );

    expect(result.status).toBe("error");
    expect(result.errors[0]!.code).toBe("VALIDATION_ERROR");
  });

  it("stops at proposal when intent is missing", async () => {
    const result = await handleFf(
      { change_name: "ff-test" },
      tmpDir,
    );

    expect(result.status).toBe("success");
    expect(result.data).toHaveProperty("stopped_at", "proposal");
    expect(result.data).toHaveProperty("needs_input");
  });

  it("runs propose then stops at spec (needs LLM input)", async () => {
    const result = await handleFf({
      change_name: "ff-test",
      intent: "Add authentication",
      scope: ["auth"],
    }, tmpDir);

    expect(result.status).toBe("success");
    expect(result.data).toHaveProperty("stopped_at", "spec");
    expect((result.data as { phases_completed: string[] }).phases_completed).toContain("proposal");

    // Verify proposal was actually created
    const proposalPath = path.join(tmpDir, ".specia", "changes", "ff-test", "proposal.md");
    expect(fs.existsSync(proposalPath)).toBe(true);
  });

  it("skips propose if already done, stops at spec", async () => {
    // Pre-create proposal
    await handlePropose({
      change_name: "ff-test",
      intent: "Already proposed",
      scope: ["area"],
    }, tmpDir);

    const result = await handleFf({
      change_name: "ff-test",
    }, tmpDir);

    expect(result.status).toBe("success");
    expect(result.data).toHaveProperty("stopped_at", "spec");
    expect((result.data as { phases_skipped: string[] }).phases_skipped).toContain("proposal");
  });

  it("skips propose and spec, stops at design (optional) when no design exists", async () => {
    await handlePropose({
      change_name: "ff-test",
      intent: "Already proposed",
      scope: ["area"],
    }, tmpDir);
    await handleSpec({
      change_name: "ff-test",
      requirements: SAMPLE_REQUIREMENTS,
    }, tmpDir);

    const result = await handleFf({
      change_name: "ff-test",
    }, tmpDir);

    expect(result.status).toBe("success");
    // v0.2: ff now stops at optional design step before review
    expect(result.data).toHaveProperty("stopped_at", "design");
    expect((result.data as { phases_skipped: string[] }).phases_skipped).toContain("proposal");
    expect((result.data as { phases_skipped: string[] }).phases_skipped).toContain("spec");
    expect((result.data as { needs_input: { skip_hint: string } }).needs_input.skip_hint).toBeDefined();
  });

  it("completes all phases when all are already done except tasks", async () => {
    await handlePropose({
      change_name: "ff-test",
      intent: "Already proposed",
      scope: ["area"],
    }, tmpDir);
    await handleSpec({
      change_name: "ff-test",
      requirements: SAMPLE_REQUIREMENTS,
    }, tmpDir);

    // Get spec hash for review
    const specPath = path.join(tmpDir, ".specia", "changes", "ff-test", "spec.md");
    const specContent = fs.readFileSync(specPath, "utf-8");
    const { computeSpecHash } = await import("../../src/services/cache.js");
    const hash = computeSpecHash(specContent);

    await handleReview({
      change_name: "ff-test",
      review_result: { ...SAMPLE_REVIEW_RESULT, spec_hash: hash },
    }, tmpDir);

    const result = await handleFf({
      change_name: "ff-test",
    }, tmpDir);

    expect(result.status).toBe("success");
    expect((result.data as { phases_completed: string[] }).phases_completed).toContain("tasks");
    expect((result.data as { tasks_path: string }).tasks_path).toContain("ff-test/tasks.md");
    expect((result.data as { message: string }).message).toContain("complete");
  });

  it("stops at proposal when intent is provided but scope is empty", async () => {
    // ff should forward the validation error from propose if scope is empty
    const result = await handleFf({
      change_name: "ff-test",
      intent: "Do something",
      scope: [],
    }, tmpDir);

    // With empty scope, ff won't attempt propose (scope has 0 items), 
    // so it stops at proposal needing input
    expect(result.status).toBe("success");
    expect(result.data).toHaveProperty("stopped_at", "proposal");
  });
});
