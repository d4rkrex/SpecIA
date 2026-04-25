/**
 * CLI `specia tasks` — Generate implementation tasks from spec + review.
 *
 * HARD GATE: Refuses if review.md is missing.
 * Checks for stale review (spec changed after review).
 * Calls FileStore + renderTasks + cache services directly.
 * Design refs: Decision 18, Decision 20
 */

import { Command } from "commander";
import { FileStore } from "../../services/store.js";
import { computeSpecHash, isReviewStale } from "../../services/cache.js";
import { renderTasks } from "../../services/template.js";
import { generateApplyManifest } from "../../services/apply-manifest.js";
import {
  success,
  error,
  info,
  jsonOutput,
  isJsonMode,
} from "../output.js";
import { sanitizeInput } from "../security/validators.js";

export function registerTasksCommand(program: Command): void {
  program
    .command("tasks <change-name>")
    .description("Generate implementation tasks from spec + review")
    .option("--no-mitigations", "Exclude security mitigation tasks")
    .action(async (changeName: string, opts: {
      mitigations: boolean;
    }) => {
      // SECURITY: Sanitize change name (Mitigation AC-001, T-02)
      changeName = sanitizeInput(changeName, "change_name");
      
      const rootDir = process.cwd();
      const store = new FileStore(rootDir);

      if (!store.isInitialized()) {
        error("Not initialized. Run `specia init` first.");
        process.exitCode = 1;
        return;
      }

      // Check spec exists
      const specContent = store.readArtifact(changeName, "spec");
      if (!specContent) {
        error("Spec must exist before generating tasks. Run `specia spec` first.");
        process.exitCode = 1;
        return;
      }

      // HARD GATE: check review exists
      const reviewContent = store.readArtifact(changeName, "review");
      if (!reviewContent) {
        error("Security review is mandatory. Run `specia review` before generating tasks.");
        process.exitCode = 1;
        return;
      }

      // STALE CHECK
      const currentSpecHash = computeSpecHash(specContent);
      if (isReviewStale(reviewContent, currentSpecHash)) {
        error("Spec changed since last review. Re-run `specia review --force` before generating tasks.");
        process.exitCode = 1;
        return;
      }

      // Extract mitigations from review
      const { findings, mitigations } = extractReviewData(reviewContent);

      // Read design if present
      const designContent = store.readArtifact(changeName, "design") ?? undefined;

      try {
        const tasksContent = renderTasks({
          changeName,
          specContent,
          reviewFindings: findings,
          mitigationTasks: opts.mitigations ? mitigations : [],
          designContent,
          createdAt: new Date().toISOString(),
        });

        store.writeArtifact(changeName, "tasks", tasksContent);

        // SpecIA T-01: Generate apply-manifest.yaml with integrity hashes
        const { yaml: manifestYaml, manifest } = generateApplyManifest({
          changeName,
          tasksContent,
          reviewContent,
        });
        store.writeManifest(changeName, "apply-manifest", manifestYaml);

        store.transitionPhase(changeName, "tasks", "complete");

        const mitigationCount = opts.mitigations ? mitigations.length : 0;

        if (isJsonMode()) {
          jsonOutput({
            status: "success",
            change_name: changeName,
            tasks_path: `.specia/changes/${changeName}/tasks.md`,
            manifest_path: `.specia/changes/${changeName}/apply-manifest.yaml`,
            apply_pattern: manifest.pattern,
            worker_count: manifest.groups.length,
            mitigation_tasks: mitigationCount,
          });
        } else {
          success(`Tasks generated for "${changeName}"`);
          if (mitigationCount > 0) {
            info(`  Security mitigations: ${mitigationCount}`);
          }
          info(`  Apply pattern: ${manifest.pattern} (${manifest.groups.length} worker group${manifest.groups.length > 1 ? "s" : ""})`);
          if (designContent) {
            info("  Design decisions included as reference.");
          }
          info(`  Path: .specia/changes/${changeName}/tasks.md`);
          info(`  Manifest: .specia/changes/${changeName}/apply-manifest.yaml`);
          info(`  Next: specia done ${changeName}`);
        }
      } catch (err) {
        error(`Failed to generate tasks: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
        return;
      }
    });
}

// ── Helpers ──────────────────────────────────────────────────────────

interface ReviewData {
  findings: string[];
  mitigations: string[];
}

function extractReviewData(reviewContent: string): ReviewData {
  const findings: string[] = [];
  const mitigations: string[] = [];

  const lines = reviewContent.split("\n");
  let currentThreatId = "";

  for (const line of lines) {
    const threatMatch = line.match(/^####\s+(\S+):\s+(.+)/);
    if (threatMatch?.[1] && threatMatch[2]) {
      currentThreatId = threatMatch[1];
      findings.push(`[${currentThreatId}] ${threatMatch[2]}`);
      continue;
    }

    const mitigationMatch = line.match(/^-\s+\*\*Mitigation\*\*:\s+(.+)/);
    if (mitigationMatch?.[1]) {
      const text = currentThreatId
        ? `[${currentThreatId}] ${mitigationMatch[1]}`
        : mitigationMatch[1];
      mitigations.push(text);
      continue;
    }

    const checklistMatch = line.match(/^-\s+\[\s*\]\s+(.+)/);
    if (checklistMatch?.[1] && !mitigations.includes(checklistMatch[1])) {
      const text = checklistMatch[1];
      const exists = mitigations.some(m => m.includes(text));
      if (!exists) {
        mitigations.push(text);
      }
    }
  }

  return { findings, mitigations };
}
