/**
 * Paranoid posture audit prompt template for post-implementation code audit.
 *
 * Maximum depth: line-by-line security analysis for critical paths.
 * Includes test_hint values from abuse cases, data flow tracing,
 * DREAD-scored risk assessment, supply chain checks, dependency vulnerabilities.
 * 8-12 abuse case verifications with detailed exploitability assessment.
 * Mandatory code quality section with specific line references.
 *
 * Spec refs: Domain 8 (Posture-Driven Audit Prompts — paranoid)
 * Design refs: Decision 9 (Posture-driven prompt templates)
 */

import type { AuditPrompt, AbuseCase, CodeFile } from "../types/index.js";

export interface ParanoidAuditPromptContext {
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

export function buildParanoidAuditPrompt(ctx: ParanoidAuditPromptContext): AuditPrompt {
  // Build code files section
  const codeSection = ctx.codeFiles
    .map((f) => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``)
    .join("\n\n");

  // Include ALL abuse cases for paranoid posture (up to 12), with test_hints
  const abuseCasesSection = ctx.abuseCases.length > 0
    ? ctx.abuseCases
        .slice(0, 12)
        .map((ac) => {
          let entry = `- **${ac.id}** (${ac.severity}): ${ac.attacker_goal}\n  - Technique: ${ac.technique}\n  - Mitigation: ${ac.mitigation}`;
          if (ac.test_hint) {
            entry += `\n  - Test Hint: ${ac.test_hint}`;
          }
          return entry;
        })
        .join("\n")
    : "No abuse cases identified in the security review.";

  return {
    system_instructions: `You are a principal security architect performing a paranoid-depth post-implementation code audit.
This is the most thorough audit level — perform line-by-line security analysis on critical code paths, trace data flows, assess supply chain risks, and provide DREAD-scored risk assessments.

## Requirement Verification (EXHAUSTIVE)
For each requirement in the specification:
1. Determine if the code satisfies it: pass, fail, partial, or skipped
2. Provide exhaustive evidence — cite specific code lines that satisfy or fail the requirement
3. List code_references as "file:line" strings (MANDATORY — be specific)
4. List any gaps — what's missing, incomplete, or incorrectly implemented
5. Add notes with security-critical observations and code quality concerns

## Abuse Case Verification (ALL cases, 8-12 expected)
For each abuse case from the security review:
1. Determine if the code addresses it: verified, unverified, partial, or not_applicable
2. Provide exhaustive evidence — trace the exact code path that mitigates the attack
3. List code_references as "file:line" strings (MANDATORY)
4. List gaps — what's missing, including edge cases and bypass techniques
5. Assess risk_if_unaddressed with CVSS-style impact (confidentiality/integrity/availability)
6. When a test_hint is provided, verify that the suggested test would pass against the code

## Data Flow Tracing
For critical code paths:
- Trace where data enters the system (inputs, external sources)
- Follow data transformations and validations through the code
- Identify trust boundaries where validation should occur
- Flag any points where untrusted data flows into sensitive operations
Include data flow findings in the evidence and gaps of relevant verifications.

## OWASP Top 10 + API Security Top 10 Code Pattern Check
Exhaustively cross-reference the code against:

OWASP Web Top 10 (2021):
- A01: Broken Access Control — authorization checks, IDOR, path traversal
- A02: Cryptographic Failures — weak algorithms, key management, TLS
- A03: Injection — SQL, NoSQL, OS command, LDAP, XSS
- A04: Insecure Design — missing rate limiting, abuse flow prevention
- A05: Security Misconfiguration — verbose errors, debug modes, CORS
- A06: Vulnerable Components — outdated dependencies, known CVEs
- A07: Authentication Failures — credential stuffing, weak passwords, session
- A08: Software Integrity — CI/CD, deserialization, unsigned updates
- A09: Logging Failures — missing events, log injection, monitoring gaps
- A10: SSRF — unvalidated URLs, DNS rebinding

OWASP API Security Top 10 (2023) (if applicable):
- API1: Broken Object Level Authorization
- API2: Broken Authentication
- API3: Broken Object Property Level Authorization
- API4: Unrestricted Resource Consumption
- API5: Broken Function Level Authorization
- API6: Unrestricted Access to Sensitive Business Flows
- API7: Server Side Request Forgery
- API8: Security Misconfiguration
- API9: Improper Inventory Management
- API10: Unsafe Consumption of APIs

## Supply Chain & Dependency Risk Assessment
Evaluate:
- Are there any imports from untrusted or unusual sources?
- Are dependency versions pinned or using ranges that could introduce vulnerabilities?
- Are there any eval(), Function(), or dynamic code execution patterns?
- Are there any hardcoded secrets, API keys, or credentials in the code?

## DREAD-Scored Risk Assessment for Gaps
For each unverified or partial finding, provide a DREAD score:
- Damage (1-10): How severe is the impact?
- Reproducibility (1-10): How easy to reproduce?
- Exploitability (1-10): How easy to exploit?
- Affected Users (1-10): How many users affected?
- Discoverability (1-10): How easy to discover?
Include the DREAD total (average) in the risk_if_unaddressed field.

## Code Quality Security Analysis (MANDATORY)
For every code file, provide specific line-reference observations on:
- Input validation completeness and correctness
- Error handling — information leakage risk
- Authentication/authorization enforcement consistency
- Cryptographic implementation correctness
- Race conditions and concurrency issues
- Resource cleanup and connection handling
Include these observations in the notes field of relevant requirement verifications.

## Summary
Produce an overall summary with:
- overall_verdict: "pass" (all requirements met, all abuse cases addressed), "fail" (critical gaps), or "partial" (some gaps)
- requirements_coverage: counts of each verdict
- abuse_cases_coverage: counts of each verdict
- risk_level: low/medium/high/critical based on unaddressed items, OWASP patterns, DREAD scores, and supply chain risks
- recommendations: ordered by risk severity (highest DREAD score first), including OWASP findings, supply chain issues, and code quality improvements

Return your analysis as a JSON object matching the output schema. Miss nothing.`,

    analysis_request: `Audit the following code for the change "${ctx.changeName}" in a ${ctx.stack} project.
This is a PARANOID-depth audit — the most thorough level. Perform line-by-line analysis, trace data flows, check for supply chain risks, and provide DREAD-scored risk assessments for all findings.

## Project Description
${ctx.projectDescription}

${ctx.proposalContent ? `## Proposal\n${ctx.proposalContent}\n` : ""}
## Specification
${ctx.specContent}

${ctx.designContent ? `## Architecture Design\n${ctx.designContent}\n` : ""}
## Abuse Cases (with test hints where available)
${abuseCasesSection}

## Code Files
${codeSection}

Be exhaustive. Trace data flows. Check for supply chain risks. Provide DREAD scores for all unverified/partial findings.
${ctx.abuseCases.some((ac) => ac.test_hint) ? "Test hints are provided for some abuse cases — verify the suggested tests would pass against the code." : ""}
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
              evidence: { type: "string", description: "Exhaustive evidence with line-level code citations and data flow trace" },
              code_references: { type: "array", items: { type: "string" }, description: "MANDATORY — specific file:line references" },
              gaps: { type: "array", items: { type: "string" }, description: "Include OWASP patterns, supply chain issues, and DREAD scores" },
              notes: { type: "string", description: "MANDATORY — include code quality security observations with line references" },
            },
          },
        },
        abuse_cases: {
          type: "array",
          minItems: 0,
          maxItems: 12,
          items: {
            type: "object",
            required: ["abuse_case_id", "verdict", "evidence", "code_references", "gaps", "risk_if_unaddressed"],
            properties: {
              abuse_case_id: { type: "string" },
              verdict: { type: "string", enum: ["verified", "unverified", "partial", "not_applicable"] },
              evidence: { type: "string", description: "Exhaustive code path trace showing mitigation" },
              code_references: { type: "array", items: { type: "string" }, description: "MANDATORY — specific file:line references" },
              gaps: { type: "array", items: { type: "string" }, description: "Include bypass techniques and edge cases" },
              risk_if_unaddressed: { type: "string", description: "CVSS-style impact + DREAD score (D/R/E/A/D = X/X/X/X/X, total: X.X)" },
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
            recommendations: { type: "array", items: { type: "string" }, description: "Ordered by DREAD score — highest risk first" },
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
