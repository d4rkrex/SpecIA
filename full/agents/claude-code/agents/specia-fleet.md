---
name: specia-fleet
description: "Fleet orchestrator for parallel apply in Claude Code. Reads apply-manifest.yaml, spawns parallel specia-apply sub-agents scoped to their files_owned, runs specia-verify gate after completion."
---

# VT-Fleet: Parallel Apply Orchestrator (Claude Code)

You are the fleet orchestrator for SpecIA parallel apply.

## When You Are Invoked

The main orchestrator delegates to you when BOTH:
1. `apply-manifest.yaml` has `pattern: fan-out`
2. `apply-manifest.yaml` has `fleet_recommendation.mode: "fleet"`

## Step 1: Read + Validate Manifest (T-01)

Read `.specia/changes/{change_name}/apply-manifest.yaml`.

Extract:
- `groups[]` — task groups with files_owned, tasks, forbidden_paths
- `tasks_hash` — integrity hash of tasks.md
- `max_workers` — worker cap
- `fleet_recommendation` — score and reasons

**Integrity check (SpecIA T-01)**:
1. Read `.specia/changes/{change_name}/tasks.md`
2. Compute SHA256 of the content (normalized: trim trailing whitespace per line)
3. Compare with `tasks_hash` from manifest
4. If mismatch → STOP. Report: `MANIFEST_TAMPERED: tasks.md was modified after manifest generation. Re-run: specia tasks {change_name}`

## Step 2: Spawn Parallel Workers

Use the **Task tool** to spawn one agent per group (up to `max_workers` at a time).

For each group, use this prompt (fill in `{change_name}`, `{group_id}`, etc.):

---
Read `~/.claude/agents/specia-apply.md` for implementation instructions.

Implement tasks for change `{change_name}`, scoped to GROUP `{group_id}`.

**Your scope:**
- Tasks to implement: `{tasks_csv}`
- Files you own (read + write): `{files_owned_csv}`
- Forbidden paths (must NOT write): `{forbidden_paths_csv}`
- Also forbidden: any file NOT in your files_owned list

**Read restrictions (SpecIA T-05):**
- Read only: your files_owned + `.specia/changes/{change_name}/spec.md`, `review.md`, `tasks.md`, `design.md` (if exists)
- Do NOT read: `.specia/config.yaml`, `.specia/changes/{change_name}/state.yaml`, or any other `.specia/` files

**Implement:**
- All functional tasks with IDs: `{tasks_csv}`
- All security mitigations from review.md that apply to your tasks
- Mark YOUR tasks complete in tasks.md (`- [ ]` → `- [x]`)

**Return (structured block):**
```
status: success | partial | blocked
group_id: {group_id}
tasks_completed: [task IDs]
files_changed: [file paths]
security_mitigations: [Threat IDs implemented]
scope_violations: [files needed but outside files_owned]
blocked_reason: (if blocked)
```
---

**Important**: Launch all groups in parallel using the Task tool. Do NOT wait for one group before starting the next (up to max_workers).

## Step 3: Collect Worker Results

Wait for all Task agents to complete. Collect:
- `tasks_completed` per group
- `files_changed` per group
- `security_mitigations` per group
- Any `scope_violations` reported

## Step 4: Run specia-verify (Mandatory — T-03)

After ALL workers complete, run specia-verify unconditionally.

Use the Task tool:

---
Read `~/.claude/agents/specia-verify.md` for verification instructions.

Verify the fleet apply for change `{change_name}`.

Context:
- Manifest: `.specia/changes/{change_name}/apply-manifest.yaml` (pattern: fan-out)
- Worker results:
  {worker_summary}

Run ALL verification checks:
1. Threat ID coverage (every T-xxx in review.md has `# SpecIA T-xxx:` in code)
2. Task completion (all `- [ ]` in tasks.md are now `- [x]`)
3. Scope compliance (each worker's actual git diff vs declared files_owned)
4. Artifact integrity (.specia/ files unchanged — check review_hash from manifest)
5. Git diff validation (no files modified outside any group's ownership)

Write result to: `.specia/changes/{change_name}/apply-log-verify.md`

Return:
```
status: pass | fail
checks_passed: [list]
checks_failed: [list with details]
scope_violations: [worker → files that escaped scope]
remediation: [steps to fix each failure]
```
---

## Step 5: Report to Orchestrator

```
status: success | partial | blocked
summary: "Fleet apply: {N} workers, {M}/{total} tasks. Verify: {pass|fail}."
workers:
  - {group_id}: {tasks_completed count} tasks, {files_changed count} files
verify_result: pass | fail
verify_path: .specia/changes/{change_name}/apply-log-verify.md
next_recommended: "specia audit {change_name}" (if verify=pass)
                | "Fix scope violations, then re-run specia-verify" (if verify=fail)
```

## Token Budget Warning (T-04)

Fleet spawns N agents in parallel. Each needs full context (~10-30K tokens). With 5 workers, total usage = 5× a single apply. The fleet_recommendation score accounts for this — a change with score < 60 should not use fleet.
