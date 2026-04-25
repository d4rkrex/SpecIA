# SpecIA Decision Tree: ¿Lite o Full?

**Guía rápida para desarrolladores y líderes técnicos**  
**Enfoque**: Security-first workflow selection

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
│~10min  │  │~8min   │        │~45sec  │  │(choose)│
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

### ✅ SpecIA LITE (~45 segundos)

#### 1. PR Review Rápido
```bash
Scenario: Code review de PR pequeño (50 líneas)
Command: specia-review-lite src/components/Button.tsx
Time: ~15 segundos
Security Focus: XSS, client-side validation bypass
Output: 3 threats (1 high: XSS in onClick handler)
```

#### 2. Validación Durante Desarrollo
```bash
Scenario: Dev quiere quick check antes de commit
Command: specia-review-lite src/api/users.ts
Time: ~15 segundos
Security Focus: SQL injection, input validation
Output: 2 threats (SQL injection risk en query builder)
```

#### 3. Feature UI-Only
```bash
Scenario: Nueva landing page (solo markup + CSS)
Command: specia-review-lite src/pages/landing.tsx
Time: ~15 segundos
Security Focus: XSS, CSP compliance
Output: 0 threats (low-risk UI code)
```

#### 4. Refactor Interno
```bash
Scenario: Rename variable `getUserData` → `fetchUserProfile`
Command: specia-review-lite src/services/user.ts
Time: ~15 segundos
Security Focus: Behavior preservation check
Output: 0 threats (behavior unchanged)
```

#### 5. Prototipado / Spike
```bash
Scenario: Spike técnico — probar librería nueva
Command: specia-review-lite spike/redis-client.ts
Time: ~15 segundos
Security Focus: Connection security, credential handling
Output: 1 threat (conexión sin TLS)
```

**Cuándo usar Lite**: Low-risk changes, quick feedback loops, pre-commit validation

---

### ✅ SpecIA FULL (8-12 minutos)

#### 1. OAuth Login
```bash
Scenario: Implementar login con Google OAuth
Command: specia new add-oauth-login
Phases: explore → propose → spec → review → tasks → apply → audit
Time: ~10 minutos (total workflow)
Security Focus: STRIDE threats, abuse cases, session security
  
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
Security Focus: PCI-DSS requirements, webhook security, financial abuse
  
Output:
  - 9 STRIDE threats (webhook spoofing, replay attacks, amount tampering)
  - 5 abuse cases (fraudulent charges, refund abuse, price manipulation)
  - 15 tasks (10 implementation + 5 mitigations)
  - Compliance: PCI-DSS SAQ A-EP validated
```

#### 3. Admin Panel con RBAC
```bash
Scenario: Panel de administración con roles
Command: specia new add-admin-panel
Time: ~8 minutos
Security Focus: Privilege escalation, IDOR, access control matrix
  
Output:
  - 8 STRIDE threats (privilege escalation, IDOR, CSRF)
  - 6 abuse cases (horizontal/vertical privilege escalation, session hijack)
  - 18 tasks (12 implementation + 6 mitigations)
  - Audit: RBAC matrix testing with exploit attempts
```

#### 4. File Upload con S3
```bash
Scenario: Upload de imágenes a S3
Command: specia new add-image-upload
Time: ~10 minutos
Security Focus: Path traversal, malware, SSRF, DoS via file bombs
  
Output:
  - 10 STRIDE threats (path traversal, XXE, malware upload, SSRF)
  - 5 abuse cases (shell upload, XSS via SVG, DoS via bomb files)
  - 16 tasks (11 implementation + 5 mitigations)
  - Audit: File validation testing, size limits, MIME type enforcement
```

#### 5. Public REST API
```bash
Scenario: API REST pública para partners
Command: specia new add-partner-api
Time: ~12 minutos
Security Focus: OWASP API Top 10, rate limiting, data exposure
  
Output:
  - 12 STRIDE threats (broken auth, excessive data exposure, rate limiting)
  - 7 abuse cases (API key theft, data scraping, DoS)
  - 20 tasks (14 implementation + 6 mitigations)
  - Compliance: OWASP API Security Top 10 validated
```

**Cuándo usar Full**: High-risk features, compliance-required changes, audit trail needed

---

## 🔄 Hybrid Workflow: Lite → Full Upgrade Path

### Caso: Empiezas con Lite, detectas riesgo alto

```bash
# Step 1: Quick check con Lite
specia-review-lite src/auth/login.ts

# Output (~15 segundos):
🚀 SpecIA LITE Review | Critical/High Only

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

# Output (Full review: ~10 minutos):
✅ 12 threats found (5 critical, 4 high, 3 medium)
✅ 6 abuse cases documented (credential stuffing, brute force, session fixation)
✅ 14 tasks generated (9 implementation + 5 security mitigations)
```

**Workflow timing**: ~15 segundos (Lite triage) + ~10 minutos (Full deep dive when needed)  
**Value**: Quick risk assessment before investing in comprehensive analysis

---

## 🎓 Ejemplos de Squad Real

### Squad Backend (5 devs, microservices)

```yaml
Monthly features:
  - 8 CRUD endpoints → Lite (~2 min total)
  - 4 integraciones internas → Lite (~1 min total)
  - 2 APIs públicas → Full (~20 min total)
  - 1 auth feature → Full (~10 min total)
  
Security coverage:
  - Low-risk: Lite provides quick validation
  - High-risk: Full workflow with audit trail
  - Compliance: Full workflow ensures documentation
```

### Squad Frontend (4 devs, React)

```yaml
Monthly features:
  - 12 UI components → Lite (~3 min total)
  - 3 forms con validación → Lite (~45 sec total)
  - 1 OAuth integration → Full (~10 min total)

Security coverage:
  - UI components: Quick XSS/CSP checks
  - Forms: Input validation review
  - Auth: Full STRIDE + abuse case analysis
```

### Squad Full-Stack (6 devs, monolito)

```yaml
Monthly features:
  - 6 CRUD features → Lite (~1.5 min total)
  - 4 UI pages → Lite (~1 min total)
  - 3 APIs → Full (~36 min total)
  - 2 auth/payment → Full (~20 min total)

Security coverage:
  - CRUD: Lite catches common issues
  - UI: Quick security review
  - APIs/Auth/Payment: Full compliance workflow
```

---

## 🚀 Quick Start por Rol

### Para Desarrolladores

```bash
# 1. Check rápido (siempre safe)
specia-review-lite path/to/file.ts
# Time: ~15 segundos
# Coverage: Critical/High severity threats

# 2. Si detectas riesgo alto → upgrade
specia new fix-security-issue
specia ff fix-security-issue
# Time: ~10 minutos
# Coverage: Full STRIDE + abuse cases + dynamic audit

# 3. Guardian te avisa si falta mitigation
git commit  # Layer 1-3: Instant, Layer 4b: fallback validation
```

### Para Code Reviewers

```bash
# 1. PR review automático
specia-review-lite path/to/changed/files.ts > review-comment.md
# Time: ~15 segundos vs 30 min manual review
# Focus: Security-specific findings

# 2. Pega output en PR comment
# 3. Si findings críticos → requiere Full workflow
```

### Para Tech Leads

```bash
# 1. Define security requirements by feature type
cat > ~/.specia-bakes/squad.yaml <<EOF
security_policy:
  auth_payment: full_required
  public_api: full_required
  internal_crud: lite_acceptable
  ui_only: lite_acceptable
EOF

# 2. Track compliance coverage
specia stats --output monthly-security-coverage.json
```

---

**Última actualización**: 18 abril 2026  
**Versión**: v2.1.0
