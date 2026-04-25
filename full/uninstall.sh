#!/usr/bin/env bash
# SpecIA Uninstaller — removes files and config entries created by install.sh
#   cd specia && ./uninstall.sh            # interactive menu
#   cd specia && ./uninstall.sh --all      # remove everything
#   cd specia && ./uninstall.sh --claude-code --opencode  # specific targets
set -euo pipefail

# ── Colors & helpers ──────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info()  { echo -e "${BLUE}[info]${NC} $*"; }
ok()    { echo -e "${GREEN}  ✓${NC} $*"; }
warn()  { echo -e "${YELLOW}[warn]${NC} $*"; }
err()   { echo -e "${RED}[error]${NC} $*" >&2; }
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

DELETED=()
NOT_FOUND=()
ERRORS=()
TARGETS_REMOVED=()

echo ""
echo -e "${RED}╔══════════════════════════════════════════╗${NC}"
echo -e "${RED}║  SpecIA — Uninstaller                  ║${NC}"
echo -e "${RED}║  Security-Aware Spec-Driven Dev Server   ║${NC}"
echo -e "${RED}╚══════════════════════════════════════════╝${NC}"
echo ""

# ── Validate repo ────────────────────────────────────────────────────
if ! grep -q '"@appsec/specia"' "$REPO_DIR/package.json" 2>/dev/null; then
  err "Not a SpecIA repo. Run from inside the cloned repo."
  exit 1
fi

# ── Parse flags ──────────────────────────────────────────────────────
DO_OPENCODE=false
DO_CLAUDE_CODE=false
DO_COPILOT=false
DO_VSCODE=false
DO_NPM=false
DO_ALL=false
HAS_FLAG=false

for arg in "$@"; do
  case "$arg" in
    --opencode)     DO_OPENCODE=true;    HAS_FLAG=true ;;
    --claude-code)  DO_CLAUDE_CODE=true; HAS_FLAG=true ;;
    --copilot)      DO_COPILOT=true;     HAS_FLAG=true ;;
    --vscode)       DO_VSCODE=true;      HAS_FLAG=true ;;
    --npm)          DO_NPM=true;         HAS_FLAG=true ;;
    --all)          DO_ALL=true;         HAS_FLAG=true ;;
    --help|-h)
      echo "Usage: ./uninstall.sh [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --opencode       Remove OpenCode config (MCP + agents + commands + skill)"
      echo "  --claude-code    Remove Claude Code config (MCP + CLAUDE.md section + sub-agents + skill)"
      echo "  --copilot        Remove Copilot CLI config (agents + MCP + skill)"
      echo "  --vscode         Remove VS Code Copilot config (MCP + instructions)"
      echo "  --npm            Remove global npm link"
      echo "  --all            Remove all targets + npm link"
      echo ""
      echo "If no flag is passed, an interactive menu is shown."
      exit 0
      ;;
    *)
      err "Unknown flag: $arg"
      err "Run ./uninstall.sh --help for usage."
      exit 1
      ;;
  esac
done

if $DO_ALL; then
  DO_OPENCODE=true
  DO_CLAUDE_CODE=true
  DO_COPILOT=true
  DO_VSCODE=true
  DO_NPM=true
fi

# ── Interactive menu (no flags) ──────────────────────────────────────
if ! $HAS_FLAG; then
  echo "No target specified. What would you like to uninstall?"
  echo ""
  echo "  1) All targets + npm link"
  echo "  2) Select specific targets"
  echo "  3) Cancel"
  echo ""
  read -rp "Choose [1/2/3]: " CHOICE
  echo ""

  case "$CHOICE" in
    1)
      DO_OPENCODE=true
      DO_CLAUDE_CODE=true
      DO_COPILOT=true
      DO_VSCODE=true
      DO_NPM=true
      ;;
    2)
      read -rp "  Remove OpenCode config?      [y/N]: " yn; [[ "$yn" =~ ^[Yy] ]] && DO_OPENCODE=true
      read -rp "  Remove Claude Code config?   [y/N]: " yn; [[ "$yn" =~ ^[Yy] ]] && DO_CLAUDE_CODE=true
      read -rp "  Remove Copilot CLI config?   [y/N]: " yn; [[ "$yn" =~ ^[Yy] ]] && DO_COPILOT=true
      read -rp "  Remove VS Code Copilot?      [y/N]: " yn; [[ "$yn" =~ ^[Yy] ]] && DO_VSCODE=true
      read -rp "  Remove global npm link?      [y/N]: " yn; [[ "$yn" =~ ^[Yy] ]] && DO_NPM=true
      ;;
    *)
      info "Cancelled."
      exit 0
      ;;
  esac
  echo ""
fi

# ── Collect files to remove ──────────────────────────────────────────
FILES_TO_DELETE=()
JSON_EDITS=()   # entries: "file|key_path|description"
SECTION_REMOVALS=()  # entries: "file|begin_marker|end_marker|description"

# --- OpenCode ---
OPENCODE_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
if $DO_OPENCODE; then
  # Slash commands
  for cmd in specia-status specia-review specia-new specia-ff specia-init specia-continue; do
    FILES_TO_DELETE+=("$OPENCODE_DIR/commands/${cmd}.md")
  done
  # Skill
  FILES_TO_DELETE+=("$OPENCODE_DIR/skills/specia/SKILL.md")
  # MCP + agent entry in opencode.json
  JSON_EDITS+=("$OPENCODE_DIR/opencode.json|mcp.specia|OpenCode MCP server entry")
  JSON_EDITS+=("$OPENCODE_DIR/opencode.json|agent|OpenCode agent config (if SpecIA agents only)")
fi

# --- Claude Code ---
CLAUDE_DIR="$HOME/.claude"
if $DO_CLAUDE_CODE; then
  # Sub-agents
  for agent in specia-audit specia-design specia-propose specia-review specia specia-tasks; do
    FILES_TO_DELETE+=("$CLAUDE_DIR/skills/specia/${agent}.md")
  done
  # Skill
  FILES_TO_DELETE+=("$CLAUDE_DIR/skills/specia/SKILL.md")
  # CLAUDE.md section (marker-based removal)
  SECTION_REMOVALS+=("$CLAUDE_DIR/CLAUDE.md|<!-- BEGIN:specia -->|<!-- END:specia -->|SpecIA section in CLAUDE.md")
  # MCP entry in settings.json
  JSON_EDITS+=("$CLAUDE_DIR/settings.json|mcpServers.specia|Claude Code MCP server entry")
fi

# --- Copilot CLI ---
COPILOT_DIR="$HOME/.copilot"
if $DO_COPILOT; then
  for agent in specia specia-tasks specia-review specia-design specia specia-propose; do
    FILES_TO_DELETE+=("$COPILOT_DIR/agents/${agent}.agent.md")
  done
  # Skill
  FILES_TO_DELETE+=("$COPILOT_DIR/skills/specia/SKILL.md")
  # MCP entry in mcp-config.json
  JSON_EDITS+=("$COPILOT_DIR/mcp-config.json|mcpServers.specia|Copilot CLI MCP server entry")
fi

# --- VS Code Copilot ---
VSCODE_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/Code/User"
if $DO_VSCODE; then
  # Instructions
  FILES_TO_DELETE+=("$VSCODE_DIR/prompts/specia.instructions.md")
  # MCP entry in mcp.json
  JSON_EDITS+=("$VSCODE_DIR/mcp.json|servers.specia|VS Code MCP server entry")
fi

# ── Preview ──────────────────────────────────────────────────────────
HAS_WORK=false

if [ ${#FILES_TO_DELETE[@]} -gt 0 ]; then
  echo -e "${YELLOW}Files to remove:${NC}"
  for f in "${FILES_TO_DELETE[@]}"; do
    if [ -f "$f" ]; then
      echo -e "  ${RED}✗${NC} $f"
      HAS_WORK=true
    else
      echo -e "  ${YELLOW}–${NC} $f ${YELLOW}(not found)${NC}"
    fi
  done
  echo ""
fi

if [ ${#JSON_EDITS[@]} -gt 0 ]; then
  echo -e "${YELLOW}JSON entries to remove:${NC}"
  for entry in "${JSON_EDITS[@]}"; do
    IFS='|' read -r file key desc <<< "$entry"
    if [ -f "$file" ]; then
      echo -e "  ${RED}✗${NC} $desc  →  $file"
      HAS_WORK=true
    else
      echo -e "  ${YELLOW}–${NC} $desc  →  $file ${YELLOW}(not found)${NC}"
    fi
  done
  echo ""
fi

if [ ${#SECTION_REMOVALS[@]} -gt 0 ]; then
  echo -e "${YELLOW}Config sections to remove:${NC}"
  for entry in "${SECTION_REMOVALS[@]}"; do
    IFS='|' read -r file begin_marker end_marker desc <<< "$entry"
    if [ -f "$file" ] && grep -q "$begin_marker" "$file" 2>/dev/null; then
      echo -e "  ${RED}✗${NC} $desc"
      HAS_WORK=true
    else
      echo -e "  ${YELLOW}–${NC} $desc ${YELLOW}(not found or no section)${NC}"
    fi
  done
  echo ""
fi

if $DO_NPM; then
  echo -e "${YELLOW}npm:${NC}"
  echo -e "  ${RED}✗${NC} npm unlink @appsec/specia (global)"
  HAS_WORK=true
  echo ""
fi

if ! $HAS_WORK; then
  info "Nothing to uninstall — no SpecIA files found for the selected targets."
  exit 0
fi

# ── Confirm ──────────────────────────────────────────────────────────
read -rp "Proceed with uninstall? [y/N]: " CONFIRM
if [[ ! "$CONFIRM" =~ ^[Yy] ]]; then
  info "Cancelled."
  exit 0
fi
echo ""

# ── Execute: delete files ────────────────────────────────────────────
for f in "${FILES_TO_DELETE[@]}"; do
  if [ -f "$f" ]; then
    if rm "$f" 2>/dev/null; then
      ok "Deleted $f"
      DELETED+=("$f")
    else
      err "Failed to delete $f"
      ERRORS+=("$f")
    fi
  else
    NOT_FOUND+=("$f")
  fi
done

# Clean up empty specia skill directories (but never delete parent dirs)
for dir in \
  "$OPENCODE_DIR/skills/specia" \
  "$CLAUDE_DIR/skills/specia" \
  "$COPILOT_DIR/skills/specia"; do
  if [ -d "$dir" ] && [ -z "$(ls -A "$dir" 2>/dev/null)" ]; then
    rmdir "$dir" 2>/dev/null && ok "Removed empty directory $dir" || true
  fi
done

# ── Execute: JSON edits ─────────────────────────────────────────────
for entry in "${JSON_EDITS[@]}"; do
  IFS='|' read -r file key desc <<< "$entry"
  if [ ! -f "$file" ]; then
    NOT_FOUND+=("$desc ($file)")
    continue
  fi

  # Use node for safe JSON manipulation
  if SPECIA_TARGET_FILE="$file" SPECIA_KEY="$key" node -e '
    const fs = require("fs");
    const file = process.env.SPECIA_TARGET_FILE;
    const key = process.env.SPECIA_KEY;
    const parts = key.split(".");

    let c;
    try { c = JSON.parse(fs.readFileSync(file, "utf8")); }
    catch(e) { process.exit(2); }

    // Navigate to parent and delete the target key
    let obj = c;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!obj || typeof obj !== "object" || !(parts[i] in obj)) process.exit(1);
      obj = obj[parts[i]];
    }
    const lastKey = parts[parts.length - 1];
    if (!obj || typeof obj !== "object" || !(lastKey in obj)) process.exit(1);
    delete obj[lastKey];

    // Clean up empty parent objects (bottom-up)
    // e.g. if mcp.specia was the only key, remove mcp too
    // But only clean intermediate keys, not root-level ones for safety
    if (parts.length > 1) {
      let parent = c;
      for (let i = 0; i < parts.length - 2; i++) parent = parent[parts[i]];
      const parentKey = parts[parts.length - 2];
      if (typeof parent[parentKey] === "object" && Object.keys(parent[parentKey]).length === 0) {
        delete parent[parentKey];
      }
    }

    fs.writeFileSync(file, JSON.stringify(c, null, 2) + "\n");
  ' 2>/dev/null; then
    ok "Removed $desc"
    DELETED+=("$desc")
  else
    EXIT_CODE=$?
    if [ "$EXIT_CODE" -eq 1 ]; then
      NOT_FOUND+=("$desc (key not present in $file)")
    else
      err "Failed to edit $file for $desc"
      ERRORS+=("$desc")
    fi
  fi
done

# ── Execute: section removals ───────────────────────────────────────
for entry in "${SECTION_REMOVALS[@]}"; do
  IFS='|' read -r file begin_marker end_marker desc <<< "$entry"
  if [ ! -f "$file" ]; then
    NOT_FOUND+=("$desc ($file)")
    continue
  fi
  if ! grep -q "$begin_marker" "$file" 2>/dev/null; then
    NOT_FOUND+=("$desc (section not found in $file)")
    continue
  fi

  # Use node for safe multi-line section removal
  if SPECIA_TARGET_FILE="$file" SPECIA_BEGIN="$begin_marker" SPECIA_END="$end_marker" node -e '
    const fs = require("fs");
    const file = process.env.SPECIA_TARGET_FILE;
    const begin = process.env.SPECIA_BEGIN;
    const end = process.env.SPECIA_END;
    let content = fs.readFileSync(file, "utf8");

    // Build regex to match from begin marker to end marker (inclusive), plus surrounding blank lines
    const escaped_begin = begin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const escaped_end = end.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp("\\n?" + escaped_begin + "[\\s\\S]*?" + escaped_end + "\\n?", "g");
    content = content.replace(regex, "\n");

    // Clean up excessive blank lines left behind
    content = content.replace(/\n{3,}/g, "\n\n").trim() + "\n";

    fs.writeFileSync(file, content);
  ' 2>/dev/null; then
    ok "Removed $desc"
    DELETED+=("$desc")
  else
    err "Failed to remove section from $file"
    ERRORS+=("$desc")
  fi
done

# ── Execute: npm unlink ─────────────────────────────────────────────
if $DO_NPM; then
  info "Removing global npm link..."
  if npm unlink --global --prefix "$REPO_DIR" 2>/dev/null || npm rm --global @appsec/specia 2>/dev/null; then
    ok "npm global link removed"
    DELETED+=("npm global link")
  else
    warn "npm unlink failed (may already be unlinked)"
    NOT_FOUND+=("npm global link (not present)")
  fi
fi

# ── Track which targets were processed ───────────────────────────────
$DO_OPENCODE    && TARGETS_REMOVED+=("OpenCode")
$DO_CLAUDE_CODE && TARGETS_REMOVED+=("Claude Code")
$DO_COPILOT     && TARGETS_REMOVED+=("Copilot CLI")
$DO_VSCODE      && TARGETS_REMOVED+=("VS Code Copilot")
$DO_NPM         && TARGETS_REMOVED+=("npm link")

# ── Summary ──────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}Uninstall complete!${NC}"
echo ""
if [ ${#DELETED[@]} -gt 0 ]; then
  info "Removed (${#DELETED[@]}):"
  for d in "${DELETED[@]}"; do echo -e "  ${GREEN}✓${NC} $d"; done
fi
if [ ${#NOT_FOUND[@]} -gt 0 ]; then
  echo ""
  info "Not found (${#NOT_FOUND[@]}):"
  for n in "${NOT_FOUND[@]}"; do echo -e "  ${YELLOW}–${NC} $n"; done
fi
if [ ${#ERRORS[@]} -gt 0 ]; then
  echo ""
  info "Errors (${#ERRORS[@]}):"
  for e in "${ERRORS[@]}"; do echo -e "  ${RED}✗${NC} $e"; done
fi
echo ""
if [ ${#TARGETS_REMOVED[@]} -gt 0 ]; then
  info "Targets processed:"
  for t in "${TARGETS_REMOVED[@]}"; do echo "  - $t"; done
fi
echo ""
info "SpecIA files have been removed. Your AI agents may need a restart."
