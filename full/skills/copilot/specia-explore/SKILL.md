---
name: specia-explore
description: >
  Security-focused exploration before SpecIA proposal. Investigates codebase patterns, security controls, and attack surfaces.
  Trigger: When user says "specia-explore", "explore before proposal", "investigate security gaps", or before starting a SpecIA change.
license: MIT
metadata:
  author: mroldan
  version: "1.0"
---

## Purpose

Investigate the codebase BEFORE creating a SpecIA proposal to identify:
- Existing security controls and gaps
- Codebase patterns to follow
- Potential attack surfaces
- Realistic abuse cases for later review

## Inputs

- **Topic**: Feature/area to explore
- **Change name** (optional): SpecIA change identifier
- **Project name**: For context/memory

## Execution Contract

**Read context** (optional):
- Alejandría: `alejandria_mem_recall(query: "specia/init/{project}", project: "{project}")`
- Fallback: `.specia/config.yaml`

**Save artifact** (MANDATORY if tied to change):
```
alejandria_mem_store(
  content: "{full exploration markdown}",
  topic_key: "specia/{change-name}/explore",
  summary: "Security exploration: {N} gaps, {risk-level} risk",
  project: "{project}"
)
```

## Investigation Steps

### 1. Load Skills

Check for skill registry (Alejandría or `.atl/skill-registry.md`). Load relevant skills.

### 2. Security Posture Analysis

Focus on SECURITY-RELEVANT aspects:

**Auth & Authorization**:
- Pattern? (JWT, OAuth2, sessions, API keys)
- Credential storage/validation?
- Role/permission model?
- Session management?

**Input Validation**:
- Validation libraries? (Zod, Joi, class-validator)
- Where is validation done?
- SQL injection mitigations? (prepared statements, ORM)
- XSS mitigations? (sanitization, CSP)

**Rate Limiting & DoS**:
- Rate limiting middleware?
- Request size limits?
- Timeout configurations?

**Secrets Management**:
- How stored? (.env, vault, KMS)
- Secrets in code? (CRITICAL if yes)
- Rotation strategy?

**Logging & Monitoring**:
- What gets logged?
- PII in logs? (CRITICAL if yes)
- Security event monitoring?

**Dependencies**:
- Outdated/vulnerable packages?
- Dependency scanning?
- Lock files committed?

### 3. Codebase Patterns

- Entry points (main.ts, app.ts, index.ts)
- Framework (Express, Fastify, NestJS)
- Database layer (Prisma, TypeORM, Knex, raw SQL)
- Error handling patterns
- Testing approach

### 4. Identify Security Gaps

**Focus on what's MISSING or WEAK.**

Examples:
- NO rate limiting on /api/upload (DoS risk)
- User input NOT validated in src/api/search.ts (injection risk)
- Secrets hardcoded in src/config/db.ts:12 (credential exposure)
- File uploads accept ANY mimetype (malicious file execution)
- No CSRF tokens on state-changing endpoints
- SQL queries use string concatenation (SQLi)

**These gaps become abuse cases in review phase.**

### 5. Affected Areas

List files/modules that:
- Will be modified
- Have security relevance
- Contain patterns to follow/avoid

Example:
```
- src/auth/jwt.ts — JWT generation, follow this pattern
- src/middleware/rateLimit.ts — Extend for new endpoint
- src/routes/api.ts — NO input validation (GAP!)
```

### 6. Approaches (if multiple)

| Approach | Security Pros | Security Cons | Effort | Recommendation |
|----------|---------------|---------------|--------|----------------|
| Extend JWT | Consistent, tested | No MFA | Low | ✓ |
| Add OAuth2 | MFA-ready | High complexity | High | Only if MFA needed |

### 7. Constraints

Examples:
- Must use existing Prisma schema (no migrations)
- API backwards-compatible (versioning required)
- PCI compliance (tokenize cards, no storage)
- Rate limit: max 100 req/min per IP

## Output Format

Return EXACTLY this structure:

```markdown
## Security Exploration: {topic}

### Current State
{How system works today, security controls in place}

### Security Posture
- **Authentication**: {current approach}
- **Authorization**: {current approach}
- **Input Validation**: {current approach}
- **Rate Limiting**: {current approach}
- **Secrets Management**: {current approach}
- **Logging**: {current approach}

### Security Gaps Identified
1. {Gap with severity + location}
2. {Gap with severity + location}

### Affected Areas
- `path/to/file.ext` — {security relevance}

### Approaches
1. **{Name}** — {description}
   - Security Pros: {list}
   - Security Cons: {list}
   - Effort: Low/Medium/High
   - Risk Level: Low/Medium/High/Critical

### Recommendation
{Recommended approach + security rationale}

### Constraints
- {Constraint 1}

### Potential Abuse Cases (Preview)
1. **AC-XXX**: {Threat} — {attack vector from gap}

### Risks
- {Risk with mitigation suggestion}

### Ready for Proposal
{Yes/No — what to include based on findings}
```

## Rules

- **SECURITY first**, architecture second
- **Be SPECIFIC**: "No input validation in src/api/search.ts:23 (uses raw req.body.query)"
- **Link gaps to abuse cases**: every gap = potential abuse case
- **DO NOT modify code** — exploration only
- **ALWAYS read real code** — never guess
- **MANDATORY**: Save to Alejandría if tied to change

## Return Envelope

```json
{
  "status": "success|error",
  "executive_summary": "1-2 sentences (max 200 chars)",
  "security_gaps_count": 5,
  "recommended_approach": "Approach name",
  "risk_level": "low|medium|high|critical",
  "artifacts": ["mem:{observation_id}"],
  "next_recommended": "specia_propose",
  "risks": ["Risk 1", "Risk 2"]
}
```

## Integration with SpecIA

```
specia-explore → findings saved
    ↓
specia-propose → reads exploration, aligned proposal
    ↓
specia → requirements from chosen approach
    ↓
specia-review → abuse cases from gaps identified
```

**Key benefit**: Abuse cases are REALISTIC (based on actual gaps) instead of generic.
