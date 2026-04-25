/**
 * Alejandria integration tests for init, review, and done tools.
 *
 * Tests that tools correctly interact with the MemoryClient when
 * the backend is set to "alejandria". Uses vi.mock for the memory service.
 *
 * Spec refs: Domain 7 (Context Persistence, Security Context Accumulation, Spec Search)
 * Design refs: Decision 4 (What Gets Stored Where, Graceful Degradation)
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// Mock the memory module before importing tools
vi.mock("../../src/services/memory.js", () => ({
  getMemoryClient: vi.fn(),
  resetMemoryClient: vi.fn(),
}));

import { getMemoryClient } from "../../src/services/memory.js";
import { handleInit } from "../../src/tools/init.js";
import { handleReview } from "../../src/tools/review.js";
import { handleDone } from "../../src/tools/done.js";
import { handlePropose } from "../../src/tools/propose.js";
import { handleSpec } from "../../src/tools/spec.js";
import { handleTasks } from "../../src/tools/tasks.js";

const mockedGetMemoryClient = getMemoryClient as Mock;

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "specia-alejandria-"));
  mockedGetMemoryClient.mockReset();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Create a mock MemoryClient with all methods. */
function createMockMemory(overrides: Record<string, unknown> = {}) {
  return {
    store: vi.fn().mockResolvedValue("42"),
    recall: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue(true),
    recallByTopicKey: vi.fn().mockResolvedValue([]),
    connect: vi.fn().mockResolvedValue(true),
    disconnect: vi.fn().mockResolvedValue(undefined),
    isConnected: vi.fn().mockReturnValue(true),
    ...overrides,
  };
}

// ── Init + Alejandria ────────────────────────────────────────────────

describe("handleInit — Alejandria integration", () => {
  it("stores project context in Alejandria on init with alejandria backend", async () => {
    const mockMemory = createMockMemory();
    mockedGetMemoryClient.mockReturnValue(mockMemory);

    const result = await handleInit(
      {
        project_description: "Secure API project",
        memory_backend: "alejandria",
        security_posture: "elevated",
      },
      tmpDir,
    );

    expect(result.status).toBe("success");
    expect(mockedGetMemoryClient).toHaveBeenCalled();
    expect(mockMemory.store).toHaveBeenCalledTimes(1);

    // Verify store was called with correct topic_key pattern
    const storeCall = mockMemory.store.mock.calls[0]!;
    const content = storeCall[0] as string;
    const opts = storeCall[1] as Record<string, string>;

    expect(content).toContain("Secure API project");
    expect(opts.topic_key).toMatch(/^specia\/.*\/context$/);
    expect(opts.importance).toBe("high");
  });

  it("does not call Alejandria when backend is local", async () => {
    const mockMemory = createMockMemory();
    mockedGetMemoryClient.mockReturnValue(mockMemory);

    const result = await handleInit(
      { project_description: "Local project", memory_backend: "local" },
      tmpDir,
    );

    expect(result.status).toBe("success");
    expect(mockedGetMemoryClient).not.toHaveBeenCalled();
    expect(mockMemory.store).not.toHaveBeenCalled();
  });

  it("adds warning when Alejandria store returns null (unavailable)", async () => {
    const mockMemory = createMockMemory({ store: vi.fn().mockResolvedValue(null) });
    mockedGetMemoryClient.mockReturnValue(mockMemory);

    const result = await handleInit(
      { project_description: "Unavailable test", memory_backend: "alejandria" },
      tmpDir,
    );

    expect(result.status).toBe("success");
    expect(result.warnings.some((w: string) => w.includes("alejandria_unavailable"))).toBe(true);
  });

  it("adds warning when Alejandria throws", async () => {
    const mockMemory = createMockMemory({
      store: vi.fn().mockRejectedValue(new Error("Connection refused")),
    });
    mockedGetMemoryClient.mockReturnValue(mockMemory);

    const result = await handleInit(
      { project_description: "Error test", memory_backend: "alejandria" },
      tmpDir,
    );

    expect(result.status).toBe("success");
    expect(result.warnings.some((w: string) => w.includes("alejandria_unavailable"))).toBe(true);
    // Files should still be created
    expect(fs.existsSync(path.join(tmpDir, ".specia", "config.yaml"))).toBe(true);
  });
});

// ── Review + Alejandria ──────────────────────────────────────────────

describe("handleReview — Alejandria integration", () => {
  /** Setup project + proposal + spec with alejandria backend. */
  async function setupForReview(dir: string) {
    // We need to init with local first, then manually patch the config to alejandria
    // because init with alejandria calls getMemoryClient which we mock
    await handleInit({ project_description: "Review project", memory_backend: "local" }, dir);

    // Patch config to alejandria backend
    const configPath = path.join(dir, ".specia", "config.yaml");
    const config = fs.readFileSync(configPath, "utf-8");
    fs.writeFileSync(configPath, config.replace("backend: local", "backend: alejandria"));

    await handlePropose(
      { change_name: "review-test", intent: "Test review", scope: ["api"] },
      dir,
    );
    await handleSpec(
      {
        change_name: "review-test",
        requirements: [
          {
            name: "Auth",
            description: "Authentication",
            scenarios: [{ name: "Login", given: "creds", when: "login", then: "token" }],
          },
        ],
      },
      dir,
    );
  }

  it("queries Alejandria for past security findings in Phase 1", async () => {
    await setupForReview(tmpDir);

    const mockMemory = createMockMemory({
      recall: vi.fn().mockResolvedValue([
        { id: "1", content: "JWT replay attack found in auth-v1", created_at: "2026-01-01T00:00:00Z" },
      ]),
    });
    mockedGetMemoryClient.mockReturnValue(mockMemory);

    // Phase 1: get review prompt
    const result = await handleReview({ change_name: "review-test" }, tmpDir);

    expect(result.status).toBe("success");
    expect(mockedGetMemoryClient).toHaveBeenCalled();
    expect(mockMemory.recall).toHaveBeenCalled();

    // Verify it searched for past security findings
    const recallCall = mockMemory.recall.mock.calls[0]!;
    expect(recallCall[0]).toContain("security");
  });

  it("stores security findings in Alejandria in Phase 2", async () => {
    await setupForReview(tmpDir);

    const mockMemory = createMockMemory();
    mockedGetMemoryClient.mockReturnValue(mockMemory);

    // Phase 2: submit review result
    const result = await handleReview(
      {
        change_name: "review-test",
        review_result: {
          stride: {
            spoofing: {
              applicable: true,
              threats: [{
                id: "S-01",
                title: "Token replay",
                severity: "high",
                description: "Tokens can be replayed",
                mitigation: "Use nonces",
                affected_components: ["auth"],
              }],
            },
            tampering: { applicable: false, threats: [] },
            repudiation: { applicable: false, threats: [] },
            information_disclosure: { applicable: false, threats: [] },
            denial_of_service: { applicable: false, threats: [] },
            elevation_of_privilege: { applicable: false, threats: [] },
          },
          summary: {
            risk_level: "medium",
            total_findings: 1,
            critical_findings: 0,
            mitigations_required: ["Use nonces for token replay protection"],
          },
        },
      },
      tmpDir,
    );

    expect(result.status).toBe("success");
    expect(mockMemory.store).toHaveBeenCalledTimes(1);

    // Verify store was called with security topic key
    const storeCall = mockMemory.store.mock.calls[0]!;
    const opts = storeCall[1] as Record<string, string>;
    expect(opts.topic_key).toMatch(/specia\/.*\/security\/review-test$/);
    expect(opts.topic).toBe("security-review");
  });

  it("adds warning when Alejandria query fails in Phase 1", async () => {
    await setupForReview(tmpDir);

    const mockMemory = createMockMemory({
      recall: vi.fn().mockRejectedValue(new Error("timeout")),
    });
    mockedGetMemoryClient.mockReturnValue(mockMemory);

    const result = await handleReview({ change_name: "review-test" }, tmpDir);

    expect(result.status).toBe("success");
    expect(result.warnings.some((w: string) => w.includes("alejandria_unavailable"))).toBe(true);
  });
});

// ── Done + Alejandria ────────────────────────────────────────────────

describe("handleDone — Alejandria integration", () => {
  /** Run full pipeline with alejandria backend. */
  async function setupCompletePipeline(dir: string) {
    await handleInit({ project_description: "Done project", memory_backend: "local" }, dir);

    // Patch config to alejandria backend
    const configPath = path.join(dir, ".specia", "config.yaml");
    const config = fs.readFileSync(configPath, "utf-8");
    fs.writeFileSync(configPath, config.replace("backend: local", "backend: alejandria"));

    await handlePropose(
      { change_name: "done-alejandria", intent: "Test done", scope: ["api"], skip_audit: true },
      dir,
    );
    await handleSpec(
      {
        change_name: "done-alejandria",
        requirements: [
          {
            name: "Auth",
            description: "Authentication",
            scenarios: [{ name: "Login", given: "creds", when: "login", then: "token" }],
          },
        ],
      },
      dir,
    );

    // We need a mock for review Phase 1 (reads past findings) — just return empty
    const reviewPhase1Mock = createMockMemory();
    mockedGetMemoryClient.mockReturnValue(reviewPhase1Mock);

    // Phase 1
    await handleReview({ change_name: "done-alejandria" }, dir);

    // Phase 2 — reset mock for the store call
    const reviewPhase2Mock = createMockMemory();
    mockedGetMemoryClient.mockReturnValue(reviewPhase2Mock);

    await handleReview(
      {
        change_name: "done-alejandria",
        review_result: {
          stride: {
            spoofing: { applicable: false, threats: [] },
            tampering: { applicable: false, threats: [] },
            repudiation: { applicable: false, threats: [] },
            information_disclosure: { applicable: false, threats: [] },
            denial_of_service: { applicable: false, threats: [] },
            elevation_of_privilege: { applicable: false, threats: [] },
          },
          summary: {
            risk_level: "low",
            total_findings: 0,
            critical_findings: 0,
            mitigations_required: [],
          },
        },
      },
      dir,
    );

    // Reset mock again for tasks (which may query Alejandria for past findings)
    const tasksMock = createMockMemory();
    mockedGetMemoryClient.mockReturnValue(tasksMock);

    await handleTasks({ change_name: "done-alejandria" }, dir);
  }

  it("stores archived spec in Alejandria on done", async () => {
    await setupCompletePipeline(tmpDir);

    // Reset mock for the done call
    const doneMock = createMockMemory();
    mockedGetMemoryClient.mockReturnValue(doneMock);

    const result = await handleDone({ change_name: "done-alejandria" }, tmpDir);

    expect(result.status).toBe("success");
    expect(doneMock.store).toHaveBeenCalledTimes(1);

    // Verify store was called with spec topic key
    const storeCall = doneMock.store.mock.calls[0]!;
    const content = storeCall[0] as string;
    const opts = storeCall[1] as Record<string, string>;

    expect(content).toContain("Specification");
    expect(opts.topic_key).toMatch(/specia\/.*\/spec\/done-alejandria$/);
    expect(opts.topic).toBe("archived-spec");
  });

  it("adds warning when Alejandria store fails on done", async () => {
    await setupCompletePipeline(tmpDir);

    const doneMock = createMockMemory({
      store: vi.fn().mockRejectedValue(new Error("storage full")),
    });
    mockedGetMemoryClient.mockReturnValue(doneMock);

    const result = await handleDone({ change_name: "done-alejandria" }, tmpDir);

    expect(result.status).toBe("success");
    expect(result.warnings.some((w: string) => w.includes("alejandria_unavailable"))).toBe(true);

    // Archival should still succeed
    expect(result.data!.archived_path).toBe(".specia/specs/done-alejandria.md");
  });
});
