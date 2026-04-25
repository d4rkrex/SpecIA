# SpecIA — Security-Aware Spec-Driven Development

> **Generic Agent Skill** — Compatible with any AI agent that can execute bash commands

## Overview

SpecIA is a **CLI tool** that enforces a spec-driven development workflow with a **mandatory security review**. All artifacts are stored in `.specia/` at the project root. An optional MCP server interface exists for advanced users, but the CLI is the primary interface.

## Workflow

```
init → propose → spec ──────→ REVIEW → tasks → AUDIT → done
                   │                ▲
                   └─→ design ──────┘
                      (optional)
```

Every phase must complete before the next can begin. The security review is a **mandatory** hard gate — `specia tasks` will refuse to run without a valid, non-stale review. The design phase is optional — use it for complex architectural changes. The audit phase is **mandatory by default** — `specia done` blocks without a completed audit unless opted out at proposal time (`--skip-audit`) or overridden with `--force`.

## Command Reference

### specia init

Initialize SpecIA in a project. Run once per project.

**Interactive mode:**
```bash
specia init
```
Prompts for all inputs.

**Non-interactive mode:**
```bash
specia init \
  --project-description "One-sentence project description" \
  --primary-stack "Node.js / TypeScript" \
  --conventions "error wrapping,structured logging" \
  --security-posture elevated \
  --format json
```

**Flags:**
- `--project-description <text>` (required in non-interactive mode)
- `--primary-stack <text>` (optional, auto-detected if omitted)
- `--conventions <comma-separated>` (optional)
- `--security-posture <level>` (optional: `standard` (default), `elevated`, `paranoid`)
- `--format <format>` (optional: `json` or `markdown`)
- `-v, -vv, -vvv` — Verbosity levels

**Creates:** `.specia/config.yaml`, `.specia/context.md`, `.specia/changes/`, `.specia/specs/`

---

### specia propose (alias: specia new)

Create a change proposal.

```bash
specia new add-rate-limiting \
  --intent "Protect API endpoints from abuse" \
  --scope "api/middleware,api/routes" \
  --approach "Token bucket algorithm with Redis" \
  --format json
```

Or with `propose` (identical):
```bash
specia propose add-rate-limiting \
  --intent "Protect API endpoints from abuse" \
  --scope "api/middleware,api/routes" \
  --skip-audit \
  --format json
```

**Flags:**
- `--intent <text>` (required)
- `--scope <comma-separated>` (required)
- `--approach <text>` (optional)
- `--skip-audit` (optional) — Opt out of mandatory post-implementation audit. **This is the only time audit policy can be set — it is immutable after proposal creation.**
- `--format <format>` (optional: `json` or `markdown`)

**Creates:** `.specia/changes/{name}/proposal.md`, `.specia/changes/{name}/state.yaml` (includes `audit_policy: "required"` or `"skipped"`)

---

### specia spec

Write specifications with requirements and Given/When/Then scenarios.

**Interactive mode:**
```bash
specia spec add-rate-limiting
# Opens editor with template
```

**Non-interactive mode:**
```bash
specia spec add-rate-limiting --format json < spec.json
```

Where `spec.json` contains:
```json
{
  "requirements": [
    {
      "name": "Rate Limit Enforcement",
      "description": "System enforces rate limits per API key",
      "scenarios": [
        {
          "name": "Normal usage within limits",
          "given": "User has made 90 requests in the last minute",
          "when": "User makes another request",
          "then": "Request succeeds with X-RateLimit headers"
        }
      ]
    }
  ]
}
```

**Requires:** Proposal must exist.  
**Creates:** `.specia/changes/{name}/spec.md`

---

### specia design (v0.2, optional)

Create an architecture design document. Two-phase protocol:

**Phase 1 — Get design template:**
```bash
specia design add-rate-limiting --format json
```
Returns design template with sections for approach, decisions, data flow, interfaces.

**Phase 2 — Submit design:**
```bash
specia design add-rate-limiting --format json < design.md
```

**Requires:** Spec must exist.
**Creates:** `.specia/changes/{name}/design.md`

Skip this phase for simple changes. It is NOT required — review works without it. When present, design context is included in the security review.

---

### specia review

Mandatory security review. Two-phase protocol:

**Phase 1 — Get review prompt:**
```bash
specia review add-rate-limiting --format json
```
Returns `review_prompt` with spec content and analysis instructions.

**Phase 2 — Submit analysis:**
```bash
specia review add-rate-limiting --format json < review-result.json
```

Where `review-result.json` contains your structured security analysis (see format below).

**Flags:**
- `--force` — Force re-review even if cached
- `--format <format>` (optional: `json` or `markdown`)

**Requires:** Spec must exist.  
**Creates:** `.specia/changes/{name}/review.md`

**Security posture controls review depth:**
| Posture | Analysis |
|---------|----------|
| standard | STRIDE light — top risks, risk levels, one-line mitigations |
| elevated | Full STRIDE + OWASP Top 10 mapping, threat scenarios |
| paranoid | STRIDE + OWASP + DREAD scoring, prioritized mitigation plan |

**Before reviewing, search for similar patterns:**
```bash
specia --search "rate limiting" --format json
```

---

### specia tasks

Generate implementation tasks with security mitigations from the review.

```bash
specia tasks add-rate-limiting --format json
```

**Flags:**
- `--include-mitigations` (default: true)
- `--format <format>` (optional: `json` or `markdown`)

**Requires:** Review must exist AND not be stale (spec hash must match).  
**Creates:** `.specia/changes/{name}/tasks.md`

**Error codes:**
- `REVIEW_REQUIRED` — No review.md found
- `REVIEW_STALE` — Spec changed since last review

---

### specia done

Archive a completed change.

```bash
specia done add-rate-limiting --format json
```

**Flags:**
- `--force` — Emergency override to bypass the mandatory audit gate (heavily logged)
- `--format <format>` (optional: `json` or `markdown`)

**Requires:** All phases complete (tasks phase with status complete, plus audit if `audit_policy` is `"required"`).  
**Actions:** Copies spec to `.specia/specs/{name}.md` with review + audit frontmatter, removes change directory.

**Error codes:**
- `AUDIT_REQUIRED` — Audit policy is `"required"` but no completed audit exists. Run `specia audit` first, or use `--force` for emergency override.
- `INCOMPLETE_CHANGE` — Not all phases are complete.

---

### specia continue

Read state.yaml and return the next phase to execute.

```bash
specia continue add-rate-limiting --format json
```

Returns: `next_command`, `next_params`, `message` — tells the agent what to run next.

---

### specia ff

Fast-forward through all phases in sequence.

```bash
specia ff add-rate-limiting \
  --intent "..." \
  --scope "..." \
  --approach "..." \
  --format json
```

**Flags:**
- `--intent <text>` (optional, for propose phase)
- `--scope <comma-separated>` (optional, for propose phase)
- `--approach <text>` (optional, for propose phase)
- `--skip-audit` (optional, default: false) — Passed through to propose phase. Warns prominently if used.
- `--format <format>` (optional: `json` or `markdown`)

**Behavior:** Runs propose → spec → review → tasks, skipping completed phases. **Stops** when a phase needs LLM input (spec requires requirements, review requires analysis). After completion, reports whether audit is mandatory or opted out.

Returns: `phases_completed`, `phases_skipped`, `stopped_at`, `needs_input`

---

### specia --search

Search archived specs and past security findings.

```bash
specia --search "JWT authentication" --limit 10 --format json
```

**Flags:**
- `--search <query>` (required)
- `--limit <number>` (optional, default: 10)
- `--format <format>` (optional: `json` or `markdown`)

---

### specia --list

List all changes with their current phase.

```bash
specia --list --format json
```

---

### specia stats

Show token usage and cost summary.

```bash
specia stats add-rate-limiting --format json
```

If change name is omitted, shows all changes.

---

### specia audit

Post-implementation code audit. Verifies that code satisfies spec requirements and addresses security abuse cases from the review. Two-phase protocol:

**Phase 1 — Get audit prompt:**
```bash
specia audit add-rate-limiting --format json
```

**Optional flags:**
- `--files src/auth.ts,src/middleware.ts` — Explicit file list (auto-discovered from git diff if omitted)
- `--max-files 50` (default: 50, max: 200)
- `--max-tokens 100000` (default: 100000, max: 500000)
- `--force` — Bypass cache and re-audit
- `--format <format>` (optional: `json` or `markdown`)

Returns: `audit_prompt` with spec content, abuse cases from review, code files, and posture-specific instructions. Also returns `spec_hash` and `audit_hash` for staleness tracking.

**Phase 2 — Submit analysis:**
```bash
specia audit add-rate-limiting --format json < audit-result.json
```

Where `audit-result.json` contains your structured audit analysis (see format below).

**Requires:** Tasks phase complete, review must exist (reads findings and abuse cases).  
**Creates:** `.specia/changes/{name}/audit.md`

**Smart caching:** If code hasn't changed (audit_hash matches) and posture hasn't changed, returns cached result. Use `--force` to re-audit.

**Security posture controls audit depth:**
| Posture | Analysis |
|---------|----------|
| standard | Verify each requirement, check top abuse cases, brief evidence |
| elevated | ALL requirements and ALL abuse cases, OWASP patterns in code, detailed evidence |
| paranoid | Everything from elevated + data flow tracing, DREAD-scored risk, test coverage analysis |

---

### specia debate

Structured security debate on review findings. Three AI agents (offensive/defensive/judge) debate each finding to refine severity and mitigations. Optional — enhances review quality but not required for the workflow.

**Multi-round protocol:**

**First call:**
```bash
specia debate add-rate-limiting \
  --max-rounds 3 \
  --max-findings 10 \
  --provider anthropic \
  --format json
```

Returns: `debate_prompt` with the agent prompt (offensive, defensive, or judge), `instructions`, `progress`.

**Subsequent calls:**
```bash
specia debate add-rate-limiting --format json < agent-response.json
```

Returns: Next agent prompt, OR debate completion with consensus summary.

**Completion result:**
- `findings_debated` — How many findings were debated
- `consensus` — Array of findings with `original_severity`, `consensus_severity`, `consensus_reached`, `needs_human_review`, `rounds_used`
- `files_updated` — Updated `review.md` and new `debate.md` transcript

**Requires:** Completed review phase.

---

### specia hook install

Install the Guardian pre-commit hook for spec compliance enforcement.

```bash
specia hook install --mode warn --format json
```

**Flags:**
- `--mode <mode>` (optional: `strict` or `warn` (default)) — `warn` allows commit with warnings, `strict` blocks non-compliant commits
- `--exclude <patterns>` (optional, comma-separated) — File patterns to exclude from validation
- `--format <format>` (optional: `json` or `markdown`)

**Features:**
- Uses marker blocks (`# VT-SPEC GUARDIAN START/END`) for coexistence with other hooks (husky, lint-staged)
- Idempotent — safe to run multiple times, updates mode on reinstall
- SHA-256 + HMAC integrity verification (machine-bound, tamper-resistant)
- Append-only audit log at `.specia/.guardian-audit-log`

**Creates:** `.git/hooks/pre-commit` (or appends to existing), `.specia/.guardian-integrity`

---

### specia hook uninstall

Remove the Guardian pre-commit hook. Preserves other hooks in the same pre-commit file.

```bash
specia hook uninstall --format json
```

**Behavior:** Removes only the SpecIA Guardian marker block. If other hook content exists, it is preserved. If only the Guardian block existed, the file is deleted.

---

### specia hook status

Check Guardian pre-commit hook installation status.

```bash
specia hook status --format json
```

**Returns:**
- `installed` (boolean) — Whether the Guardian hook is present
- `mode` (string) — Current mode (`"strict"` or `"warn"`)
- `hook_path` (string) — Path to the hook file
- `git_repo` (boolean) — Whether the project is a git repository
- `integrity_status` (enum: `"valid"` | `"tampered"` | `"missing_baseline"` | `"error"`) — Hook integrity verification result

## Output Format

When `--format json` is used, every command returns a structured JSON envelope:

```json
{
  "status": "success" | "error" | "cached",
  "data": { /* command-specific */ },
  "errors": [{ "code": "ERROR_CODE", "message": "Human-readable" }],
  "warnings": ["Optional warnings"],
  "meta": { "command": "specia xxx", "change": "name", "duration_ms": 42 }
}
```

## Error Codes

| Code | Meaning | Action |
|------|---------|--------|
| `VALIDATION_ERROR` | Bad input | Fix parameters |
| `NOT_INITIALIZED` | No .specia/ | Run specia init |
| `ALREADY_INITIALIZED` | .specia/ exists | Already set up |
| `CHANGE_EXISTS` | Duplicate name | Pick different name |
| `CHANGE_NOT_FOUND` | No such change | Check spelling |
| `MISSING_DEPENDENCY` | Prior phase incomplete | Run the required phase |
| `REVIEW_REQUIRED` | No review for tasks | Run specia review |
| `REVIEW_STALE` | Spec changed post-review | Re-run specia review |
| `AUDIT_REQUIRED` | Audit missing for done | Run specia audit (or `--force` for emergency) |
| `TASKS_NOT_COMPLETE` | Audit called before tasks | Run specia tasks first |
| `INCOMPLETE_CHANGE` | Can't archive yet | Complete all phases |
| `INVALID_CONFIG` | Bad config.yaml | Fix configuration |
| `IO_ERROR` | File system error | Check permissions |

## File Structure

```
.specia/
  config.yaml          # Project configuration
  context.md           # Project summary
  .guardian-integrity   # SHA-256 + HMAC integrity data for Guardian hook
  .guardian-audit-log   # Append-only audit trail for Guardian operations
  changes/
    {change-name}/
      proposal.md      # Change proposal
      spec.md          # Requirements + scenarios
      design.md        # Architecture design (optional)
      review.md        # Security review (YAML frontmatter + findings)
      tasks.md         # Implementation tasks + mitigations
      audit.md         # Post-implementation code audit (mandatory by default)
      debate.md        # Debate transcript (optional, if specia debate was run)
      state.yaml       # Phase tracking + history + audit_policy
  specs/
    {archived-name}.md # Archived completed specs (with review + audit frontmatter)
```

## Audit Phase

The audit phase verifies that implemented code satisfies spec requirements and addresses security abuse cases from the review.

### Audit Policy

- **Mandatory by default**: `audit_policy: "required"` is set in `state.yaml` when a change is created
- **Opt-out only at propose time**: Pass `--skip-audit` to `specia propose` or `specia new` — this sets `audit_policy: "skipped"`
- **Immutable**: Once set, `audit_policy` cannot be changed by any subsequent phase
- **Done gate**: `specia done` blocks with `AUDIT_REQUIRED` if audit is missing and policy is `"required"`
- **Emergency override**: `specia done --force` bypasses the audit gate (heavily logged)

### What the Audit Verifies

1. **Requirement satisfaction** — Each spec requirement mapped to code with pass/fail/partial verdicts and evidence
2. **Security finding mitigations** — Findings from the security review checked against the implementation
3. **Abuse case countermeasures** — Attacker-centric scenarios from the review verified in the code

### Audit Output

- **Verdict**: `pass` | `partial` | `fail`
- **Requirements matrix**: Per-requirement coverage with code references
- **Abuse case verification**: Per-abuse-case status with evidence
- **Recommendations**: Actionable items for gaps

## Debate Phase (Optional)

The debate phase stress-tests security review findings through a structured three-agent debate.

### When to Use

- After review, before tasks (does not block the workflow)
- Elevated or paranoid security posture
- Contentious or ambiguous findings that need refinement
- When severity calibration is important

### How It Works

1. **Offensive agent (Red Team)** — Argues findings are more severe, proposes attack scenarios
2. **Defensive agent (Blue Team)** — Argues mitigations are sufficient, proposes countermeasures
3. **Judge** — Synthesizes arguments, determines consensus severity and whether human review is needed

Debate runs per-finding, up to `--max-rounds` (default 3) per finding and `--max-findings` (default 10) total. Consensus updates `review.md` and produces a `debate.md` transcript.

## Guardian Pre-Commit Hooks

Guardian is a pre-commit hook that validates spec compliance before allowing commits.

### Modes

- **warn** (default) — Runs validation, shows warnings, allows commit
- **strict** — Blocks commits that fail validation

### Integrity Verification

- SHA-256 hash of hook content computed at install time
- HMAC with machine-derived key (hostname + project path) for cross-machine tamper detection
- Integrity checked on every commit before validation runs
- Tampering logged to append-only audit log at `.specia/.guardian-audit-log`
- In strict mode, tampered hooks block the commit; in warn mode, a warning is shown

### Coexistence

Uses marker blocks (`# VT-SPEC GUARDIAN START/END`) so it coexists cleanly with husky, lint-staged, and other pre-commit tools. Install and uninstall only affect the Guardian block.

## Constraints

1. **Security review is mandatory** — No configuration to skip it
2. **Audit is mandatory by default** — `specia done` blocks without it; opt-out only at propose time via `--skip-audit`
3. **Phase order is enforced** — Each phase checks state.yaml
4. **Stale reviews block tasks** — SHA256 hash of spec must match
5. **File-first** — Works entirely from .specia/ files without external services
6. **No team_size** — This field does not exist in the schema
7. **Design phase is optional** — `specia design` sits between spec and review but can be skipped
8. **Debate is optional** — Enhances review quality but does not gate the workflow

## Orchestrator Pattern (v0.2)

For agents with **sub-agent/Task tool support**, use the orchestrator delegation pattern for multi-phase workflows:

### The Pattern

- **Coordinator** (you): Tracks state, passes change_name + summaries, asks user for decisions
- **Sub-agents** (via Task tool): Run CLI commands, read `.specia/` artifacts, return structured summaries
- **Result**: Coordinator context stays thin (~1 paragraph per phase) even after 6+ phases

### When to Use

- **Orchestrator**: Multi-phase workflows, complex features, long sessions
- **Direct execution**: Status checks, single-phase ops, agents without Task tool

### Quick Reference

```
For each phase, delegate to a sub-agent with CLI instructions:
  "Execute the {PHASE} phase for SpecIA change '{NAME}'.
   Run: specia {command} {NAME} --format json
   Parse the JSON output.
   Return: status, summary, artifacts_created, next_recommended."
```

### Recovery

After compaction or new session, delegate a sub-agent to read `.specia/changes/{name}/state.yaml` and reconstruct summaries from artifact files.

**Full orchestrator skill:** Load `skills/orchestrator/ORCHESTRATOR.md` for complete sub-agent launch templates, context-passing protocol, anti-patterns, and self-test checklist.

## MCP Server (Optional)

For advanced users, SpecIA includes an MCP server interface. The CLI is the primary interface — use MCP only if your agent environment requires it.

All CLI commands have equivalent MCP tool calls (e.g., `specia review` → `specia_review` tool). See the MCP-specific documentation for details.

**Recommendation**: Use CLI unless you have a specific need for MCP integration.
