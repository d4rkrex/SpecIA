# SpecIA Lite vs Full: Detailed Comparison

## Executive Summary

SpecIA comes in two editions optimized for different use cases:

- **Lite**: Quick security checks (review + audit), zero dependencies, minimal setup
- **Full**: Complete spec-driven workflow with state persistence, MCP server, and audit trail

## Feature Comparison Matrix

| Feature | Lite | Full | Notes |
|---------|------|------|-------|
| **Installation** | 2 skills | 7 skills + MCP server | Lite: <1 min, Full: ~5 min |
| **Dependencies** | None | Node.js 20+, npm | Lite works with just AI editor |
| **State Persistence** | ❌ None | ✅ .specia/ + Alejandría | Full survives context compaction |
| **MCP Server** | ❌ No | ✅ Optional | Full can use CLI or MCP |
| **Memory Integration** | ❌ No | ✅ Alejandría/Engram | Full learns across sessions |
| **Workflow Phases** | 2 (review, audit) | 8 (init→done) | Lite is subset of Full |

## Security Analysis Depth

### Review (STRIDE Analysis)

| Aspect | Lite | Full |
|--------|------|------|
| **Threats Reported** | Critical/High only | All severities |
| **STRIDE Coverage** | Light (exploitable only) | Complete (6 categories) |
| **OWASP Mapping** | Mentioned if obvious | Full mapping + CWEs |
| **DREAD Scoring** | ❌ No | ✅ Yes (Risk × Likelihood) |
| **Abuse Cases** | ❌ No | ✅ Yes (5-10 scenarios) |
| **Mitigations** | 1-sentence fix | Detailed remediation |
| **Output Size** | ~500 tokens | ~3000 tokens |
| **Analysis Time** | ~15 seconds | ~2 minutes |

**Example: Lite Review**
```markdown
### Critical Threats

1. **Spoofing - Missing PKCE Flow**
   - Severity: critical
   - Location: OAuth flow design
   - Risk: Authorization code interception
   - Fix: Implement PKCE (RFC 7636)
```

**Example: Full Review**
```markdown
### Threat T-001: Authorization Code Interception

**Category**: Spoofing (STRIDE)  
**Severity**: Critical  
**CVSS**: 9.1 (AV:N/AC:L/PR:N/UI:R/S:C/C:H/I:H/A:N)  
**OWASP**: A07:2021 - Identification and Authentication Failures  
**CWE**: CWE-306 (Missing Authentication)

**DREAD Score**: 9.0 (Damage:9, Reproducibility:10, Exploitability:9, Affected Users:8, Discoverability:9)

**Description**:  
OAuth 2.0 authorization code grant without PKCE is vulnerable to code interception attacks. An attacker with a malicious app on the same device can intercept the authorization code during redirect and exchange it for tokens.

**Attack Vector**:
1. Victim initiates OAuth flow in legitimate app
2. Attacker's malicious app registers same redirect URI
3. OS presents app chooser, user accidentally selects malicious app
4. Malicious app receives authorization code
5. Attacker exchanges code for access token before legitimate app
6. Full account takeover

**Preconditions**:
- Victim has malicious app installed
- Both apps register same custom URI scheme
- No PKCE implementation

**Mitigation**:
1. Implement PKCE (RFC 7636):
   - Generate code_verifier (random string)
   - Derive code_challenge = SHA256(code_verifier)
   - Send code_challenge in authorization request
   - Send code_verifier in token exchange
   - Authorization server validates match
2. Use claimed HTTPS redirect URIs (web only)
3. Implement state parameter for CSRF protection
4. Short-lived authorization codes (60 seconds max)

**References**:
- RFC 7636: https://tools.ietf.org/html/rfc7636
- OAuth 2.0 for Native Apps: https://tools.ietf.org/html/rfc8252
```

### Audit (Post-Implementation)

| Aspect | Lite | Full |
|--------|------|------|
| **Test Verification** | Static (files exist) | Dynamic (runs tests) |
| **Build Verification** | ❌ No | ✅ Runs build |
| **Coverage Report** | ❌ No | ✅ Yes (lcov/istanbul) |
| **Code Analysis** | Basic grep | Deep static analysis |
| **Abuse Case Testing** | ❌ No | ✅ Exploit scenarios |
| **Evidence Collection** | File paths | Execution logs |
| **Output Size** | ~800 tokens | ~5000 tokens |
| **Analysis Time** | ~30 seconds | ~5 minutes |

**Example: Lite Audit**
```markdown
### Test Coverage

- Test files found: 1 (test/oauth.test.ts)
- Critical paths covered: 3/5
- Security tests: PARTIAL

**Missing tests**:
- [ ] PKCE code_verifier validation
- [ ] State parameter CSRF protection
```

**Example: Full Audit**
```markdown
### Test Execution Results

**Command**: `npm test -- oauth`  
**Exit Code**: 0 (PASS)  
**Duration**: 4.2s  
**Tests**: 15 run, 15 passed, 0 failed

**Coverage** (oauth.ts):
- Line Coverage: 94% (47/50)
- Branch Coverage: 87% (13/15)
- Function Coverage: 100% (8/8)

**Missing Coverage**:
- Line 67: Error handler for invalid state parameter
- Line 89: Token refresh edge case
- Branch: PKCE validation failure path

### Abuse Case Testing

**AC-001: PKCE Bypass Attempt**  
**Attacker Goal**: Exchange authorization code without code_verifier  
**Test**: `npm test -- test/exploits/pkce-bypass.test.ts`  
**Result**: ✅ BLOCKED (server rejected token exchange)  
**Evidence**:
```
Error: invalid_grant
Description: code_verifier does not match code_challenge
HTTP 400
```

**AC-002: State Parameter CSRF**  
**Attacker Goal**: Link victim account to attacker's OAuth  
**Test**: `npm test -- test/exploits/csrf-state.test.ts`  
**Result**: ✅ BLOCKED (state mismatch detected)  
**Evidence**:
```
Error: Invalid state parameter
Expected: a7b9c8d1e2f3...
Received: attacker_controlled_value
HTTP 403
```
```

## Workflow Comparison

### SpecIA Lite Workflow

```
User creates spec (informal markdown)
  ↓
Run specia-review-lite → Get critical threats (~15s)
  ↓
Implement fixes
  ↓
Run specia-audit-lite → Verify gaps fixed (~30s)
  ↓
Merge PR
```

**Total time**: ~1 minute  
**Artifacts**: None (inline output only)

### SpecIA Full Workflow

```
specia init → Initialize project
  ↓
specia new {change} → Create change
  ↓
specia-explore → Security-focused investigation (auto-triggered)
  ↓
specia-propose → Write proposal
  ↓
specia → Write structured specs
  ↓
specia-review → STRIDE + OWASP + abuse cases (MANDATORY)
  ↓
specia-tasks → Generate implementation tasks + security mitigations
  ↓
specia-apply → Implement code
  ↓
specia-audit → Verify implementation + run tests (MANDATORY)
  ↓
specia done → Archive change
```

**Total time**: ~10 minutes  
**Artifacts**: 10+ files in `.specia/changes/{name}/`, archived to `.specia/specs/`

## Use Case Decision Tree

```
Do you need compliance audit trail?
├─ YES → Use Full
└─ NO
    ├─ Is this a high-security feature (auth, payment, PII)?
    │   ├─ YES → Use Full
    │   └─ NO
    │       ├─ Do you need dynamic test execution and abuse case testing?
    │       │   ├─ YES → Use Full (more thorough)
    │       │   └─ NO → Use Lite
    │       └─ Is this a quick PR review?
    │           ├─ YES → Use Lite
    │           └─ NO → Use Full
```

## When to Use Lite

✅ **Perfect for:**
- PR security reviews
- Individual developer quick checks
- Continuous security (every commit)
- Rapid iteration and prototyping
- Early development stages
- You already have specs (not using SpecIA workflow)
- Quick validation of critical threats only

❌ **NOT suitable for:**
- Compliance requirements (SOC 2, PCI-DSS, HIPAA)
- Release gates for production
- High-security features (auth, payment, crypto)
- Need audit trail with evidence
- Need dynamic test execution

## When to Use Full

✅ **Perfect for:**
- Release gates for production
- Compliance-driven development
- High-security features (auth, payment, PII)
- Need state persistence across sessions
- Need abuse case testing (exploit scenarios)
- Need dynamic verification (runs tests)
- Learning across sessions (Alejandría memory)

❌ **Overkill for:**
- Quick PR checks
- Prototyping
- Low-risk features (UI changes, docs)
- Individual developer quick validation

## Migration Path

### Start with Lite, upgrade to Full when needed

1. **Phase 1: Lite for all PRs**
   - Install SpecIA Lite
   - Run specia-review-lite on every feature spec
   - Run specia-audit-lite before merging
   - Get quick feedback on critical threats

2. **Phase 2: Full for critical features**
   - Install SpecIA Full
   - Use Lite for routine features
   - Use Full for auth, payment, PII features
   - Lite provides speed, Full provides depth

3. **Phase 3: Full for everything (compliance mode)**
   - Migrate all new features to Full workflow
   - Keep Lite for quick checks
   - Use Lite findings as input to Full review
   - Full audit trail for all production code

### Hybrid Workflow

You can use BOTH editions in the same project:

- **Lite for PR reviews**: Fast security check before review
- **Full for release gates**: Complete analysis before production

Example:
```bash
# Developer creates PR
specia-review-lite spec.md  # Quick check (~15s)
specia-audit-lite spec.md src/  # Verify implementation (~30s)

# Before release (weekly sprint review)
cd specia/full
specia new release-sprint-42
specia continue  # Full workflow (~10min)
specia done
```

## Summary

| Metric | Lite | Full | Winner |
|--------|------|------|--------|
| **Setup Time** | <1 min | ~5 min | Lite |
| **Execution Time** | ~45s | ~10 min | Lite |
| **Dependencies** | None | Node.js 20+ | Lite (zero deps) |
| **Threat Coverage** | Critical/High only | All severities | Full |
| **Test Execution** | ❌ Static | ✅ Dynamic | Full |
| **Abuse Cases** | ❌ No | ✅ Yes | Full |
| **State Persistence** | ❌ No | ✅ Yes | Full |
| **Compliance Audit** | ❌ No | ✅ Yes | Full |
| **Learning (Memory)** | ❌ No | ✅ Yes | Full |

**Recommendation**: Use Lite for rapid iteration and PR reviews (80% of features), upgrade to Full for critical features and compliance requirements (20%).
