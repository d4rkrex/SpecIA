/**
 * STRIDE + OWASP + DREAD prompt template for "paranoid" security posture.
 *
 * Performs full STRIDE + OWASP Top 10 + DREAD scoring per threat.
 * Includes data flow analysis and prioritized mitigation plan.
 *
 * Spec refs: Domain 6 (Paranoid depth)
 * Design refs: Decision 3 (Posture-Driven Depth table — ~3000 tokens)
 */

import type { ReviewPrompt } from "../types/index.js";

export interface ParanoidPromptContext {
  projectDescription: string;
  stack: string;
  changeName: string;
  specContent: string;
  proposalContent?: string;
  /** v0.2: Architecture design content (when design.md exists). */
  designContent?: string;
  pastFindings?: string[];
}

export function buildParanoidPrompt(ctx: ParanoidPromptContext): ReviewPrompt {
  const pastFindingsBlock =
    ctx.pastFindings && ctx.pastFindings.length > 0
      ? `\n## Past Security Findings (from previous reviews)\n${ctx.pastFindings.map((f, i) => `${i + 1}. ${f}`).join("\n")}\nCorrelate patterns across past reviews. Flag recurring issues.\n`
      : "";

  return {
    system_instructions: `You are a principal security architect performing a comprehensive security review.
This is a PARANOID-level review — the most thorough depth available.

## STRIDE Analysis (exhaustive)
For each STRIDE category, perform an exhaustive analysis:
- Spoofing: All identity verification surfaces, authentication mechanisms, session management, token handling, certificate validation
- Tampering: All data mutation paths, input validation, output encoding, parameter binding, serialization/deserialization
- Repudiation: Audit trail completeness, log integrity, non-repudiation guarantees, event correlation
- Information Disclosure: All data exposure surfaces, error handling, timing side-channels, metadata leaks, caching behavior
- Denial of Service: All resource consumption paths, rate limiting, timeout handling, queue depths, connection pooling
- Elevation of Privilege: All authorization boundaries, RBAC/ABAC enforcement, privilege inheritance, cross-tenant isolation

For each threat provide:
- Attacker goal and motivation
- Detailed attack vector with exploitation steps
- Severity with justification
- Specific, actionable mitigation with implementation guidance

## OWASP Top 10 (2021) + API Security Top 10 (2023) Mapping
Map findings to both:
- OWASP Web Top 10 (2021): A01-A10
- OWASP API Security Top 10 (2023): API1-API10 (if applicable)

## DREAD Scoring (mandatory for each threat)
Score each threat on 5 dimensions (1-10 each):
- Damage: How severe is the impact?
- Reproducibility: How easy to reproduce consistently?
- Exploitability: How easy to launch the attack?
- Affected Users: What percentage of users are affected?
- Discoverability: How easy to find the vulnerability?
Total = average of 5 scores.

## Data Flow Analysis
Describe the data flow paths and trust boundaries:
- Where does data enter the system?
- How does it flow between components?
- Where are the trust boundaries?
- Where are the most vulnerable points?

## Prioritized Mitigation Plan
Order all mitigations by DREAD composite score (highest risk first).
Group into: Critical (must fix before ship), High (fix within sprint), Medium (fix within release), Low (backlog).

## Abuse Cases (8-12)
Generate 8-12 abuse cases with test hints and detailed preconditions. Each abuse case follows the pattern:
"As an attacker, I want to [goal] by [technique] so that [impact]"

For each abuse case provide:
- id: Sequential ID (AC-001, AC-002, etc.)
- severity: critical/high/medium/low (use CVSS-style impact assessment)
- title: Short description
- attacker_goal: "As an attacker, I want to..." (the goal)
- technique: Detailed exploitation steps including tools, payloads, and attack chain
- preconditions: Comprehensive array of conditions that must be true for the attack
- impact: CVSS-style impact description (confidentiality/integrity/availability)
- mitigation: Actionable mitigation with implementation guidance and code-level suggestions
- stride_category: Which STRIDE category (Spoofing/Tampering/Repudiation/Information Disclosure/Denial of Service/Elevation of Privilege)
- testable: Whether this can be automated as a security test (boolean)
- test_hint: REQUIRED — How to test this (e.g., "Send request with self-signed HS256 token → expect 401")`,

    analysis_request: `Analyze the following specification for the change "${ctx.changeName}" in a ${ctx.stack} project.

## Project Description
${ctx.projectDescription}

${ctx.proposalContent ? `## Proposal\n${ctx.proposalContent}\n` : ""}
## Specification
${ctx.specContent}
${ctx.designContent ? `\n## Architecture Design\n${ctx.designContent}\nAnalyze the architecture decisions for security implications.\n` : ""}${pastFindingsBlock}
Return your analysis as a JSON object matching the output schema below.
Be exhaustive — this is a paranoid-level review. Miss nothing.`,

    output_schema: {
      type: "object",
      required: ["stride", "owasp_mapping", "dread_scores", "summary", "abuse_cases"],
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
        owasp_mapping: {
          type: "array",
          items: {
            type: "object",
            required: ["owasp_id", "owasp_name", "related_threats", "applicable"],
            properties: {
              owasp_id: { type: "string" },
              owasp_name: { type: "string" },
              related_threats: { type: "array", items: { type: "string" } },
              applicable: { type: "boolean" },
            },
          },
        },
        dread_scores: {
          type: "array",
          items: {
            type: "object",
            required: [
              "threat_id",
              "damage",
              "reproducibility",
              "exploitability",
              "affected_users",
              "discoverability",
              "total",
            ],
            properties: {
              threat_id: { type: "string" },
              damage: { type: "number", minimum: 1, maximum: 10 },
              reproducibility: { type: "number", minimum: 1, maximum: 10 },
              exploitability: { type: "number", minimum: 1, maximum: 10 },
              affected_users: { type: "number", minimum: 1, maximum: 10 },
              discoverability: { type: "number", minimum: 1, maximum: 10 },
              total: { type: "number", description: "Average of 5 scores" },
            },
          },
        },
        data_flow_analysis: {
          type: "string",
          description: "Textual description of data paths and trust boundaries",
        },
        abuse_cases: {
          type: "array",
          minItems: 8,
          maxItems: 12,
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
                  id: { type: "string" },
                  title: { type: "string" },
                  description: { type: "string", description: "Include attacker goal, motivation, attack vector with exploitation steps" },
                  severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
                  mitigation: { type: "string", description: "Specific, actionable with implementation guidance" },
                  affected_components: { type: "array", items: { type: "string" } },
                },
              },
            },
          },
        },
        abuse_case: {
          type: "object",
          required: ["id", "severity", "title", "attacker_goal", "technique", "preconditions", "impact", "mitigation", "stride_category", "testable", "test_hint"],
          properties: {
            id: { type: "string", description: "e.g., AC-001" },
            severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
            title: { type: "string" },
            attacker_goal: { type: "string", description: "As an attacker, I want to..." },
            technique: { type: "string", description: "Detailed exploitation steps with tools, payloads, attack chain" },
            preconditions: { type: "array", items: { type: "string" }, description: "Comprehensive conditions" },
            impact: { type: "string", description: "CVSS-style impact (C/I/A)" },
            mitigation: { type: "string", description: "Actionable with code-level suggestions" },
            stride_category: { type: "string" },
            testable: { type: "boolean" },
            test_hint: { type: "string", description: "REQUIRED: How to test this (e.g., 'Send request with self-signed HS256 token → expect 401')" },
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
      has_past_findings: !!(ctx.pastFindings && ctx.pastFindings.length > 0),
    },
  };
}
