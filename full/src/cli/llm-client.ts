/**
 * LLM Client abstraction for CLI review and audit.
 *
 * Provides a uniform interface for sending review/audit prompts to LLM APIs.
 * Supports Anthropic and OpenAI. Both are optional dependencies —
 * the CLI works without them (manual mode).
 *
 * Design refs: Decision 19 (Dual Mode: API + Manual)
 */

import type { ReviewPrompt, AuditPrompt } from "../types/index.js";

// ── Shared prompt shape (review + audit prompts share this structure) ──

interface LlmPrompt {
  system_instructions: string;
  analysis_request: string;
  output_schema: object;
  context: {
    change_name: string;
    stack: string;
    // ReviewPrompt uses metadata-only context (has_proposal, has_design)
    // AuditPrompt still carries full content (spec_content, etc.)
    [key: string]: unknown;
  };
}

// ── Interfaces ───────────────────────────────────────────────────────

/** Real token usage data captured from LLM API responses (Phase 2 token economics). */
export interface LLMUsage {
  input_tokens: number;
  output_tokens: number;
  /** Anthropic only: tokens used to create a new cache entry. */
  cache_creation_tokens?: number;
  /** Anthropic only: tokens read from an existing cache entry. */
  cache_read_tokens?: number;
  total_tokens: number;
}

/** Result from an LLM API call, including the parsed response and optional usage data. */
export interface LlmResult {
  /** Parsed JSON result from the LLM response. */
  result: unknown;
  /** Real token usage from the API response (undefined if not available). */
  usage?: LLMUsage;
  /** Which model was actually used (may differ from requested model). */
  model?: string;
}

export interface LlmClient {
  review(prompt: ReviewPrompt): Promise<LlmResult>;
  audit(prompt: AuditPrompt): Promise<LlmResult>;
}

export interface LlmClientConfig {
  provider: "anthropic" | "openai";
  apiKey: string;
  model?: string;
}

// ── Factory ──────────────────────────────────────────────────────────

export function createLlmClient(config: LlmClientConfig): LlmClient {
  switch (config.provider) {
    case "anthropic":
      return new AnthropicClient(config.apiKey, config.model);
    case "openai":
      return new OpenAiClient(config.apiKey, config.model);
    default: {
      const _exhaustive: never = config.provider;
      throw new Error(`Unsupported LLM provider: ${String(_exhaustive)}`);
    }
  }
}

// ── Anthropic Client ─────────────────────────────────────────────────

class AnthropicClient implements LlmClient {
  constructor(
    private readonly apiKey: string,
    private readonly model?: string,
  ) {}

  async review(prompt: ReviewPrompt): Promise<LlmResult> {
    return this.sendPrompt(prompt);
  }

  async audit(prompt: AuditPrompt): Promise<LlmResult> {
    return this.sendPrompt(prompt);
  }

  private async sendPrompt(prompt: LlmPrompt): Promise<LlmResult> {
    // Dynamic import — @anthropic-ai/sdk is an optional dependency
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mod: any;
    try {
      mod = await import("@anthropic-ai/sdk" as string);
    } catch {
      throw new Error(
        "Anthropic SDK not installed. Run: npm install @anthropic-ai/sdk",
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const client = new mod.default({ apiKey: this.apiKey });
    const modelId = this.model ?? "claude-sonnet-4-20250514";

    const userContent = buildUserMessage(prompt);

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const response = await client.messages.create({
      model: modelId,
      max_tokens: 8192,
      system: prompt.system_instructions,
      messages: [{ role: "user", content: userContent }],
    });

    // Capture real token usage from Anthropic response (Phase 2 token economics)
    // Anthropic response.usage: { input_tokens, output_tokens, cache_creation_input_tokens?, cache_read_input_tokens? }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const rawUsage = response.usage as {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    } | undefined;

    const usage: LLMUsage | undefined = rawUsage ? {
      input_tokens: rawUsage.input_tokens ?? 0,
      output_tokens: rawUsage.output_tokens ?? 0,
      cache_creation_tokens: rawUsage.cache_creation_input_tokens,
      cache_read_tokens: rawUsage.cache_read_input_tokens,
      total_tokens: (rawUsage.input_tokens ?? 0) + (rawUsage.output_tokens ?? 0),
    } : undefined;

    // Capture actual model used (may differ from requested, e.g. model aliases)
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const actualModel = (response.model as string) ?? modelId;

    // Extract text from response
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const textBlock = response.content.find(
      (block: { type: string }) => block.type === "text",
    );
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("Anthropic response did not contain text content");
    }

    // Parse JSON from the text response
    const text = (textBlock as { type: "text"; text: string }).text;
    return {
      result: extractJson(text),
      usage,
      model: actualModel,
    };
  }
}

// ── OpenAI Client ────────────────────────────────────────────────────

class OpenAiClient implements LlmClient {
  constructor(
    private readonly apiKey: string,
    private readonly model?: string,
  ) {}

  async review(prompt: ReviewPrompt): Promise<LlmResult> {
    return this.sendPrompt(prompt);
  }

  async audit(prompt: AuditPrompt): Promise<LlmResult> {
    return this.sendPrompt(prompt);
  }

  private async sendPrompt(prompt: LlmPrompt): Promise<LlmResult> {
    // Dynamic import — openai is an optional dependency
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mod: any;
    try {
      mod = await import("openai" as string);
    } catch {
      throw new Error(
        "OpenAI SDK not installed. Run: npm install openai",
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const client = new mod.default({ apiKey: this.apiKey });
    const modelId = this.model ?? "gpt-4o";

    const userContent = buildUserMessage(prompt);

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const response = await client.chat.completions.create({
      model: modelId,
      max_tokens: 8192,
      messages: [
        { role: "system", content: prompt.system_instructions },
        { role: "user", content: userContent },
      ],
      response_format: { type: "json_object" },
    });

    // Capture real token usage from OpenAI response (Phase 2 token economics)
    // OpenAI response.usage: { prompt_tokens, completion_tokens, total_tokens }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const rawUsage = response.usage as {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    } | undefined;

    const usage: LLMUsage | undefined = rawUsage ? {
      input_tokens: rawUsage.prompt_tokens ?? 0,
      output_tokens: rawUsage.completion_tokens ?? 0,
      total_tokens: rawUsage.total_tokens ?? ((rawUsage.prompt_tokens ?? 0) + (rawUsage.completion_tokens ?? 0)),
    } : undefined;

    // Capture actual model used
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const actualModel = (response.model as string) ?? modelId;

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const text = response.choices[0]?.message.content;
    if (!text) {
      throw new Error("OpenAI response did not contain content");
    }

    return {
      result: extractJson(text as string),
      usage,
      model: actualModel,
    };
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function buildUserMessage(prompt: LlmPrompt): string {
  const parts: string[] = [];
  // analysis_request already contains the full content for review prompts (token optimization)
  parts.push(prompt.analysis_request);
  parts.push("");

  const ctx = prompt.context;

  // AuditPrompt still carries full content in context; ReviewPrompt does not
  // Detect by checking if spec_content exists (AuditPrompt) vs has_proposal (ReviewPrompt)
  if (typeof ctx.spec_content === "string") {
    // AuditPrompt path — context has full content
    parts.push("## Project Context");
    if (typeof ctx.project_description === "string") {
      parts.push(`- Project: ${ctx.project_description}`);
    }
    parts.push(`- Stack: ${ctx.stack}`);
    parts.push(`- Change: ${ctx.change_name}`);
    parts.push("");
    parts.push("## Specification");
    parts.push(ctx.spec_content);

    if (typeof ctx.proposal_content === "string") {
      parts.push("");
      parts.push("## Proposal");
      parts.push(ctx.proposal_content);
    }

    if (typeof ctx.design_content === "string") {
      parts.push("");
      parts.push("## Architecture Design");
      parts.push(ctx.design_content);
    }

    if (Array.isArray(ctx.past_findings) && ctx.past_findings.length > 0) {
      parts.push("");
      parts.push("## Past Security Findings");
      for (const finding of ctx.past_findings) {
        parts.push(`- ${String(finding)}`);
      }
    }
  } else {
    // ReviewPrompt path — context is metadata-only, content is in analysis_request
    parts.push("## Context");
    parts.push(`- Stack: ${ctx.stack}`);
    parts.push(`- Change: ${ctx.change_name}`);
  }

  parts.push("");
  parts.push("## Required Output Schema");
  parts.push("```json");
  parts.push(JSON.stringify(prompt.output_schema, null, 2));
  parts.push("```");

  return parts.join("\n");
}

/**
 * Extract a JSON object from text that may contain markdown fences or prose.
 */
function extractJson(text: string): unknown {
  // Try direct parse first
  try {
    return JSON.parse(text);
  } catch {
    // Try extracting from markdown code fence
    const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (fenceMatch?.[1]) {
      return JSON.parse(fenceMatch[1]);
    }

    // Try finding the first { ... } block
    const braceStart = text.indexOf("{");
    const braceEnd = text.lastIndexOf("}");
    if (braceStart !== -1 && braceEnd > braceStart) {
      return JSON.parse(text.slice(braceStart, braceEnd + 1));
    }

    throw new Error("Could not extract JSON from LLM response");
  }
}
