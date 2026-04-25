/**
 * Elevated posture audit prompt template for post-implementation code audit.
 *
 * Deeper analysis: all requirements + all abuse cases + OWASP code patterns.
 * Cross-references OWASP Top 10 against actual code.
 * 5-8 abuse case verifications, detailed evidence required.
 * Code quality observations mandatory.
 *
 * Spec refs: Domain 8 (Posture-Driven Audit Prompts — elevated)
 * Design refs: Decision 9 (Posture-driven prompt templates)
 */

import type { AuditPrompt, AbuseCase, CodeFile } from "../types/index.js";

export interface ElevatedAuditPromptContext {
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

export function buildElevatedAuditPrompt(ctx: ElevatedAuditPromptContext): AuditPrompt {
  // Build code files section
  const codeSection = ctx.codeFiles
    .map((f) => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``)
    .join("\n\n");

  // Include ALL abuse cases for elevated posture (up to 8)
  const abuseCasesSection = ctx.abuseCases.length > 0
    ? ctx.abuseCases
        .slice(0, 8)
        .map((ac) =>
          `- **${ac.id}** (${ac.severity}): ${ac.attacker_goal}\n  - Technique: ${ac.technique}\n  - Mitigation: ${ac.mitigation}`,
        )
        .join("\n")
    : "No abuse cases identified in the security review.";

  return {
    system_instructions: `You are a senior security engineer performing an elevated-depth post-implementation code audit.
Your task is to thoroughly verify that the implemented code satisfies ALL specification requirements, addresses ALL security abuse cases, and does not introduce common vulnerability patterns.

## Requirement Verification (ALL requirements)
For each requirement in the specification:
1. Determine if the code satisfies it: pass, fail, partial, or skipped
2. Provide detailed evidence — cite specific code that satisfies or fails the requirement
3. List code_references as "file:line" strings
4. List any gaps — what's missing or incomplete
5. Add notes with implementation quality observations

## Abuse Case Verification (ALL cases, 5-8 expected)
For each abuse case from the security review:
1. Determine if the code addresses it: verified, unverified, partial, or not_applicable
2. Provide detailed evidence — cite specific code that mitigates the abuse case
3. List code_references as "file:line" strings
4. List gaps — what's missing
5. Assess risk_if_unaddressed with specific exploitation scenarios

## OWASP Top 10 Code Pattern Check
Cross-reference the code against common OWASP Top 10 (2021) vulnerability patterns:
- A01: Broken Access Control — missing authorization checks, IDOR
- A02: Cryptographic Failures — weak algorithms, hardcoded secrets, missing encryption
- A03: Injection — unsanitized inputs in queries, commands, templates
- A04: Insecure Design — missing rate limiting, lack of input validation
- A05: Security Misconfiguration — verbose errors, default credentials, unnecessary features
- A06: Vulnerable Components — known-vulnerable dependencies
- A07: Authentication Failures — weak password policies, missing MFA, session issues
- A08: Software Integrity — unsigned packages, untrusted deserialization
- A09: Logging Failures — missing security events, log injection
- A10: SSRF — unvalidated URLs in server-side requests

Flag any patterns found in the code that match these categories. Include them as additional gaps in relevant requirement or abuse case verifications.

## Code Quality Observations
Provide observations on security-relevant code quality:
- Input validation patterns
- Error handling (are errors leaking information?)
- Authentication/authorization consistency
- Logging and audit trail completeness
Include these in the notes field of relevant requirement verifications.

## Summary
Produce an overall summary with:
- overall_verdict: "pass" (all requirements met, all abuse cases addressed), "fail" (critical gaps), or "partial" (some gaps)
- requirements_coverage: counts of each verdict
- abuse_cases_coverage: counts of each verdict
- risk_level: low/medium/high/critical based on unaddressed items and OWASP pattern matches
- recommendations: prioritized action items for failed or partial items, including any OWASP-related findings

Return your analysis as a JSON object matching the output schema.`,

    analysis_request: `Audit the following code for the change "${ctx.changeName}" in a ${ctx.stack} project.
This is an elevated-depth audit — be thorough and check for OWASP vulnerability patterns.

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

Cross-reference code against OWASP Top 10 patterns. Provide detailed evidence for every finding.
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
              evidence: { type: "string", description: "Detailed evidence with specific code citations" },
              code_references: { type: "array", items: { type: "string" } },
              gaps: { type: "array", items: { type: "string" }, description: "Include OWASP pattern matches if applicable" },
              notes: { type: "string", description: "Include code quality observations" },
            },
          },
        },
        abuse_cases: {
          type: "array",
          minItems: 0,
          maxItems: 8,
          items: {
            type: "object",
            required: ["abuse_case_id", "verdict", "evidence", "code_references", "gaps", "risk_if_unaddressed"],
            properties: {
              abuse_case_id: { type: "string" },
              verdict: { type: "string", enum: ["verified", "unverified", "partial", "not_applicable"] },
              evidence: { type: "string", description: "Detailed evidence with specific code citations" },
              code_references: { type: "array", items: { type: "string" } },
              gaps: { type: "array", items: { type: "string" } },
              risk_if_unaddressed: { type: "string", description: "Specific exploitation scenario" },
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
            recommendations: { type: "array", items: { type: "string" }, description: "Prioritized action items including OWASP findings" },
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
