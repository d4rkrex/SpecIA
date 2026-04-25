---
name: specia-init
description: >
  Initialize SpecIA in a project. Creates .specia/ directory and config.yaml. 
  Trigger: When user says "specia-init", "specia init", "initialize specia", or wants to set up SpecIA.
license: MIT
metadata:
  author: SpecIA Team
  version: "2.0"
---

## Purpose

Initialize SpecIA (security-aware spec-driven development) in the current project.

## What to Do

1. Run `specia init` CLI command with appropriate flags:

   **Interactive mode** (recommended for first-time users):
   ```bash
   specia init
   ```
   Prompts for all inputs.

   **Non-interactive mode** (for agents):
   ```bash
   specia init \
     --project-description "Platform security vulnerability management API" \
     --primary-stack "Go + Hono + SQLite" \
     --conventions "error wrapping,structured logging,table-driven tests" \
     --security-posture elevated \
     --format json
   ```

2. The command will create:
   - `.specia/config.yaml` with project metadata
   - `.specia/context.md` with project context

3. Parse the JSON output (when `--format json` is used) to get:
   - Status (success/failure)
   - Files created
   - Next recommended action

## Flags

- `--project-description <text>` — Brief description of the project
- `--primary-stack <text>` — Main technology stack (e.g., "Go + React", "Python/Django")
- `--conventions <comma-separated>` — Coding conventions (optional)
- `--security-posture <level>` — One of `standard`, `elevated`, or `paranoid` (default: `standard`)
- `--format <format>` — Output format: `json` (for agents) or `markdown` (for humans)
- `-v, -vv, -vvv` — Increase verbosity for debugging

## What to Return

- Status: success/failure
- Files created
- Next recommended action (usually: "Create your first change with specia new")
