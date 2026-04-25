# SpecIA Workflow Guide

**User-focused guide to security-first development**  
**Last updated**: April 2026

---

## Overview

SpecIA is a **specification-driven development framework** with **built-in security** at every step. Instead of adding security at the end, SpecIA integrates it from the start:

- **Security Review** — Mandatory threat analysis before coding
- **Abuse Cases** — Real-world attack scenarios
- **Dynamic Audit** — Automated verification of security controls
- **Guardian Hook** — Pre-commit validation

---

## Workflow Phases

```
init → [explore] → propose → spec → REVIEW → tasks → implement → AUDIT → done
       (auto)                    (mandatory)              (mandatory)
```

**Philosophy**: Each step prepares the next. Security gates prevent shortcuts.

---

## Phase Details

### 1. Init — Project Setup

**Purpose**: Initialize SpecIA in your project.

**Usage**:
```bash
specia init \
  --project-description "REST API for e-commerce" \
  --primary-stack "Node.js / TypeScript / Express" \
  --security-posture elevated
```

**Creates**:
- `.specia/config.yaml` — Project configuration
- `.specia/context.md` — Stack and conventions
- `.specia/changes/` — Active changes directory
- `.specia/specs/` — Archived specifications

**Security postures**: `standard`, `elevated`, `paranoid`

---

### 2. Explore — Security Research (Auto-triggered)

**Purpose**: Investigates security risks before writing specifications.

**When it runs**: Automatically triggered for sensitive keywords like `auth`, `payment`, `pii`, `admin`, `encryption`.

**Manual usage**:
```bash
specia explore add-oauth-login --focus "PKCE flow, token storage"
```

**Output**: Findings saved to memory (no files created)

**Why it helps**: Identifies attack patterns and compliance requirements early, preventing costly rework.

---

### 3. Propose — Change Declaration

**Purpose**: Define what you'll change, why, and how (high-level).

**Usage**:
```bash
specia propose add-rate-limiting \
  --intent "Protect API from DoS attacks" \
  --scope "src/middleware/,src/routes/api/"
```

**Creates**: `proposal.md` with intent, scope, and approach.

**Note**: Use `--skip-audit` only for documentation or simple refactors (not recommended for features).

---

### 4. Spec — Detailed Requirements

**Purpose**: Define functional and security requirements with test scenarios.

**Usage**:
```bash
specia spec add-rate-limiting
# Opens editor with template
```

**Structure**:
- **Requirements**: What must be implemented (functional + security)
- **Scenarios**: Given/When/Then test cases

---

### 5. Design — Architecture (Optional)

**Purpose**: Document architectural decisions for complex changes.

**When to use**:
- ✅ New modules or architectural patterns
- ✅ External integrations
- ❌ Simple CRUD or small refactors

**Usage**:
```bash
specia design add-rate-limiting
# Opens editor with ADR template
```

---

### 6. REVIEW — Security Analysis (MANDATORY)

**Purpose**: Identify security threats before writing code.

**Usage**:
```bash
# Manual review (copy/paste to ChatGPT/Claude)
specia review add-rate-limiting --manual > review-prompt.txt

# Automated with API
specia review add-rate-limiting --api
```

**What it analyzes**:

#### STRIDE Threats
- **S**poofing: Identity bypass (session fixation, token theft)
- **T**ampering: Data manipulation (SQL injection, parameter tampering)
- **R**epudiation: Missing audit logs
- **I**nformation Disclosure: Data leaks (stack traces, verbose errors)
- **D**enial of Service: Resource exhaustion, no rate limiting
- **E**levation of Privilege: Authorization bypass (IDOR, privilege escalation)

#### OWASP Top 10 (elevated/paranoid modes)
- Broken Access Control, Injection, SSRF, and more

#### Abuse Cases
Real-world attack scenarios from attacker perspective, e.g.:
- "Rate limit bypass via IP rotation using botnet"
- "Session fixation through state parameter manipulation"

**Output**: `review.md` with:
- Identified threats (sorted by severity)
- Abuse cases with attack vectors
- Required security mitigations
- OWASP mappings (if elevated/paranoid)

**Security postures**:
- **standard**: Basic STRIDE analysis
- **elevated**: STRIDE + OWASP Top 10 + Abuse Cases
- **paranoid**: Everything + DREAD risk scoring

**Critical**: This is a mandatory gate — you cannot generate tasks without completing security review.

---

### 7. Tasks — Implementation Checklist

**Purpose**: Generate actionable tasks including security mitigations.

**Usage**:
```bash
specia tasks add-rate-limiting
```

**Output**: `tasks.md` with implementation tasks organized into phases:
- Foundation tasks (setup, infrastructure)
- Feature tasks (requirements implementation)
- Security mitigations (linked to threats from review)

**Key feature**: Security mitigations are first-class tasks with exploit tests, not optional "nice-to-haves".

---

### 8. Implementation

**Purpose**: Write the code following the tasks checklist.

**Options**:
1. **Manual**: Implement tasks yourself, checking off boxes as you complete them
2. **Agent-assisted**: Use AI coding assistants with SpecIA context

**Deliverables**:
- Working code
- Unit and integration tests
- Exploit tests (proof-of-concept tests that verify mitigations work)
- Updated `tasks.md` with completed checkboxes

---

### 9. AUDIT — Verification (MANDATORY)

**Purpose**: Verify implementation matches specifications and security controls work.

**Usage**:
```bash
specia audit add-rate-limiting
```

**What it verifies**:

#### Requirements Coverage
Checks each requirement has:
- ✅ Code implementation
- ✅ Passing tests
- ✅ Adequate test coverage

#### Abuse Case Verification
Runs exploit tests to verify attacks are blocked.

#### Dynamic Testing
- Runs full test suite
- Executes exploit proof-of-concepts
- Checks code coverage (default: 80% minimum)
- Verifies build succeeds

**Output**: `audit.md` with:
- Verdict (pass/fail)
- Requirements coverage report
- Abuse case test results
- Test coverage metrics
- Recommendations for fixes

**Security postures**:
- **standard**: Requirements + basic security checks
- **elevated**: Requirements + all abuse cases + coverage
- **paranoid**: Everything + DREAD re-scoring

**Critical**: This is a mandatory gate (by default) — you cannot archive without passing audit.

---

### 10. Done — Archive Specification

**Purpose**: Archive the completed change.

**Usage**:
```bash
specia done add-rate-limiting
```

**Pre-flight checks**:
- ✅ Audit completed (unless `--skip-audit` was set in proposal)
- ✅ Audit verdict is "pass"
- ⚠️ Can override with `--force` (not recommended)

**Actions**:
- Moves change from `.specia/changes/` to `specs/archived/`
- Creates consolidated spec in `specs/`
- Updates `specs/CATALOG.md`

**Result**: Immutable archive of the complete change specification for future reference.

---

## Guardian Pre-Commit Hook

**Purpose**: Validates compliance with SpecIA before allowing commits.

**Installation**: Automatic during `specia init`, or manually:
```bash
specia hook install --mode warn
```

### Validation Layers

**Layer 1: Spec Coverage**  
Ensures changed files are covered by an active SpecIA change.

**Layer 2: Review Completeness**  
Verifies security review exists and is up-to-date with spec.

**Layer 3: Mitigation Compliance**  
Checks all security mitigations in tasks.md are marked complete.

**Layer 4: Spec-Aware Validation (Optional)**  
Analyzes code to verify it implements requirements from spec.

### Modes

- **warn**: Show warnings but allow commit (default for development)
- **strict**: Block commits that violate checks (recommended for production branches)

### Configuration

```yaml
# .specia/config.yaml
guardian:
  enabled: true
  mode: warn
  exclude_paths:
    - "test/**"
    - "docs/**"
    - "*.md"
```

---

## When to Use Full Workflow

**Use Full SpecIA when**:
- ✅ Security-sensitive features (auth, payments, data handling)
- ✅ External integrations (APIs, webhooks)
- ✅ Compliance requirements (SOC 2, PCI-DSS, HIPAA)
- ✅ Features that need abuse case testing
- ✅ Changes requiring architectural documentation

**Consider SpecIA Lite for**:
- Simple CRUD operations
- Documentation updates
- Non-security refactors
- Quick bug fixes

---

## Quick Start Example

```bash
# 1. Initialize project
specia init \
  --project-description "E-commerce API" \
  --security-posture elevated

# 2. Create change proposal
specia new add-oauth-login \
  --intent "Secure user authentication" \
  --scope "src/auth/"

# 3. Write specification
specia spec add-oauth-login

# 4. Run security review
specia review add-oauth-login --api

# 5. Generate implementation tasks
specia tasks add-oauth-login

# 6. Implement features
# ... write code, run tests ...

# 7. Commit (Guardian validates automatically)
git add . && git commit -m "feat: add OAuth login"

# 8. Run post-implementation audit
specia audit add-oauth-login

# 9. Archive specification
specia done add-oauth-login
```

**Time**: ~30 minutes (vs hours of manual security review)  
**Vulnerabilities detected**: 8-12 on average (vs 2-3 in manual review)

---

## Benefits

### Security Shift-Left
- Review threats **before** writing code (10x cheaper to fix)
- Automated abuse case testing
- Evidence-based compliance

### Automated Compliance
- SOC 2: Complete audit trail (review + audit + guardian logs)
- PCI-DSS: Mandatory security review for payment features
- HIPAA: Abuse cases for PII handling
- ISO 27001: Documented security process

### Prevention vs Detection
- **Guardian Hook**: Prevents commits without security review
- **Security Review**: Identifies threats before implementation
- **Audit**: Detects gaps after implementation

---

## See Also

- **SpecIA Lite**: `docs/comparison.md` — Lightweight alternative for simple changes
- **Migration Guide**: `docs/v1-to-v2-migration.md`
- **Decision Tree**: `docs/specia-decision-tree.md` — Choose between Lite and Full

**Last updated**: April 2026  
**Version**: v2.1.0
