/**
 * Guardian Layer 4 Benchmarks — Performance validation.
 *
 * Verifies that Layer 4 meets the <2s target for typical commits.
 * Measures cache impact on performance.
 *
 * Run: npx vitest bench --run
 *
 * v0.4: Performance benchmarks for guardian-spec-aware
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { FileStore } from "../../src/services/store.js";
import { GuardianService } from "../../src/services/guardian.js";
import type { GuardianConfig } from "../../src/types/index.js";

describe("Guardian Layer 4 Benchmarks", () => {
  let testRoot: string;
  let store: FileStore;
  let guardian: GuardianService;

  beforeAll(() => {
    testRoot = fs.mkdtempSync(path.join(__dirname, "tmp-guardian-bench-"));
    store = new FileStore(testRoot);

    // Initialize SpecIA
    store.writeConfig({
      version: "1.0",
      project: {
        name: "bench-project",
        description: "Benchmark project",
        stack: "Node.js",
        conventions: [],
      },
      security: { posture: "standard" },
      memory: { backend: "local" },
      guardian: {
        enabled: true,
        mode: "warn",
        exclude: [],
        validation: {
          require_spec: true,
          require_review: true,
          require_mitigations: true,
        },
        spec_validation: {
          enabled: true,
          enable_llm: false, // Heuristics-only for benchmarking
          heuristic_threshold: 0.5,
          cache_ttl: 168,
        },
      },
    });

    guardian = new GuardianService(testRoot, store);

    // Create a sample change
    const changePath = path.join(testRoot, ".specia", "changes", "bench-change");
    fs.mkdirSync(changePath, { recursive: true });

    fs.writeFileSync(
      path.join(changePath, "proposal.md"),
      "# Proposal\n\nScope:\n- src/auth.ts\n- src/user.ts\n- src/api.ts",
    );

    fs.writeFileSync(
      path.join(changePath, "spec.md"),
      `# Spec

## Requirements

### REQ-1: Authentication
**Description**: Implement JWT authentication.

**Scenarios**:
- GIVEN valid credentials, WHEN user logs in, THEN JWT is issued
- GIVEN invalid credentials, WHEN user logs in, THEN error is returned

### REQ-2: Authorization
**Description**: Role-based access control.

**Scenarios**:
- GIVEN admin role, WHEN accessing admin panel, THEN access granted
- GIVEN user role, WHEN accessing admin panel, THEN access denied

### REQ-3: Data validation
**Description**: All user input must be validated.

**Scenarios**:
- GIVEN malformed input, WHEN processing request, THEN error is returned
`,
    );

    fs.writeFileSync(
      path.join(changePath, "review.md"),
      "# Review\n\nThreats analyzed. Mitigations proposed.",
    );

    fs.writeFileSync(
      path.join(changePath, "tasks.md"),
      "# Tasks\n\nImplementation complete.",
    );

    fs.writeFileSync(
      path.join(changePath, "state.yaml"),
      "phase: tasks\nspec_hash: abc123",
    );

    // Create sample files
    const files = [
      "src/auth.ts",
      "src/user.ts",
      "src/api.ts",
      "src/utils.ts",
      "src/db.ts",
    ];

    for (const file of files) {
      const filePath = path.join(testRoot, file);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(
        filePath,
        `
// Sample TypeScript file
import jwt from 'jsonwebtoken';

export function validateToken(token: string): boolean {
  return jwt.verify(token, process.env.JWT_SECRET!) !== null;
}

export function hashPassword(password: string): string {
  // Implementation
  return password;
}

export function authorizeUser(role: string): boolean {
  return role === 'admin';
}
`,
      );
    }
  });

  afterAll(() => {
    if (testRoot && fs.existsSync(testRoot)) {
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it("Benchmark: 5 files, heuristics-only, <2s target", async () => {
    const config: GuardianConfig = {
      enabled: true,
      mode: "warn",
      exclude: [],
      validation: {
        require_spec: true,
        require_review: true,
        require_mitigations: true,
      },
      spec_validation: {
        enabled: true,
        enable_llm: false,
        heuristic_threshold: 0.5,
      },
    };

    const files = [
      "src/auth.ts",
      "src/user.ts",
      "src/api.ts",
      "src/utils.ts",
      "src/db.ts",
    ];

    const start = Date.now();
    const result = await guardian.validateStagedFiles(files, config);
    const duration = Date.now() - start;

    expect(result.results).toHaveLength(5);
    expect(duration).toBeLessThan(2000); // <2s target

    console.log(`✓ Validated 5 files in ${duration}ms (target: <2000ms)`);
  });

  it("Benchmark: cache hit performance boost", async () => {
    const config: GuardianConfig = {
      enabled: true,
      mode: "warn",
      exclude: [],
      validation: {
        require_spec: true,
        require_review: true,
        require_mitigations: true,
      },
      spec_validation: {
        enabled: true,
        enable_llm: false,
        heuristic_threshold: 0.5,
      },
    };

    const files = ["src/auth.ts", "src/user.ts", "src/api.ts"];

    // First run (cold cache)
    const start1 = Date.now();
    await guardian.validateStagedFiles(files, config);
    const duration1 = Date.now() - start1;

    // Second run (warm cache)
    const start2 = Date.now();
    await guardian.validateStagedFiles(files, config);
    const duration2 = Date.now() - start2;

    expect(duration2).toBeLessThan(duration1 * 0.5); // Cache should be 2x+ faster

    console.log(`✓ Cold cache: ${duration1}ms, Warm cache: ${duration2}ms`);
    console.log(`  Cache speedup: ${((duration1 / duration2) * 100).toFixed(0)}%`);
  });
});
