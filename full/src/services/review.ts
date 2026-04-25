/**
 * Security Review Engine — constructs posture-driven review prompts
 * and validates review results returned by the agent's LLM.
 *
 * This engine does NOT call an LLM directly. It:
 * 1. Constructs a structured prompt based on security posture
 * 2. Returns it for the agent's LLM to process
 * 3. Validates and renders the LLM's response as review.md
 *
 * Spec refs: Domain 6 (Three Depth Levels, Review Output Structure)
 * Design refs: Decision 3 (Two-Phase Review, ReviewEngine Interface)
 */

import type {
  SecurityPosture,
  VtspecConfig,
  SecurityReview,
  ReviewPrompt,
  ReviewSummary,
  StrideAnalysis,
  ThreatCategory,
  OwaspMapping,
  DreadScore,
  Threat,
  AbuseCase,
} from "../types/index.js";
import { buildStandardPrompt } from "../prompts/review-standard.js";
import { buildElevatedPrompt } from "../prompts/review-elevated.js";
import { buildParanoidPrompt } from "../prompts/review-paranoid.js";

// ── Prompt Generation ────────────────────────────────────────────────

export interface ReviewContext {
  config: VtspecConfig;
  changeName: string;
  specContent: string;
  proposalContent?: string;
  /** v0.2: Architecture design document content (when design.md exists). */
  designContent?: string;
  pastFindings?: string[];
}

/**
 * Generate a review prompt based on the project's security posture.
 *
 * Spec refs: Domain 6 (Standard/Elevated/Paranoid depth)
 */
export function generateReviewPrompt(ctx: ReviewContext): ReviewPrompt {
  const posture = ctx.config.security.posture;
  const base = {
    projectDescription: ctx.config.project.description,
    stack: ctx.config.project.stack,
    changeName: ctx.changeName,
    specContent: ctx.specContent,
    proposalContent: ctx.proposalContent,
    designContent: ctx.designContent,
  };

  switch (posture) {
    case "standard":
      return buildStandardPrompt(base);
    case "elevated":
      return buildElevatedPrompt({ ...base, pastFindings: ctx.pastFindings });
    case "paranoid":
      return buildParanoidPrompt({ ...base, pastFindings: ctx.pastFindings });
    default: {
      // Exhaustive check — should never happen if config is validated
      const _exhaustive: never = posture;
      throw new Error(`Unknown posture: ${_exhaustive}`);
    }
  }
}

// ── Result Validation ────────────────────────────────────────────────

/**
 * Validate a review result returned by the agent's LLM.
 *
 * Performs structural validation — ensures required fields are present
 * and correctly typed for the given posture level.
 *
 * Returns a fully typed SecurityReview or throws with validation details.
 */
export function validateReviewResult(
  result: unknown,
  posture: SecurityPosture,
  changeName: string,
  specHash: string,
): SecurityReview {
  if (!result || typeof result !== "object") {
    throw new ReviewValidationError("Review result must be a JSON object");
  }

  const obj = result as Record<string, unknown>;

  // Validate STRIDE (required for all postures)
  const stride = validateStride(obj.stride);

  // Validate summary (required for all postures)
  const summary = validateSummary(obj.summary);

  // Validate OWASP mapping (required for elevated + paranoid)
  let owaspMapping: OwaspMapping[] | undefined;
  if (posture === "elevated" || posture === "paranoid") {
    owaspMapping = validateOwaspMapping(obj.owasp_mapping);
  } else if (obj.owasp_mapping) {
    // Accept OWASP mapping even for standard posture if provided
    owaspMapping = validateOwaspMapping(obj.owasp_mapping);
  }

  // Validate DREAD scores (required for paranoid)
  let dreadScores: DreadScore[] | undefined;
  if (posture === "paranoid") {
    dreadScores = validateDreadScores(obj.dread_scores);
  } else if (obj.dread_scores) {
    dreadScores = validateDreadScores(obj.dread_scores);
  }

  // Validate abuse cases (optional — defaults to [] for backward compatibility)
  const abuseCases = validateAbuseCases(obj.abuse_cases);

  return {
    change: changeName,
    posture,
    timestamp: new Date().toISOString(),
    spec_hash: specHash,
    stride,
    owasp_mapping: owaspMapping,
    dread_scores: dreadScores,
    abuse_cases: abuseCases,
    summary,
  };
}

// ── Markdown Rendering ───────────────────────────────────────────────

/** Map severity to emoji for display. */
export function severityEmoji(severity: string): string {
  switch (severity) {
    case "critical": return "\u{1F534}";
    case "high": return "\u{1F7E0}";
    case "medium": return "\u{1F7E1}";
    case "low": return "\u{1F7E2}";
    default: return "\u{26AA}";
  }
}

/**
 * Render a validated SecurityReview as a markdown document (review.md).
 *
 * Includes YAML frontmatter with machine-parseable metadata.
 *
 * Spec refs: Domain 6 (Machine-parseable review, Review Output Structure)
 */
export function renderReviewMarkdown(review: SecurityReview): string {
  const lines: string[] = [];

  // YAML frontmatter
  lines.push("---");
  lines.push(`spec_hash: "${review.spec_hash}"`);
  lines.push(`posture: "${review.posture}"`);
  lines.push(`findings_count: ${review.summary.total_findings}`);
  lines.push(`critical_count: ${review.summary.critical_findings}`);
  lines.push(`risk_level: "${review.summary.risk_level}"`);
  lines.push(`timestamp: "${review.timestamp}"`);
  lines.push(`change: "${review.change}"`);
  lines.push("---");
  lines.push("");

  // Title
  lines.push(`# Security Review: ${review.change}`);
  lines.push("");
  lines.push(`**Posture**: ${review.posture} | **Risk Level**: ${review.summary.risk_level} | **Findings**: ${review.summary.total_findings} (${review.summary.critical_findings} critical)`);
  lines.push("");

  // STRIDE sections
  lines.push("## STRIDE Analysis");
  lines.push("");

  const categories: Array<[string, ThreatCategory]> = [
    ["Spoofing", review.stride.spoofing],
    ["Tampering", review.stride.tampering],
    ["Repudiation", review.stride.repudiation],
    ["Information Disclosure", review.stride.information_disclosure],
    ["Denial of Service", review.stride.denial_of_service],
    ["Elevation of Privilege", review.stride.elevation_of_privilege],
  ];

  for (const [name, category] of categories) {
    lines.push(`### ${name}`);
    lines.push("");
    if (!category.applicable || category.threats.length === 0) {
      lines.push("*Not applicable to this change.*");
      lines.push("");
      continue;
    }
    for (const threat of category.threats) {
      lines.push(`#### ${threat.id}: ${threat.title}`);
      lines.push("");
      lines.push(`- **Severity**: ${threat.severity}`);
      lines.push(`- **Description**: ${threat.description}`);
      lines.push(`- **Mitigation**: ${threat.mitigation}`);
      lines.push(`- **Affected Components**: ${threat.affected_components.join(", ") || "N/A"}`);
      lines.push("");
    }
  }

  // OWASP mapping (elevated + paranoid)
  if (review.owasp_mapping && review.owasp_mapping.length > 0) {
    lines.push("## OWASP Top 10 Mapping");
    lines.push("");
    lines.push("| OWASP ID | Category | Related Threats | Applicable |");
    lines.push("|----------|----------|-----------------|------------|");
    for (const mapping of review.owasp_mapping) {
      lines.push(
        `| ${mapping.owasp_id} | ${mapping.owasp_name} | ${mapping.related_threats.join(", ") || "—"} | ${mapping.applicable ? "Yes" : "No"} |`,
      );
    }
    lines.push("");
  }

  // DREAD scores (paranoid)
  if (review.dread_scores && review.dread_scores.length > 0) {
    lines.push("## DREAD Scores");
    lines.push("");
    lines.push("| Threat | D | R | E | A | D | Total |");
    lines.push("|--------|---|---|---|---|---|-------|");
    for (const score of review.dread_scores) {
      lines.push(
        `| ${score.threat_id} | ${score.damage} | ${score.reproducibility} | ${score.exploitability} | ${score.affected_users} | ${score.discoverability} | ${score.total.toFixed(1)} |`,
      );
    }
    lines.push("");
  }

  // Abuse Cases
  if (review.abuse_cases && review.abuse_cases.length > 0) {
    lines.push("## Abuse Cases");
    lines.push("");
    lines.push("| ID | Severity | As an attacker, I want to... | STRIDE |");
    lines.push("|----|----------|------------------------------|--------|");
    for (const ac of review.abuse_cases) {
      lines.push(
        `| ${ac.id} | ${severityEmoji(ac.severity)} ${ac.severity} | ${ac.attacker_goal} | ${ac.stride_category} |`,
      );
    }
    lines.push("");
    for (const ac of review.abuse_cases) {
      lines.push(`### ${ac.id}: ${ac.title}`);
      lines.push("");
      lines.push(`- **Severity**: ${severityEmoji(ac.severity)} ${ac.severity[0]!.toUpperCase() + ac.severity.slice(1)}`);
      lines.push(`- **Goal**: ${ac.attacker_goal}`);
      lines.push(`- **Technique**: ${ac.technique}`);
      lines.push(`- **Preconditions**: ${ac.preconditions.join("; ") || "None"}`);
      lines.push(`- **Impact**: ${ac.impact}`);
      lines.push(`- **Mitigation**: ${ac.mitigation}`);
      lines.push(`- **STRIDE**: ${ac.stride_category}`);
      lines.push(`- **Testable**: ${ac.testable ? "Yes" : "No"}`);
      if (ac.test_hint) {
        lines.push(`- **Test Hint**: ${ac.test_hint}`);
      }
      lines.push("");
    }
  }

  // Summary & mitigations
  lines.push("## Mitigations Required");
  lines.push("");
  if (review.summary.mitigations_required.length === 0) {
    lines.push("No significant threats identified — no mitigations required.");
  } else {
    for (const mitigation of review.summary.mitigations_required) {
      lines.push(`- [ ] ${mitigation}`);
    }
  }
  lines.push("");

  return lines.join("\n");
}

// ── Internal Validation Helpers ──────────────────────────────────────

export class ReviewValidationError extends Error {
  constructor(
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ReviewValidationError";
  }
}

function validateStride(raw: unknown): StrideAnalysis {
  if (!raw || typeof raw !== "object") {
    throw new ReviewValidationError("Missing or invalid 'stride' field");
  }

  const obj = raw as Record<string, unknown>;

  return {
    spoofing: validateThreatCategory(obj.spoofing, "spoofing"),
    tampering: validateThreatCategory(obj.tampering, "tampering"),
    repudiation: validateThreatCategory(obj.repudiation, "repudiation"),
    information_disclosure: validateThreatCategory(obj.information_disclosure, "information_disclosure"),
    denial_of_service: validateThreatCategory(obj.denial_of_service, "denial_of_service"),
    elevation_of_privilege: validateThreatCategory(obj.elevation_of_privilege, "elevation_of_privilege"),
  };
}

function validateThreatCategory(
  raw: unknown,
  categoryName: string,
): ThreatCategory {
  if (!raw || typeof raw !== "object") {
    // Default to not applicable if missing
    return { applicable: false, threats: [] };
  }

  const obj = raw as Record<string, unknown>;
  const applicable = typeof obj.applicable === "boolean" ? obj.applicable : false;
  const threats: Threat[] = [];

  if (Array.isArray(obj.threats)) {
    for (const t of obj.threats) {
      if (t && typeof t === "object") {
        const threat = t as Record<string, unknown>;
        threats.push({
          id: String(threat.id ?? `${(categoryName[0] ?? "X").toUpperCase()}-??`),
          title: String(threat.title ?? "Untitled threat"),
          description: String(threat.description ?? "No description"),
          severity: validateSeverity(threat.severity),
          mitigation: String(threat.mitigation ?? "No mitigation specified"),
          affected_components: Array.isArray(threat.affected_components)
            ? threat.affected_components.map(String)
            : [],
        });
      }
    }
  }

  return { applicable, threats };
}

function validateSeverity(
  raw: unknown,
): "low" | "medium" | "high" | "critical" {
  const valid = ["low", "medium", "high", "critical"];
  if (typeof raw === "string" && valid.includes(raw)) {
    return raw as "low" | "medium" | "high" | "critical";
  }
  return "medium"; // default to medium if invalid/missing
}

function validateSummary(raw: unknown): ReviewSummary {
  if (!raw || typeof raw !== "object") {
    throw new ReviewValidationError("Missing or invalid 'summary' field");
  }

  const obj = raw as Record<string, unknown>;

  return {
    risk_level: validateSeverity(obj.risk_level),
    total_findings:
      typeof obj.total_findings === "number" ? obj.total_findings : 0,
    critical_findings:
      typeof obj.critical_findings === "number" ? obj.critical_findings : 0,
    mitigations_required: Array.isArray(obj.mitigations_required)
      ? obj.mitigations_required.map(String)
      : [],
  };
}

function validateOwaspMapping(raw: unknown): OwaspMapping[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .filter((item): item is Record<string, unknown> => item && typeof item === "object")
    .map((item) => ({
      owasp_id: String(item.owasp_id ?? ""),
      owasp_name: String(item.owasp_name ?? ""),
      related_threats: Array.isArray(item.related_threats)
        ? item.related_threats.map(String)
        : [],
      applicable: typeof item.applicable === "boolean" ? item.applicable : false,
    }));
}

function validateDreadScores(raw: unknown): DreadScore[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .filter((item): item is Record<string, unknown> => item && typeof item === "object")
    .map((item) => {
      const damage = clampScore(item.damage);
      const reproducibility = clampScore(item.reproducibility);
      const exploitability = clampScore(item.exploitability);
      const affectedUsers = clampScore(item.affected_users);
      const discoverability = clampScore(item.discoverability);
      const total =
        typeof item.total === "number"
          ? item.total
          : (damage + reproducibility + exploitability + affectedUsers + discoverability) / 5;

      return {
        threat_id: String(item.threat_id ?? ""),
        damage,
        reproducibility,
        exploitability,
        affected_users: affectedUsers,
        discoverability,
        total,
      };
    });
}

function clampScore(raw: unknown): number {
  if (typeof raw !== "number") return 5; // default to mid-range
  return Math.max(1, Math.min(10, Math.round(raw)));
}

function validateAbuseCases(raw: unknown): AbuseCase[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .filter((item): item is Record<string, unknown> => item && typeof item === "object")
    .map((item) => ({
      id: String(item.id ?? "AC-???"),
      severity: validateSeverity(item.severity),
      title: String(item.title ?? "Untitled abuse case"),
      attacker_goal: String(item.attacker_goal ?? ""),
      technique: String(item.technique ?? ""),
      preconditions: Array.isArray(item.preconditions)
        ? item.preconditions.map(String)
        : [],
      impact: String(item.impact ?? ""),
      mitigation: String(item.mitigation ?? ""),
      stride_category: String(item.stride_category ?? "Unknown"),
      testable: typeof item.testable === "boolean" ? item.testable : false,
      test_hint: typeof item.test_hint === "string" ? item.test_hint : undefined,
    }));
}
