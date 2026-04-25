# SpecIA Decision Tree: ¿Lite o Full?

**Guía rápida para desarrolladores y líderes técnicos**  
**Enfoque**: Optimización de tokens

---

## 🚦 Decision Tree

```
┌─────────────────────────────────────────────────────┐
│  ¿Qué tipo de feature estás desarrollando?          │
└─────────────────────────────────────────────────────┘
                       │
                       ▼
        ┌──────────────┴──────────────┐
        │                              │
    ¿SENSIBLE?                     ¿NO SENSIBLE?
        │                              │
        ▼                              ▼
 ┌─────────────────┐           ┌─────────────────┐
 │ Auth/Payment    │           │ UI/CRUD/Refactor│
 │ API pública     │           │ Docs/Tests      │
 │ PII/Upload      │           │ Internal tools  │
 │ Admin/Privilege │           │ Copy changes    │
 └────────┬────────┘           └────────┬────────┘
          │                              │
          ▼                              ▼
 ┌─────────────────┐           ┌─────────────────┐
 │ ¿COMPLIANCE?    │           │ ¿PR REVIEW?     │
 └────────┬────────┘           └────────┬────────┘
          │                              │
    ┌─────┴─────┐                  ┌─────┴─────┐
    │           │                  │           │
   SÍ          NO                 SÍ          NO
    │           │                  │           │
    ▼           ▼                  ▼           ▼
┌────────┐  ┌────────┐        ┌────────┐  ┌────────┐
│VT-SPEC │  │VT-SPEC │        │VT-SPEC │  │VT-SPEC │
│  FULL  │  │  FULL  │        │  LITE  │  │  LITE  │
│        │  │        │        │        │  │  FULL  │
│135k tok│  │70k tok │        │9.6k tok│  │(choose)│
│~10min  │  │~8min   │        │~45sec  │  │        │
│        │  │        │        │        │  │        │
│Audit   │  │Exploit │        │Quick   │  │Depends │
│trail   │  │testing │        │check   │  │on risk │
└────────┘  └────────┘        └────────┘  └────────┘
```

---

## 📋 Tabla de Decisión Rápida

| Pregunta | Sí → Full | No → Lite |
|----------|-----------|-----------|
| ¿Feature maneja auth/passwords/tokens? | ✅ | ❌ |
| ¿Feature procesa pagos/billing? | ✅ | ❌ |
| ¿Feature expone API pública? | ✅ | ❌ |
| ¿Feature maneja PII (email, phone, address)? | ✅ | ❌ |
| ¿Feature requiere compliance (SOC 2, PCI, HIPAA)? | ✅ | ❌ |
| ¿Feature tiene permisos/roles/admin? | ✅ | ❌ |
| ¿Feature permite file upload? | ✅ | ❌ |
| ¿Es un PR review < 200 líneas? | ❌ | ✅ |
| ¿Es UI-only (sin lógica de negocio)? | ❌ | ✅ |
| ¿Es refactor/rename sin cambio de behavior? | ❌ | ✅ |
| ¿Es docs/tests sin código de producción? | ❌ | ✅ |

**Regla de oro**: Si tienes duda → **SpecIA Lite primero**, upgrade a Full si detecta critical findings

---

## 🎯 Casos de Uso Comunes

### ✅ SpecIA LITE (9.6k tokens)

#### 1. PR Review Rápido
```bash
Scenario: Code review de PR pequeño (50 líneas)
Command: specia-review-lite src/components/Button.tsx
Time: ~15 segundos
Tokens: ~3k input + ~400 output = 3.4k total
Output: 3 threats (1 high: XSS in onClick handler)
```

#### 2. Validación Durante Desarrollo
```bash
Scenario: Dev quiere quick check antes de commit
Command: specia-review-lite src/api/users.ts
Time: ~15 segundos
Tokens: ~3k input + ~350 output = 3.35k total
Output: 2 threats (SQL injection risk en query builder)
```

#### 3. Feature UI-Only
```bash
Scenario: Nueva landing page (solo markup + CSS)
Command: specia-review-lite src/pages/landing.tsx
Time: ~15 segundos
Tokens: ~2.8k input + ~200 output = 3k total
Output: 0 threats (low-risk UI code)
```

#### 4. Refactor Interno
```bash
Scenario: Rename variable `getUserData` → `fetchUserProfile`
Command: specia-review-lite src/services/user.ts
Time: ~15 segundos
Tokens: ~2.5k input + ~150 output = 2.65k total
Output: 0 threats (behavior unchanged)
```

#### 5. Prototipado / Spike
```bash
Scenario: Spike técnico — probar librería nueva
Command: specia-review-lite spike/redis-client.ts
Time: ~15 segundos
Tokens: ~3.2k input + ~300 output = 3.5k total
Output: 1 threat (conexión sin TLS)
```

**Token savings vs v1**: 
- v1: ~45k tokens (review completa con MCP overhead)
- Lite: ~3.4k tokens promedio
- Ahorro: **~41.6k tokens (92% reducción)**

---

### ✅ SpecIA FULL (70k-135k tokens)

#### 1. OAuth Login
```bash
Scenario: Implementar login con Google OAuth
Command: specia new add-oauth-login
Phases: explore → propose → spec → review → tasks → apply → audit
Time: ~10 minutos (total workflow)
Tokens: ~135k total
  - Explore: 4k
  - Propose: 3k
  - Spec: 6k
  - Review: 28k (con abuse cases)
  - Tasks: 4k
  - Apply: 40k
  - Audit: 50k (dynamic testing)
  
Output:
  - 7 STRIDE threats
  - 4 abuse cases (session fixation, CSRF, token theft, redirect hijack)
  - 12 tasks (8 implementation + 4 security mitigations)
  - Audit: 6/6 requirements pass, 4/4 abuse cases verified con exploit PoCs
```

#### 2. Stripe Payment Integration
```bash
Scenario: Agregar checkout con Stripe
Command: specia new add-stripe-checkout
Time: ~10 minutos
Tokens: ~140k total
  - Exploration: PCI-DSS SAQ A-EP requirements (5k)
  - Review: 30k (webhook security + abuse cases)
  - Audit: 55k (webhook signature testing, idempotency verification)
  
Output:
  - 9 STRIDE threats (webhook spoofing, replay attacks, amount tampering)
  - 5 abuse cases (fraudulent charges, refund abuse, price manipulation)
  - 15 tasks (10 implementation + 5 mitigations)
```

#### 3. Admin Panel con RBAC
```bash
Scenario: Panel de administración con roles
Command: specia new add-admin-panel
Time: ~8 minutos
Tokens: ~95k total
  - Review: 25k (privilege escalation focus)
  - Audit: 45k (RBAC matrix testing)
  
Output:
  - 8 STRIDE threats (privilege escalation, IDOR, CSRF)
  - 6 abuse cases (horizontal/vertical privilege escalation, session hijack)
  - 18 tasks (12 implementation + 6 mitigations)
```

#### 4. File Upload con S3
```bash
Scenario: Upload de imágenes a S3
Command: specia new add-image-upload
Time: ~10 minutos
Tokens: ~125k total
  - Review: 32k (path traversal, malware, SSRF focus)
  - Audit: 48k (file type validation testing, size limits)
  
Output:
  - 10 STRIDE threats (path traversal, XXE, malware upload, SSRF)
  - 5 abuse cases (shell upload, XSS via SVG, DoS via bomb files)
  - 16 tasks (11 implementation + 5 mitigations)
```

#### 5. Public REST API
```bash
Scenario: API REST pública para partners
Command: specia new add-partner-api
Time: ~12 minutos
Tokens: ~150k total
  - Exploration: OWASP API Top 10 research (6k)
  - Review: 35k (API-specific threats + abuse cases)
  - Audit: 60k (rate limiting verification, auth testing)
  
Output:
  - 12 STRIDE threats (broken auth, excessive data exposure, rate limiting)
  - 7 abuse cases (API key theft, data scraping, DoS)
  - 20 tasks (14 implementation + 6 mitigations)
```

**Token cost vs v1**:
- v1: ~120k tokens (sin exploration, sin abuse cases, audit estática)
- Full: ~135k tokens promedio (con exploration + abuse cases + audit dinámica)
- Incremento: +15k tokens (12.5%)
- Valor: Exploration evita ~50k tokens de re-work → ROI neto: **-35k tokens**

---

## 💰 Comparación de Tokens por Caso de Uso

| Caso de Uso | Lite | Full | Diferencia | Cuándo Full vale la pena |
|-------------|------|------|------------|--------------------------|
| PR review (UI) | 3.4k | 135k | +131.6k | ❌ Nunca (Lite suficiente) |
| Refactor | 2.65k | 70k | +67.35k | ❌ Nunca (Lite suficiente) |
| CRUD endpoint | 3.5k | 70k | +66.5k | ⚠️ Depende (si tiene authz → Full) |
| OAuth login | ❌ N/A | 135k | — | ✅ Siempre (abuse cases críticos) |
| Payment | ❌ N/A | 140k | — | ✅ Siempre (compliance required) |
| File upload | ❌ N/A | 125k | — | ✅ Siempre (high attack surface) |
| Admin panel | ❌ N/A | 95k | — | ✅ Siempre (privilege escalation risk) |
| Public API | ❌ N/A | 150k | — | ✅ Siempre (OWASP API Top 10) |

---

## 🔄 Hybrid Workflow: Lite → Full Upgrade Path

### Caso: Empiezas con Lite, detectas riesgo alto

```bash
# Step 1: Quick check con Lite
specia-review-lite src/auth/login.ts

# Output (400 tokens):
🚀 SpecIA LITE Review | ~15s | ~3.4k tokens | Critical/High Only

Threats Found: 3
  [CRITICAL] T-001: SQL injection in login query (line 42)
  [CRITICAL] T-002: Password stored in plaintext (line 58)
  [HIGH] T-003: No rate limiting on login attempts

⚠️ UPGRADE RECOMMENDED
This feature contains critical security issues. For compliance-grade
review with abuse cases and exploit testing, use:
  specia new add-login-security

# Step 2: Upgrade a Full
specia new fix-login-security
specia spec fix-login-security  # Copia findings de Lite
specia review fix-login-security --api
specia tasks fix-login-security

# Output (Full review: 28k tokens):
✅ 12 threats found (5 critical, 4 high, 3 medium)
✅ 6 abuse cases documented (credential stuffing, brute force, session fixation)
✅ 14 tasks generated (9 implementation + 5 security mitigations)
```

**Tokens total**: 3.4k (Lite) + 135k (Full) = **138.4k**  
**vs Full-only**: 135k  
**Overhead**: +3.4k tokens (2.5%)

**Valor**: Lite triage rápido (15 seg) → Full deep dive solo si needed

---

## 📊 ROI por Tipo de Feature

### Low-Risk Features (UI, Docs, Refactors)

```yaml
Volume: 60% de features
Strategy: SpecIA Lite
Tokens per feature: ~3.4k
Annual tokens (60 features): 204k

vs v1:
  - v1: 60 × 120k = 7.2M tokens
  - Lite: 204k tokens
  - Ahorro: 7M tokens (97% reducción)
```

### Medium-Risk Features (APIs, Integraciones)

```yaml
Volume: 30% de features
Strategy: SpecIA Lite (con upgrade path a Full si needed)
Tokens per feature: ~3.5k (avg, 90% stay Lite)
Upgrade rate: 10% → Full (135k × 3 = 405k)
Annual tokens (30 features): (27 × 3.5k) + 405k = 500k

vs v1:
  - v1: 30 × 120k = 3.6M tokens
  - Hybrid: 500k tokens
  - Ahorro: 3.1M tokens (86% reducción)
```

### High-Risk Features (Auth, Payment, PII)

```yaml
Volume: 10% de features
Strategy: SpecIA Full (always)
Tokens per feature: ~135k
Annual tokens (10 features): 1.35M

vs v1:
  - v1: 10 × 120k = 1.2M tokens
  - Full: 1.35M tokens
  - Incremento: +150k tokens (12.5%)
  
Valor: 
  - Exploration evita re-work: -50k tokens per feature
  - ROI neto: 1.35M - 500k (re-work saved) = 850k tokens efectivos
  - vs v1: 1.2M - 850k = 350k tokens ahorrados (29% reducción)
```

**Total Annual Tokens (Hybrid)**: 204k + 500k + 1.35M = **2.05M**  
**vs v1**: 7.2M + 3.6M + 1.2M = **12M**  
**Ahorro**: **9.95M tokens (83% reducción)**

---

## 🎓 Ejemplos de Squad Real

### Squad Backend (5 devs, microservices)

```yaml
Monthly features:
  - 8 CRUD endpoints → Lite (8 × 3.5k = 28k)
  - 4 integraciones internas → Lite (4 × 3.5k = 14k)
  - 2 APIs públicas → Full (2 × 150k = 300k)
  - 1 auth feature → Full (1 × 135k = 135k)
  
Monthly tokens: 477k
Annual tokens: 5.7M

vs v1 Full-only:
  - 15 features × 120k = 1.8M/mes
  - Annual: 21.6M
  
Savings: 15.9M tokens/año (74% ahorro)
```

### Squad Frontend (4 devs, React)

```yaml
Monthly features:
  - 12 UI components → Lite (12 × 3.4k = 41k)
  - 3 forms con validación → Lite (3 × 3.5k = 10.5k)
  - 1 OAuth integration → Full (1 × 135k = 135k)
  
Monthly tokens: 186.5k
Annual tokens: 2.2M

vs v1 Full-only:
  - 16 features × 120k = 1.92M/mes
  - Annual: 23M
  
Savings: 20.8M tokens/año (90% ahorro)
```

### Squad Full-Stack (6 devs, monolito)

```yaml
Monthly features:
  - 6 CRUD features → Lite (6 × 3.5k = 21k)
  - 4 UI pages → Lite (4 × 3.4k = 13.6k)
  - 3 APIs → Full (3 × 150k = 450k)
  - 2 auth/payment → Full (2 × 140k = 280k)
  
Monthly tokens: 764.6k
Annual tokens: 9.2M

vs v1 Full-only:
  - 15 features × 120k = 1.8M/mes
  - Annual: 21.6M
  
Savings: 12.4M tokens/año (57% ahorro)
```

---

## 🚀 Quick Start por Rol

### Para Desarrolladores

```bash
# 1. Check rápido (siempre safe)
specia-review-lite path/to/file.ts
# Tokens: ~3.4k

# 2. Si detectas riesgo alto → upgrade
specia new fix-security-issue
specia ff fix-security-issue
# Tokens: ~135k (pero evita 50k en re-work)

# 3. Guardian te avisa si falta mitigation
git commit  # Layer 1-3: 0 tokens, Layer 4b: ~9.2k tokens (1% de commits)
```

### Para Code Reviewers

```bash
# 1. PR review automático
specia-review-lite path/to/changed/files.ts > review-comment.md
# Tokens: ~3.4k (vs manual review: 0 tokens pero 30 min de tiempo)

# 2. Pega output en PR comment
# 3. Si findings críticos → requiere Full workflow
```

### Para Tech Leads

```bash
# 1. Track token consumption
specia stats --output monthly-stats.json

{
  "total_tokens": 2050000,
  "lite_usage": 720000,   # 35%
  "full_usage": 1330000,  # 65%
  "avg_per_feature": 25625,
  "savings_vs_v1": 9950000  # 83%
}

# 2. Setup bake config para optimizar
cat > ~/.specia-bakes/squad.yaml <<EOF
guardian:
  spec_validation:
    enable_llm: false  # Start heuristic-only (0 tokens)
EOF
```

---

## 🔧 Optimizaciones Avanzadas

### 1. Guardian Layer 4b: Heuristic-Only

```yaml
Default: L4a (heuristic) + L4b (LLM fallback)
  - Tokens: 92 tokens/commit avg (1% need LLM)

Optimization: Heuristic-only
  - Config: spec_validation.enable_llm: false
  - Tokens: 0 tokens/commit
  - Trade-off: -5% detection accuracy
  
Recomendación: Start heuristic-only, enable LLM después de 2 semanas
```

### 2. MCP Opt-Out

```yaml
Default (v1): MCP siempre activo
  - Overhead: ~5k tokens/feature

v2 CLI-first: MCP optional
  - Install: ./install.sh --no-mcp
  - Overhead: 0 tokens
  
Cuándo SÍ usar MCP:
  - Workflow multi-session (>2 horas)
  - Alejandría recovery needed
  
Cuándo NO usar MCP:
  - Quick features (<2 horas)
  - CI/CD automation
```

### 3. Exploration Auto-Trigger Tuning

```yaml
Default: Auto-trigger en keywords sensibles
  - Tokens: +4k por feature sensible
  - Ahorra: ~50k en re-work
  
Optimization: Tune keywords
  - Config: explore.keywords (custom list)
  - Reduce false triggers: -30% exploration calls
  - Tokens saved: ~1.2k per avoided exploration
```

---

## 📞 ¿Necesitas Ayuda?

**Slack**: `#ask-appsec`  
**Docs**: 
  - `docs/comparison.md` — Lite vs Full detallado
  - `docs/v1-to-v2-migration.md` — Token optimizations
**Issues**: `gitlab.veritran.net/appsec/specia/issues`

---

## 📈 Token Budget Planning

### Calculator de Tokens Mensuales

```python
# Inputs
crud_features = 8      # → Lite
ui_features = 4        # → Lite
api_features = 2       # → Full
auth_features = 1      # → Full

# Cálculo
lite_tokens = (crud_features + ui_features) × 3500
full_tokens = (api_features + auth_features) × 135000

total = lite_tokens + full_tokens
# = (12 × 3500) + (3 × 135000)
# = 42,000 + 405,000
# = 447,000 tokens/mes
# = 5.36M tokens/año

# vs v1
v1_tokens = 15 × 120000 = 1.8M/mes = 21.6M/año

# Ahorro
savings = 21.6M - 5.36M = 16.24M tokens/año (75% reducción)
```

---

**Última actualización**: 18 abril 2026  
**Versión**: v2.1.0
