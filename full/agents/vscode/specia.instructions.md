# SpecIA AppSec Orchestrator

You have access to SpecIA, a security-aware spec-driven development CLI tool. Use it when the user asks to plan, spec, review, or track changes. Run SpecIA commands via bash with `--format json` for structured output.

## Workflow DAG

```
init → propose → spec ──────→ REVIEW → tasks → AUDIT → done
                   │                ▲
                   └─→ design ──────┘
                      (optional)
```

- **design** is optional — skip for small changes unless requested
- **review** is MANDATORY — never skip, includes STRIDE/OWASP + abuse cases
- **audit** is mandatory by default — opt-out only at propose time with `--skip-audit`
- All artifacts: `.specia/changes/{name}/`
- State: `.specia/changes/{name}/state.yaml`

## Delegation via runSubagent

For multi-phase workflows, delegate each phase to a sub-agent using `runSubagent`. Sub-agents run CLI commands with `--format json`.

### Propose
```
runSubagent("specia-propose", {
  message: "Create SpecIA proposal for '{name}'. Intent: {intent}. Scope: {scope}. Run: specia propose {name} --intent '...' --scope '...' --format json"
})
```

### Spec
```
runSubagent("specia", {
  message: "Write specs for '{name}'. Read proposal from .specia/changes/{name}/proposal.md. Run: specia spec {name} --format json (two-phase: first returns template, second accepts spec JSON)."
})
```

### Design (optional)
```
runSubagent("specia-design", {
  message: "Create design for '{name}'. Run: specia design {name} --format json (two-phase: first returns template, second accepts design markdown)."
})
```

### Review (MANDATORY)
```
runSubagent("specia-review", {
  message: "Security review for '{name}'. Run: specia review {name} --format json (two-phase: first returns review_prompt with spec, second accepts review-result JSON). Include abuse cases."
})
```

### Tasks
```
runSubagent("specia-tasks", {
  message: "Generate tasks for '{name}'. Run: specia tasks {name} --format json. Report if blocked by REVIEW_REQUIRED or REVIEW_STALE."
})
```

### Audit (MANDATORY by default)
```
runSubagent("specia-audit", {
  message: "Post-implementation audit for '{name}'. Run: specia audit {name} --format json (two-phase: first returns audit_prompt with spec + code, second accepts audit-result JSON)."
})
```

## CLI Commands Reference

### Core Commands (7)
| Command | Purpose | Requires |
|---------|---------|----------|
| `specia init` | Initialize project (4 questions) | Nothing |
| `specia propose` / `specia new` | Create change proposal | init |
| `specia spec` | Write specifications | proposal |
| `specia design` | Architecture design (optional, 2-phase) | spec |
| `specia review` | Security review (MANDATORY, 2-phase) | spec |
| `specia tasks` | Generate tasks with mitigations | review (non-stale) |
| `specia audit` | Post-implementation audit (2-phase) | tasks |
| `specia done` | Archive completed change | tasks + audit (if required) |

### Shortcuts (3)
| Command | Purpose |
|---------|---------|
| `specia continue` | Show next phase to run |
| `specia ff` | Fast-forward through all phases |
| `specia --search <keyword>` | Search past specs and findings |

### Guardian Hooks (3)
| Command | Purpose |
|---------|---------|
| `specia hook install` | Install pre-commit hook |
| `specia hook uninstall` | Remove hook |
| `specia hook status` | Check hook status |

### Output Formats
All commands support `--format json` for structured output (recommended for agents).

## Security Review Protocol

1. Run `specia review {change-name} --format json` — returns `review_prompt`
2. Analyze spec for threats (STRIDE/OWASP per posture level)
3. Include abuse cases: attacker goals, vectors, preconditions, impact
4. Run `specia review {change-name} --format json` with review-result JSON piped to stdin

### Posture Levels
- **standard**: STRIDE light
- **elevated**: Full STRIDE + OWASP Top 10
- **paranoid**: STRIDE + OWASP + DREAD scoring

## Error Codes

| Code | Action |
|------|--------|
| `NOT_INITIALIZED` | Run `specia init` |
| `REVIEW_REQUIRED` | Run `specia review {change-name}` |
| `REVIEW_STALE` | Re-run review (spec changed) |
| `MISSING_DEPENDENCY` | Run required prior phase |
| `AUDIT_REQUIRED` | Run `specia audit {change-name}` before done |

## Recovery

After compaction: read `.specia/changes/{name}/state.yaml` to find current phase and resume.
