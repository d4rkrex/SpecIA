#!/usr/bin/env node
/**
 * Edge case test: Max rounds without consensus
 */

import { handleVtspecDebate } from '../../dist/tools/debate.js';
import { unlink } from 'fs/promises';
import { existsSync } from 'fs';

const speciaRoot = process.cwd().replace("/test/integration", "");
const changeName = 'specia-structured-debate';
const statePath = `.specia/changes/${changeName}/debate-state.json`;

console.log('🧪 Edge Case Test: Max Rounds Without Consensus\n');

// Clean state
if (existsSync(statePath)) {
  await unlink(statePath);
}

// Mock responses that NEVER reach consensus
function mockNoConsensusResponse(agent, findingId, round) {
  if (agent === 'offensive') {
    return {
      findingId,
      challenges: {
        severityEscalation: {
          original: "medium",
          proposed: "critical",
          reasoning: `Round ${round}: Still escalating to CRITICAL`,
          attackScenarios: [`Scenario ${round}`]
        },
        mitigationGaps: []
      },
      verdict: "escalate"
    };
  } else if (agent === 'defensive') {
    return {
      findingId,
      validations: {
        mitigationEffectiveness: {
          effective: true,
          reasoning: `Round ${round}: Mitigation is fine, no escalation needed`,
          implementable: true,
          estimatedEffort: "low"
        },
        severityChallenge: {
          challenged: true,
          reasoning: "Offensive agent is inflating severity unrealistically",
          evidenceOfInflation: "Attack requires multiple impossible preconditions",
          realisticPreconditions: []
        },
        enhancedMitigation: {
          original: "test",
          enhanced: "test",
          closesGaps: []
        }
      },
      verdict: "inflated"
    };
  } else if (agent === 'judge') {
    return {
      findingId,
      synthesis: {
        consensusSeverity: "medium",
        consensusReached: false, // NO CONSENSUS
        reasoning: `Round ${round}: Agents still disagree fundamentally`,
        offensivePerspective: "Wants CRITICAL",
        defensivePerspective: "Says MEDIUM is fine"
      },
      updatedMitigation: {
        original: "test",
        refined: "test",
        improvements: [],
        creditsAgents: []
      },
      needsHumanReview: true,
      unresolvedDisagreements: [
        {
          topic: "Severity assessment",
          offensivePosition: "CRITICAL due to chain attacks",
          defensivePosition: "MEDIUM with existing controls"
        }
      ]
    };
  }
}

let currentAgent = null;
let currentFinding = null;
let round = 0;
let iterations = 0;
const maxRounds = 3;

console.log(`Testing: Agent disagreement should stop after ${maxRounds} rounds\n`);

while (iterations < 20) {
  iterations++;
  
  const isFirstCall = currentAgent === null;
  const input = isFirstCall 
    ? { change_name: changeName, max_rounds: maxRounds, max_findings: 1 }
    : { change_name: changeName, agent_response: mockNoConsensusResponse(currentAgent, currentFinding, round) };
  
  const result = await handleVtspecDebate(input, speciaRoot);
  
  if (result.status === 'error') {
    console.error('❌ Error:', result.errors[0].message);
    process.exit(1);
  }
  
  if (result.data.debate_summary) {
    console.log('\n✅ Debate completed after max rounds');
    console.log(`   Findings debated: ${result.data.debate_summary.findings_debated}`);
    console.log(`   Total rounds: ${result.data.debate_summary.total_rounds}`);
    
    // Verify it used all 3 rounds
    if (result.data.debate_summary.total_rounds !== maxRounds) {
      console.error(`\n❌ Expected ${maxRounds} rounds, got ${result.data.debate_summary.total_rounds}`);
      process.exit(1);
    }
    
    // Verify consensus was NOT reached but human review flagged
    const consensus = result.data.consensus[0];
    if (consensus.consensus_reached) {
      console.error('\n❌ Consensus should NOT be reached');
      process.exit(1);
    }
    
    if (!consensus.needs_human_review) {
      console.error('\n❌ Should be flagged for human review');
      process.exit(1);
    }
    
    console.log('\n✅ Edge case verified:');
    console.log('   ✓ Stopped after max rounds');
    console.log('   ✓ No consensus reached');
    console.log('   ✓ Flagged for human review');
    console.log('\n🎉 TEST PASSED\n');
    process.exit(0);
  }
  
  if (result.data.debate_prompt) {
    const prompt = result.data.debate_prompt;
    currentAgent = prompt.agent;
    currentFinding = prompt.findingId;
    round = prompt.round;
    console.log(`   Round ${round} - ${currentAgent}`);
  }
}

console.error('\n❌ Test timed out');
process.exit(1);
