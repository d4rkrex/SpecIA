/**
 * CLI output helpers tests.
 *
 * Tests json mode, quiet mode, colored helpers, table rendering,
 * and phase/status colorization.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  setJsonMode,
  setQuietMode,
  isJsonMode,
  isQuietMode,
  success,
  error,
  warn,
  info,
  dim,
  jsonOutput,
  table,
  phaseColor,
  statusColor,
  withSpinner,
} from "../../src/cli/output.js";

beforeEach(() => {
  setJsonMode(false);
  setQuietMode(false);
});

describe("output mode flags", () => {
  it("defaults to non-json, non-quiet", () => {
    expect(isJsonMode()).toBe(false);
    expect(isQuietMode()).toBe(false);
  });

  it("setJsonMode toggles json mode", () => {
    setJsonMode(true);
    expect(isJsonMode()).toBe(true);
    setJsonMode(false);
    expect(isJsonMode()).toBe(false);
  });

  it("setQuietMode toggles quiet mode", () => {
    setQuietMode(true);
    expect(isQuietMode()).toBe(true);
    setQuietMode(false);
    expect(isQuietMode()).toBe(false);
  });
});

describe("colored output helpers", () => {
  it("success() outputs in normal mode", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    success("it worked");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toContain("it worked");
    spy.mockRestore();
  });

  it("success() is suppressed in json mode", () => {
    setJsonMode(true);
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    success("it worked");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("error() outputs to stderr", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    error("bad thing");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toContain("bad thing");
    spy.mockRestore();
  });

  it("error() is suppressed in json mode", () => {
    setJsonMode(true);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    error("bad thing");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("warn() outputs in normal mode", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    warn("watch out");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toContain("watch out");
    spy.mockRestore();
  });

  it("info() outputs in normal mode", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    info("hello info");
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("info() is suppressed in quiet mode", () => {
    setQuietMode(true);
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    info("hello info");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("info() is suppressed in json mode", () => {
    setJsonMode(true);
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    info("hello info");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("dim() outputs in normal mode", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    dim("gray text");
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("dim() is suppressed in quiet mode", () => {
    setQuietMode(true);
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    dim("gray text");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("jsonOutput", () => {
  it("outputs JSON when json mode is on", () => {
    setJsonMode(true);
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    jsonOutput({ status: "success", value: 42 });
    expect(spy).toHaveBeenCalledTimes(1);
    const output = JSON.parse(spy.mock.calls[0]![0] as string);
    expect(output.status).toBe("success");
    expect(output.value).toBe(42);
    spy.mockRestore();
  });

  it("does nothing when json mode is off", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    jsonOutput({ status: "success" });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("table rendering", () => {
  it("renders table with header and rows in normal mode", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    table(
      [
        { header: "Name", key: "name" },
        { header: "Age", key: "age", align: "right" as const },
      ],
      [
        { name: "Alice", age: "30" },
        { name: "Bob", age: "25" },
      ],
    );
    // Header + separator + 2 rows = 4 calls
    expect(spy).toHaveBeenCalledTimes(4);
    spy.mockRestore();
  });

  it("table is suppressed in json mode", () => {
    setJsonMode(true);
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    table(
      [{ header: "Name", key: "name" }],
      [{ name: "Alice" }],
    );
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("handles custom column widths", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    table(
      [{ header: "X", key: "x", width: 20 }],
      [{ x: "hello" }],
    );
    expect(spy).toHaveBeenCalledTimes(3); // header, separator, row
    spy.mockRestore();
  });

  it("handles color functions on columns", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    table(
      [{ header: "S", key: "s", color: (v: string) => `[${v}]` }],
      [{ s: "val" }],
    );
    expect(spy).toHaveBeenCalledTimes(3);
    // Row should include the color function output
    const rowOutput = spy.mock.calls[2]![0] as string;
    expect(rowOutput).toContain("[");
    spy.mockRestore();
  });
});

describe("phaseColor", () => {
  it("returns colored string for known phases", () => {
    const phases = ["proposal", "spec", "design", "review", "tasks"];
    for (const phase of phases) {
      const result = phaseColor(phase);
      expect(typeof result).toBe("string");
      // Chalk wraps in ANSI codes, so result should be non-empty
      expect(result.length).toBeGreaterThan(0);
    }
  });

  it("returns unchanged string for unknown phase", () => {
    expect(phaseColor("unknown")).toBe("unknown");
  });
});

describe("statusColor", () => {
  it("returns colored string for known statuses", () => {
    const statuses = ["complete", "in-progress", "failed"];
    for (const status of statuses) {
      const result = statusColor(status);
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    }
  });

  it("returns unchanged string for unknown status", () => {
    expect(statusColor("pending")).toBe("pending");
  });
});

describe("withSpinner", () => {
  it("runs function and returns result in json mode (no spinner)", async () => {
    setJsonMode(true);
    const result = await withSpinner("loading...", async () => 42);
    expect(result).toBe(42);
  });

  it("runs function and returns result in quiet mode (no spinner)", async () => {
    setQuietMode(true);
    const result = await withSpinner("loading...", async () => "done");
    expect(result).toBe("done");
  });

  it("propagates errors in json mode", async () => {
    setJsonMode(true);
    await expect(
      withSpinner("loading...", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });
});
