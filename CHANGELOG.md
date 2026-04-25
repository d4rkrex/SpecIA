# Changelog

All notable changes to SpecIA will be documented in this file.

## [2.1.0] — 2026-04-18

### 🚀 Major Changes

- **Monorepo Restructure** — SpecIA is now a monorepo with two editions:
  - **SpecIA Full** (`full/`) — Complete workflow with MCP server, CLI, 7 workflow phases, dynamic testing, abuse case verification, and compliance-grade audit trails. For release gates, compliance requirements, and high-security features.
  - **SpecIA Lite** (`lite/`) — Lightweight alternative with 2 OpenCode skills (`specia-review-lite`, `specia-audit-lite`), no MCP server, optimized for speed and cost. For PR reviews, quick checks, and early development.
- **Hybrid Setup Support** — Both editions can coexist in the same environment. Use Lite for 80% of features, Full for 20% critical paths → **73% cost savings** vs Full-only.

### ✨ SpecIA Lite Features (NEW)

- **`specia-review-lite` skill** — Quick STRIDE security review focusing on critical/high threats only
  - Token budget: ~3.5k total (~$0.009 per review)
  - Time: ~15 seconds (5x faster than Full)
  - Output: Max 10 threats, max 500 tokens
  - Watermark: `🚀 SpecIA LITE Review | ~15s | ~$0.009 | Critical/High Only`
  - NO abuse cases, NO DREAD scoring, NO audit trail
- **`specia-audit-lite` skill** — Quick static audit verifying spec compliance and security gaps
  - Token budget: ~5.8k total (~$0.020 per audit)
  - Time: ~30 seconds
  - Checks: Test file existence (grep), security gap fixes (grep), spec requirement coverage (basic)
  - Watermark: `🚀 SpecIA LITE Audit | ~30s | ~$0.020 | Static Checks Only`
  - NO test execution, NO build, NO coverage analysis, NO exploit testing
- **Edition Watermarks** — All Lite outputs include clear watermark headers showing time, cost, and scope. Full outputs have YAML frontmatter with `edition: "full"`.
- **Upgrade Path Guidance** — Lite outputs show when to upgrade to Full for compliance/audit needs.
- **3 Real-World Examples** — OAuth login, API rate limiting, file upload security (`lite/examples/EXAMPLES.md`, 13k chars)

### 📚 Documentation

- **`docs/comparison.md`** — Comprehensive 26k+ character comparison of Lite vs Full:
  - Feature matrix with 25+ comparison points
  - Cost analysis: $0.03 vs $0.35 per feature
  - Use case decision tree
  - Hybrid strategy recommendations
  - Edition selection flowchart
- **Monorepo README** — Root README explains edition selection and directs users to `full/` or `lite/`
- **Individual READMEs** — Each edition has its own complete README with installation and usage
- **Installer Scripts** — Separate installers: `lite/install-lite.sh` (multi-platform) and `full/install.sh`

### 🏗️ Architecture Changes

- **Zero Breaking Changes** — SpecIA Full users: all functionality preserved, everything moved to `full/` subdirectory
- **Shared Templates** — `shared/` directory for future cross-edition resources (empty in v2.1.0)
- **Docs Directory** — `docs/` for cross-edition documentation
- **Git Renames** — Git correctly detected file moves (NO deletes+adds), preserving history

### 🧪 Testing

- **SpecIA Lite Tested** — Real-world OAuth spec with deliberately insecure design:
  - Found 5 threats (3 critical, 2 high) including missing PKCE, state parameter validation, token storage issues
  - Time: ~5 seconds (faster than expected 15s target!)
  - Cost: ~$0.009
  - Quality: Excellent — found both explicit and inferred vulnerabilities
- **SpecIA Full** — All 812 tests passing (unchanged from v2.0.0)
- **Hybrid Setup** — Both editions installed simultaneously with no conflicts

### 📦 Installation

```bash
# Install SpecIA Lite (quick setup)
cd lite && ./install-lite.sh

# Install SpecIA Full (complete workflow)
cd full && ./install.sh

# Install both (hybrid setup)
cd lite && ./install-lite.sh && cd ../full && ./install.sh
```

### 💡 When to Use Which Edition

**Use SpecIA Lite when:**
- Reviewing PRs or quick security checks
- Budget-constrained projects
- Prototyping or early development
- Individual developer validation
- Time is critical (<30s total)

**Use SpecIA Full when:**
- Release gates or compliance requirements (SOC 2, PCI-DSS, HIPAA)
- High-security features (auth, payment, PII handling)
- Need audit trail with evidence
- Need dynamic test execution + coverage reports
- Need abuse case testing with exploit scenarios

**Hybrid Strategy (Recommended):**
- 80% of features → Lite ($0.03 each)
- 20% critical features → Full ($0.35 each)
- Result: **73% cost savings** vs Full-only

### 🔗 Migration

No migration needed. Existing SpecIA installations become "SpecIA Full" automatically:
- All files moved to `full/` directory
- Functionality unchanged
- `specia` CLI, MCP server, and all 7 workflow phases work exactly as before

To add SpecIA Lite alongside your existing Full installation:
```bash
cd lite && ./install-lite.sh
```

### 📋 Git

- **Tag**: `v2.1.0` (annotated with full release notes)
- **Commits**: 3 commits on `feat/monorepo-lite` branch, merged to `main`
- **Files Changed**: 199 files, 1786 insertions, 433 deletions

---

## [0.4.1] — 2026-04-13

### Fixed

- **Installer**: Now verifies CLI accessibility after `npm link` and auto-fixes PATH issues
  - Automatically creates symlinks in `~/.local/bin` when the directory exists
  - Provides clear instructions for adding npm global bin to PATH when auto-fix fails
  - Better messaging about MCP server working without CLI for OpenCode/Copilot users
  - Resolves common issue with nvm/fnm where npm global bin is not in PATH

## [0.4.0] — 2026-04-05

### Features

- **Guardian Layer 4: Spec-Aware Validation** — Optional fourth validation layer that verifies committed code actually implements the requirements defined in the spec. Two-phase analysis: Layer 4a (heuristic AST-based keyword matching, ~200ms/file) detects potential violations, Layer 4b (LLM semantic analysis, ~2-5s/file) provides deep verification with 95%+ accuracy. Smart caching ensures typical commits remain <2s.
- **Heuristic Validator Service** — AST-based code element extraction (functions, classes, imports), requirement keyword extraction, evidence scoring, and abuse case pattern detection. Produces confidence scores (0-1) for each requirement.
- **Guardian-Audit Bridge** — Layer 4b leverages the existing audit engine for LLM-based validation. Reuses audit prompt builder, structured verdict parser, and cache infrastructure for DRY architecture.
- **Dual Layer 4 Cache** — Separate caches for L4a (`l4a-{hash}.json`) and L4b (`l4b-{hash}.json`) with configurable TTL (default: 7 days). Cache invalidation on file or spec content change.
- **Spec Cache Service** — Persistent cache storage in `.specia/.spec-cache/` with atomic writes, TTL-based expiration, and cache key computation from content hashes.
- **Enhanced Hook Management** — `specia hook install --spec-aware` flag enables Layer 4. `specia hook status` reports Layer 4 enabled/disabled state and cache statistics (L4a/L4b entry counts).
- **Spec Violation Error Formatting** — User-friendly error messages with flagged requirements, evidence, abuse case risks, and actionable remediation steps. Written to `.specia/guardian-last.json` for debugging.
- **MCP Tool Updates** — `specia_hook_install` accepts `spec_validation` config block to enable/configure Layer 4. `specia_hook_status` returns Layer 4 status and cache stats.

### Improvements

- **Guardian Runner** — Async validation pipeline for Layer 4, detailed spec violation output in commit messages, verbose logging for cache hit/miss and execution times (when enabled).
- **Configuration Schema** — New `guardian.spec_validation` config block with options: `enabled`, `enable_llm`, `llm_provider`, `llm_model`, `llm_budget`, `cache_ttl`, `heuristic_threshold`.
- **Graceful LLM Degradation** — Layer 4b falls back to Layer 4a-only when LLM API key is missing or LLM service is unavailable. No commit blocking on LLM failures.
- **Performance Benchmarks** — Benchmark suite validates <2s commit target for typical workloads and measures cache speedup (2-5x faster on cache hits).

### Documentation

- **docs/guardian-spec-aware.md** — Complete Layer 4 documentation: how it works, enabling Layer 4, configuration options, interpreting results, performance characteristics, troubleshooting, best practices, limitations.
- **README.md** — Guardian Layer 4 section with quick-start instructions and link to full docs.
- **CHANGELOG.md** — v0.4.0 release notes.

### Testing

- **820+ total tests** across 42 test files, all passing
- New test suites: Guardian Layer 4 integration tests (4 tests), Layer 4 benchmarks (2 tests)
- Integration tests cover: E2E validation pipeline, cache hit/miss behavior, graceful LLM degradation
- Benchmarks verify <2s commit target and cache performance boost

### Bug Fixes

- None — v0.4.0 is a feature release with zero regressions.

## [0.3.0] — 2026-04-05

### Features

- **`/spec-audit` Post-Implementation Code Audit** — New optional phase that verifies implemented code satisfies spec requirements and addresses security abuse cases from the review. Reads actual code files, compares against the spec, and produces a structured audit report with per-requirement verdicts and per-abuse-case verification results.
- **`specia_audit` MCP Tool** — Two-phase MCP tool (#15). Phase 1 discovers code files, reads specs and abuse cases, and returns a posture-driven audit prompt. Phase 2 validates the LLM's structured analysis, writes `audit.md`, and updates `state.yaml`.
- **`specia audit` CLI Command** — CLI command with `--manual` (default), `--api`, `--force`, `--files`, `--posture`, `--base-branch`, and `--result` options. Supports stdin piping for Phase 2 submission.
- **Abuse Case Verification in Audit Reports** — Each abuse case from the security review is verified against the actual code with verdicts: `verified`, `unverified`, `partial`, `not_applicable`.
- **Audit Staleness Detection** — Smart caching via SHA256 `audit_hash`. If code changes after an audit, the audit is marked stale. `specia_done` warns about stale or missing audits.
- **Three Posture-Driven Audit Prompts** — Standard (verify requirements + top abuse cases), elevated (all abuse cases + OWASP patterns), paranoid (data flow tracing + DREAD scoring + test coverage analysis).
- **Agent Prompt File** — `agents/claude-code/agents/specia-audit.md` for sub-agent delegation of audit phase.

### Improvements

- **`specia_continue`** now suggests `specia_audit` as optional step after tasks phase (with `optional: true`). After audit, suggests `specia_done`.
- **`specia_done`** accepts changes in either "tasks" or "audit" phase for archival. Includes audit frontmatter (`audit_verdict`, `audit_timestamp`, `audit_hash`, coverage counts) in archived specs. Warns when audit is skipped or stale.
- **`specia_ff`** message mentions `specia_audit` availability after completing all phases.
- **State machine** extended: `Phase` type includes "audit", `ChangeState` includes `audit_hash`, `audit_posture`, `audit_stale`.
- **LLM Client** `LlmPrompt` shared interface enables both `review()` and `audit()` via `sendPrompt()` DRY pattern.
- **Version bump** 0.2.1 → 0.3.0.

### Bug Fixes

- None — all 6 implementation phases had zero regressions.

### Testing

- **715 total tests** across 36 test files, all passing
- New test suites: audit engine unit tests (130+ tests), audit tool handler tests (17 tests), audit CLI tests (13 tests), audit integration flow tests (18 tests)
- Integration tests cover: full audit → done → archive flow, audit skip backward compatibility, cache hit/miss, staleness warning, cross-feature regressions, multiple concurrent changes

## [0.2.1] — 2026-04-05

### Features

- **Abuse Cases in Security Review** — Attacker-centric scenario analysis integrated into the security review phase. Abuse cases document attacker goals, attack vectors, preconditions, impact, and mitigations. Analysis depth scales with the project's security posture: `standard` (top abuse cases), `elevated` (comprehensive abuse cases with OWASP mapping), `paranoid` (full abuse case matrix with DREAD scoring). Abuse cases render in review.md and feed into task generation as security mitigations.
- **Orchestrator Agent Configs** — Ready-to-use agent configurations for 4 AI clients: OpenCode (JSON config + 6 slash commands), Claude Code (CLAUDE.md section + 5 sub-agent files), GitHub Copilot CLI (6 agent.md files with frontmatter), and VS Code Copilot Chat (instructions.md). All configs follow the same coordinator/sub-agent delegation pattern. A portable generic prompt is included for any MCP-compatible agent.
- **6 OpenCode Slash Commands** — `/specia-init`, `/specia-new`, `/specia-continue`, `/specia-ff`, `/specia-review`, `/specia-status` — all routed through the specia workflow coordinator agent.
- **Sub-Agent Delegation Pattern** — Orchestrator agents coordinate the workflow DAG without executing phases inline. Each phase (propose, spec, design, review, tasks) delegates to a focused sub-agent with its own context. This prevents context bloat in long sessions.

### Improvements

- **install.sh auto-detection** — Installer now detects which AI clients are installed and configures SpecIA for each. Supports `--opencode`, `--claude-code`, `--copilot`, `--vscode` flags, or auto-detect all.
- **install.sh multi-client support** — Single install command configures multiple clients simultaneously. Agent config files are copied to each client's expected location.
- **`agents/` directory included in package** — `package.json` `files` array now includes `agents/` so configs ship with the package.

### Bug Fixes

- **OpenCode config filename** — Fixed the expected config filename for OpenCode agent setup in install scripts.

### Testing

- **497 total tests** across 31 test files, all passing (18 new tests for abuse cases: type validation, prompt integration, review rendering, task template rendering)

## [0.2.0] — 2026-04-04

### Features

- **Design Phase** (`specia_design`) — Optional architecture design step in the workflow DAG. Captures technical approach, architecture decisions (ADR-lite), and component design before security review. The design document feeds into both the review prompt and task generation for richer context. Design is optional: agents can skip directly from spec to review.
- **Guardian Pre-Commit Hook** — Spec-aware pre-commit validation engine. Three-layer validation: (1) spec coverage — staged files must be covered by a SpecIA change, (2) review completeness — the security review must be done and not stale, (3) mitigation compliance — security mitigations in tasks.md must be checked off. Supports `strict` (block commit) and `warn` (allow with warnings) modes. Includes exclude patterns, result caching, and `specia hook install/uninstall/status` management.
- **Orchestrator Skill** — Agent skill file for delegation patterns during long sessions. Teaches agents to break SpecIA work into sub-agent tasks following the workflow DAG, preventing context bloat in long coding sessions.
- **CLI Standalone** (`specia` command) — 14 CLI commands wrapping all SpecIA functionality for terminal use. Dual security review modes: `--manual` (generate prompt, review externally, submit result) and `--api` (send to Anthropic/OpenAI for automated review). Includes `specia init`, `propose`, `spec`, `design`, `review`, `tasks`, `done`, `status`, `search`, `hook install/uninstall/status`, and `config show`.
- **4 New MCP Tools** — `specia_design` (save architecture design), `specia_guardian_status` (check validation status), `specia_guardian_validate` (run validation on files), `specia_hook` (manage pre-commit hook)

### Improvements

- **Updated workflow DAG** — `propose → spec → [design] → review → tasks → done` (design is optional)
- **`specia_continue`** now suggests `specia_design` as optional step after spec, and includes `next_tool: "specia_done"` when all phases are complete
- **`specia_ff`** handles the design phase in fast-forward mode, skipping it when review is already done
- **Review prompt enrichment** — Design document content is included in the review prompt when present
- **Task generation enrichment** — Design decisions are included as reference in tasks.md when design exists
- **State tracking** — `state.yaml` now tracks `design_hash` and `review_posture`
- **Config schema** — Added `guardian` and `cli` configuration sections to config.yaml

### Bug Fixes

- Fixed hash mismatch in GuardianService — `hashContent()` now uses `computeSpecHash()` (same normalization as the review system) to prevent false-positive stale detection
- Fixed `specia_ff` blocking at design step when review was already complete
- Fixed `specia_continue` returning no `next_tool` when all phases were complete
- Fixed CLI commands hanging on stdin read in non-TTY environments when no input flag provided
- Fixed Guardian validation failing on fully-complete workflows due to unchecked mitigation items in generated tasks

### Testing

- **479 total tests** across 31 test files, all passing
- New test suites: CLI commands (20 tests), CLI output (26 tests), CLI status (7 tests), CLI hook management (14 tests), LLM client (6 tests), CLI init (8 tests), design flow integration (8 tests), Guardian validation integration (9 tests), cross-feature integration (11 tests)
- Guardian phase 3+4 tests (60 tests) covering all three validation layers, caching, glob matching, scope extraction

## [0.1.0] — 2026-04-04

Initial release of SpecIA: a security-aware spec-driven development MCP server.

### Features

- **MCP Server** — TypeScript server over JSON-RPC 2.0 stdio transport, compatible with Claude Code, OpenCode, and any MCP-compatible AI agent
- **6 Core Tools** — `specia_init`, `specia_propose`, `specia_spec`, `specia_review`, `specia_tasks`, `specia_done`
- **3 Shortcut Tools** — `specia_new` (alias for propose), `specia_continue` (resume next phase), `specia_ff` (fast-forward all phases)
- **1 Search Tool** — `specia_search` for querying archived specs and past security findings
- **Mandatory Security Review** — Hard gate: `specia_tasks` refuses to run without a valid, non-stale security review. No skip flag exists.
- **Three Security Postures** — `standard` (STRIDE light), `elevated` (STRIDE + OWASP Top 10), `paranoid` (STRIDE + OWASP + DREAD scoring)
- **Smart Caching** — SHA256 content hashing prevents redundant re-reviews when spec hasn't changed
- **Two-Phase Review Protocol** — Phase 1 returns a calibrated review prompt; Phase 2 accepts the agent's structured analysis
- **Atomic File Writes** — All writes go through temp file + rename to prevent corruption
- **Phase DAG Enforcement** — Each tool checks `state.yaml` to enforce workflow order (propose → spec → review → tasks → done)
- **Stack Auto-Detection** — Detects project stack from package.json, Cargo.toml, go.mod, requirements.txt, etc.
- **Alejandria Integration** — Optional MCP-to-MCP client for persistent memory across sessions (graceful degradation when unavailable)
- **Agent Skill Files** — Ready-to-use skill files for Claude Code, OpenCode, and generic MCP agents
- **Installer Scripts** — `install.sh` (macOS/Linux) and `install.ps1` (Windows) for automated setup
- **Structured JSON Responses** — Every tool returns a typed envelope with status, data, errors, warnings, and meta

### Architecture

- File-first: `.specia/` directory is the source of truth
- Layered modules: tools → services → file store
- Zod validation on all tool inputs and config reads
- MemoryClient singleton with config-change detection and auto-reconnect
- 19 test files, 235 tests covering all tools and services

### Known Limitations

- **No interactive prompts** — SpecIA is designed for AI agents, not human CLI use
- **Single-project scope** — One `.specia/` per project root; no monorepo workspace support yet
- **Local file search only** — `specia_search` falls back to basic file search when Alejandria is unavailable; no built-in FTS
- **No concurrent change locking** — Multiple agents editing the same change simultaneously may conflict
- **Review quality depends on agent** — The review is performed by the calling agent; SpecIA provides the protocol and prompt, not the analysis itself
