# SpecIA Installation Troubleshooting

## OpenCode: "bad file reference" Error

### Síntoma

```
Error: Configuration is invalid at ~/.config/opencode/opencode.json:
bad file reference: "{file:~/.config/opencode/skills/specia-explore/SKILL.md}"
~/.config/opencode/skills/specia-explore/SKILL.md does not exist
```

### Causa

El archivo `~/.config/opencode/opencode.json` tiene referencias a sub-agents (`specia-explore`, `specia-apply`) que usan archivos externos (`{file:...}`) que no existen para OpenCode.

Estos agents SÍ existen para **Copilot** (`full/skills/copilot/specia-explore/`), pero **NO para OpenCode**. OpenCode usa inline prompts en su config, no archivos externos.

### Solución

**Opción 1: Limpiar manualmente el config** (recomendado)

Edita `~/.config/opencode/opencode.json` y **elimina** estas secciones:

```json
{
  "agent": {
    // ELIMINAR esta sección completa ↓
    "specia-explore": {
      "mode": "subagent",
      "hidden": true,
      "description": "Security-focused pre-investigation before proposal",
      "prompt": "{file:~/.config/opencode/skills/specia-explore/SKILL.md}",
      ...
    },
    
    // ELIMINAR esta sección completa ↓
    "specia-apply": {
      "mode": "subagent",
      "hidden": true,
      "description": "Implement SpecIA tasks including security mitigations",
      "prompt": "{file:~/.config/opencode/skills/specia-apply/SKILL.md}",
      ...
    },
    
    // MANTENER todos los demás agents (specia, specia-propose, specia, etc.)
  }
}
```

**Opción 2: Reinstalar limpio**

```bash
# 1. Backup current config
cp ~/.config/opencode/opencode.json ~/.config/opencode/opencode.json.backup

# 2. Remover agents SpecIA del config (manual)
# Edita opencode.json y elimina SOLO la sección "agent" > "specia" y sub-agents

# 3. Reinstalar
cd /path/to/specia/full
./install.sh --opencode
```

### Validar config

```bash
# Verificar JSON es válido
cat ~/.config/opencode/opencode.json | jq . > /dev/null && echo "✅ OK" || echo "❌ Invalid JSON"
```

### Por qué `specia-explore` y `specia-apply` NO necesitan archivos externos en OpenCode

OpenCode agents pueden tener prompts **inline** (directamente en el JSON) o **external** (`{file:...}`).

**SpecIA usa inline prompts para todos los sub-agents EXCEPTO**:
- `specia` (orchestrator) → usa `{file:./ORCHESTRATOR.md}`

Los sub-agents (`specia-propose`, `specia`, `specia-review`, `specia-tasks`, `specia-audit`) tienen prompts **inline** en el JSON porque son más simples y no necesitan archivos separados.

`specia-explore` y `specia-apply` fueron agregados incorrectamente con referencias a archivos que no existen.

### Agents correctos en OpenCode

Después de limpiar, deberías tener:

```json
{
  "agent": {
    "specia": {
      "mode": "primary",
      "prompt": "{file:./ORCHESTRATOR.md}",  // ✅ Este archivo SÍ existe
      ...
    },
    "specia-propose": {
      "mode": "subagent",
      "prompt": "IMPORTANT: You are a WORKER agent...",  // ✅ Inline
      ...
    },
    "specia": { ... },      // ✅ Inline
    "specia-design": { ... },    // ✅ Inline
    "specia-review": { ... },    // ✅ Inline
    "specia-tasks": { ... },     // ✅ Inline
    "specia-audit": { ... }      // ✅ Inline
  }
}
```

**NO debe haber** `specia-explore` ni `specia-apply` en el config de OpenCode.

---

## Otros Problemas Comunes

### MCP server not found

```bash
Error: Cannot find module '/path/to/specia/bin/specia-mcp.js'
```

**Causa**: MCP server no construido.

**Solución**:
```bash
cd /path/to/specia/full
npm install
npm run build
npm link
```

### specia command not found

**Causa**: CLI no linked o npm global bin no en PATH.

**Solución**:
```bash
# Verificar npm global bin
npm bin -g

# Agregar a PATH (si no está)
echo 'export PATH="$(npm bin -g):$PATH"' >> ~/.bashrc
source ~/.bashrc

# Re-link
cd /path/to/specia/full
npm link
```

### Permission denied: .git/hooks/pre-commit

**Causa**: Guardian hook sin permisos de ejecución.

**Solución**:
```bash
chmod +x .git/hooks/pre-commit
```

---

**Última actualización**: 18 abril 2026  
**Versión**: v2.1.0
