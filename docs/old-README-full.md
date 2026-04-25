# SpecIA Monorepo

[![Node.js 20+](https://img.shields.io/badge/node-≥20-brightgreen)](https://nodejs.org)
[![CLI-First](https://img.shields.io/badge/interface-CLI--first-blue)]()
[![MCP Protocol](https://img.shields.io/badge/protocol-MCP%20optional-lightgrey)](https://modelcontextprotocol.io)
[![Tests](https://img.shields.io/badge/tests-812_passing-brightgreen)]()
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow)](LICENSE)
[![Version](https://img.shields.io/badge/version-2.1.0-blue)](CHANGELOG.md)

**Security-aware spec-driven development for AI agents.**

SpecIA provides **two flavors** of security review and audit:

1. **SpecIA Full** — Complete compliance workflow with state persistence, MCP server, and Alejandría integration
2. **SpecIA Lite** — Lightweight security checks (review + audit) with NO dependencies, NO state, 7x cheaper

---

## Choose Your Edition

| Feature | SpecIA Lite | SpecIA Full |
|---------|--------------|--------------|
| **Use Case** | PR reviews, quick checks | Release gates, compliance |
| **Dependencies** | None (just 2 skills) | Node.js 20+, MCP server optional |
| **State** | None | Persistent (.specia/ + Alejandría) |
| **Time** | ~30 sec (review + audit) | ~5-10 min (full workflow) |
| **Cost** | ~$0.03 per feature | ~$0.22 per feature |
| **Tokens** | ~9.6k | ~70k |
| **Skills** | 2 (review-lite, audit-lite) | 7 (init, explore, propose, spec, design, review, tasks, apply, audit) |
| **MCP Server** | ❌ No | ✅ Optional |
| **Test Execution** | ❌ Static checks only | ✅ Runs npm test + build |
| **Abuse Cases** | ❌ No | ✅ Yes (attacker scenarios) |
| **Memory** | ❌ No | ✅ Alejandría integration |

---

## Installation

### SpecIA Lite (Recommended for most users)

```bash
git clone https://gitlab.veritran.net/appsec/specia.git
cd specia/lite
./install-lite.sh
```

Installs 2 skills in your AI editor:
- `specia-review-lite` — Quick STRIDE security review (critical threats only)
- `specia-audit-lite` — Quick post-implementation audit (static checks)

**Supported platforms**: OpenCode, Cursor, Claude Desktop, Continue

### SpecIA Full (For compliance workflows)

```bash
git clone https://gitlab.veritran.net/appsec/specia.git
cd specia/full
./install.sh
```

Installs complete workflow with MCP server (optional) and 7 skills.

See [full/README.md](full/README.md) for detailed setup.

---

## Quick Start: SpecIA Lite

### Example 1: Review a Spec

You're implementing OAuth login. Create a spec (can be informal markdown):

**oauth-spec.md**:
```markdown
# Add OAuth Login with Google

## Requirements
- Users can sign in with Google OAuth 2.0
- Tokens stored in browser localStorage
- Session created after successful auth
```

Ask your AI agent:
```
Run specia-review-lite on oauth-spec.md
```

**Output** (~15 seconds):
```markdown
## Security Review: add-oauth-login

**Risk Level**: critical

### Critical Threats

1. **Spoofing - Missing PKCE Flow**
   - Severity: critical
   - Location: OAuth flow design
   - Risk: Authorization code interception enables account takeover
   - Fix: Implement PKCE (RFC 7636)

2. **Information Disclosure - Tokens in localStorage**
   - Severity: critical
   - Location: frontend token storage
   - Risk: XSS vulnerability gives attacker full account access
   - Fix: Use httpOnly, Secure, SameSite=Strict cookies

### Summary

- Total threats: 2 critical
- Recommendation: BLOCK (must fix before implementation)
```

### Example 2: Audit Implementation

After implementing, verify security gaps are fixed:

```
Run specia-audit-lite. 
Spec: oauth-spec.md
Code: src/auth/oauth.ts, src/routes/callback.ts
Review findings: [paste findings from step 1]
```

**Output** (~30 seconds):
```markdown
## Audit Report: add-oauth-login

**Overall Status**: PASS

### Security Gap Status

1. **Missing PKCE Flow** — FIXED
   - Evidence: oauth.ts:45 (code_challenge generation)

2. **Tokens in localStorage** — FIXED
   - Evidence: callback.ts:67 (httpOnly cookie set)

### Spec Compliance

| Requirement | Status | Evidence |
|-------------|--------|----------|
| OAuth sign-in | ✅ IMPLEMENTED | oauth.ts:23 |
| Token storage | ✅ IMPLEMENTED | callback.ts:67 (httpOnly) |
| Session creation | ✅ IMPLEMENTED | callback.ts:89 |

**Verdict**: APPROVE (all gaps fixed)
```

**Total cost**: ~$0.03 | **Total time**: ~45 seconds

---

## Quick Start: SpecIA Full

For complete workflow with state persistence, MCP server, and compliance artifacts:

```bash
cd your-project
specia init

# Start a new change
specia new add-oauth-login

# Follow the workflow
specia continue  # Runs: propose → spec → review → tasks
specia apply     # Implements code (via specia-apply agent)
specia audit     # Verifies implementation
specia done      # Archives change
```

See [full/README.md](full/README.md) for detailed documentation.

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

- **[Lite Examples](lite/examples/EXAMPLES.md)** — Real-world usage of specia-review-lite and specia-audit-lite
- **[Full Workflow Guide](full/README.md)** — Complete SpecIA Full documentation
- **[Comparison Guide](docs/comparison.md)** — When to use Lite vs Full
- **[Architecture](docs/architecture.md)** — Design decisions and internals

---

## When to Use Which

### Use SpecIA Lite if:
- ✅ You're an individual developer doing quick security checks
- ✅ You need PR review automation
- ✅ You want zero setup (no dependencies)
- ✅ Budget is a concern (~7x cheaper)
- ✅ You have your own specs (not using SpecIA workflow)

### Use SpecIA Full if:
- ✅ You need compliance audit trails
- ✅ You want state persistence across sessions (Alejandría)
- ✅ You need dynamic test execution (runs `npm test`)
- ✅ You want complete security analysis (STRIDE + DREAD + abuse cases)
- ✅ You're implementing high-security features (auth, payment, PII)
- ✅ You need MCP protocol integration

---

## Cost Comparison

### SpecIA Lite (per feature)
- Review: ~3k tokens (~$0.009)
- Audit: ~6.6k tokens (~$0.020)
- **Total: ~$0.029**

### SpecIA Full (per feature)
- Explore: ~8k tokens (~$0.024)
- Propose: ~5k tokens (~$0.015)
- Spec: ~12k tokens (~$0.036)
- Review: ~20k tokens (~$0.060)
- Tasks: ~10k tokens (~$0.030)
- Apply: ~10k tokens (~$0.030)
- Audit: ~50k tokens (~$0.150)
- **Total: ~$0.345**

**Savings: 12x cheaper with Lite** (though Lite provides less depth)

---

## License

MIT — See [LICENSE](LICENSE)

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md)

---

## Support

- **Issues**: [GitLab Issues](https://gitlab.veritran.net/appsec/specia/-/issues)
- **Discussions**: [GitLab Discussions](https://gitlab.veritran.net/appsec/specia/-/discussions)

---

## Version

Current: **v2.1.0** (Monorepo + Lite edition)

See [CHANGELOG.md](CHANGELOG.md) for release history.
