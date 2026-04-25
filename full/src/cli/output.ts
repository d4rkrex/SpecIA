/**
 * CLI output helpers — colors, spinners, tables, and structured output.
 *
 * All user-facing output goes through these helpers so --json and --quiet
 * flags are respected consistently.
 *
 * Design refs: Decision 18 (CLI Architecture)
 */

import chalk from "chalk";
import { readFile, stat } from "node:fs/promises";

// ── Global output state ──────────────────────────────────────────────

let _jsonMode = false;
let _quietMode = false;

export function setJsonMode(enabled: boolean): void {
  _jsonMode = enabled;
}

export function setQuietMode(enabled: boolean): void {
  _quietMode = enabled;
}

export function isJsonMode(): boolean {
  return _jsonMode;
}

export function isQuietMode(): boolean {
  return _quietMode;
}

// ── Colored output helpers ───────────────────────────────────────────

export function success(msg: string): void {
  if (_jsonMode) return;
  console.log(chalk.green(`\u2713 ${msg}`));
}

export function error(msg: string): void {
  if (_jsonMode) return;
  console.error(chalk.red(`\u2717 ${msg}`));
}

export function warn(msg: string): void {
  if (_jsonMode) return;
  console.log(chalk.yellow(`\u26A0 ${msg}`));
}

export function info(msg: string): void {
  if (_jsonMode || _quietMode) return;
  console.log(chalk.cyan(msg));
}

export function dim(msg: string): void {
  if (_jsonMode || _quietMode) return;
  console.log(chalk.dim(msg));
}

// ── JSON output ──────────────────────────────────────────────────────

export function jsonOutput(data: unknown): void {
  if (_jsonMode) {
    console.log(JSON.stringify(data, null, 2));
  }
}

// ── Table rendering ──────────────────────────────────────────────────

export interface TableColumn {
  header: string;
  key: string;
  width?: number;
  align?: "left" | "right";
  color?: (val: string) => string;
}

export function table(
  columns: TableColumn[],
  rows: Record<string, string>[],
): void {
  if (_jsonMode) return;

  // Calculate column widths
  const widths = columns.map((col) => {
    const maxData = rows.reduce(
      (max, row) => Math.max(max, (row[col.key] ?? "").length),
      0,
    );
    return col.width ?? Math.max(col.header.length, maxData);
  });

  // Header
  const header = columns
    .map((col, i) => chalk.bold(col.header.padEnd(widths[i] ?? 10)))
    .join("  ");
  console.log(header);
  console.log(
    columns.map((_col, i) => "\u2500".repeat(widths[i] ?? 10)).join("  "),
  );

  // Rows
  for (const row of rows) {
    const line = columns
      .map((col, i) => {
        const val = row[col.key] ?? "";
        const padded =
          col.align === "right"
            ? val.padStart(widths[i] ?? 10)
            : val.padEnd(widths[i] ?? 10);
        return col.color ? col.color(padded) : padded;
      })
      .join("  ");
    console.log(line);
  }
}

// ── Phase status coloring ────────────────────────────────────────────

export function phaseColor(phase: string): string {
  switch (phase) {
    case "proposal":
      return chalk.blue(phase);
    case "spec":
      return chalk.cyan(phase);
    case "design":
      return chalk.magenta(phase);
    case "review":
      return chalk.yellow(phase);
    case "tasks":
      return chalk.green(phase);
    default:
      return phase;
  }
}

export function statusColor(status: string): string {
  switch (status) {
    case "complete":
      return chalk.green(status);
    case "in-progress":
      return chalk.yellow(status);
    case "failed":
      return chalk.red(status);
    default:
      return status;
  }
}

// ── Spinner helpers ──────────────────────────────────────────────────

export async function withSpinner<T>(
  message: string,
  fn: () => Promise<T>,
): Promise<T> {
  // Disable spinner if not a TTY (piped output) or in JSON/quiet mode
  if (!process.stdout.isTTY || _jsonMode || _quietMode) {
    return fn();
  }

  // Dynamic import of ora (ESM-only module)
  const { default: ora } = await import("ora");
  const spinner = ora(message).start();
  try {
    const result = await fn();
    spinner.succeed();
    return result;
  } catch (err) {
    spinner.fail();
    throw err;
  }
}

// ── Stdin reader ─────────────────────────────────────────────────────

/**
 * Read all content from stdin (for pipe support).
 * Returns null if stdin is a TTY (interactive terminal).
 */
export function readStdin(): Promise<string | null> {
  if (process.stdin.isTTY) return Promise.resolve(null);

  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk: string) => {
      data += chunk;
    });
    process.stdin.on("end", () => {
      resolve(data.trim() || null);
    });
    process.stdin.on("error", reject);
  });
}

// ── JSON result input resolver ───────────────────────────────────────

/** Max file size for @file reads (10 MB). */
const MAX_RESULT_FILE_BYTES = 10 * 1024 * 1024;

export type ResolvedJson =
  | { ok: true; json: unknown }
  | { ok: false; error: string };

/**
 * Resolve a JSON result from --result flag value.
 *
 * Supports three input modes:
 *   --result '<json>'       Direct inline JSON
 *   --result -              Read JSON from stdin (explicit)
 *   --result @file.json     Read JSON from a file
 *
 * When --result is not provided, callers should use `tryStdinJson()` for
 * opportunistic stdin detection (backward-compatible: ignores invalid input).
 */
export async function resolveJsonInput(
  flagValue: string,
  fieldName: string,
): Promise<ResolvedJson> {
  // Mode 1: --result -  →  explicit stdin read
  if (flagValue === "-") {
    const content = await readStdinRaw();
    if (!content) {
      return {
        ok: false,
        error: `No input received from stdin for ${fieldName}. Pipe JSON to stdin or use --result @file.json`,
      };
    }
    try {
      return { ok: true, json: JSON.parse(content) };
    } catch {
      return { ok: false, error: `Invalid JSON from stdin for ${fieldName}.` };
    }
  }

  // Mode 2: --result @file.json  →  read from file
  if (flagValue.startsWith("@")) {
    const filePath = flagValue.slice(1);
    if (!filePath) {
      return { ok: false, error: `Empty file path in --result @. Usage: --result @path/to/result.json` };
    }
    try {
      const fileStat = await stat(filePath);
      if (!fileStat.isFile()) {
        return { ok: false, error: `"${filePath}" is not a regular file.` };
      }
      if (fileStat.size > MAX_RESULT_FILE_BYTES) {
        return { ok: false, error: `File "${filePath}" exceeds 10 MB limit.` };
      }
      const content = await readFile(filePath, "utf-8");
      return { ok: true, json: JSON.parse(content) };
    } catch (err) {
      const msg = err instanceof SyntaxError
        ? `Invalid JSON in file "${filePath}".`
        : `Failed to read "${filePath}": ${err instanceof Error ? err.message : String(err)}`;
      return { ok: false, error: msg };
    }
  }

  // Mode 3: direct inline JSON
  try {
    return { ok: true, json: JSON.parse(flagValue) };
  } catch {
    return {
      ok: false,
      error:
        `Invalid JSON in --result. The shell may have split your argument.\n` +
        `  Tips:\n` +
        `  • Use single quotes:  --result '{"key":"value"}'\n` +
        `  • Pipe from stdin:    echo '<json>' | specia review <name>\n` +
        `  • Read from file:     --result @result.json\n` +
        `  • Explicit stdin:     --result -`,
    };
  }
}

/**
 * Opportunistic stdin JSON read (backward-compatible).
 * Returns parsed JSON if stdin is piped and contains valid JSON, null otherwise.
 * Never errors — invalid/empty stdin is silently ignored.
 */
export async function tryStdinJson(): Promise<unknown | null> {
  const content = await readStdin();
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Read stdin without the TTY guard (for explicit --result - mode).
 * Times out after 5 seconds if no data arrives.
 */
function readStdinRaw(): Promise<string | null> {
  return new Promise((resolve) => {
    let data = "";
    const timeout = setTimeout(() => resolve(data.trim() || null), 5000);
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk: string) => {
      data += chunk;
    });
    process.stdin.on("end", () => {
      clearTimeout(timeout);
      resolve(data.trim() || null);
    });
    process.stdin.on("error", () => {
      clearTimeout(timeout);
      resolve(null);
    });
  });
}
