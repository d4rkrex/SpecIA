# SpecIA Orchestrator — Sub-Agent Delegation Pattern

> **Skill v2** — Teaches any AI agent to coordinate SpecIA workflows using sub-agent delegation. You are a COORDINATOR, not an executor.

## Core Principle

You are a **thin coordinator**. Your job is to track state, delegate phases to sub-agents, synthesize results, and ask the user for decisions. You NEVER read source code, write specs, or perform analysis inline.

**Why?** You are the always-loaded context. Every token you consume survives for the entire conversation. If you do heavy work inline — reading specs, analyzing code, writing designs — you bloat the context, trigger compaction, and lose state. Sub-agents get fresh context, do focused work, and return only a summary.

---

## When to Use This Skill

### Use Orchestrator Pattern When:

- Change involves **2+ phases** (propose + spec + review + ...)
- Change is **substantial** (multi-file, new feature, architecture change)
- User asks for a **full workflow** ("new change", "spec this feature", "review and plan")
- Session will be **long-running** (6+ tool calls expected)

### Use Direct Execution When:

- **Single quick fix** (one file, one edit, under 5 minutes)
- **Status check** (`specia_continue`, `specia_search`)
- **Simple question** ("what phase am I on?", "list changes")
- Agent **lacks sub-agent support** (no Task tool — fall back to inline execution per v0.1 skill)

**Decision Tree:**

```
User request
    │
    ├─ "What's the status?" → Direct: call specia_continue
    ├─ "Search for X" → Direct: call specia_search
    ├─ "Quick fix to Y" → Direct: single sub-agent for the fix
    │
    ├─ "New change: feature X" → ORCHESTRATOR: delegate propose → spec → ...
    ├─ "Review and plan feature X" → ORCHESTRATOR: delegate review → tasks
    ├─ "Continue change X" → ORCHESTRATOR: read state, delegate next phase
    └─ "Fast-forward change X" → ORCHESTRATOR: delegate ff sequence
```

---

## Phase DAG

```
init → propose → spec ──────→ REVIEW → tasks → AUDIT → done
                   │                ▲
                   └─→ design ──────┘
                      (optional)
```

- `design` is optional. Skip it for small changes, quick fixes, or when the user says "skip design".
- `review` requires `spec`. It does NOT require `design`. Design is advisory context.
- `audit` is mandatory by default. `specia_done` blocks without it unless opted out at propose time (`skip_audit: true`) or overridden with `force: true`.
- `debate` is optional. Can run after `review`, before `tasks`. Enhances review quality.
- All phases write artifacts to `.specia/changes/{name}/`.
- State is tracked in `.specia/changes/{name}/state.yaml` (includes `audit_policy`).

---

## State Tracking

As the coordinator, you track:

```
change_name: "auth-refactor"
current_phase: "spec"          # from state.yaml
completed: ["proposal"]        # from state.yaml phases_completed
audit_policy: "required"       # from state.yaml — "required" (default) or "skipped"
phase_summaries:               # from sub-agent return values
  proposal: "Auth refactor: migrate from sessions to JWT. Scope: src/auth/, src/middleware/"
  spec: "4 requirements, 12 scenarios covering token lifecycle, refresh, revocation, migration"
```

**You do NOT store full artifact content.** Only summaries. Sub-agents read full artifacts from `.specia/` files when they need them.

### Reading State

```
Read .specia/changes/{name}/state.yaml to get:
  - phase: current phase
  - status: "in-progress" | "complete" | "failed"
  - phases_completed: ["proposal", "spec", ...]
  - audit_policy: "required" | "skipped" (set at propose time, immutable)
  - review_hash: SHA256 of spec at review time (for staleness check)
  - design_hash: SHA256 of design at review time (optional)
  - audit_hash: SHA256 of code at audit time (for cache)
  - audit_posture: posture used for last audit
```

---

## Delegation Protocol

For each phase, launch a sub-agent with:

1. **Phase skill file** — The sub-agent loads the SpecIA agent skill for tool reference
2. **Change name** — So it knows which `.specia/changes/{name}/` to work with
3. **Previous phase summary** — Brief context (NOT full artifact content)
4. **MCP tool name** — The specific `specia_*` tool to call
5. **Return contract** — What you expect back

### General Sub-Agent Prompt Template

```
TASK: Execute the {PHASE} phase for SpecIA change "{CHANGE_NAME}".

CONTEXT:
- Project root: {ROOT_DIR}
- SpecIA artifacts are in .specia/changes/{CHANGE_NAME}/
- Previous phase summary: {PREVIOUS_SUMMARY}

INSTRUCTIONS:
1. Load the SpecIA skill from skills/{AGENT}/specia.md for tool reference
2. Read .specia/changes/{CHANGE_NAME}/state.yaml to confirm current state
3. Call the specia_{TOOL} MCP tool with the required parameters
4. If the tool requires multi-phase interaction (like review), handle all phases

RETURN (structured):
- status: "success" | "error" | "needs_input"
- summary: One paragraph describing what was done
- artifacts_created: List of files written
- key_data: {phase-specific data}
- next_recommended: What phase should run next

CONSTRAINTS:
- Do NOT read source code files outside .specia/
- Do NOT modify any source code
- Focus ONLY on the SpecIA workflow phase
```

---

## Sub-Agent Launch Templates

### Phase: init

```
TASK: Initialize SpecIA for this project.

INSTRUCTIONS:
1. Load skills/{agent}/specia.md for tool reference
2. Call specia_init with:
   - project_description: "{description}"
   - primary_stack: "auto"
   - security_posture: "{posture}"
3. Verify .specia/ directory was created

RETURN:
- status: success/error
- summary: "Initialized SpecIA with {posture} posture, detected stack: {stack}"
- artifacts_created: [".specia/config.yaml", ".specia/context.md"]
- key_data: { posture, detected_stack }
- next_recommended: "propose"
```

### Phase: propose

```
TASK: Create a change proposal for "{CHANGE_NAME}".

CONTEXT:
- User's intent: {INTENT}
- Scope areas: {SCOPE}
- Approach (if any): {APPROACH}
- Skip audit: {SKIP_AUDIT} (default false)

INSTRUCTIONS:
1. Load skills/{agent}/specia.md for tool reference
2. Call specia_propose (or specia_new) with:
   - change_name: "{CHANGE_NAME}"
   - intent: "{INTENT}"
   - scope: {SCOPE}
   - approach: "{APPROACH}"
   - skip_audit: {SKIP_AUDIT}

RETURN:
- status: success/error
- summary: "Created proposal for {CHANGE_NAME}: {one-sentence intent}"
- artifacts_created: ["proposal.md", "state.yaml"]
- key_data: { change_name, scope_areas, audit_policy }
- next_recommended: "spec"
```

### Phase: spec

```
TASK: Write specifications for change "{CHANGE_NAME}".

CONTEXT:
- Proposal summary: {PROPOSAL_SUMMARY}
- Read .specia/changes/{CHANGE_NAME}/proposal.md for full proposal context

INSTRUCTIONS:
1. Load skills/{agent}/specia.md for tool reference
2. Read the proposal to understand scope and intent
3. Analyze the codebase areas mentioned in scope to understand current implementation
4. Write structured requirements with Given/When/Then scenarios
5. Call specia_spec with the requirements array

RETURN:
- status: success/error
- summary: "{N} requirements with {M} scenarios covering: {areas}"
- artifacts_created: ["spec.md"]
- key_data: { requirements_count, scenarios_count, requirement_names }
- next_recommended: "design" (if complex) or "review" (if simple)
```

### Phase: design (optional)

```
TASK: Create architecture design for change "{CHANGE_NAME}".

CONTEXT:
- Proposal summary: {PROPOSAL_SUMMARY}
- Spec summary: {SPEC_SUMMARY}
- Read .specia/changes/{CHANGE_NAME}/proposal.md and spec.md for full context

INSTRUCTIONS:
1. Load skills/{agent}/specia.md for tool reference
2. Call specia_design with change_name: "{CHANGE_NAME}" (phase 1 — returns template)
3. Read the returned design template/prompt
4. Analyze the codebase to make informed architecture decisions
5. Fill in the design document with:
   - Technical approach
   - Architecture decisions (with alternatives considered and rationale)
   - Component design
   - Data flow
   - API contracts / interfaces
   - File changes table
   - Testing strategy
6. Call specia_design with change_name and design_content (phase 2 — saves design)

RETURN:
- status: success/error
- summary: "{N} architecture decisions. Key choices: {decision_titles}"
- artifacts_created: ["design.md"]
- key_data: { decisions_count, decision_titles, files_affected }
- next_recommended: "review"

SKIP THIS PHASE IF:
- Change is small (< 3 files affected)
- No significant architecture decisions needed
- User explicitly says "skip design"
```

### Phase: review

```
TASK: Run security review for change "{CHANGE_NAME}".

CONTEXT:
- Spec summary: {SPEC_SUMMARY}
- Design summary (if exists): {DESIGN_SUMMARY}
- Security posture: {POSTURE} (from .specia/config.yaml)

INSTRUCTIONS:
1. Load skills/{agent}/specia.md for tool reference
2. Call specia_review with change_name: "{CHANGE_NAME}" (phase 1)
   - This returns a review_prompt with the spec content and analysis instructions
3. Perform the security analysis following the prompt instructions:
   - standard: STRIDE light
   - elevated: Full STRIDE + OWASP Top 10
   - paranoid: STRIDE + OWASP + DREAD scoring
4. Call specia_review with change_name and review_result (phase 2)

RETURN:
- status: success/error
- summary: "{risk_level} risk. {N} findings: {critical}C/{high}H/{medium}M/{low}L"
- artifacts_created: ["review.md"]
- key_data: { risk_level, findings_count, critical_count, top_finding }
- next_recommended: "tasks"

IMPORTANT: This is the MANDATORY security gate. Do not skip or shortcut it.
```

### Phase: tasks

```
TASK: Generate implementation tasks for change "{CHANGE_NAME}".

CONTEXT:
- Review summary: {REVIEW_SUMMARY}

INSTRUCTIONS:
1. Load skills/{agent}/specia.md for tool reference
2. Call specia_tasks with change_name: "{CHANGE_NAME}"
   - If it returns REVIEW_STALE, inform the coordinator that re-review is needed
3. Report the generated tasks

RETURN:
- status: success/error/blocked
- summary: "{N} tasks generated, {M} are security mitigations"
- artifacts_created: ["tasks.md"]
- key_data: { total_tasks, mitigation_tasks, task_categories }
- next_recommended: "implement" (user action) then "done"

IF BLOCKED:
- REVIEW_REQUIRED → Tell coordinator: "review phase not complete"
- REVIEW_STALE → Tell coordinator: "spec changed since review, re-review needed"
```

### Phase: done

```
TASK: Archive completed change "{CHANGE_NAME}".

INSTRUCTIONS:
1. Load skills/{agent}/specia.md for tool reference
2. Call specia_done with change_name: "{CHANGE_NAME}"
   - If it returns AUDIT_REQUIRED, inform the coordinator that audit must be run first
   - Use force: true only if coordinator explicitly passes emergency override
3. Verify the change was archived to .specia/specs/

RETURN:
- status: success/error/blocked
- summary: "Archived {CHANGE_NAME} to .specia/specs/{CHANGE_NAME}.md"
- artifacts_created: [".specia/specs/{CHANGE_NAME}.md"]
- key_data: { archived_path }
- next_recommended: null (workflow complete)

IF BLOCKED:
- AUDIT_REQUIRED → Tell coordinator: "audit is mandatory for this change, run specia_audit first"
- INCOMPLETE_CHANGE → Tell coordinator: "not all phases complete"
```

### Phase: audit (mandatory by default)

```
TASK: Run post-implementation code audit for change "{CHANGE_NAME}".

CONTEXT:
- Tasks summary: {TASKS_SUMMARY}
- Audit policy: {AUDIT_POLICY} (from state.yaml — "required" or "skipped")
- Security posture: {POSTURE} (from .specia/config.yaml)

INSTRUCTIONS:
1. Load skills/{agent}/specia.md for tool reference
2. Load agents/claude-code/agents/specia-audit.md for audit-specific guidance
3. Call specia_audit with change_name: "{CHANGE_NAME}" (phase 1)
   - Optionally pass files: [...] for explicit file list
   - Returns audit_prompt with spec + abuse cases + code files
4. Analyze the code against:
   - Each spec requirement (pass/fail/partial with evidence)
   - Each abuse case from the review (verified/unverified with evidence)
   - Security finding mitigations
5. Call specia_audit with change_name and audit_result (phase 2)

RETURN:
- status: success/error/cached
- summary: "{verdict} verdict. {N}/{M} requirements pass, {X}/{Y} abuse cases verified"
- artifacts_created: ["audit.md"]
- key_data: { overall_verdict, requirements_passed, abuse_cases_verified }
- next_recommended: "done"

SKIP THIS PHASE IF:
- audit_policy is "skipped" (user opted out at propose time)
```

### Phase: debate (optional)

```
TASK: Run structured security debate for change "{CHANGE_NAME}".

CONTEXT:
- Review summary: {REVIEW_SUMMARY}
- Security posture: {POSTURE}
- Reason for debate: {REASON} (e.g., "elevated posture", "ambiguous findings")

INSTRUCTIONS:
1. Load skills/{agent}/specia.md for tool reference
2. Call specia_debate with change_name: "{CHANGE_NAME}", max_rounds: 3, max_findings: 10
   - Returns debate_prompt with first agent prompt
3. Process the agent prompt with the LLM, submit response as agent_response
4. Continue calling specia_debate with agent_response until debate completes
5. Report consensus findings

RETURN:
- status: success/error
- summary: "{N} findings debated. Severities changed: {changes}. {M} need human review."
- artifacts_created: ["debate.md", "review.md (updated)"]
- key_data: { findings_debated, consensus_reached, severity_changes }
- next_recommended: "tasks"

USE WHEN:
- Security posture is elevated or paranoid
- Review has contentious or ambiguous findings
- Severity calibration is important
```

---

## Context Passing Between Sub-Agents

**Rule: Pass summaries, not content.** Sub-agents read full artifacts from `.specia/` files.

### What the Coordinator Passes:
- `change_name` — Always
- `previous_summary` — One paragraph from the prior sub-agent's return
- `project_root` — Working directory path

### What Sub-Agents Read Themselves:
- `.specia/changes/{name}/state.yaml` — Current phase, history, and audit_policy
- `.specia/changes/{name}/proposal.md` — Full proposal (if needed)
- `.specia/changes/{name}/spec.md` — Full spec (if needed)
- `.specia/changes/{name}/design.md` — Full design (if needed)
- `.specia/changes/{name}/review.md` — Full review (if needed)
- `.specia/changes/{name}/audit.md` — Full audit (if needed)
- `.specia/changes/{name}/debate.md` — Debate transcript (if needed)
- `.specia/config.yaml` — Project config (posture, etc.)

### What Sub-Agents Return:
- Structured summary (see return contracts above)
- NOT the full artifact content
- NOT source code they may have read

**This keeps the coordinator's context thin.** A 6-phase workflow adds ~6 paragraphs of summaries to coordinator context instead of ~6 pages of full artifacts.

---

## Orchestrator Conversation Flow

### Full New Change Flow

```
USER: "I want to add JWT authentication to the API"

COORDINATOR:
  1. Ask: "I'll create a SpecIA change for this. What areas of the codebase are affected?"
  2. User responds with scope

  3. Delegate PROPOSE to sub-agent:
     → Returns: "Created proposal 'jwt-auth': Add JWT auth to API. Scope: src/auth/, src/middleware/, src/routes/. audit_policy: required"

  4. Delegate SPEC to sub-agent:
     → Returns: "5 requirements, 18 scenarios covering token generation, validation, refresh, revocation, migration"

  5. Ask user: "Spec complete. This is a significant architecture change — shall I create a design document, or skip to security review?"
     User: "Yes, create a design"

  6. Delegate DESIGN to sub-agent:
     → Returns: "3 decisions: JWT with RS256 + Redis token blacklist + middleware chain pattern"

  7. Delegate REVIEW to sub-agent:
     → Returns: "Medium risk. 6 findings: 0C/2H/3M/1L. Top: token blacklist race condition"

  8. Report review findings to user. Ask: "Review complete with 6 findings. Shall I generate implementation tasks?"
     User: "Yes"

  9. Delegate TASKS to sub-agent:
     → Returns: "14 tasks: 8 implementation + 6 security mitigations"

  10. Report tasks. Help user implement them (this part may be direct or delegated).

  11. Delegate AUDIT to sub-agent:
      → Returns: "Pass verdict. 5/5 requirements pass, 4/4 abuse cases verified"

  12. When user says "done" → Delegate DONE to sub-agent
```

### Continue Flow

```
USER: "Continue the jwt-auth change"

COORDINATOR:
  1. Call specia_continue with change_name: "jwt-auth"
     → Returns: next_tool: "specia_review", message: "Spec complete, review pending"

  2. Delegate REVIEW to sub-agent
  3. Continue from step 7 above
```

### Fast-Forward Flow

```
USER: "Fast-forward jwt-auth"

COORDINATOR:
  1. Delegate to sub-agent:
     "Call specia_ff with change_name: 'jwt-auth'. Report which phases completed and where it stopped."
     → Returns: "Completed: propose. Stopped at: spec (needs requirements input)"

  2. Ask user for requirements or delegate spec writing to sub-agent
  3. Continue from where ff stopped
```

---

## Recovery After Compaction

When context is compacted or a new session starts mid-workflow:

### Step 1: Read State

```
Read .specia/changes/{name}/state.yaml
```

This tells you:
- `phase` — Where we are
- `phases_completed` — What's done
- `status` — Is the current phase in-progress or complete?

### Step 2: Reconstruct Summaries

For each completed phase, skim the artifact to build a one-line summary:
- `proposal.md` → Read the first 3 lines (intent)
- `spec.md` → Count requirements and scenarios
- `design.md` → Count decisions
- `review.md` → Read YAML frontmatter (risk_level, findings_count)
- `tasks.md` → Count task items
- `audit.md` → Read YAML frontmatter (overall_verdict, requirements_passed/total)
- `debate.md` → Count findings debated (if present)

**Do this via a single sub-agent, not inline.** Launch a "recovery" sub-agent:

```
TASK: Recover SpecIA workflow state for change "{CHANGE_NAME}".

INSTRUCTIONS:
1. Read .specia/changes/{CHANGE_NAME}/state.yaml
2. For each file in .specia/changes/{CHANGE_NAME}/:
   - proposal.md: Extract intent (first paragraph)
   - spec.md: Count requirements and scenarios
   - design.md: Count architecture decisions
   - review.md: Extract risk_level and findings_count from frontmatter
   - tasks.md: Count total tasks and mitigation tasks
3. Return a structured summary

RETURN:
- change_name: string
- current_phase: string
- phases_completed: string[]
- audit_policy: "required" | "skipped"
- summaries: { [phase]: one-line summary }
- next_action: what should happen next
```

### Step 3: Resume

With state reconstructed, pick up where you left off. Delegate the next phase to a sub-agent.

---

## Anti-Patterns

### DO NOT: Read code inline

```
BAD:  "Let me read src/auth/middleware.ts to understand the current auth flow..."
      [reads 200 lines of code into coordinator context]

GOOD: "I'll delegate the spec phase to a sub-agent who will analyze the codebase."
      [sub-agent reads code, returns 1-paragraph summary]
```

### DO NOT: Write specs inline

```
BAD:  "Here are the requirements I've written:
       1. Token Generation - Given a valid user..."
      [writes 50 lines of spec content in coordinator context]

GOOD: "I'm delegating spec writing to a sub-agent."
      [sub-agent writes spec via specia_spec tool, returns summary]
```

### DO NOT: Do "quick" analysis

```
BAD:  "Let me quickly check the spec to see if it covers edge cases..."
      [reads spec.md into coordinator context]

GOOD: "I'll have the review sub-agent analyze the spec for completeness."
```

### DO NOT: Accumulate artifact content

```
BAD:  Store full proposal text in coordinator memory, then full spec,
      then full design, then full review = context explosion

GOOD: Store only phase_summaries: { proposal: "...", spec: "..." }
      Each summary is 1-2 sentences. Sub-agents read full files when needed.
```

### DO NOT: Skip the security review

```
BAD:  "This change is simple, let's skip review and go to tasks."

GOOD: "The security review is mandatory. Let me delegate it to a sub-agent —
       it'll be thorough but won't bloat our conversation."
```

### DO NOT: Skip the audit without opt-out

```
BAD:  "Let's just archive this change without running the audit."

GOOD: "Audit is mandatory for this change. Let me delegate it to a sub-agent.
       If you want to skip audit, that must be decided at proposal time with skip_audit: true."
```

### DO NOT: Use force: true casually

```
BAD:  "specia_done blocked? Just add force: true to bypass."

GOOD: "specia_done blocked because audit is missing. Let me run specia_audit first.
       force: true is for emergency hotfix scenarios only — it's heavily logged."
```

---

## Self-Test Checklist

Use this checklist to verify the orchestrator is working correctly:

- [ ] **Delegation**: Agent delegates `specia_propose` to a sub-agent (does NOT create the proposal inline)
- [ ] **Delegation**: Agent delegates `specia_spec` to a sub-agent (does NOT write requirements inline)
- [ ] **Delegation**: Agent delegates `specia_design` to a sub-agent (does NOT write design inline)
- [ ] **Delegation**: Agent delegates `specia_review` to a sub-agent (does NOT perform security analysis inline)
- [ ] **Delegation**: Agent delegates `specia_tasks` to a sub-agent (does NOT generate tasks inline)
- [ ] **Delegation**: Agent delegates `specia_audit` to a sub-agent (does NOT perform code audit inline)
- [ ] **State tracking**: Agent reads `state.yaml` to know current phase and audit_policy (via sub-agent or specia_continue)
- [ ] **Context passing**: Agent passes summaries (not full artifacts) between phases
- [ ] **Recovery**: After compaction, agent reads `state.yaml` to resume (delegates recovery to sub-agent)
- [ ] **No bloat**: Coordinator context stays under 2 pages of text after 8 phases
- [ ] **User decisions**: Agent asks user before skipping optional design phase
- [ ] **Security gate**: Agent never skips or shortcuts the security review
- [ ] **Audit gate**: Agent runs audit for required-policy changes before calling done
- [ ] **Error handling**: Agent reports specia tool errors to user with the error code and recommended action
- [ ] **Summaries only**: Sub-agent return values are structured summaries, not full artifact dumps

### Quick Smoke Test

1. User says: "Create a new change called test-feature for adding user profiles"
2. Verify: Agent delegates to a sub-agent to call `specia_propose`, does NOT call it inline
3. Sub-agent returns: `{ status: "success", summary: "Created proposal...", next: "spec" }`
4. Agent says to user: "Proposal created. Next step is writing specs. Shall I proceed?"

If the agent instead calls `specia_propose` directly in the main conversation and reads the full response, the orchestrator pattern is NOT being followed.

---

## Compatibility Notes

### Agents with Task/Sub-Agent Support

Full orchestrator pattern applies. The agent launches sub-agents via its Task tool (Claude Code, OpenCode with agent-teams, etc.).

### Agents WITHOUT Sub-Agent Support

Fall back to **inline execution** (v0.1 pattern):
- Agent calls SpecIA MCP tools directly
- Still follows the phase DAG
- Still tracks state via `state.yaml`
- Context will be larger but functional for shorter workflows

The agent should detect this at session start:
- If Task tool is available → Use orchestrator pattern
- If no Task tool → Use direct execution per the agent-specific skill file

### Persistent Memory Integration

If the agent has access to persistent memory (Engram, etc.):
- Save phase summaries after each phase completes
- On session start, search memory for prior workflow state
- This provides an additional recovery path beyond `state.yaml`

Topic key format for Engram:
```
specia/{change_name}/orchestrator-state
```

---

## Configuration Reference

The orchestrator reads project config from `.specia/config.yaml`:

```yaml
version: "0.2"
project:
  description: "..."
  primary_stack: "..."
security:
  posture: "standard" | "elevated" | "paranoid"
# Optional sections:
guardian:
  enabled: true
  mode: "warn" | "strict"
  spec_validation:
    enabled: false
    heuristic_threshold: 0.7
    enable_llm: false
workflow:
  skip_design: false     # Default: offer design, don't skip
```

Change-level state in `.specia/changes/{name}/state.yaml`:

```yaml
change: "auth-refactor"
phase: "tasks"
status: "complete"
audit_policy: "required"       # Set at propose time, immutable
phases_completed: ["proposal", "spec", "review", "tasks"]
audit_hash: "sha256:..."       # Code hash at last audit (if audited)
audit_posture: "standard"      # Posture used for last audit
```

---

## Summary

| Coordinator Does | Sub-Agents Do |
|-----------------|---------------|
| Track phase state + audit_policy | Read/write `.specia/` artifacts |
| Pass change_name + summaries | Call `specia_*` MCP tools |
| Ask user for decisions | Analyze code and specs |
| Report phase results | Return structured summaries |
| Handle errors and retries | Perform security analysis + audit |
| Recover from compaction | Write proposals, specs, designs, reviews, tasks, audits |

## Available MCP Tools (16 total)

### Core Workflow (8)
| Tool | Purpose |
|------|---------|
| `specia_init` | Initialize project |
| `specia_propose` | Create change proposal (`skip_audit?`) |
| `specia_spec` | Write specifications |
| `specia_design` | Architecture design (optional, two-phase) |
| `specia_review` | Security review (MANDATORY, two-phase) |
| `specia_tasks` | Generate implementation tasks |
| `specia_audit` | Post-implementation code audit (two-phase, mandatory by default) |
| `specia_done` | Archive completed change (`force?` for emergency audit bypass) |

### Shortcuts (3)
| Tool | Purpose |
|------|---------|
| `specia_new` | Alias for `specia_propose` |
| `specia_continue` | Returns next phase to execute |
| `specia_ff` | Fast-forward all phases (`skip_audit?`) |

### Search (1)
| Tool | Purpose |
|------|---------|
| `specia_search` | Search archived specs and findings |

### Debate (1)
| Tool | Purpose |
|------|---------|
| `specia_debate` | Structured 3-agent debate on review findings |

### Guardian Hooks (3)
| Tool | Purpose |
|------|---------|
| `specia_hook_install` | Install pre-commit hook (`mode`, `exclude`, `spec_validation`) |
| `specia_hook_uninstall` | Remove Guardian hook |
| `specia_hook_status` | Check hook status and integrity |
