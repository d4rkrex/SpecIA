/**
 * MemoryClient unit tests.
 *
 * Tests the MCP-to-MCP client for Alejandria integration.
 * Uses vi.mock for the child process module — does NOT require Alejandria binary.
 *
 * Spec refs: Domain 7 (Optional Dependency, all scenarios)
 * Design refs: Decision 4 (MemoryClient, Graceful Degradation)
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
import { MemoryClient, getMemoryClient, resetMemoryClient } from "../../src/services/memory.js";
import type { MemoryConfig } from "../../src/types/index.js";
import { EventEmitter } from "node:events";
import { Writable, Readable } from "node:stream";

// ── Module-level mock for child_process ──────────────────────────────

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

// Import the mocked module AFTER vi.mock
import { spawn } from "node:child_process";

const mockedSpawn = spawn as Mock;

// ── Mock Setup ───────────────────────────────────────────────────────

/** Create a mock child process with controllable stdin/stdout/stderr. */
function createMockProcess() {
  const stdin = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  const stdout = new Readable({ read() {} });
  const stderr = new Readable({ read() {} });

  stdout.setEncoding("utf-8");

  const proc = Object.assign(new EventEmitter(), {
    stdin,
    stdout,
    stderr,
    pid: 12345,
    kill: vi.fn(),
    killed: false,
  });

  return proc;
}

/**
 * Simulate Alejandria responding to JSON-RPC requests.
 * Intercepts stdin writes and sends responses on stdout.
 */
function autoRespond(
  mockProc: ReturnType<typeof createMockProcess>,
  handler: (request: { method: string; params?: Record<string, unknown>; id: number }) => unknown,
) {
  const originalWrite = mockProc.stdin.write.bind(mockProc.stdin);

  mockProc.stdin.write = (
    chunk: unknown,
    encodingOrCallback?: BufferEncoding | ((err?: Error | null) => void),
    callback?: (err?: Error | null) => void,
  ) => {
    const data = typeof chunk === "string" ? chunk : String(chunk);
    const cb = typeof encodingOrCallback === "function" ? encodingOrCallback : callback;

    try {
      const request = JSON.parse(data.trim());
      // Only respond to requests (with id), not notifications
      if (request.id !== undefined) {
        try {
          const result = handler(request);
          const response = JSON.stringify({
            jsonrpc: "2.0",
            id: request.id,
            result,
          });
          // Push response to stdout asynchronously
          setImmediate(() => {
            mockProc.stdout.push(response + "\n");
          });
        } catch (handlerError) {
          // Handler threw — send JSON-RPC error response so request doesn't time out
          const errorResponse = JSON.stringify({
            jsonrpc: "2.0",
            id: request.id,
            error: {
              code: -32000,
              message: handlerError instanceof Error ? handlerError.message : String(handlerError),
            },
          });
          setImmediate(() => {
            mockProc.stdout.push(errorResponse + "\n");
          });
        }
      }
    } catch {
      // Not valid JSON — ignore
    }

    if (cb) {
      cb();
      return true;
    }
    return originalWrite(chunk, encodingOrCallback as BufferEncoding, callback as (err?: Error | null) => void);
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe("MemoryClient", () => {
  let mockProc: ReturnType<typeof createMockProcess>;

  beforeEach(() => {
    resetMemoryClient();
    mockProc = createMockProcess();
    mockedSpawn.mockReturnValue(mockProc);
  });

  afterEach(() => {
    resetMemoryClient();
    mockedSpawn.mockReset();
  });

  // ── Construction & Configuration ───────────────────────────────────

  describe("construction", () => {
    it("creates a client with local backend that never connects", async () => {
      const client = new MemoryClient({ backend: "local" });
      const result = await client.connect();
      expect(result).toBe(false);
      expect(client.isConnected()).toBe(false);
      expect(mockedSpawn).not.toHaveBeenCalled();
    });

    it("creates a client with alejandria backend", () => {
      const client = new MemoryClient({ backend: "alejandria" });
      expect(client.isConnected()).toBe(false);
    });

    it("parses custom alejandria_cmd with arguments", () => {
      const config: MemoryConfig = {
        backend: "alejandria",
        alejandria_cmd: "/usr/bin/alejandria-mcp --verbose",
      };
      const client = new MemoryClient(config);
      expect(client).toBeTruthy();
    });
  });

  // ── Connection ─────────────────────────────────────────────────────

  describe("connect", () => {
    it("spawns Alejandria and performs MCP initialize handshake", async () => {
      autoRespond(mockProc, (req) => {
        if (req.method === "initialize") {
          return {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "alejandria", version: "0.1.0" },
          };
        }
        return {};
      });

      const client = new MemoryClient({ backend: "alejandria" });
      const result = await client.connect();

      expect(result).toBe(true);
      expect(client.isConnected()).toBe(true);
      expect(mockedSpawn).toHaveBeenCalledWith(
        "alejandria",
        ["serve"],
        expect.objectContaining({ stdio: ["pipe", "pipe", "pipe"] }),
      );
    });

    it("returns true when already connected (no-op)", async () => {
      autoRespond(mockProc, () => ({
        protocolVersion: "2024-11-05",
        capabilities: {},
        serverInfo: { name: "alejandria", version: "0.1.0" },
      }));

      const client = new MemoryClient({ backend: "alejandria" });
      await client.connect();
      const result = await client.connect();
      expect(result).toBe(true);
      expect(mockedSpawn).toHaveBeenCalledTimes(1); // Only spawned once
    });

    it("returns false when spawn fails", async () => {
      mockedSpawn.mockImplementation(() => {
        const proc = createMockProcess();
        setImmediate(() => proc.emit("error", new Error("ENOENT")));
        return proc;
      });

      const client = new MemoryClient({ backend: "alejandria" });
      const result = await client.connect();
      expect(result).toBe(false);
      expect(client.isConnected()).toBe(false);
    });

    it("returns false for local backend", async () => {
      const client = new MemoryClient({ backend: "local" });
      const result = await client.connect();
      expect(result).toBe(false);
    });
  });

  // ── Disconnect ─────────────────────────────────────────────────────

  describe("disconnect", () => {
    it("kills the child process and clears state", async () => {
      autoRespond(mockProc, () => ({
        protocolVersion: "2024-11-05",
        capabilities: {},
        serverInfo: { name: "alejandria", version: "0.1.0" },
      }));

      const client = new MemoryClient({ backend: "alejandria" });
      await client.connect();
      expect(client.isConnected()).toBe(true);

      await client.disconnect();
      expect(client.isConnected()).toBe(false);
      expect(mockProc.kill).toHaveBeenCalledWith("SIGTERM");
    });

    it("is safe to call when not connected", async () => {
      const client = new MemoryClient({ backend: "alejandria" });
      await client.disconnect(); // should not throw
      expect(client.isConnected()).toBe(false);
    });
  });

  // ── Store ──────────────────────────────────────────────────────────

  describe("store", () => {
    it("stores an observation and returns the ID", async () => {
      autoRespond(mockProc, (req) => {
        if (req.method === "initialize") {
          return { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "alejandria", version: "0.1.0" } };
        }
        if (req.method === "tools/call" && req.params?.name === "mem_store") {
          return { content: [{ type: "text", text: "Saved observation with id: 42" }] };
        }
        return {};
      });

      const client = new MemoryClient({ backend: "alejandria" });
      await client.connect();

      const id = await client.store("Test content", {
        topic_key: "specia/test/context",
        importance: "high",
      });

      expect(id).toBe("42");
    });

    it("returns null when Alejandria is unavailable", async () => {
      const client = new MemoryClient({ backend: "local" });
      const id = await client.store("Test content", {});
      expect(id).toBeNull();
    });

    it("returns null when store fails", async () => {
      autoRespond(mockProc, (req) => {
        if (req.method === "initialize") {
          return { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "alejandria", version: "0.1.0" } };
        }
        // Return a result that won't contain a valid ID
        return { content: [{ type: "text", text: "Error: storage failed" }] };
      });

      const client = new MemoryClient({ backend: "alejandria" });
      await client.connect();
      const id = await client.store("Test content", {});
      expect(id).toBeNull();
    });
  });

  // ── Recall ─────────────────────────────────────────────────────────

  describe("recall", () => {
    it("searches and returns matching memories", async () => {
      autoRespond(mockProc, (req) => {
        if (req.method === "initialize") {
          return { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "alejandria", version: "0.1.0" } };
        }
        if (req.method === "tools/call" && req.params?.name === "mem_recall") {
          return {
            content: [{
              type: "text",
              text: JSON.stringify([
                { id: 1, content: "Auth uses JWT tokens", topic_key: "specia/proj/security/auth", created_at: "2026-01-01T00:00:00Z", score: 0.95 },
                { id: 2, content: "XSS in forms", topic_key: "specia/proj/security/forms", created_at: "2026-01-02T00:00:00Z", score: 0.80 },
              ]),
            }],
          };
        }
        return {};
      });

      const client = new MemoryClient({ backend: "alejandria" });
      await client.connect();

      const memories = await client.recall("authentication security");
      expect(memories).toHaveLength(2);
      expect(memories[0]!.content).toBe("Auth uses JWT tokens");
      expect(memories[0]!.score).toBe(0.95);
      expect(memories[1]!.topic_key).toBe("specia/proj/security/forms");
    });

    it("returns empty array when Alejandria is unavailable", async () => {
      const client = new MemoryClient({ backend: "local" });
      const memories = await client.recall("anything");
      expect(memories).toEqual([]);
    });

    it("returns empty array on recall failure", async () => {
      autoRespond(mockProc, (req) => {
        if (req.method === "initialize") {
          return { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "alejandria", version: "0.1.0" } };
        }
        // Return empty/invalid content that won't parse into memories
        return { content: [{ type: "text", text: "" }] };
      });

      const client = new MemoryClient({ backend: "alejandria" });
      await client.connect();
      const memories = await client.recall("anything");
      expect(memories).toEqual([]);
    });
  });

  // ── Update ─────────────────────────────────────────────────────────

  describe("update", () => {
    it("updates an existing observation", async () => {
      autoRespond(mockProc, (req) => {
        if (req.method === "initialize") {
          return { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "alejandria", version: "0.1.0" } };
        }
        if (req.method === "tools/call" && req.params?.name === "mem_update") {
          return { content: [{ type: "text", text: "Updated" }] };
        }
        return {};
      });

      const client = new MemoryClient({ backend: "alejandria" });
      await client.connect();
      const result = await client.update("42", "Updated content");
      expect(result).toBe(true);
    });

    it("returns false when Alejandria is unavailable", async () => {
      const client = new MemoryClient({ backend: "local" });
      const result = await client.update("42", "content");
      expect(result).toBe(false);
    });
  });

  // ── Recall by Topic Key ────────────────────────────────────────────

  describe("recallByTopicKey", () => {
    it("recalls with limit 1", async () => {
      autoRespond(mockProc, (req) => {
        if (req.method === "initialize") {
          return { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "alejandria", version: "0.1.0" } };
        }
        if (req.method === "tools/call" && req.params?.name === "mem_recall") {
          const args = req.params?.arguments as Record<string, unknown>;
          expect(args.limit).toBe(1);
          return {
            content: [{
              type: "text",
              text: JSON.stringify([{ id: 5, content: "Context data", topic_key: "specia/proj/context", created_at: "2026-01-01T00:00:00Z" }]),
            }],
          };
        }
        return {};
      });

      const client = new MemoryClient({ backend: "alejandria" });
      await client.connect();
      const memories = await client.recallByTopicKey("specia/proj/context");
      expect(memories).toHaveLength(1);
      expect(memories[0]!.topic_key).toBe("specia/proj/context");
    });
  });

  // ── Graceful Degradation ───────────────────────────────────────────

  describe("graceful degradation", () => {
    it("all operations return safe defaults when backend is local", async () => {
      const client = new MemoryClient({ backend: "local" });

      expect(client.isConnected()).toBe(false);
      expect(await client.connect()).toBe(false);
      expect(await client.store("data", {})).toBeNull();
      expect(await client.recall("query")).toEqual([]);
      expect(await client.update("1", "data")).toBe(false);

      // Should not throw
      await client.disconnect();
    });

    it("recovers from child process crash via auto-reconnect", async () => {
      let callCount = 0;
      autoRespond(mockProc, (req) => {
        if (req.method === "initialize") {
          return { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "alejandria", version: "0.1.0" } };
        }
        return {};
      });

      const client = new MemoryClient({ backend: "alejandria" });
      await client.connect();
      expect(client.isConnected()).toBe(true);

      // Simulate process crash
      mockProc.emit("exit", 1);
      expect(client.isConnected()).toBe(false);

      // Next operation should attempt reconnect
      const newMock = createMockProcess();
      mockedSpawn.mockReturnValue(newMock);
      autoRespond(newMock, (req) => {
        if (req.method === "initialize") {
          callCount++;
          return { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "alejandria", version: "0.1.0" } };
        }
        if (req.method === "tools/call") {
          return { content: [{ type: "text", text: "[]" }] };
        }
        return {};
      });

      // This will trigger reconnect
      await client.recall("test");
      expect(callCount).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Singleton ──────────────────────────────────────────────────────

  describe("getMemoryClient / resetMemoryClient", () => {
    it("returns the same instance for the same config", () => {
      const config: MemoryConfig = { backend: "local" };
      const a = getMemoryClient(config);
      const b = getMemoryClient(config);
      expect(a).toBe(b);
    });

    it("resetMemoryClient clears the singleton", () => {
      const config: MemoryConfig = { backend: "local" };
      const a = getMemoryClient(config);
      resetMemoryClient();
      const b = getMemoryClient(config);
      expect(a).not.toBe(b);
    });
  });
});
