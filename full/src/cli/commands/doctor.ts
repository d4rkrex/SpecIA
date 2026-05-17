/**
 * specia doctor — Health-check for the SpecIA installation and active project.
 *
 * Runs a series of checks across three scopes:
 *   1. Installation  — meta, dist, CLI executable
 *   2. Project       — .specia/, config.yaml, hooks
 *   3. Active changes — state consistency, stale reviews
 *
 * Exit code 0 = all green or warnings only.
 * Exit code 1 = at least one ERROR.
 */

import { Command } from "commander";
import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { homedir } from "node:os";
import { jsonOutput, isJsonMode } from "../output.js";
import chalk from "chalk";

// ── Check result types ───────────────────────────────────────────────

type CheckStatus = "ok" | "warn" | "error" | "skip";

interface CheckResult {
  id: string;
  label: string;
  status: CheckStatus;
  message: string;
  hint?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────

function ok(id: string, label: string, message: string): CheckResult {
  return { id, label, status: "ok", message };
}

function warn(id: string, label: string, message: string, hint?: string): CheckResult {
  return { id, label, status: "warn", message, hint };
}

function err(id: string, label: string, message: string, hint?: string): CheckResult {
  return { id, label, status: "error", message, hint };
}

function skip(id: string, label: string, message: string): CheckResult {
  return { id, label, status: "skip", message };
}

function resolveVtspecRoot(): string | null {
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, ".specia"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// ── Check sections ───────────────────────────────────────────────────

function checkInstallation(): CheckResult[] {
  const results: CheckResult[] = [];

  // Check install meta
  const metaPath = path.join(homedir(), ".specia", "install-meta.json");
  if (!fs.existsSync(metaPath)) {
    results.push(err("install-meta", "Install metadata", "~/.specia/install-meta.json not found.",
      "Run: cd <vt-spec-repo>/full && ./install.sh"));
  } else {
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
      const version = meta.version ?? "?";
      const repoDir = meta.repo_dir ?? "?";
      const targets = (meta.targets ?? []).join(", ") || "none";
      results.push(ok("install-meta", "Install metadata",
        `v${version} installed from ${repoDir} (targets: ${targets})`));

      // Check repo dir still exists
      if (!fs.existsSync(repoDir)) {
        results.push(warn("repo-dir", "Repo directory",
          `repo_dir "${repoDir}" no longer exists.`,
          "Re-install from the current repo location."));
      } else {
        // Check dist is built
        const distIndex = path.join(repoDir, "dist", "cli", "index.js");
        if (!fs.existsSync(distIndex)) {
          results.push(err("dist-build", "Built dist",
            "dist/cli/index.js not found.",
            `Run: cd ${repoDir} && npm run build`));
        } else {
          const distStat = fs.statSync(distIndex);
          const ageMins = (Date.now() - distStat.mtimeMs) / 60000;
          if (ageMins > 60 * 24 * 7) {
            results.push(warn("dist-fresh", "Dist freshness",
              `dist/cli/index.js is ${Math.round(ageMins / 60 / 24)} days old.`,
              "Run: specia update  OR  cd <repo>/full && npm run build"));
          } else {
            results.push(ok("dist-fresh", "Dist freshness", "dist/cli/index.js is up to date."));
          }
        }

        // Check git status of repo
        try {
          const gitDir = path.dirname(repoDir); // full/ → repo root
          const dirty = execSync("git status --porcelain", {
            cwd: gitDir, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"],
          }).trim();
          if (dirty.split("\n").filter(Boolean).length > 5) {
            results.push(warn("repo-dirty", "Repo state",
              "More than 5 uncommitted changes in the vt-spec repo.",
              "Commit or stash changes, then run: specia update"));
          } else {
            results.push(ok("repo-dirty", "Repo state", "Working tree is clean."));
          }
        } catch {
          results.push(skip("repo-dirty", "Repo state", "Could not check git status."));
        }
      }
    } catch {
      results.push(err("install-meta", "Install metadata",
        "~/.specia/install-meta.json is not valid JSON.",
        "Re-install: cd <vt-spec-repo>/full && ./install.sh"));
    }
  }

  // Check specia binary in PATH
  try {
    const which = execSync("which specia", { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
    results.push(ok("cli-path", "CLI in PATH", `specia found at: ${which}`));
  } catch {
    results.push(err("cli-path", "CLI in PATH",
      "`specia` not found in PATH.",
      "Re-install: cd <vt-spec-repo>/full && ./install.sh"));
  }

  return results;
}

function checkProject(speciaRoot: string | null): CheckResult[] {
  if (!speciaRoot) {
    return [skip("project-init", "Project init",
      "Not inside a specia project (no .specia/ found). Run `specia init`.")];
  }

  const results: CheckResult[] = [];
  const speciaDir = path.join(speciaRoot, ".specia");

  // config.yaml
  const configPath = path.join(speciaDir, "config.yaml");
  if (!fs.existsSync(configPath)) {
    results.push(warn("config-yaml", "config.yaml",
      ".specia/config.yaml not found.",
      "Run: specia init  OR  copy config.example.yaml"));
  } else {
    const content = fs.readFileSync(configPath, "utf-8");
    if (content.includes("YOUR_") || content.includes("CHANGE_ME")) {
      results.push(warn("config-placeholder", "config.yaml content",
        "config.yaml still has placeholder values.",
        "Edit .specia/config.yaml with your actual values."));
    } else {
      results.push(ok("config-yaml", "config.yaml", ".specia/config.yaml present and configured."));
    }
  }

  // Pre-commit hook
  const hookPath = path.join(speciaRoot, ".git", "hooks", "pre-commit");
  if (!fs.existsSync(hookPath)) {
    results.push(warn("pre-commit-hook", "Pre-commit hook",
      "No pre-commit hook installed.",
      "Run: specia hook install"));
  } else {
    const hookContent = fs.readFileSync(hookPath, "utf-8");
    if (!hookContent.includes("specia")) {
      results.push(warn("pre-commit-hook", "Pre-commit hook",
        "Pre-commit hook exists but does not reference specia.",
        "Run: specia hook install --force"));
    } else {
      results.push(ok("pre-commit-hook", "Pre-commit hook", "specia guardian hook is installed."));
    }
  }

  // .specia/changes/ directory
  const changesDir = path.join(speciaDir, "changes");
  if (!fs.existsSync(changesDir)) {
    results.push(ok("changes-dir", "Changes directory", "No active changes (clean state)."));
  } else {
    const changes = fs.readdirSync(changesDir).filter(d =>
      fs.statSync(path.join(changesDir, d)).isDirectory()
    );

    if (changes.length === 0) {
      results.push(ok("changes-dir", "Changes directory", "No active changes."));
    } else {
      results.push(ok("changes-dir", "Changes directory",
        `${changes.length} active change(s): ${changes.join(", ")}`));

      // Check each change state
      for (const change of changes) {
        const statePath = path.join(changesDir, change, "state.yaml");
        if (!fs.existsSync(statePath)) {
          results.push(warn(`change-${change}`, `Change: ${change}`,
            "Missing state.yaml.",
            `Run: specia status`));
          continue;
        }

        const stateContent = fs.readFileSync(statePath, "utf-8");
        const phaseMatch = stateContent.match(/phase:\s*(\S+)/);
        const phase = phaseMatch?.[1] ?? "unknown";

        // Check for stale reviews (review.md older than proposal.md)
        const reviewPath = path.join(changesDir, change, "review.md");
        const proposalPath = path.join(changesDir, change, "proposal.md");
        if (fs.existsSync(reviewPath) && fs.existsSync(proposalPath)) {
          const reviewMtime = fs.statSync(reviewPath).mtimeMs;
          const proposalMtime = fs.statSync(proposalPath).mtimeMs;
          if (proposalMtime > reviewMtime + 60000) { // proposal newer by > 1 min
            results.push(warn(`change-stale-${change}`, `Change: ${change} (review)`,
              `review.md is older than proposal.md — review may be stale.`,
              `Run: specia review ${change}`));
          }
        }

        // Check if stuck in same phase for a long time
        if (fs.existsSync(statePath)) {
          const stateMtime = fs.statSync(statePath).mtimeMs;
          const ageDays = (Date.now() - stateMtime) / (1000 * 60 * 60 * 24);
          if (ageDays > 14) {
            results.push(warn(`change-stale-age-${change}`, `Change: ${change} (age)`,
              `Stalled in "${phase}" phase for ${Math.round(ageDays)} days.`,
              `Either continue the change or archive it.`));
          } else {
            results.push(ok(`change-${change}`, `Change: ${change}`,
              `Phase: ${phase}, active ${Math.round(ageDays * 24)}h ago.`));
          }
        }
      }
    }
  }

  // .specia/specs/ (archived)
  const specsDir = path.join(speciaDir, "specs");
  if (fs.existsSync(specsDir)) {
    const specs = fs.readdirSync(specsDir).filter(f => f.endsWith(".md"));
    results.push(ok("specs-archived", "Archived specs",
      `${specs.length} archived change(s) in .specia/specs/.`));
  }

  return results;
}

function checkGitContext(): CheckResult[] {
  const results: CheckResult[] = [];

  try {
    execSync("git rev-parse --git-dir", { stdio: "pipe" });
  } catch {
    results.push(skip("git-repo", "Git repository", "Not inside a git repository."));
    return results;
  }

  // Check for uncommitted changes
  const dirty = execSync("git status --porcelain", { encoding: "utf-8" }).trim();
  const dirtyCount = dirty.split("\n").filter(Boolean).length;
  if (dirtyCount > 20) {
    results.push(warn("git-dirty", "Working tree",
      `${dirtyCount} uncommitted files. Consider committing before running scans.`));
  } else {
    results.push(ok("git-dirty", "Working tree",
      dirtyCount === 0 ? "Clean." : `${dirtyCount} uncommitted file(s).`));
  }

  // Check for merge commits (useful for --last-merge)
  try {
    const mergeHash = execSync("git log --merges -n 1 --format=%H", { encoding: "utf-8" }).trim();
    if (mergeHash) {
      const mergeMsg = execSync(`git log -1 --format="%s" ${mergeHash}`, { encoding: "utf-8" }).trim();
      results.push(ok("git-last-merge", "Last merge",
        `${mergeHash.slice(0, 8)}: ${mergeMsg.slice(0, 60)}`));
    } else {
      results.push(skip("git-last-merge", "Last merge", "No merge commits found."));
    }
  } catch {
    results.push(skip("git-last-merge", "Last merge", "Could not detect last merge."));
  }

  return results;
}

// ── Rendering ────────────────────────────────────────────────────────

function renderResults(sections: { title: string; checks: CheckResult[] }[]): void {
  const icons: Record<CheckStatus, string> = {
    ok: chalk.green("✓"),
    warn: chalk.yellow("⚠"),
    error: chalk.red("✗"),
    skip: chalk.gray("–"),
  };

  let totalErrors = 0;
  let totalWarns = 0;

  for (const section of sections) {
    console.log(`\n${chalk.bold(section.title)}`);
    for (const check of section.checks) {
      const icon = icons[check.status];
      const label = chalk.bold(check.label.padEnd(28));
      console.log(`  ${icon} ${label} ${check.message}`);
      if (check.hint && (check.status === "warn" || check.status === "error")) {
        console.log(`    ${chalk.dim(`→ ${check.hint}`)}`);
      }
      if (check.status === "error") totalErrors++;
      if (check.status === "warn") totalWarns++;
    }
  }

  console.log("");
  if (totalErrors === 0 && totalWarns === 0) {
    console.log(chalk.green.bold("✓ All checks passed. SpecIA is healthy."));
  } else if (totalErrors === 0) {
    console.log(chalk.yellow.bold(`⚠ ${totalWarns} warning(s). No critical errors.`));
  } else {
    console.log(chalk.red.bold(`✗ ${totalErrors} error(s), ${totalWarns} warning(s). Action required.`));
  }
}

// ── Command registration ─────────────────────────────────────────────

export function registerDoctorCommand(program: Command): void {
  program
    .command("doctor")
    .description("Check SpecIA installation and project health")
    .option("--json", "Output structured JSON")
    .option("--fix", "Attempt to auto-fix warnings (re-run install, install hooks)")
    .action((opts: { json?: boolean; fix?: boolean }) => {
      const speciaRoot = resolveVtspecRoot();

      const installChecks = checkInstallation();
      const projectChecks = checkProject(speciaRoot);
      const gitChecks = checkGitContext();

      const allChecks = [...installChecks, ...projectChecks, ...gitChecks];
      const hasErrors = allChecks.some(c => c.status === "error");

      if (isJsonMode() || opts.json) {
        jsonOutput({
          healthy: !hasErrors,
          checks: allChecks,
          summary: {
            ok: allChecks.filter(c => c.status === "ok").length,
            warn: allChecks.filter(c => c.status === "warn").length,
            error: allChecks.filter(c => c.status === "error").length,
            skip: allChecks.filter(c => c.status === "skip").length,
          },
        });
      } else {
        renderResults([
          { title: "Installation", checks: installChecks },
          { title: "Project", checks: projectChecks },
          { title: "Git Context", checks: gitChecks },
        ]);

        if (opts.fix && hasErrors) {
          console.log(chalk.cyan("\n→ --fix: attempting auto-repair…"));
          // Re-run install hook if missing
          const hookFix = allChecks.find(c => c.id === "pre-commit-hook" && c.status === "warn");
          if (hookFix && speciaRoot) {
            try {
              execSync("specia hook install", { cwd: speciaRoot, stdio: "inherit" });
            } catch {
              console.error(chalk.red("  Failed to install hook."));
            }
          }
        }
      }

      if (hasErrors) process.exitCode = 1;
    });
}
