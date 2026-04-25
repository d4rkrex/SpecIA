---
name: specia-apply
description: >
  Implement SpecIA tasks including security mitigations. Writes actual code following spec, design, and review findings.
  Uses dual-track persistence (files + Alejandría) for recovery and search.
  Trigger: When user says "specia-apply", "implement tasks", "write code for specia change".
license: MIT
metadata:
  author: SpecIA Team
  version: "2.0"
---

## Purpose

Implement tasks from SpecIA change by writing actual code. This includes BOTH functional requirements from the spec AND security mitigations from the review.

**IMPORTANT**: Security mitigations are NON-NEGOTIABLE. Never skip or weaken them.

## Dual-Track Persistence

SpecIA uses files (`.specia/`) as primary source + Alejandría for recovery/search:

**Alejandría stores** (extractos only):
- Review findings summary (Threat IDs + mitigations)
- Top abuse cases
- Key design decisions  
- Implementation progress
- Bugs/discoveries

**Why?** Semantic search across changes + recovery after compaction. Low cost (~500 tokens/change).

## Before You Start

### Step 1: Load Skill Registry

1. Try Alejandría: `alejandria_mem_recall(query: "skill-registry", project: "{project}")`
2. Fallback: read `.atl/skill-registry.md`
3. Load any matching skills

### Step 2: Read SpecIA Artifacts

Read from `.specia/changes/{change-name}/`:

1. **`spec.md`** — Requirements and scenarios
2. **`review.md`** — Security findings, abuse cases, mitigations  
3. **`tasks.md`** — Implementation + security tasks
4. **`design.md`** (if exists) — Architecture decisions
5. **`.specia/config.yaml`** — Project conventions

**Critical**: Read `review.md` carefully. Every finding has:
- Threat ID (e.g., T-001)
- Severity + OWASP mapping
- Exact mitigation steps (non-negotiable)

### Step 3: Save Extractos to Alejandría (First Time Only)

When you FIRST read review.md, save summary:

```
alejandria_mem_store(
  content: "# SpecIA Review: {name}\n\n## Findings\n{Threat-ID} ({severity}): {desc}\n- OWASP: {map}\n- Mitigation: {mitigation}\n\n## Top Abuse Cases\n{top 5}\n\nFull: .specia/changes/{name}/review.md",
  summary: "SpecIA {name}: {risk} risk, {N} findings",
  topic_key: "specia/{name}/review-summary"
)
```

If design.md exists, save key decisions similarly.

## Scope Awareness (Multi-Agent Apply)

When launched with a `## Scope` section in your prompt:

- **files_owned**: Only create/modify files matching these paths
- **forbidden_paths**: NEVER touch these files (always includes `.specia/`)
- Report scope violations in return summary
- Write `apply-log-{group_id}.md` at the end

Without `## Scope` → operate on all files (backward compatible).

## Implementation Flow

### For Each Task

```
1. UNDERSTAND
   - Read task from tasks.md
   - If functional: read spec scenarios
   - If security: read threat from review.md
   - Read design decisions

2. IMPLEMENT
   - Write code exactly as specified
   - For security: implement EXACT mitigation from review.md
   - Add Threat ID comment:
     # SpecIA T-001: Prevent XSS via httpOnly cookies
     response.set_cookie('token', val, httponly=True, secure=True)

3. TEST (if TDD enabled)
   - Write test for behavior
   - For security: test the attack vector
   - Verify test passes

4. MARK COMPLETE
   - Edit tasks.md: `- [ ]` → `- [x]`
```

## Security Mitigation Rules

1. Read the threat in review.md first
2. Implement EXACT mitigation specified
3. Reference Threat ID in code comments
4. Test the abuse case
5. NEVER weaken mitigations

Common patterns:
- Input validation: Pydantic strict, schema validation
- SQL injection: Parameterized queries only
- AuthN/AuthZ: Middleware + RBAC everywhere
- Rate limiting: Per-endpoint + per-user + global
- CORS: Strict origins, no wildcards
- Sessions: httpOnly + secure + SameSite cookies
- Errors: Sanitize stack traces
- Sensitive data: Mask in logs/responses

## After Each Batch: Save Progress to Alejandría

```
alejandria_mem_store(
  content: "# Apply Progress: {name}\n\n## Batch {X}\n{N}/{total} tasks ({M} func + {K} sec)\n\n## Files Changed\n{list}\n\n## Security Mitigations\n{Threat-ID}: {mitigation} @ {file}:{line}\n\n## Issues Found\n{list}\n\n## Next\n{tasks}",
  summary: "SpecIA {name}: {N}/{total} complete (batch {X})",
  topic_key: "specia/{name}/apply-progress"
)
```

## Save Discoveries (As Needed)

If you find bugs, architecture issues, or make important decisions:

```
alejandria_mem_store(
  content: "## What\n{desc}\n\n## Where\n{file}:{line}\n\n## Why\n{impact}\n\n## Decision\n{action}",
  summary: "SpecIA {name}: {one-line}",
  topic: "specia-discoveries"
)
```

## Return Summary

```markdown
## Implementation Progress

**Change**: {name}
**Mode**: {TDD | Standard}

### Completed
#### Functional
- [x] {task}

#### Security
- [x] T-001: {mitigation}

### Files Changed
| File | Action | Description |
|------|--------|-------------|
| {file} | Created/Modified | {what} |

### Security Mitigations
| Threat ID | Severity | Mitigation | Verified |
|-----------|----------|------------|----------|
| T-001 | High | httpOnly cookies | ✅ XSS test blocked |

### Alejandría Saves
- ✅ Review summary (first time only)
- ✅ Progress: specia/{name}/apply-progress
{If discoveries:}
- ✅ {N} discoveries saved

### Status
{N}/{total} complete. {next-batch | audit | blocked}
```

## Rules

- Security tasks are NOT optional
- Reference Threat IDs in code comments
- Test abuse cases
- Never weaken mitigations
- Save to Alejandría after each batch (enables recovery)
- Mark tasks AS you go

## Anti-Patterns

❌ Skip security tasks
❌ Weaken mitigations
❌ No Threat ID comments
❌ Skip Alejandría saves (breaks recovery)
