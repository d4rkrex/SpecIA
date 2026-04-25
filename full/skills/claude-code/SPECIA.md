# SpecIA — Security-Aware Spec-Driven Development

> **Skill for Claude Code** — Load this skill to orchestrate the SpecIA workflow via CLI commands.

## What is SpecIA?

SpecIA is a spec-driven development workflow with **mandatory security review and audit gates**. Every code change goes through: propose → spec → review → tasks → audit → done. The security review cannot be skipped. The audit is mandatory by default (opt-out only at propose time).

SpecIA is a **CLI tool** that you run via bash commands. All artifacts live in `.specia/` at the project root. An optional MCP server interface exists for advanced users, but the primary interface is the command-line.

## Workflow DAG

```
init → propose → spec ──────→ REVIEW → tasks → AUDIT → done
                   │                ▲
                   └─→ design ──────┘
                      (optional)
```

- **init** — One-time project setup (4 questions)
- **propose** — Define what you're building and why (accepts `skip_audit` to opt out of mandatory audit)
- **spec** — Write requirements with Given/When/Then scenarios
- **design** — *(optional)* Architecture decisions, data flow, interfaces
- **review** — Mandatory security analysis (STRIDE/OWASP/DREAD based on posture)
- **tasks** — Generate implementation tasks with security mitigations baked in
- **audit** — Post-implementation code audit (mandatory by default, opt-out at propose time)
- **done** — Archive the completed change to `.specia/specs/` (blocks without audit unless opted out or `force: true`)

## Available CLI Commands

### Core Commands

| Command | Purpose | Requires |
|---------|---------|----------|
| `specia init` | Initialize project with 4 questions | Nothing |
| `specia propose` | Create change proposal | init |
| `specia spec` | Write specifications | proposal |
| `specia review` | Security review (MANDATORY) | spec |
| `specia tasks` | Generate tasks with mitigations | review (non-stale) |
| `specia design` | Architecture design (optional) | spec |
| `specia audit` | Post-implementation code audit | tasks complete, review |
| `specia done` | Archive completed change | tasks + audit (if policy=required) |

### Shortcut Commands

| Command | Purpose |
|---------|---------|
| `specia new` | Alias for `specia propose` |
| `specia continue` | Show next phase to run |
| `specia ff` | Fast-forward through all phases |

### Discovery Commands

| Command | Purpose |
|---------|---------|
| `specia --list` | List all changes with their current phase |
| `specia --search <keyword>` | Search past specs and security findings |
| `specia stats [change]` | Show token usage and cost summary |

### Debate (Optional)

| Command | Purpose |
|---------|---------|
| `specia debate` | Structured 3-agent debate on review findings |

### Guardian Hooks

| Command | Purpose |
|---------|---------|
| `specia hook install` | Install pre-commit hook for spec compliance |
| `specia hook uninstall` | Remove Guardian hook (preserves other hooks) |
| `specia hook status` | Check hook installation and integrity |

### Output Formats

All commands support these flags:
- `--format json` — Structured output for AI agent parsing (default when stdout is not a TTY)
- `--format markdown` — Human-readable formatted output
- `-v, -vv, -vvv` — Increase verbosity for debugging

## How to Use

### First Time — Project Initialization

```bash
specia init \
  --project-description "Brief description of the project" \
  --primary-stack "Node.js / TypeScript" \
  --conventions "error wrapping,structured logging" \
  --security-posture elevated \
  --format json
```

Or use interactive mode (no flags — prompts for input):
```bash
specia init
```

### Starting a New Change

```bash
specia new add-rate-limiting \
  --intent "Protect API endpoints from abuse" \
  --scope "api/middleware,api/routes" \
  --approach "Token bucket algorithm with Redis" \
  --format json
```

Or with the propose command (identical):
```bash
specia propose add-rate-limiting \
  --intent "Protect API endpoints from abuse" \
  --scope "api/middleware,api/routes" \
  --skip-audit \
  --format json
```

### Writing Specs

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

Or use interactive mode:
```bash
specia spec add-rate-limiting
# Opens editor with template
```

### Security Review (Two-Phase)

The review is a two-phase process:

1. **First call** — Returns a review prompt with the spec content and posture instructions:
   ```bash
   specia review add-rate-limiting --format json
   ```
   
   Output includes `review_prompt` — analyze the spec for security threats.

2. **Second call** — Submit your analysis:
   ```bash
   specia review add-rate-limiting --format json < review-result.json
   ```
   
   Where `review-result.json` contains your structured security analysis.

**Quick discovery**: Before running review, check if similar patterns were reviewed before:
```bash
specia --search "rate limiting" --format json
```

### Architecture Design (Optional, v0.2)

The design phase is optional. Use it for complex changes with significant architecture decisions.

**Phase 1 — Get template:**
```bash
specia design add-rate-limiting --format json
```
Response includes a design template with sections for approach, decisions, data flow, interfaces.

**Phase 2 — Submit design:**
```bash
specia design add-rate-limiting --format json < design.md
```

Skip this phase for small changes. Go directly from spec to review.

### Generating Tasks

```bash
specia tasks add-rate-limiting --format json
```

This will fail with error code `REVIEW_REQUIRED` if no review exists, or `REVIEW_STALE` if the spec changed since the last review.

### Post-Implementation Audit (Two-Phase)

The audit is mandatory by default. Like the review, it uses a two-phase protocol:

1. **First call** — Returns audit prompt with spec, abuse cases, and code files:
   ```bash
   specia audit add-rate-limiting --format json
   ```
   
   Optional flags:
   - `--files src/auth.ts,src/middleware.ts` — Explicit file list (auto-discovered from git diff if omitted)
   - `--max-files 50` — Limit number of files
   - `--max-tokens 100000` — Token budget for audit
   
   Response includes `audit_prompt` with everything needed to analyze the code.

2. **Second call** — Submit your structured analysis:
   ```bash
   specia audit add-rate-limiting --format json < audit-result.json
   ```

**Smart caching:** Returns cached result if code hasn't changed. Use `--force` to re-audit.

### Archiving

```bash
specia done add-rate-limiting --format json
```

This will fail with `AUDIT_REQUIRED` if audit is mandatory (default) and hasn't been completed. Options:
- Run `specia audit` to complete the audit
- Use `--force` for emergency override (heavily logged)
- Audit can only be opted out at propose time via `--skip-audit`

### Using Shortcuts

- **specia continue** — When you're mid-workflow and need to know what's next:
  ```bash
  specia continue add-rate-limiting --format json
  ```
  Reads `state.yaml` and tells you the next command to run.

- **specia ff** — When you want to run as many phases as possible in one go:
  ```bash
  specia ff add-rate-limiting --format json
  ```
  Stops when it reaches a phase that needs your input (spec content or security analysis).

- **specia --list** — See all changes and their current phase:
  ```bash
  specia --list --format json
  ```

## Security Posture Levels

| Level | What Happens |
|-------|-------------|
| **standard** | STRIDE light — top risks, one-line mitigations |
| **elevated** | Full STRIDE + OWASP Top 10 mapping, threat scenarios |
| **paranoid** | STRIDE + OWASP + DREAD scoring, prioritized mitigation plan |

All levels produce a mandatory review. Posture controls depth, not whether review runs.

## Error Codes

If a command fails (non-zero exit code), check the error message for these codes:

| Code | Action |
|------|--------|
| `NOT_INITIALIZED` | Run `specia init` first |
| `MISSING_DEPENDENCY` | Complete the required prior phase |
| `REVIEW_REQUIRED` | Run `specia review` before `specia tasks` |
| `REVIEW_STALE` | Spec changed — re-run `specia review` |
| `AUDIT_REQUIRED` | Run `specia audit` before `specia done` (or use `--force`) |
| `TASKS_NOT_COMPLETE` | Run `specia tasks` before `specia audit` |
| `CHANGE_NOT_FOUND` | Check the change name spelling |
| `CHANGE_EXISTS` | That change name is taken — pick another |
| `INCOMPLETE_CHANGE` | Complete all phases before `specia done` |
| `VALIDATION_ERROR` | Check the input parameters |

## Key Rules

1. **Security review is MANDATORY** — there is no flag to skip it
2. **Audit is MANDATORY by default** — `specia done` blocks without it; opt-out only at propose time via `--skip-audit`
3. **Phase order is enforced** — you cannot skip phases
4. **Stale reviews block tasks** — if you edit the spec, re-review
5. **File-first architecture** — everything works without external dependencies
6. **No team_size** — this field does not exist
7. **Design phase is optional** — `specia design` between spec and review, can be skipped
8. **Debate is optional** — enhances review quality but does not gate the workflow
9. **CLI-first interface** — MCP server available for advanced users, but CLI is primary interface
10. **JSON output for agents** — Always use `--format json` when parsing output programmatically

## Audit Phase

The audit verifies that implemented code satisfies spec requirements and addresses security abuse cases from the review.

### Audit Policy
- **Default**: `audit_policy: "required"` in `state.yaml` — set automatically when change is created
- **Opt-out**: Pass `skip_audit: true` to `specia_propose` or `specia_new` — sets `audit_policy: "skipped"`
- **Immutable**: Cannot be changed after proposal creation
- **Done gate**: `specia_done` returns `AUDIT_REQUIRED` if audit is missing and policy is `"required"`
- **Emergency override**: `specia_done` with `force: true` bypasses the gate

### What It Verifies
1. **Requirement satisfaction** — Each spec requirement mapped to code (pass/fail/partial)
2. **Security finding mitigations** — Review findings checked against implementation
3. **Abuse case countermeasures** — Attacker-centric scenarios verified in code

### Sub-Agent Delegation
For the audit phase, delegate to a sub-agent that loads `agents/claude-code/agents/specia-audit.md`. The sub-agent handles both phases of the two-phase protocol using CLI commands.

## Debate Phase (Optional)

Structured three-agent debate to refine security review findings:

- **When**: After review, before tasks. Does not block workflow.
- **Agents**: Offensive (Red Team), Defensive (Blue Team), Judge
- **Use for**: Elevated/paranoid posture, ambiguous findings, severity calibration
- **Output**: Updated `review.md` + `debate.md` transcript
- **Multi-round**: Default 3 rounds per finding, up to 10 findings

## Guardian Pre-Commit Hooks

Pre-commit hook for spec compliance enforcement:

- **`specia hook install`** — Install with `--mode warn` (default) or `--mode strict`. Supports spec validation config.
  ```bash
  specia hook install --mode warn --format json
  ```
  
- **`specia hook uninstall`** — Removes only Guardian block, preserves other hooks (husky, lint-staged)
  ```bash
  specia hook uninstall --format json
  ```
  
- **`specia hook status`** — Reports installation, mode, integrity status, and cache stats
  ```bash
  specia hook status --format json
  ```

- **Integrity**: SHA-256 + HMAC verification (machine-bound); tamper detection with append-only audit log
- **Coexistence**: Marker blocks (`# VT-SPEC GUARDIAN START/END`) for clean hook sharing

## Orchestrator Pattern (v0.2)

For complex, multi-phase changes, use the **orchestrator/sub-agent delegation pattern** instead of executing all phases inline. This prevents context bloat in long sessions.

**How it works:**
- You become a thin **coordinator** — tracking state and delegating
- Each phase (propose, spec, design, review, tasks, audit, done) runs in a **sub-agent** via the Task tool
- Sub-agents run CLI commands and read full artifacts from `.specia/` files — you only pass summaries
- Your coordinator context stays small even after 6+ phases

**When to use it:**
- Multi-phase workflows (new change → full cycle)
- Complex features requiring design + review
- Long sessions where context preservation matters

**When NOT to use it:**
- Quick status checks (`specia continue`)
- Single-phase operations
- Agents without Task/sub-agent support

**Sub-agent launch pattern:**
When launching a sub-agent for a SpecIA phase, instruct it to run the appropriate CLI command with `--format json` for structured output parsing.

Example sub-agent prompt for review phase:
```
Run security review for change 'add-rate-limiting':
1. Execute: specia review add-rate-limiting --format json
2. Parse the JSON output to get review_prompt
3. Perform STRIDE/OWASP analysis
4. Execute: specia review add-rate-limiting --format json < review-result.json
5. Return: status, risk_level, findings summary, next_recommended
```

**Full instructions:** Load `skills/orchestrator/ORCHESTRATOR.md` for the complete orchestrator skill with sub-agent launch templates, recovery protocol, and self-test checklist.

## MCP Server (Optional)

For advanced users, SpecIA includes an MCP server interface. The CLI is the primary interface — use MCP only if your agent environment requires it.

To enable MCP mode, configure your agent to connect to the SpecIA MCP server. All CLI commands have equivalent MCP tool calls (e.g., `specia review` → `specia_review` tool).

**Recommendation**: Use CLI unless you have a specific need for MCP integration.
