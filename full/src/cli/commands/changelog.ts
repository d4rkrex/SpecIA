/**
 * specia changelog command (v2.5) — Show CHANGELOG from any directory
 */

import { Command } from "commander";
import { existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";

export function registerChangelogCommand(program: Command): void {
  program
    .command("changelog")
    .description("Show SpecIA changelog")
    .option("--version <ver>", "Show changelog for a specific version (e.g. 2.5.0)")
    .option("--latest", "Show only the latest version entry (default)")
    .option("--all", "Show full changelog")
    .action((opts: { version?: string; latest?: boolean; all?: boolean }) => {
      const changelogPath = resolveChangelogPath();

      if (!changelogPath) {
        console.error("✗ CHANGELOG.md not found. Check your SpecIA installation.");
        process.exitCode = 1;
        return;
      }

      const content = readFileSync(changelogPath, "utf-8");

      if (opts.all) {
        console.log(content);
        return;
      }

      if (opts.version) {
        const section = extractSection(content, opts.version);
        if (!section) {
          console.error(`✗ No changelog entry for version ${opts.version}`);
          process.exitCode = 1;
          return;
        }
        console.log(section);
        return;
      }

      // Default: show latest entry
      const latest = extractLatestSection(content);
      if (!latest) {
        console.error("✗ Could not parse CHANGELOG.md");
        process.exitCode = 1;
        return;
      }
      console.log(latest);
      console.log(`\nFull changelog: ${changelogPath}`);
      console.log("Run: specia changelog --all\n");
    });
}

function extractLatestSection(content: string): string | null {
  const lines = content.split("\n");
  const sections: string[] = [];
  let inSection = false;
  let count = 0;

  for (const line of lines) {
    if (/^## \[/.test(line)) {
      count++;
      if (count === 1) { inSection = true; sections.push(line); continue; }
      if (count === 2) break;
    }
    if (inSection) sections.push(line);
  }

  return sections.length > 0 ? sections.join("\n").trim() : null;
}

function extractSection(content: string, version: string): string | null {
  const lines = content.split("\n");
  const sections: string[] = [];
  let inSection = false;

  for (const line of lines) {
    if (/^## \[/.test(line)) {
      if (inSection) break;
      if (line.includes(`[${version}]`)) { inSection = true; sections.push(line); continue; }
    }
    if (inSection) sections.push(line);
  }

  return sections.length > 0 ? sections.join("\n").trim() : null;
}

function resolveChangelogPath(): string | null {
  // 1. From install meta
  const metaPath = join(homedir(), ".specia", "install-meta.json");
  if (existsSync(metaPath)) {
    try {
      const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
      const repoDir = meta.repo_dir ? dirname(meta.repo_dir) : null;
      if (repoDir) {
        const p = join(repoDir, "CHANGELOG.md");
        if (existsSync(p)) return p;
      }
    } catch { /* ignore */ }
  }

  // 2. Walk up from cwd
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const p = join(dir, "CHANGELOG.md");
    if (existsSync(p)) return p;
    const parent = join(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }

  return null;
}
