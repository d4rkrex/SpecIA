/**
 * SpecIA MCP Server — Entry point.
 *
 * Registers all 17 tools (7 core + 1 search + 3 shortcuts + 1 design + 1 audit + 3 guardian + 1 debate + 1 stats) and wires stdio transport.
 * Phase 4: All tools fully implemented including shortcuts (continue, ff, new).
 * v0.2: Added specia_design tool for optional architecture design phase.
 * v0.2: Added specia_hook_install, specia_hook_uninstall, specia_hook_status for Guardian hook management.
 * v0.3: Added specia_audit tool for optional post-implementation code audit.
 * v0.4: Added specia_debate tool for structured exchange debate on security review findings.
 * v0.9: Added specia_stats tool for token usage and cost summary (Phase 4 Token Economics).
 *
 * Spec refs: Domain 1 (Server Bootstrap, Tool Registration, Stdio Transport, Graceful Shutdown)
 * Design refs: Decision 1 (Layered Module Design, Entry Point pattern)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { zodToJsonSchema } from "zod-to-json-schema";

import {
  InitInputSchema,
  ProposeInputSchema,
  SpecInputSchema,
  ReviewInputSchema,
  TasksInputSchema,
  DoneInputSchema,
  NewInputSchema,
  ContinueInputSchema,
  FfInputSchema,
  SearchInputSchema,
  DesignInputSchema,
  AuditInputSchema,
  HookInstallInputSchema,
  HookUninstallInputSchema,
  HookStatusInputSchema,
  DebateInputSchema,
  StatsInputSchema,
} from "./tools/schemas.js";
import { ErrorCodes, fail } from "./types/tools.js";
import { getToolRateLimit } from "./cli/security/limits.js";

// ── Tool implementations ─────────────────────────────────────────────
import { handleInit } from "./tools/init.js";
import { handlePropose } from "./tools/propose.js";
import { handleSpec } from "./tools/spec.js";
import { handleDesign } from "./tools/design.js";
import { handleReview } from "./tools/review.js";
import { handleTasks } from "./tools/tasks.js";
import { handleDone } from "./tools/done.js";
import { handleSearch } from "./tools/search.js";
import { handleContinue } from "./tools/continue.js";
import { handleFf } from "./tools/ff.js";
import { handleHookInstall } from "./tools/hook-install.js";
import { handleHookUninstall } from "./tools/hook-uninstall.js";
import { handleHookStatus } from "./tools/hook-status.js";
import { handleAudit } from "./tools/audit.js";
import { handleVtspecDebate } from "./tools/debate.js";
import { handleStats } from "./tools/stats.js";

// ── Tool definitions ─────────────────────────────────────────────────

const TOOL_DEFINITIONS = [
  {
    name: "specia_init",
    description:
      "Initialize SpecIA in a project. Asks 4 questions: project description, primary stack, conventions, and security posture. Creates .specia/ directory with config.yaml and context.md. By default, also installs the Guardian pre-commit hook in warn mode (set install_hook: false to skip).",
    inputSchema: zodToJsonSchema(InitInputSchema),
  },
  {
    name: "specia_propose",
    description:
      "Create a new change proposal. Creates .specia/changes/{name}/ with proposal.md and state.yaml. Post-implementation audit is mandatory by default; use skip_audit: true to opt out.",
    inputSchema: zodToJsonSchema(ProposeInputSchema),
  },
  {
    name: "specia_spec",
    description:
      "Write specifications for a change. Requires proposal to exist. Creates spec.md with requirements and scenarios.",
    inputSchema: zodToJsonSchema(SpecInputSchema),
  },
  {
    name: "specia_design",
    description:
      "Optional: create architecture design document for a change. Requires spec to exist. Two-phase: first call returns design prompt, second call with design_content saves design.md. Can be skipped — review works without it.",
    inputSchema: zodToJsonSchema(DesignInputSchema),
  },
  {
    name: "specia_review",
    description:
      "Run mandatory security review on a change's spec. Depth controlled by security posture (standard/elevated/paranoid). Two-phase: first call returns review prompt, second call with review_result saves the review.",
    inputSchema: zodToJsonSchema(ReviewInputSchema),
  },
  {
    name: "specia_tasks",
    description:
      "Generate implementation tasks from spec + review. Review must exist (hard gate). Injects security mitigations from review as tasks.",
    inputSchema: zodToJsonSchema(TasksInputSchema),
  },
  {
    name: "specia_done",
    description:
      "Archive a completed change. Copies spec to .specia/specs/ with review frontmatter, removes change directory. Enforces mandatory audit gate when audit_policy is 'required'. Use force: true for emergency override.",
    inputSchema: zodToJsonSchema(DoneInputSchema),
  },
  {
    name: "specia_new",
    description:
      "Shortcut: alias for specia_propose. Creates a new change proposal.",
    inputSchema: zodToJsonSchema(NewInputSchema),
  },
  {
    name: "specia_continue",
    description:
      "Shortcut: resume at the next incomplete phase for a change.",
    inputSchema: zodToJsonSchema(ContinueInputSchema),
  },
  {
    name: "specia_ff",
    description:
      "Shortcut: fast-forward all phases in sequence (propose → spec → review → tasks). Stops on first failure.",
    inputSchema: zodToJsonSchema(FfInputSchema),
  },
  {
    name: "specia_search",
    description:
      "Search past specs and security findings via Alejandria memory. Returns relevant excerpts from archived specs and security reviews. Falls back to local file search when Alejandria is unavailable.",
    inputSchema: zodToJsonSchema(SearchInputSchema),
  },
  {
    name: "specia_hook_install",
    description:
      "Install Guardian pre-commit hook for spec compliance enforcement. Uses marker blocks for coexistence with other hooks. Default mode is warn (allows commit with warnings).",
    inputSchema: zodToJsonSchema(HookInstallInputSchema),
  },
  {
    name: "specia_hook_uninstall",
    description:
      "Remove Guardian pre-commit hook. Preserves other hooks (husky, lint-staged, etc.).",
    inputSchema: zodToJsonSchema(HookUninstallInputSchema),
  },
  {
    name: "specia_hook_status",
    description:
      "Check Guardian pre-commit hook installation status, mode, and path.",
    inputSchema: zodToJsonSchema(HookStatusInputSchema),
  },
  {
    name: "specia_audit",
    description:
      "Optional: post-implementation code audit. Verifies code satisfies spec requirements and addresses security abuse cases. Two-phase: first call returns audit prompt with spec + abuse cases + code, second call with audit_result saves audit.md. Depth controlled by security posture.",
    inputSchema: zodToJsonSchema(AuditInputSchema),
  },
  {
    name: "specia_debate",
    description:
      "Run structured debate on security review findings. Three agents (offensive, defensive, judge) debate each finding to refine severity and mitigations. Requires completed review phase.",
    inputSchema: zodToJsonSchema(DebateInputSchema),
  },
  {
    name: "specia_stats",
    description:
      "Show token usage and cost summary for a change. If change_name is omitted, shows all changes. Returns per-phase token breakdown with totals and estimated costs (when economics is configured).",
    inputSchema: zodToJsonSchema(StatsInputSchema),
  },
];

// ── MCP response formatter ───────────────────────────────────────────

function formatResponse(response: { status: string; errors?: unknown[] }) {
  // Token optimization: compact JSON for wire format (T-02: debug mode via env var)
  const indent = process.env.SPECIA_DEBUG_JSON === "1" ? 2 : undefined;
  return {
    content: [{ type: "text" as const, text: JSON.stringify(response, null, indent) }],
    isError: response.status === "error",
  };
}

// ── Server setup ─────────────────────────────────────────────────────

const server = new Server(
  { name: "specia", version: "0.3.0" },
  { capabilities: { tools: {} } },
);

// List tools handler
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOL_DEFINITIONS,
}));

/**
 * Resolve the project root directory.
 *
 * Tools operate on the project where .specia/ lives (or should live).
 * Default: current working directory.
 */
function getProjectRoot(): string {
  return process.cwd();
}

// ── Rate Limiting Middleware ─────────────────────────────────────────

/**
 * Per-tool rate limiters (DOS-001 mitigation)
 * Separate RateLimiter instance for each tool to enforce per-tool limits
 */
import { RateLimiter } from "./cli/security/limits.js";

const toolRateLimiters = new Map<string, RateLimiter>();

/**
 * Check rate limit for a tool invocation (R1 requirement)
 * DOS-001 mitigation: Enforce BEFORE handler execution
 * EP-001 mitigation: Use canonical tool name (resolve aliases)
 * 
 * @param toolName - MCP tool name from request
 * @returns null if allowed, error response if rate limited
 */
function checkRateLimit(toolName: string): ReturnType<typeof formatResponse> | null {
  // EP-001: Resolve alias to canonical name
  const canonicalName = toolName === 'specia_new' ? 'specia_propose' : toolName;
  
  // Get or create rate limiter for this tool
  if (!toolRateLimiters.has(canonicalName)) {
    const config = getToolRateLimit(canonicalName);
    toolRateLimiters.set(canonicalName, new RateLimiter(config.maxOps, config.windowMs));
  }
  
  const limiter = toolRateLimiters.get(canonicalName)!;
  
  // Check if operation is allowed
  if (!limiter.isAllowed(canonicalName)) {
    const retryAfterMs = limiter.timeUntilAllowed(canonicalName);
    const config = getToolRateLimit(canonicalName);
    
    // R3 requirement: Structured error with retryAfterMs
    const response = fail("mcp_rate_limiter", [
      {
        code: ErrorCodes.RATE_LIMIT_EXCEEDED,
        message: `Rate limit exceeded for tool '${canonicalName}': ${config.maxOps} calls per minute`,
        retryAfterMs,
      },
    ]);
    
    return formatResponse(response);
  }
  
  return null; // Allowed to proceed
}

// Call tool handler — dispatch to real implementations
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  // DOS-001 mitigation: Check rate limit BEFORE handler execution (AC2 requirement)
  const rateLimitError = checkRateLimit(name);
  if (rateLimitError) {
    return rateLimitError;
  }
  
  const rootDir = getProjectRoot();

  switch (name) {
    case "specia_init":
      return formatResponse(await handleInit(args, rootDir));

    case "specia_propose":
      return formatResponse(await handlePropose(args, rootDir));

    case "specia_spec":
      return formatResponse(await handleSpec(args, rootDir));

    case "specia_design":
      return formatResponse(await handleDesign(args, rootDir));

    case "specia_review":
      return formatResponse(await handleReview(args, rootDir));

    case "specia_tasks":
      return formatResponse(await handleTasks(args, rootDir));

    case "specia_done":
      return formatResponse(await handleDone(args, rootDir));

    case "specia_search":
      return formatResponse(await handleSearch(args, rootDir));

    // Shortcuts
    case "specia_new":
      // specia_new is an alias for specia_propose (Spec: Domain 3)
      return formatResponse(await handlePropose(args, rootDir));

    case "specia_continue":
      return formatResponse(await handleContinue(args, rootDir));

    case "specia_ff":
      return formatResponse(await handleFf(args, rootDir));

    // Guardian hooks
    case "specia_hook_install":
      return formatResponse(await handleHookInstall(args, rootDir));

    case "specia_hook_uninstall":
      return formatResponse(await handleHookUninstall(args, rootDir));

    case "specia_hook_status":
      return formatResponse(await handleHookStatus(args, rootDir));

    // Audit
    case "specia_audit":
      return formatResponse(await handleAudit(args, rootDir));

    // Debate
    case "specia_debate":
      return formatResponse(await handleVtspecDebate(args, rootDir));

    // Stats
    case "specia_stats":
      return formatResponse(await handleStats(args, rootDir));

    default: {
      const response = fail("unknown", [
        {
          code: ErrorCodes.VALIDATION_ERROR,
          message: `Unknown tool: ${name}`,
        },
      ]);
      const indent = process.env.SPECIA_DEBUG_JSON === "1" ? 2 : undefined;
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(response, null, indent) },
        ],
        isError: true,
      };
    }
  }
});

// ── Stdio transport + graceful shutdown ──────────────────────────────

async function main() {
  const transport = new StdioServerTransport();

  // Graceful shutdown on SIGINT / SIGTERM
  const shutdown = async () => {
    try {
      await server.close();
    } catch {
      // Ignore errors during shutdown
    }
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await server.connect(transport);
}

main().catch((err) => {
  console.error("SpecIA MCP server failed to start:", err);
  process.exit(1);
});
