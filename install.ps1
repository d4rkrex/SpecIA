# SpecIA Installer (PowerShell) — run from inside the cloned repo
#   git clone https://gitlab.veritran.net/appsec/specia; cd specia; .\install.ps1
$ErrorActionPreference = "Stop"

# ── Helpers ───────────────────────────────────────────────────────────
function Write-Info  { param($msg) Write-Host "[info] " -ForegroundColor Blue -NoNewline; Write-Host $msg }
function Write-Ok    { param($msg) Write-Host "  ✓ " -ForegroundColor Green -NoNewline; Write-Host $msg }
function Write-Warn  { param($msg) Write-Host "[warn] " -ForegroundColor Yellow -NoNewline; Write-Host $msg }
function Write-Err   { param($msg) Write-Host "[error] " -ForegroundColor Red -NoNewline; Write-Host $msg }

$RepoDir = $PSScriptRoot
$McpBin  = Join-Path $RepoDir "bin\specia-mcp.js"
$Configured = @()
$Skipped    = @()

Write-Host ""
Write-Host "====================================================" -ForegroundColor Blue
Write-Host "  SpecIA — Security-Aware Spec-Driven Development  " -ForegroundColor Blue
Write-Host "  MCP Server Installer                               " -ForegroundColor Blue
Write-Host "====================================================" -ForegroundColor Blue
Write-Host ""

# ── 1. Validate repo ─────────────────────────────────────────────────
$pkgJson = Join-Path $RepoDir "package.json"
if (-not (Test-Path $pkgJson) -or -not ((Get-Content $pkgJson -Raw) -match '"@appsec/specia"')) {
    Write-Err "Not a SpecIA repo. Clone it first:"
    Write-Err "  git clone https://gitlab.veritran.net/appsec/specia; cd specia; .\install.ps1"
    exit 1
}

# Check Node.js 20+
try { $nodeV = & node -v 2>$null } catch { Write-Err "Node.js not found. Install 20+: https://nodejs.org"; exit 1 }
$major = [int]($nodeV -replace 'v(\d+)\..*', '$1')
if ($major -lt 20) { Write-Err "Node.js 20+ required (found $nodeV)"; exit 1 }
Write-Ok "Node.js $nodeV"

# ── 2. Build & link ──────────────────────────────────────────────────
Write-Info "Installing dependencies..."
Push-Location $RepoDir
try {
    & npm install
    Write-Info "Building..."
    & npm run build
    Write-Info "Linking globally..."
    & npm link
} finally { Pop-Location }
Write-Ok "specia and specia-mcp linked"

# ── Helper: ensure dir exists ─────────────────────────────────────────
function Ensure-Dir { param($p) if (-not (Test-Path $p)) { New-Item -ItemType Directory -Path $p -Force | Out-Null } }

# ── 3. Auto-detect & configure clients ───────────────────────────────

# ── OpenCode ──
$OpenCodeDir = if ($env:XDG_CONFIG_HOME) { Join-Path $env:XDG_CONFIG_HOME "opencode" } else { Join-Path $env:USERPROFILE ".config\opencode" }
if (Test-Path $OpenCodeDir) {
    Write-Info "Configuring OpenCode..."
    $cfg = Join-Path $OpenCodeDir "opencode.json"

    if (Test-Path $cfg) {
        $c = Get-Content $cfg -Raw | ConvertFrom-Json
        if (-not $c.mcp) { $c | Add-Member -NotePropertyName "mcp" -NotePropertyValue @{} -Force }
        $c.mcp | Add-Member -NotePropertyName "specia" -NotePropertyValue @{ command = @("node", $McpBin); enabled = $true; type = "local" } -Force

        # Merge agent overlay
        $orch = Join-Path $RepoDir "agents\opencode\specia.json"
        if (Test-Path $orch) {
            $o = Get-Content $orch -Raw | ConvertFrom-Json
            if (-not $c.agent) { $c | Add-Member -NotePropertyName "agent" -NotePropertyValue @{} -Force }
            foreach ($k in $o.agent.PSObject.Properties.Name) { $c.agent | Add-Member -NotePropertyName $k -NotePropertyValue $o.agent.$k -Force }
        }
        $c | ConvertTo-Json -Depth 20 | Set-Content $cfg -Encoding UTF8
    }

    # Slash commands
    Ensure-Dir (Join-Path $OpenCodeDir "commands")
    Copy-Item (Join-Path $RepoDir "agents\opencode\commands\*.md") (Join-Path $OpenCodeDir "commands") -Force -ErrorAction SilentlyContinue

    # Skill
    $skillDir = Join-Path $OpenCodeDir "skills\specia"
    Ensure-Dir $skillDir
    $src = Join-Path $RepoDir "skills\opencode\specia.md"
    if (Test-Path $src) { Copy-Item $src (Join-Path $skillDir "SKILL.md") -Force }

    Write-Ok "OpenCode (MCP + agents + commands + skill)"
    $Configured += "OpenCode"
} else { $Skipped += "OpenCode (~/.config/opencode/ not found)" }

# ── Claude Code ──
$ClaudeDir = Join-Path $env:USERPROFILE ".claude"
if (Test-Path $ClaudeDir) {
    Write-Info "Configuring Claude Code..."
    $settings = Join-Path $ClaudeDir "settings.json"

    if (Test-Path $settings) {
        $c = Get-Content $settings -Raw | ConvertFrom-Json
        if (-not $c.mcpServers) { $c | Add-Member -NotePropertyName "mcpServers" -NotePropertyValue @{} -Force }
        $c.mcpServers | Add-Member -NotePropertyName "specia" -NotePropertyValue @{ command = "node"; args = @($McpBin) } -Force
        $c | ConvertTo-Json -Depth 20 | Set-Content $settings -Encoding UTF8
    }

    # CLAUDE.md section
    $sectionFile = Join-Path $RepoDir "agents\claude-code\CLAUDE.md.section"
    $claudeMd = Join-Path $ClaudeDir "CLAUDE.md"
    if (Test-Path $sectionFile) {
        $sec = Get-Content $sectionFile -Raw
        if ((Test-Path $claudeMd) -and ((Get-Content $claudeMd -Raw) -match '<!-- BEGIN:specia -->')) {
            $md = Get-Content $claudeMd -Raw
            $md = $md -replace '(?s)<!-- BEGIN:specia -->.*?<!-- END:specia -->', $sec.Trim()
            Set-Content $claudeMd $md -Encoding UTF8
        } elseif (Test-Path $claudeMd) {
            Add-Content $claudeMd "`n$sec" -Encoding UTF8
        } else {
            Set-Content $claudeMd $sec -Encoding UTF8
        }
    }

    # Sub-agents + skill
    $skillDir = Join-Path $ClaudeDir "skills\specia"
    Ensure-Dir $skillDir
    Copy-Item (Join-Path $RepoDir "agents\claude-code\agents\*.md") $skillDir -Force -ErrorAction SilentlyContinue
    $src = Join-Path $RepoDir "skills\claude-code\SPECIA.md"
    if (Test-Path $src) { Copy-Item $src (Join-Path $skillDir "SKILL.md") -Force }

    Write-Ok "Claude Code (MCP + CLAUDE.md + sub-agents + skill)"
    $Configured += "Claude Code"
} else { $Skipped += "Claude Code (~/.claude/ not found)" }

# ── Copilot CLI ──
$CopilotDir = Join-Path $env:USERPROFILE ".copilot"
if (Test-Path $CopilotDir) {
    Write-Info "Configuring Copilot CLI..."
    Ensure-Dir (Join-Path $CopilotDir "agents")
    Copy-Item (Join-Path $RepoDir "agents\copilot\*.agent.md") (Join-Path $CopilotDir "agents") -Force -ErrorAction SilentlyContinue
    Write-Ok "Copilot CLI (agents)"
    $Configured += "Copilot CLI"
} else { $Skipped += "Copilot CLI (~/.copilot/ not found)" }

# ── VS Code Copilot ──
$VsCodeDir = Join-Path $env:APPDATA "Code\User"
if (Test-Path $VsCodeDir) {
    Write-Info "Configuring VS Code Copilot..."
    $mcpJson = Join-Path $VsCodeDir "mcp.json"

    if (Test-Path $mcpJson) {
        $c = Get-Content $mcpJson -Raw | ConvertFrom-Json
        if (-not $c.servers) { $c | Add-Member -NotePropertyName "servers" -NotePropertyValue @{} -Force }
        $c.servers | Add-Member -NotePropertyName "specia" -NotePropertyValue @{ command = "node"; args = @($McpBin) } -Force
        $c | ConvertTo-Json -Depth 20 | Set-Content $mcpJson -Encoding UTF8
    } else {
        @{ servers = @{ specia = @{ command = "node"; args = @($McpBin) } } } | ConvertTo-Json -Depth 10 | Set-Content $mcpJson -Encoding UTF8
    }

    Ensure-Dir (Join-Path $VsCodeDir "prompts")
    $src = Join-Path $RepoDir "agents\vscode\specia.instructions.md"
    if (Test-Path $src) { Copy-Item $src (Join-Path $VsCodeDir "prompts\specia.instructions.md") -Force }

    Write-Ok "VS Code Copilot (MCP + instructions)"
    $Configured += "VS Code Copilot"
} else { $Skipped += "VS Code Copilot (Code\User not found)" }

# ── 4. Summary ────────────────────────────────────────────────────────
Write-Host ""
Write-Ok "Installation complete!"
Write-Host ""
if ($Configured.Count -gt 0) {
    Write-Info "Configured:"
    $Configured | ForEach-Object { Write-Host "  - $_" }
}
if ($Skipped.Count -gt 0) {
    Write-Info "Skipped:"
    $Skipped | ForEach-Object { Write-Host "  - $_" }
}
Write-Host ""
Write-Info "Next: restart your AI agent and say 'Initialize SpecIA' in any project."
