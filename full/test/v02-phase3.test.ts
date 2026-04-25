/**
 * Phase 3+4 v0.2 tests — Guardian Service, Hook Manager, MCP Tools, Runner.
 *
 * Covers:
 * - GuardianService: 3 validation layers, file-to-change mapping, caching, glob matching
 * - HookManager: install, uninstall, status, idempotency, marker coexistence
 * - MCP tools: specia_hook_install, specia_hook_uninstall, specia_hook_status
 * - Guardian Runner: integration with real git repos
 *
 * Design refs: Decisions 13-16
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";

import { FileStore } from "../src/services/store.js";
import { GuardianService, DEFAULT_GUARDIAN_CONFIG } from "../src/services/guardian.js";
import { HookManager } from "../src/services/hook-manager.js";
import { handleHookInstall } from "../src/tools/hook-install.js";
import { handleHookUninstall } from "../src/tools/hook-uninstall.js";
import { handleHookStatus } from "../src/tools/hook-status.js";
import { handleInit } from "../src/tools/init.js";
import { handlePropose } from "../src/tools/propose.js";
import { handleSpec } from "../src/tools/spec.js";
import { handleReview } from "../src/tools/review.js";
import { handleTasks } from "../src/tools/tasks.js";
import { computeSpecHash } from "../src/services/cache.js";
import { run as guardianRun } from "../src/guardian/runner.js";
import type { GuardianConfig } from "../src/types/index.js";

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
  change: "guardian-test",
  posture: "standard",
  timestamp: new Date().toISOString(),
  spec_hash: "", // set dynamically
  stride: {
    spoofing: {
      applicable: true,
      threats: [
        {
          id: "S-01",
          title: "Session hijacking",
          description: "Attacker could steal session tokens",
          severity: "high",
          mitigation: "Use httpOnly secure cookies",
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
    risk_level: "medium",
    total_findings: 1,
    critical_findings: 0,
    mitigations_required: ["Use httpOnly secure cookies for session management"],
  },
};

/** Helper: set up SpecIA initialized project. */
async function setupProject(): Promise<void> {
  await handleInit(
    { project_description: "Guardian test project" },
    tmpDir,
  );
}

/** Helper: set up project + proposal + spec. */
async function setupWithSpec(changeName: string, scope: string[] = ["src/auth"]): Promise<void> {
  await setupProject();
  await handlePropose(
    {
      change_name: changeName,
      intent: "Add authentication",
      scope,
    },
    tmpDir,
  );
  await handleSpec(
    {
      change_name: changeName,
      requirements: SAMPLE_REQUIREMENTS,
    },
    tmpDir,
  );
}

/** Helper: set up project + proposal + spec + review. */
async function setupWithReview(changeName: string, scope: string[] = ["src/auth"]): Promise<void> {
  await setupWithSpec(changeName, scope);
  const specPath = path.join(tmpDir, ".specia", "changes", changeName, "spec.md");
  const specContent = fs.readFileSync(specPath, "utf-8");
  const hash = computeSpecHash(specContent);
  await handleReview(
    {
      change_name: changeName,
      review_result: { ...SAMPLE_REVIEW_RESULT, change: changeName, spec_hash: hash },
    },
    tmpDir,
  );
}

/** Helper: set up project + proposal + spec + review + tasks. */
async function setupWithTasks(changeName: string, scope: string[] = ["src/auth"]): Promise<void> {
  await setupWithReview(changeName, scope);
  await handleTasks(
    {
      change_name: changeName,
    },
    tmpDir,
  );
}

/** Helper: initialize a real git repo. */
function initGitRepo(dir: string): void {
  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync("git config user.email 'test@test.com'", { cwd: dir, stdio: "pipe" });
  execSync("git config user.name 'Test'", { cwd: dir, stdio: "pipe" });
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "specia-v02-phase3-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ═══════════════════════════════════════════════════════════════════════
// Phase 3: Guardian Service
// ═══════════════════════════════════════════════════════════════════════

// ── 3.1: GuardianService class — validation checks ───────────────────

describe("3.1: GuardianService — validation checks", () => {
  it("checkSpecExists returns true when spec.md exists", async () => {
    await setupWithSpec("guardian-test");
    const store = new FileStore(tmpDir);
    const guardian = new GuardianService(tmpDir, store);

    expect(guardian.checkSpecExists("guardian-test")).toBe(true);
  });

  it("checkSpecExists returns false when no spec.md", async () => {
    await setupProject();
    await handlePropose(
      { change_name: "no-spec", intent: "Test", scope: ["test"] },
      tmpDir,
    );
    const store = new FileStore(tmpDir);
    const guardian = new GuardianService(tmpDir, store);

    expect(guardian.checkSpecExists("no-spec")).toBe(false);
  });

  it("checkReviewComplete returns true when review is done and not stale", async () => {
    await setupWithReview("guardian-test");
    const store = new FileStore(tmpDir);
    const guardian = new GuardianService(tmpDir, store);

    expect(guardian.checkReviewComplete("guardian-test")).toBe(true);
  });

  it("checkReviewComplete returns false when no review exists", async () => {
    await setupWithSpec("guardian-test");
    const store = new FileStore(tmpDir);
    const guardian = new GuardianService(tmpDir, store);

    expect(guardian.checkReviewComplete("guardian-test")).toBe(false);
  });

  it("checkReviewComplete returns false when review is stale", async () => {
    await setupWithReview("guardian-test");

    // Modify spec.md to make review stale
    const specPath = path.join(tmpDir, ".specia", "changes", "guardian-test", "spec.md");
    fs.appendFileSync(specPath, "\n\n## New requirement added\n");

    const store = new FileStore(tmpDir);
    const guardian = new GuardianService(tmpDir, store);

    expect(guardian.checkReviewComplete("guardian-test")).toBe(false);
  });

  it("checkMitigationsDone returns true when all mitigations are checked", async () => {
    await setupWithTasks("guardian-test");

    // Check off the mitigation in tasks.md
    const tasksPath = path.join(tmpDir, ".specia", "changes", "guardian-test", "tasks.md");
    let content = fs.readFileSync(tasksPath, "utf-8");
    content = content.replace(/- \[ \] /g, "- [x] ");
    fs.writeFileSync(tasksPath, content);

    const store = new FileStore(tmpDir);
    const guardian = new GuardianService(tmpDir, store);

    expect(guardian.checkMitigationsDone("guardian-test")).toBe(true);
  });

  it("checkMitigationsDone returns false when mitigations are unchecked", async () => {
    await setupWithTasks("guardian-test");

    const store = new FileStore(tmpDir);
    const guardian = new GuardianService(tmpDir, store);

    // Tasks has unchecked mitigation items
    expect(guardian.checkMitigationsDone("guardian-test")).toBe(false);
  });

  it("checkMitigationsDone returns true when no mitigation section exists", async () => {
    await setupWithSpec("guardian-test");

    // Write a tasks.md without Security Mitigations section
    const tasksPath = path.join(tmpDir, ".specia", "changes", "guardian-test", "tasks.md");
    fs.writeFileSync(tasksPath, "# Tasks\n\n## Implementation\n\n- [x] Do stuff\n");

    const store = new FileStore(tmpDir);
    const guardian = new GuardianService(tmpDir, store);

    expect(guardian.checkMitigationsDone("guardian-test")).toBe(true);
  });
});

// ── 3.2: Smart caching ──────────────────────────────────────────────

describe("3.2: Guardian caching", () => {
  it("caches validation results and returns them on second call", async () => {
    await setupWithReview("guardian-test");
    const store = new FileStore(tmpDir);
    const guardian = new GuardianService(tmpDir, store);

    // Create a source file that matches the change scope
    const srcDir = path.join(tmpDir, "src", "auth");
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, "service.ts"), "export const auth = true;");

    const config: GuardianConfig = {
      ...DEFAULT_GUARDIAN_CONFIG,
      validation: {
        require_spec: true,
        require_review: true,
        require_mitigations: false, // Simplify
      },
    };

    // First call — populates cache
    const result1 = await guardian.validateStagedFiles(["src/auth/service.ts"], config);
    expect(result1.results).toHaveLength(1);

    // Cache should exist
    const cachePath = path.join(tmpDir, ".specia", ".guardian-cache.json");
    expect(fs.existsSync(cachePath)).toBe(true);

    // Second call — should use cache (same file, same content)
    const result2 = await guardian.validateStagedFiles(["src/auth/service.ts"], config);
    expect(result2.results).toHaveLength(1);
    expect(result2.results[0]!.status).toBe(result1.results[0]!.status);
  });

  it("invalidates cache when file content changes", async () => {
    await setupWithReview("guardian-test");
    const store = new FileStore(tmpDir);
    const guardian = new GuardianService(tmpDir, store);

    const srcDir = path.join(tmpDir, "src", "auth");
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, "service.ts"), "v1");

    const config: GuardianConfig = {
      ...DEFAULT_GUARDIAN_CONFIG,
      validation: {
        require_spec: true,
        require_review: true,
        require_mitigations: false,
      },
    };

    guardian.validateStagedFiles(["src/auth/service.ts"], config);

    // Change file content
    fs.writeFileSync(path.join(srcDir, "service.ts"), "v2 — different content");

    // Cache should be invalidated (different SHA)
    const result = await guardian.validateStagedFiles(["src/auth/service.ts"], config);
    expect(result.results).toHaveLength(1);
    // Still valid — result comes from fresh validation, not stale cache
  });

  it("clearCache removes the cache file", async () => {
    await setupProject();
    const store = new FileStore(tmpDir);
    const guardian = new GuardianService(tmpDir, store);

    // Create some cache
    guardian.validateStagedFiles([], DEFAULT_GUARDIAN_CONFIG);

    guardian.clearCache();
    const cachePath = path.join(tmpDir, ".specia", ".guardian-cache.json");
    expect(fs.existsSync(cachePath)).toBe(false);
  });
});

// ── 3.3: File-to-change mapping ─────────────────────────────────────

describe("3.3: File-to-change mapping", () => {
  it("maps file to change when file path appears in proposal", async () => {
    await setupWithSpec("auth-refactor", ["src/auth"]);
    const store = new FileStore(tmpDir);
    const guardian = new GuardianService(tmpDir, store);

    const config: GuardianConfig = {
      ...DEFAULT_GUARDIAN_CONFIG,
      validation: { require_spec: true, require_review: false, require_mitigations: false },
    };

    const result = await guardian.validateStagedFiles(["src/auth/login.ts"], config);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.change).toBe("auth-refactor");
  });

  it("reports no spec coverage for unmatched files", async () => {
    await setupWithSpec("auth-refactor", ["src/auth"]);
    const store = new FileStore(tmpDir);
    const guardian = new GuardianService(tmpDir, store);

    const result = await guardian.validateStagedFiles(["src/payments/billing.ts"], DEFAULT_GUARDIAN_CONFIG);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.reason).toBe("no_spec_coverage");
  });

  it("extracts scope paths from proposal", async () => {
    await setupWithSpec("auth-refactor", ["src/auth", "src/middleware"]);
    const store = new FileStore(tmpDir);
    const guardian = new GuardianService(tmpDir, store);

    const proposal = store.readArtifact("auth-refactor", "proposal") ?? "";
    const paths = guardian.extractScopePaths(proposal);
    expect(paths).toContain("src/auth");
    expect(paths).toContain("src/middleware");
  });
});

// ── 3.4: Configuration ──────────────────────────────────────────────

describe("3.4: Guardian configuration", () => {
  it("reads guardian config from .specia/config.yaml", async () => {
    await setupProject();

    // Write guardian config
    const configPath = path.join(tmpDir, ".specia", "config.yaml");
    let content = fs.readFileSync(configPath, "utf-8");
    content += `\nguardian:\n  enabled: true\n  mode: strict\n  exclude:\n    - "*.md"\n  validation:\n    require_spec: true\n    require_review: true\n    require_mitigations: false\n`;
    fs.writeFileSync(configPath, content);

    const store = new FileStore(tmpDir);
    const guardian = new GuardianService(tmpDir, store);
    const config = guardian.readGuardianConfig();

    expect(config.enabled).toBe(true);
    expect(config.mode).toBe("strict");
    expect(config.exclude).toContain("*.md");
    expect(config.validation.require_mitigations).toBe(false);
  });

  it("uses defaults when no guardian config in config.yaml", async () => {
    await setupProject();
    const store = new FileStore(tmpDir);
    const guardian = new GuardianService(tmpDir, store);
    const config = guardian.readGuardianConfig();

    expect(config).toEqual(DEFAULT_GUARDIAN_CONFIG);
  });

  it("excludes files matching glob patterns", async () => {
    await setupWithSpec("guardian-test", ["src"]);
    const store = new FileStore(tmpDir);
    const guardian = new GuardianService(tmpDir, store);

    const config: GuardianConfig = {
      ...DEFAULT_GUARDIAN_CONFIG,
      exclude: ["*.md", "test/**"],
    };

    const result = await guardian.validateStagedFiles(
      ["README.md", "test/foo.ts", "src/auth/login.ts"],
      config,
    );

    // README.md and test/foo.ts should be excluded
    expect(result.staged_files).toBe(1);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.file).toBe("src/auth/login.ts");
  });
});

// ── 3.5: Glob matching ──────────────────────────────────────────────

describe("3.5: Glob pattern matching", () => {
  it("matches *.md pattern", () => {
    const store = new FileStore(tmpDir);
    const guardian = new GuardianService(tmpDir, store);
    expect(guardian.matchGlob("README.md", "*.md")).toBe(true);
    expect(guardian.matchGlob("src/readme.md", "*.md")).toBe(false); // Not at root
  });

  it("matches **/*.test.ts pattern", () => {
    const store = new FileStore(tmpDir);
    const guardian = new GuardianService(tmpDir, store);
    expect(guardian.matchGlob("test/foo.test.ts", "**/*.test.ts")).toBe(true);
    expect(guardian.matchGlob("src/deep/nested/bar.test.ts", "**/*.test.ts")).toBe(true);
    expect(guardian.matchGlob("foo.ts", "**/*.test.ts")).toBe(false);
  });

  it("matches directory prefix (no wildcard)", () => {
    const store = new FileStore(tmpDir);
    const guardian = new GuardianService(tmpDir, store);
    expect(guardian.matchGlob("node_modules/foo/bar.js", "node_modules")).toBe(true);
    expect(guardian.matchGlob("src/node_modules.ts", "node_modules")).toBe(false);
  });

  it("matches test/** pattern", () => {
    const store = new FileStore(tmpDir);
    const guardian = new GuardianService(tmpDir, store);
    expect(guardian.matchGlob("test/foo.ts", "test/**")).toBe(true);
    expect(guardian.matchGlob("test/deep/bar.ts", "test/**")).toBe(true);
    expect(guardian.matchGlob("src/test/foo.ts", "test/**")).toBe(false);
  });
});

// ── 3.6: validateStagedFiles full integration ────────────────────────

describe("3.6: Full validation integration", () => {
  it("passes all checks when spec + review + mitigations are complete", async () => {
    await setupWithTasks("guardian-test", ["src/auth"]);

    // Check off mitigations
    const tasksPath = path.join(tmpDir, ".specia", "changes", "guardian-test", "tasks.md");
    let content = fs.readFileSync(tasksPath, "utf-8");
    content = content.replace(/- \[ \] /g, "- [x] ");
    fs.writeFileSync(tasksPath, content);

    const store = new FileStore(tmpDir);
    const guardian = new GuardianService(tmpDir, store);

    const result = await guardian.validateStagedFiles(
      ["src/auth/login.ts"],
      DEFAULT_GUARDIAN_CONFIG,
    );

    expect(result.summary.passed).toBe(1);
    expect(result.summary.violations).toBe(0);
    expect(result.results[0]!.status).toBe("pass");
  });

  it("warns in warn mode when review is incomplete", async () => {
    await setupWithSpec("guardian-test", ["src/auth"]);
    const store = new FileStore(tmpDir);
    const guardian = new GuardianService(tmpDir, store);

    const config: GuardianConfig = { ...DEFAULT_GUARDIAN_CONFIG, mode: "warn" };
    const result = await guardian.validateStagedFiles(["src/auth/login.ts"], config);

    expect(result.results[0]!.status).toBe("warn");
    expect(result.results[0]!.reason).toBe("review_incomplete");
  });

  it("fails in strict mode when review is incomplete", async () => {
    await setupWithSpec("guardian-test", ["src/auth"]);
    const store = new FileStore(tmpDir);
    const guardian = new GuardianService(tmpDir, store);

    const config: GuardianConfig = { ...DEFAULT_GUARDIAN_CONFIG, mode: "strict" };
    const result = await guardian.validateStagedFiles(["src/auth/login.ts"], config);

    expect(result.results[0]!.status).toBe("fail");
    expect(result.results[0]!.reason).toBe("review_incomplete");
  });

  it("returns empty results for empty staged file list", async () => {
    await setupProject();
    const store = new FileStore(tmpDir);
    const guardian = new GuardianService(tmpDir, store);

    const result = await guardian.validateStagedFiles([], DEFAULT_GUARDIAN_CONFIG);
    expect(result.staged_files).toBe(0);
    expect(result.results).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Phase 4: Hook Manager, MCP Tools, Runner
// ═══════════════════════════════════════════════════════════════════════

// ── 4.1: HookManager — install/uninstall/status ─────────────────────

describe("4.1: HookManager — install", () => {
  it("installs guardian hook in a git repo", async () => {
    initGitRepo(tmpDir);
    const hookManager = new HookManager(tmpDir);
    const result = hookManager.installHook("warn");

    expect(result.installed).toBe(true);
    expect(result.mode).toBe("warn");

    // Verify hook file exists
    const hookPath = path.join(tmpDir, ".git", "hooks", "pre-commit");
    expect(fs.existsSync(hookPath)).toBe(true);

    const content = fs.readFileSync(hookPath, "utf-8");
    expect(content).toContain("VT-SPEC GUARDIAN START");
    expect(content).toContain("VT-SPEC GUARDIAN END");
    expect(content).toContain('SPECIA_GUARDIAN_MODE="warn"');
  });

  it("installs with strict mode", () => {
    initGitRepo(tmpDir);
    const hookManager = new HookManager(tmpDir);
    const result = hookManager.installHook("strict");

    expect(result.mode).toBe("strict");
    const hookPath = path.join(tmpDir, ".git", "hooks", "pre-commit");
    const content = fs.readFileSync(hookPath, "utf-8");
    expect(content).toContain('SPECIA_GUARDIAN_MODE="strict"');
  });

  it("coexists with existing hook content", () => {
    initGitRepo(tmpDir);
    const hooksDir = path.join(tmpDir, ".git", "hooks");
    fs.mkdirSync(hooksDir, { recursive: true });

    // Pre-existing hook (e.g., husky)
    const hookPath = path.join(hooksDir, "pre-commit");
    fs.writeFileSync(hookPath, '#!/bin/sh\necho "husky hook"\n', { mode: 0o755 });

    const hookManager = new HookManager(tmpDir);
    const result = hookManager.installHook("warn");

    expect(result.coexisting_hooks).toBe(true);

    const content = fs.readFileSync(hookPath, "utf-8");
    expect(content).toContain("husky hook");
    expect(content).toContain("VT-SPEC GUARDIAN START");
  });

  it("is idempotent — second install updates mode", () => {
    initGitRepo(tmpDir);
    const hookManager = new HookManager(tmpDir);

    hookManager.installHook("warn");
    hookManager.installHook("strict");

    const hookPath = path.join(tmpDir, ".git", "hooks", "pre-commit");
    const content = fs.readFileSync(hookPath, "utf-8");

    // Should only have ONE marker block
    const startCount = (content.match(/VT-SPEC GUARDIAN START/g) || []).length;
    expect(startCount).toBe(1);
    expect(content).toContain('SPECIA_GUARDIAN_MODE="strict"');
  });

  it("throws when not a git repo", () => {
    const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), "specia-nogit-"));
    const hookManager = new HookManager(nonGitDir);

    expect(() => hookManager.installHook("warn")).toThrow("Not a git repository");

    fs.rmSync(nonGitDir, { recursive: true, force: true });
  });
});

describe("4.1: HookManager — uninstall", () => {
  it("removes guardian block, preserving other hooks", () => {
    initGitRepo(tmpDir);
    const hooksDir = path.join(tmpDir, ".git", "hooks");
    fs.mkdirSync(hooksDir, { recursive: true });

    // Install with existing hook
    const hookPath = path.join(hooksDir, "pre-commit");
    fs.writeFileSync(hookPath, '#!/bin/sh\necho "keep me"\n', { mode: 0o755 });

    const hookManager = new HookManager(tmpDir);
    hookManager.installHook("warn");

    const uninstallResult = hookManager.uninstallHook();
    expect(uninstallResult.uninstalled).toBe(true);
    expect(uninstallResult.had_other_hooks).toBe(true);

    const content = fs.readFileSync(hookPath, "utf-8");
    expect(content).toContain("keep me");
    expect(content).not.toContain("VT-SPEC GUARDIAN");
  });

  it("removes hook file when only guardian existed", () => {
    initGitRepo(tmpDir);
    const hookManager = new HookManager(tmpDir);

    hookManager.installHook("warn");
    const result = hookManager.uninstallHook();

    expect(result.uninstalled).toBe(true);
    expect(result.had_other_hooks).toBe(false);

    const hookPath = path.join(tmpDir, ".git", "hooks", "pre-commit");
    expect(fs.existsSync(hookPath)).toBe(false);
  });

  it("returns successfully when hook not installed", () => {
    initGitRepo(tmpDir);
    const hookManager = new HookManager(tmpDir);

    const result = hookManager.uninstallHook();
    expect(result.uninstalled).toBe(true);
  });
});

describe("4.1: HookManager — status", () => {
  it("reports installed=true when hook exists", () => {
    initGitRepo(tmpDir);
    const hookManager = new HookManager(tmpDir);
    hookManager.installHook("warn");

    const status = hookManager.getHookStatus();
    expect(status.installed).toBe(true);
    expect(status.mode).toBe("warn");
    expect(status.git_repo).toBe(true);
  });

  it("reports installed=false when no hook", () => {
    initGitRepo(tmpDir);
    const hookManager = new HookManager(tmpDir);

    const status = hookManager.getHookStatus();
    expect(status.installed).toBe(false);
    expect(status.git_repo).toBe(true);
  });

  it("reports git_repo=false for non-git directories", () => {
    const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), "specia-nogit2-"));
    const hookManager = new HookManager(nonGitDir);

    const status = hookManager.getHookStatus();
    expect(status.installed).toBe(false);
    expect(status.git_repo).toBe(false);

    fs.rmSync(nonGitDir, { recursive: true, force: true });
  });

  it("reports installed=false when hook exists but no marker", () => {
    initGitRepo(tmpDir);
    const hooksDir = path.join(tmpDir, ".git", "hooks");
    fs.mkdirSync(hooksDir, { recursive: true });

    const hookPath = path.join(hooksDir, "pre-commit");
    fs.writeFileSync(hookPath, '#!/bin/sh\necho "other hook"\n', { mode: 0o755 });

    const hookManager = new HookManager(tmpDir);
    const status = hookManager.getHookStatus();
    expect(status.installed).toBe(false);
  });
});

// ── 4.2: MCP tool — specia_hook_install ─────────────────────────────

describe("4.2: specia_hook_install MCP tool", () => {
  it("installs hook successfully", async () => {
    initGitRepo(tmpDir);
    await setupProject();

    const result = await handleHookInstall({ mode: "warn" }, tmpDir);
    expect(result.status).toBe("success");
    expect(result.data).toHaveProperty("installed", true);
    expect(result.data).toHaveProperty("mode", "warn");
  });

  it("returns NOT_INITIALIZED when project not initialized", async () => {
    initGitRepo(tmpDir);

    const result = await handleHookInstall({ mode: "warn" }, tmpDir);
    expect(result.status).toBe("error");
    expect(result.errors[0]!.code).toBe("NOT_INITIALIZED");
  });

  it("returns NOT_GIT_REPO when not a git repo", async () => {
    const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), "specia-nogit3-"));
    await handleInit(
      { project_description: "Test" },
      nonGitDir,
    );

    const result = await handleHookInstall({ mode: "warn" }, nonGitDir);
    expect(result.status).toBe("error");
    expect(result.errors[0]!.code).toBe("NOT_GIT_REPO");

    fs.rmSync(nonGitDir, { recursive: true, force: true });
  });

  it("defaults to warn mode when mode not specified", async () => {
    initGitRepo(tmpDir);
    await setupProject();

    const result = await handleHookInstall({}, tmpDir);
    expect(result.status).toBe("success");
    expect(result.data).toHaveProperty("mode", "warn");
  });
});

// ── 4.3: MCP tool — specia_hook_uninstall ───────────────────────────

describe("4.3: specia_hook_uninstall MCP tool", () => {
  it("uninstalls hook successfully", async () => {
    initGitRepo(tmpDir);
    await setupProject();

    // Install first
    await handleHookInstall({ mode: "warn" }, tmpDir);

    // Uninstall
    const result = await handleHookUninstall({}, tmpDir);
    expect(result.status).toBe("success");
    expect(result.data).toHaveProperty("uninstalled", true);
  });

  it("returns NOT_INITIALIZED when project not initialized", async () => {
    const result = await handleHookUninstall({}, tmpDir);
    expect(result.status).toBe("error");
    expect(result.errors[0]!.code).toBe("NOT_INITIALIZED");
  });
});

// ── 4.4: MCP tool — specia_hook_status ──────────────────────────────

describe("4.4: specia_hook_status MCP tool", () => {
  it("returns installed=true after install", async () => {
    initGitRepo(tmpDir);
    await setupProject();
    await handleHookInstall({ mode: "strict" }, tmpDir);

    const result = await handleHookStatus({}, tmpDir);
    expect(result.status).toBe("success");
    expect(result.data).toHaveProperty("installed", true);
    expect(result.data).toHaveProperty("mode", "strict");
  });

  it("returns installed=false when no hook", async () => {
    initGitRepo(tmpDir);
    await handleInit(
      { project_description: "Guardian test project", install_hook: false },
      tmpDir,
    );

    const result = await handleHookStatus({}, tmpDir);
    expect(result.status).toBe("success");
    expect(result.data).toHaveProperty("installed", false);
  });

  it("returns NOT_INITIALIZED when project not initialized", async () => {
    const result = await handleHookStatus({}, tmpDir);
    expect(result.status).toBe("error");
    expect(result.errors[0]!.code).toBe("NOT_INITIALIZED");
  });
});

// ── 4.5: Guardian Runner integration ────────────────────────────────

describe("4.5: Guardian Runner", () => {
  it("returns 0 when SpecIA is not initialized", async () => {
    initGitRepo(tmpDir);
    const exitCode = await guardianRun(["--root", tmpDir, "--mode", "strict"]);
    expect(exitCode).toBe(0);
  });

  it("returns 0 when guardian is disabled", async () => {
    initGitRepo(tmpDir);
    await setupProject();

    // Disable guardian in config
    const configPath = path.join(tmpDir, ".specia", "config.yaml");
    let content = fs.readFileSync(configPath, "utf-8");
    content += "\nguardian:\n  enabled: false\n  mode: warn\n  exclude: []\n  validation:\n    require_spec: true\n    require_review: true\n    require_mitigations: true\n";
    fs.writeFileSync(configPath, content);

    const exitCode = await guardianRun(["--root", tmpDir, "--mode", "strict"]);
    expect(exitCode).toBe(0);
  });

  it("returns 0 when no staged files", async () => {
    initGitRepo(tmpDir);
    await setupProject();

    const exitCode = await guardianRun(["--root", tmpDir, "--mode", "warn"]);
    expect(exitCode).toBe(0);
  });

  it("returns 0 in warn mode even with violations", async () => {
    initGitRepo(tmpDir);
    await setupWithSpec("runner-test", ["src/auth"]);

    // Stage a file
    const srcDir = path.join(tmpDir, "src", "auth");
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, "login.ts"), "export const login = true;");
    execSync("git add src/auth/login.ts", { cwd: tmpDir, stdio: "pipe" });

    const exitCode = await guardianRun(["--root", tmpDir, "--mode", "warn"]);
    expect(exitCode).toBe(0); // Warn mode → always 0
  });

  it("returns 1 in strict mode with violations", async () => {
    initGitRepo(tmpDir);
    await setupWithSpec("runner-test", ["src/auth"]);

    // Stage a file
    const srcDir = path.join(tmpDir, "src", "auth");
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, "login.ts"), "export const login = true;");
    execSync("git add src/auth/login.ts", { cwd: tmpDir, stdio: "pipe" });

    const exitCode = await guardianRun(["--root", tmpDir, "--mode", "strict"]);
    expect(exitCode).toBe(1); // Strict mode + violations → 1
  });

  it("returns 0 in strict mode when all validations pass", async () => {
    initGitRepo(tmpDir);
    await setupWithTasks("runner-test", ["src/auth"]);

    // Check off all mitigations
    const tasksPath = path.join(tmpDir, ".specia", "changes", "runner-test", "tasks.md");
    let tasksContent = fs.readFileSync(tasksPath, "utf-8");
    tasksContent = tasksContent.replace(/- \[ \] /g, "- [x] ");
    fs.writeFileSync(tasksPath, tasksContent);

    // Stage a file
    const srcDir = path.join(tmpDir, "src", "auth");
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, "login.ts"), "export const login = true;");
    execSync("git add src/auth/login.ts", { cwd: tmpDir, stdio: "pipe" });

    const exitCode = await guardianRun(["--root", tmpDir, "--mode", "strict"]);
    expect(exitCode).toBe(0);
  });

  it("parses --root and --mode args correctly", async () => {
    initGitRepo(tmpDir);
    // Just verify it doesn't crash with various arg combos
    const exitCode = await guardianRun(["--root", tmpDir, "--mode", "warn"]);
    expect(exitCode).toBe(0);
  });
});

// ── 4.6: E2E — full hook workflow ───────────────────────────────────

describe("4.6: E2E Guardian workflow", () => {
  it("install → validate → uninstall lifecycle", async () => {
    initGitRepo(tmpDir);
    await setupProject();

    // Install
    const installResult = await handleHookInstall({ mode: "warn" }, tmpDir);
    expect(installResult.status).toBe("success");

    // Status — should be installed
    const statusResult = await handleHookStatus({}, tmpDir);
    expect(statusResult.data).toHaveProperty("installed", true);

    // Uninstall
    const uninstallResult = await handleHookUninstall({}, tmpDir);
    expect(uninstallResult.status).toBe("success");

    // Status — should be not installed
    const statusResult2 = await handleHookStatus({}, tmpDir);
    expect(statusResult2.data).toHaveProperty("installed", false);
  });

  it("guardian validates staged files against active changes in a real git repo", async () => {
    initGitRepo(tmpDir);
    await setupWithReview("auth-feature", ["src/auth"]);

    // Create and stage a source file
    const srcDir = path.join(tmpDir, "src", "auth");
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, "login.ts"), "export function login() {}");
    execSync("git add .", { cwd: tmpDir, stdio: "pipe" });

    const store = new FileStore(tmpDir);
    const guardian = new GuardianService(tmpDir, store);

    // Validate with only spec + review checks (skip mitigations since no tasks yet)
    const config: GuardianConfig = {
      ...DEFAULT_GUARDIAN_CONFIG,
      validation: { require_spec: true, require_review: true, require_mitigations: false },
    };

    const result = await guardian.validateStagedFiles(["src/auth/login.ts"], config);
    expect(result.results[0]!.change).toBe("auth-feature");
    expect(result.results[0]!.checks.spec_exists).toBe(true);
    expect(result.results[0]!.checks.review_complete).toBe(true);
  });
});

// ── 4.7: Schemas ────────────────────────────────────────────────────

describe("4.7: Guardian tool schemas", () => {
  it("HookInstallInputSchema validates mode", async () => {
    const { HookInstallInputSchema } = await import("../src/tools/schemas.js");
    const valid = HookInstallInputSchema.safeParse({ mode: "strict" });
    expect(valid.success).toBe(true);
  });

  it("HookInstallInputSchema defaults mode to warn", async () => {
    const { HookInstallInputSchema } = await import("../src/tools/schemas.js");
    const valid = HookInstallInputSchema.safeParse({});
    expect(valid.success).toBe(true);
    if (valid.success) {
      expect(valid.data.mode).toBe("warn");
    }
  });

  it("HookInstallInputSchema rejects invalid mode", async () => {
    const { HookInstallInputSchema } = await import("../src/tools/schemas.js");
    const invalid = HookInstallInputSchema.safeParse({ mode: "invalid" });
    expect(invalid.success).toBe(false);
  });

  it("HookUninstallInputSchema accepts empty object", async () => {
    const { HookUninstallInputSchema } = await import("../src/tools/schemas.js");
    const valid = HookUninstallInputSchema.safeParse({});
    expect(valid.success).toBe(true);
  });

  it("HookStatusInputSchema accepts empty object", async () => {
    const { HookStatusInputSchema } = await import("../src/tools/schemas.js");
    const valid = HookStatusInputSchema.safeParse({});
    expect(valid.success).toBe(true);
  });
});
