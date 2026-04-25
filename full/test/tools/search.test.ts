/**
 * specia_search handler unit tests.
 *
 * Tests searching past specs and security findings both via
 * local file fallback and (mocked) Alejandria integration.
 *
 * Spec refs: Domain 7 (Spec Search — across archived specs)
 * Design refs: Decision 4 (Alejandria, What Gets Stored Where)
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { handleInit } from "../../src/tools/init.js";
import { handleSearch } from "../../src/tools/search.js";

// Mock the memory module so we can control Alejandria behavior
vi.mock("../../src/services/memory.js", () => ({
  getMemoryClient: vi.fn(),
  resetMemoryClient: vi.fn(),
}));

import { getMemoryClient } from "../../src/services/memory.js";
const mockedGetMemoryClient = getMemoryClient as Mock;

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "specia-search-"));
  mockedGetMemoryClient.mockReset();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/**
 * Helper: initialize project and create archived spec files for local search.
 */
async function setupWithArchivedSpecs(dir: string) {
  await handleInit({ project_description: "Search test project" }, dir);

  // Create archived specs in .specia/specs/
  const specsDir = path.join(dir, ".specia", "specs");
  fs.mkdirSync(specsDir, { recursive: true });

  fs.writeFileSync(
    path.join(specsDir, "auth-refactor.md"),
    `# Specification: auth-refactor

## Requirements

### 1. JWT Authentication
Implement JWT-based authentication with refresh tokens.
Sessions should expire after 24 hours.

#### Scenarios
##### Valid Login
- **GIVEN** valid credentials
- **WHEN** user submits login form
- **THEN** JWT token is issued
`,
  );

  fs.writeFileSync(
    path.join(specsDir, "api-rate-limiting.md"),
    `# Specification: api-rate-limiting

## Requirements

### 1. Rate Limiter
Implement sliding window rate limiting for API endpoints.
Block requests exceeding 100 per minute per IP.

#### Scenarios
##### Rate Exceeded
- **GIVEN** 100 requests in the last minute
- **WHEN** another request arrives
- **THEN** return 429 Too Many Requests
`,
  );
}

/**
 * Helper: initialize project and create active changes with review files.
 */
async function setupWithActiveReviews(dir: string) {
  await handleInit({ project_description: "Review search test" }, dir);

  const reviewDir = path.join(dir, ".specia", "changes", "data-encryption");
  fs.mkdirSync(reviewDir, { recursive: true });

  fs.writeFileSync(
    path.join(reviewDir, "review.md"),
    `# Security Review: data-encryption

## STRIDE Analysis

#### S-01: SQL Injection
- **Severity**: high
- **Mitigation**: Use parameterized queries

#### T-01: Buffer Overflow
- **Severity**: medium
- **Mitigation**: Validate input lengths
`,
  );
}

// ── Validation ────────────────────────────────────────────────────────

describe("handleSearch — validation", () => {
  it("returns VALIDATION_ERROR for empty query", async () => {
    const result = await handleSearch({ query: "" }, tmpDir);
    expect(result.status).toBe("error");
    expect(result.errors[0]!.code).toBe("VALIDATION_ERROR");
  });

  it("returns NOT_INITIALIZED when project not initialized", async () => {
    const result = await handleSearch({ query: "authentication" }, tmpDir);
    expect(result.status).toBe("error");
    expect(result.errors[0]!.code).toBe("NOT_INITIALIZED");
  });

  it("returns VALIDATION_ERROR for limit out of range", async () => {
    const result = await handleSearch({ query: "test", limit: 0 }, tmpDir);
    expect(result.status).toBe("error");
    expect(result.errors[0]!.code).toBe("VALIDATION_ERROR");
  });
});

// ── Local file search ────────────────────────────────────────────────

describe("handleSearch — local file search", () => {
  it("finds matching archived specs by keyword", async () => {
    await setupWithArchivedSpecs(tmpDir);

    const result = await handleSearch({ query: "authentication JWT" }, tmpDir);

    expect(result.status).toBe("success");
    expect(result.data!.results.length).toBeGreaterThanOrEqual(1);
    expect(result.data!.results[0]!.change_name).toBe("auth-refactor");
    expect(result.data!.results[0]!.type).toBe("spec");
    expect(result.data!.results[0]!.source).toBe("local");
    expect(result.data!.results[0]!.excerpt).toContain("JWT");
  });

  it("finds specs matching partial terms", async () => {
    await setupWithArchivedSpecs(tmpDir);

    const result = await handleSearch({ query: "rate limiting" }, tmpDir);

    expect(result.status).toBe("success");
    const names = result.data!.results.map((r) => r.change_name);
    expect(names).toContain("api-rate-limiting");
  });

  it("returns empty results when no match found", async () => {
    await setupWithArchivedSpecs(tmpDir);

    const result = await handleSearch({ query: "blockchain quantum" }, tmpDir);

    expect(result.status).toBe("success");
    expect(result.data!.results).toHaveLength(0);
    expect(result.data!.total).toBe(0);
  });

  it("searches active change review files for security findings", async () => {
    await setupWithActiveReviews(tmpDir);

    const result = await handleSearch({ query: "SQL injection" }, tmpDir);

    expect(result.status).toBe("success");
    expect(result.data!.results.length).toBeGreaterThanOrEqual(1);

    const securityResult = result.data!.results.find(
      (r) => r.type === "security-finding",
    );
    expect(securityResult).toBeDefined();
    expect(securityResult!.change_name).toBe("data-encryption");
    expect(securityResult!.excerpt).toContain("SQL Injection");
  });

  it("respects the limit parameter", async () => {
    await setupWithArchivedSpecs(tmpDir);

    const result = await handleSearch(
      { query: "specification", limit: 1 },
      tmpDir,
    );

    expect(result.status).toBe("success");
    expect(result.data!.results.length).toBeLessThanOrEqual(1);
  });

  it("returns results sorted by relevance score", async () => {
    await setupWithArchivedSpecs(tmpDir);

    // "rate" appears in api-rate-limiting but not auth-refactor
    const result = await handleSearch(
      { query: "rate limiting API" },
      tmpDir,
    );

    expect(result.status).toBe("success");
    if (result.data!.results.length >= 2) {
      const scores = result.data!.results.map((r) => r.score ?? 0);
      expect(scores[0]).toBeGreaterThanOrEqual(scores[1]!);
    }
  });
});

// ── Alejandria integration ───────────────────────────────────────────

describe("handleSearch — Alejandria integration", () => {
  it("queries Alejandria when backend is alejandria and returns results", async () => {
    // Initialize with alejandria backend
    await handleInit(
      { project_description: "Alejandria project", memory_backend: "alejandria" },
      tmpDir,
    );

    // Mock the memory client
    const mockMemory = {
      recall: vi.fn().mockResolvedValue([
        {
          id: "1",
          content: "JWT auth requires token rotation every 24h",
          topic_key: "specia/search-test/spec/auth-refactor",
          created_at: "2026-01-01T00:00:00Z",
          score: 0.95,
        },
        {
          id: "2",
          content: "XSS vulnerability in user input forms",
          topic_key: "specia/search-test/security/forms-fix",
          created_at: "2026-01-02T00:00:00Z",
          score: 0.80,
        },
      ]),
    };
    mockedGetMemoryClient.mockReturnValue(mockMemory);

    const result = await handleSearch({ query: "authentication" }, tmpDir);

    expect(result.status).toBe("success");
    expect(result.data!.results).toHaveLength(2);
    expect(result.data!.results[0]!.source).toBe("alejandria");
    expect(result.data!.results[0]!.type).toBe("spec");
    expect(result.data!.results[0]!.change_name).toBe("auth-refactor");
    expect(result.data!.results[1]!.type).toBe("security-finding");
    expect(result.data!.results[1]!.change_name).toBe("forms-fix");
    expect(mockMemory.recall).toHaveBeenCalledWith("authentication", { limit: 10 });
  });

  it("falls back to local search when Alejandria returns no results", async () => {
    await handleInit(
      { project_description: "Fallback project", memory_backend: "alejandria" },
      tmpDir,
    );

    // Create an archived spec
    const specsDir = path.join(tmpDir, ".specia", "specs");
    fs.mkdirSync(specsDir, { recursive: true });
    fs.writeFileSync(
      path.join(specsDir, "fallback-test.md"),
      "# Specification: fallback-test\n\nAuthentication system with OAuth2.",
    );

    // Alejandria returns empty
    const mockMemory = {
      recall: vi.fn().mockResolvedValue([]),
    };
    mockedGetMemoryClient.mockReturnValue(mockMemory);

    const result = await handleSearch({ query: "authentication" }, tmpDir);

    expect(result.status).toBe("success");
    expect(result.data!.results.length).toBeGreaterThanOrEqual(1);
    expect(result.data!.results[0]!.source).toBe("local");
    expect(result.data!.results[0]!.change_name).toBe("fallback-test");
  });

  it("falls back to local search when Alejandria throws", async () => {
    await handleInit(
      { project_description: "Error project", memory_backend: "alejandria" },
      tmpDir,
    );

    // Create an archived spec
    const specsDir = path.join(tmpDir, ".specia", "specs");
    fs.mkdirSync(specsDir, { recursive: true });
    fs.writeFileSync(
      path.join(specsDir, "error-test.md"),
      "# Specification: error-test\n\nRate limiting for APIs.",
    );

    // Alejandria throws
    const mockMemory = {
      recall: vi.fn().mockRejectedValue(new Error("Connection refused")),
    };
    mockedGetMemoryClient.mockReturnValue(mockMemory);

    const result = await handleSearch({ query: "rate limiting" }, tmpDir);

    expect(result.status).toBe("success");
    expect(result.data!.results.length).toBeGreaterThanOrEqual(1);
    expect(result.data!.results[0]!.source).toBe("local");
  });

  it("classifies context type results correctly", async () => {
    await handleInit(
      { project_description: "Context project", memory_backend: "alejandria" },
      tmpDir,
    );

    const mockMemory = {
      recall: vi.fn().mockResolvedValue([
        {
          id: "3",
          content: "Project uses TypeScript with strict mode",
          topic_key: "specia/context-test/context",
          created_at: "2026-01-01T00:00:00Z",
          score: 0.70,
        },
      ]),
    };
    mockedGetMemoryClient.mockReturnValue(mockMemory);

    const result = await handleSearch({ query: "TypeScript" }, tmpDir);

    expect(result.status).toBe("success");
    expect(result.data!.results[0]!.type).toBe("context");
  });
});

// ── Metadata ─────────────────────────────────────────────────────────

describe("handleSearch — metadata", () => {
  it("includes query in response data", async () => {
    await handleInit({ project_description: "Meta test" }, tmpDir);
    const result = await handleSearch({ query: "test query" }, tmpDir);
    expect(result.data!.query).toBe("test query");
  });

  it("includes duration_ms in meta", async () => {
    await handleInit({ project_description: "Duration test" }, tmpDir);
    const result = await handleSearch({ query: "test" }, tmpDir);
    expect(result.meta.duration_ms).toBeGreaterThanOrEqual(0);
  });
});
