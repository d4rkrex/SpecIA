---
name: specia-verify
description: >
  Lightweight verification gate between apply and audit. Validates Threat ID coverage,
  task completion, scope compliance, and .specia/ integrity. Mandatory for fan-out apply.
  Trigger: When orchestrator runs verify after multi-agent apply, or user says "specia-verify".
license: MIT
phases: [apply]
user_invocable: false
agent_type: copilot
metadata:
  author: mroldan
  version: "1.0"
---

## Purpose

Fast, cheap verification gate that catches obvious gaps before the expensive audit.

**When mandatory**: `apply-manifest.yaml` has `pattern: fan-out`
**When optional**: `pattern: sequential` (but recommended)

## Checks

0. **Manifest Integrity** — `tasks_hash` in manifest matches SHA256 of current `tasks.md` (fan-out only; T-01)
1. **Threat ID Coverage** — every T-xxx from review.md has `# SpecIA T-xxx:` in code
2. **Task Completion** — every `- [ ]` in tasks.md is now `- [x]`
3. **Scope Compliance** — worker apply-logs show no scope violations (fan-out only)
4. **Artifact Integrity** — .specia/ files unchanged by workers (hash comparison)
5. **Git Diff Validation** — all modified files belong to a declared ownership group

## Flow

```
1. Read .specia/changes/{name}/apply-manifest.yaml
2. If fan-out: verify tasks_hash matches SHA256 of tasks.md (T-01)
   → If mismatch: ABORT with MANIFEST_TAMPERED error before any other checks
3. Read .specia/changes/{name}/review.md (extract Threat IDs)
4. Read .specia/changes/{name}/tasks.md (check completeness)
5. If fan-out: read apply-log-*.md files
6. Run all checks (0–5)
7. Write result to .specia/changes/{name}/apply-log-verify.md
8. Report pass/fail with details
```

## Rules

- Read-only — NEVER modify files
- Report ALL failures, not just the first
- PASS → recommend @specia-audit
- FAIL → block audit, list remediation steps
