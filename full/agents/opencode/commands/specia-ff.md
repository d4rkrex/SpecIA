---
description: Fast-forward a SpecIA change through all possible phases
agent: specia
---
Fast-forward the SpecIA change "$ARGUMENTS" through all possible phases.

1. Call specia_ff with the change name
2. Report which phases completed and where it stopped
3. If it stopped at a phase needing input (spec or review), delegate to the appropriate sub-agent
4. Continue until all phases are complete or user input is needed

If $ARGUMENTS is empty, list active changes and ask which one to fast-forward.
