/**
 * Write debate transcript to debate.md.
 * Creates a human-readable markdown file with full debate history.
 */

import { writeFile } from "node:fs/promises";
import type { DebateRound, JudgeResponse } from "../types/debate.js";

interface DebateEntry {
  finding: {
    id: string;
    title: string;
    originalSeverity: string;
  };
  rounds: DebateRound[];
  consensus: JudgeResponse | null; // null when max rounds reached without consensus
  roundsUsed: number;
}

interface DebateMetadata {
  changeName: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
}

/**
 * Write debate transcript to markdown file.
 */
export async function writeDebateTranscript(
  path: string,
  debates: DebateEntry[],
  metadata: DebateMetadata,
): Promise<void> {
  const lines = [
    `# Debate Transcript: ${metadata.changeName}`,
    "",
    `**Started**: ${metadata.startedAt}`,
    `**Completed**: ${metadata.completedAt}`,
    `**Duration**: ${(metadata.durationMs / 1000).toFixed(1)}s`,
    `**Findings Debated**: ${debates.length}`,
    "",
    "---",
    "",
  ];

  for (const debate of debates) {
    lines.push(
      `## ${debate.finding.id}: ${debate.finding.title}`,
      "",
      `**Original Severity**: ${debate.finding.originalSeverity}`,
    );
    
    if (debate.consensus) {
      lines.push(
        `**Consensus Severity**: ${debate.consensus.synthesis.consensusSeverity}`,
        `**Consensus Reached**: ${debate.consensus.synthesis.consensusReached ? "✅ Yes" : "⚠️ No"}`,
      );
    } else {
      lines.push(
        `**Consensus Severity**: ⚠️ No consensus`,
        `**Consensus Reached**: ❌ No (max rounds exceeded)`,
      );
    }
    
    lines.push(
      `**Rounds Used**: ${debate.roundsUsed}/${3}`,
      "",
    );

    if (debate.consensus?.needsHumanReview) {
      lines.push("🔴 **Flagged for Human Review**", "");
    }

    lines.push("### Debate Rounds", "");

    for (const round of debate.rounds) {
      const agentIcon =
        round.agent === "offensive"
          ? "🔴"
          : round.agent === "defensive"
            ? "🔵"
            : "⚖️";
      lines.push(
        `#### Round ${round.roundNumber} - ${agentIcon} ${round.agent.charAt(0).toUpperCase() + round.agent.slice(1)}`,
        "",
        "```json",
        JSON.stringify(round.response, null, 2),
        "```",
        "",
      );
    }

    lines.push("### Final Synthesis", "");
    
    if (debate.consensus) {
      lines.push(
        "**Reasoning**: " + debate.consensus.synthesis.reasoning,
        "",
        "**Offensive Perspective**: " +
          debate.consensus.synthesis.offensivePerspective,
        "",
        "**Defensive Perspective**: " +
          debate.consensus.synthesis.defensivePerspective,
        "",
      );

      if (debate.consensus.updatedMitigation) {
        lines.push(
          "**Refined Mitigation**:",
          "",
          debate.consensus.updatedMitigation.refined,
          "",
          `*Improvements*: ${debate.consensus.updatedMitigation.improvements.join(", ")}`,
          "",
          `*Credits*: ${debate.consensus.updatedMitigation.creditsAgents.join(", ")}`,
          "",
        );
      }

      if (debate.consensus.unresolvedDisagreements && debate.consensus.unresolvedDisagreements.length > 0) {
        lines.push("**Unresolved Disagreements**:", "");
        for (const disagreement of debate.consensus.unresolvedDisagreements) {
          lines.push(
            `- **${disagreement.topic}**`,
            `  - Offensive: ${disagreement.offensivePosition}`,
            `  - Defensive: ${disagreement.defensivePosition}`,
            "",
          );
        }
      }
    } else {
      lines.push(
        "**No consensus reached** - Maximum rounds exceeded without agreement.",
        "",
        "This finding requires human review to resolve the disagreement.",
        "",
      );
    }

    lines.push("---", "");
  }

  await writeFile(path, lines.join("\n"), "utf-8");
}
