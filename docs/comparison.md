# SpecIA Lite vs Full: Comparison Guide

## Executive Summary

Choose the right edition for your needs:

- **Lite**: Quick security checks (review + audit), zero dependencies, <1 minute setup
- **Full**: Complete spec-driven workflow with state persistence, audit trail, dynamic testing

## Feature Comparison

| Feature | Lite | Full |
|---------|------|------|
| **Setup Time** | <1 min | ~5 min |
| **Dependencies** | None | Node.js 20+ |
| **Execution Speed** | ~45s | ~10 min |
| **State Persistence** | ❌ | ✅ (.specia/ + Alejandría) |
| **Threat Coverage** | Critical/High only | All severities |
| **STRIDE Analysis** | Exploitable threats | Complete (6 categories) |
| **DREAD Scoring** | ❌ | ✅ |
| **Abuse Cases** | ❌ | ✅ (5-10 scenarios) |
| **Test Execution** | Static (files exist) | Dynamic (runs tests) |
| **Coverage Reports** | ❌ | ✅ (lcov/istanbul) |
| **Compliance Audit** | ❌ | ✅ |

## When to Use Each Edition

### Use Lite For:
- ✅ PR security reviews
- ✅ Quick developer checks
- ✅ Continuous security (every commit)
- ✅ Rapid prototyping
- ✅ Non-compliance projects

### Use Full For:
- ✅ Production release gates
- ✅ Compliance requirements (SOC 2, PCI-DSS, HIPAA)
- ✅ High-security features (auth, payment, PII)
- ✅ Audit trail requirements
- ✅ Dynamic test execution
- ✅ Abuse case testing

## Key Workflow Differences

### Lite Workflow (~1 minute)
```
Create spec → specia-review-lite → Implement → specia-audit-lite → Merge
```
- **Output**: Inline results only, no artifacts
- **Analysis**: Critical threats with 1-sentence fixes

### Full Workflow (~10 minutes)
```
specia init → specia new → review → tasks → apply → audit → done
```
- **Output**: 10+ files in `.specia/changes/`, archived to `.specia/specs/`
- **Analysis**: Complete STRIDE + OWASP + CWE mapping + abuse cases

## Quick Decision Guide

```
Need compliance audit trail? ──YES──→ Full
  │
  NO
  ↓
High-security feature? ──YES──→ Full
(auth, payment, PII)
  │
  NO
  ↓
Dynamic testing required? ──YES──→ Full
  │
  NO
  ↓
Quick PR review? ──YES──→ Lite
  │
  NO
  ↓
Default: Use Full
```

## Recommendation

**80/20 Rule**: Use Lite for 80% of features (routine development), Full for 20% (critical features + compliance).

**Hybrid Approach**: Run Lite on every PR, Full for release gates.
