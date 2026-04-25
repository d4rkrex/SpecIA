/**
 * Phase 2 v0.2 tests — Design Phase: Tool Handler, State Machine, Integration.
 *
 * Covers tasks 2.1 through 2.8 of the v0.2 task breakdown.
 * Tests specia_design (two-phase), state transitions, and integration
 * with review, tasks, continue, ff, and MCP server.
 *
 * Spec refs: v0.2 Spec — Domain 1 (Design Phase)
 * Design refs: Decision 9 (DAG branch), Decision 10 (Template-driven),
 *              Decision 11 (Design context in review/tasks), Decision 12 (Design in ff)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import { handleInit } from "../src/tools/init.js";
import { handlePropose } from "../src/tools/propose.js";
import { handleSpec } from "../src/tools/spec.js";
import { handleDesign } from "../src/tools/design.js";
import { handleReview } from "../src/tools/review.js";
import { handleTasks } from "../src/tools/tasks.js";
import { handleContinue } from "../src/tools/continue.js";
import { handleFf } from "../src/tools/ff.js";
import { computeSpecHash } from "../src/services/cache.js";

// ── Test fixtures ────────────────────────────────────────────────────

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
  change: "design-test",
  posture: "standard",
  timestamp: new Date().toISOString(),
  spec_hash: "", // set dynamically
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

const SAMPLE_DESIGN_CONTENT = `# Design: design-test

## Technical Approach

Use a layered architecture with clear separation of concerns.
Authentication will be handled by a dedicated auth service module.

## Architecture Decisions

### Decision: Use bcrypt for password hashing

**Choice**: bcrypt with 12 rounds
**Alternatives considered**: scrypt, argon2
**Rationale**: Widely supported, proven security track record, good balance of speed and security.

## Component Design

- AuthService: handles login/logout
- SessionStore: manages JWT tokens

## File Changes

| File | Action | Description |
|------|--------|-------------|
| src/auth/service.ts | Create | Auth service module |
| src/auth/session.ts | Create | Session management |
`;

/** Helper: set up an initialized project with proposal + spec. */
async function setupProposalAndSpec(changeName: string): Promise<void> {
  await handlePropose({
    change_name: changeName,
    intent: "Add authentication",
    scope: ["auth"],
  }, tmpDir);
  await handleSpec({
    change_name: changeName,
    requirements: SAMPLE_REQUIREMENTS,
  }, tmpDir);
}

/** Helper: get spec hash for a change. */
function getSpecHash(changeName: string): string {
  const specPath = path.join(tmpDir, ".specia", "changes", changeName, "spec.md");
  const specContent = fs.readFileSync(specPath, "utf-8");
  return computeSpecHash(specContent);
}

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "specia-v02-phase2-"));
  await handleInit({ project_description: "Test project for design phase" }, tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── Task 2.1: specia_design tool handler (two-phase) ─────────────────

describe("Task 2.1: specia_design tool handler", () => {
  it("Phase 1: returns design prompt when no design_content provided", async () => {
    await setupProposalAndSpec("design-test");

    const result = await handleDesign({
      change_name: "design-test",
    }, tmpDir);

    expect(result.status).toBe("success");
    expect(result.data).toHaveProperty("design_prompt");
    expect(result.data).toHaveProperty("instructions");
    expect(result.data).toHaveProperty("change_name", "design-test");
    // Design prompt should include proposal and spec context
    const prompt = (result.data as { design_prompt: string }).design_prompt;
    expect(prompt).toContain("Proposal");
    expect(prompt).toContain("Specification");
    expect(prompt).toContain("Design Template");
  });

  it("Phase 2: saves design.md when design_content provided", async () => {
    await setupProposalAndSpec("design-test");

    const result = await handleDesign({
      change_name: "design-test",
      design_content: SAMPLE_DESIGN_CONTENT,
    }, tmpDir);

    expect(result.status).toBe("success");
    expect(result.data).toHaveProperty("design_path");
    expect(result.data).toHaveProperty("message");

    // Verify file was written
    const designPath = path.join(tmpDir, ".specia", "changes", "design-test", "design.md");
    expect(fs.existsSync(designPath)).toBe(true);
    const content = fs.readFileSync(designPath, "utf-8");
    expect(content).toBe(SAMPLE_DESIGN_CONTENT);
  });

  it("Phase 2: rejects design_content that is too short", async () => {
    await setupProposalAndSpec("design-test");

    const result = await handleDesign({
      change_name: "design-test",
      design_content: "Too short",
    }, tmpDir);

    expect(result.status).toBe("error");
    expect(result.errors[0]!.code).toBe("VALIDATION_ERROR");
    expect(result.errors[0]!.message).toContain("too short");
  });

  it("returns NOT_INITIALIZED when project not initialized", async () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "specia-empty-"));

    const result = await handleDesign({
      change_name: "design-test",
    }, emptyDir);

    expect(result.status).toBe("error");
    expect(result.errors[0]!.code).toBe("NOT_INITIALIZED");

    fs.rmSync(emptyDir, { recursive: true, force: true });
  });

  it("returns CHANGE_NOT_FOUND for nonexistent change", async () => {
    const result = await handleDesign({
      change_name: "nonexistent",
    }, tmpDir);

    expect(result.status).toBe("error");
    expect(result.errors[0]!.code).toBe("CHANGE_NOT_FOUND");
  });

  it("returns MISSING_DEPENDENCY when spec does not exist", async () => {
    await handlePropose({
      change_name: "design-test",
      intent: "Test",
      scope: ["test"],
    }, tmpDir);

    const result = await handleDesign({
      change_name: "design-test",
    }, tmpDir);

    expect(result.status).toBe("error");
    expect(result.errors[0]!.code).toBe("MISSING_DEPENDENCY");
    expect(result.errors[0]!.message).toContain("Spec must exist");
  });

  it("returns VALIDATION_ERROR for invalid change name", async () => {
    const result = await handleDesign({
      change_name: "Bad Name!",
    }, tmpDir);

    expect(result.status).toBe("error");
    expect(result.errors[0]!.code).toBe("VALIDATION_ERROR");
  });
});

// ── Task 2.2: State machine transitions ──────────────────────────────

describe("Task 2.2: State machine — design phase transitions", () => {
  it("design phase is recorded in state.yaml after Phase 2", async () => {
    await setupProposalAndSpec("design-test");

    await handleDesign({
      change_name: "design-test",
      design_content: SAMPLE_DESIGN_CONTENT,
    }, tmpDir);

    const statePath = path.join(tmpDir, ".specia", "changes", "design-test", "state.yaml");
    const stateContent = fs.readFileSync(statePath, "utf-8");
    expect(stateContent).toContain("design");
  });

  it("Path B: spec → design → review → tasks works", async () => {
    await setupProposalAndSpec("design-test");

    // Design
    const designResult = await handleDesign({
      change_name: "design-test",
      design_content: SAMPLE_DESIGN_CONTENT,
    }, tmpDir);
    expect(designResult.status).toBe("success");

    // Review Phase 1 (prompt)
    const reviewP1 = await handleReview({
      change_name: "design-test",
    }, tmpDir);
    expect(reviewP1.status).toBe("success");

    // Review Phase 2 (submit result)
    const hash = getSpecHash("design-test");
    const reviewP2 = await handleReview({
      change_name: "design-test",
      review_result: { ...SAMPLE_REVIEW_RESULT, spec_hash: hash },
    }, tmpDir);
    expect(reviewP2.status).toBe("success");

    // Tasks
    const tasksResult = await handleTasks({
      change_name: "design-test",
    }, tmpDir);
    expect(tasksResult.status).toBe("success");
  });

  it("Path A: spec → review → tasks works (skip design)", async () => {
    await setupProposalAndSpec("design-test");

    // Review directly (no design)
    const reviewP1 = await handleReview({
      change_name: "design-test",
    }, tmpDir);
    expect(reviewP1.status).toBe("success");

    const hash = getSpecHash("design-test");
    const reviewP2 = await handleReview({
      change_name: "design-test",
      review_result: { ...SAMPLE_REVIEW_RESULT, spec_hash: hash },
    }, tmpDir);
    expect(reviewP2.status).toBe("success");

    // Tasks (without design)
    const tasksResult = await handleTasks({
      change_name: "design-test",
    }, tmpDir);
    expect(tasksResult.status).toBe("success");
  });
});

// ── Task 2.3: Review includes design content ─────────────────────────

describe("Task 2.3: specia_review detects and includes design content", () => {
  it("review Phase 1 includes designContent in prompt when design.md exists", async () => {
    await setupProposalAndSpec("design-test");

    // Create design
    await handleDesign({
      change_name: "design-test",
      design_content: SAMPLE_DESIGN_CONTENT,
    }, tmpDir);

    // Get review prompt (Phase 1)
    const result = await handleReview({
      change_name: "design-test",
    }, tmpDir);

    expect(result.status).toBe("success");
    // Token optimization: design content is in analysis_request, context has metadata only
    const prompt = (result.data as { review_prompt: { context: { has_design: boolean }; analysis_request: string } }).review_prompt;
    expect(prompt.context.has_design).toBe(true);
    expect(prompt.analysis_request).toContain("bcrypt");
  });

  it("review Phase 1 works without design.md (has_design is false)", async () => {
    await setupProposalAndSpec("design-test");

    // Get review prompt without design
    const result = await handleReview({
      change_name: "design-test",
    }, tmpDir);

    expect(result.status).toBe("success");
    const prompt = (result.data as { review_prompt: { context: { has_design: boolean } } }).review_prompt;
    // has_design should be false
    expect(prompt.context.has_design).toBe(false);
  });

  it("review Phase 2 stores design_hash in state when design.md exists", async () => {
    await setupProposalAndSpec("design-test");

    // Create design
    await handleDesign({
      change_name: "design-test",
      design_content: SAMPLE_DESIGN_CONTENT,
    }, tmpDir);

    // Complete review
    const hash = getSpecHash("design-test");
    await handleReview({
      change_name: "design-test",
      review_result: { ...SAMPLE_REVIEW_RESULT, spec_hash: hash },
    }, tmpDir);

    // Check state for design_hash
    const statePath = path.join(tmpDir, ".specia", "changes", "design-test", "state.yaml");
    const stateContent = fs.readFileSync(statePath, "utf-8");
    expect(stateContent).toContain("design_hash");
  });

  it("review Phase 2 does NOT store design_hash when no design.md exists", async () => {
    await setupProposalAndSpec("design-test");

    // Complete review without design
    const hash = getSpecHash("design-test");
    await handleReview({
      change_name: "design-test",
      review_result: { ...SAMPLE_REVIEW_RESULT, spec_hash: hash },
    }, tmpDir);

    // Check state — should not have design_hash
    const statePath = path.join(tmpDir, ".specia", "changes", "design-test", "state.yaml");
    const stateContent = fs.readFileSync(statePath, "utf-8");
    expect(stateContent).not.toContain("design_hash");
  });
});

// ── Task 2.4: Tasks includes design decisions ────────────────────────

describe("Task 2.4: specia_tasks references design decisions", () => {
  it("tasks.md includes 'Design Decisions Reference' when design.md exists", async () => {
    await setupProposalAndSpec("design-test");

    // Create design
    await handleDesign({
      change_name: "design-test",
      design_content: SAMPLE_DESIGN_CONTENT,
    }, tmpDir);

    // Complete review
    const hash = getSpecHash("design-test");
    await handleReview({
      change_name: "design-test",
      review_result: { ...SAMPLE_REVIEW_RESULT, spec_hash: hash },
    }, tmpDir);

    // Generate tasks
    const result = await handleTasks({
      change_name: "design-test",
    }, tmpDir);
    expect(result.status).toBe("success");

    // Verify tasks.md contains design reference
    const tasksPath = path.join(tmpDir, ".specia", "changes", "design-test", "tasks.md");
    const tasksContent = fs.readFileSync(tasksPath, "utf-8");
    expect(tasksContent).toContain("Design Decisions Reference");
    expect(tasksContent).toContain("bcrypt");
    expect(tasksContent).toContain("+ design.md");
  });

  it("tasks.md does NOT include design section when no design.md exists", async () => {
    await setupProposalAndSpec("design-test");

    // Complete review without design
    const hash = getSpecHash("design-test");
    await handleReview({
      change_name: "design-test",
      review_result: { ...SAMPLE_REVIEW_RESULT, spec_hash: hash },
    }, tmpDir);

    // Generate tasks
    const result = await handleTasks({
      change_name: "design-test",
    }, tmpDir);
    expect(result.status).toBe("success");

    // Verify no design section
    const tasksPath = path.join(tmpDir, ".specia", "changes", "design-test", "tasks.md");
    const tasksContent = fs.readFileSync(tasksPath, "utf-8");
    expect(tasksContent).not.toContain("Design Decisions Reference");
    expect(tasksContent).not.toContain("+ design.md");
  });
});

// ── Task 2.5: specia_ff optional design step ─────────────────────────

describe("Task 2.5: specia_ff includes optional design step", () => {
  it("ff stops at design (optional) after spec when no design exists", async () => {
    await setupProposalAndSpec("ff-design");

    const result = await handleFf({
      change_name: "ff-design",
    }, tmpDir);

    expect(result.status).toBe("success");
    expect(result.data).toHaveProperty("stopped_at", "design");
    const needsInput = (result.data as { needs_input: { skip_hint?: string } }).needs_input;
    expect(needsInput).toBeDefined();
    expect(needsInput.skip_hint).toBeDefined();
  });

  it("ff saves design when design_content provided", async () => {
    await setupProposalAndSpec("ff-design");

    const result = await handleFf({
      change_name: "ff-design",
      design_content: SAMPLE_DESIGN_CONTENT,
    }, tmpDir);

    // Should proceed past design to review (where it stops for LLM input)
    expect(result.status).toBe("success");
    expect(result.data).toHaveProperty("stopped_at", "review");
    expect((result.data as { phases_completed: string[] }).phases_completed).toContain("design");

    // Verify design.md was written
    const designPath = path.join(tmpDir, ".specia", "changes", "ff-design", "design.md");
    expect(fs.existsSync(designPath)).toBe(true);
  });

  it("ff skips design when design.md already exists", async () => {
    await setupProposalAndSpec("ff-design");

    // Pre-create design
    await handleDesign({
      change_name: "ff-design",
      design_content: SAMPLE_DESIGN_CONTENT,
    }, tmpDir);

    const result = await handleFf({
      change_name: "ff-design",
    }, tmpDir);

    expect(result.status).toBe("success");
    expect(result.data).toHaveProperty("stopped_at", "review");
    expect((result.data as { phases_skipped: string[] }).phases_skipped).toContain("design");
  });

  it("ff skips design when review is already done (design implicitly skipped)", async () => {
    await setupProposalAndSpec("ff-design");

    // Complete review (skip design entirely — Path A)
    const hash = getSpecHash("ff-design");
    await handleReview({
      change_name: "ff-design",
      review_result: { ...SAMPLE_REVIEW_RESULT, change: "ff-design", spec_hash: hash },
    }, tmpDir);

    const result = await handleFf({
      change_name: "ff-design",
    }, tmpDir);

    expect(result.status).toBe("success");
    // Design should be skipped (review already done, so design was implicitly skipped)
    expect((result.data as { phases_skipped: string[] }).phases_skipped).toContain("design");
    // Should complete tasks
    expect((result.data as { phases_completed: string[] }).phases_completed).toContain("tasks");
    expect(result.data).toHaveProperty("tasks_path");
  });

  it("ff completes all phases through tasks with design_content in one call", async () => {
    // Set up only proposal (no spec yet) — ff will stop at spec
    await handlePropose({
      change_name: "ff-design",
      intent: "Add auth",
      scope: ["auth"],
    }, tmpDir);

    // Pre-create spec manually
    await handleSpec({
      change_name: "ff-design",
      requirements: SAMPLE_REQUIREMENTS,
    }, tmpDir);

    // Pre-create review
    const hash = getSpecHash("ff-design");
    await handleReview({
      change_name: "ff-design",
      review_result: { ...SAMPLE_REVIEW_RESULT, change: "ff-design", spec_hash: hash },
    }, tmpDir);

    // Now ff with design_content — should skip proposal+spec+review, complete design+tasks
    const result = await handleFf({
      change_name: "ff-design",
      design_content: SAMPLE_DESIGN_CONTENT,
    }, tmpDir);

    expect(result.status).toBe("success");
    expect((result.data as { phases_completed: string[] }).phases_completed).toContain("design");
    expect((result.data as { phases_completed: string[] }).phases_completed).toContain("tasks");
    expect(result.data).toHaveProperty("tasks_path");
  });
});

// ── Task 2.6: specia_continue suggests design ────────────────────────

describe("Task 2.6: specia_continue detects design as next step", () => {
  it("suggests specia_design (optional) after spec is complete", async () => {
    await setupProposalAndSpec("continue-design");

    const result = await handleContinue({
      change_name: "continue-design",
    }, tmpDir);

    expect(result.status).toBe("success");
    expect(result.data).toHaveProperty("next_tool", "specia_design");
    expect(result.data).toHaveProperty("optional", true);
    expect(result.data).toHaveProperty("current_phase", "spec");
  });

  it("suggests specia_review after design is complete", async () => {
    await setupProposalAndSpec("continue-design");

    await handleDesign({
      change_name: "continue-design",
      design_content: SAMPLE_DESIGN_CONTENT,
    }, tmpDir);

    const result = await handleContinue({
      change_name: "continue-design",
    }, tmpDir);

    expect(result.status).toBe("success");
    expect(result.data).toHaveProperty("next_tool", "specia_review");
    expect(result.data).toHaveProperty("current_phase", "design");
  });

  it("suggests specia_review after spec when design already exists on disk", async () => {
    await setupProposalAndSpec("continue-design");

    // Write design directly (not through design tool) to simulate existing design.md
    const designDir = path.join(tmpDir, ".specia", "changes", "continue-design");
    fs.writeFileSync(path.join(designDir, "design.md"), SAMPLE_DESIGN_CONTENT);

    const result = await handleContinue({
      change_name: "continue-design",
    }, tmpDir);

    expect(result.status).toBe("success");
    // Should suggest review since design already exists
    expect(result.data).toHaveProperty("next_tool", "specia_review");
  });

  it("suggests specia_tasks after review is complete", async () => {
    await setupProposalAndSpec("continue-design");

    // Complete design + review
    await handleDesign({
      change_name: "continue-design",
      design_content: SAMPLE_DESIGN_CONTENT,
    }, tmpDir);

    const hash = getSpecHash("continue-design");
    await handleReview({
      change_name: "continue-design",
      review_result: { ...SAMPLE_REVIEW_RESULT, change: "continue-design", spec_hash: hash },
    }, tmpDir);

    const result = await handleContinue({
      change_name: "continue-design",
    }, tmpDir);

    expect(result.status).toBe("success");
    expect(result.data).toHaveProperty("next_tool", "specia_tasks");
  });
});

// ── Task 2.7: specia_design registered in MCP server ─────────────────

describe("Task 2.7: specia_design in MCP tool definitions", () => {
  it("DesignInputSchema validates correct input", async () => {
    const { DesignInputSchema } = await import("../src/tools/schemas.js");

    const valid = DesignInputSchema.safeParse({
      change_name: "test-design",
      design_content: "Some content here that is long enough to pass validation",
    });
    expect(valid.success).toBe(true);
  });

  it("DesignInputSchema allows omitting design_content (Phase 1)", async () => {
    const { DesignInputSchema } = await import("../src/tools/schemas.js");

    const valid = DesignInputSchema.safeParse({
      change_name: "test-design",
    });
    expect(valid.success).toBe(true);
  });

  it("DesignInputSchema rejects invalid change name", async () => {
    const { DesignInputSchema } = await import("../src/tools/schemas.js");

    const invalid = DesignInputSchema.safeParse({
      change_name: "Bad Name!",
    });
    expect(invalid.success).toBe(false);
  });
});

// ── Task 2.8: Full E2E workflow with design (Path B) ─────────────────

describe("Task 2.8: Full E2E workflow — Path B with design", () => {
  it("completes full workflow: init → propose → spec → design → review → tasks → done", async () => {
    const changeName = "e2e-design";

    // Propose
    const proposeResult = await handlePropose({
      change_name: changeName,
      intent: "Add user authentication",
      scope: ["auth", "api"],
    }, tmpDir);
    expect(proposeResult.status).toBe("success");

    // Spec
    const specResult = await handleSpec({
      change_name: changeName,
      requirements: SAMPLE_REQUIREMENTS,
    }, tmpDir);
    expect(specResult.status).toBe("success");

    // Design (Phase 1 — get prompt)
    const designP1 = await handleDesign({
      change_name: changeName,
    }, tmpDir);
    expect(designP1.status).toBe("success");
    expect(designP1.data).toHaveProperty("design_prompt");

    // Design (Phase 2 — submit content)
    const designP2 = await handleDesign({
      change_name: changeName,
      design_content: SAMPLE_DESIGN_CONTENT,
    }, tmpDir);
    expect(designP2.status).toBe("success");

    // Continue → should suggest review
    const cont1 = await handleContinue({ change_name: changeName }, tmpDir);
    expect(cont1.status).toBe("success");
    expect(cont1.data).toHaveProperty("next_tool", "specia_review");

    // Review (Phase 1 — get prompt)
    const reviewP1 = await handleReview({ change_name: changeName }, tmpDir);
    expect(reviewP1.status).toBe("success");

    // Review (Phase 2 — submit result)
    const hash = getSpecHash(changeName);
    const reviewP2 = await handleReview({
      change_name: changeName,
      review_result: { ...SAMPLE_REVIEW_RESULT, change: changeName, spec_hash: hash },
    }, tmpDir);
    expect(reviewP2.status).toBe("success");

    // Tasks
    const tasksResult = await handleTasks({ change_name: changeName }, tmpDir);
    expect(tasksResult.status).toBe("success");

    // Verify all artifacts exist
    const changeDir = path.join(tmpDir, ".specia", "changes", changeName);
    expect(fs.existsSync(path.join(changeDir, "proposal.md"))).toBe(true);
    expect(fs.existsSync(path.join(changeDir, "spec.md"))).toBe(true);
    expect(fs.existsSync(path.join(changeDir, "design.md"))).toBe(true);
    expect(fs.existsSync(path.join(changeDir, "review.md"))).toBe(true);
    expect(fs.existsSync(path.join(changeDir, "tasks.md"))).toBe(true);

    // Verify tasks.md references design
    const tasksContent = fs.readFileSync(path.join(changeDir, "tasks.md"), "utf-8");
    expect(tasksContent).toContain("Design Decisions Reference");
  });

  it("completes full workflow Path A without design: init → propose → spec → review → tasks", async () => {
    const changeName = "e2e-no-design";

    // Propose
    await handlePropose({
      change_name: changeName,
      intent: "Simple change",
      scope: ["api"],
    }, tmpDir);

    // Spec
    await handleSpec({
      change_name: changeName,
      requirements: SAMPLE_REQUIREMENTS,
    }, tmpDir);

    // Skip design, go straight to review
    const hash = getSpecHash(changeName);
    await handleReview({
      change_name: changeName,
      review_result: { ...SAMPLE_REVIEW_RESULT, change: changeName, spec_hash: hash },
    }, tmpDir);

    // Tasks
    const tasksResult = await handleTasks({ change_name: changeName }, tmpDir);
    expect(tasksResult.status).toBe("success");

    // Verify tasks.md does NOT reference design
    const changeDir = path.join(tmpDir, ".specia", "changes", changeName);
    expect(fs.existsSync(path.join(changeDir, "design.md"))).toBe(false);
    const tasksContent = fs.readFileSync(path.join(changeDir, "tasks.md"), "utf-8");
    expect(tasksContent).not.toContain("Design Decisions Reference");
  });
});
