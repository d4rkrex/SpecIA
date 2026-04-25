/**
 * Security validators test suite
 * 
 * Verifies mitigations for:
 * - REQ-MIT-001: Input sanitization
 * - REQ-MIT-002: Path traversal prevention
 * - REQ-MIT-003: Safe YAML parsing
 * - REQ-MIT-008: Environment variable allowlist
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  validatePath,
  sanitizeInput,
  validateYaml,
  validateEnvVars,
  ValidationError,
} from "../src/cli/security/validators.js";
import path from "path";
import fs from "fs";
import os from "os";
import { z } from "zod";

describe("sanitizeInput", () => {
  it("accepts valid change names", () => {
    expect(sanitizeInput("my-change", "change_name")).toBe("my-change");
    expect(sanitizeInput("feature-123", "change_name")).toBe("feature-123");
    expect(sanitizeInput("bugfix", "change_name")).toBe("bugfix");
  });

  it("rejects SQL injection patterns", () => {
    expect(() => sanitizeInput("x; DROP TABLE--", "change_name")).toThrow(ValidationError);
    expect(() => sanitizeInput("' OR '1'='1", "change_name")).toThrow(ValidationError);
    expect(() => sanitizeInput("UNION SELECT * FROM users", "change_name")).toThrow(ValidationError);
  });

  it("rejects shell metacharacters", () => {
    expect(() => sanitizeInput("$(whoami)", "config_name")).toThrow(ValidationError);
    expect(() => sanitizeInput("`ls -la`", "config_name")).toThrow(ValidationError);
    expect(() => sanitizeInput("test; rm -rf /", "config_name")).toThrow(ValidationError);
    expect(() => sanitizeInput("test | cat /etc/passwd", "config_name")).toThrow(ValidationError);
  });

  it("rejects path traversal sequences", () => {
    expect(() => sanitizeInput("../etc/passwd", "filename")).toThrow(ValidationError);
    expect(() => sanitizeInput("test/../../../secret", "filename")).toThrow(ValidationError);
  });

  it("rejects control characters", () => {
    expect(() => sanitizeInput("test\x00null", "input")).toThrow(ValidationError);
    expect(() => sanitizeInput("test\x1besc", "input")).toThrow(ValidationError);
  });

  it("enforces max length", () => {
    const longString = "a".repeat(256);
    expect(() => sanitizeInput(longString, "input")).toThrow(ValidationError);
  });

  it("rejects empty strings", () => {
    expect(() => sanitizeInput("", "input")).toThrow(ValidationError);
  });
});

describe("validatePath", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "specia-test-"));
  const allowedBase = tmpDir;

  afterEach(() => {
    // Cleanup
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("allows paths within allowed base", () => {
    const validPath = path.join(tmpDir, "subdir", "file.txt");
    const result = validatePath(validPath, allowedBase);
    expect(result).toBe(path.resolve(validPath));
  });

  it("prevents path traversal outside base", () => {
    expect(() => validatePath("../../etc/passwd", allowedBase)).toThrow(ValidationError);
    expect(() => validatePath(path.join(tmpDir, "..", "..", "etc", "passwd"), allowedBase)).toThrow(ValidationError);
  });

  it("blocks suspicious patterns", () => {
    expect(() => validatePath("~/secret", allowedBase)).toThrow(ValidationError);
    expect(() => validatePath("${HOME}/secret", allowedBase)).toThrow(ValidationError);
    expect(() => validatePath("$(pwd)/secret", allowedBase)).toThrow(ValidationError);
    expect(() => validatePath("test|evil", allowedBase)).toThrow(ValidationError);
  });

  it("rejects empty paths", () => {
    expect(() => validatePath("", allowedBase)).toThrow(ValidationError);
  });
});

describe("validateYaml", () => {
  it("parses valid YAML", () => {
    const yaml = "key: value\nlist:\n  - item1\n  - item2";
    const result = validateYaml(yaml);
    expect(result).toEqual({ key: "value", list: ["item1", "item2"] });
  });

  it("rejects code execution tags", () => {
    const yamlWithCode = "!!js/function 'return 1'";
    expect(() => validateYaml(yamlWithCode)).toThrow(ValidationError);
  });

  it("rejects python code tags", () => {
    const yamlWithPython = "!!python/object/apply:os.system ['ls']";
    expect(() => validateYaml(yamlWithPython)).toThrow(ValidationError);
  });

  it("validates against Zod schema", () => {
    const schema = z.object({
      name: z.string(),
      count: z.number(),
    });

    const validYaml = "name: test\ncount: 42";
    const result = validateYaml(validYaml, schema);
    expect(result).toEqual({ name: "test", count: 42 });

    const invalidYaml = "name: test\ncount: not-a-number";
    expect(() => validateYaml(invalidYaml, schema)).toThrow(ValidationError);
  });

  it("enforces size limits", () => {
    const largeYaml = "key: " + "x".repeat(2 * 1024 * 1024); // 2MB
    expect(() => validateYaml(largeYaml, undefined, 1024 * 1024)).toThrow(ValidationError);
  });

  it("rejects empty YAML", () => {
    expect(() => validateYaml("")).toThrow(ValidationError);
  });
});

describe("validateEnvVars", () => {
  it("filters to allowlist", () => {
    const env = {
      HOME: "/home/user",
      ANTHROPIC_API_KEY: "secret",
      MALICIOUS_VAR: "evil",
      PATH: "/usr/bin",
    };

    const allowlist = ["HOME", "ANTHROPIC_API_KEY", "PATH"];
    const result = validateEnvVars(env, allowlist);

    expect(result).toEqual({
      HOME: "/home/user",
      ANTHROPIC_API_KEY: "secret",
      PATH: "/usr/bin",
    });
    expect(result.MALICIOUS_VAR).toBeUndefined();
  });

  it("supports wildcard patterns", () => {
    const env = {
      SPECIA_CONFIG: "value1",
      SPECIA_DEBUG: "value2",
      OTHER_VAR: "value3",
    };

    const allowlist = ["SPECIA_*"];
    const result = validateEnvVars(env, allowlist);

    expect(result).toEqual({
      SPECIA_CONFIG: "value1",
      SPECIA_DEBUG: "value2",
    });
    expect(result.OTHER_VAR).toBeUndefined();
  });

  it("returns empty object for empty allowlist", () => {
    const env = { KEY: "value" };
    const result = validateEnvVars(env, []);
    expect(result).toEqual({});
  });
});
