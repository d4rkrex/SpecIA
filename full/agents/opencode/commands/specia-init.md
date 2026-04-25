---
description: Initialize SpecIA in the current project
agent: specia
---
Initialize SpecIA in this project.

Call specia_init with:
- project_description: Ask me if not obvious from the project
- primary_stack: "auto" (let it detect)
- security_posture: Ask me to choose: standard, elevated, or paranoid

Explain what each posture level means:
- standard: STRIDE light — quick risk assessment
- elevated: Full STRIDE + OWASP Top 10 — thorough review
- paranoid: STRIDE + OWASP + DREAD scoring — maximum depth

$ARGUMENTS
