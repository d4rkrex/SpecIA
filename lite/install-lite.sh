#!/usr/bin/env bash
set -euo pipefail

# SpecIA Lite Installer
# Installs only specia-review-lite and specia-audit-lite skills
# NO MCP server, NO state, NO dependencies

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "🚀 SpecIA Lite Installer"
echo "========================="
echo ""

# Detect platform
if command -v code &> /dev/null && [ -d "$HOME/.config/opencode" ]; then
    PLATFORM="opencode"
    SKILLS_DIR="$HOME/.config/opencode/skills"
elif command -v cursor &> /dev/null || [ -d "$HOME/.cursor" ]; then
    PLATFORM="cursor"
    SKILLS_DIR="$HOME/.cursor/skills"
elif [ -d "$HOME/.claude" ]; then
    PLATFORM="claude"
    SKILLS_DIR="$HOME/.claude/skills"
elif [ -d "$HOME/.continue" ]; then
    PLATFORM="continue"
    SKILLS_DIR="$HOME/.continue/skills"
else
    echo "❌ No supported AI editor found (OpenCode, Cursor, Claude Desktop, Continue)"
    echo ""
    echo "Supported platforms:"
    echo "  - OpenCode: https://github.com/github/opencode"
    echo "  - Cursor: https://cursor.sh"
    echo "  - Claude Desktop: https://claude.ai/download"
    echo "  - Continue: https://continue.dev"
    exit 1
fi

echo "✓ Detected platform: $PLATFORM"
echo "✓ Skills directory: $SKILLS_DIR"
echo ""

# Create skills directory if it doesn't exist
mkdir -p "$SKILLS_DIR"

# Copy skills
echo "📦 Installing SpecIA Lite skills..."

cp -r "$SCRIPT_DIR/skills/specia-review-lite" "$SKILLS_DIR/"
echo "  ✓ specia-review-lite installed"

cp -r "$SCRIPT_DIR/skills/specia-audit-lite" "$SKILLS_DIR/"
echo "  ✓ specia-audit-lite installed"

echo ""
echo "✅ SpecIA Lite installed successfully!"
echo ""
echo "Available commands:"
echo "  - specia-review-lite: Quick security review (STRIDE critical only)"
echo "  - specia-audit-lite: Quick post-implementation audit (static checks)"
echo ""
echo "Token cost per feature:"
echo "  - Review: ~3k tokens (~\$0.009)"
echo "  - Audit:  ~6.6k tokens (~\$0.020)"
echo "  - Total:  ~9.6k tokens (~\$0.029)"
echo ""
echo "Compare to SpecIA Full:"
echo "  - Full workflow: ~70k tokens (~\$0.22)"
echo "  - 7x cheaper, 10x faster"
echo ""
echo "To upgrade to full SpecIA workflow:"
echo "  cd $REPO_ROOT/full && ./install.sh"
echo ""
