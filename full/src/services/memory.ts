/**
 * MemoryClient — MCP-to-MCP client for Alejandria integration.
 *
 * Spawns Alejandria as a child process (stdio transport) and communicates
 * via JSON-RPC 2.0. Provides graceful degradation — all features work
 * without Alejandria. Lazy connection: only connects when first memory
 * operation is requested. Auto-reconnect on failure.
 *
 * Spec refs: Domain 7 (Optional Dependency, Project Context Persistence,
 *            Security Context Accumulation, Spec Search)
 * Design refs: Decision 4 (MCP-to-MCP Client, MemoryClient API,
 *              Graceful Degradation, What Gets Stored Where)
 */

import { spawn, type ChildProcess } from "node:child_process";
import type { StoreOpts, RecallOpts, Memory, MemoryConfig } from "../types/index.js";

// ── JSON-RPC 2.0 Types ──────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

// ── Pending request tracking ─────────────────────────────────────────

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

// ── Constants ────────────────────────────────────────────────────────

const DEFAULT_CMD = "alejandria serve";
const REQUEST_TIMEOUT_MS = 10_000;
const CONNECT_TIMEOUT_MS = 5_000;

// ── MemoryClient ─────────────────────────────────────────────────────

export class MemoryClient {
  private process: ChildProcess | null = null;
  private connected = false;
  private connecting = false;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private buffer = "";
  private readonly cmd: string;
  private readonly args: string[];

  constructor(private readonly config: MemoryConfig) {
    // Parse command — supports "alejandria-mcp" or "npx alejandria-mcp --flag"
    const parts = (config.alejandria_cmd ?? DEFAULT_CMD).split(/\s+/);
    this.cmd = parts[0] ?? DEFAULT_CMD;
    this.args = parts.slice(1);
  }

  // ── Connection Management ──────────────────────────────────────────

  /**
   * Lazily connect to Alejandria. Spawns the child process and performs
   * the MCP initialize handshake. Returns true if connected, false otherwise.
   *
   * Safe to call multiple times — no-op if already connected.
   */
  async connect(): Promise<boolean> {
    if (this.connected) return true;
    if (this.connecting) return false;
    if (this.config.backend !== "alejandria") return false;

    this.connecting = true;

    try {
      // Spawn Alejandria as a child process
      this.process = spawn(this.cmd, this.args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env },
      });

      // Wire up stdout for JSON-RPC responses
      this.process.stdout?.setEncoding("utf-8");
      this.process.stdout?.on("data", (data: string) => this.handleData(data));

      // Handle process errors
      this.process.on("error", () => {
        this.handleDisconnect();
      });

      this.process.on("exit", () => {
        this.handleDisconnect();
      });

      // Suppress stderr (Alejandria's debug output)
      this.process.stderr?.resume();

      // MCP initialize handshake
      const initResult = await this.sendRequest("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "specia", version: "0.1.0" },
      });

      if (!initResult) {
        this.handleDisconnect();
        return false;
      }

      // Send initialized notification
      this.sendNotification("notifications/initialized", {});

      this.connected = true;
      this.connecting = false;
      return true;
    } catch {
      this.handleDisconnect();
      return false;
    }
  }

  /**
   * Disconnect from Alejandria. Kills the child process.
   */
  async disconnect(): Promise<void> {
    this.handleDisconnect();
  }

  /**
   * Check if currently connected to Alejandria.
   */
  isConnected(): boolean {
    return this.connected;
  }

  // ── Episodic Memory Operations ─────────────────────────────────────

  /**
   * Store an observation in Alejandria.
   * Returns the memory ID, or null if Alejandria is unavailable.
   *
   * Design refs: Decision 4 (store method)
   */
  async store(content: string, opts: StoreOpts): Promise<string | null> {
    const connected = await this.ensureConnected();
    if (!connected) return null;

    try {
      const result = await this.callTool("mem_store", {
        content,
        summary: opts.summary,
        importance: opts.importance ?? "medium",
        topic: opts.topic,
        topic_key: opts.topic_key,
      });

      // Extract ID from result (ULID format from Alejandría)
      if (result && typeof result === "object") {
        const textContent = extractTextContent(result);
        // Match ULID format: "id": "01KNDXH20AYK0PSYS7FQJGYM1J"
        const idMatch = textContent.match(/"id":\s*"([A-Z0-9]{26})"/i);
        if (idMatch?.[1]) return idMatch[1];
        // Fallback: match old format with numeric IDs
        const numMatch = textContent.match(/id[:\s]+(\d+)/i);
        if (numMatch?.[1]) return numMatch[1];
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Search/recall memories from Alejandria via FTS5.
   * Returns matching memories, or empty array if unavailable.
   *
   * Design refs: Decision 4 (recall method)
   */
  async recall(query: string, opts?: RecallOpts): Promise<Memory[]> {
    const connected = await this.ensureConnected();
    if (!connected) return [];

    try {
      const result = await this.callTool("mem_recall", {
        query,
        limit: opts?.limit ?? 10,
        topic: opts?.scope,
      });

      if (result && typeof result === "object") {
        return parseMemoryResults(result);
      }
      return [];
    } catch {
      return [];
    }
  }

  /**
   * Update an existing observation by ID.
   * Returns true on success, false on failure.
   */
  async update(id: string, content: string): Promise<boolean> {
    const connected = await this.ensureConnected();
    if (!connected) return false;

    try {
      await this.callTool("mem_update", {
        id,  // Keep as string (ULID format)
        content,
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Search memories with a specific topic key.
   * Convenience method for topic_key-based recall.
   */
  async recallByTopicKey(topicKey: string): Promise<Memory[]> {
    return this.recall(topicKey, { limit: 1 });
  }

  // ── Internal Communication ─────────────────────────────────────────

  /**
   * Call an Alejandria MCP tool via tools/call.
   */
  private async callTool(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    return this.sendRequest("tools/call", {
      name: toolName,
      arguments: args,
    });
  }

  /**
   * Send a JSON-RPC 2.0 request and wait for response.
   */
  private sendRequest(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin?.writable) {
        reject(new Error("Alejandria process not available"));
        return;
      }

      const id = this.nextId++;
      const request: JsonRpcRequest = {
        jsonrpc: "2.0",
        id,
        method,
        params,
      };

      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request ${method} timed out after ${REQUEST_TIMEOUT_MS}ms`));
      }, method === "initialize" ? CONNECT_TIMEOUT_MS : REQUEST_TIMEOUT_MS);

      this.pending.set(id, { resolve, reject, timer });

      try {
        this.process.stdin.write(JSON.stringify(request) + "\n");
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /**
   * Send a JSON-RPC 2.0 notification (no response expected).
   */
  private sendNotification(
    method: string,
    params?: Record<string, unknown>,
  ): void {
    if (!this.process?.stdin?.writable) return;

    const notification = {
      jsonrpc: "2.0",
      method,
      params,
    };

    try {
      this.process.stdin.write(JSON.stringify(notification) + "\n");
    } catch {
      // Ignore write errors on notifications
    }
  }

  /**
   * Handle incoming data from Alejandria's stdout.
   * Buffers partial lines and processes complete JSON-RPC responses.
   */
  private handleData(data: string): void {
    this.buffer += data;

    // Process complete lines (JSON-RPC messages are newline-delimited)
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? ""; // Keep incomplete last line

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const response = JSON.parse(trimmed) as JsonRpcResponse;
        if (response.id !== undefined) {
          const pending = this.pending.get(response.id);
          if (pending) {
            clearTimeout(pending.timer);
            this.pending.delete(response.id);

            if (response.error) {
              pending.reject(
                new Error(`JSON-RPC error ${response.error.code}: ${response.error.message}`),
              );
            } else {
              pending.resolve(response.result);
            }
          }
        }
        // Ignore notifications (no id) — Alejandria may send progress
      } catch {
        // Ignore malformed JSON lines (Alejandria may log to stdout)
      }
    }
  }

  /**
   * Clean up on disconnect — kill child process, reject pending requests.
   */
  private handleDisconnect(): void {
    this.connected = false;
    this.connecting = false;

    // Reject all pending requests
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Alejandria disconnected"));
      this.pending.delete(id);
    }

    // Kill child process
    if (this.process) {
      try {
        this.process.kill("SIGTERM");
      } catch {
        // Ignore if already dead
      }
      this.process = null;
    }
  }

  /**
   * Ensure connection is established (lazy connect + auto-reconnect).
   */
  private async ensureConnected(): Promise<boolean> {
    if (this.connected) return true;
    return this.connect();
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Extract text content from an MCP tool result.
 */
function extractTextContent(result: unknown): string {
  if (!result || typeof result !== "object") return "";

  const obj = result as Record<string, unknown>;

  // MCP tools/call result format: { content: [{ type: "text", text: "..." }] }
  if (Array.isArray(obj.content)) {
    return obj.content
      .filter(
        (c): c is { type: string; text: string } =>
          c && typeof c === "object" && "text" in c,
      )
      .map((c) => c.text)
      .join("\n");
  }

  // Direct text
  if (typeof obj.text === "string") return obj.text;

  return JSON.stringify(result);
}

/**
 * Parse memory results from Alejandria's recall tool response.
 */
function parseMemoryResults(result: unknown): Memory[] {
  const text = extractTextContent(result);
  if (!text) return [];

  // Alejandría returns "Found N memories:\n[...]" or "No memories found"
  if (text.includes("No memories found")) {
    return [];
  }

  // Extract JSON array from "Found N memories:\n[...]"
  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0]);
      if (Array.isArray(parsed)) {
        return parsed.map(parseMemoryEntry).filter(Boolean) as Memory[];
      }
    } catch {
      // Not valid JSON
    }
  }

  // Fallback: try parsing the whole text as JSON
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed.map(parseMemoryEntry).filter(Boolean) as Memory[];
    }
    // Single object
    if (parsed && typeof parsed === "object") {
      const entry = parseMemoryEntry(parsed);
      return entry ? [entry] : [];
    }
  } catch {
    // Not JSON — try parsing structured text format
  }

  // Legacy format: "[1] #123 (type) — title\n    content\n    timestamp | project"
  const entries: Memory[] = [];
  const blocks = text.split(/\n\[?\d+\]?\s*#/).filter(Boolean);

  for (const block of blocks) {
    const idMatch = block.match(/^(\d+)/);
    const contentLines = block.split("\n").slice(1).map((l) => l.trim()).filter(Boolean);

    if (idMatch?.[1]) {
      entries.push({
        id: idMatch[1],
        content: contentLines.join("\n"),
        created_at: new Date().toISOString(),
      });
    }
  }

  return entries;
}

/**
 * Parse a single memory entry from a JSON object.
 */
function parseMemoryEntry(obj: unknown): Memory | null {
  if (!obj || typeof obj !== "object") return null;

  const entry = obj as Record<string, unknown>;

  if (!entry.id && !entry.content) return null;

  return {
    id: String(entry.id ?? ""),
    content: String(entry.content ?? ""),
    summary: entry.summary ? String(entry.summary) : undefined,
    topic: entry.topic ? String(entry.topic) : undefined,
    topic_key: entry.topic_key ? String(entry.topic_key) : undefined,
    created_at: String(entry.created_at ?? new Date().toISOString()),
    score: typeof entry.score === "number" ? entry.score : undefined,
  };
}

// ── Singleton Factory ────────────────────────────────────────────────

let _singleton: MemoryClient | null = null;

/**
 * Get or create the global MemoryClient singleton.
 *
 * Uses the config from .specia/config.yaml to determine whether
 * Alejandria is enabled and how to connect.
 *
 * If config has changed (different backend or command), the existing
 * singleton is replaced with a new one matching the new config.
 */
export function getMemoryClient(config: MemoryConfig): MemoryClient {
  if (_singleton) {
    // Check if config has changed — if so, replace the singleton
    const currentCmd = config.alejandria_cmd ?? "";
    const singletonCmd = _singleton["config"].alejandria_cmd ?? "";
    if (
      _singleton["config"].backend !== config.backend ||
      currentCmd !== singletonCmd
    ) {
      _singleton.disconnect().catch(() => {});
      _singleton = new MemoryClient(config);
    }
    return _singleton;
  }
  _singleton = new MemoryClient(config);
  return _singleton;
}

/**
 * Reset the singleton (for testing).
 */
export function resetMemoryClient(): void {
  if (_singleton) {
    _singleton.disconnect().catch(() => {});
    _singleton = null;
  }
}
