---
description: Continue a SpecIA change from where it left off
agent: specia
---
Continue the SpecIA change "$ARGUMENTS".

1. Call specia_continue with the change name to determine the next phase
2. Delegate the next phase to the appropriate sub-agent
3. Continue through remaining phases until complete or user input is needed

If $ARGUMENTS is empty, list all active changes in .specia/changes/ and ask which one to continue.
