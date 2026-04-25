/**
 * specia_spec handler unit tests.
 *
 * Spec refs: Domain 2 (specia_spec — all scenarios)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { handleInit } from "../../src/tools/init.js";
import { handlePropose } from "../../src/tools/propose.js";
import { handleSpec } from "../../src/tools/spec.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "specia-spec-"));
  await handleInit({ project_description: "Test project" }, tmpDir);
  await handlePropose(
    { change_name: "test-change", intent: "Test intent", scope: ["area"] },
    tmpDir,
  );
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("handleSpec", () => {
  it("creates spec.md with requirements and scenarios", async () => {
    const result = await handleSpec(
      {
        change_name: "test-change",
        requirements: [
          {
            name: "Auth",
            description: "Authentication requirements",
            scenarios: [
              {
                name: "Happy path",
                given: "valid credentials",
                when: "user logs in",
                then: "token is returned",
              },
            ],
          },
        ],
      },
      tmpDir,
    );

    expect(result.status).toBe("success");
    expect(result.data!.spec_path).toBe(".specia/changes/test-change/spec.md");
    expect(result.data!.requirements_count).toBe(1);
    expect(result.data!.scenarios_count).toBe(1);

    // Verify file content
    const specPath = path.join(tmpDir, ".specia", "changes", "test-change", "spec.md");
    const content = fs.readFileSync(specPath, "utf-8");
    expect(content).toContain("# Specification: test-change");
    expect(content).toContain("### 1. Auth");
    expect(content).toContain("**GIVEN** valid credentials");
  });

  it("counts multiple requirements and scenarios", async () => {
    const result = await handleSpec(
      {
        change_name: "test-change",
        requirements: [
          {
            name: "Req 1",
            description: "First",
            scenarios: [
              { name: "S1", given: "g1", when: "w1", then: "t1" },
              { name: "S2", given: "g2", when: "w2", then: "t2" },
            ],
          },
          {
            name: "Req 2",
            description: "Second",
            scenarios: [
              { name: "S3", given: "g3", when: "w3", then: "t3" },
            ],
          },
        ],
      },
      tmpDir,
    );

    expect(result.status).toBe("success");
    expect(result.data!.requirements_count).toBe(2);
    expect(result.data!.scenarios_count).toBe(3);
  });

  it("returns MISSING_DEPENDENCY when proposal does not exist", async () => {
    // Create a new project dir without a proposal for this change
    const emptyChange = fs.mkdtempSync(path.join(os.tmpdir(), "specia-spec-empty-"));
    await handleInit({ project_description: "Test" }, emptyChange);

    const result = await handleSpec(
      {
        change_name: "no-proposal",
        requirements: [
          { name: "Req", description: "desc", scenarios: [] },
        ],
      },
      emptyChange,
    );

    expect(result.status).toBe("error");
    expect(result.errors[0]!.code).toBe("MISSING_DEPENDENCY");
    expect(result.errors[0]!.dependency).toBe("proposal");

    fs.rmSync(emptyChange, { recursive: true, force: true });
  });

  it("returns NOT_INITIALIZED when project not initialized", async () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "specia-uninit-"));

    const result = await handleSpec(
      {
        change_name: "test",
        requirements: [
          { name: "Req", description: "desc", scenarios: [] },
        ],
      },
      emptyDir,
    );

    expect(result.status).toBe("error");
    expect(result.errors[0]!.code).toBe("NOT_INITIALIZED");

    fs.rmSync(emptyDir, { recursive: true, force: true });
  });

  it("returns VALIDATION_ERROR for empty requirements array", async () => {
    const result = await handleSpec(
      { change_name: "test-change", requirements: [] },
      tmpDir,
    );

    expect(result.status).toBe("error");
    expect(result.errors[0]!.code).toBe("VALIDATION_ERROR");
  });

  it("updates state to spec phase complete", async () => {
    await handleSpec(
      {
        change_name: "test-change",
        requirements: [
          { name: "Req", description: "desc", scenarios: [] },
        ],
      },
      tmpDir,
    );

    const statePath = path.join(tmpDir, ".specia", "changes", "test-change", "state.yaml");
    const state = fs.readFileSync(statePath, "utf-8");
    expect(state).toContain("spec");
  });
});
