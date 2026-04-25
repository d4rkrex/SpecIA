#!/usr/bin/env node
/**
 * Full integration test for specia_debate MCP tool.
 * Tests complete workflow: multiple findings debated to completion.
 */

import { handleVtspecDebate } from '../../dist/tools/debate.js';
import { readFile, unlink } from 'fs/promises';
import { existsSync } from 'fs';

const speciaRoot = process.cwd().replace("/test/integration", "");
const changeName = 'specia-structured-debate';
const statePath = `.specia/changes/${changeName}/debate-state.json`;

console.log('🧪 Full Debate Integration Test\n');
console.log(`Change: ${changeName}`);
console.log(`Root: ${speciaRoot}\n`);

// Clean state
if (existsSync(statePath)) {
  await unlink(statePath);
  console.log('🗑️  Cleaned previous state\n');
}

let currentAgent = null;
let currentFinding = null;
let round = 0;
let findingsDebated = 0;
const maxFindings = 3; // Test 3 findings

console.log(`📋 Goal: Debate ${maxFindings} findings to completion\n`);

// Helper: Mock agent response
function mockResponse(agent, findingId) {
  if (agent === 'offensive') {
    return {
      findingId,
      challenges: {
        severityEscalation: {
          original: "medium",
          proposed: "high",
          reasoning: `Escalating ${findingId} due to potential chain attacks`,
          attackScenarios: [
            `Attack scenario 1 for ${findingId}`,
            `Attack scenario 2 for ${findingId}`
          ]
        },
        mitigationGaps: [
          {
            gap: "No cryptographic validation",
            bypassTechnique: "MITM attack",
            edgeCases: ["Race condition", "Replay attack"]
          }
        ]
      },
      verdict: "escalate"
    };
  } else if (agent === 'defensive') {
    return {
      findingId,
      validations: {
        mitigationEffectiveness: {
          effective: false,
          reasoning: `Original mitigation for ${findingId} needs enhancement`,
          implementable: true,
          estimatedEffort: "medium"
        },
        severityChallenge: {
          challenged: false,
          reasoning: "Offensive agent's concerns are valid",
          evidenceOfInflation: "",
          realisticPreconditions: ["Attacker has network access"]
        },
        enhancedMitigation: {
          original: "Basic mitigation",
          enhanced: `Enhanced mitigation for ${findingId} with HMAC signing and schema validation`,
          closesGaps: [
            "Adds cryptographic signing",
            "Prevents replay attacks",
            "Validates input schemas"
          ]
        }
      },
      verdict: "needs_enhancement"
    };
  } else if (agent === 'judge') {
    return {
      findingId,
      synthesis: {
        consensusSeverity: "high",
        consensusReached: true,
        reasoning: `Consensus reached for ${findingId}: escalation justified, mitigation enhanced`,
        offensivePerspective: "Valid concerns about attack chains and mitigation gaps",
        defensivePerspective: "Proposed practical enhancements addressing all gaps"
      },
      updatedMitigation: {
        original: "Basic mitigation",
        refined: `Enhanced mitigation for ${findingId} with comprehensive security controls`,
        improvements: [
          "Cryptographic signing with HMAC-SHA256",
          "Nonce-based replay protection",
          "Schema validation with Zod"
        ],
        creditsAgents: ["offensive", "defensive"]
      },
      needsHumanReview: false,
      unresolvedDisagreements: []
    };
  }
}

// Main loop
let iterations = 0;
const maxIterations = 50; // Safety limit

while (findingsDebated < maxFindings && iterations < maxIterations) {
  iterations++;
  
  // Phase N: Get next prompt or submit response
  const isFirstCall = currentAgent === null;
  const input = isFirstCall 
    ? { change_name: changeName, max_rounds: 3, max_findings: maxFindings }
    : { change_name: changeName, agent_response: mockResponse(currentAgent, currentFinding) };
  
  const result = await handleVtspecDebate(input, speciaRoot);
  
  if (result.status === 'error') {
    console.error('❌ Error:', result.errors[0].message);
    process.exit(1);
  }
  
  if (result.data.debate_summary) {
    // Debate complete!
    console.log('\n✅ DEBATE COMPLETE!');
    console.log(`   Findings debated: ${result.data.debate_summary.findings_debated}`);
    console.log(`   Total rounds: ${result.data.debate_summary.total_rounds}`);
    console.log(`   Artifacts:`);
    console.log(`     - ${result.data.files_updated.review}`);
    console.log(`     - ${result.data.files_updated.transcript}`);
    
    // Verify artifacts exist
    const reviewPath = result.data.files_updated.review;
    const transcriptPath = result.data.files_updated.transcript;
    
    if (!existsSync(reviewPath)) {
      console.error(`\n❌ review.md not found at ${reviewPath}`);
      process.exit(1);
    }
    
    if (!existsSync(transcriptPath)) {
      console.error(`\n❌ debate.md not found at ${transcriptPath}`);
      process.exit(1);
    }
    
    // Check review.md was updated with consensus
    const reviewContent = await readFile(reviewPath, 'utf-8');
    const hasConsensus = reviewContent.includes('Debate Consensus');
    
    if (!hasConsensus) {
      console.error('\n❌ review.md was not updated with consensus sections');
      process.exit(1);
    }
    
    console.log('\n✅ Artifacts verified:');
    console.log('   ✓ review.md updated with consensus');
    console.log('   ✓ debate.md transcript written');
    
    // Verify we debated the expected number
    if (result.data.debate_summary.findings_debated !== maxFindings) {
      console.error(`\n❌ Expected ${maxFindings} findings debated, got ${result.data.debate_summary.findings_debated}`);
      process.exit(1);
    }
    
    break;
  }
  
  if (result.data.debate_prompt) {
    const prompt = result.data.debate_prompt;
    const newFinding = prompt.findingId !== currentFinding;
    
    if (newFinding && currentFinding !== null) {
      findingsDebated++;
      console.log(`\n✅ Finding ${currentFinding} complete (consensus reached)`);
    }
    
    currentAgent = prompt.agent;
    currentFinding = prompt.findingId;
    round = prompt.round;
    
    if (newFinding) {
      console.log(`\n🔍 Starting debate on finding: ${currentFinding}`);
    }
    
    console.log(`   Round ${round} - ${currentAgent} agent`);
  }
}

if (iterations >= maxIterations) {
  console.error('\n❌ Safety limit reached (infinite loop?)');
  process.exit(1);
}

console.log('\n🎉 ALL TESTS PASSED\n');
process.exit(0);
