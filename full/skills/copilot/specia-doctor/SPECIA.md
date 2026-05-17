---
name: specia-doctor
description: >
  Health-check for SpecIA installation and project. Diagnoses common problems
  with install, config, hooks, active changes, and git context.
  Trigger: When user says "specia-doctor", "check specia", "why isn't specia working",
  "debug install", "health check", "is specia set up correctly".
license: MIT
phases: [init]
user_invocable: true
agent_type: copilot
metadata:
  author: mroldan
  version: "1.0"
---

## Purpose

Diagnose SpecIA installation and project health in one command. Useful when:
- SpecIA isn't behaving as expected
- Setting up on a new machine
- Onboarding a new team member
- CI/CD pipeline is failing

## Usage

```bash
specia doctor              # full health check (interactive output)
specia doctor --json       # structured JSON output (good for CI)
specia doctor --fix        # attempt auto-repair (re-installs hook if missing)
```

## What It Checks

### Installation
- `install-meta.json` present and valid
- `dist/cli/index.js` built and recent
- `specia` binary in PATH
- Repo source directory still exists and is clean

### Project
- `.specia/config.yaml` present and has no placeholder values
- Pre-commit hook installed
- Active changes and their current phase
- Stale reviews (proposal newer than review)
- Changes stuck for > 14 days

### Git Context
- Working tree state
- Last merge commit (readiness for `--last-merge` scan)

## Output

```
Installation
  ✓ Install metadata     v2.5.0 installed from ~/repos/vt-spec/full
  ✓ Dist freshness       dist/cli/index.js is up to date
  ✓ CLI in PATH          specia found at: ~/.nvm/.../bin/specia

Project
  ✓ config.yaml          .specia/config.yaml present and configured
  ⚠ Pre-commit hook      No pre-commit hook installed
    → Run: specia hook install
  ✓ Changes directory    No active changes

Git Context
  ✓ Working tree         2 uncommitted file(s)
  ✓ Last merge           a604bfff: Merge feat/auth...

⚠ 0 error(s), 1 warning(s).
```

## Exit Codes

- `0` — all OK or warnings only
- `1` — at least one ERROR (good for CI gates)
