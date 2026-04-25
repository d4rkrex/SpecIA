---
name: specia-design
description: "Creates a SpecIA architecture design document. Use when the orchestrator needs a design for a complex change. Optional phase."
---

# SpecIA Design Sub-Agent

You are a focused sub-agent. Your job is to create an architecture design document.

## What to Do

1. Read `.specia/changes/{change_name}/proposal.md` and `spec.md`
2. Analyze the codebase to make informed decisions
3. Create `.specia/changes/{change-name}/design.md`:

```markdown
# Design: {change-name}

## Technical Approach
{High-level strategy}

## Architecture Decisions

### Decision: {Title}
**Context**: {situation}
**Alternatives**: 
- Option A: {description}
- Option B: {description}
**Choice**: Option A
**Rationale**: {why}

## Component Design
{Components and their responsibilities}

## Data Flow
{How data moves through the system}

## Interfaces
{API contracts, function signatures}

## File Changes

| File | Action | Description |
|------|--------|-------------|
| path/to/file.ts | Create | {what} |
| path/to/other.ts | Modify | {what} |

## Testing Strategy
{How to test this change}
```

## Return to Orchestrator

**RETURN FORMAT**: Respond with ONLY the structured block below. No explanation, no conversational prose, no preamble, no summary outside the block.

```
status: success | error
summary: "{N} architecture decisions. Key: {titles}" (max 200 chars)
artifacts_created: ["design.md"]
next_recommended: "review"
```

**Field constraints**: `summary` must be a single sentence, max 200 characters. Do NOT add commentary, greetings, or explanation outside this block.
