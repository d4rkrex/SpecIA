/**
 * STRIDE full + OWASP Top 10 prompt template for "elevated" security posture.
 *
 * Performs full STRIDE analysis with OWASP Top 10 (2021) mapping.
 * Includes threat scenarios with attacker goals and attack vectors.
 *
 * Spec refs: Domain 6 (Elevated depth)
 * Design refs: Decision 3 (Posture-Driven Depth table — ~1500 tokens)
 */

import type { ReviewPrompt } from "../types/index.js";

export interface ElevatedPromptContext {
  projectDescription: string;
  stack: string;
  changeName: string;
  specContent: string;
  proposalContent?: string;
  /** v0.2: Architecture design content (when design.md exists). */
  designContent?: string;
  pastFindings?: string[];
}

export function buildElevatedPrompt(ctx: ElevatedPromptContext): ReviewPrompt {
  const pastFindingsBlock =
    ctx.pastFindings && ctx.pastFindings.length > 0
      ? `\n## Past Security Findings (from previous reviews)\n${ctx.pastFindings.map((f, i) => `${i + 1}. ${f}`).join("\n")}\nReference these if relevant to the current change.\n`
      : "";

  return {
    system_instructions: `You are a senior security engineer performing a thorough security review.
Perform a FULL STRIDE analysis and map findings to the OWASP Top 10 (2021).

## STRIDE Analysis (detailed)
For each STRIDE category, perform a detailed analysis:
- Spoofing: Identity verification, authentication bypass, session hijacking
- Tampering: Data integrity, input validation, parameter manipulation
- Repudiation: Audit logging, non-repudiation mechanisms
- Information Disclosure: Data leaks, error messages, side channels
- Denial of Service: Resource exhaustion, rate limiting, availability
- Elevation of Privilege: Authorization flaws, privilege escalation, RBAC bypass

For each threat:
- Provide an attacker goal (what they want to achieve)
- Describe the attack vector (how they would exploit it)
- Assess severity (low/medium/high/critical)
- Recommend specific mitigations with implementation guidance

## OWASP Top 10 (2021) Mapping
Map each STRIDE finding to the applicable OWASP category:
- A01:2021 Broken Access Control
- A02:2021 Cryptographic Failures
- A03:2021 Injection
- A04:2021 Insecure Design
- A05:2021 Security Misconfiguration
- A06:2021 Vulnerable and Outdated Components
- A07:2021 Identification and Authentication Failures
- A08:2021 Software and Data Integrity Failures
- A09:2021 Security Logging and Monitoring Failures
- A10:2021 Server-Side Request Forgery

Return findings for ALL applicable OWASP categories.

## Abuse Cases (5-8)
Generate 5-8 abuse cases with detailed techniques for the risks identified. Each abuse case follows the pattern:
"As an attacker, I want to [goal] by [technique] so that [impact]"

For each abuse case provide:
- id: Sequential ID (AC-001, AC-002, etc.)
- severity: critical/high/medium/low
- title: Short description
- attacker_goal: "As an attacker, I want to..." (the goal)
- technique: Detailed description of how the attack would work, including tools or methods
- preconditions: Array of conditions that must be true for the attack
- impact: What happens if successful
- mitigation: Specific mitigation with implementation guidance
- stride_category: Which STRIDE category (Spoofing/Tampering/Repudiation/Information Disclosure/Denial of Service/Elevation of Privilege)
- testable: Whether this can be automated as a security test (boolean)`,

    analysis_request: `Analyze the following specification for the change "${ctx.changeName}" in a ${ctx.stack} project.

## Project Description
${ctx.projectDescription}

${ctx.proposalContent ? `## Proposal\n${ctx.proposalContent}\n` : ""}
## Specification
${ctx.specContent}
${ctx.designContent ? `\n## Architecture Design\n${ctx.designContent}\nAnalyze the architecture decisions for security implications.\n` : ""}${pastFindingsBlock}
Return your analysis as a JSON object matching the output schema below.
Include threat scenarios with attacker goals and attack vectors in each threat description.`,

    output_schema: {
      type: "object",
      required: ["stride", "owasp_mapping", "summary", "abuse_cases"],
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
              owasp_id: { type: "string", description: "e.g., A01:2021" },
              owasp_name: { type: "string" },
              related_threats: { type: "array", items: { type: "string" } },
              applicable: { type: "boolean" },
            },
          },
        },
        abuse_cases: {
          type: "array",
          minItems: 5,
          maxItems: 8,
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
                  description: { type: "string", description: "Include attacker goal and attack vector" },
                  severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
                  mitigation: { type: "string", description: "Specific implementation guidance" },
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
            technique: { type: "string", description: "Detailed attack technique with tools/methods" },
            preconditions: { type: "array", items: { type: "string" } },
            impact: { type: "string" },
            mitigation: { type: "string", description: "Specific mitigation with implementation guidance" },
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
      has_past_findings: !!(ctx.pastFindings && ctx.pastFindings.length > 0),
    },
  };
}
