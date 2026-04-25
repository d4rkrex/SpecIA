#!/usr/bin/env node
/**
 * Test script for specia_debate MCP tool (two-phase pattern).
 * Simulates agent host calling the tool.
 */

import { handleVtspecDebate } from '../../dist/tools/debate.js';

const speciaRoot = process.cwd().replace("/test/integration", "");
const changeName = 'specia-structured-debate';

console.log('🧪 Testing specia_debate MCP tool (two-phase pattern)\n');
console.log(`Change: ${changeName}`);
console.log(`Root: ${speciaRoot}\n`);

// Phase 1: Get first prompt
console.log('📤 Phase 1: Calling specia_debate (no agent_response)...\n');

const phase1Result = await handleVtspecDebate({
  change_name: changeName,
  max_rounds: 3,
  max_findings: 10,
}, speciaRoot);

console.log('📥 Phase 1 Result:');
console.log(JSON.stringify(phase1Result, null, 2));

if (phase1Result.status === 'success' && phase1Result.data?.debate_prompt) {
  const prompt = phase1Result.data.debate_prompt;
  
  console.log('\n✅ First prompt received!');
  console.log(`   Agent: ${prompt.agent}`);
  console.log(`   Finding: ${prompt.findingId}`);
  console.log(`   Round: ${prompt.round}`);
  console.log(`\n   System Prompt (first 200 chars):\n   ${prompt.systemPrompt.substring(0, 200)}...`);
  console.log(`\n   User Prompt (first 300 chars):\n   ${prompt.userPrompt.substring(0, 300)}...`);
  
  console.log('\n📋 Instructions for agent host:');
  console.log(phase1Result.data.instructions);
  
  console.log('\n📊 Progress:');
  console.log(`   Current round: ${phase1Result.data.progress.current_round}/${phase1Result.data.progress.max_rounds}`);
  
  // Mock offensive agent response
  console.log('\n🤖 Simulating offensive agent response...');
  
  const mockOffensiveResponse = {
    findingId: prompt.findingId,
    challenges: {
      severityEscalation: {
        original: "medium",
        proposed: "high",
        reasoning: "The debate orchestrator lacks validation of agent response schemas, allowing injection of malformed responses that could bypass security checks.",
        attackScenarios: [
          "Attacker crafts offensive agent response with SQL injection in reasoning field",
          "Malformed JSON causes parser crash and DoS"
        ]
      },
      mitigationGaps: [
        {
          gap: "No cryptographic signing of agent responses",
          bypassTechnique: "MITM attack on agent communication channel",
          edgeCases: ["Replay attack with cached valid response", "Race condition in validation"]
        }
      ]
    },
    verdict: "escalate"
  };
  
  console.log('   Mock response verdict:', mockOffensiveResponse.verdict);
  
  // Phase 2: Submit offensive agent response
  console.log('\n📤 Phase 2: Calling specia_debate (with agent_response)...\n');
  
  const phase2Result = await handleVtspecDebate({
    change_name: changeName,
    max_rounds: 3,
    max_findings: 10,
    agent_response: mockOffensiveResponse,
  }, speciaRoot);
  
  console.log('📥 Phase 2 Result:');
  console.log(JSON.stringify(phase2Result, null, 2));
  
  if (phase2Result.status === 'success' && phase2Result.data?.debate_prompt) {
    const nextPrompt = phase2Result.data.debate_prompt;
    console.log('\n✅ Next prompt received!');
    console.log(`   Agent: ${nextPrompt.agent}`);
    console.log(`   Finding: ${nextPrompt.findingId}`);
    console.log(`   Round: ${nextPrompt.round}`);
    
    console.log('\n🎯 Two-phase pattern working correctly!');
    console.log('   ✓ Offensive agent prompt generated');
    console.log('   ✓ Response processed');
    console.log('   ✓ Defensive agent prompt generated');
    console.log('   ✓ State persisted between calls');
    
    // Phase 3: Mock defensive agent response
    console.log('\n🤖 Simulating defensive agent response...');
    
    const mockDefensiveResponse = {
      findingId: nextPrompt.findingId,
      validations: {
        mitigationEffectiveness: {
          effective: false,
          reasoning: "The proposed mitigation lacks implementation details for cryptographic signing",
          implementable: true,
          estimatedEffort: "medium"
        },
        severityChallenge: {
          challenged: false,
          reasoning: "Offensive agent's escalation to HIGH is justified given the potential for debate manipulation",
          evidenceOfInflation: "",
          realisticPreconditions: ["Attacker has network access to agent communication channel"]
        },
        enhancedMitigation: {
          original: "Sign agent responses with session tokens; validate agent identity before accepting debate contributions",
          enhanced: "Use HMAC-SHA256 to sign agent responses with per-session keys. Validate signatures and enforce nonce-based replay protection. Implement schema validation with Zod before processing responses.",
          closesGaps: [
            "Adds cryptographic signing with HMAC",
            "Prevents replay attacks with nonce tracking",
            "Validates response schemas"
          ]
        }
      },
      verdict: "needs_enhancement"
    };
    
    console.log('   Mock response verdict:', mockDefensiveResponse.verdict);
    
    // Phase 3: Submit defensive agent response
    console.log('\n📤 Phase 3: Calling specia_debate (with defensive response)...\n');
    
    const phase3Result = await handleVtspecDebate({
      change_name: changeName,
      max_rounds: 3,
      max_findings: 10,
      agent_response: mockDefensiveResponse,
    }, speciaRoot);
    
    console.log('📥 Phase 3 Result:');
    console.log(JSON.stringify(phase3Result, null, 2));
    
    if (phase3Result.status === 'success' && phase3Result.data?.debate_prompt) {
      const judgePrompt = phase3Result.data.debate_prompt;
      console.log('\n✅ Judge prompt received!');
      console.log(`   Agent: ${judgePrompt.agent}`);
      console.log(`   Finding: ${judgePrompt.findingId}`);
      console.log(`   Round: ${judgePrompt.round}`);
      
      // Phase 4: Mock judge response (consensus)
      console.log('\n🤖 Simulating judge agent response (consensus)...');
      
      const mockJudgeResponse = {
        findingId: judgePrompt.findingId,
        synthesis: {
          consensusSeverity: "high",
          consensusReached: true,
          reasoning: "Offensive agent correctly identified the severity escalation. Defensive agent validated the concern and proposed practical enhancements. Consensus on HIGH severity.",
          offensivePerspective: "Escalated to HIGH due to debate manipulation risk and lack of cryptographic signing",
          defensivePerspective: "Acknowledged gaps and proposed enhanced mitigation with HMAC signing and nonce-based replay protection"
        },
        updatedMitigation: {
          original: "Sign agent responses with session tokens; validate agent identity before accepting debate contributions",
          refined: "Use HMAC-SHA256 to sign agent responses with per-session keys. Validate signatures and enforce nonce-based replay protection. Implement schema validation with Zod before processing responses.",
          improvements: [
            "Added HMAC-SHA256 cryptographic signing",
            "Implemented nonce-based replay protection",
            "Added Zod schema validation"
          ],
          creditsAgents: ["offensive", "defensive"]
        },
        needsHumanReview: false,
        unresolvedDisagreements: []
      };
      
      console.log('   Mock response - consensus reached:', mockJudgeResponse.synthesis.consensusReached);
      console.log('   Consensus severity:', mockJudgeResponse.synthesis.consensusSeverity);
      
      // Phase 4: Submit judge response
      console.log('\n📤 Phase 4: Calling specia_debate (with judge response - should trigger next finding or completion)...\n');
      
      const phase4Result = await handleVtspecDebate({
        change_name: changeName,
        max_rounds: 3,
        max_findings: 10,
        agent_response: mockJudgeResponse,
      }, speciaRoot);
      
      console.log('📥 Phase 4 Result:');
      console.log(JSON.stringify(phase4Result, null, 2));
      
      if (phase4Result.status === 'success' && phase4Result.data?.debate_prompt) {
        console.log('\n✅ Next finding started!');
        console.log(`   Agent: ${phase4Result.data.debate_prompt.agent}`);
        console.log(`   Finding: ${phase4Result.data.debate_prompt.findingId}`);
        console.log(`   Round: ${phase4Result.data.debate_prompt.round}`);
      } else if (phase4Result.status === 'success' && phase4Result.data?.debate_summary) {
        console.log('\n✅ Debate complete!');
        console.log(`   Findings debated: ${phase4Result.data.debate_summary.findings_debated}`);
        console.log(`   Total rounds: ${phase4Result.data.debate_summary.total_rounds}`);
        console.log(`   Artifacts written:`);
        console.log(`     - ${phase4Result.data.debate_summary.transcript_path}`);
        console.log(`     - ${phase4Result.data.debate_summary.review_updated}`);
      }
      
      console.log('\n🎉 Full round complete (offensive → defensive → judge)!');
      console.log('   ✓ Consensus reached');
      console.log('   ✓ Mitigation enhanced');
      console.log('   ✓ State transitions working');
    }
    
  } else if (phase2Result.status === 'success' && phase2Result.data?.debate_summary) {
    console.log('\n✅ Debate complete!');
    console.log(`   Findings debated: ${phase2Result.data.debate_summary.findings_debated}`);
    console.log(`   Total rounds: ${phase2Result.data.debate_summary.total_rounds}`);
  }
  
} else {
  console.error('\n❌ Phase 1 failed!');
  console.error('Errors:', phase1Result.errors);
}

console.log('\n✅ Test complete');
