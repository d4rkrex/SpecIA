/**
 * FileStore unit tests.
 *
 * Spec refs: Domain 5 (all scenarios)
 * Design refs: Testing Strategy (Unit: FileStore with temp directories)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { FileStore } from "../../src/services/store.js";
import type { VtspecConfig, ChangeState } from "../../src/types/index.js";

let tmpDir: string;
let store: FileStore;

function makeConfig(overrides?: Partial<VtspecConfig>): VtspecConfig {
  return {
    version: "0.1",
    project: {
      name: "test-project",
      description: "A test project",
      stack: "TypeScript/Node.js",
      conventions: ["vitest", "ESM"],
    },
    security: { posture: "standard" },
    memory: { backend: "local" },
    ...overrides,
  };
}

function makeState(
  name: string,
  overrides?: Partial<ChangeState>,
): ChangeState {
  const now = new Date().toISOString();
  return {
    change: name,
    phase: "proposal",
    status: "complete",
    created: now,
    updated: now,
    phases_completed: ["proposal"],
    history: [],
    ...overrides,
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "specia-test-"));
  store = new FileStore(tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── isInitialized ────────────────────────────────────────────────────

describe("FileStore.isInitialized", () => {
  it("returns false on empty directory", () => {
    expect(store.isInitialized()).toBe(false);
  });

  it("returns true after writing config", () => {
    store.ensureDirectoryStructure();
    store.writeConfig(makeConfig());
    expect(store.isInitialized()).toBe(true);
  });
});

// ── readConfig / writeConfig ─────────────────────────────────────────

describe("FileStore.readConfig / writeConfig", () => {
  it("round-trips config correctly", () => {
    store.ensureDirectoryStructure();
    const config = makeConfig();
    store.writeConfig(config);
    const read = store.readConfig();
    expect(read).toEqual(config);
  });

  it("preserves all fields including conventions array", () => {
    store.ensureDirectoryStructure();
    const config = makeConfig({
      project: {
        name: "complex",
        description: "Complex project",
        stack: "Rust",
        conventions: ["cargo fmt", "clippy", "no unsafe"],
      },
      security: { posture: "paranoid" },
      memory: { backend: "alejandria", alejandria_cmd: "alejandria-mcp" },
    });
    store.writeConfig(config);
    expect(store.readConfig()).toEqual(config);
  });
});

// ── readContext / writeContext ────────────────────────────────────────

describe("FileStore.readContext / writeContext", () => {
  it("returns null when context.md does not exist", () => {
    store.ensureDirectoryStructure();
    expect(store.readContext()).toBeNull();
  });

  it("round-trips context markdown", () => {
    store.ensureDirectoryStructure();
    const content = "# Project Context\n\nThis is a test project.\n";
    store.writeContext(content);
    expect(store.readContext()).toBe(content);
  });
});

// ── getChangeState / setChangeState ──────────────────────────────────

describe("FileStore.getChangeState / setChangeState", () => {
  it("returns null for non-existent change", () => {
    store.ensureDirectoryStructure();
    expect(store.getChangeState("nonexistent")).toBeNull();
  });

  it("writes and reads state correctly", () => {
    store.ensureDirectoryStructure();
    const state = makeState("my-change");
    store.setChangeState("my-change", state);
    const read = store.getChangeState("my-change");
    expect(read).not.toBeNull();
    expect(read!.change).toBe("my-change");
    expect(read!.phase).toBe("proposal");
    expect(read!.status).toBe("complete");
  });

  it("appends to history on phase transition", () => {
    store.ensureDirectoryStructure();

    // Set initial state
    const initial = makeState("transition-test");
    store.setChangeState("transition-test", initial);

    // Transition to spec phase
    const readInitial = store.getChangeState("transition-test")!;
    const updated: ChangeState = {
      ...readInitial,
      phase: "spec",
      status: "complete",
      phases_completed: [...readInitial.phases_completed, "spec"],
    };
    store.setChangeState("transition-test", updated);

    const result = store.getChangeState("transition-test")!;
    expect(result.phase).toBe("spec");
    expect(result.history.length).toBeGreaterThanOrEqual(1);
    expect(result.history.some((h) => h.phase === "proposal")).toBe(true);
  });
});

// ── readArtifact / writeArtifact ─────────────────────────────────────

describe("FileStore.readArtifact / writeArtifact", () => {
  it("returns null for missing artifact", () => {
    store.ensureDirectoryStructure();
    expect(store.readArtifact("my-change", "proposal")).toBeNull();
  });

  it("round-trips artifact content", () => {
    store.ensureDirectoryStructure();
    const content = "# Proposal\n\n## Intent\nDo the thing.\n";
    store.writeArtifact("my-change", "proposal", content);
    expect(store.readArtifact("my-change", "proposal")).toBe(content);
  });

  it("writes atomically (temp file not left behind on success)", () => {
    store.ensureDirectoryStructure();
    store.writeArtifact("my-change", "spec", "# Spec content");

    const changeDir = path.join(tmpDir, ".specia", "changes", "my-change");
    const files = fs.readdirSync(changeDir);
    const tmpFiles = files.filter((f) => f.endsWith(".tmp"));
    expect(tmpFiles).toHaveLength(0);
  });

  it("supports all artifact types", () => {
    store.ensureDirectoryStructure();
    const types = ["proposal", "spec", "review", "tasks"] as const;
    for (const t of types) {
      store.writeArtifact("my-change", t, `# ${t}`);
      expect(store.readArtifact("my-change", t)).toBe(`# ${t}`);
    }
  });
});

// ── listChanges ──────────────────────────────────────────────────────

describe("FileStore.listChanges", () => {
  it("returns empty array when no changes exist", () => {
    store.ensureDirectoryStructure();
    expect(store.listChanges()).toEqual([]);
  });

  it("lists changes correctly after creating them", () => {
    store.ensureDirectoryStructure();
    store.setChangeState("alpha", makeState("alpha"));
    store.setChangeState("beta", makeState("beta"));

    const changes = store.listChanges();
    expect(changes).toHaveLength(2);
    const names = changes.map((c) => c.name).sort();
    expect(names).toEqual(["alpha", "beta"]);
  });
});

// ── archiveChange ────────────────────────────────────────────────────

describe("FileStore.archiveChange", () => {
  it("archives spec to specs/ and removes change directory", () => {
    store.ensureDirectoryStructure();
    store.setChangeState("done-change", makeState("done-change"));
    store.writeArtifact("done-change", "spec", "# Spec for done-change");
    store.writeArtifact(
      "done-change",
      "review",
      "---\nfindings_count: 2\ncritical_count: 0\n---\n\n# Review\n",
    );

    const result = store.archiveChange("done-change");

    // v0.7: archiveChange returns the actual archived path
    expect(typeof result).toBe("string");
    expect(result).toContain(".specia/specs/done-change.md");
    expect(fs.existsSync(result)).toBe(true);

    // Archived spec exists at the returned path
    const archived = fs.readFileSync(result, "utf-8");
    expect(archived).toContain("# Spec for done-change");
    expect(archived).toContain("archived_at");

    // Change directory removed
    const changeDir = path.join(
      tmpDir,
      ".specia",
      "changes",
      "done-change",
    );
    expect(fs.existsSync(changeDir)).toBe(false);
  });

  it("returns absolute path that ends with .specia/specs/<name>.md", () => {
    store.ensureDirectoryStructure();
    store.setChangeState("path-test", makeState("path-test"));
    store.writeArtifact("path-test", "spec", "# Spec content");
    store.writeArtifact("path-test", "review", "---\nfindings_count: 0\n---\n\n# Review\n");

    const result = store.archiveChange("path-test");

    expect(path.isAbsolute(result)).toBe(true);
    expect(result).toMatch(/\.specia\/specs\/path-test\.md$/);
  });

  it("returns path with audit frontmatter when audit.md exists", () => {
    store.ensureDirectoryStructure();
    store.setChangeState("audit-path", makeState("audit-path", {
      phases_completed: ["proposal", "spec", "review", "tasks", "audit"],
    }));
    store.writeArtifact("audit-path", "spec", "# Spec for audit-path");
    store.writeArtifact("audit-path", "review", "---\nfindings_count: 0\n---\n\n# Review\n");
    store.writeArtifact("audit-path", "audit", "---\noverall_verdict: pass\ntimestamp: \"2026-01-01T00:00:00Z\"\n---\n\n# Audit\n");

    const result = store.archiveChange("audit-path");

    expect(typeof result).toBe("string");
    expect(fs.existsSync(result)).toBe(true);
    const content = fs.readFileSync(result, "utf-8");
    expect(content).toContain("audit_verdict");
  });

  it("throws when spec.md is missing", () => {
    store.ensureDirectoryStructure();
    store.setChangeState("no-spec", makeState("no-spec"));
    expect(() => store.archiveChange("no-spec")).toThrow("spec.md not found");

    // No file should be created in specs/
    const specsDir = path.join(tmpDir, ".specia", "specs");
    const files = fs.readdirSync(specsDir);
    expect(files.filter(f => f.startsWith("no-spec"))).toHaveLength(0);
  });

  it("throws on write failure and preserves change directory", () => {
    store.ensureDirectoryStructure();
    store.setChangeState("write-fail", makeState("write-fail"));
    store.writeArtifact("write-fail", "spec", "# Spec content");
    store.writeArtifact("write-fail", "review", "---\nfindings_count: 0\n---\n\n# Review\n");

    // Make specs/ directory read-only to simulate write failure
    const specsDir = path.join(tmpDir, ".specia", "specs");
    fs.chmodSync(specsDir, 0o444);

    try {
      expect(() => store.archiveChange("write-fail")).toThrow();

      // Change directory must still exist (not deleted on write failure)
      const changeDir = path.join(tmpDir, ".specia", "changes", "write-fail");
      expect(fs.existsSync(changeDir)).toBe(true);
    } finally {
      // Restore permissions for cleanup
      fs.chmodSync(specsDir, 0o755);
    }
  });
});

// ── transitionPhase ──────────────────────────────────────────────────

describe("FileStore.transitionPhase", () => {
  it("creates state and adds to phases_completed", () => {
    store.ensureDirectoryStructure();
    store.transitionPhase("new-change", "proposal", "complete");

    const state = store.getChangeState("new-change")!;
    expect(state.phase).toBe("proposal");
    expect(state.status).toBe("complete");
    expect(state.phases_completed).toContain("proposal");
  });

  it("transitions through multiple phases", () => {
    store.ensureDirectoryStructure();
    store.transitionPhase("multi", "proposal", "complete");
    store.transitionPhase("multi", "spec", "complete");
    store.transitionPhase("multi", "review", "complete");

    const state = store.getChangeState("multi")!;
    expect(state.phase).toBe("review");
    expect(state.phases_completed).toEqual(["proposal", "spec", "review"]);
    expect(state.history.length).toBeGreaterThanOrEqual(2);
  });
});

// ── ensureDirectoryStructure ─────────────────────────────────────────

describe("FileStore.ensureDirectoryStructure", () => {
  it("creates changes/ and specs/ directories", () => {
    store.ensureDirectoryStructure();
    expect(
      fs.existsSync(path.join(tmpDir, ".specia", "changes")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(tmpDir, ".specia", "specs")),
    ).toBe(true);
  });

  it("is idempotent", () => {
    store.ensureDirectoryStructure();
    store.ensureDirectoryStructure(); // should not throw
    expect(
      fs.existsSync(path.join(tmpDir, ".specia", "changes")),
    ).toBe(true);
  });
});
