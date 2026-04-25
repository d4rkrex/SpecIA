# SpecIA Release Notes

## v0.6.0 - DX Features (2026-04-17)

### 🎯 Headline Features

**Bake Mode**: Save project configurations and reuse them with `@shortcuts` to avoid repeating flags. Perfect for multi-project workflows.

**Enhanced Output Formatters**: Support for multiple output formats (markdown, SARIF, compact, JSON) with security hardening to prevent template injection and XSS attacks.

**Pipe-Friendly Output**: TTY detection, `--gate` flag for CI/CD integration, and proper exit codes enable Unix-style command chaining.

---

### ✨ New Features

#### Bake Mode - Reusable Project Configs
```bash
# Create a config
specia bake create myapp --project-dir ~/projects/myapp --posture elevated

# Use it with @shortcut
specia @myapp review my-change

# List all configs
specia bake list

# Verify integrity
specia bake verify myapp
```

**Security Features**:
- ✅ HMAC integrity checks prevent config tampering (AC-001)
- ✅ Secrets stored as `env:` references, never plaintext (AC-002)
- ✅ Path validation blocks command injection + traversal (EOP-01, EOP-02)
- ✅ File permissions: 0600 (user-only read/write)

**Tests**: 34 passing (18 security tests)

---

#### Enhanced Output Formatters
```bash
# Human-friendly markdown
specia review my-change --format markdown

# GitHub Security integration
specia review my-change --format sarif > report.sarif

# AI-friendly compact (<50 tokens)
specia review my-change --format compact

# Machine-readable JSON
specia review my-change --format json
```

**Security Features**:
- ✅ Template injection prevention (sanitizes HTML/script tags) (T-02)
- ✅ SARIF injection prevention (escapes XML/JSON payloads) (AC-003)
- ✅ DoS protections (MAX_FINDINGS=1000, MAX_OUTPUT_SIZE=10MB) (DOS-02)
- ✅ TTY detection strips ANSI codes when piped

**Tests**: 19 passing (sanitization, SARIF validation, DoS limits)

---

#### Pipe-Friendly CI/CD Integration
```bash
# Exit 0 if no high/critical findings, 1 otherwise
specia review my-change --gate high && specia tasks my-change

# Command chaining
specia review my-change --gate high || echo "Security gate failed"

# Pipe to jq
specia review my-change --format json | jq '.findings[] | select(.severity=="high")'
```

**Features**:
- ✅ `--gate <threshold>` flag (critical|high|medium|low)
- ✅ Atomic exit code logic prevents bypass (AC-004)
- ✅ Works regardless of output format
- ✅ Proper error handling for invalid thresholds

**Tests**: 14 passing (TTY detection, exit codes, gate behavior)

---

### 🔐 Security

This release underwent mandatory security review (STRIDE + OWASP Top 10) and post-implementation audit.

**Review**: HIGH risk, 11 findings (0C/4H/5M/2L)  
**Audit**: PASS verdict, LOW risk  
**Abuse Cases**: 5/5 verified with mitigations

| ID | Abuse Case | Risk | Mitigation |
|----|------------|------|------------|
| AC-001 | Supply chain attack (tampered config) | Critical | HMAC integrity checks |
| AC-002 | API key exfiltration via bake list | High | env: refs never displayed |
| AC-003 | SARIF injection → XSS | Medium | Escape all user content |
| AC-004 | DoS via --gate bypass | Medium | Atomic exit code logic |
| AC-005 | Path traversal to /etc/passwd | High | Block system paths |

---

### 📊 Technical Details

**Commits**: 4 feature commits
1. `7173b07` - Bake Mode implementation (988 lines)
2. `3d877c8` - Output formatters enhancements (516 lines)
3. `350e98a` - --gate flag for CI/CD (366 lines)
4. `4ae2306` - Error handling fixes (63 lines)

**Tests**: 67 new tests (100% passing)
- Bake Mode: 34 tests
- Formatters: 19 tests
- Pipe-Friendly: 14 tests

**Total suite**: 943 passing (was 876 in v0.5.2)

---

### 🚀 Upgrade Instructions

```bash
cd /path/to/specia
git pull origin main
git checkout v0.6.0

# Reinstall (updates CLI)
npm install -g .
```

No breaking changes. All v0.5.2 features continue to work.

---

### 📝 Full Changelog

See: https://gitlab.veritran.net/appsec/specia/-/compare/v0.5.2...v0.6.0

---

## v0.5.2 - CLI-First Redesign (2026-04-17)

### 🎯 Headline Features

**CLI-First Architecture**: SpecIA now defaults to a lightweight bash CLI interface, reducing token consumption by **96%** compared to MCP protocol (20 tokens vs 480 tokens per command). MCP server registration is now opt-in via `--mcp` flag.

**Security Hardening**: Comprehensive input validation layer protects against SQL injection, command injection, path traversal, and YAML RCE attacks across all CLI commands.

**Cross-Platform Skills Migration**: All AI agent clients (Claude Code, GitHub Copilot, OpenCode, VSCode) now teach bash CLI commands instead of MCP tool calls, ensuring consistent token-efficient workflows.

---

### ✨ New Features

#### CLI Discovery & Analytics
- **`specia --list`**: List all available commands with optional search filtering
  ```bash
  specia --list                  # Show all commands
  specia --list --compact        # Space-separated names
  specia --search security       # Filter by keyword
  ```

- **`specia stats [change]`**: Token usage analytics and cost tracking
  ```bash
  specia stats                   # Show usage summary
  specia stats --export json     # Export analytics data
  specia stats --project X       # Filter by project
  ```

#### MCP Opt-In Installation
- Default install: **CLI + Skills only** (no MCP server registration)
- Opt-in: `./install.sh --claude-code --mcp` for advanced users
- Applies to all supported clients: Claude Code, Copilot, OpenCode, VSCode

#### Security Validation Layer
- Input sanitization for 6 critical commands: `propose`, `spec`, `design`, `tasks`, `audit`, `done`
- Protection against:
  - **SQL Injection**: Parameterized queries + input validation
  - **Command Injection**: Shell metacharacter blocking
  - **Path Traversal**: Restricted to `.specia/` directory
  - **YAML RCE**: Safe YAML parsing (no custom tags)
- 20 new security validation tests

---

### 🔄 Breaking Changes

#### Installation Default Changed
**Before v0.5.2**:
```bash
./install.sh --claude-code
# ❌ Automatically registered MCP server
```

**After v0.5.2**:
```bash
./install.sh --claude-code
# ✅ CLI + Skills only (no MCP)

./install.sh --claude-code --mcp
# ✅ CLI + Skills + MCP (opt-in)
```

#### Skills Now Teach CLI Commands
**Before v0.5.2** (MCP protocol):
```markdown
Call specia_review MCP tool with parameters:
{
  "change_name": "my-change",
  "review_result": {...}
}
```

**After v0.5.2** (bash CLI):
```markdown
Run bash command:
specia review my-change --format json
```

**Migration**: Re-run installer to update skills:
```bash
cd /path/to/specia
./install.sh --claude-code  # Updates skills automatically
```

---

### 🐛 Bug Fixes

- **Installer**: Fixed MCP server always being registered regardless of user preference
- **Skills**: Removed outdated MCP tool call examples from all skill files
- **VSCode Agent**: Updated orchestrator instructions to use CLI commands

---

### 📊 Technical Details

#### Token Savings Breakdown
| Interface | Tokens/Command | Example |
|-----------|----------------|---------|
| MCP Protocol | ~480 tokens | `specia_review({"change_name": "my-change", "review_result": {...}})` |
| Bash CLI | ~20 tokens | `specia review my-change --format json` |
| **Savings** | **96%** | **460 tokens saved per command** |

#### Commits Included (v0.5.0 → v0.5.2)
1. `51ed14b` - Implement `--list` and `stats` commands (15 new tests)
2. `9f9afe0` - Migrate VSCode Copilot to CLI-first interface
3. `69fff66` - Make MCP registration opt-in via `--mcp` flag
4. `eadb800` - Migrate all skills to CLI-first approach (8 files)
5. `9a86ed9` - Implement security validation layer
6. `969ed15` - Auto-install Guardian hook on `specia init`
7. `7599b80` - Complete token economics (CLI usage, pricing config)
8. `879f22b` - Add token estimation tracking (MVP)
9. `c208011` - Add SpecIA command skills for Copilot

#### Files Changed
- **13 files** modified/created
- **+467** insertions, **-88** deletions
- **Skills updated**: Claude Code, Copilot, OpenCode, VSCode

#### Test Coverage
- **875 total tests** (15 new for CLI discovery/analytics)
- **97.2% passing** (850/875)
- Security validation: 20 new tests (SQL injection, command injection, path traversal, YAML RCE)

---

### 📖 Documentation Updates

- **README.md**: Added "CLI vs MCP" comparison section
- **Skills**: All 8 skill files updated with CLI command examples
- **VSCode Agent**: `agents/vscode/specia.instructions.md` migrated to CLI-first
- **Spec Archive**: Change `cli-mcp2cli-redesign` archived in `.specia/specs/`

---

### 🔐 Security

This release introduces mandatory security validation:
- **REQ-SEC-001**: SQL injection prevention via parameterized queries + input validation
- **REQ-SEC-002**: Command injection prevention (shell metacharacter blocking)
- **REQ-SEC-003**: Path traversal prevention (restricted to `.specia/` directory)
- **REQ-SEC-004**: YAML RCE prevention (safe parsing, no custom tags)

All abuse cases verified in post-implementation audit (verdict: PARTIAL - acceptable).

---

### 🚀 Upgrade Instructions

#### For Users
```bash
cd /path/to/specia
git pull origin main
git checkout v0.5.2

# Reinstall (updates skills + CLI)
./install.sh --claude-code

# Optional: Enable MCP for advanced use
./install.sh --claude-code --mcp
```

#### For AI Agents
Skills are automatically updated on reinstall. Agents will now use:
```bash
specia review my-change --format json   # Instead of specia_review MCP tool
specia audit my-change --format json    # Instead of specia_audit MCP tool
```

---

### 🙏 Acknowledgments

- **Change Spec**: `cli-mcp2cli-redesign` - comprehensive security review with STRIDE analysis
- **Audit**: Post-implementation verification of 4 requirements + 3 abuse cases
- **Testing**: 15 new tests for CLI discovery and analytics

---

### 📅 Roadmap

#### Deferred to v0.6.0
- `--format json|yaml|text` global flag for all commands
- `./install.sh --update` flag for rebuild + update
- Parallel audit execution (10+ tasks only, opt-in)

---

### 📝 Full Changelog

See: https://gitlab.veritran.net/appsec/specia/-/compare/v0.5.0...v0.5.2

---

### 📞 Support

- **Issues**: https://gitlab.veritran.net/appsec/specia/-/issues
- **Docs**: https://gitlab.veritran.net/appsec/specia/-/blob/main/README.md
- **Specs**: `.specia/specs/` directory (archived changes)

---

## Previous Releases

### v0.5.1
*Release notes not available*

### v0.5.0 - Initial CLI Architecture
- Base CLI implementation with `specia-cli.js` entry point
- MCP server with 13 core tools
- Guardian pre-commit hook (warn mode)
- Mandatory security review and audit gates
- Change management workflow (propose → spec → design → review → tasks → audit → done)
