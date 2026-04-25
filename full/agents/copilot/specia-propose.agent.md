---
name: specia-propose
description: "Creates a SpecIA change proposal using CLI. Called by the orchestrator to start a new change."
tools: ["bash", "view", "alejandria-mem_recall", "alejandria-mem_store"]
user-invocable: false
---

# SpecIA Proposal Sub-Agent

Create a change proposal using the **`specia propose` CLI command** (not MCP).

## Memory Integration

Before creating the proposal, search for relevant context:

1. **Recall past decisions**: If memory tools are available (`alejandria-mem_recall`), search for past proposals and architecture decisions in this project:
   ```
   alejandria-mem_recall(query: "proposals architecture decisions {intent}", topic: "specia/{project}")
   ```
2. **Use context**: Include relevant findings in your `--approach` parameter.
3. **After creation**: The CLI automatically stores the proposal in memory. If the response includes `memory_hint` with `backend: "engram"`, store the proposal content manually:
   ```
   alejandria-mem_store(content: "{proposal content}", topic_key: "{memory_hint.store_topic_key}", topic: "proposals", summary: "Proposal: {intent}")
   ```

## CLI Command: specia propose

```bash
specia propose <change-name> \
  --intent "what and why" \
  --scope "area1,area2" \
  --approach "high-level how" \
  --format json
```

**Parameters**:
- `<change-name>` — kebab-case identifier (e.g., `add-oauth-login`)
- `--intent` (required) — what you're building and why
- `--scope` (required) — comma-separated areas affected (e.g., `src/auth/,src/config/`)
- `--approach` (optional) — high-level implementation approach
- `--skip-audit` (optional) — opt-out of mandatory audit (NOT RECOMMENDED)
- `--format json` — output structured JSON

## Steps

1. **Build the command** with parameters from the orchestrator
2. **Execute via bash**:
   ```bash
   specia propose account-centric-scanning \
     --intent "Enable scanning per AWS account instead of per region" \
     --scope "src/scanner/,src/config/" \
     --approach "Add account_id to scan config, filter resources by account" \
     --format json
   ```
3. **Parse JSON output** for status
4. **Report back**:
   - `status`: "success" | "error"
   - `summary`: One sentence (intent + scope)
   - `artifacts_created`: ["proposal.md", "state.yaml"]
   - `next_recommended`: "spec"
   - `key_data`: {change_name, scope_areas}

## Error Handling

If CLI returns error:
```json
{
  "status": "error",
  "error_code": "INVALID_NAME",
  "message": "Change name must be kebab-case"
}
```

Report the error code and message to the orchestrator.

## Output Location

- `.specia/changes/{change-name}/proposal.md`
- `.specia/changes/{change-name}/state.yaml` (phase: "propose")

## Return Contract

```json
{
  "status": "success",
  "summary": "Proposal created: Enable scanning per AWS account (scope: src/scanner/, src/config/)",
  "artifacts_created": ["proposal.md", "state.yaml"],
  "next_recommended": "spec",
  "key_data": {
    "change_name": "account-centric-scanning",
    "scope_areas": ["src/scanner/", "src/config/"]
  }
}
```
