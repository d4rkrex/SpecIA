/**
 * MCP server integration test.
 *
 * Starts the SpecIA server via stdio, sends initialize handshake,
 * sends tools/list, verifies 10 tools returned.
 *
 * Spec refs: Domain 1 (all scenarios)
 * Design refs: Testing Strategy (E2E: MCP protocol)
 */

import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const EXPECTED_TOOLS = [
  "specia_init",
  "specia_propose",
  "specia_spec",
  "specia_design",
  "specia_review",
  "specia_tasks",
  "specia_done",
  "specia_new",
  "specia_continue",
  "specia_ff",
  "specia_search",
  "specia_hook_install",
  "specia_hook_uninstall",
  "specia_hook_status",
  "specia_audit",
  "specia_debate",
  "specia_stats",
];

describe("MCP Server Integration", () => {
  it("starts, lists 17 tools, and shuts down", async () => {
    // Start the server as a child process via tsx
    const transport = new StdioClientTransport({
      command: "npx",
      args: ["tsx", "src/index.ts"],
    });

    const client = new Client(
      { name: "test-client", version: "1.0.0" },
      { capabilities: {} },
    );

    await client.connect(transport);

    // List tools
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(17);

    const toolNames = tools.map((t) => t.name).sort();
    expect(toolNames).toEqual([...EXPECTED_TOOLS].sort());

    // Each tool has name, description, and inputSchema
    for (const tool of tools) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toBeTruthy();
    }

    // Graceful shutdown
    await client.close();
  }, 15000);

  it("dispatches unknown tool with error", async () => {
    const transport = new StdioClientTransport({
      command: "npx",
      args: ["tsx", "src/index.ts"],
    });

    const client = new Client(
      { name: "test-client", version: "1.0.0" },
      { capabilities: {} },
    );

    await client.connect(transport);

    // Call an unknown tool
    const result = await client.callTool({
      name: "nonexistent_tool",
      arguments: {},
    });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text;
    expect(text).toBeDefined();
    const response = JSON.parse(text!);
    expect(response.status).toBe("error");
    expect(response.errors[0].code).toBe("VALIDATION_ERROR");

    await client.close();
  }, 15000);

  it("dispatches specia_init and gets a real response (not stub)", async () => {
    const transport = new StdioClientTransport({
      command: "npx",
      args: ["tsx", "src/index.ts"],
    });

    const client = new Client(
      { name: "test-client", version: "1.0.0" },
      { capabilities: {} },
    );

    await client.connect(transport);

    // Call specia_init — it will get an error because we're running from SpecIA's own dir
    // (which may or may not already be initialized), but the point is it should NOT return NOT_IMPLEMENTED
    const result = await client.callTool({
      name: "specia_init",
      arguments: {
        project_description: "Test project",
      },
    });

    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text;
    expect(text).toBeDefined();
    const response = JSON.parse(text!);

    // Should be a real response — either success or a real error (ALREADY_INITIALIZED),
    // but NOT the NOT_IMPLEMENTED stub
    expect(response.status).toMatch(/^(success|error)$/);
    if (response.status === "error") {
      expect(response.errors[0].code).not.toBe("NOT_IMPLEMENTED");
    }
    expect(response.meta.tool).toBe("specia_init");

    await client.close();
  }, 15000);

  it("dispatches specia_continue with real response (Phase 4 implemented)", async () => {
    const transport = new StdioClientTransport({
      command: "npx",
      args: ["tsx", "src/index.ts"],
    });

    const client = new Client(
      { name: "test-client", version: "1.0.0" },
      { capabilities: {} },
    );

    await client.connect(transport);

    const result = await client.callTool({
      name: "specia_continue",
      arguments: {
        change_name: "test-change",
      },
    });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text;
    const response = JSON.parse(text!);
    expect(response.status).toBe("error");
    // Now returns a real error (NOT_INITIALIZED or CHANGE_NOT_FOUND) instead of NOT_IMPLEMENTED
    expect(response.errors[0].code).not.toBe("NOT_IMPLEMENTED");
    expect(response.meta.tool).toBe("specia_continue");

    await client.close();
  }, 15000);
});
