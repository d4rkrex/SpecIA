/**
 * Phase 1 v0.2 tests — Types, Schemas, Config, Template additions.
 *
 * Validates that v0.2 additions are correct WITHOUT breaking v0.1.
 * Covers tasks 1.1 through 1.8 of the v0.2 task breakdown.
 *
 * Spec refs: v0.2 Spec — state.yaml design phase, config.yaml schema,
 *            error codes, Zod schemas, design template.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ── Task 1.1: Phase and ArtifactType include "design" ────────────────

describe("Task 1.1: Phase and ArtifactType unions", () => {
  it("Phase type accepts 'design' as a valid value", () => {
    // TypeScript compile-time check backed by a runtime assertion.
    const phases: import("../src/types/index.js").Phase[] = [
      "proposal",
      "spec",
      "design",
      "review",
      "tasks",
    ];
    expect(phases).toContain("design");
    expect(phases).toHaveLength(5);
  });

  it("ArtifactType accepts 'design' as a valid value", () => {
    const artifacts: import("../src/types/index.js").ArtifactType[] = [
      "proposal",
      "spec",
      "design",
      "review",
      "tasks",
    ];
    expect(artifacts).toContain("design");
    expect(artifacts).toHaveLength(5);
  });

  it("ChangeState accepts design_hash field", () => {
    const state: import("../src/types/index.js").ChangeState = {
      change: "test",
      phase: "design",
      status: "complete",
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      phases_completed: ["proposal", "spec", "design"],
      history: [],
      design_hash: "sha256:abc123",
    };
    expect(state.design_hash).toBe("sha256:abc123");
    expect(state.phase).toBe("design");
  });

  it("ChangeState accepts review_stale field", () => {
    const state: import("../src/types/index.js").ChangeState = {
      change: "test",
      phase: "review",
      status: "complete",
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      phases_completed: ["proposal", "spec", "design", "review"],
      history: [],
      review_stale: true,
    };
    expect(state.review_stale).toBe(true);
  });

  it("ChangeState works without v0.2 fields (backward compat)", () => {
    const state: import("../src/types/index.js").ChangeState = {
      change: "test",
      phase: "review",
      status: "complete",
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      phases_completed: ["proposal", "spec", "review"],
      history: [],
    };
    expect(state.design_hash).toBeUndefined();
    expect(state.review_stale).toBeUndefined();
  });
});

// ── Task 1.2: GuardianConfig and CliConfig types ─────────────────────

describe("Task 1.2: GuardianConfig and CliConfig types", () => {
  it("GuardianConfig interface has correct shape", () => {
    const config: import("../src/types/index.js").GuardianConfig = {
      enabled: true,
      mode: "strict",
      exclude: ["node_modules/**", "*.md"],
      validation: {
        require_spec: true,
        require_review: true,
        require_mitigations: true,
      },
    };
    expect(config.enabled).toBe(true);
    expect(config.mode).toBe("strict");
    expect(config.exclude).toHaveLength(2);
    expect(config.validation.require_spec).toBe(true);
  });

  it("CliConfig interface has correct shape", () => {
    const config: import("../src/types/index.js").CliConfig = {
      editor: "vim",
      llm: {
        provider: "anthropic",
        api_key_env: "ANTHROPIC_API_KEY",
        model: "claude-sonnet-4-20250514",
      },
    };
    expect(config.editor).toBe("vim");
    expect(config.llm?.provider).toBe("anthropic");
    expect(config.llm?.api_key_env).toBe("ANTHROPIC_API_KEY");
  });

  it("CliConfig fields are all optional", () => {
    const config: import("../src/types/index.js").CliConfig = {};
    expect(config.editor).toBeUndefined();
    expect(config.llm).toBeUndefined();
  });

  it("VtspecConfig accepts optional guardian, cli, workflow", () => {
    const config: import("../src/types/index.js").VtspecConfig = {
      version: "0.2",
      project: {
        name: "test",
        description: "test project",
        stack: "TypeScript",
        conventions: [],
      },
      security: { posture: "standard" },
      memory: { backend: "local" },
      guardian: {
        enabled: true,
        mode: "warn",
        exclude: [],
        validation: {
          require_spec: true,
          require_review: true,
          require_mitigations: false,
        },
      },
      cli: { editor: "code" },
      workflow: { include_design: true },
    };
    expect(config.guardian?.mode).toBe("warn");
    expect(config.cli?.editor).toBe("code");
    expect(config.workflow?.include_design).toBe(true);
  });

  it("VtspecConfig works WITHOUT v0.2 optional sections (v0.1 compat)", () => {
    const config: import("../src/types/index.js").VtspecConfig = {
      version: "0.1",
      project: {
        name: "old-project",
        description: "v0.1 project",
        stack: "Python",
        conventions: ["pytest"],
      },
      security: { posture: "elevated" },
      memory: { backend: "alejandria" },
    };
    expect(config.guardian).toBeUndefined();
    expect(config.cli).toBeUndefined();
    expect(config.workflow).toBeUndefined();
  });
});

// ── Task 1.3: New error codes ────────────────────────────────────────

describe("Task 1.3: New error codes", () => {
  it("has all v0.1 error codes unchanged", async () => {
    const { ErrorCodes } = await import("../src/types/tools.js");
    expect(ErrorCodes.VALIDATION_ERROR).toBe("VALIDATION_ERROR");
    expect(ErrorCodes.NOT_INITIALIZED).toBe("NOT_INITIALIZED");
    expect(ErrorCodes.ALREADY_INITIALIZED).toBe("ALREADY_INITIALIZED");
    expect(ErrorCodes.CHANGE_EXISTS).toBe("CHANGE_EXISTS");
    expect(ErrorCodes.CHANGE_NOT_FOUND).toBe("CHANGE_NOT_FOUND");
    expect(ErrorCodes.MISSING_DEPENDENCY).toBe("MISSING_DEPENDENCY");
    expect(ErrorCodes.REVIEW_REQUIRED).toBe("REVIEW_REQUIRED");
    expect(ErrorCodes.REVIEW_STALE).toBe("REVIEW_STALE");
    expect(ErrorCodes.INCOMPLETE_CHANGE).toBe("INCOMPLETE_CHANGE");
    expect(ErrorCodes.INVALID_CONFIG).toBe("INVALID_CONFIG");
    expect(ErrorCodes.IO_ERROR).toBe("IO_ERROR");
    expect(ErrorCodes.ALEJANDRIA_UNAVAILABLE).toBe("ALEJANDRIA_UNAVAILABLE");
    expect(ErrorCodes.INTERNAL_ERROR).toBe("INTERNAL_ERROR");
  });

  it("has v0.2 design phase error code", async () => {
    const { ErrorCodes } = await import("../src/types/tools.js");
    expect(ErrorCodes.DESIGN_NOT_FOUND).toBe("DESIGN_NOT_FOUND");
  });

  it("has v0.2 guardian hook error codes", async () => {
    const { ErrorCodes } = await import("../src/types/tools.js");
    expect(ErrorCodes.NOT_GIT_REPO).toBe("NOT_GIT_REPO");
    expect(ErrorCodes.HOOK_INSTALL_FAILED).toBe("HOOK_INSTALL_FAILED");
    expect(ErrorCodes.GUARDIAN_VALIDATION_FAILED).toBe("GUARDIAN_VALIDATION_FAILED");
  });

  it("has v0.2 CLI error codes", async () => {
    const { ErrorCodes } = await import("../src/types/tools.js");
    expect(ErrorCodes.LLM_NOT_CONFIGURED).toBe("LLM_NOT_CONFIGURED");
    expect(ErrorCodes.LLM_API_ERROR).toBe("LLM_API_ERROR");
    expect(ErrorCodes.INVALID_REVIEW_RESULT).toBe("INVALID_REVIEW_RESULT");
    expect(ErrorCodes.EDITOR_ERROR).toBe("EDITOR_ERROR");
  });

  it("has exactly 27 error codes total (13 v0.1 + 8 v0.2 + 1 v0.3 + 1 v0.5 + 3 fix-empty-audit + 1 v2.0)", async () => {
    const { ErrorCodes } = await import("../src/types/tools.js");
    expect(Object.keys(ErrorCodes)).toHaveLength(27);
  });
});

// ── Task 1.4: ReviewPrompt design_content field ──────────────────────

describe("Task 1.4: ReviewPrompt design_content field", () => {
  it("ReviewPrompt.context accepts has_design flag", () => {
    const prompt: import("../src/types/index.js").ReviewPrompt = {
      system_instructions: "test",
      analysis_request: "test with design content",
      output_schema: {},
      context: {
        stack: "TypeScript",
        change_name: "test-change",
        has_proposal: false,
        has_design: true,
      },
    };
    expect(prompt.context.has_design).toBe(true);
  });

  it("ReviewPrompt.context works without design (v0.1 compat)", () => {
    const prompt: import("../src/types/index.js").ReviewPrompt = {
      system_instructions: "test",
      analysis_request: "test",
      output_schema: {},
      context: {
        stack: "TypeScript",
        change_name: "test-change",
        has_proposal: false,
        has_design: false,
      },
    };
    expect(prompt.context.has_design).toBe(false);
  });
});

// ── Task 1.6: New Zod schemas ────────────────────────────────────────

describe("Task 1.6: New Zod schemas", () => {
  describe("DesignInputSchema", () => {
    let DesignInputSchema: typeof import("../src/tools/schemas.js").DesignInputSchema;

    beforeEach(async () => {
      ({ DesignInputSchema } = await import("../src/tools/schemas.js"));
    });

    it("accepts valid input with change_name only (phase 1)", () => {
      const result = DesignInputSchema.safeParse({
        change_name: "auth-refactor",
      });
      expect(result.success).toBe(true);
    });

    it("accepts valid input with change_name and design_content (phase 2)", () => {
      const result = DesignInputSchema.safeParse({
        change_name: "auth-refactor",
        design_content: "# Design: auth-refactor\n\n## Technical Approach\n...",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.design_content).toContain("Technical Approach");
      }
    });

    it("rejects missing change_name", () => {
      const result = DesignInputSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it("rejects invalid change_name (not kebab-case)", () => {
      const result = DesignInputSchema.safeParse({
        change_name: "Auth Refactor",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("HookInstallInputSchema", () => {
    let HookInstallInputSchema: typeof import("../src/tools/schemas.js").HookInstallInputSchema;

    beforeEach(async () => {
      ({ HookInstallInputSchema } = await import("../src/tools/schemas.js"));
    });

    it("accepts empty input (defaults to warn mode)", () => {
      const result = HookInstallInputSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.mode).toBe("warn");
      }
    });

    it("accepts strict mode", () => {
      const result = HookInstallInputSchema.safeParse({ mode: "strict" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.mode).toBe("strict");
      }
    });

    it("accepts exclude patterns", () => {
      const result = HookInstallInputSchema.safeParse({
        mode: "warn",
        exclude: ["*.md", "test/**"],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.exclude).toEqual(["*.md", "test/**"]);
      }
    });

    it("rejects invalid mode", () => {
      const result = HookInstallInputSchema.safeParse({ mode: "permissive" });
      expect(result.success).toBe(false);
    });
  });

  describe("HookUninstallInputSchema", () => {
    let HookUninstallInputSchema: typeof import("../src/tools/schemas.js").HookUninstallInputSchema;

    beforeEach(async () => {
      ({ HookUninstallInputSchema } = await import("../src/tools/schemas.js"));
    });

    it("accepts empty input", () => {
      const result = HookUninstallInputSchema.safeParse({});
      expect(result.success).toBe(true);
    });
  });

  describe("HookStatusInputSchema", () => {
    let HookStatusInputSchema: typeof import("../src/tools/schemas.js").HookStatusInputSchema;

    beforeEach(async () => {
      ({ HookStatusInputSchema } = await import("../src/tools/schemas.js"));
    });

    it("accepts empty input", () => {
      const result = HookStatusInputSchema.safeParse({});
      expect(result.success).toBe(true);
    });
  });
});

// ── Task 1.7: ConfigSchema Zod validator ─────────────────────────────

describe("Task 1.7: ConfigSchema backward compatibility", () => {
  let tmpDir: string;
  let FileStore: typeof import("../src/services/store.js").FileStore;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "specia-phase1-"));
    ({ FileStore } = await import("../src/services/store.js"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeRawConfig(yaml: string) {
    const speciaDir = path.join(tmpDir, ".specia");
    fs.mkdirSync(speciaDir, { recursive: true });
    fs.writeFileSync(path.join(speciaDir, "config.yaml"), yaml, "utf-8");
  }

  it("validates v0.1 config WITHOUT guardian/cli/workflow (backward compat)", () => {
    writeRawConfig(`
version: "0.1"
project:
  name: test-project
  description: A test
  stack: TypeScript
  conventions: []
security:
  posture: standard
memory:
  backend: local
`);
    const store = new FileStore(tmpDir);
    const config = store.readConfig();
    expect(config.version).toBe("0.1");
    expect(config.guardian).toBeUndefined();
    expect(config.cli).toBeUndefined();
    expect(config.workflow).toBeUndefined();
  });

  it("validates v0.2 config WITH guardian section", () => {
    writeRawConfig(`
version: "0.2"
project:
  name: test-project
  description: A test
  stack: TypeScript
  conventions: []
security:
  posture: elevated
memory:
  backend: local
guardian:
  enabled: true
  mode: strict
  exclude:
    - "*.md"
    - "test/**"
  validation:
    require_spec: true
    require_review: true
    require_mitigations: false
`);
    const store = new FileStore(tmpDir);
    const config = store.readConfig();
    expect(config.guardian?.enabled).toBe(true);
    expect(config.guardian?.mode).toBe("strict");
    expect(config.guardian?.exclude).toEqual(["*.md", "test/**"]);
    expect(config.guardian?.validation.require_mitigations).toBe(false);
  });

  it("validates v0.2 config WITH cli section", () => {
    writeRawConfig(`
version: "0.2"
project:
  name: test-project
  description: A test
  stack: TypeScript
  conventions: []
security:
  posture: standard
memory:
  backend: local
cli:
  editor: vim
  llm:
    provider: anthropic
    api_key_env: ANTHROPIC_API_KEY
    model: claude-sonnet-4-20250514
`);
    const store = new FileStore(tmpDir);
    const config = store.readConfig();
    expect(config.cli?.editor).toBe("vim");
    expect(config.cli?.llm?.provider).toBe("anthropic");
    expect(config.cli?.llm?.api_key_env).toBe("ANTHROPIC_API_KEY");
    expect(config.cli?.llm?.model).toBe("claude-sonnet-4-20250514");
  });

  it("validates v0.2 config WITH workflow section", () => {
    writeRawConfig(`
version: "0.2"
project:
  name: test-project
  description: A test
  stack: TypeScript
  conventions: []
security:
  posture: standard
memory:
  backend: local
workflow:
  include_design: true
`);
    const store = new FileStore(tmpDir);
    const config = store.readConfig();
    expect(config.workflow?.include_design).toBe(true);
  });

  it("validates v0.2 config with ALL new sections", () => {
    writeRawConfig(`
version: "0.2"
project:
  name: full-v02-project
  description: Full v0.2 config test
  stack: TypeScript/Node.js
  conventions:
    - vitest
    - ESM
security:
  posture: paranoid
memory:
  backend: alejandria
  alejandria_cmd: npx alejandria-mcp
guardian:
  enabled: true
  mode: warn
  exclude:
    - "node_modules/**"
    - "dist/**"
  validation:
    require_spec: true
    require_review: true
    require_mitigations: true
cli:
  editor: code
  llm:
    provider: openai
    api_key_env: OPENAI_API_KEY
workflow:
  include_design: true
`);
    const store = new FileStore(tmpDir);
    const config = store.readConfig();
    expect(config.version).toBe("0.2");
    expect(config.guardian?.mode).toBe("warn");
    expect(config.cli?.llm?.provider).toBe("openai");
    expect(config.workflow?.include_design).toBe(true);
  });

  it("rejects invalid guardian.mode value", () => {
    writeRawConfig(`
version: "0.2"
project:
  name: test
  description: test
  stack: ts
  conventions: []
security:
  posture: standard
memory:
  backend: local
guardian:
  enabled: true
  mode: permissive
`);
    const store = new FileStore(tmpDir);
    expect(() => store.readConfig()).toThrow(/Invalid config.yaml/);
  });

  it("rejects invalid cli.llm.provider value", () => {
    writeRawConfig(`
version: "0.2"
project:
  name: test
  description: test
  stack: ts
  conventions: []
security:
  posture: standard
memory:
  backend: local
cli:
  llm:
    provider: gemini
    api_key_env: GEMINI_KEY
`);
    const store = new FileStore(tmpDir);
    expect(() => store.readConfig()).toThrow(/Invalid config.yaml/);
  });

  it("applies guardian validation defaults when partial", () => {
    writeRawConfig(`
version: "0.2"
project:
  name: test
  description: test
  stack: ts
  conventions: []
security:
  posture: standard
memory:
  backend: local
guardian:
  mode: strict
`);
    const store = new FileStore(tmpDir);
    const config = store.readConfig();
    // enabled defaults to true, validation defaults to all true
    expect(config.guardian?.enabled).toBe(true);
    expect(config.guardian?.validation.require_spec).toBe(true);
    expect(config.guardian?.validation.require_review).toBe(true);
    expect(config.guardian?.validation.require_mitigations).toBe(true);
    expect(config.guardian?.exclude).toEqual([]);
  });
});

// ── Task 1.8: Design template ────────────────────────────────────────

describe("Task 1.8: Design template and renderDesignPrompt", () => {
  it("design.md.tmpl file exists", () => {
    const templatePath = path.resolve(
      __dirname,
      "../templates/design.md.tmpl",
    );
    expect(fs.existsSync(templatePath)).toBe(true);
  });

  it("design.md.tmpl contains required sections", () => {
    const templatePath = path.resolve(
      __dirname,
      "../templates/design.md.tmpl",
    );
    const content = fs.readFileSync(templatePath, "utf-8");
    expect(content).toContain("## Technical Approach");
    expect(content).toContain("## Architecture Decisions");
    expect(content).toContain("## Component Design");
    expect(content).toContain("## Data Flow");
    expect(content).toContain("## API Contracts / Interfaces");
    expect(content).toContain("## File Changes");
    expect(content).toContain("## Testing Strategy");
    expect(content).toContain("## Open Questions");
    expect(content).toContain("{{change_name}}");
    expect(content).toContain("{{timestamp}}");
  });

  it("renderDesignPrompt returns prompt with context and template", async () => {
    const { renderDesignPrompt } = await import(
      "../src/services/template.js"
    );
    const result = renderDesignPrompt(
      "auth-refactor",
      "# Proposal\n\nRefactor auth module.",
      "# Spec\n\nRequirements...",
    );

    expect(result).toContain("# Design Prompt");
    expect(result).toContain("## Context: Proposal");
    expect(result).toContain("Refactor auth module.");
    expect(result).toContain("## Context: Specification");
    expect(result).toContain("Requirements...");
    expect(result).toContain("## Design Template");
    expect(result).toContain("auth-refactor");
    // Template sections should be present
    expect(result).toContain("## Technical Approach");
    expect(result).toContain("## Architecture Decisions");
  });

  it("renderDesignPrompt substitutes change_name in template", async () => {
    const { renderDesignPrompt } = await import(
      "../src/services/template.js"
    );
    const result = renderDesignPrompt(
      "payment-api",
      "# Proposal",
      "# Spec",
    );
    expect(result).toContain("# Design: payment-api");
  });
});

// ── Task 1.5: Index exports ──────────────────────────────────────────

describe("Task 1.5: Type index exports all v0.2 types", () => {
  it("exports GuardianConfig type", async () => {
    const types = await import("../src/types/index.js");
    // Type-only exports don't have runtime values, but ErrorCodes should be available
    expect(types.ErrorCodes.DESIGN_NOT_FOUND).toBeDefined();
  });

  it("exports all v0.2 ErrorCodes via index", async () => {
    const { ErrorCodes } = await import("../src/types/index.js");
    // All 8 new codes accessible from index
    expect(ErrorCodes.DESIGN_NOT_FOUND).toBe("DESIGN_NOT_FOUND");
    expect(ErrorCodes.NOT_GIT_REPO).toBe("NOT_GIT_REPO");
    expect(ErrorCodes.HOOK_INSTALL_FAILED).toBe("HOOK_INSTALL_FAILED");
    expect(ErrorCodes.GUARDIAN_VALIDATION_FAILED).toBe("GUARDIAN_VALIDATION_FAILED");
    expect(ErrorCodes.LLM_NOT_CONFIGURED).toBe("LLM_NOT_CONFIGURED");
    expect(ErrorCodes.LLM_API_ERROR).toBe("LLM_API_ERROR");
    expect(ErrorCodes.INVALID_REVIEW_RESULT).toBe("INVALID_REVIEW_RESULT");
    expect(ErrorCodes.EDITOR_ERROR).toBe("EDITOR_ERROR");
  });
});

// ── FileStore reads/writes design artifact ───────────────────────────

describe("FileStore design artifact support", () => {
  let tmpDir: string;
  let FileStore: typeof import("../src/services/store.js").FileStore;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "specia-design-artifact-"));
    ({ FileStore } = await import("../src/services/store.js"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writeArtifact/readArtifact round-trips design.md", () => {
    const store = new FileStore(tmpDir);
    store.ensureDirectoryStructure();
    const content = "# Design: test\n\n## Technical Approach\n\nDo the thing.";
    store.writeArtifact("my-change", "design", content);
    const read = store.readArtifact("my-change", "design");
    expect(read).toBe(content);
  });

  it("readArtifact returns null when design.md does not exist", () => {
    const store = new FileStore(tmpDir);
    store.ensureDirectoryStructure();
    const read = store.readArtifact("my-change", "design");
    expect(read).toBeNull();
  });

  it("transitionPhase works with 'design' phase", () => {
    const store = new FileStore(tmpDir);
    store.ensureDirectoryStructure();
    store.writeConfig({
      version: "0.2",
      project: { name: "t", description: "t", stack: "ts", conventions: [] },
      security: { posture: "standard" },
      memory: { backend: "local" },
    });
    // Start at spec complete
    store.transitionPhase("my-change", "spec", "complete");
    // Transition to design
    store.transitionPhase("my-change", "design", "complete");
    const state = store.getChangeState("my-change");
    expect(state?.phase).toBe("design");
    expect(state?.status).toBe("complete");
    expect(state?.phases_completed).toContain("design");
    expect(state?.phases_completed).toContain("spec");
  });
});

// ── Continue tool handles design phase (basic) ───────────────────────

describe("continue tool with design phase (Phase 1 foundation)", () => {
  let tmpDir: string;
  let FileStore: typeof import("../src/services/store.js").FileStore;
  let handleContinue: typeof import("../src/tools/continue.js").handleContinue;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "specia-continue-design-"));
    ({ FileStore } = await import("../src/services/store.js"));
    ({ handleContinue } = await import("../src/tools/continue.js"));
    const store = new FileStore(tmpDir);
    store.ensureDirectoryStructure();
    store.writeConfig({
      version: "0.2",
      project: { name: "t", description: "t", stack: "ts", conventions: [] },
      security: { posture: "standard" },
      memory: { backend: "local" },
    });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("after design complete, suggests specia_review as next", async () => {
    const store = new FileStore(tmpDir);
    store.transitionPhase("my-change", "proposal", "complete");
    store.transitionPhase("my-change", "spec", "complete");
    store.transitionPhase("my-change", "design", "complete");

    const result = await handleContinue(
      { change_name: "my-change" },
      tmpDir,
    );
    expect(result.status).toBe("success");
    expect(result.data).toBeDefined();
    if (result.data && "next_tool" in result.data) {
      expect(result.data.next_tool).toBe("specia_review");
    }
  });
});
