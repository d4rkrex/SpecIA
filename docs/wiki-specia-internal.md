# SpecIA: Desarrollo Seguro Guiado por Especificaciones

> **Equipo**: AppSec | **Versión**: 0.4.0 | **Stack**: TypeScript / Node.js 20+ | **Tests**: 812 passing | **Licencia**: MIT

---

## 1. Descripción Ejecutiva

**SpecIA** es un servidor MCP (Model Context Protocol) + CLI desarrollado por el equipo de AppSec que integra revisión de seguridad obligatoria dentro del flujo de desarrollo asistido por IA. Se conecta a los 4 asistentes de IA que usamos (GitHub Copilot CLI, VS Code Copilot, Claude Code y OpenCode) y garantiza que cada cambio de código pase por un proceso estructurado: propuesta, especificación, revisión de seguridad, generación de tareas y auditoría post-implementación.

El problema que resuelve es concreto: las revisiones de seguridad manuales llegan tarde, dependen de la disponibilidad de personas específicas, y su profundidad varía. SpecIA automatiza este proceso con análisis STRIDE, mapeo OWASP Top 10, casos de abuso con perspectiva de atacante, y un sistema de debate entre 3 agentes de IA (ofensivo, defensivo y juez) para refinar hallazgos. Todo esto ocurre **antes de escribir código**, no después.

El resultado es trazabilidad completa — desde la propuesta inicial hasta el archivo final — y una base de conocimiento de seguridad que crece con cada review, consultable en cualquier momento via `specia_search`.

---

## 2. ¿Qué es Spec-Driven Development?

Spec-Driven Development (SDD) es un enfoque donde **las especificaciones son el artefacto primario**, no el código. La premisa es simple:

1. **Planificar antes de codificar.** Cada cambio comienza con una propuesta que define el qué, el porqué y el alcance. Luego se escriben especificaciones formales con requisitos y escenarios Given/When/Then.

2. **Las specs son contratos.** Los requisitos y escenarios no son documentación — son contratos verificables. Cada línea de código debe poder trazarse a un requisito específico.

3. **Seguridad como gate obligatorio.** La revisión de seguridad no es un paso opcional ni un "nice to have". Es una puerta que bloquea el avance del flujo: sin review aprobado, no se generan tareas de implementación.

4. **Auditoría post-implementación.** Después de codificar, una auditoría verifica que el código cumple las specs Y los casos de abuso identificados en la revisión de seguridad. Esto cierra el loop.

### ¿Por qué no basta con code review?

| Aspecto | Code Review tradicional | Spec-Driven Development |
|---------|------------------------|------------------------|
| **Timing** | Después de implementar | Antes de implementar |
| **Foco** | "¿El código está bien?" | "¿Lo que vamos a construir es seguro?" |
| **Trazabilidad** | Limitada al PR | Propuesta -> Spec -> Review -> Tasks -> Audit -> Archivo |
| **Consistencia** | Depende del reviewer | Análisis estructurado (STRIDE + OWASP + Abuse Cases) |
| **Acumulación** | Se pierde en PRs cerrados | Se archiva y es buscable para futuros reviews |

---

## 3. ¿Qué es SpecIA?

SpecIA es **nuestra implementación** de Spec-Driven Development, diseñada específicamente para flujos con agentes de IA. Es:

- **Un servidor MCP** que expone 16 herramientas sobre el protocolo Model Context Protocol. Los agentes de IA (Copilot, Claude, OpenCode) llaman a estas herramientas como parte de la conversación.
- **Un CLI** (`specia`) para uso directo desde terminal, con soporte para reviews automáticos via API de Anthropic u OpenAI.
- **Un sistema file-first** — todo vive en `.specia/` en la raíz del proyecto. Sin bases de datos, sin servicios externos obligatorios. Se commitea a git.

### Estructura de archivos

```
.specia/
├── config.yaml              # Configuración del proyecto
├── context.md               # Resumen del proyecto para agentes
├── changes/
│   └── {nombre-del-cambio}/
│       ├── proposal.md      # Propuesta: qué y por qué
│       ├── spec.md          # Requisitos + escenarios Given/When/Then
│       ├── design.md        # Decisiones de arquitectura (opcional)
│       ├── review.md        # Análisis de seguridad (STRIDE + OWASP + abuse cases)
│       ├── debate.md        # Transcripción del debate (opcional)
│       ├── tasks.md         # Tareas de implementación + mitigaciones de seguridad
│       ├── audit.md         # Auditoría post-implementación
│       └── state.yaml       # Tracking de fases + historial
└── specs/
    └── {nombre-archivado}.md  # Specs completadas (via specia_done)
```

### Arquitectura

```
Agente IA  <-->  stdio  <-->  MCP Server  <-->  File Store (.specia/)
                                   |
                                   └──>  Alejandria / Colmena / Engram (memoria opcional)

Terminal   <-->  CLI (specia)  <-->  Services  <-->  File Store (.specia/)
                     |                                    |
                     └──>  LLM API (opcional)              └──>  Git hooks (Guardian)
```

Decisiones de diseño clave:
- **File-first**: `.specia/` es la fuente de verdad; Alejandria/Colmena/Engram enriquecen pero nunca son obligatorios
- **Escrituras atómicas**: las operaciones de archivo escriben a temp primero, luego renombran
- **Smart caching**: hashes SHA256 previenen reviews y auditorías redundantes
- **DAG de fases**: cada herramienta verifica `state.yaml` para garantizar el orden del flujo

---

## 4. Flujo de Trabajo

```
init ──> propose ──> spec ──> [design] ──> REVIEW ──> [debate] ──> tasks ──> AUDIT ──> done
                                 ↑            ↑          ↑            ↑         ↑
                              OPCIONAL     OBLIGATORIO  OPCIONAL   OBLIGATORIO  OBLIGATORIO*
                                             GATE     (refina      GATE         GATE
                                                     hallazgos)
                                                                          (*opt-out posible
                                                                           al crear propuesta
                                                                           con skip_audit: true)
```

### Detalle de cada fase

| Fase | ¿Qué hace? | Artefacto | ¿Obligatorio? |
|------|------------|-----------|---------------|
| **init** | Configura SpecIA para el proyecto. Detecta stack, define postura de seguridad. | `config.yaml` + `context.md` | Si (una sola vez) |
| **propose** | Define qué se va a cambiar, por qué, y qué áreas afecta. | `proposal.md` | Si |
| **spec** | Escribe requisitos formales con escenarios Given/When/Then. | `spec.md` | Si |
| **design** | Documenta decisiones de arquitectura y flujos de datos. | `design.md` | No |
| **review** | Revisión de seguridad: STRIDE + OWASP + abuse cases. **Gate obligatorio.** | `review.md` | **Si** |
| **debate** | 3 agentes IA debaten cada hallazgo para refinar severidad y mitigaciones. | `debate.md` | No |
| **tasks** | Genera tareas de implementación. Inyecta mitigaciones de seguridad automáticamente. | `tasks.md` | Si |
| **audit** | Verifica que el código cumple specs y mitiga los abuse cases. **Gate obligatorio.** | `audit.md` | **Si*** |
| **done** | Archiva el cambio completado en `specs/`. | Spec archivada | Si |

> \* La auditoría es obligatoria por defecto. Se puede opt-out al momento de crear la propuesta con `skip_audit: true`, pero esto debe ser una decisión consciente.

### Gates de seguridad

Los gates son **hard gates** — no warnings, no bypasses:

1. **Review Gate**: `specia_tasks` se rehúsa a ejecutar si no existe un review válido y no-stale. Si la spec cambió después del review (verificado por hash SHA256), el review se marca como stale y debe re-hacerse.

2. **Audit Gate**: `specia_done` se rehúsa a archivar el cambio si no existe una auditoría válida (a menos que se haya configurado `skip_audit: true` en la propuesta).

---

## 5. Features de Seguridad

Esta es la propuesta de valor central de SpecIA. Cada feature está diseñado para que la seguridad no dependa de recordar hacerla, sino que sea parte obligatoria del flujo.

### 5.1 Revisión de Seguridad Obligatoria (Mandatory Review)

Cada cambio pasa por una revisión de seguridad estructurada antes de que se generen tareas de implementación. No se puede saltar, acortar ni diferir.

**Proceso en dos fases** (diseñado para agentes de IA):

1. **Fase 1**: Se llama a `specia_review` con el nombre del cambio. Retorna un `review_prompt` calibrado a la postura de seguridad del proyecto.
2. **Fase 2**: El agente analiza la spec con el prompt, luego llama a `specia_review` de nuevo con el `review_result` estructurado. La herramienta valida y guarda `review.md`.

**El análisis incluye tres capas aplicadas secuencialmente:**

#### Capa 1: STRIDE Threat Modeling

Se analizan las 6 categorías STRIDE contra la especificación:

| Categoría | Pregunta clave |
|-----------|---------------|
| **Spoofing** | ¿Puede un atacante suplantar un usuario, servicio o componente? |
| **Tampering** | ¿Se pueden modificar datos en tránsito o en reposo sin detección? |
| **Repudiation** | ¿Pueden los usuarios negar haber realizado acciones? |
| **Information Disclosure** | ¿Puede filtrarse información sensible por errores, logs o respuestas API? |
| **Denial of Service** | ¿Se puede agotar recursos del sistema sin autenticación? |
| **Elevation of Privilege** | ¿Puede un atacante obtener acceso más allá de su nivel de autorización? |

Cada amenaza identificada incluye: ID único (ej: `S-01`, `T-02`), título, descripción detallada con vector de ataque, severidad, mitigación específica y componentes afectados.

**Ejemplo de amenaza bien documentada:**
> *"Un atacante podría forjar tokens JWT de administrador explotando confusión de algoritmos — cambiando el algoritmo de verificación de RS256 a HS256 y firmando con la clave pública. Esto bypasea la validación de firma porque el servidor usa el mismo material de claves para ambos algoritmos."*

**Ejemplo de mitigación específica:**
> *"Fijar el algoritmo de verificación JWT explícitamente a RS256. Rechazar cualquier token con `alg: HS256` o `alg: none`. Usar almacenes de claves separados para firma y verificación."*

#### Capa 2: Mapeo OWASP Top 10

Cada hallazgo STRIDE se mapea a las categorías OWASP aplicables, creando trazabilidad con clasificaciones estándar de la industria:

- **OWASP Web Top 10 (2021)**: A01 Broken Access Control hasta A10 SSRF
- **OWASP API Security Top 10 (2023)**: API1 BOLA hasta API10 Unsafe Consumption of APIs (cuando el cambio involucra endpoints API)

#### Capa 3: Análisis de Abuse Cases

Los abuse cases complementan STRIDE/OWASP con escenarios concretos de ataque desde la perspectiva del atacante. Cada uno documenta:

| Campo | Descripción |
|-------|-------------|
| **Attacker Goal** | "Como atacante, quiero..." — el objetivo |
| **Technique** | Cómo se ejecuta el ataque — pasos, herramientas, payloads |
| **Preconditions** | Condiciones que deben ser verdaderas para que funcione |
| **Impact** | Qué sucede cuando el ataque tiene éxito |
| **Mitigation** | Contramedida específica |
| **Testable** | ¿Se puede automatizar como test de seguridad? |

**Los abuse cases se inyectan automáticamente en `specia_tasks` como tareas de mitigación de seguridad.** Esto garantiza que las mitigaciones no queden como "buenas intenciones" sino como tareas concretas en el backlog.

### 5.2 Niveles de Postura de Seguridad

La profundidad del análisis se controla por la postura de seguridad del proyecto:

| Nivel | Análisis STRIDE | OWASP | DREAD | Abuse Cases | Data Flow | Caso de uso |
|-------|----------------|-------|-------|-------------|-----------|-------------|
| **standard** | Light — top 2-3 categorías relevantes | Web Top 10 básico | No | 3-5 casos | No | Herramientas internas, cambios de bajo riesgo |
| **elevated** | Completo — 6 categorías con detalles | Web Top 10 + API Top 10 | No | 5-8 casos detallados | Trust boundaries | Features customer-facing |
| **paranoid** | Exhaustivo — subcategorías completas | Web Top 10 + API Top 10 | **Obligatorio** (scoring 1-10 en 5 dimensiones) | 8-12 casos con CVSS, test_hints obligatorios | Completo | Pagos, autenticación, datos PII |

#### Postura Paranoid — Detalle

En postura `paranoid`, el análisis incluye:

- **DREAD Scoring** obligatorio para cada amenaza: Damage, Reproducibility, Exploitability, Affected Users, Discoverability (escala 1-10, total = promedio)
- **Data Flow Analysis**: descripción completa de rutas de datos y trust boundaries
- **Supply Chain**: riesgos de dependencias, integraciones de terceros, implicaciones del build pipeline
- **Zero-Trust**: se asume que todos los inputs son maliciosos y que componentes internos pueden estar comprometidos
- **Plan de mitigación priorizado**: ordenado por score DREAD compuesto, agrupado en Critical/High/Medium/Low
- **Test hints obligatorios** en cada abuse case: indicaciones concretas de cómo testear cada caso

### 5.3 Auditoría Post-Implementación (Code Audit)

La auditoría es el checkpoint final antes de archivar un cambio. Verifica que el código implementado:

1. **Cumple los requisitos de la spec** — verificación requisito por requisito con verdicts `pass`/`fail`/`partial`/`skipped` y referencias a `archivo:línea` como evidencia.

2. **Mitiga los abuse cases del review** — verificación caso por caso con verdicts `verified`/`unverified`/`partial`/`not_applicable` y evaluación de riesgo si no se mitiga.

3. **No introduce nuevos problemas** — si la auditoría descubre issues de seguridad no identificados en el review original, los reporta como hallazgos `[NEW]`.

**El análisis se adapta a la postura de seguridad:**

| Aspecto | Standard | Elevated | Paranoid |
|---------|----------|----------|----------|
| Requisitos | Todos con evidence breve | Todos con evidence detallado | Todos con evidence exhaustivo y line-level |
| Abuse cases | Top 3-5 por severidad | Todos (hasta 8) | Todos (hasta 12) con DREAD scoring |
| Patrones OWASP | No requerido | Cross-reference Web Top 10 | Web Top 10 + API Top 10 exhaustivo |
| Data flow tracing | No | No | Obligatorio para paths críticos |
| Supply chain | No | No | Evaluación de imports, versiones, ejecución dinámica |
| Hallazgos nuevos | Solo critical/high | Todos los niveles | Todos los niveles con DREAD scores |

**Smart caching**: si el código no cambió (verificado por hash SHA256), se retorna el resultado cacheado. Si la spec o la postura de seguridad cambiaron, la auditoría se invalida automáticamente.

### 5.4 Debate Estructurado (Structured Debate)

Tres agentes de IA refinan los hallazgos de seguridad a través de un intercambio estructurado:

| Agente | Rol | Perspectiva |
|--------|-----|-------------|
| **Ofensivo (Red Team)** | Desafía desde la perspectiva del atacante | Escala severidad, identifica vectores adicionales |
| **Defensivo (Blue Team)** | Valida mitigaciones propuestas | Desafía escalaciones irrealistas, propone defensas prácticas |
| **Juez** | Sintetiza consenso | Determina severidad final y mitigación |

Los hallazgos sin consenso después de `max_rounds` rondas se marcan para **revisión humana**. Esto es intencional — el sistema no pretende reemplazar el juicio humano para casos ambiguos, sino dar la información necesaria para que la decisión humana sea informada.

### 5.5 Guardian Pre-Commit Hook

Guardian es un hook de pre-commit que valida commits contra specs, con 4 capas de validación:

| Capa | Validación | Descripción |
|------|-----------|-------------|
| 1 | **Spec coverage** | ¿El archivo está cubierto por un cambio SpecIA activo? |
| 2 | **Review completeness** | ¿El review de seguridad está hecho y no es stale? |
| 3 | **Mitigation compliance** | ¿Todas las mitigaciones de seguridad están marcadas como completadas? |
| 4 | **Spec-aware validation** (opcional) | ¿El código cumple los requisitos de la spec? (heurístico + LLM) |

**Dos modos de operación:**

- **`warn`** (default): permite el commit pero muestra warnings si hay violaciones
- **`strict`**: bloquea commits que no cumplen las validaciones

```bash
specia hook install              # modo warn (default)
specia hook install --strict     # bloquea commits no-compliant
specia hook status               # verificar estado
specia hook uninstall            # remover
```

Guardian coexiste con otros hooks (husky, lint-staged, etc.) usando marker blocks.

### 5.6 Aprendizaje Cross-Session

SpecIA aprende de reviews pasados para mejorar futuros análisis via un Memory Adapter:

| Backend | Descripción |
|---------|-------------|
| **Alejandria** | Memoria empresarial con embeddings y búsqueda semántica |
| **Colmena** | Memoria compartida multi-agente para aprendizaje cross-sesión |
| **Engram** | Fallback local con búsqueda básica (siempre disponible) |

Cuando se ejecuta `specia_review`, el adapter busca reviews pasados de proyectos similares, extrae learnings, y enriquece el prompt de review.

---

## 6. Beneficios para Veritran

- **Shift-left de seguridad** — Los hallazgos aparecen antes de escribir código, cuando el costo de corrección es mínimo.

- **Calidad de review consistente** — No depende de la disponibilidad ni la experiencia del reviewer. Análisis STRIDE + OWASP + abuse cases en cada cambio, calibrado a la postura de seguridad.

- **Trazabilidad completa** — Audit trail de propuesta a archivo: `proposal.md` -> `spec.md` -> `review.md` -> `tasks.md` -> `audit.md` -> spec archivada. Cada decisión, hallazgo y mitigación queda documentada.

- **Acumulación de conocimiento** — Reviews pasados son buscables via `specia_search`. Patrones recurrentes se detectan y escalan. El conocimiento de seguridad del equipo crece con cada cambio.

- **Zero UI friction** — Funciona dentro de las herramientas de IA que ya usamos (Copilot, Claude, OpenCode). No hay nueva interfaz que aprender. Le hablas al agente y el agente usa SpecIA.

- **Mitigaciones de seguridad como tareas** — Los abuse cases del review se convierten automáticamente en tareas de implementación. Las mitigaciones no quedan como recomendaciones ignoradas.

- **Auditoría cierra el loop** — La auditoría post-implementación verifica que el código realmente implementa lo especificado y mitiga los ataques identificados. No es "confiamos en que lo hicieron bien".

- **Escalable** — La profundidad del análisis se ajusta al riesgo. Una herramienta interna recibe review `standard`; el módulo de pagos recibe review `paranoid` con DREAD scoring.

- **Git-native** — Todo vive en `.specia/` que se commitea al repo. Sin servicios externos obligatorios, sin dependencias de infraestructura.

---

## 7. Clientes AI Soportados

| Cliente | Directorio de Config | Qué se instala |
|---------|---------------------|----------------|
| **GitHub Copilot CLI** | `~/.copilot/` | Agent files + MCP config + skill |
| **VS Code Copilot Chat** | `~/.config/Code/User/` | MCP config + instruction prompts |
| **Claude Code** | `~/.claude/` | MCP config + CLAUDE.md section + sub-agents + skill |
| **OpenCode** | `~/.config/opencode/` | MCP config + agents + slash commands + skill |

### Configuración manual (sin installer)

Si preferís configurar manualmente:

```json
{
  "mcpServers": {
    "specia": {
      "command": "node",
      "args": ["/path/to/specia/bin/specia-mcp.js"]
    }
  }
}
```

### Slash Commands (OpenCode)

| Comando | Descripción |
|---------|-------------|
| `/specia-init` | Inicializar SpecIA para el proyecto actual |
| `/specia-new <name>` | Crear una nueva propuesta de cambio |
| `/specia-continue [name]` | Continuar a la siguiente fase del flujo |
| `/specia-ff [name]` | Fast-forward por todas las fases |
| `/specia-review [name]` | Ejecutar la revisión de seguridad obligatoria |
| `/specia-status [name]` | Mostrar estado del cambio o listar todos |

---

## 8. Herramientas MCP Disponibles

### Flujo Core

| Herramienta | Propósito | Requiere |
|-------------|----------|----------|
| `specia_init` | Inicializar configuración del proyecto | -- |
| `specia_propose` | Crear propuesta de cambio (qué, por qué, alcance) | init |
| `specia_new` | Alias de `specia_propose` | init |
| `specia_spec` | Escribir requisitos + escenarios Given/When/Then | proposal |
| `specia_design` | Diseño de arquitectura (opcional, dos fases) | spec |
| `specia_review` | **Revisión de seguridad obligatoria** (STRIDE + OWASP + abuse cases, dos fases) | spec |
| `specia_debate` | Debate estructurado para refinar hallazgos (3 agentes, opcional) | review |
| `specia_tasks` | Generar tareas de implementación con mitigaciones de seguridad | review (no-stale) |
| `specia_audit` | **Auditoría post-implementación** (verifica código vs specs + abuse cases) | tasks |
| `specia_done` | Archivar cambio completado | audit (o tasks si audit fue skipped) |

### Atajos

| Herramienta | Propósito |
|-------------|----------|
| `specia_continue` | Retorna la siguiente fase incompleta para un cambio |
| `specia_ff` | Fast-forward: ejecuta todas las fases posibles en secuencia |

### Búsqueda

| Herramienta | Propósito |
|-------------|----------|
| `specia_search` | Buscar specs archivadas y hallazgos de seguridad pasados |

### Guardian (Pre-Commit Hook)

| Herramienta | Propósito |
|-------------|----------|
| `specia_hook_install` | Instalar hook de validación pre-commit |
| `specia_hook_uninstall` | Remover hook pre-commit |
| `specia_hook_status` | Verificar estado de instalación del hook |

---

## 9. Instalación Rápida

### Prerrequisitos

- **Node.js 20+**
- **Un agente AI compatible con MCP** (cualquiera de los 4 soportados)

### Pasos

```bash
# 1. Clonar el repo
git clone https://gitlab.veritran.net/appsec/specia.git
cd specia

# 2. Instalar (auto-detecta clientes instalados)
./install.sh

# 3. O instalar para clientes específicos
./install.sh --copilot --claude-code

# 4. O instalar todo
./install.sh --all
```

El installer automáticamente:
1. Ejecuta `npm install`, `npm run build` y `npm link` (hace `specia` y `specia-mcp` disponibles globalmente)
2. Auto-detecta clientes AI instalados y configura MCP + archivos de agente para cada uno

### Flags del installer

| Flag | Descripción |
|------|-------------|
| *(sin flags)* | Auto-detectar todos los clientes y configurarlos |
| `--copilot` | Configurar solo GitHub Copilot CLI |
| `--claude-code` | Configurar solo Claude Code |
| `--opencode` | Configurar solo OpenCode |
| `--vscode` | Configurar solo VS Code Copilot |
| `--npm` | Solo build npm (sin configs de clientes) |
| `--all` | Configurar todos los targets |
| `--skip-build` | Saltar `npm install/build/link` (útil para actualizar solo agent files) |

### Desinstalación

```bash
./uninstall.sh              # Menú interactivo
./uninstall.sh --all        # Remover todo
./uninstall.sh --claude-code --opencode   # Remover targets específicos
```

---

## 10. Ejemplos de Uso

### Ejemplo 1: Crear un feature nuevo con revisión de seguridad

**Escenario**: El equipo de Mobile Banking necesita agregar autenticación biométrica.

```
Desarrollador > "Inicializá SpecIA para este proyecto con postura elevated"

   El agente llama specia_init:
   - Detecta stack: React Native / TypeScript
   - Postura: elevated (customer-facing)
   - Crea .specia/config.yaml

Desarrollador > "Creá un cambio llamado biometric-auth para agregar
                 autenticación biométrica con Face ID y fingerprint"

   El agente llama specia_propose:
   - Intent: "Agregar autenticación biométrica como segundo factor"
   - Scope: ["auth/", "biometric/", "session/"]
   - Genera proposal.md

Desarrollador > "Escribí la spec"

   El agente llama specia_spec:
   - 6 requisitos con escenarios Given/When/Then
   - Cubre enrollment, authentication, fallback, revocation
   - Genera spec.md

Desarrollador > "Hacé el security review"

   El agente llama specia_review (Fase 1) → recibe prompt calibrado a elevated
   El agente analiza la spec y llama specia_review (Fase 2) con resultados:
   
   Hallazgos:
   - S-01: Biometric bypass via rooted device (high)
   - T-01: Biometric template tampering in local storage (high)
   - E-01: Privilege escalation via biometric enrollment race condition (medium)
   - I-01: Biometric data leakage via backup (medium)
   - D-01: DoS via repeated failed biometric attempts (low)
   
   6 abuse cases con mitigaciones específicas
   Mapeo OWASP: A01, A02, A04, A07
   
   Genera review.md

Desarrollador > "Generá las tareas"

   El agente llama specia_tasks:
   - 8 tareas de implementación
   - 6 tareas de mitigación de seguridad (inyectadas del review)
   - Genera tasks.md

   [El desarrollador implementa el código]

Desarrollador > "Hacé la auditoría del código"

   El agente llama specia_audit:
   - Lee archivos de código implementados
   - Verifica 6/6 requisitos: 5 pass, 1 partial
   - Verifica 6/6 abuse cases: 4 verified, 1 partial, 1 unverified
   - Recomendaciones: completar rate limiting en biometric endpoint
   - Genera audit.md

   [El desarrollador corrige los gaps, re-corre audit]

Desarrollador > "Archivá el cambio"

   El agente llama specia_done:
   - Verifica audit completado
   - Copia spec a .specia/specs/biometric-auth.md con frontmatter del review
   - Elimina directorio del cambio
```

### Ejemplo 2: Security review con debate para módulo de pagos

**Escenario**: Cambio en el procesamiento de pagos. Se usa postura `paranoid`.

```
Desarrollador > "Creá un cambio payment-tokenization con postura paranoid"

   [Propuesta y spec se generan normalmente]

Desarrollador > "Hacé el review de seguridad"

   En postura paranoid, el review incluye:
   - STRIDE exhaustivo con subcategorías completas
   - DREAD scoring para cada amenaza
   - 10 abuse cases con test_hints obligatorios
   - Data flow analysis completo
   - Supply chain analysis
   - Mapeo OWASP Web Top 10 + API Security Top 10
   
   Resultado: 12 amenazas, 3 críticas

Desarrollador > "Debatí los hallazgos"

   El agente llama specia_debate:
   
   Ronda 1 - Hallazgo S-01 (Token prediction):
     Ofensivo: "La generación de tokens usa UUID v4 pero sin verificar
                la fuente de entropía del runtime. En containers con
                /dev/urandom throttled, los tokens son predecibles."
     Defensivo: "UUID v4 en Node.js usa crypto.randomUUID() que está
                 respaldado por CSPRNG del OS. El escenario de container
                 throttled es teórico y no reproducible en nuestra infra."
     Juez: "Mantener severity HIGH. La mitigación debe incluir health
            check de entropía al startup. Reducir de critical a high
            porque requiere condiciones específicas de infra."
   
   [Se repite para cada hallazgo]
   
   Resultado: 2 hallazgos escalados, 3 reducidos, 7 confirmados
   2 hallazgos marcados para revisión humana (sin consenso)
```

### Ejemplo 3: Buscar specs y hallazgos pasados

**Escenario**: Un desarrollador va a trabajar en un feature de autenticación y quiere saber qué se revisó antes.

```
Desarrollador > "Buscá reviews pasados sobre autenticación"

   El agente llama specia_search("autenticación"):
   
   Resultados:
   ┌────────────────────────┬───────────┬─────────────────────────────────┐
   │ Spec                   │ Riesgo    │ Hallazgos clave                 │
   ├────────────────────────┼───────────┼─────────────────────────────────┤
   │ biometric-auth         │ high      │ Bypass rooted device, template  │
   │                        │           │ tampering, enrollment race cond │
   │ jwt-refresh-tokens     │ medium    │ Token rotation gaps, storage    │
   │                        │           │ insecurity in localStorage      │
   │ oauth-integration      │ high      │ State parameter CSRF, redirect  │
   │                        │           │ URI validation bypass           │
   └────────────────────────┴───────────┴─────────────────────────────────┘
   
   El agente puede usar estos hallazgos como contexto para el nuevo review,
   escalando patrones recurrentes.
```

---

## 11. FAQ

### ¿SpecIA reemplaza las revisiones de seguridad humanas?

No. SpecIA automatiza la revisión estructurada (STRIDE, OWASP, abuse cases) para que ocurra **en cada cambio** de manera consistente. Las revisiones humanas se reservan para: hallazgos sin consenso en el debate, cambios de postura `paranoid`, y validaciones de arquitectura complejas. El sistema marca explícitamente qué necesita revisión humana.

### ¿Qué pasa si quiero saltear el review?

No podés. El review es un hard gate. `specia_tasks` rechaza la ejecución si no hay un review válido. No hay flag de bypass. Esto es by design — si la spec tiene superficie de seguridad (y casi todas la tienen), necesita revisión.

### ¿Qué pasa si cambio la spec después del review?

SpecIA detecta cambios via hash SHA256. Si la spec cambió, el review se marca como `stale` y `specia_tasks` se rehúsa a ejecutar hasta que se haga un nuevo review. El sistema lo maneja automáticamente.

### ¿Qué postura de seguridad debo usar?

| Postura | Usar cuando... |
|---------|---------------|
| `standard` | Herramientas internas, scripts, cambios cosméticos, refactors sin impacto de seguridad |
| `elevated` | Features customer-facing, APIs públicas, integraciones con terceros |
| `paranoid` | Pagos, autenticación, manejo de PII, módulos criptográficos, flujos regulados |

### ¿SpecIA funciona offline?

Sí. Es file-first — todo se almacena localmente en `.specia/`. El servidor MCP corre local. Solo necesitás conexión si usás la memoria Alejandria/Colmena (opcional) o el CLI con `--api` para reviews automáticos.

### ¿Cuánto overhead agrega al flujo de desarrollo?

La propuesta y spec toman el tiempo que el desarrollador defina. El review (automático via agente IA) toma ~30 segundos para `standard`, ~1-2 minutos para `paranoid`. El debate (opcional) toma ~2-5 minutos. La auditoría post-implementación toma ~30 segundos a ~2 minutos dependiendo del volumen de código. El overhead neto vs. no tener revisión de seguridad estructurada es mínimo.

### ¿Puedo usar SpecIA sin agente de IA?

Sí. El CLI (`specia`) funciona independientemente. Podés usar el modo manual (genera prompts para procesar con cualquier LLM) o el modo API (`--api`) que envía prompts directamente a Anthropic u OpenAI.

### ¿Qué pasa con los cambios archivados?

Los cambios completados se archivan en `.specia/specs/` con frontmatter del review de seguridad. Son buscables via `specia_search`. Esto crea una base de conocimiento de seguridad que crece con el proyecto.

### ¿El Guardian hook afecta performance?

Guardian usa smart caching (`.guardian-cache.json`). Si el archivo no cambió y el review/mitigaciones no cambiaron, el check es instantáneo. La Capa 4 (spec-aware validation con LLM) es opcional y solo se activa si se configura explícitamente.

---

## 12. Roadmap / Próximos Pasos

### En desarrollo

- **Integración con pipelines CI/CD** — Ejecutar reviews y auditorías como steps de CI, con gates que bloquean merge si no pasan.
- **Dashboard de métricas** — Visualización de hallazgos por proyecto, postura, severidad, y tendencias en el tiempo.
- **Templates de spec** — Templates pre-configurados para flujos comunes (auth, pagos, CRUD, integraciones).

### Planificado

- **Multi-proyecto** — Correlación de hallazgos entre proyectos para detectar vulnerabilidades sistémicas.
- **Compliance mapping** — Mapeo automático de hallazgos a frameworks regulatorios (PCI-DSS, SOC2, ISO 27001).
- **Review interactivo** — Modo donde el reviewer humano puede ajustar hallazgos y el sistema aprende del feedback.

### Ideas a futuro

- **IDE plugin nativo** — Integración directa en VS Code más allá de Copilot Chat.
- **Benchmark de seguridad** — Métricas de madurez de seguridad por equipo/proyecto basadas en datos de SpecIA.

---

## Contacto

**Equipo AppSec** — Para preguntas, feedback o solicitudes de features:
- Repo: `https://gitlab.veritran.net/appsec/specia`
- Slack: `#appsec`

---

*Última actualización: Abril 2026 | SpecIA v0.4.0*
