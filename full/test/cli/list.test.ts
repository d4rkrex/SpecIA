/**
 * CLI `specia --list` and `specia --search` tests.
 *
 * Tests the list command: --list, --list --compact, --search, security validation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Command } from "commander";
import { registerListCommand } from "../../src/cli/commands/list.js";

let consoleLogSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  process.exitCode = undefined;
});

afterEach(() => {
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

function createProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerListCommand(program);
  return program;
}

describe("CLI: specia --list", () => {
  it("lists all commands in table format with --list", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "specia", "--list"]);

    expect(process.exitCode).toBeUndefined();
    
    // Verify console.log was called with table content
    const output = consoleLogSpy.mock.calls.map(call => call[0]).join("\n");
    
    // Check for phase headers
    expect(output).toContain("SETUP");
    expect(output).toContain("PLANNING");
    expect(output).toContain("SECURITY");
    
    // Check for specific commands
    expect(output).toContain("init");
    expect(output).toContain("propose");
    expect(output).toContain("review");
    expect(output).toContain("audit");
    expect(output).toContain("stats");
  });

  it("shows compact output (space-separated names) with --list --compact", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "specia", "--list", "--compact"]);

    expect(process.exitCode).toBeUndefined();
    
    // Compact mode outputs a single line with space-separated command names
    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    const output = consoleLogSpy.mock.calls[0][0];
    
    // Verify it's a space-separated string
    expect(typeof output).toBe("string");
    expect(output).toContain("init");
    expect(output).toContain("propose");
    expect(output).toContain("spec");
    expect(output).toContain("review");
    expect(output).toContain("tasks");
    expect(output).toContain("audit");
    expect(output).toContain("stats");
    
    // Should NOT contain table formatting
    expect(output).not.toContain("SETUP");
    expect(output).not.toContain("│");
  });

  it("filters commands with --search security", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "specia", "--search", "security"]);

    expect(process.exitCode).toBeUndefined();
    
    const output = consoleLogSpy.mock.calls.map(call => call[0]).join("\n");
    
    // Should find security-related commands (matches on description or phase)
    expect(output).toContain("review");
    expect(output).toContain("debate");
    expect(output).toContain("search"); // "Search past specs and security findings"
    
    // Should NOT contain non-security commands
    expect(output).not.toContain("propose");
    expect(output).not.toContain("init");
  });

  it("shows no results message when search finds nothing", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "specia", "--search", "nonexistent-xyz"]);

    expect(process.exitCode).toBeUndefined();
    
    const output = consoleLogSpy.mock.calls.map(call => call[0]).join("\n");
    expect(output).toContain("No commands found");
  });

  it("search is case-insensitive", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "specia", "--search", "SECURITY"]);

    expect(process.exitCode).toBeUndefined();
    
    const output = consoleLogSpy.mock.calls.map(call => call[0]).join("\n");
    
    // Should still find security commands despite uppercase query
    expect(output).toContain("review");
    expect(output).toContain("debate");
  });

  it("search with --compact shows only matching command names", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "specia", "--search", "security", "--compact"]);

    expect(process.exitCode).toBeUndefined();
    
    // Compact mode: single line output
    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    const output = consoleLogSpy.mock.calls[0][0];
    
    expect(output).toContain("review");
    expect(output).toContain("debate");
    expect(output).not.toContain("init");
  });

  it("search finds audit command by keyword 'audit'", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "specia", "--search", "audit"]);

    expect(process.exitCode).toBeUndefined();
    
    const output = consoleLogSpy.mock.calls.map(call => call[0]).join("\n");
    
    // Should find audit command
    expect(output).toContain("audit");
    expect(output).toContain("post-implementation");
  });

  it("has no SQL injection risk (commands are hardcoded)", async () => {
    // Security test: verify that list command uses hardcoded COMMANDS array
    // No user input is used to construct queries or execute code
    
    // Attempt injection via search keyword
    const program = createProgram();
    const maliciousInput = "'; DROP TABLE users; --";
    
    // This should safely filter the hardcoded command list
    await program.parseAsync(["node", "specia", "--search", maliciousInput]);

    expect(process.exitCode).toBeUndefined();
    
    const output = consoleLogSpy.mock.calls.map(call => call[0]).join("\n");
    
    // Should show "no results" since no command matches the injection attempt
    expect(output).toContain("No commands found");
    
    // No error should be thrown (would indicate unsafe eval/exec)
    // Test passes if we reach here without exception
  });
});
