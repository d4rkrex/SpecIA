---
name: specia-audit
description: >
  Post-implementation audit with DYNAMIC verification (tests + build) and STATIC analysis.
  Proves with real execution that security mitigations work and spec requirements are satisfied.
  Trigger: When user says "specia-audit", "audit code", "verify implementation".
license: MIT
metadata:
  author: mroldan
  version: "2.0"
---

## Purpose

POST-IMPLEMENTATION AUDIT with REAL EXECUTION EVIDENCE.

Prove:
1. Implementation complete and correct
2. Security mitigations work (abuse cases blocked)
3. Spec requirements satisfied (tests pass)

**Static + Dynamic**: Code review AND test execution.

## Read SpecIA Artifacts

From `.specia/changes/{change-name}/`:
1. `spec.md` — Requirements, scenarios
2. `review.md` — Security findings, abuse cases
3. `tasks.md` — Should be all [x]
4. `design.md` (if exists)
5. `.specia/config.yaml` — Test/build commands

## Audit Steps

### 1. Completeness
```
- Total tasks: {N} ({M} func + {K} sec)
- Complete: {X}
- Incomplete: {Y}
Flag: CRITICAL if ANY incomplete
```

### 2. Static Analysis

**Security mitigations:**
```
FOR EACH THREAT in review.md:
- Search code for mitigation
- Verify Threat ID in comments
- Check matches exact mitigation
Flag: CRITICAL if missing/weakened
```

**Spec requirements:**
```
FOR EACH REQUIREMENT:
- Search for implementation
- Check Given/When/Then
Flag: WARNING (will verify with tests)
```

### 3. Test Execution (DYNAMIC!)

**Detect test command:**
```
.specia/config.yaml → conventions.test_command
OR package.json → scripts.test
OR pytest.ini / pyproject.toml
```

**Execute:**
```bash
{test_command}

Capture:
- Exit code
- Passed/Failed/Skipped counts
- Failed test names + errors
```

**Flag:**
- CRITICAL if exit code != 0
- WARNING if no tests found

### 4. Build Execution (DYNAMIC!)

**Detect:**
```
.specia/config.yaml → conventions.build_command
OR package.json → scripts.build
OR python -m build
```

**Execute:**
```bash
{build_command}

Capture:
- Exit code
- Type errors
- Compilation errors
```

**Flag:** CRITICAL if fails

### 5. Spec Compliance Matrix (DYNAMIC!)

```
FOR EACH REQUIREMENT + SCENARIO:
- Find test covering it
- Check test PASSED
- Status: COMPLIANT | FAILING | UNTESTED

Output:
| Requirement | Scenario | Test | Result | Status |
| REQ-001 | Valid token | test_jwt_valid | ✅ PASSED | ✅ COMPLIANT |
| REQ-002 | Rate limit | test_rate_limit | ❌ FAILED | ❌ FAILING |
```

### 6. Abuse Case Verification (SECURITY CRITICAL!)

```
FOR EACH ABUSE CASE in review.md:
- Find test attempting attack
- Check test PASSED (attack blocked)
- Status: MITIGATED | VULNERABLE | UNTESTED

Output:
| Abuse Case | Test | Result | Status |
| XSS Token Theft | test_xss_blocked | ✅ PASSED | ✅ MITIGATED |
| Token Replay | test_replay_blocked | ❌ FAILED | ❌ VULNERABLE |
| CSRF | - | - | ❌ UNTESTED |
```

**CRITICAL**: VULNERABLE or UNTESTED in elevated/paranoid = FAIL

### 7. Coverage (if configured)

```
IF .specia/config.yaml has coverage_threshold:
- Run: {test_command} --coverage
- Compare vs threshold
- Report changed files coverage
Flag: WARNING if below
```

### 8. Save to Alejandría

```
alejandria_mem_store(
  content: "# Audit: {name}\n\nVerdict: {PASS|FAIL}\n\nTests: {N}/{M} passed\nAbuse cases: {X}/{Y} mitigated\n\nFull: .specia/changes/{name}/audit.md",
  summary: "SpecIA {name}: {verdict}, {N} tests, {X} mitigations",
  topic_key: "specia/{name}/audit"
)
```

## Return Report

```markdown
## SpecIA Audit

**Change**: {name}
**Verdict**: {✅ PASS | ❌ FAIL | ⚠️ PARTIAL}

### Execution Results
- Tests: {N} passed, {M} failed
- Build: {PASS | FAIL}
- Coverage: {X}%

### Spec Compliance
{N}/{total} scenarios COMPLIANT
{List FAILING/UNTESTED}

### Abuse Case Verification
{X}/{total} abuse cases MITIGATED
{List VULNERABLE/UNTESTED}

### Critical Issues
{If any}

### Recommendations
{List}

### Next Steps
{specia done | fix issues}
```

## Rules

- Tests MANDATORY — failing/missing = FAIL
- Abuse case tests CRITICAL — vulnerable/untested in elevated = BLOCKING
- Build must pass
- Execute tests, don't just check existence
- Spec compliance requires passing tests
- Save to Alejandría

## Anti-Patterns

❌ Skip test execution
❌ Accept failed tests
❌ Ignore untested abuse cases
❌ Mark PASS without running tests
