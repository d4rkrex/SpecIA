/**
 * specia skills command (v2.4) — Gentle-AI inspired skill registry
 *
 * Lists available SpecIA skills with filtering by agent type, phase, and invocability.
 */

import { Command } from "commander";
import { loadRegistry, querySkills } from "../../services/skill-registry.js";
import { info } from "../output.js";
import path from "path";
import fs from "fs";

export function registerSkillsCommand(program: Command): void {
  program
    .command("skills")
    .description("List available SpecIA skills")
    .option("--agent <type>", "Filter by agent type (copilot, claude-code, generic, opencode, orchestrator)")
    .option("--phase <phase>", "Filter by SpecIA phase (propose, review, apply, audit, etc.)")
    .option("--user-invocable", "Show only skills the user can invoke directly")
    .option("--json", "Output as JSON")
    .action((opts) => {
      const cacheDir = resolveVtspecDir();
      const registry = loadRegistry(cacheDir ?? undefined);
      const skills = querySkills(registry, {
        agentType: opts.agent,
        phase: opts.phase,
        userInvocableOnly: opts.userInvocable,
      });

      if (opts.json) {
        console.log(JSON.stringify({ skills, total: skills.length, built_at: registry.built_at }, null, 2));
        return;
      }

      if (skills.length === 0) {
        info("No skills found matching the given filters.");
        return;
      }

      console.log(`\n📦 SpecIA Skills (${skills.length} found)\n`);
      console.log("─".repeat(60));

      for (const skill of skills) {
        const invocable = skill.user_invocable ? "✓ user-invocable" : "delegate only";
        const phases = skill.phases.length > 0 ? skill.phases.join(", ") : "all";
        console.log(`\n  ${skill.name}  [${skill.agent_type}]  (${invocable})`);
        console.log(`  Phases: ${phases}`);
        console.log(`  ${skill.description.slice(0, 200)}`);
      }

      console.log(`\n${"─".repeat(60)}`);
      console.log(`  Built at: ${registry.built_at}\n`);
    });
}

function resolveVtspecDir(): string | null {
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    const candidate = path.join(dir, ".specia");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
