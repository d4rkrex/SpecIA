/**
 * CLI command tests: propose, spec, design, review, tasks, done.
 *
 * Tests each command by calling the registered action handler via commander.
 * Uses temp directories and pre-initialized .specia/ for each test.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { Command } from "commander";
import { registerInitCommand } from "../../src/cli/commands/init.js";
import { registerProposeCommand } from "../../src/cli/commands/propose.js";
import { registerSpecCommand } from "../../src/cli/commands/spec.js";
import { registerDesignCommand } from "../../src/cli/commands/design.js";
import { registerReviewCommand } from "../../src/cli/commands/review.js";
import { registerTasksCommand } from "../../src/cli/commands/tasks.js";
import { registerDoneCommand } from "../../src/cli/commands/done.js";
import { setJsonMode, setQuietMode } from "../../src/cli/output.js";
import { FileStore } from "../../src/services/store.js";
import { computeSpecHash } from "../../src/services/cache.js";
import {
  generateReviewPrompt,
  validateReviewResult,
  renderReviewMarkdown,
} from "../../src/services/review.js";

let tmpDir: string;
let origCwd: string;

function makeReviewResultJson(changeName: string, specHash: string) {
  return JSON.stringify({
    change: changeName,
    posture: "standard",
    timestamp: new Date().toISOString(),
    spec_hash: specHash,
    stride: {
      spoofing: {
        applicable: true,
        threats: [{
          id: "S-01",
          title: "Test threat",
          description: "A test threat",
          severity: "medium",
          mitigation: "Fix it by doing X",
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
      mitigations_required: ["Fix it by doing X"],
    },
  });
}

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "specia-cli-cmd-"));
  origCwd = process.cwd();
  process.chdir(tmpDir);
  setJsonMode(false);
  setQuietMode(false);
  process.exitCode = undefined;

  // Simulate TTY so readStdin() returns null immediately (no hanging)
  Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });

  // Suppress console output during tests
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  process.chdir(origCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

function createProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerInitCommand(program);
  registerProposeCommand(program);
  registerSpecCommand(program);
  registerDesignCommand(program);
  registerReviewCommand(program);
  registerTasksCommand(program);
  registerDoneCommand(program);
  return program;
}

async function initProject(): Promise<void> {
  const program = createProgram();
  await program.parseAsync(["node", "specia", "init", "--description", "Test project"]);
  process.exitCode = undefined;
}

describe("CLI: specia propose", () => {
  it("creates a proposal with --intent", async () => {
    await initProject();
    const program = createProgram();
    await program.parseAsync([
      "node", "specia", "propose", "my-change",
      "--intent", "Add user authentication",
    ]);

    expect(process.exitCode).toBeUndefined();
    const proposalPath = path.join(tmpDir, ".specia", "changes", "my-change", "proposal.md");
    expect(fs.existsSync(proposalPath)).toBe(true);
    const content = fs.readFileSync(proposalPath, "utf-8");
    expect(content).toContain("my-change");
    expect(content).toContain("Add user authentication");
  });

  it("errors without --intent (and no stdin)", async () => {
    await initProject();
    const program = createProgram();
    await program.parseAsync(["node", "specia", "propose", "no-intent"]);

    expect(process.exitCode).toBe(1);
  });

  it("errors on duplicate change name", async () => {
    await initProject();
    const program1 = createProgram();
    await program1.parseAsync([
      "node", "specia", "propose", "dup-change",
      "--intent", "First attempt",
    ]);
    process.exitCode = undefined;

    const program2 = createProgram();
    await program2.parseAsync([
      "node", "specia", "propose", "dup-change",
      "--intent", "Second attempt",
    ]);

    expect(process.exitCode).toBe(1);
  });

  it("errors when not initialized", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node", "specia", "propose", "test",
      "--intent", "test",
    ]);

    expect(process.exitCode).toBe(1);
  });

  it("supports --scope option", async () => {
    await initProject();
    const program = createProgram();
    await program.parseAsync([
      "node", "specia", "propose", "scoped-change",
      "--intent", "Test scope",
      "--scope", "auth", "sessions",
    ]);

    expect(process.exitCode).toBeUndefined();
    const proposalPath = path.join(tmpDir, ".specia", "changes", "scoped-change", "proposal.md");
    const content = fs.readFileSync(proposalPath, "utf-8");
    expect(content).toContain("auth");
  });
});

describe("CLI: specia spec", () => {
  it("writes spec with --content", async () => {
    await initProject();
    const program = createProgram();
    await program.parseAsync([
      "node", "specia", "propose", "spec-test",
      "--intent", "Test spec",
    ]);
    process.exitCode = undefined;

    const program2 = createProgram();
    await program2.parseAsync([
      "node", "specia", "spec", "spec-test",
      "--content", "# Spec\n\nRequirement: User login must validate credentials",
    ]);

    expect(process.exitCode).toBeUndefined();
    const specPath = path.join(tmpDir, ".specia", "changes", "spec-test", "spec.md");
    expect(fs.existsSync(specPath)).toBe(true);
  });

  it("errors without proposal", async () => {
    await initProject();
    const program = createProgram();
    await program.parseAsync([
      "node", "specia", "spec", "no-proposal",
      "--content", "some content",
    ]);

    expect(process.exitCode).toBe(1);
  });

  it("errors without content", async () => {
    await initProject();
    const program = createProgram();
    await program.parseAsync([
      "node", "specia", "propose", "no-content",
      "--intent", "test",
    ]);
    process.exitCode = undefined;

    const program2 = createProgram();
    await program2.parseAsync(["node", "specia", "spec", "no-content"]);

    expect(process.exitCode).toBe(1);
  });
});

describe("CLI: specia design", () => {
  it("saves design with --content", async () => {
    await initProject();
    const program = createProgram();
    await program.parseAsync([
      "node", "specia", "propose", "design-test",
      "--intent", "Test design",
    ]);
    process.exitCode = undefined;

    const program2 = createProgram();
    await program2.parseAsync([
      "node", "specia", "spec", "design-test",
      "--content", "# Spec content for design test with enough text",
    ]);
    process.exitCode = undefined;

    const designContent = "# Design for design-test\n\nThis is a detailed architecture design document that explains how we will implement the authentication system using JWT tokens with a layered approach.";
    const program3 = createProgram();
    await program3.parseAsync([
      "node", "specia", "design", "design-test",
      "--content", designContent,
    ]);

    expect(process.exitCode).toBeUndefined();
    const designPath = path.join(tmpDir, ".specia", "changes", "design-test", "design.md");
    expect(fs.existsSync(designPath)).toBe(true);
  });

  it("shows design prompt with --prompt flag", async () => {
    await initProject();
    const program = createProgram();
    await program.parseAsync([
      "node", "specia", "propose", "prompt-test",
      "--intent", "Test design prompt",
    ]);
    process.exitCode = undefined;

    const program2 = createProgram();
    await program2.parseAsync([
      "node", "specia", "spec", "prompt-test",
      "--content", "# Spec content for prompt test",
    ]);
    process.exitCode = undefined;

    const program3 = createProgram();
    await program3.parseAsync([
      "node", "specia", "design", "prompt-test", "--prompt",
    ]);

    expect(process.exitCode).toBeUndefined();
  });

  it("errors when design content is too short", async () => {
    await initProject();
    const program = createProgram();
    await program.parseAsync([
      "node", "specia", "propose", "short-design",
      "--intent", "Test short design",
    ]);
    process.exitCode = undefined;

    const program2 = createProgram();
    await program2.parseAsync([
      "node", "specia", "spec", "short-design",
      "--content", "# Spec content",
    ]);
    process.exitCode = undefined;

    const program3 = createProgram();
    await program3.parseAsync([
      "node", "specia", "design", "short-design",
      "--content", "too short",
    ]);

    expect(process.exitCode).toBe(1);
  });

  it("errors without spec", async () => {
    await initProject();
    const program = createProgram();
    await program.parseAsync([
      "node", "specia", "propose", "no-spec-design",
      "--intent", "Test",
    ]);
    process.exitCode = undefined;

    const program2 = createProgram();
    await program2.parseAsync([
      "node", "specia", "design", "no-spec-design",
      "--content", "enough content to pass length validation for the design phase of the workflow",
    ]);

    expect(process.exitCode).toBe(1);
  });
});

describe("CLI: specia review", () => {
  it("generates review prompt in manual mode (default)", async () => {
    await initProject();
    const program = createProgram();
    await program.parseAsync([
      "node", "specia", "propose", "review-test",
      "--intent", "Test review",
    ]);
    process.exitCode = undefined;

    const program2 = createProgram();
    await program2.parseAsync([
      "node", "specia", "spec", "review-test",
      "--content", "# Spec\n\nRequirement: Validate input",
    ]);
    process.exitCode = undefined;

    const program3 = createProgram();
    await program3.parseAsync(["node", "specia", "review", "review-test"]);

    expect(process.exitCode).toBeUndefined();
  });

  it("submits review result via --result flag", async () => {
    await initProject();
    const program = createProgram();
    await program.parseAsync([
      "node", "specia", "propose", "review-submit",
      "--intent", "Test review submission",
    ]);
    process.exitCode = undefined;

    const program2 = createProgram();
    await program2.parseAsync([
      "node", "specia", "spec", "review-submit",
      "--content", "# Spec\n\nRequirement: Validate all input parameters",
    ]);
    process.exitCode = undefined;

    // Get spec hash
    const specPath = path.join(tmpDir, ".specia", "changes", "review-submit", "spec.md");
    const specContent = fs.readFileSync(specPath, "utf-8");
    const specHash = computeSpecHash(specContent);

    const reviewJson = makeReviewResultJson("review-submit", specHash);

    const program3 = createProgram();
    await program3.parseAsync([
      "node", "specia", "review", "review-submit",
      "--result", reviewJson,
    ]);

    expect(process.exitCode).toBeUndefined();
    const reviewPath = path.join(tmpDir, ".specia", "changes", "review-submit", "review.md");
    expect(fs.existsSync(reviewPath)).toBe(true);
  });

  it("errors when spec is missing", async () => {
    await initProject();
    const program = createProgram();
    await program.parseAsync([
      "node", "specia", "propose", "no-spec-review",
      "--intent", "Test",
    ]);
    process.exitCode = undefined;

    const program2 = createProgram();
    await program2.parseAsync(["node", "specia", "review", "no-spec-review"]);

    expect(process.exitCode).toBe(1);
  });
});

describe("CLI: specia tasks", () => {
  it("generates tasks after review is complete", async () => {
    await initProject();
    const program = createProgram();

    // propose
    await program.parseAsync([
      "node", "specia", "propose", "tasks-test",
      "--intent", "Test tasks",
    ]);
    process.exitCode = undefined;

    // spec
    const program2 = createProgram();
    await program2.parseAsync([
      "node", "specia", "spec", "tasks-test",
      "--content", "# Spec\n\nRequirement: Build user auth",
    ]);
    process.exitCode = undefined;

    // review
    const specPath = path.join(tmpDir, ".specia", "changes", "tasks-test", "spec.md");
    const specContent = fs.readFileSync(specPath, "utf-8");
    const specHash = computeSpecHash(specContent);

    const program3 = createProgram();
    await program3.parseAsync([
      "node", "specia", "review", "tasks-test",
      "--result", makeReviewResultJson("tasks-test", specHash),
    ]);
    process.exitCode = undefined;

    // tasks
    const program4 = createProgram();
    await program4.parseAsync(["node", "specia", "tasks", "tasks-test"]);

    expect(process.exitCode).toBeUndefined();
    const tasksPath = path.join(tmpDir, ".specia", "changes", "tasks-test", "tasks.md");
    expect(fs.existsSync(tasksPath)).toBe(true);
  });

  it("refuses without review (HARD GATE)", async () => {
    await initProject();
    const program = createProgram();
    await program.parseAsync([
      "node", "specia", "propose", "no-review-tasks",
      "--intent", "Test",
    ]);
    process.exitCode = undefined;

    const program2 = createProgram();
    await program2.parseAsync([
      "node", "specia", "spec", "no-review-tasks",
      "--content", "# Spec content",
    ]);
    process.exitCode = undefined;

    const program3 = createProgram();
    await program3.parseAsync(["node", "specia", "tasks", "no-review-tasks"]);

    expect(process.exitCode).toBe(1);
  });
});

describe("CLI: specia done", () => {
  it("archives a completed change", async () => {
    await initProject();

    // Full workflow: propose → spec → review → tasks → done
    const p1 = createProgram();
    await p1.parseAsync(["node", "specia", "propose", "done-test", "--intent", "Test done"]);
    process.exitCode = undefined;

    const p2 = createProgram();
    await p2.parseAsync(["node", "specia", "spec", "done-test", "--content", "# Spec\n\nAuth requirement"]);
    process.exitCode = undefined;

    const specPath = path.join(tmpDir, ".specia", "changes", "done-test", "spec.md");
    const specContent = fs.readFileSync(specPath, "utf-8");
    const specHash = computeSpecHash(specContent);

    const p3 = createProgram();
    await p3.parseAsync(["node", "specia", "review", "done-test", "--result", makeReviewResultJson("done-test", specHash)]);
    process.exitCode = undefined;

    const p4 = createProgram();
    await p4.parseAsync(["node", "specia", "tasks", "done-test"]);
    process.exitCode = undefined;

    // v0.7: audit_policy defaults to "required", so use --force to bypass for this test
    const p5 = createProgram();
    await p5.parseAsync(["node", "specia", "done", "done-test", "--force"]);

    expect(process.exitCode).toBeUndefined();
    expect(fs.existsSync(path.join(tmpDir, ".specia", "specs", "done-test.md"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".specia", "changes", "done-test"))).toBe(false);
  });

  it("errors when change does not exist", async () => {
    await initProject();
    const program = createProgram();
    await program.parseAsync(["node", "specia", "done", "nonexistent"]);

    expect(process.exitCode).toBe(1);
  });

  it("errors when change is incomplete", async () => {
    await initProject();
    const p1 = createProgram();
    await p1.parseAsync(["node", "specia", "propose", "incomplete-done", "--intent", "Test"]);
    process.exitCode = undefined;

    const p2 = createProgram();
    await p2.parseAsync(["node", "specia", "done", "incomplete-done"]);

    expect(process.exitCode).toBe(1);
  });

  // v0.7: CLI phase sync — accepts "audit" phase (fix-done-verification)
  it("accepts changes in audit phase with status complete", async () => {
    await initProject();

    // Build pipeline: propose → spec → review → tasks
    const p1 = createProgram();
    await p1.parseAsync(["node", "specia", "propose", "audit-phase-cli", "--intent", "Test audit phase"]);
    process.exitCode = undefined;

    const p2 = createProgram();
    await p2.parseAsync(["node", "specia", "spec", "audit-phase-cli", "--content", "# Spec\n\nRequirement"]);
    process.exitCode = undefined;

    const specPath = path.join(tmpDir, ".specia", "changes", "audit-phase-cli", "spec.md");
    const specContent = fs.readFileSync(specPath, "utf-8");
    const specHash = computeSpecHash(specContent);

    const p3 = createProgram();
    await p3.parseAsync(["node", "specia", "review", "audit-phase-cli", "--result", makeReviewResultJson("audit-phase-cli", specHash)]);
    process.exitCode = undefined;

    const p4 = createProgram();
    await p4.parseAsync(["node", "specia", "tasks", "audit-phase-cli"]);
    process.exitCode = undefined;

    // Simulate completed audit by setting phase directly
    const store = new FileStore(tmpDir);
    const sampleAudit = `---\nchange: "audit-phase-cli"\ntimestamp: "2026-01-01T00:00:00Z"\nposture: "standard"\nspec_hash: "sha256:abc"\naudit_hash: "sha256:def"\noverall_verdict: "pass"\nrisk_level: "low"\nrequirements_coverage:\n  total: 1\n  passed: 1\n  failed: 0\n  partial: 0\n  skipped: 0\nabuse_cases_coverage:\n  total: 1\n  verified: 1\n  unverified: 0\n  partial: 0\n  not_applicable: 0\n---\n\n# Spec Audit\n\n**Posture**: standard | **Verdict**: pass | **Risk**: low\n\n## Requirements Verification\n\n| Requirement | Verdict | Evidence |\n|-------------|---------|----------|\n| REQ-001 | pass | Verified |\n\n## Abuse Case Verification\n\n| Abuse Case | Verdict | Risk if Unaddressed |\n|------------|---------|---------------------|\n| AC-001 | verified | N/A |\n`;
    store.writeArtifact("audit-phase-cli", "audit", sampleAudit);
    store.transitionPhase("audit-phase-cli", "audit", "complete", {
      audit_hash: "sha256:def",
      audit_posture: "standard",
    });

    const p5 = createProgram();
    await p5.parseAsync(["node", "specia", "done", "audit-phase-cli"]);

    expect(process.exitCode).toBeUndefined();
    expect(fs.existsSync(path.join(tmpDir, ".specia", "specs", "audit-phase-cli.md"))).toBe(true);
  });

  // v0.7: E-01 — CLI rejects invalid change names (path traversal prevention)
  it("rejects invalid change name with path traversal", async () => {
    await initProject();
    const program = createProgram();
    await program.parseAsync(["node", "specia", "done", "../../etc"]);

    expect(process.exitCode).toBe(1);
  });

  it("rejects change name with uppercase or special chars", async () => {
    await initProject();
    const program = createProgram();
    await program.parseAsync(["node", "specia", "done", "INVALID_NAME"]);

    expect(process.exitCode).toBe(1);
  });

  // v0.7: Audit gate enforcement in CLI
  it("enforces audit gate and blocks without --force", async () => {
    await initProject();

    // Build pipeline through tasks (audit_policy defaults to "required")
    const p1 = createProgram();
    await p1.parseAsync(["node", "specia", "propose", "audit-gate-cli", "--intent", "Test audit gate"]);
    process.exitCode = undefined;

    const p2 = createProgram();
    await p2.parseAsync(["node", "specia", "spec", "audit-gate-cli", "--content", "# Spec\n\nRequirement"]);
    process.exitCode = undefined;

    const specPath = path.join(tmpDir, ".specia", "changes", "audit-gate-cli", "spec.md");
    const specContent = fs.readFileSync(specPath, "utf-8");
    const specHash = computeSpecHash(specContent);

    const p3 = createProgram();
    await p3.parseAsync(["node", "specia", "review", "audit-gate-cli", "--result", makeReviewResultJson("audit-gate-cli", specHash)]);
    process.exitCode = undefined;

    const p4 = createProgram();
    await p4.parseAsync(["node", "specia", "tasks", "audit-gate-cli"]);
    process.exitCode = undefined;

    // Try to done without audit — should fail
    const p5 = createProgram();
    await p5.parseAsync(["node", "specia", "done", "audit-gate-cli"]);

    expect(process.exitCode).toBe(1);
  });

  it("allows --force to bypass audit gate", async () => {
    await initProject();

    // Build pipeline through tasks (audit_policy defaults to "required")
    const p1 = createProgram();
    await p1.parseAsync(["node", "specia", "propose", "force-cli", "--intent", "Test force"]);
    process.exitCode = undefined;

    const p2 = createProgram();
    await p2.parseAsync(["node", "specia", "spec", "force-cli", "--content", "# Spec\n\nRequirement"]);
    process.exitCode = undefined;

    const specPath = path.join(tmpDir, ".specia", "changes", "force-cli", "spec.md");
    const specContent = fs.readFileSync(specPath, "utf-8");
    const specHash = computeSpecHash(specContent);

    const p3 = createProgram();
    await p3.parseAsync(["node", "specia", "review", "force-cli", "--result", makeReviewResultJson("force-cli", specHash)]);
    process.exitCode = undefined;

    const p4 = createProgram();
    await p4.parseAsync(["node", "specia", "tasks", "force-cli"]);
    process.exitCode = undefined;

    // Done with --force — should succeed despite audit_policy being "required"
    const p5 = createProgram();
    await p5.parseAsync(["node", "specia", "done", "force-cli", "--force"]);

    expect(process.exitCode).toBeUndefined();
    expect(fs.existsSync(path.join(tmpDir, ".specia", "specs", "force-cli.md"))).toBe(true);
  });
});
