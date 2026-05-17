---
name: specia-report
description: >
  Generate a security posture compliance report from all archived SpecIA changes.
  Shows overall risk trend, finding history, and per-change breakdown.
  Trigger: When user says "security report", "posture report", "show findings history",
  "compliance report", "specia-report", "how many vulnerabilities have we fixed".
license: MIT
phases: [done]
user_invocable: true
agent_type: copilot
metadata:
  author: mroldan
  version: "1.0"
---

## Purpose

Generate a consolidated security posture report from all archived changes in `.specia/specs/`.
Useful for:
- Sprint/release security sign-off
- Compliance audits
- Security trend analysis over time

## Usage

```bash
specia report                      # report on all archived changes
specia report --since 30d          # last 30 days only
specia report --change my-feature  # specific change
specia report --output report.md   # save to file
specia report --format table       # table format (default)
specia report --format markdown    # full markdown
specia report --json               # structured JSON
```

## Output Sections

### Security Posture Banner
```
Security Posture: 🟢 GOOD
  Reviewed changes: 15 | Critical findings: 0 | High: 2 | Medium: 8
```

Posture levels:
- 🟢 **GOOD** — no critical, few high
- 🟡 **FAIR** — some high findings, all have mitigations
- 🔴 **NEEDS_ATTENTION** — unresolved critical or high findings

### Change Table
```
Change                     Phase   Findings   Mitigations   Status
─────────────────────────  ──────  ─────────  ────────────  ──────
fleet-orchestrator         done    5          5             ✓
update-mechanism           done    2          2             ✓
payment-api-hardening      done    8          7             ⚠
```

### Trend
Finding counts over time — useful for spotting security debt accumulation.

## Options

| Flag | Description |
|------|-------------|
| `--since <duration>` | Filter by age: `7d`, `30d`, `90d`, `1y` |
| `--change <name>` | Single change detail view |
| `--output <file>` | Write report to file |
| `--format <fmt>` | `table` (default) or `markdown` |
| `--json` | Structured JSON output |
