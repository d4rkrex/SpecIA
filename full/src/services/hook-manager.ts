/**
 * HookManager — Guardian pre-commit hook installation and management.
 *
 * Uses marker blocks for coexistence with other hooks (husky, lint-staged, etc.).
 * Idempotent — safe to run install multiple times.
 *
 * Marker format:
 *   # VT-SPEC GUARDIAN START — managed by specia, do not edit
 *   ... guardian hook code ...
 *   # VT-SPEC GUARDIAN END
 *
 * v0.2: Design Decision 15 (Hook Management)
 * v0.5: Token optimization — Guardian integrity verification (SHA-256 + HMAC)
 *       Mitigations: S-01, T-03, AC-001, R-01, D-01, AC-003
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import * as os from "node:os";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as YAML from "yaml";
import type { GuardianMode } from "../types/index.js";

// ── Public interfaces ────────────────────────────────────────────────

export interface InstallResult {
  installed: boolean;
  hook_path: string;
  mode: GuardianMode;
  coexisting_hooks: boolean;
  /** v0.5: SHA-256 integrity hash of installed hook. */
  integrity_hash?: string;
}

export interface UninstallResult {
  uninstalled: boolean;
  hook_path: string;
  had_other_hooks: boolean;
}

export interface HookStatus {
  installed: boolean;
  mode?: GuardianMode;
  hook_path?: string;
  git_repo: boolean;
  /** v0.4: Layer 4 status. */
  layer4_enabled?: boolean;
  layer4_cache_stats?: {
    l4a_entries: number;
    l4b_entries: number;
  };
  /** v0.5: Integrity verification status. */
  integrity_status?: "valid" | "tampered" | "missing_baseline" | "error";
}

/** v0.5: Integrity data stored in .specia/.guardian-integrity */
export interface GuardianIntegrity {
  hash: string;
  hmac: string;
  timestamp: string;
  specia_version: string;
  hook_path: string;
}

/** v0.5: Audit log entry for Guardian operations */
export interface GuardianAuditEntry {
  timestamp: string;
  event: "install" | "reinstall" | "tamper_detected" | "integrity_check" | "force_rehash";
  hash?: string;
  expected_hash?: string;
  mode?: string;
  user?: string;
  details?: string;
}

// ── Constants ────────────────────────────────────────────────────────

const MARKER_START = "# VT-SPEC GUARDIAN START — managed by specia, do not edit";
const MARKER_END = "# VT-SPEC GUARDIAN END";

const SHEBANG = "#!/bin/sh";

/** v0.5: Current specia version for integrity metadata */
const SPECIA_VERSION = "0.5.0";

// ── Service ──────────────────────────────────────────────────────────

export class HookManager {
  private readonly gitDir: string | null;
  private readonly hookPath: string | null;
  private readonly speciaDir: string;
  private readonly integrityPath: string;
  private readonly auditLogPath: string;

  constructor(private readonly rootDir: string) {
    this.gitDir = this.findGitDir();
    this.hookPath = this.gitDir
      ? path.join(this.gitDir, "hooks", "pre-commit")
      : null;
    this.speciaDir = path.join(rootDir, ".specia");
    this.integrityPath = path.join(this.speciaDir, ".guardian-integrity");
    this.auditLogPath = path.join(this.speciaDir, ".guardian-audit-log");
  }

  // ── Install ─────────────────────────────────────────────────────────

  /**
   * Install the Guardian pre-commit hook using marker blocks.
   * Idempotent — if already installed, updates the mode.
   */
  installHook(mode: GuardianMode = "warn"): InstallResult {
    if (!this.gitDir || !this.hookPath) {
      throw new Error("Not a git repository. Run 'git init' first.");
    }

    // Ensure hooks directory exists
    const hooksDir = path.dirname(this.hookPath);
    fs.mkdirSync(hooksDir, { recursive: true });

    // Read existing hook content (if any)
    let existingContent = "";
    if (fs.existsSync(this.hookPath)) {
      existingContent = fs.readFileSync(this.hookPath, "utf-8");
    }

    // Remove old marker block if present (idempotent update)
    const cleanedContent = this.removeMarkerBlock(existingContent);

    // Determine if there are other hooks
    const hasOtherContent = cleanedContent.replace(SHEBANG, "").trim().length > 0;

    // Resolve runner path from this file's location — works for global and local installs
    const thisFile = fileURLToPath(import.meta.url);
    const runnerPath = path.resolve(path.dirname(thisFile), "../guardian/runner.js");

    // Build guardian block
    const guardianBlock = this.buildGuardianBlock(mode, runnerPath);

    // Assemble final hook
    let finalContent: string;
    if (cleanedContent.startsWith(SHEBANG)) {
      // Existing shebang — append after existing content
      finalContent = cleanedContent.trimEnd() + "\n\n" + guardianBlock + "\n";
    } else if (cleanedContent.trim().length === 0) {
      // Empty file — add shebang
      finalContent = SHEBANG + "\n\n" + guardianBlock + "\n";
    } else {
      // Has content but no shebang — add shebang at top
      finalContent = SHEBANG + "\n\n" + cleanedContent.trimEnd() + "\n\n" + guardianBlock + "\n";
    }

    // Write hook
    fs.writeFileSync(this.hookPath, finalContent, { mode: 0o755 });

    // v0.5: Compute and store integrity hash (S-01, T-03, AC-001)
    const integrityHash = this.computeAndStoreIntegrity(finalContent, mode);

    return {
      installed: true,
      hook_path: this.hookPath,
      mode,
      coexisting_hooks: hasOtherContent,
      integrity_hash: integrityHash,
    };
  }

  // ── Uninstall ───────────────────────────────────────────────────────

  /**
   * Remove the Guardian marker block from the pre-commit hook.
   * Preserves other hooks. If only our block existed, removes the file.
   */
  uninstallHook(): UninstallResult {
    if (!this.hookPath) {
      return {
        uninstalled: false,
        hook_path: "",
        had_other_hooks: false,
      };
    }

    if (!fs.existsSync(this.hookPath)) {
      return {
        uninstalled: true, // Already uninstalled
        hook_path: this.hookPath,
        had_other_hooks: false,
      };
    }

    const existingContent = fs.readFileSync(this.hookPath, "utf-8");
    const cleanedContent = this.removeMarkerBlock(existingContent);
    const remainingContent = cleanedContent.replace(SHEBANG, "").trim();

    if (remainingContent.length === 0) {
      // Only our hook existed — remove the file
      fs.unlinkSync(this.hookPath);
      return {
        uninstalled: true,
        hook_path: this.hookPath,
        had_other_hooks: false,
      };
    }

    // Other hooks exist — write back without our block
    fs.writeFileSync(this.hookPath, cleanedContent, { mode: 0o755 });

    return {
      uninstalled: true,
      hook_path: this.hookPath,
      had_other_hooks: true,
    };
  }

  // ── Status ──────────────────────────────────────────────────────────

  /**
   * Check if the Guardian hook is installed and return its status.
   * v0.4: Optionally include Layer 4 cache stats from .specia/.spec-cache.
   */
  getHookStatus(): HookStatus {
    if (!this.gitDir) {
      return { installed: false, git_repo: false };
    }

    if (!this.hookPath || !fs.existsSync(this.hookPath)) {
      return { installed: false, git_repo: true };
    }

    const content = fs.readFileSync(this.hookPath, "utf-8");
    const hasMarker = content.includes(MARKER_START) && content.includes(MARKER_END);

    if (!hasMarker) {
      return {
        installed: false,
        hook_path: this.hookPath,
        git_repo: true,
      };
    }

    // Extract mode from the marker block
    const mode = this.extractModeFromBlock(content);

    // v0.4: Check Layer 4 status and cache stats
    const layer4Status = this.getLayer4Status();

    // v0.5: Check integrity status
    const integrityStatus = this.verifyIntegrity();

    return {
      installed: true,
      mode,
      hook_path: this.hookPath,
      git_repo: true,
      ...layer4Status,
      integrity_status: integrityStatus.status,
    };
  }

  // ── Private helpers ─────────────────────────────────────────────────

  private findGitDir(): string | null {
    try {
      const result = execSync("git rev-parse --git-dir", {
        cwd: this.rootDir,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();

      // result could be relative (e.g., ".git") or absolute
      if (path.isAbsolute(result)) {
        return result;
      }
      return path.join(this.rootDir, result);
    } catch {
      return null;
    }
  }

  private buildGuardianBlock(mode: GuardianMode, runnerPath: string): string {
    const lines: string[] = [];
    lines.push(MARKER_START);
    lines.push(`SPECIA_ROOT="$(git rev-parse --show-toplevel)"`);
    lines.push(`SPECIA_GUARDIAN_MODE="${mode}"`);
    lines.push(`SPECIA_RUNNER="${runnerPath}"`);
    // v0.5: Integrity self-check before validation (T-01: read once, hash once)
    lines.push(`SPECIA_INTEGRITY_FILE="$SPECIA_ROOT/.specia/.guardian-integrity"`);
    lines.push(`if [ -f "$SPECIA_INTEGRITY_FILE" ] && command -v sha256sum >/dev/null 2>&1; then`);
    lines.push(`  SPECIA_HOOK_SELF="$0"`);
    lines.push(`  SPECIA_CURRENT_HASH=$(sha256sum "$SPECIA_HOOK_SELF" | cut -d' ' -f1)`);
    lines.push(`  SPECIA_STORED_HASH=$(grep -o '"hash":"[^"]*"' "$SPECIA_INTEGRITY_FILE" | head -1 | cut -d'"' -f4)`);
    lines.push(`  if [ -n "$SPECIA_STORED_HASH" ] && [ "$SPECIA_CURRENT_HASH" != "$SPECIA_STORED_HASH" ]; then`);
    lines.push(`    echo "⚠ SpecIA Guardian: Hook integrity check FAILED — possible tampering detected." >&2`);
    lines.push(`    echo "  Expected: $SPECIA_STORED_HASH" >&2`);
    lines.push(`    echo "  Got:      $SPECIA_CURRENT_HASH" >&2`);
    lines.push(`    echo "  Run 'specia hook install' to regenerate integrity baseline." >&2`);
    lines.push(`    if [ "$SPECIA_GUARDIAN_MODE" = "strict" ]; then`);
    lines.push(`      echo "  Strict mode: commit BLOCKED due to integrity failure." >&2`);
    lines.push(`      exit 1`);
    lines.push(`    fi`);
    lines.push(`  fi`);
    lines.push(`elif [ ! -f "$SPECIA_INTEGRITY_FILE" ]; then`);
    lines.push(`  echo "⚠ SpecIA Guardian: No integrity baseline found. Run 'specia hook install' to create one." >&2`);
    lines.push(`fi`);
    lines.push(`if [ -f "$SPECIA_RUNNER" ] && command -v node >/dev/null 2>&1; then`);
    lines.push(`  node "$SPECIA_RUNNER" \\`);
    lines.push(`    --root "$SPECIA_ROOT" \\`);
    lines.push(`    --mode "$SPECIA_GUARDIAN_MODE"`);
    lines.push(`  GUARDIAN_EXIT=$?`);
    lines.push(`  if [ "$SPECIA_GUARDIAN_MODE" = "strict" ] && [ $GUARDIAN_EXIT -ne 0 ]; then`);
    lines.push(`    echo "SpecIA Guardian: commit blocked. Fix violations above or use --no-verify."`);
    lines.push(`    exit 1`);
    lines.push(`  fi`);
    lines.push(`elif [ ! -f "$SPECIA_RUNNER" ]; then`);
    lines.push(`  echo "⚠ SpecIA Guardian: runner not found at $SPECIA_RUNNER. Re-run 'specia hook install'." >&2`);
    lines.push(`fi`);
    lines.push(MARKER_END);
    return lines.join("\n");
  }

  private removeMarkerBlock(content: string): string {
    const startIdx = content.indexOf(MARKER_START);
    const endIdx = content.indexOf(MARKER_END);

    if (startIdx === -1 || endIdx === -1) return content;

    const before = content.substring(0, startIdx);
    const after = content.substring(endIdx + MARKER_END.length);

    // Clean up extra blank lines
    return (before + after).replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
  }

  private extractModeFromBlock(content: string): GuardianMode {
    const match = content.match(/SPECIA_GUARDIAN_MODE="(strict|warn)"/);
    return (match?.[1] as GuardianMode) ?? "warn";
  }

  /**
   * v0.4: Check if Layer 4 is enabled and read cache stats.
   */
  private getLayer4Status(): {
    layer4_enabled?: boolean;
    layer4_cache_stats?: { l4a_entries: number; l4b_entries: number };
  } {
    try {
      const configPath = path.join(this.rootDir, ".specia", "config.yaml");
      if (!fs.existsSync(configPath)) return {};

      const configContent = fs.readFileSync(configPath, "utf-8");
      const config = YAML.parse(configContent);

      const layer4Enabled =
        config?.guardian?.spec_validation?.enabled === true;

      if (!layer4Enabled) {
        return { layer4_enabled: false };
      }

      // Read cache stats
      const cachePath = path.join(
        this.rootDir,
        ".specia",
        ".spec-cache",
      );
      let l4aEntries = 0;
      let l4bEntries = 0;

      if (fs.existsSync(cachePath)) {
        const cacheFiles = fs.readdirSync(cachePath);
        l4aEntries = cacheFiles.filter((f) =>
          f.startsWith("l4a-"),
        ).length;
        l4bEntries = cacheFiles.filter((f) =>
          f.startsWith("l4b-"),
        ).length;
      }

      return {
        layer4_enabled: true,
        layer4_cache_stats: { l4a_entries: l4aEntries, l4b_entries: l4bEntries },
      };
    } catch {
      return {}; // Non-fatal
    }
  }

  // ── Integrity verification (v0.5) ───────────────────────────────────

  /**
   * Compute SHA-256 hash and HMAC of hook content, store in .specia/.guardian-integrity.
   * Also writes an append-only audit log entry (AC-001, R-01).
   *
   * HMAC uses a machine-derived key (hostname + project path) as secondary integrity
   * signal so an attacker can't just copy hash+hook from another machine (S-01).
   */
  private computeAndStoreIntegrity(hookContent: string, mode: GuardianMode): string {
    const hash = crypto.createHash("sha256").update(hookContent).digest("hex");
    const hmacKey = this.deriveMachineKey();
    const hmac = crypto.createHmac("sha256", hmacKey).update(hookContent).digest("hex");

    const integrity: GuardianIntegrity = {
      hash,
      hmac,
      timestamp: new Date().toISOString(),
      specia_version: SPECIA_VERSION,
      hook_path: this.hookPath!,
    };

    // Ensure .specia directory exists
    fs.mkdirSync(this.speciaDir, { recursive: true });

    // Check BEFORE writing — detect reinstall vs fresh install (ordering fix)
    const isReinstall = fs.existsSync(this.integrityPath);

    // Write integrity file (overwrite on reinstall — spec scenario "hash updated on reinstall")
    fs.writeFileSync(this.integrityPath, JSON.stringify(integrity, null, 2), "utf-8");
    this.appendAuditLog({
      timestamp: integrity.timestamp,
      event: isReinstall ? "reinstall" : "install",
      hash,
      mode,
      user: this.getCurrentUser(),
      details: `Hook installed at ${this.hookPath}`,
    });

    return hash;
  }

  /**
   * Verify the integrity of the installed hook against stored hash + HMAC.
   * Returns the integrity status.
   *
   * Mitigations: T-01 (read into memory once), S-01 (HMAC check), R-01 (audit log on tamper).
   */
  verifyIntegrity(): { status: "valid" | "tampered" | "missing_baseline" | "error"; details?: string } {
    if (!this.hookPath || !fs.existsSync(this.hookPath)) {
      return { status: "missing_baseline", details: "Hook file not found" };
    }

    if (!fs.existsSync(this.integrityPath)) {
      return { status: "missing_baseline", details: "Integrity baseline not found. Run specia hook install to create one." };
    }

    try {
      // T-01: Read hook into memory ONCE, hash from memory (TOCTOU mitigation)
      const hookContent = fs.readFileSync(this.hookPath, "utf-8");
      const currentHash = crypto.createHash("sha256").update(hookContent).digest("hex");

      // Read stored integrity data
      const stored: GuardianIntegrity = JSON.parse(
        fs.readFileSync(this.integrityPath, "utf-8"),
      );

      // Validate stored hash is valid hex
      if (!stored.hash || !/^[0-9a-f]{64}$/.test(stored.hash)) {
        return { status: "missing_baseline", details: "Integrity file corrupted (invalid hash format)" };
      }

      // Compare SHA-256 hash
      if (currentHash !== stored.hash) {
        // Tampering detected — log to audit trail (R-01)
        this.appendAuditLog({
          timestamp: new Date().toISOString(),
          event: "tamper_detected",
          hash: currentHash,
          expected_hash: stored.hash,
          user: this.getCurrentUser(),
          details: "Hook file hash mismatch — possible tampering",
        });

        return {
          status: "tampered",
          details: `Hash mismatch. Expected: ${stored.hash.slice(0, 16)}... Got: ${currentHash.slice(0, 16)}... Run 'specia hook install' to regenerate integrity baseline.`,
        };
      }

      // Also verify HMAC (S-01: secondary integrity signal)
      if (stored.hmac) {
        const hmacKey = this.deriveMachineKey();
        const currentHmac = crypto.createHmac("sha256", hmacKey).update(hookContent).digest("hex");
        if (currentHmac !== stored.hmac) {
          // HMAC mismatch — integrity file may have been copied from another machine
          this.appendAuditLog({
            timestamp: new Date().toISOString(),
            event: "tamper_detected",
            hash: currentHash,
            expected_hash: stored.hash,
            user: this.getCurrentUser(),
            details: "HMAC mismatch — integrity file may have been copied from another machine",
          });

          return {
            status: "tampered",
            details: "HMAC mismatch — integrity data may have been transferred from a different machine.",
          };
        }
      }

      return { status: "valid" };
    } catch (err) {
      return {
        status: "error",
        details: `Integrity check failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * Derive a machine-specific key for HMAC signing (S-01).
   * Uses hostname + absolute project path so hashes are machine-bound.
   */
  private deriveMachineKey(): string {
    const machineId = `${os.hostname()}:${path.resolve(this.rootDir)}`;
    return crypto.createHash("sha256").update(machineId).digest("hex");
  }

  /**
   * Append an entry to the Guardian audit log (R-01: non-repudiable record).
   * Append-only — never overwrites existing entries.
   */
  private appendAuditLog(entry: GuardianAuditEntry): void {
    try {
      fs.mkdirSync(this.speciaDir, { recursive: true });
      const line = JSON.stringify(entry) + "\n";
      fs.appendFileSync(this.auditLogPath, line, "utf-8");
    } catch {
      // Non-fatal — audit logging is best-effort
    }
  }

  /**
   * Get current git user or OS user for audit logging.
   */
  private getCurrentUser(): string {
    try {
      return execSync("git config user.name", {
        cwd: this.rootDir,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
    } catch {
      return os.userInfo().username ?? "unknown";
    }
  }
}
