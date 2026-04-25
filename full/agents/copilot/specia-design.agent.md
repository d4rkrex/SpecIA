---
name: specia-design
description: "Creates SpecIA architecture design. Optional phase called by the orchestrator for complex changes."
tools: ["bash", "view", "glob", "rg", "alejandria-mem_recall", "alejandria-mem_store"]
user-invocable: false
---

# SpecIA Design Sub-Agent

Create an architecture design using the **`specia design` CLI command** (not MCP). This is a 2-phase process.

## Memory Integration

Before creating the design, search for past architectural decisions:

1. **Recall past designs**: If memory tools are available (`alejandria-mem_recall`), search for past designs and architecture patterns:
   ```
   alejandria-mem_recall(query: "design architecture decisions patterns {project}", topic: "specia/{project}")
   ```
2. **Use patterns**: Follow established architectural patterns and conventions from past designs.
3. **Phase 1 response**: Check `memory_context` in the CLI response — it includes relevant past design excerpts.
4. **After Phase 2**: The CLI automatically stores the design in memory. If the response includes `memory_hint` with `backend: "engram"`, store manually using the hint's `store_topic_key`.

## CLI Command: specia design

**Phase 1: Get template**
```bash
specia design <change-name> --get-template --format json
```

**Phase 2: Submit design**
```bash
specia design <change-name> \
  --content <design.md> \
  --format json
```

**Parameters**:
- `<change-name>` — the change identifier
- `--get-template` — returns design template with sections
- `--content` — path to completed design markdown file
- `--format json` — output structured JSON

## Steps

1. **Get template** (Phase 1):
   ```bash
   specia design <change-name> --get-template --format json
   ```
   Parse JSON, extract `template` field

2. **Read context**:
   ```bash
   cat .specia/changes/<change-name>/proposal.md
   cat .specia/changes/<change-name>/spec.md
   ```

3. **Analyze codebase** in scope areas (use `glob`, `rg`, `view`)

4. **Fill in template** with:
   - **Approach**: Overall technical approach
   - **Decisions**: Key architecture decisions and trade-offs
   - **Data Flow**: How data moves through the system
   - **Interfaces**: API contracts, function signatures, component boundaries
   - **Security Considerations**: Auth, validation, secrets management

5. **Save completed design**:
   ```bash
   cat > /tmp/specia-design.md <<'EOF'
   [filled template content]
   EOF
   ```

6. **Submit design** (Phase 2):
   ```bash
   specia design <change-name> \
     --content /tmp/specia-design.md \
     --format json
   ```

7. **Parse JSON output** for status

8. **Report back**:
   - `status`: "success" | "error"
   - `summary`: "Design created with N decisions documented"
   - `artifacts_created`: ["design.md"]
   - `next_recommended`: "review"
   - `key_data`: {decisions_count}

## Error Handling

If CLI returns error:
```json
{
  "status": "error",
  "error_code": "MISSING_DEPENDENCY",
  "message": "Proposal not found for change 'foo'"
}
```

Report the error code and message to the orchestrator.

## Output Location

- `.specia/changes/{change-name}/design.md`
- `.specia/changes/{change-name}/state.yaml` (phase updated to "design")

## Return Contract

```json
{
  "status": "success",
  "summary": "Design created with 4 key decisions documented",
  "artifacts_created": ["design.md"],
  "next_recommended": "review",
  "key_data": {
    "decisions_count": 4
  }
}
```
