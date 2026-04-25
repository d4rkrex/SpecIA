/**
 * Debate Orchestrator — TWO-PHASE PATTERN (refactored).
 *
 * NO direct LLM calls. Returns prompts for agent host to execute.
 *
 * Flow:
 * Phase 1: specia_debate() → returns DebatePrompt
 * Phase 2: specia_debate({ agent_response }) → processes response, returns next prompt or completion
 *
 * State persisted between calls in .specia/changes/{name}/debate-state.json
 *
 * Architecture: Consistent with specia_review, specia_design, specia_audit (all two-phase)
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import type {
  DebateRound,
  DebateResult,
  DebateState,
  DebatePrompt,
  DebateNextAction,
  FindingContext,
  OffensiveResponse,
  DefensiveResponse,
  JudgeResponse,
} from "../types/debate.js";
import { OffensiveAgent } from "../agents/offensive-agent.js";
import { DefensiveAgent } from "../agents/defensive-agent.js";
import { JudgeAgent } from "../agents/judge-agent.js";
import { parseReviewFindings, updateReviewWithDebate } from "./review-parser.js";
import { writeDebateTranscript } from "./debate-writer.js";

const MAX_ROUNDS_DEFAULT = 3;
const MAX_FINDINGS_DEFAULT = 10;

export class DebateOrchestrator {
  private offensive: OffensiveAgent;
  private defensive: DefensiveAgent;
  private judge: JudgeAgent;

  constructor() {
    this.offensive = new OffensiveAgent();
    this.defensive = new DefensiveAgent();
    this.judge = new JudgeAgent();
  }

  /**
   * TWO-PHASE: Get next debate prompt or finalize.
   * 
   * Call without agent_response: returns first prompt
   * Call with agent_response: processes response, returns next prompt or completion
   */
  async next(
    changeName: string,
    speciaRoot: string,
    options: {
      maxRounds?: number;
      maxFindings?: number;
      agentResponse?: OffensiveResponse | DefensiveResponse | JudgeResponse;
    } = {},
  ): Promise<DebateNextAction> {
    const statePath = join(speciaRoot, ".specia", "changes", changeName, "debate-state.json");
    
    // Load or initialize state
    let state: DebateState;
    
    if (existsSync(statePath) && !options.agentResponse) {
      // Resume existing debate
      state = JSON.parse(await readFile(statePath, "utf-8"));
    } else if (!existsSync(statePath) && !options.agentResponse) {
      // Initialize new debate
      state = await this.initializeDebate(changeName, speciaRoot, options);
      await this.saveState(statePath, state);
    } else if (options.agentResponse) {
      // Process agent response
      state = JSON.parse(await readFile(statePath, "utf-8"));
      
      // Check bounds BEFORE processing response
      if (state.currentFindingIndex >= state.findings.length) {
        throw new Error(
          `Cannot process agent response: all findings already debated. ` +
          `Index: ${state.currentFindingIndex}, Total: ${state.findings.length}`
        );
      }
      
      await this.processAgentResponse(state, options.agentResponse);
      await this.saveState(statePath, state);
    } else {
      throw new Error("Invalid debate state: cannot resume without existing state");
    }

    // Check if debate complete
    if (state.currentFindingIndex >= state.findings.length) {
      return await this.finalizeDebate(changeName, speciaRoot, state, statePath);
    }

    // Get current finding
    const finding = state.findings[state.currentFindingIndex]!;
    const currentDebate = state.debates[state.currentFindingIndex]!;

    // Check if current finding debate is complete
    if (currentDebate.consensus || state.currentRound > state.maxRounds) {
      // Record rounds used if not already set (for max rounds without consensus)
      if (!currentDebate.roundsUsed) {
        currentDebate.roundsUsed = state.currentRound - 1; // -1 because we've incremented past the last round
      }
      
      // Move to next finding
      state.currentFindingIndex++;
      state.currentRound = 1;
      await this.saveState(statePath, state);
      
      // Recursive call to get next finding's prompt (WITHOUT agentResponse)
      return this.next(changeName, speciaRoot, { 
        maxRounds: options.maxRounds, 
        maxFindings: options.maxFindings 
      });
    }

    // Determine next agent in round
    const roundProgress = currentDebate.rounds.filter(r => r.roundNumber === state.currentRound);
    
    let nextAgent: "offensive" | "defensive" | "judge";
    if (roundProgress.length === 0) {
      nextAgent = "offensive";
    } else if (roundProgress.length === 1) {
      nextAgent = "defensive";
    } else if (roundProgress.length === 2) {
      nextAgent = "judge";
    } else {
      // Round complete, move to next round
      state.currentRound++;
      await this.saveState(statePath, state);
      return this.next(changeName, speciaRoot, {
        maxRounds: options.maxRounds,
        maxFindings: options.maxFindings
      });
    }

    // Build prompt for next agent
    const prompt = await this.buildAgentPrompt(nextAgent, finding, currentDebate.rounds, state.currentRound);
    
    return {
      action: "prompt",
      prompt,
    };
  }

  /**
   * Initialize debate state from review.md
   */
  private async initializeDebate(
    changeName: string,
    speciaRoot: string,
    options: { maxRounds?: number; maxFindings?: number },
  ): Promise<DebateState> {
    const reviewPath = join(speciaRoot, ".specia", "changes", changeName, "review.md");
    const reviewContent = await readFile(reviewPath, "utf-8");
    const findings = parseReviewFindings(reviewContent);

    // Apply rate limit
    const maxFindings = options.maxFindings ?? MAX_FINDINGS_DEFAULT;
    if (findings.length > maxFindings) {
      console.warn(`⚠️  Review has ${findings.length} findings. Limiting to ${maxFindings}.`);
      findings.splice(maxFindings);
    }

    return {
      changeName,
      currentFindingIndex: 0,
      currentRound: 1,
      findings,
      debates: findings.map((f: FindingContext) => ({
        finding: {
          id: f.id,
          title: f.title,
          originalSeverity: f.severity,
        },
        rounds: [],
        roundsUsed: 0,
      })),
      maxRounds: options.maxRounds ?? MAX_ROUNDS_DEFAULT,
      maxFindings: maxFindings,
      startedAt: new Date().toISOString(),
    };
  }

  /**
   * Process agent response and update state
   */
  private async processAgentResponse(
    state: DebateState,
    response: OffensiveResponse | DefensiveResponse | JudgeResponse,
  ): Promise<void> {
    const currentDebate = state.debates[state.currentFindingIndex];
    
    if (!currentDebate) {
      throw new Error(
        `Invalid debate state: no debate found at index ${state.currentFindingIndex}. ` +
        `Total debates: ${state.debates.length}, total findings: ${state.findings.length}`
      );
    }

    // Determine agent type from response shape
    let agent: "offensive" | "defensive" | "judge";
    if ("challenges" in response) {
      agent = "offensive";
    } else if ("validations" in response) {
      agent = "defensive";
    } else if ("synthesis" in response) {
      agent = "judge";
      // Check for consensus
      if (response.synthesis.consensusReached) {
        currentDebate.consensus = response;
        currentDebate.roundsUsed = state.currentRound;
      }
    } else {
      throw new Error("Unknown agent response type");
    }

    // Add round to history
    currentDebate.rounds.push({
      roundNumber: state.currentRound,
      agent,
      timestamp: new Date().toISOString(),
      response,
    });
  }

  /**
   * Build prompt for specific agent
   */
  private async buildAgentPrompt(
    agent: "offensive" | "defensive" | "judge",
    finding: FindingContext,
    previousRounds: DebateRound[],
    round: number,
  ): Promise<DebatePrompt> {
    switch (agent) {
      case "offensive":
        return this.offensive.buildPrompt(finding, previousRounds, round);
      case "defensive":
        return this.defensive.buildPrompt(finding, previousRounds, round);
      case "judge":
        return this.judge.buildPrompt(finding, previousRounds, round);
    }
  }

  /**
   * Finalize debate and write results
   */
  private async finalizeDebate(
    changeName: string,
    speciaRoot: string,
    state: DebateState,
    statePath: string,
  ): Promise<DebateNextAction> {
    const completedAt = new Date().toISOString();
    const startedAt = new Date(state.startedAt);
    const durationMs = new Date(completedAt).getTime() - startedAt.getTime();

    // Update review.md with consensus (only findings that reached consensus)
    const reviewPath = join(speciaRoot, ".specia", "changes", changeName, "review.md");
    const reviewContent = await readFile(reviewPath, "utf-8");
    
    const debatesWithConsensus = state.debates.filter(d => d.consensus);
    const allDebatedFindings = state.debates.filter(d => d.roundsUsed > 0);
    
    const updatedReviewContent = updateReviewWithDebate(reviewContent, debatesWithConsensus.map(d => ({
      finding: d.finding,
      consensus: d.consensus!,
      rounds: d.rounds,
      roundsUsed: d.roundsUsed,
    })));
    
    await writeFile(reviewPath, updatedReviewContent, "utf-8");

    // Write debate transcript (includes ALL debated findings, even without consensus)
    const debatePath = join(speciaRoot, ".specia", "changes", changeName, "debate.md");
    await writeDebateTranscript(debatePath, allDebatedFindings.map(d => ({
      finding: d.finding,
      rounds: d.rounds,
      consensus: d.consensus ?? null,
      roundsUsed: d.roundsUsed,
    })), {
      changeName,
      startedAt: state.startedAt,
      completedAt,
      durationMs,
    });

    // Clean up state file
    const fs = await import("node:fs/promises");
    await fs.unlink(statePath);

    const result: DebateResult = {
      changeName,
      findingsDebated: allDebatedFindings.length,
      totalRounds: allDebatedFindings.reduce((sum, d) => sum + d.roundsUsed, 0),
      debates: allDebatedFindings.map(d => ({
        finding: d.finding,
        rounds: d.rounds,
        consensus: d.consensus ?? null,
        roundsUsed: d.roundsUsed,
      })),
      metadata: {
        startedAt: state.startedAt,
        completedAt,
        durationMs,
        modelsUsed: {
          offensive: "delegated-to-host",
          defensive: "delegated-to-host",
          judge: "delegated-to-host",
        },
      },
    };

    return {
      action: "complete",
      result,
    };
  }

  /**
   * Save debate state to disk
   */
  private async saveState(path: string, state: DebateState): Promise<void> {
    await writeFile(path, JSON.stringify(state, null, 2), "utf-8");
  }
}
