#!/usr/bin/env bash
# SpecIA Installer — run from inside the cloned repo
#   git clone https://gitlab.veritran.net/appsec/specia && cd specia && ./install.sh
#   ./install.sh --copilot              # install Copilot only
#   ./install.sh --copilot --skip-build # update Copilot files without rebuilding
#   ./install.sh --all --skip-build     # update all targets without rebuilding
set -euo pipefail

# ── Colors & helpers ──────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info()  { echo -e "${BLUE}[info]${NC} $*"; }
ok()    { echo -e "${GREEN}  ✓${NC} $*"; }
warn()  { echo -e "${YELLOW}[warn]${NC} $*"; }
err()   { echo -e "${RED}[error]${NC} $*" >&2; }
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MCP_BIN="$REPO_DIR/bin/specia-mcp.js"
CONFIGURED=()
SKIPPED=()

# ── Parse flags ──────────────────────────────────────────────────────
DO_OPENCODE=false
DO_CLAUDE_CODE=false
DO_COPILOT=false
DO_VSCODE=false
DO_NPM=false
DO_ALL=false
SKIP_BUILD=false
HAS_TARGET_FLAG=false
REGISTER_MCP=false
DO_UPDATE=false

show_help() {
  echo "Usage: ./install.sh [OPTIONS]"
  echo ""
  echo "Options:"
  echo "  --copilot       Install Copilot CLI target only"
  echo "  --claude-code   Install Claude Code target only"
  echo "  --opencode      Install OpenCode target only"
  echo "  --vscode        Install VS Code target only"
  echo "  --npm           Run npm build only (no client configs)"
  echo "  --all           Install all detected targets (default)"
  echo "  --mcp           Register MCP server (optional - for advanced users)"
  echo "  --update        Update existing installation (all installed clients)"
  echo "  --skip-build    Skip npm install/build/link"
  echo "  -h, --help      Show this help message"
  echo ""
  echo "Examples:"
  echo "  ./install.sh                    # Auto-detect and install all (CLI + Skills)"
  echo "  ./install.sh --copilot          # Install Copilot only (CLI + Skills)"
  echo "  ./install.sh --claude-code --mcp # Install Claude Code with MCP server"
  echo "  ./install.sh --update           # Update all installed clients to latest"
  echo "  ./install.sh --copilot --skip-build  # Update Copilot files without rebuilding"
}

for arg in "$@"; do
  case "$arg" in
    --copilot)      DO_COPILOT=true;     HAS_TARGET_FLAG=true ;;
    --claude-code)  DO_CLAUDE_CODE=true; HAS_TARGET_FLAG=true ;;
    --opencode)     DO_OPENCODE=true;    HAS_TARGET_FLAG=true ;;
    --vscode)       DO_VSCODE=true;      HAS_TARGET_FLAG=true ;;
    --npm)          DO_NPM=true;         HAS_TARGET_FLAG=true ;;
    --all)          DO_ALL=true;         HAS_TARGET_FLAG=true ;;
    --mcp)          REGISTER_MCP=true ;;
    --update)       DO_UPDATE=true ;;
    --skip-build)   SKIP_BUILD=true ;;
    --help|-h)
      show_help
      exit 0
      ;;
    *)
      err "Unknown flag: $arg"
      echo ""
      show_help
      exit 1
      ;;
  esac
done

# If --all, enable all targets
if $DO_ALL; then
  DO_OPENCODE=true
  DO_CLAUDE_CODE=true
  DO_COPILOT=true
  DO_VSCODE=true
  DO_NPM=true
fi

# If no target flags passed, auto-detect all (current default behavior)
if ! $HAS_TARGET_FLAG; then
  DO_OPENCODE=true
  DO_CLAUDE_CODE=true
  DO_COPILOT=true
  DO_VSCODE=true
  DO_NPM=true
fi

# --skip-build warning
if $SKIP_BUILD; then
  warn "⚠️  Skipping npm build. MCP server may not work if dist/ is not up to date."
fi

# npm is included in build unless --skip-build or explicit --npm-only scenario
# If a target flag was passed without --npm, skip npm build
if $HAS_TARGET_FLAG && ! $DO_NPM && ! $DO_ALL; then
  SKIP_BUILD=true
fi

echo ""
echo -e "${BLUE}╔══════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  SpecIA — Security-Aware Spec-Driven   ║${NC}"
echo -e "${BLUE}║  Development MCP Server                  ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════╝${NC}"
echo ""

# ── 1. Validate repo ─────────────────────────────────────────────────
if ! grep -q '"@appsec/specia"' "$REPO_DIR/package.json" 2>/dev/null; then
  err "Not a SpecIA repo. Clone it first:"
  err "  git clone https://gitlab.veritran.net/appsec/specia && cd specia && ./install.sh"
  exit 1
fi

# Check Node.js 20+
if ! command -v node &>/dev/null; then
  err "Node.js not found. Install 20+: https://nodejs.org"; exit 1
fi
NODE_MAJOR=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 20 ]; then
  err "Node.js 20+ required (found $(node -v))"; exit 1
fi
ok "Node.js $(node -v)"

# ── 2. Build & link ──────────────────────────────────────────────────
if ! $SKIP_BUILD; then
  info "Installing dependencies..."
  npm install --prefix "$REPO_DIR"
  info "Building..."
  npm run build --prefix "$REPO_DIR"
  info "Linking globally..."
  npm link --prefix "$REPO_DIR"
  
  # Verify CLI accessibility and auto-fix if possible
  NPM_BIN="$(npm bin -g 2>/dev/null || echo '')"
  if command -v specia &>/dev/null; then
    ok "specia and specia-mcp linked and available in PATH"
  else
    # Try auto-fix: create symlinks in ~/.local/bin if it exists
    if [ -d "$HOME/.local/bin" ]; then
      ln -sf "$NPM_BIN/specia" "$HOME/.local/bin/specia" 2>/dev/null || true
      ln -sf "$NPM_BIN/specia-mcp" "$HOME/.local/bin/specia-mcp" 2>/dev/null || true
      
      if command -v specia &>/dev/null; then
        ok "specia CLI linked to ~/.local/bin/"
      else
        warn "CLI installed but NOT accessible from PATH"
        warn "Symlinks created in ~/.local/bin/ but directory not in PATH"
        warn "Add to your shell profile (~/.bashrc or ~/.zshrc):"
        echo -e "  ${YELLOW}export PATH=\"\$HOME/.local/bin:\$PATH\"${NC}"
      fi
    else
      warn "CLI installed but NOT accessible from PATH"
      warn "npm bin directory: $NPM_BIN"
      if [[ ":$PATH:" != *":$NPM_BIN:"* ]]; then
        warn "Add to your shell profile (~/.bashrc or ~/.zshrc):"
        echo -e "  ${YELLOW}export PATH=\"\$PATH:$NPM_BIN\"${NC}"
      fi
    fi
    info "Note: MCP server works via OpenCode/Copilot without CLI"
  fi
else
  info "Skipping npm build (--skip-build)"
fi

# ── Helper: merge JSON with node ─────────────────────────────────────
# Usage: json_merge <file> <node-script>
# The script receives: configPath, mcpBin, repoDir as globals
json_merge() {
  SPECIA_CONFIG_FILE="$1" SPECIA_MCP_BIN="$MCP_BIN" SPECIA_REPO_DIR="$REPO_DIR" node -e "$2"
}

# ── 3. Auto-detect & configure clients ───────────────────────────────

# ── OpenCode ──
OPENCODE_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
if $DO_OPENCODE && [ -d "$OPENCODE_DIR" ]; then
  info "Configuring OpenCode..."
  CONFIG="$OPENCODE_DIR/opencode.json"

  # Register specia agent (ALWAYS - agent uses ORCHESTRATOR.md, not MCP)
  [ -f "$CONFIG" ] || echo '{}' > "$CONFIG"
  json_merge "$CONFIG" '
    const fs = require("fs");
    const p = process.env.SPECIA_CONFIG_FILE;
    const c = JSON.parse(fs.readFileSync(p, "utf8"));
    const orch = process.env.SPECIA_REPO_DIR + "/agents/opencode/specia.json";
    if (fs.existsSync(orch)) {
      const o = JSON.parse(fs.readFileSync(orch, "utf8"));
      if (!c.agent) c.agent = {};
      Object.assign(c.agent, o.agent || {});
    }
    fs.writeFileSync(p, JSON.stringify(c, null, 2) + "\n");
  '
  ok "specia agent registered"

  # MCP server (OPTIONAL - only if --mcp flag passed)
  if $REGISTER_MCP; then
    json_merge "$CONFIG" '
      const fs = require("fs");
      const p = process.env.SPECIA_CONFIG_FILE;
      const c = JSON.parse(fs.readFileSync(p, "utf8"));
      if (!c.mcp) c.mcp = {};
      c.mcp.specia = { command: ["node", process.env.SPECIA_MCP_BIN], enabled: true, type: "local" };
      fs.writeFileSync(p, JSON.stringify(c, null, 2) + "\n");
    '
    ok "MCP server registered"
  else
    info "MCP server NOT registered (CLI-only mode). Use --mcp flag to enable."
  fi

  # Orchestrator prompt (referenced by specia agent as {file:./ORCHESTRATOR.md})
  [ -f "$REPO_DIR/agents/opencode/ORCHESTRATOR.md" ] && \
    cp "$REPO_DIR/agents/opencode/ORCHESTRATOR.md" "$OPENCODE_DIR/ORCHESTRATOR.md"

  # Slash commands
  mkdir -p "$OPENCODE_DIR/commands"
  cp "$REPO_DIR/agents/opencode/commands/"*.md "$OPENCODE_DIR/commands/" 2>/dev/null || true

  # Main specia skill
  mkdir -p "$OPENCODE_DIR/skills/specia"
  [ -f "$REPO_DIR/skills/opencode/specia.md" ] && cp "$REPO_DIR/skills/opencode/specia.md" "$OPENCODE_DIR/skills/specia/SKILL.md"

  # Sub-agent skills referenced by {file:} in specia.json
  for agent_skill in specia-explore specia-apply; do
    src="$REPO_DIR/agents/claude-code/agents/${agent_skill}.md"
    if [ -f "$src" ]; then
      mkdir -p "$OPENCODE_DIR/skills/$agent_skill"
      cp "$src" "$OPENCODE_DIR/skills/$agent_skill/SKILL.md"
    fi
  done

  if $REGISTER_MCP; then
    ok "OpenCode (CLI + Skills + Agent + MCP)"
  else
    ok "OpenCode (CLI + Skills + Agent)"
  fi
  CONFIGURED+=("OpenCode")
elif $DO_OPENCODE; then
  SKIPPED+=("OpenCode (~/.config/opencode/ not found)")
fi

# ── Claude Code ──
CLAUDE_DIR="$HOME/.claude"
if $DO_CLAUDE_CODE && [ -d "$CLAUDE_DIR" ]; then
  info "Configuring Claude Code..."
  SETTINGS="$CLAUDE_DIR/settings.json"

  # MCP server in settings.json (OPTIONAL - only if --mcp flag passed)
  if $REGISTER_MCP; then
    [ -f "$SETTINGS" ] || echo '{}' > "$SETTINGS"
    json_merge "$SETTINGS" '
      const fs = require("fs");
      const p = process.env.SPECIA_CONFIG_FILE;
      const c = JSON.parse(fs.readFileSync(p, "utf8"));
      if (!c.mcpServers) c.mcpServers = {};
      c.mcpServers.specia = { command: "node", args: [process.env.SPECIA_MCP_BIN] };
      fs.writeFileSync(p, JSON.stringify(c, null, 2) + "\n");
    '
    ok "MCP server registered"
  else
    info "MCP server NOT registered (CLI-only mode). Use --mcp flag to enable."
  fi

  # CLAUDE.md section injection
  SECTION_FILE="$REPO_DIR/agents/claude-code/CLAUDE.md.section"
  CLAUDE_MD="$CLAUDE_DIR/CLAUDE.md"
  if [ -f "$SECTION_FILE" ]; then
    if [ -f "$CLAUDE_MD" ] && grep -q '<!-- BEGIN:specia -->' "$CLAUDE_MD" 2>/dev/null; then
      SPECIA_CLAUDE_MD="$CLAUDE_MD" SPECIA_SECTION_FILE="$SECTION_FILE" node -e '
        const fs = require("fs");
        let md = fs.readFileSync(process.env.SPECIA_CLAUDE_MD, "utf8");
        const sec = fs.readFileSync(process.env.SPECIA_SECTION_FILE, "utf8");
        md = md.replace(/<!-- BEGIN:specia -->[\s\S]*?<!-- END:specia -->/, sec.trim());
        fs.writeFileSync(process.env.SPECIA_CLAUDE_MD, md);
      '
    elif [ -f "$CLAUDE_MD" ]; then
      printf '\n' >> "$CLAUDE_MD"
      cat "$SECTION_FILE" >> "$CLAUDE_MD"
    else
      cp "$SECTION_FILE" "$CLAUDE_MD"
    fi
  fi

  # Sub-agents
  mkdir -p "$CLAUDE_DIR/skills/specia"
  cp "$REPO_DIR/agents/claude-code/agents/"*.md "$CLAUDE_DIR/skills/specia/" 2>/dev/null || true

  # Skill
  [ -f "$REPO_DIR/skills/claude-code/SPECIA.md" ] && cp "$REPO_DIR/skills/claude-code/SPECIA.md" "$CLAUDE_DIR/skills/specia/SKILL.md"

  if $REGISTER_MCP; then
    ok "Claude Code (CLI + Skills + MCP)"
  else
    ok "Claude Code (CLI + Skills)"
  fi
  CONFIGURED+=("Claude Code")
elif $DO_CLAUDE_CODE; then
  SKIPPED+=("Claude Code (~/.claude/ not found)")
fi

# ── Copilot CLI ──
COPILOT_DIR="$HOME/.copilot"
if $DO_COPILOT && [ -d "$COPILOT_DIR" ]; then
  info "Configuring Copilot CLI..."

  # Agents
  mkdir -p "$COPILOT_DIR/agents"
  cp "$REPO_DIR/agents/copilot/"*.agent.md "$COPILOT_DIR/agents/" 2>/dev/null || true

  # MCP server in mcp-config.json (OPTIONAL - only if --mcp flag passed)
  if $REGISTER_MCP; then
    MCP_CONFIG="$COPILOT_DIR/mcp-config.json"
    [ -f "$MCP_CONFIG" ] || echo '{}' > "$MCP_CONFIG"
    json_merge "$MCP_CONFIG" '
      const fs = require("fs");
      const p = process.env.SPECIA_CONFIG_FILE;
      const c = JSON.parse(fs.readFileSync(p, "utf8"));
      if (!c.mcpServers) c.mcpServers = {};
      c.mcpServers.specia = { command: "node", args: [process.env.SPECIA_MCP_BIN] };
      fs.writeFileSync(p, JSON.stringify(c, null, 2) + "\n");
    '
    ok "MCP server registered"
  else
    info "MCP server NOT registered (CLI-only mode). Use --mcp flag to enable."
  fi

  # Skill
  mkdir -p "$COPILOT_DIR/skills/specia"
  [ -f "$REPO_DIR/skills/generic/specia.md" ] && cp "$REPO_DIR/skills/generic/specia.md" "$COPILOT_DIR/skills/specia/SKILL.md"

  # SpecIA command skills (specia-init, specia-new, specia-review, specia-audit, etc.)
  if [ -d "$REPO_DIR/skills/copilot" ]; then
    for skill_dir in "$REPO_DIR/skills/copilot/"*/; do
      [ -d "$skill_dir" ] || continue
      skill_name=$(basename "$skill_dir")
      mkdir -p "$COPILOT_DIR/skills/$skill_name"
      cp "$skill_dir"* "$COPILOT_DIR/skills/$skill_name/" 2>/dev/null || true
    done
  fi

  if $REGISTER_MCP; then
    ok "Copilot CLI (CLI + Skills + MCP)"
  else
    ok "Copilot CLI (CLI + Skills)"
  fi
  CONFIGURED+=("Copilot CLI")
elif $DO_COPILOT; then
  SKIPPED+=("Copilot CLI (~/.copilot/ not found)")
fi

# ── VS Code Copilot ──
VSCODE_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/Code/User"
if $DO_VSCODE && [ -d "$VSCODE_DIR" ]; then
  info "Configuring VS Code Copilot..."
  MCP_JSON="$VSCODE_DIR/mcp.json"

  # MCP server (OPTIONAL - only if --mcp flag passed)
  if $REGISTER_MCP; then
    if [ -f "$MCP_JSON" ]; then
      json_merge "$MCP_JSON" '
        const fs = require("fs");
        const p = process.env.SPECIA_CONFIG_FILE;
        const c = JSON.parse(fs.readFileSync(p, "utf8"));
        if (!c.servers) c.servers = {};
        c.servers.specia = { command: "node", args: [process.env.SPECIA_MCP_BIN] };
        fs.writeFileSync(p, JSON.stringify(c, null, 2) + "\n");
      '
    else
      printf '{\n  "servers": {\n    "specia": {\n      "command": "node",\n      "args": ["%s"]\n    }\n  }\n}\n' "$MCP_BIN" > "$MCP_JSON"
    fi
    ok "MCP server registered"
  else
    info "MCP server NOT registered (CLI-only mode). Use --mcp flag to enable."
  fi

  # Instructions
  mkdir -p "$VSCODE_DIR/prompts"
  [ -f "$REPO_DIR/agents/vscode/specia.instructions.md" ] && \
    cp "$REPO_DIR/agents/vscode/specia.instructions.md" "$VSCODE_DIR/prompts/"

  if $REGISTER_MCP; then
    ok "VS Code Copilot (CLI + Instructions + MCP)"
  else
    ok "VS Code Copilot (CLI + Instructions)"
  fi
  CONFIGURED+=("VS Code Copilot")
elif $DO_VSCODE; then
  SKIPPED+=("VS Code Copilot (~/.config/Code/User/ not found)")
fi

# ── 4. Summary ────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}Installation complete!${NC}"
echo ""
if [ ${#CONFIGURED[@]} -gt 0 ]; then
  info "Configured:"
  for c in "${CONFIGURED[@]}"; do echo "  - $c"; done
fi
if [ ${#SKIPPED[@]} -gt 0 ]; then
  info "Skipped:"
  for s in "${SKIPPED[@]}"; do echo "  - $s"; done
fi
echo ""
info "Next: restart your AI agent and say 'Initialize SpecIA' in any project."
