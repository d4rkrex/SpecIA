/**
 * specia_review handler unit tests — two-phase review, caching.
 *
 * Spec refs: Domain 2 (specia_review — all scenarios),
 *            Domain 6 (Security Review Engine),
 *            Domain 8 (Smart Caching)
 * Design refs: Decision 3 (Two-Phase Review), Decision 5 (Smart Caching)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { handleInit } from "../../src/tools/init.js";
import { handlePropose } from "../../src/tools/propose.js";
import { handleSpec } from "../../src/tools/spec.js";
import { handleReview } from "../../src/tools/review.js";

let tmpDir: string;

/** Set up a project with init + proposal + spec so review can run. */
async function setupProjectWithSpec(dir: string, changeName = "test-change") {
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
}

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
    summary: {
      risk_level: "high",
      total_findings: 1,
      critical_findings: 0,
      mitigations_required: ["Validate token signatures"],
    },
  };
}

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "specia-review-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("handleReview — Phase 1 (prompt generation)", () => {
  it("returns a review prompt when no review_result provided", async () => {
    await setupProjectWithSpec(tmpDir);

    const result = await handleReview(
      { change_name: "test-change" },
      tmpDir,
    );

    expect(result.status).toBe("success");
    expect(result.data).not.toBeNull();

    // Phase 1 returns a prompt
    const data = result.data as Record<string, unknown>;
    expect(data.review_prompt).toBeTruthy();
    expect(data.spec_hash).toBeTruthy();
    expect(data.instructions).toBeTruthy();

    const prompt = data.review_prompt as Record<string, unknown>;
    expect(prompt.system_instructions).toBeTruthy();
    expect(prompt.analysis_request).toBeTruthy();
    expect(prompt.output_schema).toBeTruthy();
  });

  it("returns MISSING_DEPENDENCY when spec does not exist", async () => {
    await handleInit({ project_description: "Test" }, tmpDir);
    await handlePropose(
      { change_name: "no-spec", intent: "intent", scope: ["a"] },
      tmpDir,
    );

    const result = await handleReview(
      { change_name: "no-spec" },
      tmpDir,
    );

    expect(result.status).toBe("error");
    expect(result.errors[0]!.code).toBe("MISSING_DEPENDENCY");
  });

  it("returns NOT_INITIALIZED when project not initialized", async () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "specia-review-empty-"));

    const result = await handleReview(
      { change_name: "test-change" },
      emptyDir,
    );

    expect(result.status).toBe("error");
    expect(result.errors[0]!.code).toBe("NOT_INITIALIZED");

    fs.rmSync(emptyDir, { recursive: true, force: true });
  });
});

describe("handleReview — Phase 2 (result submission)", () => {
  it("validates and saves review result, creates review.md", async () => {
    await setupProjectWithSpec(tmpDir);

    const result = await handleReview(
      {
        change_name: "test-change",
        review_result: makeMinimalReviewResult(),
      },
      tmpDir,
    );

    expect(result.status).toBe("success");
    const data = result.data as Record<string, unknown>;
    expect(data.review_path).toBe(".specia/changes/test-change/review.md");
    expect(data.findings_count).toBe(1);
    expect(data.cached).toBe(false);

    // Verify review.md exists
    const reviewPath = path.join(tmpDir, ".specia", "changes", "test-change", "review.md");
    expect(fs.existsSync(reviewPath)).toBe(true);
    const content = fs.readFileSync(reviewPath, "utf-8");
    expect(content).toContain("spec_hash:");
    expect(content).toContain("STRIDE Analysis");
    expect(content).toContain("S-01");
  });

  it("returns VALIDATION_ERROR for invalid review_result", async () => {
    await setupProjectWithSpec(tmpDir);

    const result = await handleReview(
      {
        change_name: "test-change",
        review_result: "not a json object",
      },
      tmpDir,
    );

    expect(result.status).toBe("error");
    expect(result.errors[0]!.code).toBe("VALIDATION_ERROR");
  });

  it("returns VALIDATION_ERROR when stride is missing", async () => {
    await setupProjectWithSpec(tmpDir);

    const result = await handleReview(
      {
        change_name: "test-change",
        review_result: { summary: { risk_level: "low" } },
      },
      tmpDir,
    );

    expect(result.status).toBe("error");
    expect(result.errors[0]!.code).toBe("VALIDATION_ERROR");
  });
});

describe("handleReview — Smart Caching", () => {
  it("returns cached status when spec unchanged since last review", async () => {
    await setupProjectWithSpec(tmpDir);

    // Phase 2: submit review
    await handleReview(
      {
        change_name: "test-change",
        review_result: makeMinimalReviewResult(),
      },
      tmpDir,
    );

    // Phase 1 again: should get cache hit
    const result = await handleReview(
      { change_name: "test-change" },
      tmpDir,
    );

    expect(result.status).toBe("cached");
    const data = result.data as Record<string, unknown>;
    expect(data.cached).toBe(true);
  });

  it("bypasses cache when force is true", async () => {
    await setupProjectWithSpec(tmpDir);

    // Submit review
    await handleReview(
      {
        change_name: "test-change",
        review_result: makeMinimalReviewResult(),
      },
      tmpDir,
    );

    // Force re-review
    const result = await handleReview(
      { change_name: "test-change", force: true },
      tmpDir,
    );

    // Should return a new prompt, not cached
    expect(result.status).toBe("success");
    const data = result.data as Record<string, unknown>;
    expect(data.review_prompt).toBeTruthy();
  });
});
