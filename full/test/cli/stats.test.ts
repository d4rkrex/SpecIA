/**
 * CLI `specia stats` command tests.
 *
 * Tests the stats command: summary display, export, security validation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { Command } from "commander";
import { registerStatsCommand } from "../../src/cli/commands/stats.js";
import { AnalyticsService, type AnalyticsSummary, type OperationRecord } from "../../src/services/analytics.js";

let consoleLogSpy: ReturnType<typeof vi.spyOn>;
let tmpDir: string;
let analyticsDbPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "specia-cli-stats-"));
  analyticsDbPath = path.join(tmpDir, "analytics.db");
  consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  process.exitCode = undefined;
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

function createProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerStatsCommand(program);
  return program;
}

describe("CLI: specia stats", () => {
  it("shows empty state when no operations tracked", async () => {
    // Create empty analytics database
    const analytics = new AnalyticsService(analyticsDbPath);
    analytics.close();

    // Override to use test database
    const origCwd = process.cwd();
    process.chdir(tmpDir);

    const program = createProgram();
    await program.parseAsync(["node", "specia", "stats", "--project"]);

    process.chdir(origCwd);

    expect(process.exitCode).toBeUndefined();
    
    const output = consoleLogSpy.mock.calls.map(call => call[0]).join("\n");
    expect(output).toContain("No operations tracked");
  });

  it("displays summary with operation breakdown", async () => {
    // Mock AnalyticsService to return test data
    const mockGetSummary = vi.fn().mockReturnValue({
      total_operations: 2,
      total_input_tokens: 3500,
      total_output_tokens: 1400,
      total_cost_usd: 0.032,
      by_operation: {
        review: { count: 1, input_tokens: 2000, output_tokens: 800, cost_usd: 0.018 },
        audit: { count: 1, input_tokens: 1500, output_tokens: 600, cost_usd: 0.014 },
      }
    } as AnalyticsSummary);

    const mockClose = vi.fn();

    vi.spyOn(AnalyticsService.prototype, 'getSummary').mockImplementation(mockGetSummary);
    vi.spyOn(AnalyticsService.prototype, 'close').mockImplementation(mockClose);

    const program = createProgram();
    await program.parseAsync(["node", "specia", "stats"]);

    expect(process.exitCode).toBeUndefined();
    
    const output = consoleLogSpy.mock.calls.map(call => call[0]).join("\n");
    
    // Check for summary fields
    expect(output).toContain("Token Analytics");
    expect(output).toContain("Total operations: 2");
    expect(output).toContain("Total input tokens:");
    expect(output).toContain("Total output tokens:");
    expect(output).toContain("Estimated cost:");
    
    // Check for operation breakdown
    expect(output).toContain("Breakdown by operation:");
    expect(output).toContain("review");
    expect(output).toContain("audit");

    expect(mockGetSummary).toHaveBeenCalled();
    expect(mockClose).toHaveBeenCalled();
  });

  it("exports operations as JSON with --export json", async () => {
    // Mock AnalyticsService.exportOperations
    const mockExport = vi.fn().mockReturnValue([
      {
        id: 1,
        timestamp: "2026-04-17T12:00:00.000Z",
        operation: "review",
        change_name: "export-test",
        project_path: "/test/project",
        input_tokens: 1000,
        output_tokens: 400,
        cost_usd: 0.009,
        provider: "anthropic",
        model: "claude-sonnet-4",
        execution_time_ms: 1000,
      }
    ] as OperationRecord[]);

    const mockClose = vi.fn();

    vi.spyOn(AnalyticsService.prototype, 'exportOperations').mockImplementation(mockExport);
    vi.spyOn(AnalyticsService.prototype, 'close').mockImplementation(mockClose);

    const program = createProgram();
    await program.parseAsync(["node", "specia", "stats", "--export", "json"]);

    expect(process.exitCode).toBeUndefined();
    
    // Find JSON output
    const jsonCall = consoleLogSpy.mock.calls.find((call) => {
      try {
        JSON.parse(call[0] as string);
        return true;
      } catch {
        return false;
      }
    });

    expect(jsonCall).toBeDefined();
    const output = JSON.parse(jsonCall![0] as string);
    
    // Verify structure
    expect(Array.isArray(output)).toBe(true);
    expect(output.length).toBeGreaterThan(0);
    expect(output[0]).toHaveProperty("operation");
    expect(output[0]).toHaveProperty("input_tokens");
    expect(output[0]).toHaveProperty("output_tokens");
    expect(output[0]).toHaveProperty("cost_usd");
    expect(output[0].operation).toBe("review");

    expect(mockExport).toHaveBeenCalled();
    expect(mockClose).toHaveBeenCalled();
  });

  it("validates change_name to prevent SQL injection", () => {
    // This test verifies that AnalyticsService.trackOperation validates change_name
    const analytics = new AnalyticsService(analyticsDbPath);

    // Attempt SQL injection via change_name
    const maliciousChangeName = "test'; DROP TABLE operations; --";

    expect(() => {
      analytics.trackOperation({
        timestamp: new Date().toISOString(),
        operation: "review",
        change_name: maliciousChangeName, // Invalid: contains quotes and semicolons
        project_path: tmpDir,
        input_tokens: 100,
        output_tokens: 50,
        cost_usd: 0.001,
        provider: "anthropic",
        model: "claude-sonnet-4",
        execution_time_ms: 100,
      });
    }).toThrow(/Invalid change_name/);

    analytics.close();
  });

  it("uses parameterized queries (verified via code inspection)", async () => {
    // This test documents that AnalyticsService uses parameterized queries
    // Actual security verification is in src/services/analytics.ts lines 123-142
    
    const analytics = new AnalyticsService(analyticsDbPath);
    
    // Valid change name should work
    analytics.trackOperation({
      timestamp: new Date().toISOString(),
      operation: "review",
      change_name: "valid-change-name",
      project_path: tmpDir,
      input_tokens: 100,
      output_tokens: 50,
      cost_usd: 0.001,
      provider: "anthropic",
      model: "claude-sonnet-4",
      execution_time_ms: 100,
    });

    const summary = analytics.getSummary();
    expect(summary.total_operations).toBe(1);

    analytics.close();
    
    // No SQL injection possible because:
    // 1. validateChangeName() rejects malicious input
    // 2. All queries use .prepare() with ? placeholders
    // 3. Parameters passed via stmt.run() / stmt.get() / stmt.all()
  });

  it("handles unsupported export format gracefully", async () => {
    const analytics = new AnalyticsService(analyticsDbPath);
    analytics.close();

    const origCwd = process.cwd();
    process.chdir(tmpDir);

    const program = createProgram();
    
    // Attempt unsupported format
    await program.parseAsync(["node", "specia", "stats", "--export", "csv"]);

    process.chdir(origCwd);

    expect(process.exitCode).toBe(1);
  });

  it("filters by current project with --project flag", async () => {
    // Mock AnalyticsService.getSummary with projectPath argument
    const mockGetSummary = vi.fn((projectPath?: string) => {
      // Simulate filtering by project path
      if (projectPath === tmpDir) {
        return {
          total_operations: 1,
          total_input_tokens: 1000,
          total_output_tokens: 400,
          total_cost_usd: 0.009,
          by_operation: {
            audit: { count: 1, input_tokens: 1000, output_tokens: 400, cost_usd: 0.009 },
          }
        } as AnalyticsSummary;
      }
      // Return all projects if no filter
      return {
        total_operations: 2,
        total_input_tokens: 6000,
        total_output_tokens: 2400,
        total_cost_usd: 0.054,
        by_operation: {}
      } as AnalyticsSummary;
    });

    const mockClose = vi.fn();

    vi.spyOn(AnalyticsService.prototype, 'getSummary').mockImplementation(mockGetSummary);
    vi.spyOn(AnalyticsService.prototype, 'close').mockImplementation(mockClose);

    const origCwd = process.cwd();
    process.chdir(tmpDir);

    const program = createProgram();
    await program.parseAsync(["node", "specia", "stats", "--project"]);

    process.chdir(origCwd);

    expect(process.exitCode).toBeUndefined();
    
    const output = consoleLogSpy.mock.calls.map(call => call[0]).join("\n");
    
    // Should show only the current project's stats
    expect(output).toContain("Total operations: 1");
    
    // Should not include the other project's data (5000 tokens)
    expect(output).not.toContain("6,000");

    // Verify getSummary was called with project path
    expect(mockGetSummary).toHaveBeenCalledWith(tmpDir);
  });
});
