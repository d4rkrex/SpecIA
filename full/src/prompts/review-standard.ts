/**
 * STRIDE light prompt template for "standard" security posture.
 *
 * Performs a single-pass STRIDE analysis focusing on top risks.
 * Returns minimum 3 threats if applicable, with one-line mitigations.
 *
 * Spec refs: Domain 6 (Standard depth)
 * Design refs: Decision 3 (Posture-Driven Depth table — ~500 tokens)
 */

import type { ReviewPrompt } from "../types/index.js";

export interface StandardPromptContext {
  projectDescription: string;
  stack: string;
  changeName: string;
  specContent: string;
  proposalContent?: string;
  /** v0.2: Architecture design content (when design.md exists). */
  designContent?: string;
}

export function buildStandardPrompt(ctx: StandardPromptContext): ReviewPrompt {
  return {
    system_instructions: `You are a security reviewer performing a STRIDE light analysis.
Analyze the provided specification for security threats using the STRIDE framework.
Focus on the top risks — this is a standard-depth review, not exhaustive.

STRIDE categories:
- Spoofing: Can an attacker impersonate a user or component?
- Tampering: Can data be modified without detection?
- Repudiation: Can actions be denied without proof?
- Information Disclosure: Can sensitive data leak?
- Denial of Service: Can the system be made unavailable?
- Elevation of Privilege: Can an attacker gain unauthorized access?

For each category, determine if it's applicable and list specific threats.
Each threat needs: ID (e.g., S-01), title, description, severity (low/medium/high/critical), a one-line mitigation, and affected components.

Produce a minimum of 3 threats total if the spec has any security-relevant surface.
If the spec truly has no security implications, return empty threat lists with applicable: false.

## Abuse Cases (3-5)
Generate 3-5 abuse cases for the top risks identified. Each abuse case follows the pattern:
"As an attacker, I want to [goal] by [technique] so that [impact]"

For each abuse case provide:
- id: Sequential ID (AC-001, AC-002, etc.)
- severity: critical/high/medium/low
- title: Short description
- attacker_goal: "As an attacker, I want to..." (the goal)
- technique: How the attack would work
- preconditions: Array of conditions that must be true for the attack
- impact: What happens if successful
- mitigation: How to prevent it
- stride_category: Which STRIDE category (Spoofing/Tampering/Repudiation/Information Disclosure/Denial of Service/Elevation of Privilege)
- testable: Whether this can be automated as a security test (boolean)`,

    analysis_request: `Analyze the following specification for the change "${ctx.changeName}" in a ${ctx.stack} project.

## Project Description
${ctx.projectDescription}

${ctx.proposalContent ? `## Proposal\n${ctx.proposalContent}\n` : ""}
## Specification
${ctx.specContent}
${ctx.designContent ? `\n## Architecture Design\n${ctx.designContent}\nAnalyze the architecture decisions for security implications.\n` : ""}
Return your analysis as a JSON object matching the output schema below.`,

    output_schema: {
      type: "object",
      required: ["stride", "summary", "abuse_cases"],
      properties: {
        stride: {
          type: "object",
          required: [
            "spoofing",
            "tampering",
            "repudiation",
            "information_disclosure",
            "denial_of_service",
            "elevation_of_privilege",
          ],
          properties: {
            spoofing: { $ref: "#/$defs/threat_category" },
            tampering: { $ref: "#/$defs/threat_category" },
            repudiation: { $ref: "#/$defs/threat_category" },
            information_disclosure: { $ref: "#/$defs/threat_category" },
            denial_of_service: { $ref: "#/$defs/threat_category" },
            elevation_of_privilege: { $ref: "#/$defs/threat_category" },
          },
        },
        abuse_cases: {
          type: "array",
          minItems: 3,
          maxItems: 5,
          items: { $ref: "#/$defs/abuse_case" },
        },
        summary: {
          type: "object",
          required: [
            "risk_level",
            "total_findings",
            "critical_findings",
            "mitigations_required",
          ],
          properties: {
            risk_level: { type: "string", enum: ["low", "medium", "high", "critical"] },
            total_findings: { type: "number" },
            critical_findings: { type: "number" },
            mitigations_required: { type: "array", items: { type: "string" } },
          },
        },
      },
      $defs: {
        threat_category: {
          type: "object",
          required: ["applicable", "threats"],
          properties: {
            applicable: { type: "boolean" },
            threats: {
              type: "array",
              items: {
                type: "object",
                required: ["id", "title", "description", "severity", "mitigation", "affected_components"],
                properties: {
                  id: { type: "string", description: "e.g., S-01, T-01" },
                  title: { type: "string" },
                  description: { type: "string" },
                  severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
                  mitigation: { type: "string" },
                  affected_components: { type: "array", items: { type: "string" } },
                },
              },
            },
          },
        },
        abuse_case: {
          type: "object",
          required: ["id", "severity", "title", "attacker_goal", "technique", "preconditions", "impact", "mitigation", "stride_category", "testable"],
          properties: {
            id: { type: "string", description: "e.g., AC-001" },
            severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
            title: { type: "string" },
            attacker_goal: { type: "string", description: "As an attacker, I want to..." },
            technique: { type: "string" },
            preconditions: { type: "array", items: { type: "string" } },
            impact: { type: "string" },
            mitigation: { type: "string" },
            stride_category: { type: "string" },
            testable: { type: "boolean" },
            test_hint: { type: "string", description: "Optional: how to test this" },
          },
        },
      },
    },

    context: {
      // Token optimization: content already in analysis_request — context carries only metadata references
      // I-01: use generic field names to avoid leaking internal structure
      change_name: ctx.changeName,
      stack: ctx.stack,
      has_proposal: !!ctx.proposalContent,
      has_design: !!ctx.designContent,
    },
  };
}
