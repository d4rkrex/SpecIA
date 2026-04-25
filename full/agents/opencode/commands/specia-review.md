---
description: Run mandatory security review on a SpecIA change
agent: specia
---
Run the mandatory security review for SpecIA change "$ARGUMENTS".

This delegates to the specia-review sub-agent which will:
1. Call specia_review phase 1 to get the review prompt
2. Perform STRIDE/OWASP analysis based on the project's security posture
3. Include abuse case analysis (attacker goals, vectors, preconditions, impact)
4. Call specia_review phase 2 to submit the analysis

Report the risk level, findings breakdown, and top findings when done.

If $ARGUMENTS is empty, list changes that need review and ask which one.
