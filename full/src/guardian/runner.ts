/**
 * Guardian Runner — Standalone Node.js script invoked by pre-commit hook.
 *
 * This script is called from .git/hooks/pre-commit via the marker block.
 * It imports SpecIA services directly (NOT via MCP), validates staged
 * files against spec coverage, and exits 0 (pass) or 1 (fail).
 *
 * Usage: node dist/guardian/runner.js --root <project-root> --mode <warn|strict>
 *
 * v0.2: Design Decision 13 (Services as Library), Decision 16 (Compiled JS)
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { FileStore } from "../services/store.js";
import { GuardianService } from "../services/guardian.js";
import type { GuardianMode, GuardianConfig } from "../types/index.js";
import type { ValidationResult } from "../services/guardian.js";

// ── CLI argument parsing ─────────────────────────────────────────────

interface RunnerArgs {
  root: string;
  mode: GuardianMode;
}

function parseArgs(argv: string[]): RunnerArgs {
  let root = process.cwd();
  let mode: GuardianMode = "warn";

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root" && argv[i + 1]) {
      root = argv[i + 1]!;
      i++;
    } else if (argv[i] === "--mode" && argv[i + 1]) {
      const m = argv[i + 1]!;
      if (m === "strict" || m === "warn") {
        mode = m;
      }
      i++;
    }
  }

  return { root, mode };
}

// ── Staged files ─────────────────────────────────────────────────────

function getStagedFiles(rootDir: string): string[] {
  try {
    const output = execSync(
      "git diff --cached --name-only --diff-filter=ACM",
      {
        cwd: rootDir,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      },
    ).trim();

    if (!output) return [];
    return output.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

// ── Output formatting ────────────────────────────────────────────────

function isTTY(): boolean {
  return process.stdout.isTTY === true;
}

function formatOutput(
  result: ValidationResult,
  guardian: GuardianService,
): string {
  const lines: string[] = [];
  const colorize = isTTY();

  lines.push("");
  lines.push(
    colorize
      ? `\x1b[1mSpecIA Guardian\x1b[0m — Validating ${result.staged_files} staged files...`
      : `SpecIA Guardian — Validating ${result.staged_files} staged files...`,
  );
  lines.push("");

  for (const r of result.results) {
    let icon: string;
    let detail: string;

    switch (r.status) {
      case "pass":
        icon = colorize ? "\x1b[32m✓\x1b[0m" : "OK";
        detail = r.change
          ? `covered by "${r.change}" (spec ✓, review ✓, mitigations ✓)`
          : "all checks passed";
        break;
      case "warn":
        icon = colorize ? "\x1b[33m⚠\x1b[0m" : "WARN";
        detail = r.reason === "no_spec_coverage"
          ? "no spec coverage found"
          : r.change
            ? `"${r.change}": ${r.reason ?? "warning"}`
            : (r.reason ?? "warning");
        break;
      case "fail":
        icon = colorize ? "\x1b[31m✗\x1b[0m" : "FAIL";
        detail = r.change
          ? `"${r.change}": ${r.reason ?? "failed"}`
          : (r.reason ?? "failed");
        break;
    }

    lines.push(`  ${icon} ${r.file} — ${detail}`);

    // v0.4: Add detailed spec violation errors
    if (
      r.status === "fail" &&
      r.spec_match_details &&
      r.change &&
      r.spec_match_details.verdict !== "pass"
    ) {
      const detailedError = guardian.formatSpecViolationError(
        r.file,
        r.change,
        r.spec_match_details,
      );
      lines.push(detailedError);
    }
  }

  lines.push("");
  lines.push(
    `Summary: ${result.summary.passed} passed, ${result.summary.warnings} warning(s), ${result.summary.violations} violation(s)`,
  );
  lines.push(
    `Mode: ${result.mode} (commit ${result.mode === "strict" && result.summary.violations > 0 ? "BLOCKED" : "allowed"})`,
  );
  lines.push("");

  return lines.join("\n");
}

// ── Main ─────────────────────────────────────────────────────────────

export async function run(argv: string[]): Promise<number> {
  const args = parseArgs(argv);

  // Check SpecIA is initialized
  const store = new FileStore(args.root);
  if (!store.isInitialized()) {
    // SpecIA not initialized — silently pass (don't block commits in non-specia projects)
    return 0;
  }

  // Read guardian config, override mode from CLI if provided
  const guardian = new GuardianService(args.root, store);
  const guardianConfig = guardian.readGuardianConfig();

  if (!guardianConfig.enabled) {
    return 0; // Guardian disabled in config
  }

  // CLI mode overrides config
  const effectiveConfig: GuardianConfig = {
    ...guardianConfig,
    mode: args.mode,
  };

  // Get staged files
  const stagedFiles = getStagedFiles(args.root);
  if (stagedFiles.length === 0) {
    return 0; // Nothing to validate
  }

  // Run validation (now async)
  const result = await guardian.validateStagedFiles(stagedFiles, effectiveConfig);

  // Output results
  const output = formatOutput(result, guardian);
  process.stdout.write(output);

  // Save last validation result
  saveLast(args.root, result);

  // Exit code based on mode
  if (args.mode === "strict" && result.summary.violations > 0) {
    return 1;
  }

  return 0;
}

function saveLast(rootDir: string, result: ValidationResult): void {
  try {
    const cachePath = path.join(rootDir, ".specia", "guardian-last.json");
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify(result, null, 2), "utf-8");
  } catch {
    // Non-fatal
  }
}

// ── Entry point (when run directly) ──────────────────────────────────

/* istanbul ignore next */
if (
  typeof process !== "undefined" &&
  process.argv[1] &&
  (process.argv[1].endsWith("runner.js") || process.argv[1].endsWith("runner.ts"))
) {
  run(process.argv.slice(2))
    .then((exitCode) => {
      process.exit(exitCode);
    })
    .catch((error) => {
      console.error("Guardian runner error:", error);
      process.exit(1);
    });
}
