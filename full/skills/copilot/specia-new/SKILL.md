---
name: specia-new
description: >
  Create a new SpecIA change proposal. Shortcut for specia propose.
  Trigger: When user says "specia-new", "new specia change", "create change proposal".
license: MIT
metadata:
  author: SpecIA Team
  version: "2.0"
---

## Purpose

Create a new change proposal in SpecIA. This is the first phase of the security-aware workflow.

## What to Do

1. Ask the user (if not provided):
   - `change_name`: kebab-case name (e.g., "add-rate-limiting")
   - `intent`: What problem does this solve?
   - `scope`: Which files/modules will change?

2. Run `specia new` CLI command:

   ```bash
   specia new add-jwt-refresh \
     --intent "Implement JWT refresh token rotation to improve security" \
     --scope "internal/auth/,cmd/server/" \
     --approach "Use refresh tokens stored in httpOnly cookies with rotation on each use" \
     --format json
   ```

   Or use `specia propose` (identical behavior):
   ```bash
   specia propose add-jwt-refresh \
     --intent "Implement JWT refresh token rotation to improve security" \
     --scope "internal/auth/,cmd/server/" \
     --skip-audit \
     --format json
   ```

3. The command will create:
   - `.specia/changes/{name}/proposal.md`
   - `.specia/changes/{name}/state.yaml`

## Flags

- `--intent <text>` — Clear statement of purpose (required)
- `--scope <comma-separated>` — Affected areas/modules (required)
- `--approach <text>` — High-level implementation approach (optional)
- `--skip-audit` — Opt-out of mandatory post-implementation audit (optional, default: false)
- `--format <format>` — Output format: `json` (for agents) or `markdown` (for humans)
- `-v, -vv, -vvv` — Increase verbosity for debugging

## What to Return

- Status: success/failure
- Change name
- Files created
- Next recommended phase: `specia spec`
