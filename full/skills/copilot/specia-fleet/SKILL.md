---
name: specia-fleet
description: >
  Fleet orchestrator for parallel apply. Reads apply-manifest.yaml, spawns N parallel
  specia-apply workers (each scoped to their files_owned), waits for all to complete, then
  runs specia-verify as a mandatory gate. Use when apply-manifest.yaml has pattern: fan-out
  AND fleet_recommendation.mode: fleet.
license: MIT
phases: [apply]
user_invocable: false
agent_type: copilot
metadata:
  author: mroldan
  version: "1.0"
---

# VT-Fleet: Parallel Apply Orchestrator

You are the fleet orchestrator. Your job is to coordinate parallel apply workers for
a SpecIA change, then verify all workers completed correctly.

## When to Use This Skill

Only invoke this skill when BOTH conditions are true:
1. `apply-manifest.yaml` has `pattern: fan-out`
2. `apply-manifest.yaml` has `fleet_recommendation.mode: "fleet"`

If either condition is false, delegate to `specia-apply` instead (sequential is safer).

## Security Constraints

**SpecIA T-01**: Before spawning any worker, verify manifest integrity:
- Read `apply-manifest.yaml` → get `tasks_hash`
- Compute hash of current `tasks.md` content
- If hash mismatch → ABORT with error: `MANIFEST_TAMPERED: tasks.md was modified after manifest generation. Re-run: specia tasks <change>`
- Do NOT proceed to worker spawning if hash mismatch

**SpecIA T-05**: Workers have read restrictions:
- Workers may only READ: files in their `files_owned` list + the change artifacts (spec.md, review.md, tasks.md, design.md)
- Workers MUST NOT read other `.specia/` files (config.yaml, state.yaml, etc.)
- Include this instruction explicitly in each worker's prompt

**SpecIA T-03**: specia-verify is mandatory:
- Run specia-verify UNCONDITIONALLY after all workers complete
- Write verify result to `.specia/changes/{name}/apply-log-verify.md`
- Do NOT proceed to audit recommendation if verify failed

## Flow

```
1. READ apply-manifest.yaml
   → Get groups, tasks_hash, fleet_recommendation, pattern

2. VERIFY manifest integrity (SpecIA T-01)
   → Compute hash of tasks.md
   → If mismatch: ABORT with MANIFEST_TAMPERED error

3. FOR EACH group (up to max_workers in parallel):
   → Launch Task sub-agent with specia-apply instructions
   → Scope to: tasks in group.tasks[], files in group.files_owned[]
   → Include: spec.md, review.md, tasks.md context, group scoping rules

4. WAIT for all workers to complete
   → Collect results: status, files_changed, security_mitigations, errors

5. RUN specia-verify (mandatory — SpecIA T-03)
   → Check: Threat ID coverage, task completion, scope compliance, artifact integrity
   → Write result to: .specia/changes/{name}/apply-log-verify.md

6. REPORT
   → If verify PASS: recommend `specia audit <change>`
   → If verify FAIL: list remediation steps, block audit
```

## Worker Prompt Template

For each group, launch a Task sub-agent with:

```
Read `~/.claude/skills/specia/specia-apply.md` for implementation instructions.

Implement tasks for change '{change_name}', scoped to GROUP {group_id}.

Your scope:
- Tasks to implement: {group.tasks joined by ", "}
- Files you own (may read + write): {group.files_owned joined by ", "}
- Forbidden paths (must NOT write): {group.forbidden_paths joined by ", "}
- ALSO forbidden to write: any file not in your files_owned list

Read restrictions (SpecIA T-05):
- You may read: files in your files_owned + .specia/changes/{name}/spec.md, review.md, tasks.md, design.md
- You must NOT read: .specia/config.yaml, .specia/changes/{name}/state.yaml, or any other .specia/ files

Artifacts at: .specia/changes/{name}/
- spec.md — requirements
- review.md — security findings + mitigations (MANDATORY to implement)
- tasks.md — your assigned task IDs: {group.tasks}
- design.md — architecture (if exists)

Implement BOTH functional tasks AND security mitigations for your assigned tasks.
Mark YOUR tasks complete in tasks.md as you go.

Return:
  status: success | partial | blocked
  group_id: {group_id}
  tasks_completed: [list of task IDs marked done]
  files_changed: [list of files modified]
  security_mitigations: [list of Threat IDs implemented]
  scope_violations: [] (list any file you needed but was outside files_owned)
  blocked_reason: (if blocked)
```

## specia-verify Prompt

After all workers complete, run verify:

```
Read `~/.claude/skills/specia/specia-verify.md` for verification instructions.

Verify the fleet apply for change '{change_name}'.

Context:
- apply-manifest.yaml: .specia/changes/{name}/apply-manifest.yaml
- pattern: fan-out (workers ran in parallel)
- Workers: {list group IDs and their reported files_changed}

Run ALL verification checks:
1. Threat ID coverage
2. Task completion (all tasks in tasks.md)
3. Scope compliance (each worker's files_changed vs files_owned)
4. Artifact integrity (.specia/ unchanged)
5. Git diff validation

Write result to: .specia/changes/{name}/apply-log-verify.md

Return:
  status: pass | fail
  checks_passed: [list]
  checks_failed: [list with details]
  scope_violations: [list of workers + files that escaped their scope]
  remediation: [steps to fix failures]
```

## Output After Fleet Completes

Report to orchestrator:

```
status: success | partial | blocked
summary: "Fleet apply: {N} workers, {M}/{total} tasks complete. Verify: {pass|fail}."
workers:
  - group_id: group-1
    tasks_completed: [...]
    files_changed: [...]
    security_mitigations: [...]
verify_result: pass | fail
verify_path: .specia/changes/{name}/apply-log-verify.md
next_recommended: "specia audit {name}" (if verify pass) | "fix scope violations then re-verify" (if fail)
```

## Token Cost Warning

**SpecIA T-04**: Fleet spawns N agents simultaneously. Each agent needs context for:
- spec.md + review.md + tasks.md (~2-5K tokens)
- Its assigned files for reading/writing (~variable)
- Implementation work (~5-20K tokens per worker)

Total token cost = N × per-worker cost. With MAX_PARALLEL_WORKERS=5, budget accordingly.

The fleet recommendation score already accounts for this — if score < 60, sequential is recommended.
