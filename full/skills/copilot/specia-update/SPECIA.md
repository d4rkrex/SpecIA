---
name: specia-update
description: >
  Update SpecIA to the latest version and show what's new.
  Trigger: When user says "update specia", "upgrade specia", "what's new in specia",
  "specia-update", "show changelog", "install latest specia".
license: MIT
phases: []
user_invocable: true
agent_type: copilot
metadata:
  author: mroldan
  version: "1.0"
---

## Purpose

Update SpecIA to the latest version from any directory. Reads `~/.specia/install-meta.json`
to find the source repo, then runs `git pull + rebuild + reinstall`.

## Usage

```bash
specia update              # pull latest + rebuild + reinstall (shows What's New)
specia update --check      # show current version and meta (no update)
specia changelog           # show full changelog
specia changelog --latest  # show latest version only
specia changelog --version 2.4.0   # show specific version
```

## What Happens on Update

1. Reads `~/.specia/install-meta.json` → finds repo directory
2. `git pull` in the repo
3. `npm run build` (TypeScript → JS)
4. `./install.sh --update` → reinstalls all previously configured targets
5. Shows "What's New" banner from CHANGELOG.md

## Output

```
✓ SpecIA updated: 2.4.0 → 2.5.0
  Targets reinstalled: claude-code

What's New in v2.5.0
═══════════════════
• specia scan --last-merge: zero-setup PR scanning
• specia debate --last-merge: scan+debate in one shot
• specia doctor: health check for install and project
• CI/CD templates: GitHub Actions + GitLab CI
• Auto-LLM: auto-detects ANTHROPIC_API_KEY / OPENAI_API_KEY
```

## Check Mode (no update)

```bash
specia update --check
```
```
SpecIA v2.5.0
  Installed: 2026-05-17T21:56:32Z
  Source:    ~/repos/vt-spec/full
  Targets:   claude-code
```
