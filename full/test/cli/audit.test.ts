/**
 * CLI audit command tests.
 *
 * Tests the `specia audit` command — manual mode, --result, --force,
 * --files, --json, and error cases.
 *
 * Follows the exact patterns from test/cli/commands.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";
import { Command } from "commander";
import { registerInitCommand } from "../../src/cli/commands/init.js";
import { registerProposeCommand } from "../../src/cli/commands/propose.js";
import { registerSpecCommand } from "../../src/cli/commands/spec.js";
import { registerDesignCommand } from "../../src/cli/commands/design.js";
import { registerReviewCommand } from "../../src/cli/commands/review.js";
import { registerTasksCommand } from "../../src/cli/commands/tasks.js";
import { registerDoneCommand } from "../../src/cli/commands/done.js";
import { registerAuditCommand } from "../../src/cli/commands/audit.js";
import { setJsonMode, setQuietMode } from "../../src/cli/output.js";
import { computeSpecHash } from "../../src/services/cache.js";

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

function makeAuditResultJson() {
  return JSON.stringify({
    requirements: [
      {
        requirement_id: "REQ-001",
        verdict: "pass",
        evidence: "Implementation found in auth.ts",
        code_references: ["src/auth.ts:42"],
        gaps: [],
        notes: "",
      },
    ],
    abuse_cases: [
      {
        abuse_case_id: "AC-001",
        verdict: "verified",
        evidence: "Rate limiting implemented",
        code_references: ["src/middleware.ts:10"],
        gaps: [],
        risk_if_unaddressed: "",
      },
    ],
    summary: {
      overall_verdict: "pass",
      requirements_coverage: { total: 1, passed: 1, failed: 0, partial: 0, skipped: 0 },
      abuse_cases_coverage: { total: 1, verified: 1, unverified: 0, partial: 0, not_applicable: 0 },
      risk_level: "low",
      recommendations: [],
    },
  });
}

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "specia-cli-audit-"));
  origCwd = process.cwd();
  process.chdir(tmpDir);
  setJsonMode(false);
  setQuietMode(false);
  process.exitCode = undefined;

  // Set up git repo so discoverChangedFiles works (fix-empty-audit requirement)
  execSync("git init -b main", { cwd: tmpDir, stdio: "pipe" });
  execSync("git config user.email 'test@test.com'", { cwd: tmpDir, stdio: "pipe" });
  execSync("git config user.name 'Test'", { cwd: tmpDir, stdio: "pipe" });
  const srcDir = path.join(tmpDir, "src");
  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(path.join(srcDir, "auth.ts"), "export function login() { return true; }\n");
  execSync("git add -A", { cwd: tmpDir, stdio: "pipe" });
  execSync("git commit -m 'initial'", { cwd: tmpDir, stdio: "pipe" });
  execSync("git checkout -b feature", { cwd: tmpDir, stdio: "pipe" });
  fs.writeFileSync(path.join(srcDir, "auth.ts"), "export function login() { return true; }\nexport function logout() {}\n");
  execSync("git add -A", { cwd: tmpDir, stdio: "pipe" });
  execSync("git commit -m 'add auth feature'", { cwd: tmpDir, stdio: "pipe" });

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
  registerAuditCommand(program);
  return program;
}

async function initProject(): Promise<void> {
  const program = createProgram();
  await program.parseAsync(["node", "specia", "init", "--description", "Test project"]);
  process.exitCode = undefined;
}

/**
 * Set up a change through the full propose → spec → review → tasks pipeline.
 * Returns the spec hash for constructing audit results.
 */
async function setupTasksComplete(changeName: string): Promise<string> {
  // propose
  const p1 = createProgram();
  await p1.parseAsync(["node", "specia", "propose", changeName, "--intent", "Test audit"]);
  process.exitCode = undefined;

  // spec
  const p2 = createProgram();
  await p2.parseAsync(["node", "specia", "spec", changeName, "--content", "# Spec\n\nRequirement: Validate all input"]);
  process.exitCode = undefined;

  // review
  const specPath = path.join(tmpDir, ".specia", "changes", changeName, "spec.md");
  const specContent = fs.readFileSync(specPath, "utf-8");
  const specHash = computeSpecHash(specContent);

  const p3 = createProgram();
  await p3.parseAsync(["node", "specia", "review", changeName, "--result", makeReviewResultJson(changeName, specHash)]);
  process.exitCode = undefined;

  // tasks
  const p4 = createProgram();
  await p4.parseAsync(["node", "specia", "tasks", changeName]);
  process.exitCode = undefined;

  return specHash;
}

describe("CLI: specia audit", () => {
  it("audit command is registered", async () => {
    const program = createProgram();
    const auditCmd = program.commands.find((c) => c.name() === "audit");
    expect(auditCmd).toBeDefined();
    expect(auditCmd!.description()).toContain("audit");
  });

  it("generates audit prompt in manual mode (default)", async () => {
    await initProject();
    await setupTasksComplete("audit-manual");

    const program = createProgram();
    await program.parseAsync(["node", "specia", "audit", "audit-manual"]);

    expect(process.exitCode).toBeUndefined();
  });

  it("submits audit result via --result flag", async () => {
    await initProject();
    await setupTasksComplete("audit-submit");

    const program = createProgram();
    await program.parseAsync([
      "node", "specia", "audit", "audit-submit",
      "--result", makeAuditResultJson(),
    ]);

    expect(process.exitCode).toBeUndefined();
    const auditPath = path.join(tmpDir, ".specia", "changes", "audit-submit", "audit.md");
    expect(fs.existsSync(auditPath)).toBe(true);

    // Verify audit.md content
    const auditContent = fs.readFileSync(auditPath, "utf-8");
    expect(auditContent).toContain("overall_verdict");
    expect(auditContent).toContain("Requirements Verification");
    expect(auditContent).toContain("REQ-001");
  });

  it("errors when not initialized", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "specia", "audit", "test"]);

    expect(process.exitCode).toBe(1);
  });

  it("errors when change does not exist", async () => {
    await initProject();
    const program = createProgram();
    await program.parseAsync(["node", "specia", "audit", "nonexistent"]);

    expect(process.exitCode).toBe(1);
  });

  it("errors when tasks phase is not complete", async () => {
    await initProject();

    // Only create proposal + spec (no review/tasks)
    const p1 = createProgram();
    await p1.parseAsync(["node", "specia", "propose", "no-tasks", "--intent", "Test"]);
    process.exitCode = undefined;

    const p2 = createProgram();
    await p2.parseAsync(["node", "specia", "spec", "no-tasks", "--content", "# Spec content"]);
    process.exitCode = undefined;

    const program = createProgram();
    await program.parseAsync(["node", "specia", "audit", "no-tasks"]);

    expect(process.exitCode).toBe(1);
  });

  it("supports --force flag to re-audit", async () => {
    await initProject();
    await setupTasksComplete("audit-force");

    // Submit initial audit
    const p1 = createProgram();
    await p1.parseAsync([
      "node", "specia", "audit", "audit-force",
      "--result", makeAuditResultJson(),
    ]);
    process.exitCode = undefined;

    // Re-audit without force — should hit cache
    const p2 = createProgram();
    await p2.parseAsync(["node", "specia", "audit", "audit-force"]);
    expect(process.exitCode).toBeUndefined();

    // Re-audit with force — should generate new prompt
    process.exitCode = undefined;
    const p3 = createProgram();
    await p3.parseAsync(["node", "specia", "audit", "audit-force", "--force"]);
    expect(process.exitCode).toBeUndefined();
  });

  it("supports --files flag with comma-separated paths", async () => {
    await initProject();
    await setupTasksComplete("audit-files");

    // Create a test file in the temp dir so readCodeFiles can read it
    fs.writeFileSync(path.join(tmpDir, "test-file.ts"), "export const x = 1;");

    const program = createProgram();
    await program.parseAsync([
      "node", "specia", "audit", "audit-files",
      "--files", "test-file.ts",
    ]);

    expect(process.exitCode).toBeUndefined();
  });

  it("outputs JSON in --json mode", async () => {
    await initProject();
    await setupTasksComplete("audit-json");
    setJsonMode(true);

    const program = createProgram();
    await program.parseAsync(["node", "specia", "audit", "audit-json"]);

    expect(process.exitCode).toBeUndefined();
    // Verify JSON output was called (console.log is mocked)
    const consoleLogCalls = (console.log as ReturnType<typeof vi.fn>).mock.calls;
    const jsonCalls = consoleLogCalls.filter((call: unknown[]) => {
      try {
        const parsed = JSON.parse(String(call[0]));
        return parsed && parsed.status === "prompt_generated";
      } catch {
        return false;
      }
    });
    expect(jsonCalls.length).toBeGreaterThan(0);
  });

  it("submits audit result in JSON mode and returns structured output", async () => {
    await initProject();
    await setupTasksComplete("audit-json-result");
    setJsonMode(true);

    const program = createProgram();
    await program.parseAsync([
      "node", "specia", "audit", "audit-json-result",
      "--result", makeAuditResultJson(),
    ]);

    expect(process.exitCode).toBeUndefined();
    // Check JSON success output
    const consoleLogCalls = (console.log as ReturnType<typeof vi.fn>).mock.calls;
    const successCalls = consoleLogCalls.filter((call: unknown[]) => {
      try {
        const parsed = JSON.parse(String(call[0]));
        return parsed && parsed.status === "success";
      } catch {
        return false;
      }
    });
    expect(successCalls.length).toBeGreaterThan(0);
  });

  it("errors on invalid audit result JSON", async () => {
    await initProject();
    await setupTasksComplete("audit-invalid");

    const program = createProgram();
    await program.parseAsync([
      "node", "specia", "audit", "audit-invalid",
      "--result", "not valid json",
    ]);

    expect(process.exitCode).toBe(1);
  });

  it("errors when --api is used without provider", async () => {
    await initProject();
    await setupTasksComplete("audit-no-provider");

    const program = createProgram();
    await program.parseAsync([
      "node", "specia", "audit", "audit-no-provider",
      "--api",
    ]);

    expect(process.exitCode).toBe(1);
  });

  it("errors when --api is used without API key", async () => {
    await initProject();
    await setupTasksComplete("audit-no-key");

    // Ensure no API key set
    const origKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    try {
      const program = createProgram();
      await program.parseAsync([
        "node", "specia", "audit", "audit-no-key",
        "--api", "--provider", "anthropic",
      ]);

      expect(process.exitCode).toBe(1);
    } finally {
      if (origKey) process.env.ANTHROPIC_API_KEY = origKey;
    }
  });
});
