/**
 * Formatter Tests — Security-focused
 * 
 * Tests cover:
 * - Basic formatter functionality
 * - Security sanitization (T-02, AC-003)
 * - SARIF schema validation
 * - TTY detection and ANSI stripping
 * - DoS protections (DOS-02)
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  ReviewMarkdownFormatter,
  ReviewJsonFormatter,
  ReviewCompactFormatter,
  ReviewSarifFormatter,
  stripAnsi,
  shouldUseColors,
  type ReviewResult,
  type FormatterContext,
} from "../src/cli/formatters.js";

describe("Formatters", () => {
  let testData: ReviewResult;
  let context: FormatterContext;

  beforeEach(() => {
    testData = {
      status: "success",
      risk_level: "high",
      findings: [
        {
          severity: "critical",
          category: "SQL Injection",
          cwe: "CWE-89",
          description: "User input not sanitized before SQL query",
          mitigation: "Use parameterized queries",
          file: "/home/user/project/src/db.ts",
          line: 42,
        },
        {
          severity: "high",
          category: "XSS",
          description: "Reflected XSS in search parameter",
          file: "src/search.ts",
          line: 15,
        },
        {
          severity: "medium",
          category: "Missing Auth",
          description: "Endpoint lacks authentication",
        },
      ],
      abuse_cases: [
        {
          id: "AC-001",
          severity: "high",
          goal: "Steal user credentials",
          technique: "SQL injection in login form",
        },
      ],
    };

    context = { verbosity: 1 };
  });

  describe("MarkdownFormatter", () => {
    it("should format basic review results", () => {
      const formatter = new ReviewMarkdownFormatter();
      const output = formatter.format(testData, context);

      expect(output).toContain("# Security Review Results");
      expect(output).toContain("Risk Level");
      expect(output).toContain("high");
      expect(output).toContain("Findings Summary");
      expect(output).toContain("Critical: 1");
      expect(output).toContain("High: 1");
      expect(output).toContain("Medium: 1");
    });

    it("should include detailed findings with verbosity >= 1", () => {
      const formatter = new ReviewMarkdownFormatter();
      const output = formatter.format(testData, { verbosity: 1 });

      expect(output).toContain("SQL Injection");
      expect(output).toContain("XSS");
      expect(output).toContain("Missing Auth");
    });

    it("should sanitize user input to prevent template injection", () => {
      const maliciousData: ReviewResult = {
        ...testData,
        findings: [
          {
            severity: "high",
            category: "Test\x00Null\x01Byte",
            description: "Evil \\ \" escapes",
          },
        ],
      };

      const formatter = new ReviewMarkdownFormatter();
      const output = formatter.format(maliciousData, context);

      // Null bytes should be stripped
      expect(output).not.toMatch(/\x00/);
      expect(output).not.toMatch(/\x01/);
      
      // Should contain sanitized version
      expect(output).toContain("TestNullByte");
    });

    it("should strip ANSI codes when not TTY", () => {
      const formatter = new ReviewMarkdownFormatter();
      
      // Mock stdout.isTTY
      const originalIsTTY = process.stdout.isTTY;
      Object.defineProperty(process.stdout, "isTTY", { value: false, writable: true });
      
      const output = formatter.format(testData, context);
      
      // Should NOT contain ANSI escape codes
      expect(output).not.toMatch(/\x1B\[/);
      
      // Restore
      Object.defineProperty(process.stdout, "isTTY", { value: originalIsTTY, writable: true });
    });

    it("should sanitize file paths for privacy (ID-03)", () => {
      const formatter = new ReviewMarkdownFormatter();
      const output = formatter.format(testData, { verbosity: 2 });

      // Absolute path should be made relative
      expect(output).toContain("~/project/src/db.ts");
      expect(output).not.toContain("/home/user/");
    });
  });

  describe("JSONFormatter", () => {
    it("should format as valid JSON", () => {
      const formatter = new ReviewJsonFormatter();
      const output = formatter.format(testData, context);

      const parsed = JSON.parse(output);
      expect(parsed.risk_level).toBe("high");
      expect(parsed.findings).toHaveLength(3);
    });
  });

  describe("CompactFormatter", () => {
    it("should format as compact single-line", () => {
      const formatter = new ReviewCompactFormatter();
      const output = formatter.format(testData, context);

      expect(output).toMatch(/^risk=\w+/);
      expect(output).toContain("findings=1C/1H/1M");
      expect(output).toContain("abuse_cases=1");
      expect(output.split("\n")).toHaveLength(1); // Single line
    });

    it("should be under 50 tokens", () => {
      const formatter = new ReviewCompactFormatter();
      const output = formatter.format(testData, context);

      // Rough token estimate: ~1 token per 4 chars
      const tokenEstimate = output.length / 4;
      expect(tokenEstimate).toBeLessThan(50);
    });
  });

  describe("SARIFFormatter", () => {
    it("should format as valid SARIF 2.1.0", () => {
      const formatter = new ReviewSarifFormatter();
      const output = formatter.format(testData, context);

      const sarif = JSON.parse(output);
      expect(sarif.version).toBe("2.1.0");
      expect(sarif.$schema).toContain("sarif-schema");
      expect(sarif.runs).toHaveLength(1);
      expect(sarif.runs[0].tool.driver.name).toBe("SpecIA Security Review");
    });

    it("should map severity levels correctly", () => {
      const formatter = new ReviewSarifFormatter();
      const output = formatter.format(testData, context);

      const sarif = JSON.parse(output);
      const results = sarif.runs[0].results;

      // Critical/High → error
      expect(results[0].level).toBe("error");
      expect(results[1].level).toBe("error");
      
      // Medium → warning
      expect(results[2].level).toBe("warning");
    });

    it("should include CWE references in helpUri", () => {
      const formatter = new ReviewSarifFormatter();
      const output = formatter.format(testData, context);

      const sarif = JSON.parse(output);
      const rules = sarif.runs[0].tool.driver.rules;
      
      const sqlRule = rules.find((r: {id: string}) => r.id === "sql-injection");
      expect(sqlRule?.helpUri).toContain("cwe.mitre.org/data/definitions/89");
    });

    it("should sanitize all user text to prevent injection (T-02)", () => {
      const maliciousData: ReviewResult = {
        ...testData,
        findings: [
          {
            severity: "high",
            category: "Evil\x00Category",
            description: "Payload with \\\" escapes and \nnewlines",
          },
        ],
      };

      const formatter = new ReviewSarifFormatter();
      const output = formatter.format(maliciousData, context);

      // Should still be valid JSON
      const sarif = JSON.parse(output);
      expect(sarif.runs[0].results).toHaveLength(1);
      
      // Null bytes should be stripped
      expect(output).not.toMatch(/\x00/);
    });

    it("should limit findings to prevent DoS (DOS-02)", () => {
      // Create MORE than MAX_FINDINGS (1000) to test truncation
      const manyFindings: ReviewResult = {
        ...testData,
        findings: Array(1500).fill(null).map((_, i) => ({
          severity: "medium",
          category: `Finding number ${i}`,
          description: `Description for finding ${i}`,
        })),
      };

      const formatter = new ReviewSarifFormatter();
      const output = formatter.format(manyFindings, context);

      const sarif = JSON.parse(output);
      
      // Should truncate to MAX_FINDINGS (1000)
      expect(sarif.runs[0].results.length).toBe(1000);
      expect(sarif.runs[0].results.length).toBeLessThan(manyFindings.findings.length);
      
      // Output should still be reasonable size (not multi-GB)
      expect(output.length).toBeLessThan(50 * 1024 * 1024); // < 50MB
    });

    it("should make file paths relative (ID-03)", () => {
      const formatter = new ReviewSarifFormatter();
      const output = formatter.format(testData, context);

      const sarif = JSON.parse(output);
      const location = sarif.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri;
      
      // Should be relative, not absolute
      expect(location).toContain("~/");
      expect(location).not.toContain("/home/user/");
    });
  });

  describe("Security: Abuse Case AC-003 (SARIF injection)", () => {
    it("should escape JSONP injection attempts", () => {
      const maliciousData: ReviewResult = {
        ...testData,
        findings: [
          {
            severity: "high",
            category: "\"><script>alert(1)</script>",
            description: "'; DROP TABLE findings; --",
          },
        ],
      };

      const formatter = new ReviewSarifFormatter();
      const output = formatter.format(maliciousData, context);

      // Should still be valid JSON (not break schema)
      const sarif = JSON.parse(output);
      expect(sarif.runs).toBeDefined();
      
      // Should strip script tags
      expect(output).not.toContain("<script>alert(1)</script>");
      
      // The sanitized version should still be present (without tags)
      const ruleId = sarif.runs[0].tool.driver.rules[0].id;
      expect(ruleId).not.toContain("<script>");
    });

    it("should handle unicode control characters", () => {
      const maliciousData: ReviewResult = {
        ...testData,
        findings: [
          {
            severity: "high",
            category: "Test\u0000\u0001\u001F",
            description: "Unicode\u200Bzero\u200Bwidth\u200Bspaces",
          },
        ],
      };

      const formatter = new ReviewSarifFormatter();
      const output = formatter.format(maliciousData, context);

      // Should be valid JSON
      const sarif = JSON.parse(output);
      expect(sarif.runs[0].results).toHaveLength(1);
      
      // Null/control chars should be stripped from category
      const rule = sarif.runs[0].tool.driver.rules[0];
      expect(rule.name).not.toMatch(/[\x00-\x08\x0B-\x0C\x0E-\x1F]/);
      
      // Zero-width spaces in description are acceptable (not control chars)
      // Just verify JSON is valid and no actual control chars (0x00-0x1F except \n \r \t)
    });

    it("should validate SARIF schema structure", () => {
      const formatter = new ReviewSarifFormatter();
      const output = formatter.format(testData, context);

      const sarif = JSON.parse(output);
      
      // Required top-level fields
      expect(sarif.version).toBe("2.1.0");
      expect(sarif.$schema).toBeDefined();
      expect(sarif.runs).toBeInstanceOf(Array);
      
      // Required run fields
      const run = sarif.runs[0];
      expect(run.tool).toBeDefined();
      expect(run.tool.driver).toBeDefined();
      expect(run.tool.driver.name).toBeDefined();
      expect(run.tool.driver.version).toBeDefined();
      expect(run.results).toBeInstanceOf(Array);
      
      // Required result fields
      const result = run.results[0];
      expect(result.ruleId).toBeDefined();
      expect(result.level).toBeDefined();
      expect(result.message).toBeDefined();
      expect(result.message.text).toBeDefined();
    });
  });

  describe("ANSI Utilities", () => {
    it("should strip ANSI color codes", () => {
      const coloredText = "\x1B[31mRed\x1B[0m \x1B[32mGreen\x1B[0m";
      const stripped = stripAnsi(coloredText);
      
      expect(stripped).toBe("Red Green");
      expect(stripped).not.toMatch(/\x1B/);
    });

    it("should detect TTY for color support", () => {
      const result = shouldUseColors();
      
      // Should return boolean
      expect(typeof result).toBe("boolean");
      
      // In test environment, typically false
      expect(result).toBe(process.stdout.isTTY === true);
    });
  });
});
