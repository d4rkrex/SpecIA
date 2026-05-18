---
name: specia-debate
description: >
  Structured security debate on findings — validates severity, challenges false positives,
  and reaches consensus via offensive/defensive/judge simulation.
  Trigger: When user says "debate findings", "challenge severity", "are these real?",
  "specia-debate", "debate last merge", "debate PR findings".
license: MIT
phases: [review, audit, scan]
user_invocable: true
agent_type: copilot
metadata:
  author: mroldan
  version: "1.0"
---

## Purpose

Run a structured three-perspective debate on security findings to:
- Validate whether findings are real or false positives
- Calibrate severity (escalate or de-escalate)
- Flag items that need human review
- Produces `debate.md` in the change directory (or `/tmp/specia-debates/` standalone)

## Two Usage Modes

### Mode A — Standalone (last merge or diff, no specia init needed)

```bash
specia debate --last-merge    # scan + debate last merged PR/MR in one shot
specia debate --diff main..HEAD   # scan + debate current branch diff
```

If `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` is set, runs end-to-end automatically.
Otherwise generates a combined scan+debate prompt — process it and submit:

```bash
specia debate --last-merge --result @debate.json
specia debate --last-merge --result '{"findings_debated":3,"debates":[...],"summary":{...}}'
```

### Mode B — On an existing specia change

```bash
specia debate my-change       # debates findings from .specia/changes/my-change/review.md
specia debate my-change --result @debate.json
```

## Result JSON Schema

```json
{
  "findings_debated": 3,
  "debates": [
    {
      "finding_id": "T-01",
      "title": "SQL Injection in user search",
      "original_severity": "high",
      "offensive_challenge": "Could be chained with auth bypass...",
      "defensive_response": "Parameterized queries are already in place...",
      "consensus_severity": "medium",
      "consensus_reached": true,
      "calibration": "de-escalated",
      "mitigation": "Add input validation layer",
      "notes": "Actual exploitability is limited by ORM usage"
    }
  ],
  "summary": {
    "escalated": 0,
    "de_escalated": 1,
    "validated": 2,
    "needs_human_review": ["T-03"]
  }
}
```

`calibration` values: `validated` | `escalated` | `de-escalated` | `needs_human_review`

## Options

| Flag | Description |
|------|-------------|
| `--last-merge` | Scan + debate the last merged PR/MR |
| `--diff <ref>` | Scan + debate a git diff range |
| `--manual` | Print prompt to stdout (skip LLM) |
| `--model <model>` | LLM model override |
| `--result <json>` | Submit result (inline, @file, or -) |

## Output

```
✓ Scan + debate complete.
  Source: Last merge: "feat: add payment endpoint" ...
  Findings debated: 3
  Validated: 2 | Escalated: 0 | De-escalated: 1
  ⚠ Needs human review: S-02
  Report: /tmp/specia-debates/2026-...debate.md
```

## Memory Integration (Alejandría)

If Alejandría is configured (`.specia/config.yaml` has `memory.backend: alejandria`), debate results are automatically stored to memory after completion. You can also recall relevant past debates before starting:

```bash
specia search "authentication bypass"   # Recall past findings on this topic
specia debate --last-merge              # Debate + auto-store to Alejandría
```

This means when you run future debates on related code, the agent has context about previous findings that were escalated, de-escalated, or flagged for human review.
