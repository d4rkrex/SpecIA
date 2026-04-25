/**
 * CLI `specia status` command tests.
 *
 * Tests the status command: listing changes, detailed view, empty state, JSON mode.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { Command } from "commander";
import { registerInitCommand } from "../../src/cli/commands/init.js";
import { registerProposeCommand } from "../../src/cli/commands/propose.js";
import { registerSpecCommand } from "../../src/cli/commands/spec.js";
import { registerStatusCommand } from "../../src/cli/commands/status.js";
import { setJsonMode, setQuietMode } from "../../src/cli/output.js";

let tmpDir: string;
let origCwd: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "specia-cli-status-"));
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
  registerProposeCommand(program);
  registerSpecCommand(program);
  registerStatusCommand(program);
  return program;
}

async function initProject(): Promise<void> {
  const program = createProgram();
  await program.parseAsync(["node", "specia", "init", "--description", "Test"]);
  process.exitCode = undefined;
}

describe("CLI: specia status", () => {
  it("shows empty state when no changes exist", async () => {
    await initProject();
    const program = createProgram();
    await program.parseAsync(["node", "specia", "status"]);

    expect(process.exitCode).toBeUndefined();
  });

  it("lists active changes", async () => {
    await initProject();

    const p1 = createProgram();
    await p1.parseAsync(["node", "specia", "propose", "change-a", "--intent", "First"]);
    process.exitCode = undefined;

    const p2 = createProgram();
    await p2.parseAsync(["node", "specia", "propose", "change-b", "--intent", "Second"]);
    process.exitCode = undefined;

    const program = createProgram();
    await program.parseAsync(["node", "specia", "status"]);

    expect(process.exitCode).toBeUndefined();
  });

  it("shows detailed status for a specific change", async () => {
    await initProject();

    const p1 = createProgram();
    await p1.parseAsync(["node", "specia", "propose", "detail-test", "--intent", "Test"]);
    process.exitCode = undefined;

    const program = createProgram();
    await program.parseAsync(["node", "specia", "status", "--change", "detail-test"]);

    expect(process.exitCode).toBeUndefined();
  });

  it("errors for nonexistent change detail", async () => {
    await initProject();
    const program = createProgram();
    await program.parseAsync(["node", "specia", "status", "--change", "nonexistent"]);

    expect(process.exitCode).toBe(1);
  });

  it("outputs JSON when json mode is set", async () => {
    await initProject();

    const p1 = createProgram();
    await p1.parseAsync(["node", "specia", "propose", "json-status", "--intent", "Test"]);
    process.exitCode = undefined;

    setJsonMode(true);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const program = createProgram();
    await program.parseAsync(["node", "specia", "status"]);

    expect(process.exitCode).toBeUndefined();
    // Find the JSON output call (jsonOutput produces formatted JSON)
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
    expect(output.changes).toBeDefined();
    expect(output.total).toBeGreaterThan(0);
  });

  it("outputs JSON for detailed change in json mode", async () => {
    await initProject();

    const p1 = createProgram();
    await p1.parseAsync(["node", "specia", "propose", "json-detail", "--intent", "Test"]);
    process.exitCode = undefined;

    setJsonMode(true);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const program = createProgram();
    await program.parseAsync(["node", "specia", "status", "--change", "json-detail"]);

    expect(process.exitCode).toBeUndefined();
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
    expect(output.change).toBe("json-detail");
  });

  it("errors when not initialized", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "specia", "status"]);

    expect(process.exitCode).toBe(1);
  });
});
