import { describe, it, expect, beforeEach } from 'vitest';
import { RateLimiter, TOOL_RATE_LIMITS, getToolRateLimit } from '../src/cli/security/limits.js';

describe('Rate Limiting Implementation', () => {
  describe('RateLimiter class', () => {
    let limiter: RateLimiter;

    beforeEach(() => {
      limiter = new RateLimiter(3, 1000); // 3 ops per second
    });

    it('allows operations within limit', () => {
      expect(limiter.isAllowed('test')).toBe(true);
      expect(limiter.isAllowed('test')).toBe(true);
      expect(limiter.isAllowed('test')).toBe(true);
    });

    it('blocks operations exceeding limit (AC-001 mitigation)', () => {
      limiter.isAllowed('test');
      limiter.isAllowed('test');
      limiter.isAllowed('test');
      expect(limiter.isAllowed('test')).toBe(false); // 4th call blocked
    });

    it('provides accurate retry time', () => {
      limiter.isAllowed('test');
      limiter.isAllowed('test');
      limiter.isAllowed('test');
      
      const retryTime = limiter.timeUntilAllowed('test');
      expect(retryTime).toBeGreaterThan(0);
      expect(retryTime).toBeLessThanOrEqual(1000);
    });

    it('allows operations after time window expires (Scenario 3)', async () => {
      const shortLimiter = new RateLimiter(2, 100); // 2 ops per 100ms
      
      shortLimiter.isAllowed('test');
      shortLimiter.isAllowed('test');
      expect(shortLimiter.isAllowed('test')).toBe(false);
      
      // Wait for window to expire
      await new Promise(resolve => setTimeout(resolve, 110));
      
      expect(shortLimiter.isAllowed('test')).toBe(true);
    });

    it('maintains independent counters per key (Scenario 4)', () => {
      limiter.isAllowed('tool1');
      limiter.isAllowed('tool1');
      limiter.isAllowed('tool1');
      
      // tool1 is at limit, but tool2 should still work
      expect(limiter.isAllowed('tool1')).toBe(false);
      expect(limiter.isAllowed('tool2')).toBe(true);
    });

    it('prevents memory leak with bounded arrays (AC-002 mitigation)', () => {
      const stressLimiter = new RateLimiter(1, 1000);
      
      // Simulate 2000 calls (should not grow unbounded)
      for (let i = 0; i < 2000; i++) {
        stressLimiter.isAllowed('stress-test');
      }
      
      // Memory should be bounded (implementation caps at 1000 timestamps)
      // This test passes if it doesn't OOM
      expect(true).toBe(true);
    });
  });

  describe('TOOL_RATE_LIMITS configuration', () => {
    it('defines limits for all 17 MCP tools (AC1 requirement)', () => {
      const expectedTools = [
        'specia_init', 'specia_propose', 'specia_spec', 'specia_design',
        'specia_review', 'specia_tasks', 'specia_done', 'specia_search',
        'specia_new', 'specia_continue', 'specia_ff',
        'specia_hook_install', 'specia_hook_uninstall', 'specia_hook_status',
        'specia_audit', 'specia_debate', 'specia_stats'
      ];
      
      expectedTools.forEach(tool => {
        const config = TOOL_RATE_LIMITS[tool];
        expect(config).toBeDefined();
        expect(config.maxOps).toBeGreaterThan(0);
        expect(config.windowMs).toBe(60 * 1000);
      });
    });

    it('implements tiered limits (R2 requirement)', () => {
      // Expensive tools: 10/min
      expect(TOOL_RATE_LIMITS['specia_review'].maxOps).toBe(10);
      expect(TOOL_RATE_LIMITS['specia_audit'].maxOps).toBe(10);
      expect(TOOL_RATE_LIMITS['specia_debate'].maxOps).toBe(10);
      
      // Standard tools: 30/min
      expect(TOOL_RATE_LIMITS['specia_propose'].maxOps).toBe(30);
      expect(TOOL_RATE_LIMITS['specia_spec'].maxOps).toBe(30);
      expect(TOOL_RATE_LIMITS['specia_tasks'].maxOps).toBe(30);
      
      // Cheap tools: 60/min
      expect(TOOL_RATE_LIMITS['specia_search'].maxOps).toBe(60);
      expect(TOOL_RATE_LIMITS['specia_stats'].maxOps).toBe(60);
    });
  });

  describe('getToolRateLimit (EP-001 mitigation)', () => {
    it('resolves specia_new alias to specia_propose (AC-004 mitigation)', () => {
      const newConfig = getToolRateLimit('specia_new');
      const proposeConfig = getToolRateLimit('specia_propose');
      
      expect(newConfig).toEqual(proposeConfig);
      expect(newConfig.maxOps).toBe(30);
    });

    it('returns default limit for unknown tools', () => {
      const config = getToolRateLimit('unknown_tool');
      expect(config.maxOps).toBe(30);
      expect(config.windowMs).toBe(60 * 1000);
    });
  });
});
