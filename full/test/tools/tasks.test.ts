/**
 * specia_tasks handler unit tests — REVIEW_REQUIRED gate, REVIEW_STALE, mitigation injection.
 *
 * Spec refs: Domain 2 (specia_tasks — all scenarios)
 * Design refs: Decision 3 (Mitigations feed into tasks)
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

let tmpDir: string;

/** Full pipeline: init → propose → spec → review → ready for tasks. */
async function setupFullPipeline(dir: string, changeName = "test-change") {
  await handleInit({ project_description: "Test project" }, dir);
  await handlePropose(
    { change_name: changeName, intent: "Test intent", scope: ["area"] },
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
          spoofing: {
            applicable: true,
            threats: [
              {
                id: "S-01",
                title: "Token spoofing",
                description: "Forge tokens",
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
        summary: {
          risk_level: "high",
          total_findings: 1,
          critical_findings: 0,
          mitigations_required: ["Validate token signatures"],
        },
      },
    },
    dir,
  );
}

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "specia-tasks-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("handleTasks — REVIEW_REQUIRED gate", () => {
  it("refuses to generate tasks when review is missing", async () => {
    await handleInit({ project_description: "Test" }, tmpDir);
    await handlePropose(
      { change_name: "no-review", intent: "intent", scope: ["a"] },
      tmpDir,
    );
    await handleSpec(
      {
        change_name: "no-review",
        requirements: [
          { name: "Req", description: "desc", scenarios: [] },
        ],
      },
      tmpDir,
    );

    const result = await handleTasks(
      { change_name: "no-review" },
      tmpDir,
    );

    expect(result.status).toBe("error");
    expect(result.errors[0]!.code).toBe("REVIEW_REQUIRED");
  });
});

describe("handleTasks — REVIEW_STALE detection", () => {
  it("refuses when spec changed after review", async () => {
    await setupFullPipeline(tmpDir);

    // Manually modify spec.md to invalidate the review hash
    const specPath = path.join(tmpDir, ".specia", "changes", "test-change", "spec.md");
    fs.writeFileSync(specPath, "# Modified spec with different content\n\nNew requirements added.");

    const result = await handleTasks(
      { change_name: "test-change" },
      tmpDir,
    );

    expect(result.status).toBe("error");
    expect(result.errors[0]!.code).toBe("REVIEW_STALE");
  });
});

describe("handleTasks — successful generation", () => {
  it("generates tasks.md with mitigation injection", async () => {
    await setupFullPipeline(tmpDir);

    const result = await handleTasks(
      { change_name: "test-change" },
      tmpDir,
    );

    expect(result.status).toBe("success");
    expect(result.data!.tasks_path).toBe(".specia/changes/test-change/tasks.md");
    expect(result.data!.review_findings_used).toBe(true);
    expect(result.data!.spec_requirements_used).toBe(true);

    // Verify tasks.md content
    const tasksPath = path.join(tmpDir, ".specia", "changes", "test-change", "tasks.md");
    const content = fs.readFileSync(tasksPath, "utf-8");
    expect(content).toContain("# Tasks: test-change");
    expect(content).toContain("Security Mitigations");
  });

  it("includes mitigation tasks from review", async () => {
    await setupFullPipeline(tmpDir);

    const result = await handleTasks(
      { change_name: "test-change", include_mitigations: true },
      tmpDir,
    );

    expect(result.status).toBe("success");
    expect(result.data!.mitigation_tasks).toBeGreaterThan(0);

    const tasksPath = path.join(tmpDir, ".specia", "changes", "test-change", "tasks.md");
    const content = fs.readFileSync(tasksPath, "utf-8");
    expect(content).toContain("- [ ]"); // Checklist items
  });

  it("excludes mitigations when include_mitigations is false", async () => {
    await setupFullPipeline(tmpDir);

    const result = await handleTasks(
      { change_name: "test-change", include_mitigations: false },
      tmpDir,
    );

    expect(result.status).toBe("success");
    expect(result.data!.mitigation_tasks).toBe(0);
  });

  it("updates state to tasks phase complete", async () => {
    await setupFullPipeline(tmpDir);

    await handleTasks(
      { change_name: "test-change" },
      tmpDir,
    );

    const statePath = path.join(tmpDir, ".specia", "changes", "test-change", "state.yaml");
    const state = fs.readFileSync(statePath, "utf-8");
    expect(state).toContain("tasks");
    expect(state).toContain("complete");
  });
});

describe("handleTasks — error cases", () => {
  it("returns NOT_INITIALIZED when project not initialized", async () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "specia-tasks-empty-"));

    const result = await handleTasks(
      { change_name: "test-change" },
      emptyDir,
    );

    expect(result.status).toBe("error");
    expect(result.errors[0]!.code).toBe("NOT_INITIALIZED");

    fs.rmSync(emptyDir, { recursive: true, force: true });
  });

  it("returns MISSING_DEPENDENCY when spec is missing", async () => {
    await handleInit({ project_description: "Test" }, tmpDir);
    await handlePropose(
      { change_name: "no-spec", intent: "intent", scope: ["a"] },
      tmpDir,
    );

    const result = await handleTasks(
      { change_name: "no-spec" },
      tmpDir,
    );

    expect(result.status).toBe("error");
    expect(result.errors[0]!.code).toBe("MISSING_DEPENDENCY");
  });

  it("returns VALIDATION_ERROR for invalid change name", async () => {
    const result = await handleTasks(
      { change_name: "INVALID NAME!" },
      tmpDir,
    );

    expect(result.status).toBe("error");
    expect(result.errors[0]!.code).toBe("VALIDATION_ERROR");
  });
});
