/**
 * Guardian Layer 4 Integration Tests — Basic smoke tests.
 *
 * Tests that Layer 4 configuration is properly read and validation runs
 * without errors when spec_validation is enabled.
 *
 * v0.4: Integration tests for guardian-spec-aware
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { FileStore } from "../../src/services/store.js";
import { GuardianService } from "../../src/services/guardian.js";
import type { GuardianConfig } from "../../src/types/index.js";

describe("Guardian Layer 4 Integration", () => {
  let testRoot: string;
  let store: FileStore;
  let guardian: GuardianService;

  beforeEach(() => {
    testRoot = fs.mkdtempSync(path.join(__dirname, "tmp-guardian-l4-"));
    store = new FileStore(testRoot);

    store.writeConfig({
      version: "1.0",
      project: {
        name: "test-project",
        description: "Test project for Layer 4",
        stack: "Node.js",
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
          require_mitigations: true,
        },
        spec_validation: {
          enabled: true,
          enable_llm: false,
          heuristic_threshold: 0.5,
        },
      },
    });

    guardian = new GuardianService(testRoot, store);
  });

  afterEach(() => {
    if (testRoot && fs.existsSync(testRoot)) {
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it("Smoke test: validates with Layer 4 enabled (no errors)", async () => {
    const changePath = path.join(testRoot, ".specia", "changes", "test-change");
    fs.mkdirSync(changePath, { recursive: true });

    fs.writeFileSync(path.join(changePath, "proposal.md"), "# Proposal\n\nScope:\n- src/test.ts");
    fs.writeFileSync(path.join(changePath, "spec.md"), "# Spec\n\n### REQ-1: Test\n**Scenarios**:\n- GIVEN x WHEN y THEN z\n");
    fs.writeFileSync(path.join(changePath, "review.md"), "# Review\n\nDone");
    fs.writeFileSync(path.join(changePath, "tasks.md"), "# Tasks\n\n- [x] Done");
    fs.writeFileSync(path.join(changePath, "state.yaml"), "change: test-change\nphase: tasks\nstatus: complete\ncreated: '2026-04-05T09:00:00Z'\nphases_completed:\n  - proposal\n  - spec\n  - review\n  - tasks\nupdated: '2026-04-05T10:00:00Z'\nspec_hash: abc\naudit_policy: required\n");

    const testFile = path.join(testRoot, "src", "test.ts");
    fs.mkdirSync(path.dirname(testFile), { recursive: true });
    fs.writeFileSync(testFile, "export const x = 1;");

    const config: GuardianConfig = {
      enabled: true,
      mode: "warn",
      exclude: [],
      validation: { require_spec: true, require_review: true, require_mitigations: true },
      spec_validation: { enabled: true, enable_llm: false, heuristic_threshold: 0.5 },
    };

    const result = await guardian.validateStagedFiles(["src/test.ts"], config);

    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.file).toBe("src/test.ts");
    expect(result.results[0]!.change).toBe("test-change");
  });

  it("Layer 4 disabled: validates without spec-aware checks", async () => {
    const changePath = path.join(testRoot, ".specia", "changes", "test-2");
    fs.mkdirSync(changePath, { recursive: true });

    fs.writeFileSync(path.join(changePath, "proposal.md"), "# Proposal\n\nScope:\n- src/test2.ts");
    fs.writeFileSync(path.join(changePath, "spec.md"), "# Spec\n\n### REQ-1: Test\n**Scenarios**:\n- GIVEN x WHEN y THEN z\n");
    fs.writeFileSync(path.join(changePath, "review.md"), "# Review\n\nDone");
    fs.writeFileSync(path.join(changePath, "tasks.md"), "# Tasks\n\n- [x] Done");
    fs.writeFileSync(path.join(changePath, "state.yaml"), "change: test-2\nphase: tasks\nstatus: complete\ncreated: '2026-04-05T09:00:00Z'\nphases_completed:\n  - proposal\n  - spec\n  - review\n  - tasks\nupdated: '2026-04-05T10:00:00Z'\nspec_hash: def\naudit_policy: required\n");

    const testFile = path.join(testRoot, "src", "test2.ts");
    fs.mkdirSync(path.dirname(testFile), { recursive: true });
    fs.writeFileSync(testFile, "export const y = 2;");

    const config: GuardianConfig = {
      enabled: true,
      mode: "warn",
      exclude: [],
      validation: { require_spec: true, require_review: true, require_mitigations: true },
      spec_validation: { enabled: false },
    };

    const result = await guardian.validateStagedFiles(["src/test2.ts"], config);

    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.status).toBe("pass");
  });
});
