/**
 * Parse security review findings from review.md.
 * Extracts findings for debate analysis.
 */

import type { FindingContext } from "../types/debate.js";

interface DebateUpdate {
  finding: {
    id: string;
    title: string;
    originalSeverity: string;
  };
  consensus: {
    findingId: string;
    synthesis: {
      consensusSeverity: string;
      consensusReached: boolean;
      reasoning: string;
      offensivePerspective: string;
      defensivePerspective: string;
    };
    updatedMitigation?: {
      original: string;
      refined: string;
      improvements: string[];
      creditsAgents: string[];
    };
    needsHumanReview: boolean;
    unresolvedDisagreements?: {
      topic: string;
      offensivePosition: string;
      defensivePosition: string;
    }[];
  };
  rounds: unknown[];
  roundsUsed: number;
}

/**
 * Parse findings from review.md content.
 * Looks for STRIDE threats and abuse cases.
 * 
 * Format:
 * #### ID: Title
 * - **Severity**: medium
 * - **Description**: ...
 * - **Mitigation**: ...
 */
export function parseReviewFindings(reviewContent: string): FindingContext[] {
  const findings: FindingContext[] = [];

  // Parse STRIDE threats section (by category: Spoofing, Tampering, etc.)
  const strideSection = reviewContent.match(
    /## STRIDE Analysis[\s\S]*?(?=## Abuse Cases|$)/,
  );
  
  if (strideSection) {
    // Match each finding: #### ID: Title
    const threatMatches = strideSection[0].matchAll(
      /####\s+([A-Z]-\d+):\s+(.+?)\n[\s\S]*?-\s+\*\*Severity\*\*:\s+(\w+)[\s\S]*?-\s+\*\*Description\*\*:\s+(.+?)(?=\n-\s+\*\*|\n####|\n###|\n##|$)[\s\S]*?-\s+\*\*Mitigation\*\*:\s+(.+?)(?=\n-\s+\*\*|\n####|\n###|\n##|$)/g,
    );

    for (const match of threatMatches) {
      const [, id, title, severity, description, mitigation] = match;
      const category = getCategoryFromId(id || "");
      
      findings.push({
        id: id || "",
        title: title?.trim() || "",
        description: description?.trim() || "",
        severity: severity?.toLowerCase() || "medium",
        category,
        mitigation: mitigation?.trim() || "",
        affectedComponents: [],
      });
    }
  }

  // Parse abuse cases section
  const abuseCasesSection = reviewContent.match(
    /## Abuse Cases[\s\S]*?(?=##|$)/,
  );
  
  if (abuseCasesSection) {
    // First try table format: | AC-001 | 🟡 medium | description | STRIDE |
    // Use .*? to skip emoji and capture severity word
    const tableMatches = abuseCasesSection[0].matchAll(
      /\|\s+(AC-\d+)\s+\|\s+.*?(high|medium|low|critical)\s+\|\s+(.+?)\s+\|\s+/gi,
    );

    for (const match of tableMatches) {
      const [, id, severity, description] = match;
      findings.push({
        id: id || "",
        title: description?.trim() || "",
        description: description?.trim() || "",
        severity: severity?.toLowerCase() || "medium",
        category: "Abuse Case",
        mitigation: "", // Table format doesn't include mitigation inline
        affectedComponents: [],
      });
    }

    // Also parse detailed abuse case sections: ### AC-XXX: Title
    const detailedACMatches = abuseCasesSection[0].matchAll(
      /###\s+(AC-\d+):\s+(.+?)\n[\s\S]*?-\s+\*\*Severity\*\*:\s+[🟢🟡🟠🔴]?\s*(\w+)[\s\S]*?-\s+\*\*Goal\*\*:\s+(.+?)(?=\n-\s+\*\*|\n###|\n##|$)[\s\S]*?-\s+\*\*Mitigation\*\*:\s+(.+?)(?=\n-\s+\*\*|\n###|\n##|$)/g,
    );

    for (const match of detailedACMatches) {
      const [, id, title, severity, goal, mitigation] = match;
      
      // Skip if already added from table
      if (findings.some(f => f.id === id)) {
        // Update with more details
        const existing = findings.find(f => f.id === id);
        if (existing) {
          existing.title = title?.trim() || existing.title;
          existing.description = goal?.trim() || existing.description;
          existing.mitigation = mitigation?.trim() || "";
        }
        continue;
      }

      findings.push({
        id: id || "",
        title: title?.trim() || "",
        description: goal?.trim() || "",
        severity: severity?.toLowerCase() || "medium",
        category: "Abuse Case",
        mitigation: mitigation?.trim() || "",
        affectedComponents: [],
      });
    }
  }

  console.log(`📋 Parsed ${findings.length} findings from review.md`);
  return findings;
}

/**
 * Map STRIDE ID prefix to category name.
 */
function getCategoryFromId(id: string): string {
  const prefix = id.charAt(0);
  const categories: Record<string, string> = {
    S: "Spoofing",
    T: "Tampering",
    R: "Repudiation",
    I: "Information Disclosure",
    D: "Denial of Service",
    E: "Elevation of Privilege",
  };
  return categories[prefix] || "Security";
}

/**
 * Update review.md with debate consensus.
 * Adds a "Debate Consensus" section to each finding.
 * 
 * Format: #### ID: Title
 */
export function updateReviewWithDebate(
  reviewContent: string,
  debates: DebateUpdate[],
): string {
  let updated = reviewContent;

  for (const debate of debates) {
    const { finding, consensus } = debate;

    // Find the finding section (#### ID: Title format)
    // Match from #### to next #### (same level) or ### or ## (higher level) or end of string
    const findingPattern = new RegExp(
      `(####\\s+${finding.id}:[\\s\\S]*?)(?=\\n####\\s+[A-Z]|\\n###\\s|\\n##\\s|$)`,
      "g",
    );

    updated = updated.replace(findingPattern, (match) => {
      // Remove existing debate consensus if any
      // Match from "##### Debate Consensus" to the end of the match OR next heading
      const cleaned = match.replace(/\n##### Debate Consensus[\s\S]*$/s, "");

      // Add new consensus section (use ##### for sub-heading under ####)
      const consensusSection = [
        "",
        "##### Debate Consensus",
        "",
        `- **Consensus Severity**: ${consensus.synthesis.consensusSeverity}`,
        `- **Consensus Reached**: ${consensus.synthesis.consensusReached ? "✅ Yes" : "⚠️ No"}`,
        `- **Reasoning**: ${consensus.synthesis.reasoning}`,
        "",
      ];

      if (consensus.updatedMitigation) {
        consensusSection.push(
          "**Refined Mitigation**:",
          consensus.updatedMitigation.refined,
          "",
          `*Improvements: ${consensus.updatedMitigation.improvements.join(", ")}*`,
          `*Credits: ${consensus.updatedMitigation.creditsAgents.join(", ")} agents*`,
          "",
        );
      }

      if (consensus.needsHumanReview) {
        consensusSection.push("🔴 **Needs Human Review**: Unresolved disagreements exist.", "");
      }

      if (consensus.unresolvedDisagreements) {
        consensusSection.push("**Unresolved Disagreements**:", "");
        for (const disagreement of consensus.unresolvedDisagreements) {
          consensusSection.push(
            `- **${disagreement.topic}**:`,
            `  - Offensive: ${disagreement.offensivePosition}`,
            `  - Defensive: ${disagreement.defensivePosition}`,
            "",
          );
        }
      }

      return cleaned + "\n" + consensusSection.join("\n");
    });
  }

  return updated;
}
