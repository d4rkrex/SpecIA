/**
 * Integration tests: Complete flow WITH design phase.
 *
 * Tests:
 * 1. Full v0.2 flow: init → propose → spec → design → review → tasks → done
 * 2. v0.1 flow (without design) still works end-to-end
 * 3. Design content is included as context in review and tasks
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { handleInit } from "../../src/tools/init.js";
import { handlePropose } from "../../src/tools/propose.js";
import { handleSpec } from "../../src/tools/spec.js";
import { handleDesign } from "../../src/tools/design.js";
import { handleReview } from "../../src/tools/review.js";
import { handleTasks } from "../../src/tools/tasks.js";
import { handleDone } from "../../src/tools/done.js";
import { handleContinue } from "../../src/tools/continue.js";
import { handleFf } from "../../src/tools/ff.js";
import { computeSpecHash } from "../../src/services/cache.js";

let tmpDir: string;

const SAMPLE_REQUIREMENTS = [
  {
    name: "User authentication",
    description: "Implement user login with email and password",
    scenarios: [
      {
        name: "Successful login",
        given: "a registered user with valid credentials",
        when: "the user submits the login form",
        then: "the user receives an auth token",
      },
    ],
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
          title: "Credential stuffing",
          description: "Automated attacks using stolen creds",
          severity: "high",
          mitigation: "Rate limiting and lockout",
          affected_components: ["auth"],
        }],
      },
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
      mitigations_required: ["Rate limiting and lockout"],
    },
  };
}

const DESIGN_CONTENT = `# Design: auth-system

## Technical Approach

Use JWT with RS256 signing for session management. Passwords hashed with bcrypt.

## Architecture Decisions

### Decision: JWT over sessions
**Choice**: JWT tokens with RS256
**Alternatives considered**: Server-side sessions
**Rationale**: Stateless auth scales better across service instances

## Component Design

- AuthController: Handles login/logout endpoints
- TokenService: Issues and validates JWTs
- PasswordService: bcrypt hashing and comparison

## Data Flow

User → AuthController → PasswordService (verify) → TokenService (issue) → Response
`;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "specia-design-flow-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("Integration: Full v0.2 flow WITH design phase", () => {
  it("init → propose → spec → design → review → tasks → done", async () => {
    // 1. Init
    const initResult = await handleInit({
      project_description: "Auth microservice",
      primary_stack: "TypeScript/Node.js",
      security_posture: "standard",
    }, tmpDir);
    expect(initResult.status).toBe("success");

    // 2. Propose
    const proposeResult = await handlePropose({
      change_name: "auth-system",
      intent: "Implement JWT auth",
      scope: ["auth", "session"],
      skip_audit: true, // Opt out of audit for this flow test
    }, tmpDir);
    expect(proposeResult.status).toBe("success");

    // 3. Spec
    const specResult = await handleSpec({
      change_name: "auth-system",
      requirements: SAMPLE_REQUIREMENTS,
    }, tmpDir);
    expect(specResult.status).toBe("success");

    // 4. Design (v0.2 feature)
    const designResult = await handleDesign({
      change_name: "auth-system",
      design_content: DESIGN_CONTENT,
    }, tmpDir);
    expect(designResult.status).toBe("success");
    expect(designResult.data).toHaveProperty("design_path");

    // Verify design.md was written
    const designPath = path.join(tmpDir, ".specia", "changes", "auth-system", "design.md");
    expect(fs.existsSync(designPath)).toBe(true);
    const designOnDisk = fs.readFileSync(designPath, "utf-8");
    expect(designOnDisk).toContain("JWT with RS256");

    // 5. Review — design should be included as context
    const specPath = path.join(tmpDir, ".specia", "changes", "auth-system", "spec.md");
    const specContent = fs.readFileSync(specPath, "utf-8");
    const specHash = computeSpecHash(specContent);

    // Phase 1: get prompt
    const reviewPromptResult = await handleReview({
      change_name: "auth-system",
    }, tmpDir);
    expect(reviewPromptResult.status).toBe("success");
    // Verify design content is in the review prompt (analysis_request) and context has metadata
    const promptData = reviewPromptResult.data as { review_prompt: { context: { has_design: boolean }; analysis_request: string } };
    expect(promptData.review_prompt.context.has_design).toBe(true);
    expect(promptData.review_prompt.analysis_request).toContain("JWT");

    // Phase 2: submit result
    const reviewResult = await handleReview({
      change_name: "auth-system",
      review_result: makeReviewResult("auth-system", specHash),
    }, tmpDir);
    expect(reviewResult.status).toBe("success");

    // 6. Tasks — should include design reference
    const tasksResult = await handleTasks({
      change_name: "auth-system",
    }, tmpDir);
    expect(tasksResult.status).toBe("success");

    const tasksPath = path.join(tmpDir, ".specia", "changes", "auth-system", "tasks.md");
    const tasksContent = fs.readFileSync(tasksPath, "utf-8");
    // Tasks should reference the design document
    expect(tasksContent).toContain("Design Decisions Reference");
    expect(tasksContent).toContain("JWT");

    // 7. Done
    const doneResult = await handleDone({
      change_name: "auth-system",
    }, tmpDir);
    expect(doneResult.status).toBe("success");

    // Verify archived
    expect(fs.existsSync(path.join(tmpDir, ".specia", "specs", "auth-system.md"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".specia", "changes", "auth-system"))).toBe(false);
  });
});

describe("Integration: v0.1 flow (without design) still works", () => {
  it("init → propose → spec → review → tasks → done (no design)", async () => {
    await handleInit({
      project_description: "Simple API",
      primary_stack: "Go",
      security_posture: "standard",
    }, tmpDir);

    await handlePropose({
      change_name: "no-design",
      intent: "Add health check endpoint",
      scope: ["api"],
      skip_audit: true, // Opt out of audit for this flow test
    }, tmpDir);

    await handleSpec({
      change_name: "no-design",
      requirements: SAMPLE_REQUIREMENTS,
    }, tmpDir);

    // Skip design — go straight to review
    const specPath = path.join(tmpDir, ".specia", "changes", "no-design", "spec.md");
    const specContent = fs.readFileSync(specPath, "utf-8");
    const specHash = computeSpecHash(specContent);

    const reviewResult = await handleReview({
      change_name: "no-design",
      review_result: makeReviewResult("no-design", specHash),
    }, tmpDir);
    expect(reviewResult.status).toBe("success");

    const tasksResult = await handleTasks({
      change_name: "no-design",
    }, tmpDir);
    expect(tasksResult.status).toBe("success");

    // tasks.md should NOT have Design Decisions Reference section
    const tasksPath = path.join(tmpDir, ".specia", "changes", "no-design", "tasks.md");
    const tasksContent = fs.readFileSync(tasksPath, "utf-8");
    expect(tasksContent).not.toContain("Design Decisions Reference");

    const doneResult = await handleDone({
      change_name: "no-design",
    }, tmpDir);
    expect(doneResult.status).toBe("success");
  });
});

describe("Integration: specia_continue handles design phase", () => {
  it("suggests design as optional after spec", async () => {
    await handleInit({ project_description: "Test" }, tmpDir);
    await handlePropose({
      change_name: "cont-design",
      intent: "Test continue with design",
      scope: ["area"],
    }, tmpDir);
    await handleSpec({
      change_name: "cont-design",
      requirements: SAMPLE_REQUIREMENTS,
    }, tmpDir);

    const result = await handleContinue({ change_name: "cont-design" }, tmpDir);
    expect(result.status).toBe("success");
    expect(result.data).toHaveProperty("next_tool", "specia_design");
    expect(result.data).toHaveProperty("optional", true);
  });

  it("suggests review after design is complete", async () => {
    await handleInit({ project_description: "Test" }, tmpDir);
    await handlePropose({
      change_name: "cont-after-design",
      intent: "Test continue after design",
      scope: ["area"],
    }, tmpDir);
    await handleSpec({
      change_name: "cont-after-design",
      requirements: SAMPLE_REQUIREMENTS,
    }, tmpDir);
    await handleDesign({
      change_name: "cont-after-design",
      design_content: DESIGN_CONTENT,
    }, tmpDir);

    const result = await handleContinue({ change_name: "cont-after-design" }, tmpDir);
    expect(result.status).toBe("success");
    expect(result.data).toHaveProperty("next_tool", "specia_review");
  });
});

describe("Integration: specia_ff with design", () => {
  it("fast-forward stops at spec (needs LLM input)", async () => {
    await handleInit({ project_description: "Test" }, tmpDir);

    const result = await handleFf({
      change_name: "ff-design",
      intent: "Test ff with design support",
      scope: ["area"],
    }, tmpDir);

    expect(result.status).toBe("success");
    const data = result.data as { phases_completed: string[]; stopped_at: string };
    expect(data.phases_completed).toContain("proposal");
    expect(data.stopped_at).toBe("spec");
  });
});

describe("Integration: Design phase validation", () => {
  it("design requires spec to exist", async () => {
    await handleInit({ project_description: "Test" }, tmpDir);
    await handlePropose({
      change_name: "no-spec",
      intent: "Test",
      scope: ["area"],
    }, tmpDir);

    const result = await handleDesign({
      change_name: "no-spec",
      design_content: DESIGN_CONTENT,
    }, tmpDir);

    expect(result.status).toBe("error");
    expect(result.errors[0]!.code).toBe("MISSING_DEPENDENCY");
  });

  it("design rejects trivial content", async () => {
    await handleInit({ project_description: "Test" }, tmpDir);
    await handlePropose({
      change_name: "trivial",
      intent: "Test",
      scope: ["area"],
    }, tmpDir);
    await handleSpec({
      change_name: "trivial",
      requirements: SAMPLE_REQUIREMENTS,
    }, tmpDir);

    const result = await handleDesign({
      change_name: "trivial",
      design_content: "too short",
    }, tmpDir);

    expect(result.status).toBe("error");
    expect(result.errors[0]!.code).toBe("VALIDATION_ERROR");
  });

  it("design phase 1 returns prompt template", async () => {
    await handleInit({ project_description: "Test" }, tmpDir);
    await handlePropose({
      change_name: "prompt-test",
      intent: "Test",
      scope: ["area"],
    }, tmpDir);
    await handleSpec({
      change_name: "prompt-test",
      requirements: SAMPLE_REQUIREMENTS,
    }, tmpDir);

    const result = await handleDesign({
      change_name: "prompt-test",
    }, tmpDir);

    expect(result.status).toBe("success");
    const data = result.data as { design_prompt: string; instructions: string };
    expect(data.design_prompt).toContain("Design Prompt");
    expect(data.instructions).toContain("specia_design");
  });
});
