#!/usr/bin/env node
/**
 * Test Memory Adapter detection and fallback.
 */

import { MemoryAdapter } from '../../dist/integrations/memory-adapter.js';

console.log('🧪 Testing Memory Adapter\n');

const memory = await MemoryAdapter.getInstance();
const backend = memory.getBackend();

console.log(`✅ Detected backend: ${backend}`);

// Test search (will return empty for now, but shouldn't crash)
const { reviews, backend: searchBackend } = await memory.searchReviews({
  stack: 'typescript',
  securityPosture: 'standard',
  limit: 5,
});

console.log(`✅ Search executed via: ${searchBackend}`);
console.log(`   Reviews found: ${reviews.length}`);

if (backend === searchBackend) {
  console.log(`\n✅ Backend consistency: ${backend} used for both detection and search`);
} else {
  console.error(`\n❌ Backend mismatch: detected ${backend} but search used ${searchBackend}`);
  process.exit(1);
}

// Test learnings extraction (with empty reviews)
const learnings = memory.extractLearnings(reviews);
console.log(`✅ Learnings extraction: ${learnings.length} items`);

// Test common patterns (with empty reviews)
const patterns = memory.getCommonPatterns(reviews);
console.log(`✅ Pattern detection: ${patterns.size} patterns`);

console.log('\n🎉 Memory Adapter working correctly!\n');

console.log('📋 Summary:');
console.log(`   Backend: ${backend}`);
console.log(`   Alejandría: ${backend === 'alejandria' ? '✅ Available' : '❌ Not detected'}`);
console.log(`   Colmena: ${backend === 'colmena' ? '✅ Available' : '❌ Not detected'}`);
console.log(`   Engram: ${backend === 'engram' ? '✅ Fallback active' : '⚠️  Not used'}`);
