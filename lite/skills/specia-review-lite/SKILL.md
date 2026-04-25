---
name: specia-review-lite
description: >
  SpecIA LITE: Quick security review (STRIDE critical/high only).
  Use for: PR reviews, quick checks, individual devs, fast feedback.
  NOT for: Compliance, high-security features (auth/payment/PII), audit trails.
  Trigger: "lite review", "quick security check", "PR review", "specia-review-lite".
license: MIT
metadata:
  author: mroldan
  version: "1.0"
  edition: "lite"
  time: ~15s
---

## Purpose

Perform a **quick security check** on a specification or code change using STRIDE methodology, focusing ONLY on critical/high severity threats.

This is the lightweight version of SpecIA review — NO state persistence, NO MCP server, NO Alejandría. Just fast security analysis.

## When to Use

- PR security review
- Individual developer working on a feature
- Quick sanity check before implementation
- You have your own spec (not using SpecIA workflow)

## Input

You need ONE of these:
- Path to spec file (markdown, text, or code)
- Spec content directly in the prompt
- GitHub/GitLab PR URL (you'll fetch the diff)

## Analysis Protocol

### 1. Read the Spec/Code

Use Read tool or fetch the content.

### 2. STRIDE Analysis (Critical Only)

Analyze for these threats ONLY if they are **HIGH or CRITICAL severity**:

| STRIDE Category | Check For |
|-----------------|-----------|
| **S**poofing | Auth bypass, credential theft, session hijacking |
| **T**ampering | Input injection (SQL, XSS, Command), data manipulation |
| **R**epudiation | Missing audit logs for critical operations |
| **I**nformation Disclosure | Secrets in code, PII leaks, verbose errors |
| **D**enial of Service | Resource exhaustion, algorithmic complexity attacks |
| **E**levation of Privilege | Broken access control, insecure defaults |

**Skip threats that are LOW or MEDIUM** — this is a quick check, not exhaustive audit.

### 3. Output Format

Return a concise report (max 500 tokens):

```markdown
---
🚀 SpecIA LITE Review | ~15s | Critical/High Only
Edition: Lite | No abuse cases | No DREAD scoring | No audit trail
For compliance review, use SpecIA Full workflow instead
---

## Security Review: {feature-name}

**Risk Level**: [low|medium|high|critical]

### Critical Threats

1. **[STRIDE Category] - [Threat Name]**
   - Severity: [high|critical]
   - Location: [file:line or component]
   - Risk: [1-2 sentence description]
   - Fix: [1 sentence mitigation]

2. **[Category] - [Threat]**
   ...

### Summary

- Total threats: X critical, Y high
- Recommendation: [BLOCK|WARN|PASS]
```

### 4. Token Budget

- Max output: 500 tokens
- Max threats reported: 10
- No detailed OWASP mapping (just mention category if obvious)
- No DREAD scoring
- No abuse cases

## Example

**Input**: Spec for "Add OAuth login with Google"

**Output**:

```markdown
## Security Review: add-oauth-login

**Risk Level**: high

### Critical Threats

1. **Spoofing - Missing PKCE Flow**
   - Severity: critical
   - Location: auth/oauth.ts
   - Risk: Authorization code can be intercepted and replayed without PKCE
   - Fix: Implement PKCE (code_challenge, code_verifier)

2. **Tampering - No State Parameter Validation**
   - Severity: high
   - Location: auth/callback handler
   - Risk: CSRF attack can trick user into linking attacker's OAuth account
   - Fix: Generate cryptographic state token, validate on callback

3. **Information Disclosure - Tokens in Browser Storage**
   - Severity: high
   - Location: frontend/auth.js
   - Risk: Access tokens in localStorage vulnerable to XSS
   - Fix: Use httpOnly cookies for tokens

### Summary

- Total threats: 3 critical, 0 high
- Recommendation: BLOCK (must fix PKCE and state validation before merge)
```

## What NOT to Do

- ❌ Don't write full threat model
- ❌ Don't generate abuse cases (that's specia-audit-lite's job)
- ❌ Don't call MCP tools (no specia commands)
- ❌ Don't save to Alejandría
- ❌ Don't create .specia/ artifacts
- ❌ Don't analyze LOW/MEDIUM threats in detail

## What to Do

- ✅ Focus on exploitable, high-impact threats
- ✅ Be concise and actionable
- ✅ Provide specific file/line locations
- ✅ Give 1-sentence mitigations
- ✅ Make a clear BLOCK/WARN/PASS recommendation

## Integration with Full SpecIA

If the user later wants full compliance workflow, they can:
1. Run `/specia-init` in their project
2. Run `/specia-new {feature-name}` to create a change
3. The full review will use your findings as input

But for now, you're just doing a quick check.
