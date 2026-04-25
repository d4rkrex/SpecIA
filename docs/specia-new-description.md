# ¿Qué hace `specia propose` (o `specia new`) internamente?

El comando tiene **dos capas**: el CLI (`cli/commands/propose.ts`) y el tool/MCP handler (`tools/propose.ts`). La skill `specia-propose` invoca el tool handler. Ambos siguen la misma lógica core.

## Paso a paso

### 1. Sanitización de entrada

El `change_name` se sanitiza contra path traversal y caracteres peligrosos (`sanitizeInput` / Zod schema).

### 2. Verificación de inicialización

Comprueba que `.specia/config.yaml` exista (que `specia init` haya corrido). Si no, aborta.

### 3. Chequeo de duplicados

Lee `.specia/changes/<name>/state.yaml`. Si ya existe un cambio con ese nombre, aborta con error.

### 4. Determinación de audit_policy

Si se pasó `skip_audit: true`, la política queda `"skipped"`; si no, queda `"required"`. Esta decisión es **inmutable**: una vez seteada en el proposal, no se puede cambiar en fases posteriores (enforced en `setChangeState`).

### 5. Recall de memoria (Alejandría/Engram)

Busca propuestas y decisiones pasadas del proyecto usando búsqueda híbrida (BM25 + vector similarity). Combina el intent + scope como query. Si encuentra memorias, las incluye como contexto para enriquecer el cambio.

### 6. Renderizado del `proposal.md`

Genera un archivo Markdown estructurado con:

- Título: `# Proposal: <nombre>`
- Fecha de creación
- Sección `## Intent` con el propósito del cambio
- Sección `## Scope` con las áreas afectadas
- Sección `## Approach` (opcional) con el enfoque de implementación

### 7. Escritura atómica del artefacto

Escribe `proposal.md` en `.specia/changes/<name>/proposal.md` usando escritura atómica (escribe a `.tmp`, luego `rename`) para evitar corrupción.

### 8. Creación del `state.yaml`

Escribe el estado inicial del cambio:

```yaml
change: <nombre>
phase: proposal
status: complete
created: <ISO timestamp>
updated: <ISO timestamp>
phases_completed: [proposal]
history: []
audit_policy: required  # o "skipped"
```

También usa escritura atómica y valida inmutabilidad del `audit_policy`.

### 9. Almacenamiento en memoria

Persiste la propuesta en Alejandría/Engram con `topic_key: specia/<proyecto>/proposal/<nombre>` para que futuras propuestas tengan contexto cross-session.

### 10. Respuesta

Retorna el path del proposal creado y sugiere el siguiente paso: `specia spec <nombre>`.

## Estructura de archivos creada

```
.specia/changes/<nombre>/
├── proposal.md    ← El documento del proposal
└── state.yaml     ← Estado y metadata de la máquina de fases
```

## Garantías de seguridad

- **AC-001/T-02**: Sanitización de nombres contra path traversal
- **T-02**: `audit_policy` inmutable después del proposal
- **T-03**: Rechazo de hashes vacíos como sentinel
- **Escrituras atómicas**: Sin corrupción parcial de archivos
