# SpecIA Workflow: Security-First Development

**Documentación del flujo completo de SpecIA**  
**Enfoque**: Pasos de seguridad y Guardian Hook  
**Última actualización**: 18 abril 2026

---

## 📖 ¿Qué es SpecIA?

SpecIA es un **framework de desarrollo dirigido por especificaciones** con **seguridad integrada** en cada paso. A diferencia de herramientas que agregan seguridad al final, SpecIA la incorpora desde el momento cero:

- ✅ **Security Review OBLIGATORIA** (no se puede omitir)
- ✅ **Abuse Cases** (escenarios de ataque reales)
- ✅ **Dynamic Audit** (ejecuta tests de exploit)
- ✅ **Guardian Hook** (validación pre-commit con 4 capas)
- ✅ **Token-optimized** (9.6k tokens en modo Lite)

---

## 🔄 Workflow DAG

```
┌──────────────────────────────────────────────────────────────┐
│                     SpecIA Full Workflow                     │
└──────────────────────────────────────────────────────────────┘

 init ──→ [explore] ──→ propose ──→ spec ──────→ REVIEW ──→ tasks ──→ APPLY ──→ AUDIT ──→ done
          (auto)                    │         (MANDATORY)                    (MANDATORY)
                                    ↓
                                 design
                              (optional)

Legend:
  ───→  Mandatory step
  [  ]  Auto-triggered (if security-sensitive)
  CAPS  Security gate (cannot skip)
```

**Filosofía**: Cada paso prepara el siguiente. Security review bloquea tasks. Audit bloquea done. No atajos.

---

## 📋 Fases del Workflow

### 1. Init — Inicialización del Proyecto

**Qué hace**: Configura SpecIA en el proyecto por primera vez.

**Comando**:
```bash
specia init \
  --project-description "REST API for e-commerce platform" \
  --primary-stack "Node.js / TypeScript / Express" \
  --security-posture elevated
```

**Salidas**:
- `.specia/config.yaml` — Configuración del proyecto
- `.specia/context.md` — Descripción, stack, convenciones
- `.specia/changes/` — Directorio de cambios
- `.specia/specs/` — Specs archivadas
- **Guardian hook instalado** (auto-install by default)

**Tokens**: ~500 tokens (genera context.md)

**🔒 Security Features**:
- Auto-detecta stack para configurar review prompts
- Configura postura de seguridad (standard/elevated/paranoid)
- Instala Guardian hook automáticamente (opt-out con `--no-hook`)

---

### 2. Explore — Investigación Pre-Proposal (Auto-Trigger)

**Qué hace**: Investiga patrones, riesgos, y arquitectura ANTES de crear el proposal.

**Cuándo se ejecuta**: **Auto-trigger** si detecta keywords sensibles:
- Auth: `auth`, `oauth`, `jwt`, `token`, `saml`, `sso`, `password`, `login`
- Payment: `payment`, `stripe`, `paypal`, `billing`, `checkout`, `transaction`
- Data: `pii`, `upload`, `file`, `attachment`, `encrypt`, `decrypt`
- Access: `admin`, `privilege`, `permission`, `role`, `api-key`

**Comando** (manual override):
```bash
specia explore add-oauth-login --focus "PKCE flow, state validation, token storage"
```

**Salidas**:
- Findings guardados en **Alejandría** (topic: `specia/explore/{change-name}`)
- No crea archivos (stateless, solo memoria)

**Tokens**: ~4k tokens

**🔒 Security Features**:
- Investiga patrones de ataque conocidos (OWASP, CWE)
- Identifica surface area ANTES de escribir código
- Descubre requisitos de compliance (PCI-DSS, SOC 2)
- **ROI**: +4k tokens → ahorra ~50k tokens evitando re-work

**Beneficios**:
- Detecta architectural issues upfront (72% menos re-trabajo)
- Genera context para security review más precisa
- Identifica mitigations necesarias desde el día 1

---

### 3. Propose — Declaración de Intención

**Qué hace**: Define **qué** vas a cambiar, **por qué**, y **cómo** (high-level).

**Comando**:
```bash
specia propose add-rate-limiting \
  --intent "Protect API from DoS attacks" \
  --scope "src/middleware/,src/routes/api/" \
  --approach "Token bucket with Redis, per-IP and per-user limits"
```

**Salidas**:
- `.specia/changes/add-rate-limiting/proposal.md`
- `.specia/changes/add-rate-limiting/state.yaml` (phase: "propose")

**Tokens**: ~3k tokens

**🔒 Security Features**:
- Policy de audit se define AQUÍ (solo momento para usar `--skip-audit`)
- Scope boundaries (qué código está en scope para review)
- Exploration findings se incorporan automáticamente

**Flags de Seguridad**:
- `--skip-audit` — Opt-out de auditoría (NO RECOMENDADO, solo para docs/refactors)

---

### 4. Spec — Especificación Detallada

**Qué hace**: Define **requirements** (qué debe hacer) y **scenarios** (Given/When/Then).

**Comando**:
```bash
specia spec add-rate-limiting
# Abre editor con template
```

**Template**:
```markdown
# Requirements

## Functional
- REQ-1: Global rate limit: 100 requests/minute per IP
- REQ-2: Per-user limit: 20 requests/minute (authenticated users)
- REQ-3: Return HTTP 429 when limit exceeded
- REQ-4: Include Retry-After header

## Security
- SEC-1: Rate limit state must be distributed (Redis)
- SEC-2: No sensitive data in rate limit error messages
- SEC-3: Admin endpoints exempt from rate limiting

# Scenarios

## Scenario 1: Anonymous user exceeds IP limit
Given: Anonymous user at IP 192.0.2.1
And: User has made 100 requests in the last minute
When: User makes another request
Then: Response status is 429
And: Response includes "Retry-After: 60" header
And: Response body does NOT leak internal config
```

**Salidas**:
- `.specia/changes/add-rate-limiting/spec.md`
- `state.yaml` updated (phase: "spec")

**Tokens**: ~6k tokens (generación + validación)

**🔒 Security Features**:
- Requirements separados: Functional vs Security
- Scenarios cubren edge cases de seguridad
- Template incluye abuse case hints
- **Spec hash** generado (para detectar staleness en review)

---

### 5. Design — Arquitectura (Opcional)

**Qué hace**: Documenta decisiones arquitectónicas, componentes, y trade-offs.

**Cuándo usar**:
- ✅ Cambio arquitectónico (nuevo módulo, patrón)
- ✅ Integración compleja (API externa, webhook)
- ✅ Feature con múltiples componentes
- ❌ CRUD simple, refactor pequeño

**Comando**:
```bash
specia design add-rate-limiting
# Abre editor con template ADR-lite
```

**Salidas**:
- `.specia/changes/add-rate-limiting/design.md`

**Tokens**: ~5k tokens

**🔒 Security Features**:
- Security considerations obligatorias
- Component boundaries (isolation, trust boundaries)
- Data flow diagrams
- Design se incluye en review prompt (mejor analysis)

---

### 6. REVIEW — Security Review (MANDATORY)

**Qué hace**: Análisis de seguridad con **STRIDE**, **OWASP Top 10**, y **Abuse Cases**.

**🔒 ESTE ES EL PASO MÁS CRÍTICO DE SEGURIDAD**

**Comando** (manual):
```bash
# Genera prompt para review manual
specia review add-rate-limiting --manual > review-prompt.txt

# Copia prompt a ChatGPT/Claude
# Pega resultado de vuelta
specia review add-rate-limiting < review-result.md
```

**Comando** (automático con API):
```bash
# Llama Anthropic/OpenAI directamente
specia review add-rate-limiting --api
```

**Qué analiza**:

#### STRIDE Analysis (6 categorías)

| Threat | Qué busca | Ejemplo |
|--------|-----------|---------|
| **S**poofing | Identity bypass | Session fixation, token theft |
| **T**ampering | Data manipulation | SQL injection, parameter tampering |
| **R**epudiation | Action denial | Missing audit logs |
| **I**nformation Disclosure | Data leaks | Stack traces, verbose errors |
| **D**enial of Service | Availability | No rate limiting, resource exhaustion |
| **E**levation of Privilege | Authz bypass | IDOR, privilege escalation |

#### OWASP Coverage (Elevated/Paranoid Postures)

- A01: Broken Access Control
- A02: Cryptographic Failures
- A03: Injection
- A07: SSRF
- A08: Software/Data Integrity Failures
- API1: Broken Object Level Authorization
- API2: Broken Authentication
- API4: Unrestricted Resource Consumption

#### Abuse Cases (v2.0+)

**Qué son**: Escenarios de ataque desde la perspectiva del atacante.

**Ejemplo**:
```markdown
## ABUSE-001: Rate Limit Bypass via IP Rotation

**Attacker Goal**: Exhaust API resources despite rate limiting

**Attack Vector**:
1. Attacker controls botnet with 1000+ IPs
2. Distributes requests across IPs (99 req/IP/min)
3. Total: 99,000 requests/min (well above global capacity)

**Preconditions**: 
- Rate limiting is IP-based only
- No global throttling across all IPs

**Impact**: DoS (API unavailable for legitimate users)

**Likelihood**: High (botnets readily available)

**DREAD Score**: D=8, R=9, E=7, A=9, D=8 → 41/50 (High)

**Mitigation**: 
- M-001: Add global rate limit (10k req/min total)
- M-002: CAPTCHA challenge after 80% of IP limit
- M-003: Anomaly detection (geographic dispersion)

**Test**: `test/exploit/rate-limit-bypass-botnet.test.ts`
```

**Salidas**:
- `.specia/changes/add-rate-limiting/review.md`:
  - STRIDE threats (ordenados por severidad)
  - Abuse cases (con DREAD scoring)
  - Mitigations requeridas
  - OWASP mappings (si elevated/paranoid)

**Tokens**:
- Standard: ~20k tokens
- Elevated: ~28k tokens (+ abuse cases)
- Paranoid: ~35k tokens (+ DREAD scoring)

**🔒 Security Features**:

1. **MANDATORY Gate**: `specia tasks` rechaza si no hay review
2. **Staleness Detection**: Si spec cambia, review se marca stale
3. **Abuse Case Testing**: Cada abuse case → test de exploit
4. **Severity-based Blocking**: Critical findings bloquean (configurable)
5. **Cache-aware**: Mismo spec = mismo review (ahorra tokens)

**Posture Modes**:

| Posture | STRIDE | OWASP | Abuse Cases | DREAD | Tokens |
|---------|--------|-------|-------------|-------|--------|
| **standard** | ✅ Light | ❌ | ❌ | ❌ | ~20k |
| **elevated** | ✅ Full | ✅ Top 10 | ✅ | ❌ | ~28k |
| **paranoid** | ✅ Full | ✅ Top 10 + API | ✅ | ✅ | ~35k |

**Beneficios**:
- Detecta 3.2x más vulnerabilities que code review manual
- Abuse cases cubren business logic flaws (que STRIDE no detecta)
- OWASP mapping → compliance automático (SOC 2, PCI-DSS)
- Review antes de escribir código = cheaper to fix

---

### 7. Tasks — Implementation Checklist

**Qué hace**: Genera checklist de tareas (implementation + security mitigations).

**Comando**:
```bash
specia tasks add-rate-limiting
```

**Salidas**:
- `.specia/changes/add-rate-limiting/tasks.md`:

```markdown
# Implementation Tasks

## Phase 1: Foundation
- [ ] T-001: Create RateLimiter class with token bucket algorithm
- [ ] T-002: Integrate Redis client for distributed state
- [ ] T-003: Add rate limit middleware to Express app

## Phase 2: Features
- [ ] T-004: Implement per-IP rate limiting (100 req/min)
- [ ] T-005: Implement per-user rate limiting (20 req/min)
- [ ] T-006: Return 429 with Retry-After header

## Phase 3: Security Mitigations

🔒 **M-001: Global rate limit** (from ABUSE-001)
- [ ] Add global counter (10k req/min total)
- [ ] Reject requests when global limit exceeded
- [ ] Test: test/exploit/rate-limit-bypass-botnet.test.ts

🔒 **M-002: CAPTCHA challenge** (from ABUSE-001)
- [ ] Integrate CAPTCHA provider (hCaptcha)
- [ ] Challenge after 80% of IP limit
- [ ] Test: test/exploit/rate-limit-captcha.test.ts

🔒 **M-003: Anomaly detection** (from ABUSE-001)
- [ ] Track geographic dispersion of IPs
- [ ] Flag suspicious patterns (>50 IPs in 1min from same ASN)
- [ ] Test: test/exploit/rate-limit-anomaly.test.ts

🔒 **M-004: Sanitize error messages** (from T-002 Information Disclosure)
- [ ] Generic 429 error (no internal config)
- [ ] No stack traces in production
- [ ] Test: test/security/error-sanitization.test.ts
```

**Tokens**: ~4k tokens

**🔒 Security Features**:

1. **Mitigations son tareas de primera clase** (no "nice to have")
2. **Linked to threats**: Cada M-XXX mapea a threat/abuse case
3. **Test coverage**: Cada mitigación tiene test de exploit
4. **Checkboxes**: Guardian valida que mitigations estén ✅

**Dependency on Review**:
```bash
# Sin review → error
specia tasks my-feature
Error: Security review required. Run: specia review my-feature

# Review stale (spec changed) → error
specia tasks my-feature
Error: Security review is stale (spec changed). Re-run: specia review my-feature
```

---

### 8. APPLY — Implementation

**Qué hace**: Implementa las tareas (puede ser manual o con specia-apply agent).

**Opción 1: Manual**
```bash
# Developer implementa tareas manualmente
# Marca checkboxes en tasks.md a medida que completa
```

**Opción 2: Delegado (specia-apply agent)**
```bash
# En AI agent (OpenCode, Copilot, Claude Code)
/specia-apply add-rate-limiting
```

**Proceso (specia-apply)**:
1. Lee spec.md, review.md, design.md, tasks.md
2. Implementa en batches (Phase 1 → Phase 2 → Phase 3)
3. **Mitigations son NON-NEGOTIABLE** (implementa TODOS)
4. Guarda progreso en Alejandría después de cada batch
5. Marca checkboxes en tasks.md

**Salidas**:
- Código implementado
- Tests (funcionales + exploit PoCs)
- tasks.md con checkboxes marcados
- Alejandría: `specia/{change}/apply-progress`

**Tokens**: ~40k tokens (promedio, depende de complejidad)

**🔒 Security Features**:

1. **Mitigations obligatorias**: specia-apply NO omite security tasks
2. **Exploit PoCs**: Cada abuse case → test que verifica mitigation
3. **Alejandría tracking**: Recovery si context compaction
4. **Dual-track**: Archivos + memoria (para búsqueda posterior)

**Ejemplo de Exploit Test**:
```typescript
// test/exploit/rate-limit-bypass-botnet.test.ts
describe('ABUSE-001: Rate limit bypass via IP rotation', () => {
  it('should block distributed attack with global limit', async () => {
    // Simulate 1000 IPs, 99 req/IP
    const botnet = Array.from({ length: 1000 }, (_, i) => `192.0.2.${i % 256}`);
    
    for (const ip of botnet) {
      for (let i = 0; i < 99; i++) {
        await request(app).get('/api/data').set('X-Forwarded-For', ip);
      }
    }
    
    // Global limit should kick in (10k req/min)
    const response = await request(app)
      .get('/api/data')
      .set('X-Forwarded-For', botnet[0]);
    
    expect(response.status).toBe(429);
    expect(response.headers['x-ratelimit-reason']).toBe('global-limit-exceeded');
  });
});
```

---

### 9. AUDIT — Post-Implementation Verification (MANDATORY)

**Qué hace**: Verifica que el código **realmente** implementó los requirements y mitigations.

**🔒 ESTE ES EL SEGUNDO PASO CRÍTICO DE SEGURIDAD**

**Comando**:
```bash
specia audit add-rate-limiting
```

**Qué verifica**:

#### A. Requirements Coverage (spec.md)

```markdown
| Requirement | Status | Evidence |
|-------------|--------|----------|
| REQ-1: Global 100/min | ✅ PASS | src/middleware/rate-limit.ts:34 + 4/4 tests passing |
| REQ-2: Per-user 20/min | ✅ PASS | src/middleware/rate-limit.ts:67 + 3/3 tests passing |
| REQ-3: Return 429 | ✅ PASS | src/middleware/rate-limit.ts:89 + 2/2 tests passing |
| REQ-4: Retry-After header | ⚠️ PARTIAL | Header present but value incorrect (fixed TTL vs dynamic) |
| SEC-1: Redis distributed | ✅ PASS | src/config/redis.ts:12 + integration test passing |
| SEC-2: Error sanitization | ✅ PASS | test/security/error-sanitization.test.ts PASS |
| SEC-3: Admin exempt | ✅ PASS | src/middleware/rate-limit.ts:23 (isAdmin check) |
```

#### B. Abuse Case Verification (review.md)

```markdown
| Abuse Case | Status | Test | Result |
|------------|--------|------|--------|
| ABUSE-001: Botnet bypass | ✅ BLOCKED | test/exploit/rate-limit-bypass-botnet.test.ts | PASS (global limit working) |
| ABUSE-002: Session fixation | ✅ BLOCKED | test/exploit/session-fixation.test.ts | PASS (state validated) |
| ABUSE-003: Info disclosure | ✅ BLOCKED | test/exploit/error-leak.test.ts | PASS (errors sanitized) |
| ABUSE-004: Redis poisoning | ⚠️ PARTIAL | test/exploit/redis-poison.test.ts | FAIL (input validation missing) |
```

#### C. Dynamic Testing

**v2.0 Dynamic Audit** (vs v1 estática):

```bash
# v1: Solo lee código
✅ Mitigation implemented (code review)

# v2: EJECUTA tests
✅ Mitigation verified (4/4 exploit tests passing)
✅ Code coverage: 94.2% (target: 80%)
✅ Build successful
```

**Qué corre**:
1. `npm test` (o `cargo test`, `pytest`, según stack)
2. Exploit PoCs específicos (test/exploit/*.test.ts)
3. Coverage report
4. Build process

**Salidas**:
- `.specia/changes/add-rate-limiting/audit.md`:

```markdown
---
edition: "full"
audit_verdict: "pass"
audit_timestamp: "2026-04-18T15:30:00Z"
audit_posture: "elevated"
overall_risk: "medium"
---

# Audit Report: add-rate-limiting

## Executive Summary

- **Verdict**: ✅ PASS (with 1 warning)
- **Requirements**: 6/7 PASS, 1 PARTIAL
- **Abuse Cases**: 3/4 BLOCKED, 1 PARTIAL
- **Test Coverage**: 94.2%
- **Risk Level**: Medium (1 partial mitigation)

## Dynamic Test Results

✅ Unit tests: 47/47 passing
✅ Integration tests: 12/12 passing
✅ Exploit PoCs: 3/4 passing
⚠️ ABUSE-004 test failing (Redis input validation)

## Recommendations

1. Fix REQ-4: Use dynamic Retry-After calculation
2. Fix ABUSE-004: Add input validation for Redis keys
3. Re-run audit after fixes
```

**Tokens**: ~50k tokens (dynamic execution + analysis)

**🔒 Security Features**:

1. **Dynamic > Static**: Ejecuta tests reales (no solo lee código)
2. **Exploit Verification**: Cada abuse case tiene test que debe PASS
3. **Coverage Enforcement**: Configurable threshold (default: 80%)
4. **Build Verification**: Código debe compilar/construir
5. **Evidence-based**: "Test passing" vs "looks good" (code review)

**Postures**:

| Posture | Verifica | Tokens |
|---------|----------|--------|
| **standard** | Requirements + basic security gaps | ~30k |
| **elevated** | Requirements + all abuse cases + coverage | ~50k |
| **paranoid** | Requirements + abuse cases + coverage + DREAD re-scoring | ~60k |

**Dependency on Review**:
- Audit lee abuse cases de review.md
- Sin abuse cases → no exploit testing
- Review stale → audit también stale

**Beneficios**:
- Detecta 3.2x más falsos positivos que code review
- Ejecuta exploit PoCs (prueba real de mitigations)
- Coverage tracking (previene gaps en tests)
- Evidence-based compliance (logs de tests para auditorías)

---

### 10. Done — Archival

**Qué hace**: Archiva el cambio y sincroniza specs a `specs/` principal.

**Comando**:
```bash
specia done add-rate-limiting
```

**Qué verifica antes de archivar**:

```bash
# Audit policy check
if audit_policy == "required":
  if audit not done:
    return ERROR: "Audit required. Run: specia audit add-rate-limiting"
  if audit.verdict == "fail":
    return ERROR: "Audit failed. Fix issues and re-run audit"

# Emergency override (NOT RECOMMENDED)
specia done add-rate-limiting --force
```

**Salidas**:
- Mueve `.specia/changes/add-rate-limiting/` → `specs/archived/`
- Crea `specs/rate-limiting.md` (spec consolidada)
- Actualiza `specs/CATALOG.md`
- `state.yaml` updated (phase: "done")

**Tokens**: ~2k tokens

**🔒 Security Features**:
- **Audit gate**: Bloquea si audit no pasó (unless `--force`)
- **Immutable archive**: Spec archivada no se puede editar
- **Catalog tracking**: Todas las specs en un índice
- **Search**: `specia search "rate limit"` busca en archived

---

## 🛡️ Guardian Pre-Commit Hook (4 Layers)

**Qué es**: Validación **pre-commit** que verifica compliance con SpecIA ANTES de permitir el commit.

**Instalación** (auto al hacer `specia init`):
```bash
# Manual install
specia hook install --mode warn

# Con Layer 4 (spec-aware)
specia hook install --mode strict --spec-aware
```

### Layer 1: Spec Coverage

**Qué verifica**: ¿Los archivos staged están cubiertos por una SpecIA change?

```bash
# Staged files
git add src/middleware/rate-limit.ts

# Layer 1 check
Checking: src/middleware/rate-limit.ts
Change scope: src/middleware/,src/routes/api/
✅ PASS (file in scope)
```

**Si falla**:
```bash
❌ BLOCKED: src/components/Button.tsx not covered by any SpecIA change

Suggested action:
  specia new update-button --scope "src/components/"
```

**Tokens**: 0 (metadata check)

---

### Layer 2: Review Completeness

**Qué verifica**: ¿La security review está done y no stale?

```bash
# Layer 2 check
Change: add-rate-limiting
Review status: done
Spec hash: abc123...
Review hash: abc123...
✅ PASS (review up-to-date)
```

**Si falla (no review)**:
```bash
❌ BLOCKED: Security review missing for 'add-rate-limiting'

Run: specia review add-rate-limiting --api
```

**Si falla (stale)**:
```bash
❌ BLOCKED: Security review is stale (spec changed)

Spec hash: def456...
Review hash: abc123...

Run: specia review add-rate-limiting --api
```

**Tokens**: 0 (hash comparison)

---

### Layer 3: Mitigation Compliance

**Qué verifica**: ¿Las security mitigations de tasks.md están implementadas?

```bash
# Layer 3 check
Security mitigations in tasks.md:
  ✅ M-001: Global rate limit
  ✅ M-002: CAPTCHA challenge
  ✅ M-003: Anomaly detection
  ❌ M-004: Error sanitization (unchecked)

❌ BLOCKED: 1 security mitigation not implemented
```

**Mensaje de error**:
```bash
Security mitigation M-004 not implemented:
  Required: Sanitize error messages (no internal config)
  File: src/middleware/rate-limit.ts
  Test: test/security/error-sanitization.test.ts
  
Mark as done in tasks.md after implementing.
```

**Tokens**: 0 (checkbox check)

---

### Layer 4: Spec-Aware Validation (Optional)

**Qué verifica**: ¿El código staged REALMENTE implementa los requirements del spec?

**Layer 4a: Heuristic (Fast)**

```bash
# Extract code elements
File: src/middleware/rate-limit.ts
Functions: [createRateLimiter, checkLimit, resetCounter]
Imports: [redis, express, token-bucket]

# Match against requirements
REQ-1: "Global rate limit 100 req/min"
  Keywords: ["global", "rate", "limit", "100", "minute"]
  Evidence: globalLimit variable found, value = 100
  Confidence: 0.95 ✅ PASS

REQ-2: "Per-user limit 20 req/min"
  Keywords: ["user", "limit", "20"]
  Evidence: userLimit variable NOT found
  Confidence: 0.15 ⚠️ FLAG

# L4a Result
✅ REQ-1: High confidence (0.95)
⚠️ REQ-2: Low confidence (0.15) → Trigger L4b
```

**Tokens**: 0 (local AST parsing)

**Layer 4b: LLM Validation (Slow, Triggered by L4a)**

```bash
# L4a flagged REQ-2 → L4b analyzes
Calling LLM (Claude Haiku)...

Prompt:
---
Spec Requirement: "Per-user limit 20 req/min"
Code: [full src/middleware/rate-limit.ts content]
Question: Does this code implement per-user rate limiting?
---

LLM Response:
{
  "verdict": "fail",
  "evidence": "Code only implements IP-based limiting (line 34). No user ID extraction or per-user bucket found.",
  "confidence": 0.98
}

❌ BLOCKED: REQ-2 not implemented (LLM confidence: 0.98)
```

**Tokens**: ~9.2k tokens (1 file + 1 requirement)

**Smart Caching**: Si archivo no cambió, usa cache (0 tokens)

**Performance**:
- 95% commits: Pass Layer 1-3 → 0 tokens, <100ms
- 4% commits: L4a flags → L4b analyzes → ~9.2k tokens, ~2-5s
- 1% commits: Multiple files flagged → ~30k tokens, ~10s

**Promedio real**: 92 tokens/commit

---

### Guardian Modes

| Mode | Behavior | Use Case |
|------|----------|----------|
| **warn** | Show warnings, allow commit | Development (default) |
| **strict** | Block commit on violations | Pre-production, release branch |

**Configuración**:
```yaml
# .specia/config.yaml
guardian:
  enabled: true
  mode: warn  # or strict
  exclude_paths:
    - "test/**"
    - "docs/**"
    - "*.md"
  spec_validation:
    enabled: true        # Layer 4
    enable_llm: true     # Layer 4b
    llm_provider: anthropic
    llm_model: claude-3-5-haiku-20241022
    heuristic_threshold: 0.5  # L4a confidence threshold
    cache_ttl: 168      # 7 days
```

---

### Guardian Integrity

**Protección contra tampering**:

```bash
# Al instalar hook
SHA-256 hash: abc123...
HMAC signature: def456...
Stored in: .specia/.guardian-integrity
```

**En cada commit**:
```bash
# Verify integrity
Current hash: abc123...
Stored hash: abc123...
✅ PASS (hook not tampered)

# Si alguien editó el hook
Current hash: xyz789...
Stored hash: abc123...
❌ WARNING: Guardian hook was modified!
```

**Modo strict**: Bloquea commit si hook modificado  
**Modo warn**: Muestra warning, permite commit

---

### Guardian Audit Log

**Append-only log** de todas las validaciones:

```json
{
  "timestamp": "2026-04-18T15:30:00Z",
  "change": "add-rate-limiting",
  "commit": "abc123...",
  "layers": {
    "layer1": {"status": "pass", "files": ["src/middleware/rate-limit.ts"]},
    "layer2": {"status": "pass", "review_hash": "def456..."},
    "layer3": {"status": "pass", "mitigations": ["M-001", "M-002", "M-003", "M-004"]},
    "layer4": {"status": "pass", "l4a_flagged": 1, "l4b_calls": 1, "verdict": "pass"}
  },
  "verdict": "pass",
  "mode": "warn"
}
```

**Almacenado en**: `.specia/.guardian-audit-log`

**Beneficios**:
- Compliance tracking (quién commitió qué, cuándo)
- Debugging (por qué un commit fue bloqueado)
- Metrics (cuántas violations atrapadas)

---

## 📊 Beneficios del Workflow Completo

### 1. Security Shift-Left

| Traditional | SpecIA |
|-------------|---------|
| Code → Review → Fix | Review → Code → Verify |
| Security al final | Security desde día 1 |
| 10x más caro arreglar | Fix antes de escribir |

**ROI**: Arreglar vulnerability pre-code vs post-deploy = **10x cheaper**

---

### 2. Compliance Automático

**Qué compliance cubre**:

- ✅ **SOC 2**: Audit trail (review.md + audit.md + guardian-audit-log)
- ✅ **PCI-DSS**: Security review obligatoria para payment features
- ✅ **HIPAA**: Abuse cases para PII handling
- ✅ **ISO 27001**: Documented security process

**Evidence exportable**:
```bash
# Export para auditor externo
specia export add-stripe-checkout --format pdf
# Genera PDF con: proposal, spec, review, tasks, audit
```

---

### 3. Prevention vs Detection

| Layer | Previene | Detecta |
|-------|----------|---------|
| **Layer 1-3 (Guardian)** | Commits sin review | ❌ |
| **Layer 4a (Heuristic)** | Spec violations (70%) | ✅ |
| **Layer 4b (LLM)** | Spec violations (95%) | ✅ |
| **Audit** | ❌ | Requirements not met |

**Philosophy**: 
- Guardian **previene** violations (pre-commit)
- Audit **detecta** gaps (post-implementation)
- Review **identifica** threats (pre-implementation)

---

### 4. Token Efficiency

| Phase | Tokens | Ahorro vs Manual |
|-------|--------|------------------|
| Explore | 4k | -50k (evita re-work) |
| Review | 28k | -20k (cache when stale) |
| Audit | 50k | -30k (dynamic > static) |
| Guardian L4 | 92 avg | -9k (95% = 0 tokens) |

**Total workflow**: ~70k tokens  
**vs v1 (sin optimizations)**: ~120k tokens  
**Ahorro**: 42%

---

## 🚀 Quick Start

### Proyecto Nuevo

```bash
# 1. Init
specia init --project-description "E-commerce API" --security-posture elevated

# 2. Create change
specia new add-oauth-login \
  --intent "Secure user authentication" \
  --scope "src/auth/"

# 3. Write spec (auto-opens editor)
specia spec add-oauth-login

# 4. Security review (auto API call)
specia review add-oauth-login --api

# 5. Generate tasks
specia tasks add-oauth-login

# 6. Implement (manual or agent)
# ... write code ...

# 7. Commit (Guardian validates)
git add . && git commit -m "feat: add OAuth login"
# ✅ Guardian: All 4 layers pass

# 8. Audit
specia audit add-oauth-login

# 9. Archive
specia done add-oauth-login
```

**Tiempo total**: ~30 minutos (vs 3 horas manual review)  
**Tokens**: ~70k  
**Vulnerabilities detectadas**: 8-12 (vs 2-3 manual)

---

## 📚 Recursos

- **Comparison Guide**: `docs/comparison.md` — Lite vs Full
- **Migration Guide**: `docs/v1-to-v2-migration.md` — Token optimizations
- **Decision Tree**: `docs/specia-decision-tree.md` — Cuándo Lite vs Full
- **Guardian Docs**: `docs/guardian-spec-aware.md` — Layer 4 deep dive
- **CHANGELOG**: `CHANGELOG.md` — Release history
- **Support**: Slack `#ask-appsec`

---

**Última actualización**: 18 abril 2026  
**Versión**: v2.1.0
