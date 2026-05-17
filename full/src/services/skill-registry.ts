/**
 * Skill Registry (v2.4) — Gentle-AI inspired
 *
 * Discovers and indexes SpecIA skills from the bundled skills/ directory.
 * Each skill file may have YAML frontmatter with metadata (name, description,
 * phases, user_invocable, agent_type). The registry is cached at
 * .specia/skill-registry.cache.json to avoid re-scanning on every call.
 *
 * SECURITY: No code execution from skill files. Only frontmatter is parsed.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as url from "node:url";

export interface SkillEntry {
  name: string;
  description: string;
  agent_type: string;
  phases: string[];
  user_invocable: boolean;
  file_path: string;
  license?: string;
  version?: string;
}

export interface SkillRegistry {
  built_at: string;
  skills: SkillEntry[];
}

// Skill files to discover (relative to skills/ dir)
const SKILL_GLOB_PATTERNS = ["**/SKILL.md", "**/SPECIA.md", "**/ORCHESTRATOR.md", "**/specia.md"];

/**
 * Resolve the bundled skills directory relative to this module.
 * Works both from src/ (dev) and dist/ (production).
 */
function getSkillsDir(): string {
  const moduleDir = path.dirname(url.fileURLToPath(import.meta.url));
  // src/services/ → ../../skills  or  dist/services/ → ../../skills (same structure)
  const candidate = path.resolve(moduleDir, "../../skills");
  if (fs.existsSync(candidate)) return candidate;
  // Fallback: look relative to cwd (e.g. when running from full/)
  const cwdCandidate = path.resolve(process.cwd(), "skills");
  if (fs.existsSync(cwdCandidate)) return cwdCandidate;
  throw new Error(`Could not locate SpecIA skills/ directory (tried: ${candidate}, ${cwdCandidate})`);
}

/**
 * Parse YAML frontmatter from a markdown file.
 * Only reads the first --- block. No external YAML parser needed — uses
 * a lightweight regex-based approach for the limited frontmatter schema.
 * SECURITY: No eval, no dynamic key expansion. Only known fields are extracted.
 */
function parseFrontmatter(content: string): Record<string, unknown> {
  if (!content.startsWith("---")) return {};
  const endIdx = content.indexOf("\n---", 3);
  if (endIdx === -1) return {};

  const block = content.slice(3, endIdx).trim();
  const result: Record<string, unknown> = {};

  for (const line of block.split("\n")) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const rawKey = line.slice(0, colon).trim();
    const rawVal = line.slice(colon + 1).trim().replace(/^>$/, "");

    // Only extract known safe fields
    const KNOWN_FIELDS = new Set(["name", "description", "license", "phases", "user_invocable", "agent_type"]);
    if (!KNOWN_FIELDS.has(rawKey)) continue;

    if (rawKey === "phases") {
      // Parse [a,b,c] array syntax
      const match = rawVal.match(/^\[([^\]]*)\]$/);
      result[rawKey] = match?.[1] ? match[1].split(",").map(s => s.trim()).filter(Boolean) : [];
    } else if (rawKey === "user_invocable") {
      result[rawKey] = rawVal === "true";
    } else if (rawVal && !rawVal.startsWith(">")) {
      result[rawKey] = rawVal;
    }
  }

  // description may be multi-line (> block scalar); grab the next non-empty continuation
  if (!result["description"]) {
    const lines = block.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]?.trim().startsWith("description:")) {
        // Collect indented continuation lines
        const parts: string[] = [];
        for (let j = i + 1; j < lines.length; j++) {
          const line = lines[j];
          if (line?.startsWith("  ") || line?.startsWith("\t")) {
            parts.push(line.trim());
          } else break;
        }
        if (parts.length > 0) result["description"] = parts.join(" ");
        break;
      }
    }
  }

  return result;
}

/**
 * Recursively find skill files in a directory.
 * SECURITY: Follows symlinks only within the skills/ directory.
 */
function findSkillFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findSkillFiles(fullPath));
    } else if (
      entry.isFile() &&
      SKILL_GLOB_PATTERNS.some(p => {
        const basename = p.replace("**/", "");
        return entry.name === basename;
      })
    ) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Infer agent_type from the file path if not specified in frontmatter.
 */
function inferAgentType(filePath: string, skillsDir: string): string {
  const rel = path.relative(skillsDir, filePath);
  const parts = rel.split(path.sep);
  return parts[0] ?? "generic";
}

/**
 * Build or refresh the skill registry from the skills/ directory.
 */
export function buildRegistry(): SkillRegistry {
  const skillsDir = getSkillsDir();
  const files = findSkillFiles(skillsDir);

  const skills: SkillEntry[] = [];

  for (const filePath of files) {
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

    const fm = parseFrontmatter(content);
    const agentType = String(fm["agent_type"] ?? inferAgentType(filePath, skillsDir));
    const name = String(fm["name"] ?? path.basename(path.dirname(filePath)));
    const description = String(fm["description"] ?? "").trim() || extractFirstParagraph(content);

    skills.push({
      name,
      description,
      agent_type: agentType,
      phases: Array.isArray(fm["phases"]) ? (fm["phases"] as string[]) : [],
      user_invocable: typeof fm["user_invocable"] === "boolean" ? fm["user_invocable"] : true,
      file_path: filePath,
      license: fm["license"] ? String(fm["license"]) : undefined,
      version: fm["version"] ? String(fm["version"]) : undefined,
    });
  }

  return {
    built_at: new Date().toISOString(),
    skills,
  };
}

/**
 * Extract a short description from the markdown body if no frontmatter description.
 */
function extractFirstParagraph(content: string): string {
  const body = content.startsWith("---") ? content.slice(content.indexOf("\n---", 3) + 4) : content;
  const lines = body.split("\n").map(l => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (!line.startsWith("#") && !line.startsWith(">") && !line.startsWith("-")) {
      return line.slice(0, 200);
    }
  }
  return "";
}

/**
 * Load registry from cache, or rebuild if stale/missing.
 * Cache TTL: 1 hour.
 */
export function loadRegistry(cacheDir?: string): SkillRegistry {
  if (cacheDir) {
    const cachePath = path.join(cacheDir, "skill-registry.cache.json");
    try {
      if (fs.existsSync(cachePath)) {
        const raw = JSON.parse(fs.readFileSync(cachePath, "utf-8")) as SkillRegistry;
        const age = Date.now() - new Date(raw.built_at).getTime();
        if (age < 60 * 60 * 1000) return raw; // 1-hour TTL
      }
    } catch {
      // Cache miss or corrupt — rebuild
    }
  }

  const registry = buildRegistry();

  if (cacheDir) {
    const cachePath = path.join(cacheDir, "skill-registry.cache.json");
    try {
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(cachePath, JSON.stringify(registry, null, 2), { mode: 0o600 });
    } catch {
      // Non-fatal: cache write failure
    }
  }

  return registry;
}

/**
 * Query skills with optional filters.
 */
export function querySkills(registry: SkillRegistry, opts: {
  agentType?: string;
  phase?: string;
  userInvocableOnly?: boolean;
} = {}): SkillEntry[] {
  return registry.skills.filter(s => {
    if (opts.agentType && s.agent_type !== opts.agentType) return false;
    if (opts.phase && !s.phases.includes(opts.phase)) return false;
    if (opts.userInvocableOnly && !s.user_invocable) return false;
    return true;
  });
}
