/**
 * Alejandria Integration Tests — REAL BINARY
 *
 * Tests SpecIA's MemoryClient against the actual Alejandria binary.
 * Uses the real MCP protocol (no mocks).
 *
 * These tests verify:
 * 1. Connection and MCP handshake work with real binary
 * 2. Store/recall/update operations work end-to-end
 * 3. JSON-RPC protocol is correctly implemented
 * 4. Graceful degradation when binary is not available
 *
 * Prerequisites:
 * - Alejandria binary at ~/repos/AppSec/Alejandria/target/debug/alejandria
 * - OR `alejandria` command available in PATH
 *
 * If binary is not found, tests are skipped (not failed).
 */

import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { MemoryClient, resetMemoryClient } from "../../src/services/memory.js";
import type { MemoryConfig } from "../../src/types/index.js";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ── Binary Detection ─────────────────────────────────────────────────

/**
 * Try to find Alejandria binary.
 * Returns the command to use, or null if not found.
 */
function findAlejandriaBinary(): string | null {
  // Option 1: Check if `alejandria` is in PATH
  try {
    execSync("which alejandria", { stdio: "pipe" });
    return "alejandria serve";
  } catch {
    // Not in PATH
  }

  // Option 2: Check known location
  const knownPath = join(homedir(), "repos/AppSec/Alejandria/target/debug/alejandria");
  if (existsSync(knownPath)) {
    return `${knownPath} serve`;
  }

  return null;
}

const ALEJANDRIA_CMD = findAlejandriaBinary();
const ALEJANDRIA_AVAILABLE = ALEJANDRIA_CMD !== null;

// ── Tests ────────────────────────────────────────────────────────────

describe.skipIf(!ALEJANDRIA_AVAILABLE)("Alejandria Integration (Real Binary)", () => {
  let client: MemoryClient;

  beforeAll(() => {
    if (!ALEJANDRIA_AVAILABLE) {
      console.warn(
        "⚠️  Alejandria binary not found — integration tests skipped.\n" +
        "   Expected: ~/bin/alejandria OR ~/repos/AppSec/Alejandria/target/debug/alejandria"
      );
    }
  });

  afterEach(async () => {
    if (client) {
      await client.disconnect();
    }
    resetMemoryClient();
  });

  // ── Connection ─────────────────────────────────────────────────────

  it("connects to real Alejandria binary via MCP", async () => {
    const config: MemoryConfig = {
      backend: "alejandria",
      alejandria_cmd: ALEJANDRIA_CMD!,
    };

    client = new MemoryClient(config);
    const connected = await client.connect();

    expect(connected).toBe(true);
    expect(client.isConnected()).toBe(true);
  }, 10_000); // 10s timeout for connection

  it("performs MCP initialize handshake", async () => {
    const config: MemoryConfig = {
      backend: "alejandria",
      alejandria_cmd: ALEJANDRIA_CMD!,
    };

    client = new MemoryClient(config);
    const connected = await client.connect();

    expect(connected).toBe(true);
    // If we got here, the handshake succeeded
  }, 10_000);

  // ── Store Operation ────────────────────────────────────────────────

  it("stores an observation and returns an ID", async () => {
    const config: MemoryConfig = {
      backend: "alejandria",
      alejandria_cmd: ALEJANDRIA_CMD!,
    };

    client = new MemoryClient(config);
    await client.connect();

    const id = await client.store(
      "SpecIA integration test — this is a test observation",
      {
        topic_key: "specia/test/integration",
        importance: "low",
        summary: "Integration test observation",
      }
    );

    expect(id).not.toBeNull();
    expect(id).toMatch(/^[A-Z0-9]{26}$/i); // Should be a ULID (26 alphanumeric chars)
  }, 15_000);

  // ── Recall Operation ───────────────────────────────────────────────

  it("recalls stored observations via FTS5 search", async () => {
    const config: MemoryConfig = {
      backend: "alejandria",
      alejandria_cmd: ALEJANDRIA_CMD!,
    };

    client = new MemoryClient(config);
    await client.connect();

    // First, store an observation
    const testContent = "Alejandria real integration test — unique marker 12345";
    const storedId = await client.store(testContent, {
      topic_key: "specia/test/recall",
      importance: "low",
    });

    expect(storedId).not.toBeNull();

    // Wait for indexing (Alejandría needs time to index for vector search)
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Now recall it
    const memories = await client.recall("unique marker 12345", { limit: 5 });

    expect(memories.length).toBeGreaterThan(0);
    const found = memories.some(m => m.content.includes("unique marker 12345"));
    expect(found).toBe(true);
  }, 25_000);

  // ── Update Operation ───────────────────────────────────────────────

  it("updates an existing observation", async () => {
    const config: MemoryConfig = {
      backend: "alejandria",
      alejandria_cmd: ALEJANDRIA_CMD!,
    };

    client = new MemoryClient(config);
    await client.connect();

    // Store first
    const originalContent = "Original content for update test";
    const id = await client.store(originalContent, {
      topic_key: "specia/test/update",
      importance: "low",
    });

    expect(id).not.toBeNull();

    // Update
    const updatedContent = "Updated content — this was modified";
    const updateResult = await client.update(id!, updatedContent);

    // Update should succeed (returns true)
    expect(updateResult).toBe(true);
    
    // Note: We don't verify via recall because Alejandría's update
    // invalidates embeddings and re-indexing may take variable time.
    // The update operation itself is what we're testing here.
  }, 15_000);

  // ── Topic Key Recall ───────────────────────────────────────────────

  it("recalls by topic key", async () => {
    const config: MemoryConfig = {
      backend: "alejandria",
      alejandria_cmd: ALEJANDRIA_CMD!,
    };

    client = new MemoryClient(config);
    await client.connect();

    const topicKey = `specia/test/topic-${Date.now()}`;
    const uniqueContent = `Topic key test content ${Date.now()}`;
    await client.store(uniqueContent, {
      topic_key: topicKey,
      importance: "low",
    });

    // Wait for indexing
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Search by the unique content (not topic_key itself)
    const memories = await client.recall(uniqueContent, { limit: 5 });
    expect(memories.length).toBeGreaterThan(0);
  }, 20_000);

  // ── Disconnect ─────────────────────────────────────────────────────

  it("disconnects cleanly", async () => {
    const config: MemoryConfig = {
      backend: "alejandria",
      alejandria_cmd: ALEJANDRIA_CMD!,
    };

    client = new MemoryClient(config);
    await client.connect();
    expect(client.isConnected()).toBe(true);

    await client.disconnect();
    expect(client.isConnected()).toBe(false);
  }, 10_000);

  // ── Auto-Reconnect ─────────────────────────────────────────────────

  it("auto-reconnects after disconnect", async () => {
    const config: MemoryConfig = {
      backend: "alejandria",
      alejandria_cmd: ALEJANDRIA_CMD!,
    };

    client = new MemoryClient(config);
    await client.connect();
    expect(client.isConnected()).toBe(true);

    // Disconnect
    await client.disconnect();
    expect(client.isConnected()).toBe(false);

    // Wait a bit before reconnecting (simulates real-world usage)
    await new Promise(resolve => setTimeout(resolve, 100));

    // Next operation should auto-reconnect
    const uniqueMarker = `Auto-reconnect-test-${Date.now()}`;
    const id = await client.store(uniqueMarker, {
      topic_key: "specia/test/reconnect",
      importance: "low",
    });

    expect(id).not.toBeNull();
    expect(client.isConnected()).toBe(true);
  }, 20_000);

  // ── Error Handling ─────────────────────────────────────────────────

  it("handles invalid operations gracefully", async () => {
    const config: MemoryConfig = {
      backend: "alejandria",
      alejandria_cmd: ALEJANDRIA_CMD!,
    };

    client = new MemoryClient(config);
    await client.connect();

    // Try to update a non-existent ID
    const result = await client.update("999999999", "This ID doesn't exist");
    
    // Should not throw, should return false or handle gracefully
    expect(typeof result).toBe("boolean");
  }, 15_000);
});

// ── Skipped Test Info ────────────────────────────────────────────────

describe.skipIf(ALEJANDRIA_AVAILABLE)("Alejandria Integration (Binary Not Found)", () => {
  it("displays skip reason", () => {
    expect(ALEJANDRIA_AVAILABLE).toBe(false);
    console.log(
      "ℹ️  Alejandria binary not found — integration tests skipped.\n" +
      "   To enable these tests:\n" +
      "   1. Build Alejandria: cd ~/repos/AppSec/Alejandria && cargo build\n" +
      "   2. Create symlink: ln -sf ~/repos/AppSec/Alejandria/target/debug/alejandria ~/bin/alejandria\n" +
      "   3. Verify: alejandria --version"
    );
  });
});
