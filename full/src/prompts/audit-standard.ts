/**
 * Standard posture audit prompt template for post-implementation code audit.
 *
 * Verifies requirements are met, checks top abuse case mitigations.
 * Returns structured JSON matching AuditResult schema.
 * ~500-800 token system prompt overhead. 3-5 abuse case verifications.
 *
 * Spec refs: Domain 8 (Posture-Driven Audit Prompts — standard)
 * Design refs: Decision 9 (Posture-driven prompt templates)
 */

import type { AuditPrompt, AbuseCase, CodeFile } from "../types/index.js";

export interface StandardAuditPromptContext {
  projectDescription: string;
  stack: string;
  changeName: string;
  specContent: string;
  abuseCases: AbuseCase[];
  codeFiles: CodeFile[];
  reviewContent?: string;
  designContent?: string;
  proposalContent?: string;
}

export function buildStandardAuditPrompt(ctx: StandardAuditPromptContext): AuditPrompt {
  // Build code files section
  const codeSection = ctx.codeFiles
    .map((f) => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``)
    .join("\n\n");

  // Select top abuse cases by severity (3-5, highest severity first)
  const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const sortedAbuseCases = [...ctx.abuseCases]
    .sort((a, b) => (severityOrder[a.severity] ?? 3) - (severityOrder[b.severity] ?? 3))
    .slice(0, 5);

  // Build abuse cases checklist
  const abuseCasesSection = sortedAbuseCases.length > 0
    ? sortedAbuseCases
        .map((ac) =>
          `- **${ac.id}** (${ac.severity}): ${ac.attacker_goal}\n  - Technique: ${ac.technique}\n  - Mitigation: ${ac.mitigation}`,
        )
        .join("\n")
    : "No abuse cases identified in the security review.";

  return {
    system_instructions: `You are a post-implementation code auditor for a security-aware development workflow.
Your task is to verify that the implemented code satisfies the specification requirements and addresses security abuse cases identified during the security review.

## Requirement Verification
For each requirement in the specification:
1. Determine if the code satisfies it: pass, fail, partial, or skipped
2. Provide evidence — cite specific code that satisfies or fails the requirement
3. List code_references as "file:line" strings
4. List any gaps — what's missing or incomplete
5. Add notes for additional context

## Abuse Case Verification (3-5 top cases)
For each abuse case from the security review:
1. Determine if the code addresses it: verified, unverified, partial, or not_applicable
2. Provide evidence — cite specific code that mitigates the abuse case
3. List code_references as "file:line" strings
4. List gaps — what's missing
5. Assess risk_if_unaddressed — what happens if this remains unverified

## Summary
Produce an overall summary with:
- overall_verdict: "pass" (all requirements met, all abuse cases addressed), "fail" (critical gaps), or "partial" (some gaps)
- requirements_coverage: counts of each verdict
- abuse_cases_coverage: counts of each verdict
- risk_level: low/medium/high/critical based on unaddressed items
- recommendations: action items for failed or partial items

Return your analysis as a JSON object matching the output schema.`,

    analysis_request: `Audit the following code for the change "${ctx.changeName}" in a ${ctx.stack} project.

## Project Description
${ctx.projectDescription}

${ctx.proposalContent ? `## Proposal\n${ctx.proposalContent}\n` : ""}
## Specification
${ctx.specContent}

${ctx.designContent ? `## Architecture Design\n${ctx.designContent}\n` : ""}
## Abuse Cases
${abuseCasesSection}

## Code Files
${codeSection}

Return your analysis as a JSON object matching the output schema below.`,

    output_schema: {
      type: "object",
      required: ["requirements", "abuse_cases", "summary"],
      properties: {
        requirements: {
          type: "array",
          items: {
            type: "object",
            required: ["requirement_id", "verdict", "evidence", "code_references", "gaps", "notes"],
            properties: {
              requirement_id: { type: "string" },
              verdict: { type: "string", enum: ["pass", "fail", "partial", "skipped"] },
              evidence: { type: "string" },
              code_references: { type: "array", items: { type: "string" } },
              gaps: { type: "array", items: { type: "string" } },
              notes: { type: "string" },
            },
          },
        },
        abuse_cases: {
          type: "array",
          minItems: 0,
          maxItems: 5,
          items: {
            type: "object",
            required: ["abuse_case_id", "verdict", "evidence", "code_references", "gaps", "risk_if_unaddressed"],
            properties: {
              abuse_case_id: { type: "string" },
              verdict: { type: "string", enum: ["verified", "unverified", "partial", "not_applicable"] },
              evidence: { type: "string" },
              code_references: { type: "array", items: { type: "string" } },
              gaps: { type: "array", items: { type: "string" } },
              risk_if_unaddressed: { type: "string" },
            },
          },
        },
        summary: {
          type: "object",
          required: ["overall_verdict", "requirements_coverage", "abuse_cases_coverage", "risk_level", "recommendations"],
          properties: {
            overall_verdict: { type: "string", enum: ["pass", "fail", "partial"] },
            requirements_coverage: {
              type: "object",
              properties: {
                total: { type: "number" },
                passed: { type: "number" },
                failed: { type: "number" },
                partial: { type: "number" },
                skipped: { type: "number" },
              },
            },
            abuse_cases_coverage: {
              type: "object",
              properties: {
                total: { type: "number" },
                verified: { type: "number" },
                unverified: { type: "number" },
                partial: { type: "number" },
                not_applicable: { type: "number" },
              },
            },
            risk_level: { type: "string", enum: ["low", "medium", "high", "critical"] },
            recommendations: { type: "array", items: { type: "string" } },
          },
        },
      },
    },

    context: {
      project_description: ctx.projectDescription,
      stack: ctx.stack,
      change_name: ctx.changeName,
      spec_content: ctx.specContent,
      review_content: ctx.reviewContent || undefined,
      design_content: ctx.designContent,
      proposal_content: ctx.proposalContent,
    },
  };
}
