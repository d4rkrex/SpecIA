# SpecIA Decision Tree: Lite vs Full?

**Quick guide**: Given my scenario X, which edition should I use?

---

## 🚦 Decision Flowchart

```
┌────────────────────────────────────┐
│  What type of change are you      │
│  implementing?                     │
└────────────────────────────────────┘
                │
                ▼
    ┌───────────┴───────────┐
    │                       │
  SENSITIVE?            NOT SENSITIVE?
    │                       │
    ▼                       ▼
┌──────────┐           ┌──────────┐
│ • Auth   │           │ • UI     │
│ • Payment│           │ • CRUD   │
│ • PII    │           │ • Docs   │
│ • API    │           │ • Tests  │
│ • Upload │           │ • Refact │
└─────┬────┘           └─────┬────┘
      │                      │
      ▼                      ▼
 ┌────────┐             ┌────────┐
 │  FULL  │             │  LITE  │
 │ ~10min │             │ ~45sec │
 └────────┘             └────────┘
```

---

## 📋 Quick Decision Table

| Criteria | Full | Lite |
|----------|------|------|
| Auth/passwords/tokens | ✅ | ❌ |
| Payment/billing | ✅ | ❌ |
| Public API | ✅ | ❌ |
| PII (email, phone, address) | ✅ | ❌ |
| Compliance (SOC 2, PCI, HIPAA) | ✅ | ❌ |
| Permissions/roles/admin | ✅ | ❌ |
| File upload | ✅ | ❌ |
| PR review < 200 lines | ❌ | ✅ |
| UI-only (no business logic) | ❌ | ✅ |
| Refactor (no behavior change) | ❌ | ✅ |
| Docs/tests only | ❌ | ✅ |

**Rule of thumb**: When in doubt → **Start with Lite**, upgrade to Full if critical findings detected

---

## 🎯 Use Cases

### ✅ SpecIA LITE (~45 seconds)

**When to use**: Low-risk changes, quick feedback, pre-commit validation

**Example 1: PR Review**
```bash
Scenario: Code review of small PR (50 lines)
Command: specia-review-lite src/components/Button.tsx
Output: 3 threats → 1 HIGH: XSS in onClick handler
```

**Example 2: Refactor Check**
```bash
Scenario: Rename function without behavior change
Command: specia-review-lite src/services/user.ts
Output: 0 threats → behavior unchanged
```

**Example 3: UI-Only Feature**
```bash
Scenario: New landing page (markup + CSS)
Command: specia-review-lite src/pages/landing.tsx
Output: 0 threats → low-risk UI code
```

---

### ✅ SpecIA FULL (~10 minutes)

**When to use**: High-risk features, compliance requirements, audit trail needed

**Example 1: OAuth Login**
```bash
Scenario: Implement Google OAuth
Command: specia new add-oauth-login
Output:
  • 7 STRIDE threats
  • 4 abuse cases (session fixation, CSRF, token theft)
  • 12 tasks (8 implementation + 4 security mitigations)
  • Audit: 6/6 requirements verified with exploit PoCs
```

**Example 2: Payment Integration**
```bash
Scenario: Add Stripe checkout
Command: specia new add-stripe-checkout
Output:
  • 9 STRIDE threats (webhook spoofing, replay, tampering)
  • 5 abuse cases (fraudulent charges, refund abuse)
  • 15 tasks (10 implementation + 5 mitigations)
  • Compliance: PCI-DSS validated
```

**Example 3: File Upload**
```bash
Scenario: Upload images to S3
Command: specia new add-image-upload
Output:
  • 10 STRIDE threats (path traversal, XXE, malware, SSRF)
  • 5 abuse cases (shell upload, XSS via SVG, DoS)
  • 16 tasks (11 implementation + 5 mitigations)
  • Audit: File validation, size limits, MIME enforcement
```

---

## 🔄 Lite → Full Upgrade Path

**Scenario**: Start with Lite, detect high risk, upgrade to Full

```bash
# Step 1: Quick check with Lite (~15 sec)
specia-review-lite src/auth/login.ts

# Output shows critical findings:
Threats: 3 critical
  • SQL injection in login query
  • Password stored in plaintext
  • No rate limiting

⚠️ UPGRADE RECOMMENDED

# Step 2: Upgrade to Full (~10 min)
specia new fix-login-security
specia ff fix-login-security

# Full output:
✅ 12 threats (5 critical, 4 high, 3 medium)
✅ 6 abuse cases (credential stuffing, brute force, session fixation)
✅ 14 tasks (9 implementation + 5 security mitigations)
```

**Value**: Quick triage (15s) → deep analysis only when needed (10min)

---

**Last updated**: 2026-04-18  
**Version**: v2.1.0

