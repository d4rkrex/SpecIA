# ⚠️ SpecIA Lite — Deprecated

As of **v2.5.0**, the `lite/` directory is deprecated. The `specia-review-lite` and `specia-audit-lite` skills have been consolidated into the main SpecIA installation.

## Migration

The skills are now at:
- `full/skills/copilot/specia-review-lite/SKILL.md`
- `full/skills/copilot/specia-audit-lite/SKILL.md`

**To install** (with Node.js):
```bash
cd ../full
./install.sh --copilot
```

**To install without Node.js** — copy the SKILL.md files directly into your AI editor's skills folder:
```bash
# Copilot CLI
cp full/skills/copilot/specia-review-lite/SKILL.md ~/.copilot/skills/specia-review-lite/SKILL.md
cp full/skills/copilot/specia-audit-lite/SKILL.md  ~/.copilot/skills/specia-audit-lite/SKILL.md

# Claude Desktop
cp full/skills/copilot/specia-review-lite/SKILL.md ~/.claude/skills/specia-review-lite/SKILL.md
cp full/skills/copilot/specia-audit-lite/SKILL.md  ~/.claude/skills/specia-audit-lite/SKILL.md
```

## Why consolidated?

`specia scan --last-merge` (zero-setup ad-hoc scan) now covers the same zero-friction use case as the lite skills, but with auto-LLM execution and result persistence. Keeping two parallel installation paths created confusion. The lite skills remain useful for platforms without Node.js, so they're now bundled as part of the standard install.
