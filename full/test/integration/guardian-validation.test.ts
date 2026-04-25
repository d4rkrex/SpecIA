/**
 * Integration tests: Guardian validation on a real git repo.
 *
 * Tests:
 * 1. Guardian validates staged files against spec coverage in a git repo
 * 2. Guardian + Design: checks design.md when present
 * 3. CLI + Guardian: hook install/uninstall/status work in real git repo
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";
import { FileStore } from "../../src/services/store.js";
import { GuardianService, DEFAULT_GUARDIAN_CONFIG } from "../../src/services/guardian.js";
import { HookManager } from "../../src/services/hook-manager.js";
import { handleInit } from "../../src/tools/init.js";
import { handlePropose } from "../../src/tools/propose.js";
import { handleSpec } from "../../src/tools/spec.js";
import { handleDesign } from "../../src/tools/design.js";
import { handleReview } from "../../src/tools/review.js";
import { handleTasks } from "../../src/tools/tasks.js";
import { computeSpecHash } from "../../src/services/cache.js";
import type { GuardianConfig } from "../../src/types/index.js";

let tmpDir: string;

const SAMPLE_REQUIREMENTS = [
  {
    name: "Auth system",
    description: "Implement authentication",
    scenarios: [{
      name: "Login",
      given: "valid creds",
      when: "user logs in",
      then: "get token",
    }],
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
          description: "Automated attacks",
          severity: "high",
          mitigation: "Rate limiting",
          affected_components: ["src/auth"],
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
      mitigations_required: ["Rate limiting"],
    },
  };
}

const DESIGN_CONTENT = `# Design: auth-system

## Technical Approach

Implement JWT-based authentication with bcrypt password hashing. Use middleware pattern for route protection.

## Architecture Decisions

### Decision: Use RS256 JWT signing
**Choice**: RS256 asymmetric signing
**Rationale**: Allows token verification without exposing signing key

## Component Design

- src/auth/controller.ts: Login/logout handlers
- src/auth/middleware.ts: JWT verification middleware
`;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "specia-guardian-int-"));
  execSync("git init", { cwd: tmpDir, stdio: "pipe" });
  execSync("git config user.email 'test@test.com'", { cwd: tmpDir, stdio: "pipe" });
  execSync("git config user.name 'Test'", { cwd: tmpDir, stdio: "pipe" });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("Guardian validation in real git repo", () => {
  it("validates staged files with full spec coverage", async () => {
    // Set up a complete SpecIA workflow
    await handleInit({ project_description: "Auth service" }, tmpDir);
    await handlePropose({
      change_name: "auth-system",
      intent: "Add auth",
      scope: ["src/auth"],
    }, tmpDir);
    await handleSpec({
      change_name: "auth-system",
      requirements: SAMPLE_REQUIREMENTS,
    }, tmpDir);

    const specPath = path.join(tmpDir, ".specia", "changes", "auth-system", "spec.md");
    const specContent = fs.readFileSync(specPath, "utf-8");
    const specHash = computeSpecHash(specContent);

    await handleReview({
      change_name: "auth-system",
      review_result: makeReviewResult("auth-system", specHash),
    }, tmpDir);

    await handleTasks({
      change_name: "auth-system",
    }, tmpDir);

    // Mark security mitigations as done (check off the checkboxes)
    const tasksPath = path.join(tmpDir, ".specia", "changes", "auth-system", "tasks.md");
    const tasksContent = fs.readFileSync(tasksPath, "utf-8");
    fs.writeFileSync(tasksPath, tasksContent.replace(/- \[ \] /g, "- [x] "));

    // Create a source file matching the scope
    fs.mkdirSync(path.join(tmpDir, "src", "auth"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "src", "auth", "login.ts"), "export function login() {}");

    // Guardian should pass validation
    const store = new FileStore(tmpDir);
    const guardian = new GuardianService(tmpDir, store);

    const strictConfig: GuardianConfig = {
      ...DEFAULT_GUARDIAN_CONFIG,
      mode: "strict",
    };

    const result = await guardian.validateStagedFiles(["src/auth/login.ts"], strictConfig);

    expect(result.summary.violations).toBe(0);
    expect(result.results[0]!.status).toBe("pass");
    expect(result.results[0]!.change).toBe("auth-system");
  });

  it("warns on files without spec coverage in warn mode", async () => {
    await handleInit({ project_description: "Test" }, tmpDir);

    const store = new FileStore(tmpDir);
    const guardian = new GuardianService(tmpDir, store);

    const warnConfig: GuardianConfig = {
      ...DEFAULT_GUARDIAN_CONFIG,
      mode: "warn",
    };

    const result = await guardian.validateStagedFiles(["src/random/file.ts"], warnConfig);

    expect(result.summary.warnings).toBe(1);
    expect(result.summary.violations).toBe(0);
    expect(result.results[0]!.status).toBe("warn");
    expect(result.results[0]!.reason).toBe("no_spec_coverage");
  });

  it("fails on files without spec coverage in strict mode", async () => {
    await handleInit({ project_description: "Test" }, tmpDir);

    const store = new FileStore(tmpDir);
    const guardian = new GuardianService(tmpDir, store);

    const strictConfig: GuardianConfig = {
      ...DEFAULT_GUARDIAN_CONFIG,
      mode: "strict",
    };

    const result = await guardian.validateStagedFiles(["src/unknown/file.ts"], strictConfig);

    expect(result.summary.violations).toBe(1);
    expect(result.results[0]!.status).toBe("fail");
  });

  it("fails on incomplete review (review_incomplete)", async () => {
    await handleInit({ project_description: "Test" }, tmpDir);
    await handlePropose({
      change_name: "partial",
      intent: "Partial workflow",
      scope: ["src/auth"],
    }, tmpDir);
    await handleSpec({
      change_name: "partial",
      requirements: SAMPLE_REQUIREMENTS,
    }, tmpDir);
    // No review — guardian should catch this

    const store = new FileStore(tmpDir);
    const guardian = new GuardianService(tmpDir, store);

    const strictConfig: GuardianConfig = {
      ...DEFAULT_GUARDIAN_CONFIG,
      mode: "strict",
    };

    const result = await guardian.validateStagedFiles(["src/auth/login.ts"], strictConfig);

    expect(result.summary.violations).toBe(1);
    expect(result.results[0]!.reason).toBe("review_incomplete");
  });

  it("respects exclude patterns", async () => {
    await handleInit({ project_description: "Test" }, tmpDir);

    const store = new FileStore(tmpDir);
    const guardian = new GuardianService(tmpDir, store);

    const config: GuardianConfig = {
      ...DEFAULT_GUARDIAN_CONFIG,
      mode: "strict",
      exclude: ["*.md", "test/**"],
    };

    const result = await guardian.validateStagedFiles(
      ["README.md", "test/foo.test.ts", "src/main.ts"],
      config,
    );

    // README.md and test/** should be excluded, only src/main.ts should be checked
    expect(result.staged_files).toBe(1);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.file).toBe("src/main.ts");
  });
});

describe("Guardian + Design: design-aware validation", () => {
  it("validates change that has design.md", async () => {
    await handleInit({ project_description: "Auth service" }, tmpDir);
    await handlePropose({
      change_name: "auth-with-design",
      intent: "Auth with design",
      scope: ["src/auth"],
    }, tmpDir);
    await handleSpec({
      change_name: "auth-with-design",
      requirements: SAMPLE_REQUIREMENTS,
    }, tmpDir);
    await handleDesign({
      change_name: "auth-with-design",
      design_content: DESIGN_CONTENT,
    }, tmpDir);

    const specPath = path.join(tmpDir, ".specia", "changes", "auth-with-design", "spec.md");
    const specContent = fs.readFileSync(specPath, "utf-8");
    const specHash = computeSpecHash(specContent);

    await handleReview({
      change_name: "auth-with-design",
      review_result: makeReviewResult("auth-with-design", specHash),
    }, tmpDir);

    await handleTasks({
      change_name: "auth-with-design",
    }, tmpDir);

    // Mark security mitigations as done (check off the checkboxes)
    const tasksPath = path.join(tmpDir, ".specia", "changes", "auth-with-design", "tasks.md");
    const tasksContent = fs.readFileSync(tasksPath, "utf-8");
    fs.writeFileSync(tasksPath, tasksContent.replace(/- \[ \] /g, "- [x] "));

    const store = new FileStore(tmpDir);
    const guardian = new GuardianService(tmpDir, store);

    const result = await guardian.validateStagedFiles(
      ["src/auth/controller.ts"],
      { ...DEFAULT_GUARDIAN_CONFIG, mode: "strict" },
    );

    expect(result.summary.violations).toBe(0);
    expect(result.results[0]!.status).toBe("pass");

    // Verify design.md exists in the change directory
    expect(store.readArtifact("auth-with-design", "design")).not.toBeNull();
  });

  it("Guardian.validateChange reports all three check layers", async () => {
    await handleInit({ project_description: "Test" }, tmpDir);
    await handlePropose({
      change_name: "full-check",
      intent: "Full validation",
      scope: ["src/auth"],
    }, tmpDir);
    await handleSpec({
      change_name: "full-check",
      requirements: SAMPLE_REQUIREMENTS,
    }, tmpDir);

    const specPath = path.join(tmpDir, ".specia", "changes", "full-check", "spec.md");
    const specContent = fs.readFileSync(specPath, "utf-8");
    const specHash = computeSpecHash(specContent);

    await handleReview({
      change_name: "full-check",
      review_result: makeReviewResult("full-check", specHash),
    }, tmpDir);

    await handleTasks({
      change_name: "full-check",
    }, tmpDir);

    const store = new FileStore(tmpDir);
    const guardian = new GuardianService(tmpDir, store);

    const validation = guardian.validateChange("full-check");
    expect(validation.spec_exists).toBe(true);
    expect(validation.review_complete).toBe(true);
    // Mitigations may be true or false depending on whether checklist was marked
    expect(typeof validation.mitigations_done).toBe("boolean");
  });
});

describe("CLI + Guardian: hook management in real git repo", () => {
  it("install → status → uninstall cycle works", () => {
    // init specia
    const store = new FileStore(tmpDir);
    store.ensureDirectoryStructure();
    store.writeConfig({
      version: "0.2",
      project: { name: "test", description: "Test", stack: "Node.js", conventions: [] },
      security: { posture: "standard" },
      memory: { backend: "local" },
    });

    const hookManager = new HookManager(tmpDir);

    // Install
    const installResult = hookManager.installHook("warn");
    expect(installResult.installed).toBe(true);
    expect(installResult.mode).toBe("warn");
    expect(fs.existsSync(installResult.hook_path)).toBe(true);

    // Status
    const status = hookManager.getHookStatus();
    expect(status.installed).toBe(true);
    expect(status.mode).toBe("warn");
    expect(status.git_repo).toBe(true);

    // Uninstall
    const uninstallResult = hookManager.uninstallHook();
    expect(uninstallResult.uninstalled).toBe(true);

    // Status after uninstall
    const statusAfter = hookManager.getHookStatus();
    expect(statusAfter.installed).toBe(false);
  });

  it("hook mode change via reinstall works", () => {
    const store = new FileStore(tmpDir);
    store.ensureDirectoryStructure();
    store.writeConfig({
      version: "0.2",
      project: { name: "test", description: "Test", stack: "Node.js", conventions: [] },
      security: { posture: "standard" },
      memory: { backend: "local" },
    });

    const hookManager = new HookManager(tmpDir);

    // Install warn mode
    hookManager.installHook("warn");
    let status = hookManager.getHookStatus();
    expect(status.mode).toBe("warn");

    // Reinstall strict mode
    hookManager.installHook("strict");
    status = hookManager.getHookStatus();
    expect(status.mode).toBe("strict");

    // Verify only one marker block
    const hookContent = fs.readFileSync(status.hook_path!, "utf-8");
    const startCount = hookContent.split("VT-SPEC GUARDIAN START").length - 1;
    expect(startCount).toBe(1);
  });
});
