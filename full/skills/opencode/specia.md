# SpecIA FULL — Security-Aware Spec-Driven Development

> **Skill for OpenCode** — SpecIA FULL workflow coordinator (compliance-grade with audit trail).
> Use for: Release gates, auth/payment/PII features, compliance requirements, audit trail needed.
> NOT for: Quick PR checks (use specia-review-lite), prototyping (use specia-review-lite).

## Triggers

Load this skill when:
- User says "specia", "specia", "spec-driven", "full workflow", "compliance review", "new change"
- User wants complete security analysis with abuse cases and audit trail
- You see a `.specia/` directory in the project
- User asks to continue or fast-forward a change
- User needs dynamic test execution and coverage reports

## What is SpecIA FULL?

SpecIA FULL is a **complete compliance workflow** for spec-driven development with **mandatory security review and audit gates**. The workflow enforces:

```
init → propose → spec ──────→ REVIEW → tasks → AUDIT → done
                   │                ▲
                   └─→ design ──────┘
                      (optional)
```

The security review **cannot be skipped**. It is a hard gate before task generation.
The design phase is **optional** — use it for complex architectural changes.
The audit phase is **mandatory by default** — `specia done` blocks without a completed audit unless opted out at proposal time (`--skip-audit`) or overridden with `--force`.

An optional MCP server interface exists for advanced users, but **the CLI is the primary interface**.

## CLI Commands Quick Reference

### Core Commands

| Command | Purpose | Requires |
|---------|---------|----------|
| `specia init` | Initialize project | Nothing |
| `specia propose` (or `new`) | Create change proposal | init |
| `specia spec` | Write specifications | proposal |
| `specia review` | Security review (MANDATORY) | spec |
| `specia design` | Architecture design (optional) | spec |
| `specia tasks` | Generate tasks with mitigations | review (non-stale) |
| `specia audit` | Post-implementation code audit | tasks complete, review |
| `specia done` | Archive completed change | tasks + audit (if policy=required) |

### Shortcuts

| Command | Purpose |
|---------|---------|
| `specia continue <change>` | Show next phase to run |
| `specia ff <change>` | Fast-forward through all phases |

### Discovery

| Command | Purpose |
|---------|---------|
| `specia --list` | List all changes with current phase |
| `specia --search <query>` | Search past specs and findings |
| `specia stats [change]` | Show token usage and cost |

### Guardian Hooks

| Command | Purpose |
|---------|---------|
| `specia hook install` | Install pre-commit hook |
| `specia hook uninstall` | Remove Guardian hook (preserves other hooks) |
| `specia hook status` | Check hook installation and integrity |

### Output Formats

**Always use `--format json` when parsing output programmatically:**

```bash
specia review my-change --format json
```

For human-readable output:
```bash
specia review my-change --format markdown
```

Verbosity flags: `-v, -vv, -vvv`

## Orchestration Pattern

When the user asks to create a new change:

1. Run `specia new <change-name> --intent "..." --scope "..." --format json`
   - Include `--skip-audit` only if user explicitly requests opt-out
2. Run `specia spec <change-name> --format json < spec.json` with structured requirements
   - Ask user for requirements if not provided
3. *(Optional)* Run `specia design <change-name> --format json` to create an architecture design
   - First call returns template, fill it in, second call saves it
   - Skip for simple changes
4. Run `specia review <change-name> --format json`
   - First call returns a prompt, analyze the spec (+ design if present)
   - Then run again with `< review-result.json` containing your `review_result`
5. Run `specia tasks <change-name> --format json` — generates implementation tasks with security mitigations
6. Help the user implement the tasks
7. Run `specia audit <change-name> --format json`
   - First call returns audit prompt with spec + abuse cases + code
   - Analyze, then run again with `< audit-result.json`
   - *(Skipped if `audit_policy: "skipped"`)*
8. Run `specia done <change-name> --format json` to archive

When the user asks to continue an existing change:

1. Run `specia continue <change-name> --format json`
2. It returns the next command to run and its parameters
3. Execute the recommended command

When the user wants to fast-forward:

1. Run `specia ff <change-name> --format json` (with optional propose inputs)
2. It runs all possible phases, stopping when LLM input is needed
3. Check `stopped_at` and `needs_input` in the response for what to do next

## Security Review Protocol

The review is **two-phase**:

**Phase 1**: Run `specia review <change-name> --format json`. The response contains a `review_prompt` with the spec content and analysis instructions based on the project's security posture.

**Phase 2**: Analyze the spec for security threats (STRIDE, OWASP, DREAD based on posture), then run the command again with your analysis:

```bash
specia review <change-name> --format json < review-result.json
```

Where `review-result.json` contains:
```json
{
  "risk_level": "medium",
  "findings": [
    {
      "threat_id": "T-001",
      "category": "Spoofing",
      "severity": "high",
      "description": "Refresh token theft via XSS",
      "owasp_mapping": ["A03:2021 - Injection"],
      "mitigation": "Store in httpOnly cookies, implement CSP"
    }
  ],
  "abuse_cases": [
    {
      "name": "Token Replay Attack",
      "attacker_goal": "Reuse stolen refresh token to maintain access",
      "attack_vector": "Intercept refresh token during network transit",
      "preconditions": ["MITM position", "No TLS or weak TLS"],
      "impact": "Persistent unauthorized access",
      "likelihood": "medium",
      "mitigations": ["Enforce HTTPS", "Token rotation", "Short TTL"]
    }
  ]
}
```

### Security Posture Levels

- **standard** — STRIDE light: top risks, risk levels, one-line mitigations
- **elevated** — Full STRIDE + OWASP Top 10 mapping, threat scenarios with attacker goals
- **paranoid** — STRIDE + OWASP + DREAD scoring (1-10 per dimension), prioritized mitigation plan

### Discovery Before Review

Search for similar patterns before running a review:

```bash
specia --search "JWT authentication" --format json
```

## Error Handling

All responses follow a structured envelope when `--format json` is used:

```json
{
  "status": "success" | "error",
  "data": { ... },
  "errors": [{ "code": "ERROR_CODE", "message": "..." }],
  "warnings": ["..."],
  "meta": { "command": "specia xxx", "duration_ms": 42 }
}
```

Key error codes to handle:
- `NOT_INITIALIZED` — Tell user to run `specia init`
- `MISSING_DEPENDENCY` — Run the required prior phase first
- `REVIEW_REQUIRED` — Must run `specia review` before `specia tasks`
- `REVIEW_STALE` — Spec changed since review; re-run `specia review`
- `AUDIT_REQUIRED` — Must run `specia audit` before `specia done` (or use `--force`)
- `TASKS_NOT_COMPLETE` — Must run `specia tasks` before `specia audit`
- `CHANGE_NOT_FOUND` — Check change name
- `VALIDATION_ERROR` — Fix input parameters

## File Structure

```
.specia/
  config.yaml          # Project config (posture, stack, conventions)
  context.md           # Project summary for agents
  .guardian-integrity   # SHA-256 + HMAC integrity data for Guardian hook
  .guardian-audit-log   # Append-only audit trail for Guardian operations
  changes/
    {name}/
      proposal.md      # What and why
      spec.md          # Requirements + scenarios
      design.md        # Architecture design (optional)
      review.md        # Security analysis
      tasks.md         # Implementation tasks
      audit.md         # Post-implementation code audit
      debate.md        # Debate transcript (optional)
      state.yaml       # Current phase + history + audit_policy
  specs/
    {archived}.md      # Completed specs (with review + audit frontmatter)
```

## Audit Phase

The audit is **mandatory by default**. It verifies implemented code against the spec and security abuse cases.

- **Policy**: `audit_policy: "required"` (default) or `"skipped"` — set only at propose time via `--skip-audit`
- **Immutable**: Cannot be changed after proposal creation
- **Gate**: `specia done` returns `AUDIT_REQUIRED` error if audit is missing and policy is `"required"`
- **Override**: `specia done --force` bypasses the gate (emergency use, heavily logged)
- **Two-phase**: Like review, first call returns a prompt with spec + code + abuse cases, second call saves the analysis
- **Smart cache**: Returns cached result if code hasn't changed; use `--force` to re-audit

### Audit verifies:
1. Requirement satisfaction (pass/fail/partial per requirement with code evidence)
2. Security finding mitigations from the review
3. Abuse case countermeasures (verified/unverified per abuse case)

**Example audit submission format:**
```json
{
  "verdict": "pass",
  "requirements_coverage": {
    "satisfied": ["REQ-001", "REQ-002"],
    "partial": ["REQ-003"],
    "missing": []
  },
  "abuse_cases_coverage": {
    "mitigated": ["Token Replay Attack", "XSS Token Theft"],
    "partial": ["Session Fixation"],
    "unmitigated": []
  },
  "findings": [
    {
      "type": "security",
      "severity": "medium",
      "location": "internal/auth/refresh.go:45",
      "issue": "Token rotation not atomic",
      "recommendation": "Use transaction to ensure rotation atomicity"
    }
  ],
  "recommendations": [
    "Add rate limiting to refresh endpoint",
    "Implement monitoring for unusual refresh patterns"
  ]
}
```

## Debate Phase (Optional)

Structured three-agent debate to stress-test security review findings:

- **Offensive** (Red Team) — Argues findings are more severe
- **Defensive** (Blue Team) — Argues mitigations are sufficient
- **Judge** — Determines consensus severity

Use after review, before tasks. Most useful for elevated/paranoid posture or ambiguous findings.

```bash
specia debate my-change --max-rounds 3 --max-findings 10 --format json
```

Multi-round per finding (default 3 rounds, up to 10 findings). Updates `review.md` with consensus and creates `debate.md` transcript.

## Guardian Pre-Commit Hooks

Pre-commit hook for spec compliance enforcement:

```bash
# Install
specia hook install --mode warn --format json

# Uninstall (preserves other hooks)
specia hook uninstall --format json

# Check status
specia hook status --format json
```

- **Modes**: `warn` (default, allows commit with warnings) or `strict` (blocks non-compliant commits)
- **Integrity**: SHA-256 + HMAC verification (machine-bound); tamper detection with audit logging
- **Coexistence**: Marker blocks (`# VT-SPEC GUARDIAN START/END`) for husky/lint-staged compatibility

## Key Constraints

1. Security review is **mandatory** — no skip flag exists
2. Audit is **mandatory by default** — `specia done` blocks without it; opt-out only at propose time
3. Phase order is **enforced** via state.yaml
4. Stale reviews **block** task generation
5. File-first — works without external dependencies
6. No `team_size` field — removed from spec
7. Design phase is **optional** — `specia design` sits between spec and review but can be skipped
8. Debate is **optional** — enhances review quality, does not gate the workflow

## Orchestrator Pattern (v0.2)

For substantial multi-phase changes, use the **sub-agent delegation pattern** to prevent context bloat:

- **You** become a thin coordinator: track state, delegate phases, synthesize results
- **Sub-agents** (via Task tool) execute each phase: they run CLI commands, read `.specia/` artifacts, and return structured summaries
- **Context stays small**: ~1 paragraph per phase instead of full artifact content

### When to Use

| Scenario | Pattern |
|----------|---------|
| Multi-phase workflow (new change → full cycle) | Orchestrator |
| Complex feature with design + review | Orchestrator |
| Long session (6+ CLI calls expected) | Orchestrator |
| Quick status check (`specia continue`) | Direct |
| Single-phase operation | Direct |
| No Task tool available | Direct (fallback) |

### Sub-Agent Delegation Flow

```
USER: "New change: jwt-auth"

COORDINATOR (you):
  1. Delegate PROPOSE → sub-agent runs specia propose → returns summary
  2. Delegate SPEC → sub-agent runs specia spec → returns summary
  3. Ask user: "Skip design or create architecture doc?"
  4. Delegate DESIGN (if yes) → sub-agent runs specia design → returns summary
  5. Delegate REVIEW → sub-agent performs security analysis → returns summary
  6. Delegate TASKS → sub-agent runs specia tasks → returns summary
  7. Report results to user
```

**Sub-agent prompt template:**
```
Execute the REVIEW phase for SpecIA change 'jwt-auth':
1. Run: specia review jwt-auth --format json
2. Parse the JSON output to get review_prompt
3. Perform STRIDE/OWASP analysis on the spec
4. Create review-result.json with your findings
5. Run: specia review jwt-auth --format json < review-result.json
6. Return: status, risk_level, findings summary, next_recommended
```

### Recovery After Compaction

If context is lost, delegate a recovery sub-agent to read `.specia/changes/{name}/state.yaml` and reconstruct phase summaries from artifact files.

**Full orchestrator instructions:** Load `skills/orchestrator/ORCHESTRATOR.md` for complete sub-agent launch templates, context-passing protocol, anti-patterns, and self-test checklist.

## MCP Server (Optional)

For advanced users, SpecIA includes an MCP server interface with tools like `specia_review`, `specia_audit`, etc. The CLI is the primary interface — use MCP only if your agent environment requires it.

**Recommendation**: Use CLI unless you have a specific need for MCP integration.
