/**
 * Stack detection unit tests.
 *
 * Spec refs: Domain 10 (Auto-Detection of Stack)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { detectStack } from "../../src/services/detect.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "specia-detect-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("detectStack", () => {
  it("returns null for empty directory", () => {
    const result = detectStack(tmpDir);
    expect(result.detected).toBeNull();
    expect(result.multiple).toBe(false);
    expect(result.candidates).toEqual([]);
  });

  it("detects Node.js from package.json", () => {
    fs.writeFileSync(path.join(tmpDir, "package.json"), "{}");
    const result = detectStack(tmpDir);
    expect(result.detected).toBe("Node.js");
    expect(result.candidates).toContain("Node.js");
  });

  it("detects TypeScript/Node.js from tsconfig.json", () => {
    fs.writeFileSync(path.join(tmpDir, "tsconfig.json"), "{}");
    const result = detectStack(tmpDir);
    expect(result.detected).toBe("TypeScript/Node.js");
  });

  it("prefers TypeScript/Node.js when both package.json and tsconfig.json exist", () => {
    fs.writeFileSync(path.join(tmpDir, "package.json"), "{}");
    fs.writeFileSync(path.join(tmpDir, "tsconfig.json"), "{}");
    const result = detectStack(tmpDir);
    expect(result.detected).toBe("TypeScript/Node.js");
    expect(result.candidates).not.toContain("Node.js");
  });

  it("detects Rust from Cargo.toml", () => {
    fs.writeFileSync(path.join(tmpDir, "Cargo.toml"), "");
    const result = detectStack(tmpDir);
    expect(result.detected).toBe("Rust");
  });

  it("detects Go from go.mod", () => {
    fs.writeFileSync(path.join(tmpDir, "go.mod"), "");
    const result = detectStack(tmpDir);
    expect(result.detected).toBe("Go");
  });

  it("detects Python from pyproject.toml", () => {
    fs.writeFileSync(path.join(tmpDir, "pyproject.toml"), "");
    const result = detectStack(tmpDir);
    expect(result.detected).toBe("Python");
  });

  it("reports multiple stacks when several markers exist", () => {
    fs.writeFileSync(path.join(tmpDir, "package.json"), "{}");
    fs.writeFileSync(path.join(tmpDir, "Cargo.toml"), "");
    const result = detectStack(tmpDir);
    expect(result.multiple).toBe(true);
    expect(result.candidates.length).toBeGreaterThan(1);
  });

  it("does not duplicate Python when both pyproject.toml and requirements.txt exist", () => {
    fs.writeFileSync(path.join(tmpDir, "pyproject.toml"), "");
    fs.writeFileSync(path.join(tmpDir, "requirements.txt"), "");
    const result = detectStack(tmpDir);
    const pythonCount = result.candidates.filter((c) => c === "Python").length;
    expect(pythonCount).toBe(1);
  });
});
