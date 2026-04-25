---
name: specia-audit-lite
description: >
  SpecIA LITE: Quick post-implementation audit (static checks only, no test execution).
  Use for: PR reviews, quick validation, individual devs, fast feedback.
  NOT for: Compliance, dynamic testing, coverage reports, abuse case testing.
  Trigger: "lite audit", "quick audit", "PR audit", "specia-audit-lite".
license: MIT
metadata:
  author: mroldan
  version: "1.0"
  edition: "lite"
  time: ~30s
---

## Purpose

Perform a **quick post-implementation audit** to verify:
1. Tests exist and cover critical paths
2. Security gaps from review (if any) are addressed
3. Code matches the spec (basic sanity check)

This is the lightweight version of SpecIA audit — NO dynamic test execution (you won't run `npm test`), NO deep code analysis, just fast verification.

## When to Use

- PR review before merge
- Self-check after implementing a feature
- Quick validation that security issues are fixed
- You have a spec + implementation (not using SpecIA workflow)

## Input

You need:
- **Spec** (markdown file or content) — what was supposed to be built
- **Code** (file paths or PR diff) — what was actually built
- **Review findings** (optional) — if you ran specia-review-lite, pass those threats

## Audit Protocol

### 1. Read Spec and Code

Use Read or Grep tools to load:
- Spec file (requirements, acceptance criteria)
- Implementation files (code that implements the spec)
- Test files (if they exist)

### 2. Static Test Verification

Check for test files:
```bash
# Look for test files related to the feature
ls test/*feature-name* __tests__/*feature-name* *.test.* *.spec.*
```

For each test file:
- Does it exist? (PASS/FAIL)
- Does it cover critical paths from spec? (basic grep check)
- Does it test security controls (auth, input validation, etc.)? (grep for keywords)

**DO NOT execute tests** — just verify they exist and appear relevant.

### 3. Gap Analysis

If you have review findings (from specia-review-lite), check if they're addressed:

For each critical/high threat:
- Search code for the mitigation (e.g., grep for "PKCE", "state validation", "httpOnly")
- PASS if found + looks correct
- FAIL if missing or incomplete

### 4. Spec Compliance (Basic)

For each requirement in the spec:
- Search code for evidence of implementation (grep for key terms)
- Mark as: IMPLEMENTED | PARTIAL | MISSING

### 5. Output Format

Return a concise report (max 800 tokens):

```markdown
---
🚀 SpecIA LITE Audit | ~30s | Static Checks Only
Edition: Lite | No test execution | No coverage report | No abuse case testing
For dynamic audit with test execution, use SpecIA Full workflow instead
---

## Audit Report: {feature-name}

**Overall Status**: [PASS|FAIL|WARN]

### Test Coverage

- Test files found: X
- Critical paths covered: Y/Z
- Security tests: [YES|NO|PARTIAL]

**Missing tests**:
- [ ] {test case 1}
- [ ] {test case 2}

### Security Gap Status

1. **[Threat from review]** — [FIXED|MISSING|PARTIAL]
   - Evidence: {file:line where mitigation found, or "NOT FOUND"}

### Spec Compliance

| Requirement | Status | Evidence |
|-------------|--------|----------|
| REQ-1: {summary} | ✅ IMPLEMENTED | {file:line} |
| REQ-2: {summary} | ⚠️ PARTIAL | {reason} |
| REQ-3: {summary} | ❌ MISSING | N/A |

### Recommendations

- [ ] {action item 1}
- [ ] {action item 2}

**Verdict**: [APPROVE|REQUEST CHANGES|BLOCK]
```

### 6. Token Budget

- Max output: 800 tokens
- Max requirements checked: 10
- Max security gaps checked: 5
- No deep code analysis (just grep/search)
- No test execution (static check only)

## Example

**Input**:
- Spec: "Add rate limiting to API endpoints"
- Code: `src/middleware/rate-limit.ts`, `src/routes/api.ts`
- Review findings: 
  - "Missing per-user limits (DoS risk)"
  - "No rate limit headers (RFC compliance)"

**Output**:

```markdown
## Audit Report: add-rate-limiting

**Overall Status**: WARN

### Test Coverage

- Test files found: 1 (test/rate-limit.test.ts)
- Critical paths covered: 3/5
- Security tests: PARTIAL

**Missing tests**:
- [ ] Rate limit bypass with multiple IPs
- [ ] Distributed DoS scenario

### Security Gap Status

1. **Missing per-user limits** — FIXED
   - Evidence: src/middleware/rate-limit.ts:45 (userIdExtractor + per-user bucket)

2. **No rate limit headers** — MISSING
   - Evidence: NOT FOUND (need X-RateLimit-Limit, X-RateLimit-Remaining headers)

### Spec Compliance

| Requirement | Status | Evidence |
|-------------|--------|----------|
| REQ-1: Global rate limit 100 req/min | ✅ IMPLEMENTED | rate-limit.ts:23 |
| REQ-2: Per-user limit 20 req/min | ✅ IMPLEMENTED | rate-limit.ts:45 |
| REQ-3: Redis-based storage | ✅ IMPLEMENTED | rate-limit.ts:12 |
| REQ-4: Return 429 on exceed | ✅ IMPLEMENTED | rate-limit.ts:67 |
| REQ-5: Rate limit headers | ❌ MISSING | N/A |

### Recommendations

- [ ] Add X-RateLimit-* headers (RFC 6585 compliance)
- [ ] Add tests for bypass scenarios

**Verdict**: REQUEST CHANGES (missing headers, incomplete tests)
```

## What NOT to Do

- ❌ Don't run `npm test` or execute code
- ❌ Don't do deep static analysis (AST parsing, control flow)
- ❌ Don't call MCP tools (no specia commands)
- ❌ Don't save to Alejandría
- ❌ Don't create .specia/ artifacts
- ❌ Don't analyze code style or refactoring opportunities

## What to Do

- ✅ Verify test files exist and look relevant (grep check)
- ✅ Check security mitigations are present in code (grep for keywords)
- ✅ Match spec requirements to code (basic evidence search)
- ✅ Give clear APPROVE/REQUEST CHANGES/BLOCK verdict
- ✅ List specific missing items as checkboxes

## Integration with Full SpecIA

If the user wants full audit with dynamic test execution:
1. Use full SpecIA workflow (`/specia-audit`)
2. Full audit will execute tests, run builds, deep static analysis

But for now, you're just doing a quick static check.

## Comparison: Lite vs Full

| Feature | specia-audit-lite | specia-audit (full) |
|---------|---------------|-----------------|
| Test execution | ❌ Static check only | ✅ Runs `npm test` |
| Coverage report | ❌ No | ✅ Yes (lcov/istanbul) |
| Build verification | ❌ No | ✅ Runs `npm run build` |
| Abuse case testing | ❌ No | ✅ Yes (exploit scenarios) |
| Time | ~30 seconds | ~5 minutes |

Choose **lite** for quick PR checks. Choose **full** for release gates.
