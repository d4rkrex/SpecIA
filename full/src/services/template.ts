/**
 * Markdown template rendering with variable substitution.
 *
 * Generates proposal.md, spec.md, tasks.md, context.md
 * from structured data using simple string templates.
 * Supports Alejandria context enrichment for review prompts
 * and task generation.
 *
 * v0.2: Added renderDesignPrompt() for design template (Design Decision 10).
 *
 * Design refs: Decision 8 (template.ts — Markdown template engine)
 * Spec refs: Domain 7 (Template Engine Enhancement)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { VtspecConfig } from "../types/index.js";
import type { AbuseCase } from "../types/review.js";
import { severityEmoji } from "./review.js";

// ── context.md ───────────────────────────────────────────────────────

export function renderContext(config: VtspecConfig): string {
  const lines: string[] = [];
  lines.push(`# Project Context: ${config.project.name}`);
  lines.push("");
  lines.push(`## Description`);
  lines.push("");
  lines.push(config.project.description);
  lines.push("");
  lines.push(`## Stack`);
  lines.push("");
  lines.push(config.project.stack);
  lines.push("");
  lines.push(`## Conventions`);
  lines.push("");
  if (config.project.conventions.length > 0) {
    for (const conv of config.project.conventions) {
      lines.push(`- ${conv}`);
    }
  } else {
    lines.push("*No conventions specified.*");
  }
  lines.push("");
  lines.push(`## Security Posture`);
  lines.push("");
  lines.push(`**${config.security.posture}**`);
  lines.push("");
  switch (config.security.posture) {
    case "standard":
      lines.push("STRIDE light analysis — top risks, brief mitigations.");
      break;
    case "elevated":
      lines.push(
        "Full STRIDE + OWASP Top 10 mapping — threat scenarios with attack vectors.",
      );
      break;
    case "paranoid":
      lines.push(
        "STRIDE + OWASP + DREAD scoring — exhaustive analysis with data flow and prioritized mitigation plan.",
      );
      break;
  }
  lines.push("");
  lines.push(`## Memory Backend`);
  lines.push("");
  lines.push(config.memory.backend);
  lines.push("");
  return lines.join("\n");
}

// ── proposal.md ──────────────────────────────────────────────────────

export interface ProposalData {
  changeName: string;
  intent: string;
  scope: string[];
  approach?: string;
  createdAt: string;
}

export function renderProposal(data: ProposalData): string {
  const lines: string[] = [];
  lines.push(`# Proposal: ${data.changeName}`);
  lines.push("");
  lines.push(`**Created**: ${data.createdAt}`);
  lines.push("");
  lines.push("## Intent");
  lines.push("");
  lines.push(data.intent);
  lines.push("");
  lines.push("## Scope");
  lines.push("");
  for (const area of data.scope) {
    lines.push(`- ${area}`);
  }
  lines.push("");
  if (data.approach) {
    lines.push("## Approach");
    lines.push("");
    lines.push(data.approach);
    lines.push("");
  }
  return lines.join("\n");
}

// ── spec.md ──────────────────────────────────────────────────────────

export interface RequirementData {
  name: string;
  description: string;
  scenarios: Array<{
    name: string;
    given: string;
    when: string;
    then: string;
  }>;
}

export interface SpecData {
  changeName: string;
  requirements: RequirementData[];
  createdAt: string;
}

export function renderSpec(data: SpecData): string {
  const lines: string[] = [];
  lines.push(`# Specification: ${data.changeName}`);
  lines.push("");
  lines.push(`**Created**: ${data.createdAt}`);
  lines.push("");
  lines.push(`## Requirements`);
  lines.push("");

  for (let i = 0; i < data.requirements.length; i++) {
    const req = data.requirements[i]!;
    lines.push(`### ${i + 1}. ${req.name}`);
    lines.push("");
    lines.push(req.description);
    lines.push("");

    if (req.scenarios.length > 0) {
      lines.push("#### Scenarios");
      lines.push("");
      for (const scenario of req.scenarios) {
        lines.push(`##### ${scenario.name}`);
        lines.push("");
        lines.push(`- **GIVEN** ${scenario.given}`);
        lines.push(`- **WHEN** ${scenario.when}`);
        lines.push(`- **THEN** ${scenario.then}`);
        lines.push("");
      }
    }
  }

  return lines.join("\n");
}

// ── tasks.md ─────────────────────────────────────────────────────────

export interface TasksData {
  changeName: string;
  specContent: string;
  reviewFindings: string[];
  mitigationTasks: string[];
  pastFindings?: string[];
  /** v0.2: Architecture design content for reference section. */
  designContent?: string;
  /** Abuse cases from security review for mitigation task references. */
  abuseCases?: AbuseCase[];
  createdAt: string;
}

export function renderTasks(data: TasksData): string {
  const lines: string[] = [];
  lines.push(`# Tasks: ${data.changeName}`);
  lines.push("");
  lines.push(`**Created**: ${data.createdAt}`);
  lines.push(`**Based on**: spec.md + review.md${data.designContent ? " + design.md" : ""}`);
  lines.push("");
  lines.push(
    "This task list was generated from the specification with security mitigations injected from the mandatory review.",
  );
  lines.push("");
  // v0.2: Design decisions reference section (Decision 11)
  if (data.designContent) {
    lines.push("## Design Decisions Reference");
    lines.push("");
    lines.push("The following architecture design document provides implementation guidance. Reference these decisions when implementing tasks:");
    lines.push("");
    lines.push(data.designContent);
    lines.push("");
  }
  lines.push("## Implementation Tasks");
  lines.push("");
  lines.push(
    "*The agent should break the specification into concrete implementation tasks below.*",
  );
  lines.push("");
  lines.push("## Security Mitigations");
  lines.push("");
  if (data.abuseCases && data.abuseCases.length > 0) {
    lines.push("### Security Mitigations (from review)");
    lines.push("");
    for (const ac of data.abuseCases) {
      lines.push(`- [ ] \u{1F512} ${ac.id}: ${ac.mitigation} (${ac.title} \u{2014} ${severityEmoji(ac.severity)} ${ac.severity})`);
    }
    lines.push("");
  }
  if (data.mitigationTasks.length > 0) {
    lines.push(
      "The following mitigations were identified in the security review and MUST be addressed:",
    );
    lines.push("");
    for (const task of data.mitigationTasks) {
      lines.push(`- [ ] ${task}`);
    }
  } else if (!data.abuseCases || data.abuseCases.length === 0) {
    lines.push("No security mitigations required (review found no significant threats).");
  }
  lines.push("");
  if (data.reviewFindings.length > 0) {
    lines.push("### Review Findings Reference");
    lines.push("");
    for (const finding of data.reviewFindings) {
      lines.push(`- ${finding}`);
    }
    lines.push("");
  }
  if (data.pastFindings && data.pastFindings.length > 0) {
    lines.push("## Past Security Context (from Alejandria)");
    lines.push("");
    lines.push(
      "The following findings from past changes may be relevant to this implementation:",
    );
    lines.push("");
    for (const finding of data.pastFindings) {
      lines.push(`- ${finding}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

// ── design prompt (v0.2) ─────────────────────────────────────────────

/**
 * Render the design prompt template with proposal + spec context.
 * Used by specia_design phase 1 (no design_content) to generate guidance.
 *
 * v0.2: Design Decision 10 — Template-driven structured input.
 */
export function renderDesignPrompt(
  changeName: string,
  proposalContent: string,
  specContent: string,
): string {
  const templatePath = path.resolve(
    import.meta.dirname ?? __dirname,
    "../../templates/design.md.tmpl",
  );
  let template: string;
  try {
    template = fs.readFileSync(templatePath, "utf-8");
  } catch {
    // Fallback inline template if file not found (e.g., tests without templates dir)
    template = getDesignTemplateFallback();
  }

  const rendered = template
    .replace(/\{\{change_name\}\}/g, changeName)
    .replace(/\{\{timestamp\}\}/g, new Date().toISOString());

  const lines: string[] = [];
  lines.push("# Design Prompt");
  lines.push("");
  lines.push("Create an architecture design document for the change below.");
  lines.push("Fill in the template sections with concrete technical decisions.");
  lines.push("");
  lines.push("## Context: Proposal");
  lines.push("");
  lines.push(proposalContent);
  lines.push("");
  lines.push("## Context: Specification");
  lines.push("");
  lines.push(specContent);
  lines.push("");
  lines.push("## Design Template");
  lines.push("");
  lines.push(rendered);
  lines.push("");

  return lines.join("\n");
}

/** Inline fallback design template (matches templates/design.md.tmpl). */
function getDesignTemplateFallback(): string {
  return `# Design: {{change_name}}

**Created**: {{timestamp}}
**Based on**: proposal.md + spec.md

## Technical Approach

{Describe the overall strategy for implementing this change.}

## Architecture Decisions

### Decision: {Title}

**Choice**: {What you chose}
**Alternatives considered**: {What you rejected}
**Rationale**: {Why this choice}

## Component Design

{New or modified components, their responsibilities, and interfaces.}

## Data Flow

{How data moves through the system. ASCII diagrams when helpful.}

## API Contracts / Interfaces

{New types, interfaces, function signatures. Use code blocks.}

## File Changes

| File | Action | Description |
|------|--------|-------------|
| \`path/to/file\` | Create/Modify/Delete | What and why |

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | ... | ... |
| Integration | ... | ... |

## Open Questions

- [ ] Any unresolved decisions
`;
}
