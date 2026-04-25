/**
 * GuardianService — Pre-commit validation engine.
 *
 * Four-layer validation:
 *   Layer 1: Spec existence (do staged files have spec coverage?)
 *   Layer 2: Review completeness (is the review done, not stale?)
 *   Layer 3: Mitigation compliance (are security mitigations checked off?)
 *   Layer 4: Spec-aware validation (does code match spec requirements?)
 *     - Layer 4a: Heuristic validation (fast, AST-based keyword matching)
 *     - Layer 4b: LLM validation (slow, deep semantic analysis)
 *
 * Also handles file-to-change mapping heuristics and result caching.
 *
 * v0.2: Design Decisions 13, 14, 15
 * v0.4: Layer 4 spec-aware validation (Decisions 1-10)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { FileStore } from "./store.js";
import { computeSpecHash } from "./cache.js";
import { HookManager } from "./hook-manager.js";
import { SpecCacheService } from "./spec-cache.js";
import {
  extractRequirementKeywords,
  parseCodeElements,
  scoreEvidence,
  detectAbuseCasePatterns,
  computeL4aCacheKey,
  computeSpecKeywordsHash,
} from "./heuristic-validator.js";
import { validateViaAudit, computeL4bCacheKey } from "./guardian-audit-bridge.js";
import type {
  GuardianConfig,
  GuardianMode,
  ChangeState,
} from "../types/index.js";
import type {
  SpecMatchResult,
  FlaggedRequirement,
  FlaggedAbuseCase,
  L4aCacheEntry,
  L4bCacheEntry,
  GuardianAuditConfig,
  GuardianVerdict,
} from "../types/guardian.js";
import type { CodeFile } from "../types/audit.js";

// ── Public interfaces ────────────────────────────────────────────────

export interface FileValidation {
  file: string;
  status: "pass" | "warn" | "fail";
  change?: string;
  reason?: string;
  checks: {
    spec_exists: boolean | null;
    review_complete: boolean | null;
    mitigations_done: boolean | null;
    spec_match?: boolean | null; // v0.4: Layer 4 result
  };
  spec_match_details?: SpecMatchResult; // v0.4: Layer 4 details
}

export interface ValidationResult {
  timestamp: string;
  mode: GuardianMode;
  staged_files: number;
  results: FileValidation[];
  summary: {
    passed: number;
    warnings: number;
    violations: number;
  };
  /** v0.5: Hook integrity verification status. */
  integrity_status?: "valid" | "tampered" | "missing_baseline" | "error";
  integrity_details?: string;
}

export interface GuardianCacheEntry {
  file_sha: string;
  validation: FileValidation;
  cached_at: string;
  /** SHAs of artifacts that influenced this cache entry. */
  artifact_shas: Record<string, string>;
}

export interface GuardianCache {
  version: string;
  entries: Record<string, GuardianCacheEntry>;
}

// ── Internal types ───────────────────────────────────────────────────

interface ChangeContext {
  name: string;
  proposalContent: string;
  specContent: string | null;
  reviewContent: string | null;
  tasksContent: string | null;
  state: ChangeState | null;
  scopePaths: string[];
}

// ── Default config ───────────────────────────────────────────────────

export const DEFAULT_GUARDIAN_CONFIG: GuardianConfig = {
  enabled: true,
  mode: "warn",
  exclude: [],
  validation: {
    require_spec: true,
    require_review: true,
    require_mitigations: true,
  },
  spec_validation: {
    enabled: false, // v0.4: Layer 4 disabled by default
    llm_provider: "anthropic",
    llm_model: "claude-3-5-haiku-20241022",
    llm_budget: 10000,
  },
};

// ── Service ──────────────────────────────────────────────────────────

export class GuardianService {
  private readonly speciaPath: string;
  private readonly cachePath: string;
  private readonly specCacheService: SpecCacheService | null;

  constructor(
    private readonly rootDir: string,
    private readonly store: FileStore,
  ) {
    this.speciaPath = path.join(rootDir, ".specia");
    this.cachePath = path.join(this.speciaPath, ".guardian-cache.json");
    
    // Initialize spec cache service (Layer 4)
    try {
      this.specCacheService = new SpecCacheService(this.speciaPath);
    } catch {
      this.specCacheService = null; // Non-fatal if cache initialization fails
    }
  }

  // ── Validation ──────────────────────────────────────────────────────

  /**
   * Validate an array of staged file paths against SpecIA spec coverage.
   * This is the main entry point used by the guardian-runner.
   *
   * Runs Layers 1-4 validation (async for Layer 4).
   */
  async validateStagedFiles(
    stagedFiles: string[],
    config?: GuardianConfig,
  ): Promise<ValidationResult> {
    const guardianConfig = config ?? this.readGuardianConfig();
    const mode = guardianConfig.mode;

    // v0.5: Integrity verification before validation (T-01, S-01)
    const hookManager = new HookManager(this.rootDir);
    const integrityResult = hookManager.verifyIntegrity();
    if (integrityResult.status === "tampered") {
      // Log warning but continue in warn mode; block in strict mode
      if (mode === "strict") {
        return {
          timestamp: new Date().toISOString(),
          mode,
          staged_files: stagedFiles.length,
          results: [],
          summary: { passed: 0, warnings: 0, violations: 1 },
          integrity_status: integrityResult.status,
          integrity_details: integrityResult.details,
        };
      }
    }

    // Filter excluded paths
    const filtered = this.filterExcluded(stagedFiles, guardianConfig.exclude);

    // Load all active changes
    const changes = this.loadActiveChanges();

    // Load cache
    const cache = this.loadCache();

    const results: FileValidation[] = [];

    for (const file of filtered) {
      // Check cache
      const fileSha = this.computeFileSha(file);
      const cached = this.getCachedResult(cache, file, fileSha, changes);
      if (cached) {
        results.push(cached);
        continue;
      }

      // Map file to changes
      const matchedChanges = this.mapFileToChanges(file, changes);

      let validation: FileValidation;

      if (matchedChanges.length === 0) {
        // No spec coverage — warn (not error) per design
        validation = {
          file,
          status: mode === "strict" ? "fail" : "warn",
          reason: "no_spec_coverage",
          checks: {
            spec_exists: false,
            review_complete: null,
            mitigations_done: null,
            spec_match: null,
          },
        };
      } else {
        // Use the first matched change for validation
        const changeName = matchedChanges[0]!;
        validation = this.validateFileAgainstChange(
          file,
          changeName,
          changes,
          guardianConfig,
        );

        // Layer 4: Spec-aware validation (async)
        if (
          guardianConfig.spec_validation?.enabled &&
          validation.status !== "fail"
        ) {
          try {
            const specMatchResult = await this.validateSpecMatch(
              [file],
              changeName,
              guardianConfig,
            );

            validation.checks.spec_match =
              specMatchResult.status === "pass";
            validation.spec_match_details = specMatchResult;

            // Update status if Layer 4 fails
            if (
              specMatchResult.status === "fail" ||
              specMatchResult.status === "warn"
            ) {
              validation.status = specMatchResult.status;
              validation.reason = specMatchResult.reason ?? "spec_mismatch";
            }
          } catch (error) {
            // Layer 4 error — graceful degradation (don't block commit)
            validation.checks.spec_match = null;
            validation.spec_match_details = {
              status: "warn",
              layer: "bypass",
              degraded: true,
              error:
                error instanceof Error ? error.message : String(error),
            };
          }
        }
      }

      results.push(validation);

      // Cache the result
      this.cacheResult(cache, file, fileSha, validation, changes);
    }

    // Write cache
    this.saveCache(cache);

    const summary = {
      passed: results.filter((r) => r.status === "pass").length,
      warnings: results.filter((r) => r.status === "warn").length,
      violations: results.filter((r) => r.status === "fail").length,
    };

    return {
      timestamp: new Date().toISOString(),
      mode,
      staged_files: filtered.length,
      results,
      summary,
    };
  }

  /**
   * Validate a single change by name (used by MCP status tool).
   */
  validateChange(changeName: string): {
    spec_exists: boolean;
    review_complete: boolean;
    mitigations_done: boolean;
  } {
    return {
      spec_exists: this.checkSpecExists(changeName),
      review_complete: this.checkReviewComplete(changeName),
      mitigations_done: this.checkMitigationsDone(changeName),
    };
  }

  // ── Layer 1: Spec existence ─────────────────────────────────────────

  checkSpecExists(changeName: string): boolean {
    const spec = this.store.readArtifact(changeName, "spec");
    return spec !== null;
  }

  // ── Layer 2: Review completeness ────────────────────────────────────

  checkReviewComplete(changeName: string): boolean {
    const state = this.store.getChangeState(changeName);
    if (!state) return false;

    // Review must be in phases_completed
    if (!state.phases_completed.includes("review")) return false;

    // review.md must exist
    const review = this.store.readArtifact(changeName, "review");
    if (!review) return false;

    // Check if review is stale (spec changed after review)
    if (state.review_hash) {
      const spec = this.store.readArtifact(changeName, "spec");
      if (spec) {
        const currentHash = this.hashContent(spec);
        if (state.review_hash !== currentHash) return false;
      }
    }

    return true;
  }

  // ── Layer 3: Mitigation compliance ──────────────────────────────────

  checkMitigationsDone(changeName: string): boolean {
    const tasks = this.store.readArtifact(changeName, "tasks");
    if (!tasks) return false; // No tasks → can't verify

    // Find the Security Mitigations section
    const mitigationSection = this.extractMitigationSection(tasks);
    if (!mitigationSection) return true; // No mitigation section → nothing to check

    // Parse checklist items
    const unchecked = mitigationSection.match(/^- \[ \] /gm);
    return !unchecked || unchecked.length === 0;
  }

  // ── Layer 4: Spec-aware validation ──────────────────────────────────

  /**
   * Validate that staged files match spec requirements.
   *
   * Two-stage validation:
   *   4a. Heuristic validation (fast, keyword/AST matching)
   *   4b. LLM validation (slow, deep semantic analysis) — only if 4a flags issues
   *
   * Graceful degradation: LLM failures never block commits (return "warn" instead).
   *
   * @param files - Staged file paths
   * @param changeName - Change name
   * @param config - Guardian config
   * @returns SpecMatchResult with validation outcome
   */
  async validateSpecMatch(
    files: string[],
    changeName: string,
    config: GuardianConfig,
  ): Promise<SpecMatchResult> {
    // Early exit if Layer 4 disabled
    if (!config.spec_validation?.enabled) {
      return {
        status: "pass",
        layer: "bypass",
        reason: "spec_validation_disabled",
      };
    }

    // Load change artifacts
    const specContent = this.store.readArtifact(changeName, "spec");
    const reviewContent = this.store.readArtifact(changeName, "review");
    const designContent = this.store.readArtifact(changeName, "design");

    if (!specContent) {
      return {
        status: "warn",
        layer: "bypass",
        reason: "spec_missing",
      };
    }

    // Layer 4a: Heuristic validation
    try {
      const heuristicResult = await this.runLayer4a(
        files,
        changeName,
        specContent,
        reviewContent,
      );

      // If heuristics pass, no need for Layer 4b
      if (heuristicResult.result === "pass") {
        return {
          status: "pass",
          layer: "4a",
          cached: heuristicResult.cached,
          evidence_score: heuristicResult.evidence_score,
          summary: `Heuristic validation passed (score: ${heuristicResult.evidence_score})`,
        };
      }

      // Layer 4b: LLM validation (only for flagged items)
      const llmResult = await this.runLayer4b(
        files,
        changeName,
        specContent,
        reviewContent,
        designContent,
        heuristicResult.flagged_requirements,
        heuristicResult.flagged_abuse_cases,
        config,
      );

      return {
        status: llmResult.status,
        layer: "4b",
        cached: llmResult.cached,
        verdict: llmResult.verdict as GuardianVerdict,
        summary: llmResult.summary,
        degraded: llmResult.degraded,
        error: llmResult.error,
      };
    } catch (error) {
      // Graceful degradation on errors
      return {
        status: "warn",
        layer: "bypass",
        degraded: true,
        error: error instanceof Error ? error.message : String(error),
        reason: "layer4_error",
      };
    }
  }

  /**
   * Run Layer 4a: Heuristic validation.
   *
   * Steps:
   * 1. Extract requirement keywords from spec
   * 2. Check cache (per-file)
   * 3. Parse code elements (AST)
   * 4. Score evidence (weighted keyword matching)
   * 5. Detect abuse case patterns
   * 6. Return pass/flag
   */
  private async runLayer4a(
    files: string[],
    _changeName: string,
    specContent: string,
    reviewContent: string | null,
  ): Promise<{
    result: "pass" | "flag";
    evidence_score: number;
    flagged_requirements: FlaggedRequirement[];
    flagged_abuse_cases: FlaggedAbuseCase[];
    cached: boolean;
  }> {
    // Extract requirement keywords
    const requirements = extractRequirementKeywords(specContent);
    const specKeywordsHash = computeSpecKeywordsHash(requirements);

    // Parse abuse cases from review (if exists)
    const abuseCases = reviewContent
      ? this.parseAbuseCasesFromReview(reviewContent)
      : [];

    // Collect flagged items
    const flaggedRequirements: FlaggedRequirement[] = [];
    const flaggedAbuseCases: FlaggedAbuseCase[] = [];
    let totalEvidenceScore = 0;
    let cached = false;

    // Read code files
    const codeContents = new Map<string, string>();
    for (const file of files) {
      try {
        const fullPath = path.join(this.rootDir, file);
        if (fs.existsSync(fullPath)) {
          codeContents.set(file, fs.readFileSync(fullPath, "utf-8"));
        }
      } catch {
        // Skip unreadable files
      }
    }

    // Validate each file
    for (const file of files) {
      const content = codeContents.get(file);
      if (!content) continue;

      // Check cache
      const fileSha = this.hashContent(content);
      const cacheKey = computeL4aCacheKey(fileSha, specKeywordsHash);

      if (this.specCacheService) {
        const cachedEntry = this.specCacheService.getL4aEntry(cacheKey);
        if (cachedEntry) {
          cached = true;
          totalEvidenceScore += cachedEntry.evidence_score;
          if (cachedEntry.result === "flag") {
            // Re-flag this file's requirements
            flaggedRequirements.push({
              requirementId: `${file}-cached`,
              keywords: [],
              reason: "zero_evidence",
            });
          }
          continue;
        }
      }

      // Parse code elements
      const codeElements = parseCodeElements(file, content);

      // Score evidence for each requirement
      let fileEvidenceScore = 0;
      for (const req of requirements) {
        const evidence = scoreEvidence(req, codeElements, file);
        fileEvidenceScore += evidence.score;

        // Flag requirements with zero evidence
        if (evidence.score === 0) {
          flaggedRequirements.push({
            requirementId: req.requirementId,
            keywords: Array.from(req.keywords).slice(0, 5), // Top 5 keywords
            reason: "zero_evidence",
          });
        }
      }

      totalEvidenceScore += fileEvidenceScore;

      // Cache result
      if (this.specCacheService) {
        const cacheEntry: L4aCacheEntry = {
          file,
          cache_key: cacheKey,
          result: fileEvidenceScore > 0 ? "pass" : "flag",
          evidence_score: fileEvidenceScore,
          evidence_sources: [],
          timestamp: new Date().toISOString(),
        };
        this.specCacheService.setL4aEntry(cacheEntry);
      }
    }

    // Detect abuse case patterns
    if (abuseCases.length > 0) {
      const flaggedACs = detectAbuseCasePatterns(
        abuseCases,
        files,
        codeContents,
      );
      flaggedAbuseCases.push(...flaggedACs);
    }

    // Save cache
    if (this.specCacheService) {
      this.specCacheService.saveCache();
    }

    // Determine overall result
    const result =
      flaggedRequirements.length === 0 && flaggedAbuseCases.length === 0
        ? "pass"
        : "flag";

    return {
      result,
      evidence_score: totalEvidenceScore,
      flagged_requirements: flaggedRequirements,
      flagged_abuse_cases: flaggedAbuseCases,
      cached,
    };
  }

  /**
   * Run Layer 4b: LLM validation.
   *
   * Steps:
   * 1. Check cache
   * 2. Build focused prompts (only flagged requirements/abuse cases)
   * 3. Call LLM via guardian-audit-bridge
   * 4. Map result to SpecMatchResult
   */
  private async runLayer4b(
    files: string[],
    changeName: string,
    specContent: string,
    reviewContent: string | null,
    designContent: string | null,
    flaggedRequirements: FlaggedRequirement[],
    flaggedAbuseCases: FlaggedAbuseCase[],
    config: GuardianConfig,
  ): Promise<{
    status: "pass" | "warn" | "fail";
    cached: boolean;
    verdict?: string;
    summary: string;
    degraded?: boolean;
    error?: string;
  }> {
    // Check cache
    const fileShas = files.map((f) => {
      try {
        const fullPath = path.join(this.rootDir, f);
        if (fs.existsSync(fullPath)) {
          return this.hashContent(fs.readFileSync(fullPath, "utf-8"));
        }
      } catch {
        // Ignore
      }
      return "";
    }).filter(Boolean);

    const specHash = this.hashContent(specContent);
    const reviewHash = reviewContent ? this.hashContent(reviewContent) : "";
    const cacheKey = computeL4bCacheKey(
      fileShas,
      specHash,
      reviewHash,
      "standard",
    );

    if (this.specCacheService) {
      const cachedEntry = this.specCacheService.getL4bEntry(cacheKey);
      if (cachedEntry) {
        this.specCacheService.saveCache();
      return {
        status: cachedEntry.verdict === "pass" ? "pass" : "warn",
        cached: true,
        verdict: cachedEntry.verdict as GuardianVerdict,
        summary: `Layer 4b cached result: ${cachedEntry.verdict}`,
      };
      }
    }

    // Prepare code files
    const codeFiles: CodeFile[] = files
      .map((file) => {
        try {
          const fullPath = path.join(this.rootDir, file);
          if (fs.existsSync(fullPath)) {
            return {
              path: file,
              content: fs.readFileSync(fullPath, "utf-8"),
            };
          }
        } catch {
          // Skip unreadable files
        }
        return null;
      })
      .filter((f): f is CodeFile => f !== null);

    if (codeFiles.length === 0) {
      return {
        status: "pass",
        cached: false,
        summary: "No code files to validate",
      };
    }

    // Call LLM validation
    try {
      const speciaConfig = this.store.readConfig();
      const auditConfig: GuardianAuditConfig = {
        maxTokens: config.spec_validation?.llm_budget ?? 10000,
        maxFiles: 10, // Hard limit
        llmProvider: config.spec_validation?.llm_provider ?? "anthropic",
        llmModel:
          config.spec_validation?.llm_model ?? "claude-3-5-haiku-20241022",
        focusRequirements: flaggedRequirements,
        focusAbuseCases: flaggedAbuseCases,
      };

      const result = await validateViaAudit({
        speciaConfig,
        changeName,
        specContent,
        reviewContent,
        designContent,
        codeFiles,
        config: auditConfig,
      });

      // Cache result
      if (this.specCacheService) {
        const cacheEntry: L4bCacheEntry = {
          file: files.join(","),
          cache_key: cacheKey,
          verdict: result.verdict,
          failed_requirements: result.failedRequirements,
          failed_abuse_cases: result.failedAbuseCases,
          timestamp: new Date().toISOString(),
        };
        this.specCacheService.setL4bEntry(cacheEntry);
        this.specCacheService.saveCache();
      }

      // Map verdict to status (graceful degradation: fail → warn)
      const status: "pass" | "warn" | "fail" =
        result.verdict === "pass" ? "pass" : "warn";

      return {
        status,
        cached: false,
        verdict: result.verdict,
        summary: result.summary,
      };
    } catch (error) {
      // LLM error — graceful degradation
      return {
        status: "warn",
        cached: false,
        degraded: true,
        error: error instanceof Error ? error.message : String(error),
        summary: "Layer 4b LLM validation failed (gracefully degraded)",
      };
    }
  }

  /**
   * Parse abuse cases from review.md content.
   *
   * Expected format:
   * ### AC-NNN: Description
   * **Threat**: ...
   * **Mitigation**: ...
   */
  private parseAbuseCasesFromReview(
    reviewContent: string,
  ): Array<{ id: string; description: string; mitigation: string }> {
    const abuseCases: Array<{
      id: string;
      description: string;
      mitigation: string;
    }> = [];

    const lines = reviewContent.split("\n");
    let currentId = "";
    let currentDesc = "";
    let currentMitigation = "";

    for (const line of lines) {
      // Detect abuse case headers
      if (line.startsWith("### AC-")) {
        // Save previous abuse case
        if (currentId) {
          abuseCases.push({
            id: currentId,
            description: currentDesc.trim(),
            mitigation: currentMitigation.trim(),
          });
        }

        // Start new abuse case
        const match = line.match(/###\s*(AC-\d+):\s*(.+)/);
        currentId = match?.[1] ?? "";
        currentDesc = match?.[2] ?? "";
        currentMitigation = "";
      } else if (line.startsWith("**Mitigation**:")) {
        currentMitigation = line.replace("**Mitigation**:", "").trim();
      }
    }

    // Save last abuse case
    if (currentId) {
      abuseCases.push({
        id: currentId,
        description: currentDesc.trim(),
        mitigation: currentMitigation.trim(),
      });
    }

    return abuseCases;
  }

  // ── File-to-change mapping ──────────────────────────────────────────

  /**
   * Map a file path to active changes that cover it.
   * Heuristic-based: checks proposal scope, spec content, directory matches.
   */
  mapFileToChanges(filePath: string, changes: ChangeContext[]): string[] {
    const matches: string[] = [];

    for (const change of changes) {
      // Check 1: file path appears in proposal
      if (
        change.proposalContent.includes(filePath) ||
        change.proposalContent.includes(path.dirname(filePath))
      ) {
        matches.push(change.name);
        continue;
      }

      // Check 2: file path appears in spec content
      if (change.specContent && change.specContent.includes(filePath)) {
        matches.push(change.name);
        continue;
      }

      // Check 3: directory-level match using extracted scope paths
      if (change.scopePaths.some((scope) => filePath.startsWith(scope))) {
        matches.push(change.name);
      }
    }

    return matches;
  }

  // ── Caching ─────────────────────────────────────────────────────────

  private loadCache(): GuardianCache {
    try {
      if (fs.existsSync(this.cachePath)) {
        const raw = fs.readFileSync(this.cachePath, "utf-8");
        return JSON.parse(raw) as GuardianCache;
      }
    } catch {
      // Corrupted cache — start fresh
    }
    return { version: "1", entries: {} };
  }

  private saveCache(cache: GuardianCache): void {
    try {
      fs.mkdirSync(path.dirname(this.cachePath), { recursive: true });
      fs.writeFileSync(this.cachePath, JSON.stringify(cache, null, 2), "utf-8");
    } catch {
      // Non-fatal — caching is best-effort
    }
  }

  private getCachedResult(
    cache: GuardianCache,
    file: string,
    fileSha: string,
    changes: ChangeContext[],
  ): FileValidation | null {
    const entry = cache.entries[file];
    if (!entry) return null;

    // File content changed
    if (entry.file_sha !== fileSha) return null;

    // Check if any relevant artifacts changed
    if (entry.validation.change) {
      const change = changes.find((c) => c.name === entry.validation.change);
      if (!change) return null; // Change was deleted

      const currentShas = this.computeArtifactShas(change);
      for (const [key, sha] of Object.entries(entry.artifact_shas)) {
        if (currentShas[key] !== sha) return null; // Artifact changed
      }
    }

    return entry.validation;
  }

  private cacheResult(
    cache: GuardianCache,
    file: string,
    fileSha: string,
    validation: FileValidation,
    changes: ChangeContext[],
  ): void {
    let artifactShas: Record<string, string> = {};
    if (validation.change) {
      const change = changes.find((c) => c.name === validation.change);
      if (change) {
        artifactShas = this.computeArtifactShas(change);
      }
    }

    cache.entries[file] = {
      file_sha: fileSha,
      validation,
      cached_at: new Date().toISOString(),
      artifact_shas: artifactShas,
    };
  }

  clearCache(): void {
    try {
      if (fs.existsSync(this.cachePath)) {
        fs.unlinkSync(this.cachePath);
      }
    } catch {
      // Non-fatal
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────

  private validateFileAgainstChange(
    file: string,
    changeName: string,
    _changes: ChangeContext[],
    config: GuardianConfig,
  ): FileValidation {
    const checks = {
      spec_exists: null as boolean | null,
      review_complete: null as boolean | null,
      mitigations_done: null as boolean | null,
      spec_match: null as boolean | null,
    };

    let status: "pass" | "warn" | "fail" = "pass";
    let reason: string | undefined;
    let specMatchDetails: SpecMatchResult | undefined;

    // Layer 1: Spec exists
    if (config.validation.require_spec) {
      checks.spec_exists = this.checkSpecExists(changeName);
      if (!checks.spec_exists) {
        status = "fail";
        reason = "spec_missing";
      }
    }

    // Layer 2: Review complete
    if (config.validation.require_review && status !== "fail") {
      checks.review_complete = this.checkReviewComplete(changeName);
      if (!checks.review_complete) {
        status = "fail";
        reason = "review_incomplete";
      }
    }

    // Layer 3: Mitigations done
    if (config.validation.require_mitigations && status !== "fail") {
      checks.mitigations_done = this.checkMitigationsDone(changeName);
      if (!checks.mitigations_done) {
        status = "fail";
        reason = "mitigations_incomplete";
      }
    }

    // Layer 4: Spec-aware validation (async placeholder - handled separately)
    // Note: Layer 4 is async and will be run separately in validateStagedFiles
    // This is just metadata validation (Layers 1-3)

    // In warn mode, downgrade fail to warn
    if (status === "fail" && config.mode === "warn") {
      status = "warn";
    }

    return {
      file,
      status,
      change: changeName,
      reason,
      checks,
      spec_match_details: specMatchDetails,
    };
  }

  private loadActiveChanges(): ChangeContext[] {
    const changes = this.store.listChanges();
    return changes.map((info) => {
      const proposalContent = this.store.readArtifact(info.name, "proposal") ?? "";
      const specContent = this.store.readArtifact(info.name, "spec");
      const reviewContent = this.store.readArtifact(info.name, "review");
      const tasksContent = this.store.readArtifact(info.name, "tasks");
      const state = this.store.getChangeState(info.name);
      const scopePaths = this.extractScopePaths(proposalContent);

      return {
        name: info.name,
        proposalContent,
        specContent,
        reviewContent,
        tasksContent,
        state,
        scopePaths,
      };
    });
  }

  /**
   * Extract directory/file paths from proposal.md scope section.
   * Looks for lines under "## Scope" that start with "- ".
   */
  extractScopePaths(proposalContent: string): string[] {
    const paths: string[] = [];
    const scopeMatch = proposalContent.match(
      /## Scope\s*\n((?:- .+\n?)*)/,
    );
    if (!scopeMatch?.[1]) return paths;

    const lines = scopeMatch[1].split("\n");
    for (const line of lines) {
      const item = line.replace(/^- /, "").trim();
      if (item) {
        paths.push(item);
      }
    }
    return paths;
  }

  private filterExcluded(files: string[], excludePatterns: string[]): string[] {
    if (excludePatterns.length === 0) return files;

    return files.filter((file) => {
      return !excludePatterns.some((pattern) => this.matchGlob(file, pattern));
    });
  }

  /**
   * Simple glob matching supporting *, **, and ? patterns.
   * Handles common cases: "*.md", "test/**", "node_modules", "*.txt"
   */
  matchGlob(filePath: string, pattern: string): boolean {
    // Exact match
    if (filePath === pattern) return true;

    // Directory prefix match (e.g., "node_modules" matches "node_modules/foo.js")
    if (!pattern.includes("*") && !pattern.includes("?")) {
      return filePath.startsWith(pattern + "/") || filePath === pattern;
    }

    // Convert glob to regex
    let regex = pattern
      .replace(/\./g, "\\.")
      .replace(/\*\*/g, "<<DOUBLESTAR>>")
      .replace(/\*/g, "[^/]*")
      .replace(/<<DOUBLESTAR>>/g, ".*")
      .replace(/\?/g, "[^/]");

    // Anchor the pattern
    regex = `^${regex}$`;

    try {
      return new RegExp(regex).test(filePath);
    } catch {
      return false;
    }
  }

  private extractMitigationSection(tasksContent: string): string | null {
    const match = tasksContent.match(
      /## Security Mitigations\s*\n([\s\S]*?)(?=\n##|\n$|$)/,
    );
    return match?.[1] ?? null;
  }

  readGuardianConfig(): GuardianConfig {
    try {
      const config = this.store.readConfig();
      if (config.guardian) return config.guardian;
    } catch {
      // Config not readable — use defaults
    }
    return DEFAULT_GUARDIAN_CONFIG;
  }

  private computeFileSha(filePath: string): string {
    try {
      const fullPath = path.join(this.rootDir, filePath);
      if (!fs.existsSync(fullPath)) return "";
      const content = fs.readFileSync(fullPath, "utf-8");
      return this.hashContent(content);
    } catch {
      return "";
    }
  }

  private hashContent(content: string): string {
    return computeSpecHash(content);
  }

  private computeArtifactShas(change: ChangeContext): Record<string, string> {
    const shas: Record<string, string> = {};
    if (change.specContent) shas["spec"] = this.hashContent(change.specContent);
    if (change.reviewContent) shas["review"] = this.hashContent(change.reviewContent);
    if (change.tasksContent) shas["tasks"] = this.hashContent(change.tasksContent);
    return shas;
  }

  /**
   * v0.4: Format user-friendly error message for Layer 4 spec violations.
   * Returns a multi-line string with actionable remediation instructions.
   */
  formatSpecViolationError(
    file: string,
    changeName: string,
    specMatchDetails: SpecMatchResult,
  ): string {
    const lines: string[] = [];

    lines.push(`\n━━━ Spec Violation: ${file} ━━━\n`);
    lines.push(`Change: ${changeName}`);
    lines.push(`Verdict: ${specMatchDetails.verdict ?? specMatchDetails.status}\n`);

    const flaggedReqs = specMatchDetails.flagged_requirements ?? [];
    const flaggedAbuse = specMatchDetails.flagged_abuse_cases ?? [];

    if (flaggedReqs.length > 0) {
      lines.push(`Failed Requirements (${flaggedReqs.length}):\n`);
      for (const req of flaggedReqs) {
        lines.push(`  • ${req.requirement_name}`);
        lines.push(`    Reason: ${req.reason}`);
        if (req.evidence && req.evidence.length > 0) {
          lines.push(`    Evidence: ${req.evidence.join(", ")}`);
        }
        lines.push(``);
      }
    }

    if (flaggedAbuse.length > 0) {
      lines.push(
        `Flagged Abuse Cases (${flaggedAbuse.length}):\n`,
      );
      for (const abuse of flaggedAbuse) {
        lines.push(`  • ${abuse.abuse_case_name}`);
        lines.push(`    Risk: ${abuse.reason}`);
        if (abuse.evidence && abuse.evidence.length > 0) {
          lines.push(`    Evidence: ${abuse.evidence.join(", ")}`);
        }
        lines.push(``);
      }
    }

    lines.push(`Remediation:\n`);
    lines.push(`  1. Review the spec requirements in .specia/changes/${changeName}/spec.md`);
    lines.push(`  2. Update ${file} to satisfy the flagged requirements`);
    lines.push(`  3. Address abuse case patterns identified above`);
    lines.push(`  4. Re-run validation or commit again to re-check\n`);

    return lines.join("\n");
  }
}
