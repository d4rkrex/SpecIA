---
description: Start a new SpecIA change with mandatory security review
agent: specia
---
Start a new SpecIA change called "$ARGUMENTS".

Workflow: propose -> spec -> [design] -> REVIEW (mandatory) -> tasks

1. Delegate PROPOSE to specia-propose sub-agent with the change details
2. After proposal, delegate SPEC to specia sub-agent
3. Ask me if I want a design doc (for complex changes) or skip to review
4. Delegate REVIEW to specia-review sub-agent (MANDATORY - never skip)
5. Delegate TASKS to specia-tasks sub-agent
6. Report the full summary

If $ARGUMENTS is empty, ask me for: change name, intent, and scope.
