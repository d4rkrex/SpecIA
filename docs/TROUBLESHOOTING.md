# SpecIA MCP — Troubleshooting

## MCP Error `-32000`: Server crashed or won't start

**Symptoms**
- The AI client (OpenCode, Claude Code) reports `mcp error -32000`.
- SpecIA tools (`specia_*`) are not available in the tool list.
- The server process exits immediately after launch.

**Root Cause**

The `node_modules/` directory is missing. Node.js cannot resolve runtime dependencies (e.g. `@modelcontextprotocol/sdk`) and the process dies on startup with:

```
ERR_MODULE_NOT_FOUND: Cannot find package '@modelcontextprotocol/sdk'
  imported from /home/mroldan/repos/AppSec/SpecIA/dist/index.js
```

This can happen after:
- Running `npm ci --production` then switching back to dev.
- Manually deleting `node_modules/` or running `git clean -fdx`.
- A failed or interrupted `npm install`.

**Fix**

```bash
cd /home/mroldan/repos/AppSec/SpecIA
npm install
```

Verify the server starts correctly:

```bash
echo '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}},"id":1}' \
  | node bin/specia-mcp.js
```

Expected response:

```json
{"result":{"protocolVersion":"2024-11-05","capabilities":{"tools":{}},"serverInfo":{"name":"specia","version":"0.3.0"}},"jsonrpc":"2.0","id":1}
```

After confirming, **restart your AI client** (OpenCode / Claude Code) so it re-spawns the MCP server process.

---

## MCP server starts but tools are not registered

**Symptoms**
- No error on startup, but `specia_*` tools don't appear.
- The `initialize` handshake succeeds but `tools/list` returns empty.

**Possible Causes**

1. **`dist/` is outdated or missing.** Rebuild:
   ```bash
   npm run build
   ```

2. **Entry point mismatch.** Verify your MCP client config points to the correct file:
   - OpenCode: `~/.config/opencode/opencode.json` — look for `specia` entry
   - Claude Code: `~/.claude/settings.json` — look for `specia` entry

   Both should point to:
   ```
   node /home/mroldan/repos/AppSec/SpecIA/bin/specia-mcp.js
   ```

---

## Node.js version incompatibility

**Symptoms**
- Syntax errors or unexpected token errors on startup.

**Fix**

SpecIA requires **Node.js >= 20**. Check your version:

```bash
node --version
```

If below v20, upgrade via nvm:

```bash
nvm install 22
nvm use 22
```

---

## Quick health check

Run all checks at once:

```bash
cd /home/mroldan/repos/AppSec/SpecIA

echo "=== Node version ==="
node --version

echo "=== node_modules exists ==="
[ -d node_modules ] && echo "OK" || echo "MISSING — run: npm install"

echo "=== dist/ exists ==="
[ -d dist ] && echo "OK" || echo "MISSING — run: npm run build"

echo "=== MCP handshake ==="
echo '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}},"id":1}' \
  | timeout 5 node bin/specia-mcp.js 2>&1 | head -1
```
