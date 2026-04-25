---
description: Show status of all SpecIA changes
agent: specia
---
Show the status of all SpecIA changes.

1. List all directories in .specia/changes/
2. For each, read state.yaml and report:
   - Change name
   - Current phase
   - Completed phases
   - Whether review is done or pending
3. Also list any archived specs in .specia/specs/
4. Report .specia/config.yaml security posture

Format as a clean table.
