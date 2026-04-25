/**
 * Bake Mode Service — Project configuration shortcuts
 * 
 * Manages ~/.config/specia/baked.json with reusable project configs.
 * Supports env: references for secrets and validates against path traversal/command injection.
 * 
 * Security mitigations:
 * - EOP-01: Validates project_dir against shell metacharacters
 * - EOP-02: Validates project_dir against path traversal (../)
 * - T-01: Sets 0600 permissions on baked.json
 * - ID-01: Never resolves env: references in display output
 * - S-01: Warns user when @shortcut changes CWD
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

export interface BakedConfig {
  project_dir: string;
  posture?: "standard" | "elevated" | "paranoid";
  memory?: "alejandria" | "engram" | "local";
  provider?: "anthropic" | "openai";
  api_key?: string; // Stored as env:VAR_NAME or literal (NOT recommended)
  model?: string;
}

export interface BakedConfigFile {
  version: string;
  configs: Record<string, BakedConfig>;
  integrity?: string; // HMAC for tamper detection
}

const BAKED_CONFIG_VERSION = "1.0.0";

export class BakeService {
  private configPath: string;
  private secretKey: string;

  constructor(configPath?: string) {
    this.configPath = configPath ?? path.join(os.homedir(), ".config", "specia", "baked.json");
    // Generate or load secret key for HMAC (stored separately or derived from user)
    this.secretKey = this.getOrCreateSecretKey();
  }

  /**
   * Get or create HMAC secret key for integrity checks
   * Stored in ~/.config/specia/.bake-secret
   */
  private getOrCreateSecretKey(): string {
    const secretPath = path.join(path.dirname(this.configPath), ".bake-secret");
    
    try {
      if (fs.existsSync(secretPath)) {
        return fs.readFileSync(secretPath, "utf-8").trim();
      }
    } catch {
      // Fall through to create new secret
    }

    // Create new secret
    const secret = crypto.randomBytes(32).toString("hex");
    try {
      fs.mkdirSync(path.dirname(secretPath), { recursive: true, mode: 0o700 });
      fs.writeFileSync(secretPath, secret, { mode: 0o600 });
    } catch (err) {
      console.warn(`Warning: Could not save secret key: ${err}`);
    }
    
    return secret;
  }

  /**
   * Calculate HMAC for integrity verification
   */
  private calculateIntegrity(configs: Record<string, BakedConfig>): string {
    const data = JSON.stringify(configs, Object.keys(configs).sort());
    return crypto.createHmac("sha256", this.secretKey).update(data).digest("hex");
  }

  /**
   * Verify integrity of loaded config
   */
  private verifyIntegrity(data: BakedConfigFile): boolean {
    if (!data.integrity) return false; // No integrity check present
    const expected = this.calculateIntegrity(data.configs);
    return crypto.timingSafeEqual(
      Buffer.from(data.integrity, "hex"),
      Buffer.from(expected, "hex")
    );
  }

  /**
   * Load baked configs from disk
   */
  private load(skipIntegrityCheck = false): BakedConfigFile {
    if (!fs.existsSync(this.configPath)) {
      return { version: BAKED_CONFIG_VERSION, configs: {} };
    }

    try {
      const content = fs.readFileSync(this.configPath, "utf-8");
      const data = JSON.parse(content) as BakedConfigFile;

      // Verify integrity if present (skip for verify command itself)
      if (!skipIntegrityCheck && data.integrity && !this.verifyIntegrity(data)) {
        throw new Error(
          "SECURITY WARNING: Baked config integrity check failed. File may have been tampered with. " +
          "Run 'specia bake verify' to inspect or delete ~/.config/specia/baked.json to reset."
        );
      }

      return data;
    } catch (err) {
      if (err instanceof Error && err.message.includes("SECURITY WARNING")) {
        throw err; // Re-throw integrity errors
      }
      throw new Error(`Failed to load baked config: ${err}`);
    }
  }

  /**
   * Save baked configs to disk with secure permissions
   */
  private save(data: BakedConfigFile): void {
    // Calculate integrity before saving
    data.integrity = this.calculateIntegrity(data.configs);

    const dir = path.dirname(this.configPath);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

    // Write with restrictive permissions (0600) - MITIGATION: T-01
    fs.writeFileSync(this.configPath, JSON.stringify(data, null, 2), { mode: 0o600 });

    // Verify permissions were set correctly
    const stats = fs.statSync(this.configPath);
    const mode = stats.mode & 0o777;
    if (mode !== 0o600) {
      console.warn(
        `Warning: Could not set secure permissions on ${this.configPath}. ` +
        `Current: ${mode.toString(8)}, Expected: 0600`
      );
    }
  }

  /**
   * Validate project_dir against security threats
   * MITIGATION: EOP-01 (command injection), EOP-02 (path traversal)
   */
  private validateProjectDir(projectDir: string): void {
    // Check for shell metacharacters - MITIGATION: EOP-01
    const shellMetachars = /[;|&$`<>(){}[\]!]/;
    if (shellMetachars.test(projectDir)) {
      throw new Error(
        `Invalid project_dir: Contains shell metacharacters. ` +
        `This could lead to command injection. Path: ${projectDir}`
      );
    }

    // Resolve to absolute path
    const resolved = path.resolve(projectDir);

    // Check for path traversal patterns - MITIGATION: EOP-02
    if (projectDir.includes("../") || projectDir.includes("..\\")) {
      throw new Error(
        `Invalid project_dir: Contains path traversal sequence (..). ` +
        `Use absolute paths only. Path: ${projectDir}`
      );
    }

    // Warn about suspicious paths (check BEFORE allowed paths)
    const suspiciousPaths = ["/etc", "/root", "/var", "/usr", "/bin", "/sbin"];
    if (suspiciousPaths.some(p => resolved.startsWith(p))) {
      throw new Error(
        `Invalid project_dir: Path ${resolved} is in a system directory. ` +
        `This is not allowed for security reasons.`
      );
    }

    // Validate it's within allowed directories (home or /tmp)
    const homeDir = os.homedir();
    const tmpDir = os.tmpdir();
    
    if (!resolved.startsWith(homeDir) && !resolved.startsWith(tmpDir) && !resolved.startsWith("/opt/") && !resolved.startsWith("/workspace/")) {
      throw new Error(
        `Invalid project_dir: Must be within home directory (${homeDir}), /tmp, /opt, or /workspace. ` +
        `Got: ${resolved}`
      );
    }

    // Verify directory exists (only warn, don't block)
    if (!fs.existsSync(resolved)) {
      console.warn(`Warning: project_dir does not exist: ${resolved}`);
    }
  }

  /**
   * Create a new baked config
   */
  create(name: string, config: BakedConfig): void {
    // Validate name
    if (!/^[a-z0-9-]+$/.test(name)) {
      throw new Error(`Invalid config name: ${name}. Use lowercase alphanumeric and hyphens only.`);
    }

    // Validate project_dir - MITIGATION: EOP-01, EOP-02
    this.validateProjectDir(config.project_dir);

    // Convert absolute path for storage
    config.project_dir = path.resolve(config.project_dir);

    const data = this.load();
    
    if (data.configs[name]) {
      throw new Error(`Baked config '${name}' already exists. Use 'specia bake delete ${name}' first.`);
    }

    data.configs[name] = config;
    this.save(data);
  }

  /**
   * Get a baked config by name
   */
  get(name: string): BakedConfig | undefined {
    const data = this.load();
    return data.configs[name];
  }

  /**
   * List all baked configs
   * MITIGATION: ID-01 - Never resolves env: references
   */
  list(): Array<{ name: string; config: BakedConfig }> {
    const data = this.load();
    return Object.entries(data.configs).map(([name, config]) => ({ name, config }));
  }

  /**
   * Delete a baked config
   */
  delete(name: string): void {
    const data = this.load();
    
    if (!data.configs[name]) {
      throw new Error(`Baked config '${name}' not found.`);
    }

    delete data.configs[name];
    this.save(data);
  }

  /**
   * Verify integrity of all configs (for 'specia bake verify' command)
   */
  verify(): { valid: boolean; message: string } {
    try {
      const data = this.load(true); // Skip integrity check during load
      
      if (!data.integrity) {
        return {
          valid: false,
          message: "No integrity check found. File was created before integrity checks were added or has been manually edited."
        };
      }

      const isValid = this.verifyIntegrity(data);
      
      if (isValid) {
        return {
          valid: true,
          message: `✓ Integrity check passed for ${Object.keys(data.configs).length} config(s)`
        };
      } else {
        return {
          valid: false,
          message: "✗ Integrity check FAILED. File may have been tampered with."
        };
      }
    } catch (err) {
      return {
        valid: false,
        message: `Error verifying integrity: ${err}`
      };
    }
  }

  /**
   * Mask secrets in config for display
   * MITIGATION: ID-01 - Never resolves env: references
   */
  static maskSecrets(config: BakedConfig): BakedConfig {
    const masked = { ...config };
    
    if (masked.api_key) {
      // If it's an env: reference, show it as-is
      if (masked.api_key.startsWith("env:")) {
        // Keep as-is, don't resolve
      } else {
        // Mask literal API keys
        masked.api_key = "***";
      }
    }

    return masked;
  }

  /**
   * Parse @shortcut from CLI args
   * Returns [shortcut name, remaining args]
   */
  static parseShortcut(args: string[]): [string | null, string[]] {
    if (args.length === 0) return [null, args];
    
    const first = args[0];
    if (first?.startsWith("@")) {
      return [first.slice(1), args.slice(1)];
    }
    
    return [null, args];
  }

  /**
   * Apply baked config with CWD change warning
   * MITIGATION: S-01 - Warns user when @shortcut changes CWD
   */
  apply(name: string): { config: BakedConfig; warnings: string[] } {
    const config = this.get(name);
    if (!config) {
      throw new Error(
        `Baked config '${name}' not found. Run 'specia bake list' to see available configs.`
      );
    }

    const warnings: string[] = [];

    // Validate project_dir again at runtime
    this.validateProjectDir(config.project_dir);

    // Warn if changing CWD - MITIGATION: S-01
    const currentDir = process.cwd();
    if (path.resolve(config.project_dir) !== currentDir) {
      warnings.push(
        `⚠️  @${name} will change working directory:\n` +
        `   From: ${currentDir}\n` +
        `   To:   ${config.project_dir}`
      );
    }

    return { config, warnings };
  }

  /**
   * Resolve env: references at runtime
   * ONLY called when actually using the API key, never for display
   */
  static resolveEnvReference(value: string | undefined): string | undefined {
    if (!value) return undefined;
    
    if (value.startsWith("env:")) {
      const varName = value.slice(4);
      const resolved = process.env[varName];
      
      if (!resolved) {
        throw new Error(
          `Environment variable ${varName} not set. ` +
          `Set it with: export ${varName}=your-api-key`
        );
      }
      
      return resolved;
    }
    
    return value;
  }

  /**
   * Audit all code paths for accidental secret disclosure
   * This method is used in tests to verify no secrets leak
   */
  static auditForSecretLeaks(output: string): string[] {
    const leaks: string[] = [];
    
    // Check for API key patterns (sk-, api_, token)
    const patterns = [
      /sk-[a-zA-Z0-9_-]{10,}/g,
      /api_[a-zA-Z0-9_-]{10,}/g,
      /token[_-][a-zA-Z0-9_-]{10,}/gi,
    ];

    for (const pattern of patterns) {
      const matches = output.match(pattern);
      if (matches) {
        leaks.push(...matches);
      }
    }

    return leaks;
  }
}
