/**
 * specia fleet command (v2.5) — Fleet orchestrator recommendation
 *
 * Reads apply-manifest.yaml and prints the fleet recommendation with
 * score, mode, and reasons. Informational only — does not modify state.
 *
 * SpecIA T-02: Score is advisory. Real enforcement = guardian + specia-verify.
 */

import { Command } from "commander";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { parse as parseYaml } from "yaml";
import type { ApplyManifest } from "../../types/apply-manifest.js";

export function registerFleetCommand(program: Command): void {
  const fleet = program
    .command("fleet")
    .description("Fleet orchestrator — parallel apply recommendations and planning");

  fleet
    .command("check <change>")
    .description("Show fleet recommendation for a change (reads apply-manifest.yaml)")
    .option("--json", "Output structured JSON")
    .action((changeName: string, opts: { json?: boolean }) => {
      const manifestPath = resolveManifestPath(changeName);

      if (!manifestPath) {
        const msg = `No apply-manifest.yaml found for change "${changeName}". Run: specia tasks ${changeName}`;
        if (opts.json) {
          console.log(JSON.stringify({ error: msg }, null, 2));
        } else {
          console.error(`✗ ${msg}`);
        }
        process.exitCode = 0; // Informational only
        return;
      }

      const raw = readFileSync(manifestPath, "utf-8");
      const manifest = parseYaml(raw) as ApplyManifest;
      const rec = manifest.fleet_recommendation;

      if (opts.json) {
        console.log(JSON.stringify({
          change: changeName,
          pattern: manifest.pattern,
          groups: manifest.groups.length,
          total_tasks: manifest.groups.reduce((s, g) => s + g.tasks.length, 0),
          max_workers: manifest.max_workers,
          fleet_recommendation: rec ?? null,
          manifest_path: manifestPath,
        }, null, 2));
        return;
      }

      printFleetReport(changeName, manifest);
    });
}

function printFleetReport(changeName: string, manifest: ApplyManifest): void {
  const rec = manifest.fleet_recommendation;
  const totalTasks = manifest.groups.reduce((s, g) => s + g.tasks.length, 0);

  console.log(`\n🚀 Fleet Check: ${changeName}\n`);
  console.log("─".repeat(60));
  console.log(`  Pattern:     ${manifest.pattern}`);
  console.log(`  Groups:      ${manifest.groups.length}`);
  console.log(`  Total tasks: ${totalTasks}`);
  console.log(`  Max workers: ${manifest.max_workers}`);

  if (!rec) {
    console.log("\n  ⚠ No fleet_recommendation in manifest. Re-run: specia tasks <change>");
    console.log("─".repeat(60));
    return;
  }

  const icon = rec.mode === "fleet" ? "✅" : "⏭";
  const scoreBar = buildScoreBar(rec.score);

  console.log(`\n  Recommendation: ${icon} ${rec.mode.toUpperCase()}`);
  console.log(`  Score:          ${scoreBar} ${rec.score}/100`);
  console.log(`\n  Reasons:`);
  for (const reason of rec.reasons) {
    console.log(`    • ${reason}`);
  }

  if (rec.mode === "fleet") {
    console.log(`\n  ℹ  To apply with fleet: delegate apply phase to specia-fleet`);
    console.log(`     Pattern in manifest: ${manifest.pattern}`);
    console.log(`     Worker groups: ${manifest.groups.map(g => g.group_id).join(", ")}`);
  } else {
    console.log(`\n  ℹ  Apply sequentially with specia-apply (lower overhead for this change)`);
  }

  console.log("─".repeat(60));
  console.log();
}

function buildScoreBar(score: number): string {
  const filled = Math.round(score / 10);
  return "[" + "█".repeat(filled) + "░".repeat(10 - filled) + "]";
}

function resolveManifestPath(changeName: string): string | null {
  // Walk up to find .specia/
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, ".specia", "changes", changeName, "apply-manifest.yaml");
    if (existsSync(candidate)) return candidate;
    const parent = join(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
