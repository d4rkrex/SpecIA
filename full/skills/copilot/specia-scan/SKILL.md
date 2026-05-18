---
name: specia-scan
description: >
  Run an ad-hoc security scan on staged changes, a git diff, or specific files.
  No SpecIA workflow required. Good for PR reviews, commit checks, or one-off analysis.
  Trigger: When user says "specia-scan", "scan staged changes", "quick security check", "scan files".
license: MIT
phases: [scan]
user_invocable: true
agent_type: copilot
metadata:
  author: mroldan
  version: "1.0"
---

## Purpose

Run a quick STRIDE-lite security analysis on code without the full SpecIA workflow.
No spec, no change state required. Ideal for:
- PR reviews before merging
- Checking a specific commit: `specia scan --diff HEAD~1`
- Reviewing specific files: `specia scan --files src/auth.ts,src/middleware.ts`

## Two-Phase Protocol

**Auto mode** (default): if `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` is set, specia scan calls the LLM directly and shows results immediately.

**Manual mode** (`--manual` flag): generates a prompt for external processing.

### Phase 1: Run the Scan

```bash
specia scan                                          # scan staged files
specia scan --last-merge                             # scan last merged PR/MR
specia scan --diff HEAD~1                            # scan last commit
specia scan --diff main                              # diff vs branch
specia scan --files src/auth.ts,src/api.ts           # specific files
specia scan --posture elevated                        # deeper analysis
```

If auto mode succeeds, findings are shown immediately — skip Phase 2.

### Phase 2: Submit Result (manual mode only)

```bash
specia scan --result @result.json
specia scan --result '{"summary":{"risk_level":"medium","findings_count":2},"findings":[...]}'
echo '<json>' | specia scan
```

## Result JSON Schema

```json
{
  "summary": {
    "risk_level": "critical|high|medium|low",
    "findings_count": 3
  },
  "findings": [
    {
      "id": "S-01",
      "severity": "high",
      "title": "Broken Access Control on admin endpoint",
      "description": "The /admin route lacks authentication middleware...",
      "mitigation": "Add authMiddleware() to the route definition.",
      "owasp": "A01:2021 - Broken Access Control"
    }
  ]
}
```

## Options

| Flag | Description |
|------|-------------|
| `--diff <ref>` | Scan diff vs git ref (HEAD~1, main, a1b2c3) |
| `--files <paths>` | Comma-separated file list |
| `--pr <url>` | Fetch diff from a GitHub PR or GitLab MR URL |
| `--posture <level>` | standard (default), elevated, paranoid |
| `--result <json>` | Submit LLM result (inline, @file, or -) |
| `--json` | JSON output throughout |

## Output

After submitting a result, outputs a findings table:

```
ID      Severity    Title                          OWASP
──────  ──────────  ─────────────────────────────  ──────────────────────
S-01    high        Broken Access Control          A01:2021
S-02    medium      Missing Rate Limiting          A05:2021
```

Reports saved to: `.specia/scans/{timestamp}-scan.md`

## Error Handling

- No staged changes or diff: shows a warning but continues (generates prompt for context-free analysis)
- No `.specia/` directory: scan still works, just won't save reports to disk

## Memory Integration (Alejandría)

If Alejandría is configured (`.specia/config.yaml` has `memory.backend: alejandria`), scan results are automatically stored to memory after completion. You can also recall relevant past scans before starting:

```bash
specia search "authentication bypass"   # Recall past findings on this topic
specia scan --last-merge                # Scan + auto-store to Alejandría
```

This means when you run future scans on related code, the agent has context about previous vulnerabilities found in similar areas.
