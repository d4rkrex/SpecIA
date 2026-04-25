/**
 * specia_propose handler unit tests.
 *
 * Spec refs: Domain 2 (specia_propose — all scenarios)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { handleInit } from "../../src/tools/init.js";
import { handlePropose } from "../../src/tools/propose.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "specia-propose-"));
  // Initialize project first
  await handleInit({ project_description: "Test project" }, tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("handlePropose", () => {
  it("creates a proposal successfully", async () => {
    const result = await handlePropose(
      {
        change_name: "auth-refactor",
        intent: "Refactor the auth module for better security",
        scope: ["auth", "middleware"],
      },
      tmpDir,
    );

    expect(result.status).toBe("success");
    expect(result.data!.proposal_path).toBe(".specia/changes/auth-refactor/proposal.md");
    expect(result.data!.change_name).toBe("auth-refactor");
    expect(result.meta.change).toBe("auth-refactor");

    // Verify file created
    const proposalPath = path.join(tmpDir, ".specia", "changes", "auth-refactor", "proposal.md");
    expect(fs.existsSync(proposalPath)).toBe(true);
    const content = fs.readFileSync(proposalPath, "utf-8");
    expect(content).toContain("# Proposal: auth-refactor");
    expect(content).toContain("Refactor the auth module");
  });

  it("creates state.yaml with proposal phase complete", async () => {
    await handlePropose(
      {
        change_name: "my-change",
        intent: "Do a thing",
        scope: ["area"],
      },
      tmpDir,
    );

    const statePath = path.join(tmpDir, ".specia", "changes", "my-change", "state.yaml");
    expect(fs.existsSync(statePath)).toBe(true);
    const stateContent = fs.readFileSync(statePath, "utf-8");
    expect(stateContent).toContain("proposal");
    expect(stateContent).toContain("complete");
  });

  it("returns CHANGE_EXISTS for duplicate change name", async () => {
    await handlePropose(
      { change_name: "dup-change", intent: "First", scope: ["a"] },
      tmpDir,
    );

    const result = await handlePropose(
      { change_name: "dup-change", intent: "Second", scope: ["b"] },
      tmpDir,
    );

    expect(result.status).toBe("error");
    expect(result.errors[0]!.code).toBe("CHANGE_EXISTS");
  });

  it("returns NOT_INITIALIZED when project not initialized", async () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "specia-empty-"));

    const result = await handlePropose(
      { change_name: "my-change", intent: "intent", scope: ["a"] },
      emptyDir,
    );

    expect(result.status).toBe("error");
    expect(result.errors[0]!.code).toBe("NOT_INITIALIZED");

    fs.rmSync(emptyDir, { recursive: true, force: true });
  });

  it("returns VALIDATION_ERROR for invalid change name format", async () => {
    const result = await handlePropose(
      { change_name: "Invalid Name!", intent: "intent", scope: ["a"] },
      tmpDir,
    );

    expect(result.status).toBe("error");
    expect(result.errors[0]!.code).toBe("VALIDATION_ERROR");
  });

  it("returns VALIDATION_ERROR for empty scope", async () => {
    const result = await handlePropose(
      { change_name: "my-change", intent: "intent", scope: [] },
      tmpDir,
    );

    expect(result.status).toBe("error");
    expect(result.errors[0]!.code).toBe("VALIDATION_ERROR");
  });

  it("includes approach in proposal when provided", async () => {
    await handlePropose(
      {
        change_name: "with-approach",
        intent: "intent",
        scope: ["area"],
        approach: "Use the strategy pattern",
      },
      tmpDir,
    );

    const content = fs.readFileSync(
      path.join(tmpDir, ".specia", "changes", "with-approach", "proposal.md"),
      "utf-8",
    );
    expect(content).toContain("## Approach");
    expect(content).toContain("Use the strategy pattern");
  });
});
