# SpecIA Lite Examples

## Example 1: Quick Review of OAuth Implementation

### Scenario
You're implementing OAuth login and want a quick security check before creating a PR.

### Spec (oauth-spec.md)
```markdown
# Feature: Add OAuth Login with Google

## Requirements
1. Users can sign in with Google OAuth 2.0
2. OAuth flow uses authorization code grant
3. Tokens stored securely
4. Session created after successful auth
5. Logout invalidates session and tokens

## Implementation
- Frontend: React with redirect to /auth/google
- Backend: Express.js OAuth callback handler
- Token storage: Browser localStorage
- Session: JWT in cookie
```

### Usage
```
User: "Run specia-review-lite on oauth-spec.md"
```

### Expected Output
```markdown
## Security Review: add-oauth-login

**Risk Level**: critical

### Critical Threats

1. **Spoofing - Missing PKCE Flow**
   - Severity: critical
   - Location: OAuth flow design
   - Risk: Authorization code interception enables account takeover
   - Fix: Implement PKCE (RFC 7636) with code_challenge/code_verifier

2. **Spoofing - No State Parameter**
   - Severity: high
   - Location: auth/callback handler
   - Risk: CSRF attack allows attacker to link victim account to attacker's OAuth
   - Fix: Generate cryptographic nonce, validate in callback

3. **Information Disclosure - Tokens in localStorage**
   - Severity: critical
   - Location: frontend token storage
   - Risk: XSS vulnerability gives attacker full account access
   - Fix: Use httpOnly, Secure, SameSite=Strict cookies

4. **Elevation of Privilege - No Token Validation**
   - Severity: high
   - Location: backend JWT handling
   - Risk: Tampered or expired tokens not rejected
   - Fix: Validate JWT signature, expiry, issuer, audience

### Summary

- Total threats: 4 critical, 0 high
- Recommendation: BLOCK (must fix PKCE, state, and token storage)
```

---

## Example 2: Post-Implementation Audit

### Scenario
You implemented rate limiting. Now verify tests exist and security gaps are fixed.

### Spec (rate-limit-spec.md)
```markdown
# Feature: API Rate Limiting

## Requirements
- REQ-1: Global rate limit: 100 requests/minute per IP
- REQ-2: Per-user limit: 20 requests/minute (authenticated users)
- REQ-3: Return 429 Too Many Requests when exceeded
- REQ-4: Use Redis for distributed rate limit state
- REQ-5: Include rate limit headers (X-RateLimit-*)
```

### Review Findings (from specia-review-lite)
```markdown
### Critical Threats
1. **DoS - No per-user limits** — Users can exhaust API with multiple IPs
2. **Information Disclosure - Verbose error messages** — Rate limit errors leak internal config
```

### Code Implemented
- `src/middleware/rate-limit.ts` (rate limiting logic)
- `src/routes/api.ts` (middleware integration)
- `test/rate-limit.test.ts` (tests)

### Usage
```
User: "Run specia-audit-lite. Spec: rate-limit-spec.md. Code: src/middleware/rate-limit.ts, src/routes/api.ts. Review findings: [paste findings above]"
```

### Expected Output
```markdown
## Audit Report: add-rate-limiting

**Overall Status**: WARN

### Test Coverage

- Test files found: 1 (test/rate-limit.test.ts)
- Critical paths covered: 4/5
- Security tests: PARTIAL

**Missing tests**:
- [ ] DoS scenario: single user with multiple IPs
- [ ] Distributed rate limit state (Redis failover)

### Security Gap Status

1. **DoS - No per-user limits** — FIXED
   - Evidence: src/middleware/rate-limit.ts:67 (getUserId + per-user bucket)

2. **Verbose error messages** — FIXED
   - Evidence: src/middleware/rate-limit.ts:89 (generic 429 message, no config leak)

### Spec Compliance

| Requirement | Status | Evidence |
|-------------|--------|----------|
| REQ-1: Global 100/min | ✅ IMPLEMENTED | rate-limit.ts:34 |
| REQ-2: Per-user 20/min | ✅ IMPLEMENTED | rate-limit.ts:67 |
| REQ-3: Return 429 | ✅ IMPLEMENTED | rate-limit.ts:89 |
| REQ-4: Redis storage | ✅ IMPLEMENTED | rate-limit.ts:12 |
| REQ-5: Rate limit headers | ⚠️ PARTIAL | Only X-RateLimit-Remaining, missing Limit/Reset |

### Recommendations

- [ ] Add X-RateLimit-Limit and X-RateLimit-Reset headers (RFC 6585)
- [ ] Add test for multi-IP DoS scenario
- [ ] Document Redis failover behavior

**Verdict**: REQUEST CHANGES (minor: missing headers + test gaps)
```

---

## Example 3: PR Review (GitHub/GitLab)

### Scenario
Teammate opened PR #123 adding file upload. You want quick security check.

### Usage
```
User: "Run specia-review-lite on PR https://github.com/myorg/myapp/pull/123"
```

(You would fetch the PR diff using bash/curl/gh CLI)

### Expected Output
```markdown
## Security Review: add-file-upload (PR #123)

**Risk Level**: critical

### Critical Threats

1. **Tampering - No File Type Validation**
   - Severity: critical
   - Location: routes/upload.ts:45
   - Risk: Arbitrary file upload enables RCE via malicious executable
   - Fix: Whitelist allowed MIME types, validate with magic bytes (not extension)

2. **Tampering - Path Traversal**
   - Severity: critical
   - Location: routes/upload.ts:67
   - Risk: Filename "../../../etc/passwd" overwrites system files
   - Fix: Sanitize filename (reject path separators), use UUID for storage

3. **Denial of Service - No File Size Limit**
   - Severity: high
   - Location: upload middleware
   - Risk: Attacker uploads multi-GB files, exhausts disk
   - Fix: Enforce max file size (e.g., 10MB) in middleware

4. **Information Disclosure - Files Served Without Auth**
   - Severity: high
   - Location: routes/download.ts:23
   - Risk: Uploaded files accessible to anyone via direct URL
   - Fix: Add authentication check before serving files

### Summary

- Total threats: 2 critical, 2 high
- Recommendation: BLOCK (must fix file validation and path traversal)
```

---

## Comparison: Lite vs Full

| Metric | specia-review-lite | specia-review (full) |
|--------|----------------|------------------|
| Time | ~15 seconds | ~2 minutes |
| Tokens | ~3k | ~20k |
| Cost | ~$0.009 | ~$0.06 |
| Threats reported | Critical/High only (5-10) | All severities (20-50) |
| OWASP mapping | Mentioned if obvious | Full mapping with CWEs |
| Abuse cases | No | Yes (5-10 scenarios) |
| DREAD scoring | No | Yes |
| Output size | ~500 tokens | ~3000 tokens |

| Metric | specia-audit-lite | specia-audit (full) |
|--------|---------------|-----------------|
| Time | ~30 seconds | ~5 minutes |
| Tokens | ~6.6k | ~50k |
| Cost | ~$0.020 | ~$0.15 |
| Test execution | ❌ Static check | ✅ Runs tests |
| Build verification | ❌ No | ✅ Runs build |
| Coverage report | ❌ No | ✅ Yes (lcov) |
| Abuse case testing | ❌ No | ✅ Exploit scenarios |
| Output size | ~800 tokens | ~5000 tokens |

**When to use Lite:**
- PR reviews
- Individual dev quick checks
- Continuous security (every commit)
- Budget-constrained projects

**When to use Full:**
- Release gates
- Compliance requirements
- High-security features (auth, payment, PII)
- Need audit trail with evidence
