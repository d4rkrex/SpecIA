---
name: specia-review
description: >
  Run mandatory security review on a SpecIA change. Performs STRIDE/OWASP analysis and generates abuse cases.
  Trigger: When user says "specia-review", "security review", "review specia change".
license: MIT
metadata:
  author: SpecIA Team
  version: "2.0"
---

## Purpose

Perform mandatory security review on a SpecIA change. This phase analyzes the spec for security threats using STRIDE methodology and OWASP Top 10, and generates abuse cases (attacker-centric scenarios).

**IMPORTANT**: This phase is MANDATORY. It cannot be skipped. Task generation will fail if review is missing or stale.

## Two-Phase Protocol

### Phase 1: Get Review Prompt

Run `specia review` with the change name to get the review prompt:

```bash
specia review add-jwt-refresh --format json
```

The output (JSON) includes:
- `review_prompt` — The spec content and instructions for analysis
- `security_posture` — Level (standard/elevated/paranoid) controlling review depth
- `change_name` — The change being reviewed

### Phase 2: Perform Analysis and Submit

Analyze the spec according to the security posture:

**Standard posture**:
- STRIDE light analysis
- Basic threat identification
- 2-3 abuse cases

**Elevated posture**:
- Full STRIDE analysis
- OWASP Web/API Top 10 mapping
- 5+ abuse cases with attack vectors

**Paranoid posture**:
- Complete STRIDE + DREAD scoring
- Comprehensive OWASP coverage
- 10+ detailed abuse cases
- Mitigation strategies for each finding

Submit your analysis by creating a JSON file with your review result and piping it to the command:

```bash
specia review add-jwt-refresh --format json < review-result.json
```

Where `review-result.json` contains:

```json
{
  "risk_level": "medium",
  "findings": [
    {
      "threat_id": "T-001",
      "category": "Spoofing",
      "severity": "high",
      "description": "Refresh token theft via XSS",
      "owasp_mapping": ["A03:2021 - Injection"],
      "mitigation": "Store in httpOnly cookies, implement CSP"
    }
  ],
  "abuse_cases": [
    {
      "name": "Token Replay Attack",
      "attacker_goal": "Reuse stolen refresh token to maintain access",
      "attack_vector": "Intercept refresh token during network transit",
      "preconditions": ["MITM position", "No TLS or weak TLS"],
      "impact": "Persistent unauthorized access",
      "likelihood": "medium",
      "mitigations": ["Enforce HTTPS", "Token rotation", "Short TTL"]
    }
  ]
}
```

## What to Return

- Status: success/failure
- Risk level: low/medium/high/critical
- Number of findings by severity
- Number of abuse cases
- File created: `.specia/changes/{name}/review.md`
- Next recommended phase: `specia tasks`

## Error Handling

- `MISSING_DEPENDENCY`: Spec must exist before review
- `REVIEW_STALE`: Spec changed after review — re-run review

## Discovery Before Review

Before running a review, search for similar patterns in past reviews:

```bash
specia --search "JWT refresh" --format json
```

This helps avoid duplicating analysis and leverages past security findings.
