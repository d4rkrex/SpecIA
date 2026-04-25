/**
 * CLI `specia hook` command tests.
 *
 * Tests hook install, uninstall, and status subcommands.
 * Uses temp directories with git init for realistic testing.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";
import { Command } from "commander";
import { registerInitCommand } from "../../src/cli/commands/init.js";
import { registerHookCommand } from "../../src/cli/commands/hook.js";
import { setJsonMode, setQuietMode } from "../../src/cli/output.js";

let tmpDir: string;
let origCwd: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "specia-cli-hook-"));
  origCwd = process.cwd();
  process.chdir(tmpDir);
  setJsonMode(false);
  setQuietMode(false);
  process.exitCode = undefined;
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
  registerHookCommand(program);
  return program;
}

async function initProject(): Promise<void> {
  const program = createProgram();
  await program.parseAsync(["node", "specia", "init", "--description", "Test"]);
  process.exitCode = undefined;
}

function gitInit(): void {
  execSync("git init", { cwd: tmpDir, stdio: "pipe" });
}

describe("CLI: specia hook install", () => {
  it("installs hook in a git repo", async () => {
    gitInit();
    await initProject();

    const program = createProgram();
    await program.parseAsync(["node", "specia", "hook", "install"]);

    expect(process.exitCode).toBeUndefined();
    const hookPath = path.join(tmpDir, ".git", "hooks", "pre-commit");
    expect(fs.existsSync(hookPath)).toBe(true);
    const content = fs.readFileSync(hookPath, "utf-8");
    expect(content).toContain("VT-SPEC GUARDIAN START");
    expect(content).toContain("VT-SPEC GUARDIAN END");
  });

  it("installs hook in strict mode", async () => {
    gitInit();
    await initProject();

    const program = createProgram();
    await program.parseAsync(["node", "specia", "hook", "install", "--mode", "strict"]);

    expect(process.exitCode).toBeUndefined();
    const hookPath = path.join(tmpDir, ".git", "hooks", "pre-commit");
    const content = fs.readFileSync(hookPath, "utf-8");
    expect(content).toContain('"strict"');
  });

  it("defaults to warn mode", async () => {
    gitInit();
    await initProject();

    const program = createProgram();
    await program.parseAsync(["node", "specia", "hook", "install"]);

    const hookPath = path.join(tmpDir, ".git", "hooks", "pre-commit");
    const content = fs.readFileSync(hookPath, "utf-8");
    expect(content).toContain('"warn"');
  });

  it("is idempotent — installing twice works", async () => {
    gitInit();
    await initProject();

    const program1 = createProgram();
    await program1.parseAsync(["node", "specia", "hook", "install"]);
    process.exitCode = undefined;

    const program2 = createProgram();
    await program2.parseAsync(["node", "specia", "hook", "install", "--mode", "strict"]);

    expect(process.exitCode).toBeUndefined();
    const hookPath = path.join(tmpDir, ".git", "hooks", "pre-commit");
    const content = fs.readFileSync(hookPath, "utf-8");
    // Should have updated to strict mode
    expect(content).toContain('"strict"');
    // Should have exactly one marker block
    const startCount = content.split("VT-SPEC GUARDIAN START").length - 1;
    expect(startCount).toBe(1);
  });

  it("errors when not initialized", async () => {
    gitInit();
    const program = createProgram();
    await program.parseAsync(["node", "specia", "hook", "install"]);

    expect(process.exitCode).toBe(1);
  });

  it("errors when not a git repo", async () => {
    await initProject();
    const program = createProgram();
    await program.parseAsync(["node", "specia", "hook", "install"]);

    expect(process.exitCode).toBe(1);
  });
});

describe("CLI: specia hook uninstall", () => {
  it("removes the hook when installed", async () => {
    gitInit();
    await initProject();

    // Install first
    const p1 = createProgram();
    await p1.parseAsync(["node", "specia", "hook", "install"]);
    process.exitCode = undefined;

    // Uninstall
    const p2 = createProgram();
    await p2.parseAsync(["node", "specia", "hook", "uninstall"]);

    expect(process.exitCode).toBeUndefined();
    const hookPath = path.join(tmpDir, ".git", "hooks", "pre-commit");
    // File should be removed since only our hook was there
    expect(fs.existsSync(hookPath)).toBe(false);
  });

  it("preserves other hooks during uninstall", async () => {
    gitInit();
    await initProject();

    // Create a pre-existing hook
    const hooksDir = path.join(tmpDir, ".git", "hooks");
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(
      path.join(hooksDir, "pre-commit"),
      "#!/bin/sh\necho 'existing hook'\n",
      { mode: 0o755 },
    );

    // Install guardian alongside
    const p1 = createProgram();
    await p1.parseAsync(["node", "specia", "hook", "install"]);
    process.exitCode = undefined;

    // Uninstall — should preserve existing hook
    const p2 = createProgram();
    await p2.parseAsync(["node", "specia", "hook", "uninstall"]);

    expect(process.exitCode).toBeUndefined();
    const hookPath = path.join(hooksDir, "pre-commit");
    expect(fs.existsSync(hookPath)).toBe(true);
    const content = fs.readFileSync(hookPath, "utf-8");
    expect(content).toContain("existing hook");
    expect(content).not.toContain("VT-SPEC GUARDIAN START");
  });

  it("is safe when hook is not installed", async () => {
    gitInit();
    await initProject();

    const program = createProgram();
    await program.parseAsync(["node", "specia", "hook", "uninstall"]);

    expect(process.exitCode).toBeUndefined();
  });
});

describe("CLI: specia hook status", () => {
  it("shows hook is not installed", async () => {
    gitInit();
    await initProject();

    const program = createProgram();
    await program.parseAsync(["node", "specia", "hook", "status"]);

    expect(process.exitCode).toBeUndefined();
  });

  it("shows hook is installed with mode", async () => {
    gitInit();
    await initProject();

    const p1 = createProgram();
    await p1.parseAsync(["node", "specia", "hook", "install", "--mode", "strict"]);
    process.exitCode = undefined;

    const program = createProgram();
    await program.parseAsync(["node", "specia", "hook", "status"]);

    expect(process.exitCode).toBeUndefined();
  });

  it("detects not a git repo", async () => {
    await initProject();

    const program = createProgram();
    await program.parseAsync(["node", "specia", "hook", "status"]);

    expect(process.exitCode).toBeUndefined(); // Should warn, not error
  });

  it("outputs JSON in json mode", async () => {
    gitInit();
    await initProject();

    const p1 = createProgram();
    await p1.parseAsync(["node", "specia", "hook", "install"]);
    process.exitCode = undefined;

    setJsonMode(true);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const program = createProgram();
    await program.parseAsync(["node", "specia", "hook", "status"]);

    const jsonCall = logSpy.mock.calls.find((call) => {
      try {
        JSON.parse(call[0] as string);
        return true;
      } catch {
        return false;
      }
    });
    expect(jsonCall).toBeDefined();
    const output = JSON.parse(jsonCall![0] as string);
    expect(output.installed).toBe(true);
    expect(output.mode).toBe("warn");
    expect(output.git_repo).toBe(true);
  });

  it("errors when not initialized", async () => {
    gitInit();
    const program = createProgram();
    await program.parseAsync(["node", "specia", "hook", "status"]);

    expect(process.exitCode).toBe(1);
  });
});
