/**
 * specia_skills — Skill Registry Tool (v2.4)
 *
 * Lists available SpecIA skills with metadata: name, description, phases,
 * agent_type, and user_invocable flag.
 *
 * Gentle-AI inspired: per-agent skill discovery with frontmatter-driven metadata.
 */

import { FileStore } from "../services/store.js";
import { loadRegistry, querySkills } from "../services/skill-registry.js";
import { SkillsInputSchema } from "./schemas.js";
import { ok, fail, ErrorCodes } from "../types/tools.js";
import type { ToolResult } from "../types/index.js";
import * as path from "node:path";

interface SkillsResult {
  skills: {
    name: string;
    description: string;
    agent_type: string;
    phases: string[];
    user_invocable: boolean;
    license?: string;
  }[];
  total: number;
  built_at: string;
}

export async function handleSkills(
  args: unknown,
  rootDir: string,
): Promise<ToolResult<SkillsResult>> {
  const toolName = "specia_skills";
  const start = Date.now();

  const parsed = SkillsInputSchema.safeParse(args);
  if (!parsed.success) {
    return fail(toolName, parsed.error.issues.map(i => ({
      code: ErrorCodes.VALIDATION_ERROR,
      message: i.message,
      field: i.path.join("."),
    })), { duration_ms: Date.now() - start });
  }

  const input = parsed.data;
  const store = new FileStore(rootDir);
  const cacheDir = store.isInitialized()
    ? path.join(rootDir, ".specia")
    : undefined;

  let registry;
  try {
    registry = loadRegistry(cacheDir);
  } catch (err) {
    return fail(toolName, [{
      code: ErrorCodes.IO_ERROR,
      message: `Could not load skill registry: ${err instanceof Error ? err.message : String(err)}`,
    }], { duration_ms: Date.now() - start });
  }

  const skills = querySkills(registry, {
    agentType: input.agent_type,
    phase: input.phase,
    userInvocableOnly: input.user_invocable_only,
  });

  return ok(
    toolName,
    {
      skills: skills.map(s => ({
        name: s.name,
        description: s.description,
        agent_type: s.agent_type,
        phases: s.phases,
        user_invocable: s.user_invocable,
        license: s.license,
      })),
      total: skills.length,
      built_at: registry.built_at,
    },
    { duration_ms: Date.now() - start },
  );
}
