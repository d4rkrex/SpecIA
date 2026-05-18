# SpecIA

[![Node.js 20+](https://img.shields.io/badge/node-≥20-brightgreen)](https://nodejs.org)
[![CLI-First](https://img.shields.io/badge/interface-CLI--first-blue)]()
[![MCP Protocol](https://img.shields.io/badge/protocol-MCP%20optional-lightgrey)](https://modelcontextprotocol.io)
[![Tests](https://img.shields.io/badge/tests-812_passing-brightgreen)]()
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow)](LICENSE)
[![Version](https://img.shields.io/badge/version-2.6.0-blue)](CHANGELOG.md)

**Security-aware spec-driven development for AI agents.**

SpecIA covers the full spectrum — from a 15-second PR scan to a complete compliance workflow with state persistence and audit trails:

| Mode | Command | Use Case | Cost |
|------|---------|----------|------|
| **Quick scan** | `specia scan --last-merge` | PR review, zero setup | ~$0.01 |
| **Lite review** | `vt-review-lite` skill | Quick STRIDE check, no Node needed | ~$0.009 |
| **Lite audit** | `vt-audit-lite` skill | Static post-impl check | ~$0.020 |
| **Full workflow** | `specia new` → … → `specia done` | Release gate, compliance | ~$0.35 |

---

## Installation

```bash
git clone https://gitlab.veritran.net/appsec/specia.git
cd specia/full
./install.sh
```

Installs the `specia` CLI binary plus all skills/agents for your AI editor (Copilot CLI, Claude Code, OpenCode, or VS Code).

> **No Node.js?** Copy `full/skills/copilot/vt-review-lite/SKILL.md` or `vt-audit-lite/SKILL.md` directly into your AI editor's skills folder — no build required.

To enable the optional MCP server:
```bash
./install.sh --mcp
```

See [full/README.md](full/README.md) for detailed setup.

---

## Quick Start

### Ad-hoc PR scan (zero setup)

```bash
cd your-project
specia scan --last-merge          # scan last merged PR in this repo
specia scan --pr <url>            # fetch + scan a GitHub PR or GitLab MR by URL
specia scan --diff main..HEAD     # scan any diff range
```

Scans auto-call Claude/GPT if an API key is set, save results to `/tmp/specia-scans/`, and store findings to Alejandría memory if available.

Add a `.speciaignore` file in your project root to exclude lock files, generated code, etc.:
```
*.lock
dist/**
node_modules/**
```

### Security analytics

```bash
specia history           # weekly findings trend (last 90 days)
specia history --since 30d --format json
```

### Lightweight skill review (no Node required)

Ask your AI agent:
```
Run vt-review-lite on oauth-spec.md
```

Returns a BLOCK/WARN/PASS recommendation in ~15 seconds.

### Full compliance workflow

```bash
cd your-project
specia init

# Start a new change
specia new add-oauth-login

# Follow the workflow
specia continue  # Runs: propose → spec → review → tasks
specia apply     # Implements code (via vt-apply agent)
specia audit     # Verifies implementation
specia done      # Archives change
```

See [full/README.md](full/README.md) for detailed documentation.

---

## Repository Structure

```
specia/
├── full/                      # SpecIA (CLI + MCP server + all skills)
│   ├── agents/               # Copilot, Claude Code, OpenCode agents
│   ├── skills/               # All skills (includes vt-review-lite, vt-audit-lite)
│   ├── src/                  # TypeScript CLI + MCP server
│   ├── test/                 # 812 tests
│   └── install.sh            # Installer
│
├── ci-templates/              # GitHub Actions + GitLab CI templates
│
├── docs/                      # Architecture, workflow, migration guides
│
└── lite/                      # ⚠️  Deprecated — skills moved to full/skills/copilot/
```

---

## Documentation

### Getting Started
- **[Full README](full/README.md)** — Complete SpecIA documentation
- **[Workflow Guide](docs/workflow.md)** — Complete workflow explanation with security focus

### Migration & Cost Analysis
- **[v1 → v2 Migration Guide](docs/v1-to-v2-migration.md)** — Upgrade path, token economics, ROI analysis

### Advanced
- **[Guardian Layer 4](docs/guardian-spec-aware.md)** — Spec-aware validation deep dive
- **[Troubleshooting](docs/troubleshooting.md)** — Common installation issues and fixes
- **[CHANGELOG](CHANGELOG.md)** — Release notes

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

Current: **v2.6.0** — See [CHANGELOG.md](CHANGELOG.md) for release history.
