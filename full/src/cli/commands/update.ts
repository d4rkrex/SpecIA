/**
 * specia update command (v2.5) — Self-update from any directory
 *
 * Reads ~/.specia/install-meta.json to find the repo, then runs
 * git pull + ./install.sh --update to rebuild and reinstall.
 */

import { Command } from "commander";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { spawnSync } from "child_process";
import { homedir } from "os";

interface InstallMeta {
  version: string;
  repo_dir: string;
  installed_at: string;
  targets: string[];
}

export function registerUpdateCommand(program: Command): void {
  program
    .command("update")
    .description("Update SpecIA to the latest version (git pull + rebuild + reinstall)")
    .option("--check", "Check for updates without installing")
    .option("--json", "Output structured JSON")
    .action(async (opts: { check?: boolean; json?: boolean }) => {
      const metaPath = join(homedir(), ".specia", "install-meta.json");

      if (!existsSync(metaPath)) {
        const msg =
          "No install metadata found. SpecIA was not installed via install.sh.\n" +
          "Re-run the installer from the cloned repo:\n" +
          "  cd <specia-spec-repo> && ./install.sh";
        if (opts.json) {
          console.log(JSON.stringify({ error: msg }, null, 2));
        } else {
          console.error(`✗ ${msg}`);
        }
        process.exitCode = 1;
        return;
      }

      const meta: InstallMeta = JSON.parse(readFileSync(metaPath, "utf-8"));
      const repoDir = meta.repo_dir;
      const installSh = join(repoDir, "install.sh");

      if (!existsSync(repoDir)) {
        const msg = `Repo not found at ${repoDir}. Re-clone and run ./install.sh.`;
        if (opts.json) {
          console.log(JSON.stringify({ error: msg, meta }, null, 2));
        } else {
          console.error(`✗ ${msg}`);
        }
        process.exitCode = 1;
        return;
      }

      if (opts.check) {
        // Just show current status (skip network check to avoid hangs)
        if (opts.json) {
          console.log(JSON.stringify({
            current_version: meta.version,
            repo_dir: repoDir,
            installed_at: meta.installed_at,
            targets: meta.targets,
            tip: "Run 'specia update' to pull latest and reinstall",
          }, null, 2));
        } else {
          console.log(`\n📦 SpecIA v${meta.version}`);
          console.log(`   Repo:      ${repoDir}`);
          console.log(`   Installed: ${new Date(meta.installed_at).toLocaleDateString()}`);
          console.log(`   Targets:   ${meta.targets.join(", ")}`);
          console.log(`   Update:    run 'specia update' to pull latest`);
          console.log();
        }
        return;
      }

      if (!existsSync(installSh)) {
        const msg = `install.sh not found at ${installSh}. Re-clone the repo.`;
        console.error(`✗ ${msg}`);
        process.exitCode = 1;
        return;
      }

      // Run ./install.sh --update from the full/ subdirectory
      const fullDir = join(repoDir, "full");
      const installShFull = existsSync(join(fullDir, "install.sh"))
        ? join(fullDir, "install.sh")
        : installSh;

      console.log(`\n🚀 Updating SpecIA...`);
      console.log(`   From: v${meta.version}`);
      console.log(`   Repo: ${repoDir}\n`);

      const result = spawnSync("bash", [installShFull, "--update"], {
        cwd: repoDir,
        stdio: "inherit",
        encoding: "utf-8",
      });

      if (result.status !== 0) {
        console.error("\n✗ Update failed. Check the output above for errors.");
        process.exitCode = result.status ?? 1;
      }
    });
}
