/**
 * specia_done — Archive a completed change.
 *
 * Copies spec to .specia/specs/ with review + audit frontmatter,
 * removes the change directory. Stores archived spec in Alejandria
 * for cross-session search.
 *
 * v0.3: Accepts changes in "audit" phase as archivable.
 *       Adds warnings for skipped or stale audits.
 *       Includes audit frontmatter in archived spec.
 *
 * v0.5: Mandatory audit gate — refuses to archive when audit_policy
 *       is "required" and audit not completed. Emergency force override.
 *
 * Spec refs: Domain 2 (specia_done — all scenarios),
 *            Domain 5 (specia_done Update — accept audit, warnings),
 *            Domain 7 (Staleness Warning on specia_done),
 *            Domain 10 (Audit in Archived Spec)
 * Design refs: Decision 2 (FileStore.archiveChange),
 *              Decision 4 (What Gets Stored Where),
 *              Decision 7 (State machine — "audit" optional between tasks/done),
 *              Decision 14 (Archival integration — audit frontmatter)
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { FileStore } from "../services/store.js";
import { EMPTY_SHA256_SENTINEL } from "../services/audit.js";
import { tryStore } from "../services/memory-ops.js";
import { DoneInputSchema } from "./schemas.js";
import { ok, fail, ErrorCodes } from "../types/tools.js";
import type { ToolResult } from "../types/index.js";

export interface DoneResult {
  archived_path: string;
}

export async function handleDone(
  args: unknown,
  rootDir: string,
): Promise<ToolResult<DoneResult>> {
  const start = Date.now();
  const toolName = "specia_done";
  const warnings: string[] = [];

  // Input validation
  const parsed = DoneInputSchema.safeParse(args);
  if (!parsed.success) {
    return fail(toolName, parsed.error.issues.map((i) => ({
      code: ErrorCodes.VALIDATION_ERROR,
      message: i.message,
      field: i.path.join("."),
    })), { duration_ms: Date.now() - start });
  }

  const input = parsed.data;
  const store = new FileStore(rootDir);

  // Check project is initialized
  if (!store.isInitialized()) {
    return fail(toolName, [{
      code: ErrorCodes.NOT_INITIALIZED,
      message: "Run specia_init first — .specia/config.yaml not found.",
    }], { change: input.change_name, duration_ms: Date.now() - start });
  }

  // Check change exists
  const state = store.getChangeState(input.change_name);
  if (!state) {
    return fail(toolName, [{
      code: ErrorCodes.CHANGE_NOT_FOUND,
      message: `Change "${input.change_name}" not found.`,
    }], { change: input.change_name, duration_ms: Date.now() - start });
  }

  // Check all phases are complete — tasks or audit must be the current phase and complete
  // v0.3: Accept either "tasks" or "audit" phase as archivable (audit is optional)
  const isReady =
    (state.phase === "tasks" || state.phase === "audit") &&
    state.status === "complete";

  if (!isReady) {
    return fail(toolName, [{
      code: ErrorCodes.INCOMPLETE_CHANGE,
      message: `Change "${input.change_name}" is not ready for archival. Current phase: ${state.phase} (${state.status}). All phases through "tasks" must be complete.`,
    }], { change: input.change_name, duration_ms: Date.now() - start });
  }

  // v0.5: Mandatory audit gate enforcement
  const auditPolicy = state.audit_policy ?? "required"; // Default to "required" for backward compat with pre-v0.5 changes
  const auditCompleted = state.phases_completed.includes("audit");

  if (auditPolicy === "required" && !auditCompleted) {
    // D-01/D-02: Emergency force override
    if (input.force) {
      warnings.push("⚠️ EMERGENCY OVERRIDE: Audit gate bypassed via force flag. This change is being archived without a completed audit despite audit_policy being 'required'. This should only be used for critical hotfix scenarios.");

      // D-01: Persist force flag usage in state.yaml for audit trail
      store.setChangeState(input.change_name, {
        ...state,
        archived_with_force: true,
      });
    } else {
      // I-01: Generic error message — does not leak parameter names
      return fail(toolName, [{
        code: ErrorCodes.AUDIT_REQUIRED,
        message: `Post-implementation audit is mandatory for change "${input.change_name}". Run specia_audit to complete the audit before archiving. Audit policy can only be configured at proposal creation time — see documentation for workflow options.`,
      }], { change: input.change_name, duration_ms: Date.now() - start });
    }
  }

  // v0.5: Informational note when audit was opted out
  if (auditPolicy === "skipped" && !auditCompleted) {
    warnings.push("Audit was opted out at proposal time. Archiving without post-implementation audit.");
  }

  // T-03 / Requirement 4: Validate audit content quality when audit.md exists
  // v0.6: BLOCKING gate (was warning-only before fix-empty-audit)
  if (auditCompleted) {
    const auditContent = store.readArtifact(input.change_name, "audit");
    if (auditContent) {
      const contentQuality = validateAuditMinContent(auditContent);
      if (!contentQuality.valid) {
        if (input.force) {
          warnings.push(`⚠️ EMERGENCY OVERRIDE: Audit content quality check bypassed via force flag. Issues: ${contentQuality.reason}`);
          // D-01: Persist force override for content quality bypass too
          const freshState = store.getChangeState(input.change_name);
          if (freshState) {
            store.setChangeState(input.change_name, {
              ...freshState,
              archived_with_force: true,
            });
          }
        } else {
          return fail(toolName, [{
            code: ErrorCodes.AUDIT_CONTENT_INSUFFICIENT,
            message: `Audit content does not meet minimum quality requirements for change "${input.change_name}": ${contentQuality.reason}. ` +
              "Review and re-run the audit, or use force: true for emergency override.",
          }], { change: input.change_name, duration_ms: Date.now() - start });
        }
      }

      // T-02: Verify audit.md content hash hasn't been tampered with
      if (state.audit_content_hash) {
        const currentHash = "sha256:" + crypto.createHash("sha256")
          .update(auditContent, "utf-8")
          .digest("hex");
        if (currentHash !== state.audit_content_hash) {
          warnings.push(
            `⚠️ AUDIT_INTEGRITY_WARNING: audit.md content hash does not match the hash stored at Phase 2 completion. ` +
            `Expected: ${state.audit_content_hash.substring(0, 20)}..., Found: ${currentHash.substring(0, 20)}... ` +
            `The audit.md file may have been modified after the audit was completed.`,
          );
        }
      }

      // T-03: Reject empty SHA256 sentinel in audit_hash
      if (state.audit_hash === EMPTY_SHA256_SENTINEL) {
        if (!input.force) {
          return fail(toolName, [{
            code: ErrorCodes.AUDIT_CONTENT_INSUFFICIENT,
            message: `Audit hash for change "${input.change_name}" is the empty-string SHA256 sentinel, indicating zero files were audited. ` +
              "Re-run the audit with actual code files.",
          }], { change: input.change_name, duration_ms: Date.now() - start });
        } else {
          warnings.push("⚠️ EMERGENCY OVERRIDE: Empty SHA256 audit hash bypassed via force flag.");
        }
      }
    }

    // Check for stale audit
    if (state.audit_stale) {
      warnings.push("Audit is stale — code changed after audit was performed. Consider re-running specia_audit.");
    }
  } else if (auditPolicy !== "required") {
    // Legacy behavior: audit not performed warning for pre-v0.5 "skipped" or unset
    if (!auditCompleted && auditPolicy !== "skipped") {
      warnings.push("Audit not performed. Consider running specia_audit before archiving.");
    }
  }

  // Read spec content before archiving for Alejandria storage
  const specContent = store.readArtifact(input.change_name, "spec");
  const config = store.readConfig();

  // Archive the change (v0.6: with force flag info and audit/review preservation)
  // v0.7: archiveChange() returns the actual archived path (fix-done-verification)
  let archivedAbsPath: string;
  try {
    archivedAbsPath = store.archiveChange(input.change_name, { force: input.force });
  } catch (err) {
    return fail(toolName, [{
      code: ErrorCodes.IO_ERROR,
      message: `Failed to archive change: ${err instanceof Error ? err.message : String(err)}`,
    }], { change: input.change_name, duration_ms: Date.now() - start });
  }

  // v0.7: Post-write disk verification (fix-done-verification)
  // Verify the archived file actually exists on disk before returning success
  if (!fs.existsSync(archivedAbsPath)) {
    return fail(toolName, [{
      code: ErrorCodes.IO_ERROR,
      message: `Archived file could not be verified on disk at expected path. The file may have been removed between write and verification.`,
    }], { change: input.change_name, duration_ms: Date.now() - start });
  }

  // Convert absolute path to relative for portability in the response
  const archivedRelPath = path.relative(rootDir, archivedAbsPath);

  // Store archived spec in memory for FTS5 search (any backend)
  if (specContent) {
    const { error: storeError } = await tryStore(config.memory, specContent, {
      topic_key: `specia/${config.project.name}/spec/${input.change_name}`,
      topic: "archived-spec",
      summary: `Archived spec for change "${input.change_name}" in project ${config.project.name}`,
      importance: "medium",
    });
    if (storeError) {
      warnings.push(storeError);
    }
  }

  return ok(
    toolName,
    {
      archived_path: archivedRelPath,
    },
    { change: input.change_name, duration_ms: Date.now() - start, warnings },
  );
}

/**
 * T-03 / Requirement 4: Validate minimum content quality for audit.md.
 * v0.6: Returns structured result with reason (was boolean before fix-empty-audit).
 *
 * Checks:
 * 1. Must have YAML frontmatter
 * 2. Must have at least 100 chars of body content after frontmatter
 * 3. Must contain "Requirements" or "requirements" section
 * 4. Must contain "Abuse Case" or "abuse_case" section
 */
function validateAuditMinContent(content: string): { valid: boolean; reason: string } {
  // Must have frontmatter
  if (!content.includes("---")) {
    return { valid: false, reason: "Audit.md is missing YAML frontmatter." };
  }
  // Must have at least some non-frontmatter content (> 100 chars after frontmatter)
  const afterFrontmatter = content.replace(/^---[\s\S]*?---/, "").trim();
  if (afterFrontmatter.length < 100) {
    return {
      valid: false,
      reason: `Audit.md body has only ${afterFrontmatter.length} characters (minimum 100). The audit content appears to be empty or minimal.`,
    };
  }
  // Must contain at least one of the expected sections
  const hasRequirements = content.includes("Requirements") || content.includes("requirements");
  const hasAbuseCases = content.includes("Abuse Case") || content.includes("abuse_case");
  if (!hasRequirements && !hasAbuseCases) {
    return {
      valid: false,
      reason: "Audit.md is missing both 'Requirements' and 'Abuse Case' sections. A valid audit must contain at least one verification section.",
    };
  }
  if (!hasRequirements) {
    return {
      valid: false,
      reason: "Audit.md is missing the 'Requirements' verification section.",
    };
  }
  if (!hasAbuseCases) {
    return {
      valid: false,
      reason: "Audit.md is missing the 'Abuse Case' verification section.",
    };
  }
  return { valid: true, reason: "" };
}
