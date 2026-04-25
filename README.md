# SpecIA

**Catch critical security bugs before you write a single line of code.**

SpecIA reviews your feature specs and finds security vulnerabilities (auth bypass, XSS, SQL injection, insecure storage, etc.) **before implementation**. Then audits your code to verify all security gaps are fixed.

Built for AI agents, works in seconds, prevents production incidents.

---

## See It In Action

You're adding OAuth login. You write a simple spec:

```markdown
# Add OAuth Login with Google

## Requirements
- Users can sign in with Google OAuth 2.0
- Tokens stored in browser localStorage
- Session created after successful auth
```

You ask your AI agent: **"Run specia-review-lite on this spec"**

**SpecIA finds critical security flaws in 15 seconds:**

```markdown
🔴 Risk Level: CRITICAL

❌ Spoofing - Missing PKCE Flow
   → Authorization code interception = account takeover
   → Fix: Implement PKCE (RFC 7636)

❌ Information Disclosure - Tokens in localStorage  
   → Any XSS attack = full account compromise
   → Fix: Use httpOnly, Secure, SameSite=Strict cookies

Recommendation: BLOCK (must fix before implementation)
```

**After you implement the fixes**, SpecIA audits your code:

```markdown
✅ Overall Status: PASS

✓ Missing PKCE Flow — FIXED (oauth.ts:45)
✓ Tokens in localStorage — FIXED (callback.ts:67, now httpOnly)
✓ All requirements implemented

Verdict: APPROVE (safe to ship)
```

**Total time: 45 seconds**

This is what SpecIA does. Security review → Implementation → Audit. All automated.

---

## Why SpecIA?

**Security bugs caught at design time are 100x easier to fix than in production.**

- ❌ **Without SpecIA**: Security review happens after code is written → time-consuming rewrites, missed deadlines
- ✅ **With SpecIA**: Security review happens at spec stage → fix design, implement once, ship secure

**What SpecIA catches:**

- 🔐 **Authentication/Authorization flaws** (missing checks, privilege escalation)
- 💉 **Injection vulnerabilities** (SQL, XSS, command injection)
- 🔓 **Insecure data storage** (plaintext secrets, localStorage tokens)
- 🌐 **API security gaps** (missing rate limits, CSRF, CORS misconfiguration)
- 🚨 **Business logic flaws** (TOCTOU, race conditions, state manipulation)

Uses **STRIDE threat modeling** + **OWASP Top 10** + **abuse case analysis**.

---

## Installation

**Quick start (30 seconds):**

```bash
git clone https://github.com/d4rkrex/SpecIA.git
cd SpecIA/lite
./install-lite.sh
```

This installs 2 skills in your AI editor (OpenCode, Cursor, Claude Desktop, Continue):
- `specia-review-lite` — Security review (finds critical threats)
- `specia-audit-lite` — Code audit (verifies fixes)

**No dependencies. No setup. Works immediately.**

### Usage

In your AI chat:

```
# Review a spec
Run specia-review-lite on my-feature-spec.md

# After implementing
Run specia-audit-lite
Spec: my-feature-spec.md
Code: src/feature.ts, src/api.ts
```

That's it. Security review done.

---

## Two Editions

SpecIA comes in two flavors:

### SpecIA Lite (Recommended for most users)

**Fast, lightweight, zero dependencies.**

- ⚡ ~30 seconds per feature
- 📦 No Node.js, no MCP server
- ✅ Perfect for: PR reviews, quick checks, individual developers

**What you get:**
- Security review (STRIDE critical threats)
- Post-implementation audit (static analysis)
- Works with any spec format (markdown, docs, code comments)

### SpecIA Full (For compliance workflows)

**Complete security compliance workflow with audit trails.**

```bash
cd SpecIA/full
./install.sh
```

- 🏗️ ~5-10 minutes per feature
- 📋 State persistence (.specia/ directory + Alejandría memory)
- ✅ Perfect for: Release gates, compliance, high-security features

**What you get:**
- Everything in Lite, plus:
- Dynamic test execution (`npm test`, builds)
- Abuse case analysis (attacker scenarios)
- Full STRIDE + DREAD threat modeling
- MCP server (optional, for advanced integrations)
- CLI tools (`specia review`, `specia audit`, etc.)

### Comparison

| Feature | Lite | Full |
|---------|------|------|
| Security review | ✅ Critical threats | ✅ Full STRIDE + DREAD |
| Code audit | ✅ Static checks | ✅ + Test execution |
| Abuse cases | ❌ | ✅ Attacker scenarios |
| Time | ~30 sec | ~5-10 min |
| Dependencies | None | Node.js 20+ |
| State persistence | ❌ | ✅ .specia/ + Alejandría |

**→ Start with Lite. Upgrade to Full when you need compliance or deeper analysis.**

---

## SpecIA Full Workflow (Advanced)

If you installed SpecIA Full, you get the complete security compliance workflow:

```bash
cd your-project
specia init

# Start a new change
specia new add-oauth-login

# SpecIA guides you through:
specia continue  # → propose → spec → review → tasks
specia apply     # → implements code with security mitigations
specia audit     # → verifies all requirements + security fixes
specia done      # → archives with compliance trail
```

Full workflow includes:
- **Exploration phase** (for complex/security-sensitive changes)
- **Threat modeling** (STRIDE + DREAD scoring)
- **Abuse case analysis** (attacker scenarios)
- **Test execution** (runs your `npm test`, validates behavior)
- **Compliance artifacts** (stored in `.specia/specs/`)

See [full/README.md](full/README.md) for complete documentation.

---

## Repository Structure

```
specia/
├── lite/                      # SpecIA Lite (standalone)
│   ├── skills/
│   │   ├── specia-review-lite/   # Quick security review
│   │   └── specia-audit-lite/    # Quick audit
│   ├── examples/             # Usage examples
│   └── install-lite.sh       # Installer
│
├── full/                      # SpecIA Full (complete workflow)
│   ├── agents/               # OpenCode, Copilot, Claude agents
│   ├── skills/               # Full skill set (7 skills)
│   ├── src/                  # MCP server + CLI
│   ├── test/                 # 812 tests
│   └── install.sh            # Installer
│
├── shared/                    # Shared templates and docs
│   ├── templates/            # STRIDE, OWASP checklists
│   └── docs/                 # Architecture docs
│
└── docs/                      # Project-wide docs
    ├── comparison.md         # Lite vs Full comparison
    └── architecture.md       # Design decisions
```

---

## Documentation

- **[Full README](full/README.md)** — Complete SpecIA Full documentation
- **[Lite Examples](lite/examples/EXAMPLES.md)** — Real-world usage examples
- **[Workflow Guide](docs/workflow.md)** — Complete security workflow explanation
- **[Troubleshooting](docs/troubleshooting.md)** — Installation issues and fixes
- **[CHANGELOG](CHANGELOG.md)** — Release history

---

## FAQ

**Q: Do I need to write formal specs?**  
No. SpecIA works with informal markdown, code comments, or even plain text descriptions.

**Q: Does it replace manual security review?**  
No. It catches common vulnerabilities early. Manual pentesting is still needed for production.

**Q: What AI editors does it work with?**  
OpenCode, Cursor, Claude Desktop, Continue. Any editor that supports skills/agents.

**Q: Can I use it on closed-source projects?**  
Yes. SpecIA runs locally. Your code never leaves your machine.

**Q: Does it work with languages other than JavaScript?**  
Yes. Works with any language. Security principles are universal.

---

## License

MIT — See [LICENSE](LICENSE)

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md)

---

## Support

- **Issues**: [GitHub Issues](https://github.com/d4rkrex/SpecIA/issues)
- **Discussions**: [GitHub Discussions](https://github.com/d4rkrex/SpecIA/discussions)

---

## Version

Current: **v2.1.0**

See [CHANGELOG.md](CHANGELOG.md) for release history.

---

[![Node.js 20+](https://img.shields.io/badge/node-≥20-brightgreen)](https://nodejs.org) [![CLI-First](https://img.shields.io/badge/interface-CLI--first-blue)]() [![MCP Protocol](https://img.shields.io/badge/protocol-MCP%20optional-lightgrey)](https://modelcontextprotocol.io) [![Tests](https://img.shields.io/badge/tests-812_passing-brightgreen)]() [![License: MIT](https://img.shields.io/badge/license-MIT-yellow)](LICENSE) [![Version](https://img.shields.io/badge/version-2.1.0-blue)](CHANGELOG.md)
