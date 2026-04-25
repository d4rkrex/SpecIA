/**
 * Layer 4a: Heuristic Validation Engine — Fast spec violation detection.
 *
 * Module-level pure functions (same pattern as audit.ts, review.ts):
 * - extractRequirementKeywords() — NLP-lite keyword extraction from spec
 * - parseCodeElements() — AST parsing for code structure extraction
 * - scoreEvidence() — Weighted evidence scoring algorithm
 * - detectAbuseCasePatterns() — OWASP-based heuristic pattern detection
 * - filterScopeRelevantFiles() — File-to-requirement scope mapping
 * - computeL4aCacheKey() — Cache key computation for Layer 4a
 *
 * Performance target: <500ms for 1-5 files
 *
 * Spec refs: guardian-spec-aware — Domain 1 (Layer 4a Heuristics)
 * Design refs: guardian-spec-aware — Decisions 1-4
 *
 * v0.4: Phase 2 implementation
 */

import { createHash } from "node:crypto";
import { parse } from "@typescript-eslint/typescript-estree";
import type {
  CodeElements,
  RequirementKeywords,
  EvidenceSource,
  EvidenceScore,
  FlaggedAbuseCase,
} from "../types/guardian.js";

// ── Constants ────────────────────────────────────────────────────────

/** Domain-aware stop words for keyword extraction. */
const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "with",
  "from",
  "into",
  "through",
  "during",
  "before",
  "after",
  "above",
  "below",
  "system",
  "must",
  "should",
  "shall",
  "will",
  "may",
  "can",
  "via",
  "using",
  "by",
  "as",
  "be",
  "is",
  "are",
  "was",
  "were",
]);

/** OWASP-based abuse case pattern catalog. */
interface AbuseCasePattern {
  category: "sqli" | "xss" | "auth_bypass" | "csrf" | "xxe" | "deserialization";
  triggers: string[]; // File path patterns
  defensivePatterns: RegExp[];
  description: string;
}

const OWASP_PATTERNS: AbuseCasePattern[] = [
  {
    category: "sqli",
    triggers: ["db/", "sql/", "query", "repository", "database"],
    defensivePatterns: [
      /\.(query|execute)\s*\(\s*\$\d+/, // Parameterized queries: db.query($1, ...)
      /prisma\./,
      /knex\./,
      /sequelize\./,
      /typeorm\./,
      /prepare\s*\(/,
    ],
    description: "SQL injection mitigation (parameterized queries or ORM)",
  },
  {
    category: "xss",
    triggers: ["ui/", "view/", "template", "render", "component"],
    defensivePatterns: [
      /import\s+.*DOMPurify/,
      /import\s+.*escape-html/,
      /import\s+.*xss/,
      /\.escape\(/,
      /escapeHtml/,
    ],
    description: "XSS mitigation (HTML escaping or sanitization)",
  },
  {
    category: "auth_bypass",
    triggers: ["auth/", "middleware/", "guard", "login", "session"],
    defensivePatterns: [
      /jwt\.verify\(/,
      /import\s+.*jsonwebtoken/,
      /passport\.authenticate/,
      /verifyToken/,
      /checkAuth/,
      /requireAuth/,
    ],
    description: "Authentication bypass mitigation (token validation)",
  },
  {
    category: "csrf",
    triggers: ["api/", "routes/", "controller", "handler"],
    defensivePatterns: [
      /csrf/i,
      /csurf/,
      /SameSite/i,
      /csrfToken/,
    ],
    description: "CSRF mitigation (tokens or SameSite cookies)",
  },
  {
    category: "xxe",
    triggers: ["xml", "parse"],
    defensivePatterns: [
      /disableExternalEntities/,
      /noent:\s*false/,
      /xmlParserOptions/,
    ],
    description: "XXE mitigation (disable external entities)",
  },
  {
    category: "deserialization",
    triggers: ["deserialize", "unmarshal", "pickle"],
    defensivePatterns: [
      /JSON\.parse/,
      /safeParse/,
      /schema\.validate/,
    ],
    description: "Deserialization mitigation (safe parsing with validation)",
  },
];

/** Evidence weight mapping. */
const EVIDENCE_WEIGHTS = {
  function_name: 3,
  import: 3,
  type_def: 2,
  class_name: 2,
  variable: 1,
} as const;

// ── Keyword Extraction ───────────────────────────────────────────────

/**
 * Extract requirement keywords from spec content.
 *
 * Multi-stage NLP-lite extraction:
 * 1. Tokenize requirement descriptions
 * 2. Filter stop words
 * 3. Extract technical phrases (n-grams with acronyms)
 *
 * Spec refs: Domain 1 (Keyword Extraction from Spec Requirements)
 * Design refs: Decision 2 (Keyword Extraction Algorithm)
 *
 * @param specContent - Full spec.md content
 * @returns Array of RequirementKeywords (one per requirement)
 */
export function extractRequirementKeywords(
  specContent: string,
): RequirementKeywords[] {
  const requirements = parseRequirementsFromSpec(specContent);

  return requirements.map((req) => {
    const text = req.description.toLowerCase();

    // Stage 1: Tokenize and normalize (split on hyphens too for technical terms)
    const tokens = text
      .replace(/[^\w\s-]/g, " ")
      .replace(/-/g, " ") // Split hyphens into separate tokens (AES-256 → AES 256)
      .split(/\s+/)
      .filter(Boolean);

    // Stage 2: Filter stop words (but keep numbers for technical terms like "256")
    const keywords = new Set(
      tokens.filter((t) => !STOP_WORDS.has(t) && (t.length > 2 || /^\d+$/.test(t))),
    );

    // Stage 3: Extract phrases (technical n-grams)
    const phrases = new Set<string>();
    for (let i = 0; i < tokens.length - 1; i++) {
      const bigram = `${tokens[i]} ${tokens[i + 1]}`;
      if (isTechnicalPhrase(bigram)) {
        phrases.add(bigram);
      }
    }

    return {
      requirementId: req.id,
      keywords,
      phrases,
    };
  });
}

/**
 * Parse requirements from spec.md content.
 *
 * Extracts requirement blocks (#### Requirement: format).
 */
function parseRequirementsFromSpec(
  specContent: string,
): Array<{ id: string; description: string }> {
  const requirements: Array<{ id: string; description: string }> = [];
  const lines = specContent.split("\n");

  let inRequirement = false;
  let currentId = "";
  let currentDesc: string[] = [];

  for (const line of lines) {
    // Detect requirement headers
    if (line.startsWith("#### Requirement:")) {
      // Save previous requirement
      if (inRequirement && currentId) {
        requirements.push({
          id: currentId,
          description: currentDesc.join(" ").trim(),
        });
      }

      // Start new requirement
      const match = line.match(/#### Requirement:\s*(.+)/);
      currentId = match?.[1]?.trim() ?? `req-${requirements.length + 1}`;
      currentDesc = [];
      inRequirement = true;
    } else if (line.startsWith("##") && !line.startsWith("####")) {
      // End of requirement section
      if (inRequirement && currentId) {
        requirements.push({
          id: currentId,
          description: currentDesc.join(" ").trim(),
        });
      }
      inRequirement = false;
      currentId = "";
      currentDesc = [];
    } else if (inRequirement) {
      // Accumulate description lines
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("-") && !trimmed.startsWith("*")) {
        currentDesc.push(trimmed);
      }
    }
  }

  // Save last requirement
  if (inRequirement && currentId) {
    requirements.push({
      id: currentId,
      description: currentDesc.join(" ").trim(),
    });
  }

  return requirements;
}

/**
 * Heuristic: Check if a phrase is a technical term.
 *
 * Returns true if phrase contains uppercase acronym or known pattern.
 */
function isTechnicalPhrase(phrase: string): boolean {
  return (
    /\b[A-Z]{2,}\b/.test(phrase) ||
    /^(jwt|oauth|sql|xss|csrf|aes|rsa|sha|api|http|json|xml)\s/i.test(phrase)
  );
}

// ── AST Parsing ──────────────────────────────────────────────────────

/**
 * Extract code elements from file content via AST parsing.
 *
 * Uses @typescript-eslint/typescript-estree for TypeScript/JavaScript.
 * Falls back to text search on syntax errors or unsupported files.
 *
 * Spec refs: Domain 1 (Code Evidence Search via AST Parsing)
 * Design refs: Decision 1 (AST Parser Selection)
 *
 * @param filePath - File path (for file type detection)
 * @param content - File content to parse
 * @returns CodeElements with function names, imports, types, etc.
 */
export function parseCodeElements(
  filePath: string,
  content: string,
): CodeElements {
  // Check if file is TypeScript/JavaScript
  if (!isCodeFile(filePath)) {
    return extractViaTextSearch(content);
  }

  try {
    const ast = parse(content, {
      jsx: true,
      loc: true,
      range: true,
      comment: false,
      tokens: false,
    });

    return {
      functionNames: extractFunctionNames(ast),
      imports: extractImports(ast),
      typeNames: extractTypeNames(ast),
      classNames: extractClassNames(ast),
      variableNames: extractVariableNames(ast),
    };
  } catch {
    // Syntax error or unsupported syntax — fall back to text search
    return extractViaTextSearch(content);
  }
}

/**
 * Check if file is a code file (TypeScript/JavaScript).
 */
function isCodeFile(filePath: string): boolean {
  return /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(filePath);
}

/**
 * Extract function names from AST.
 */
function extractFunctionNames(
  ast: ReturnType<typeof parse>,
): Array<{ name: string; line: number }> {
  const functions: Array<{ name: string; line: number }> = [];

  function visit(node: any) {
    if (!node || typeof node !== "object") return;

    // Function declarations
    if (
      node.type === "FunctionDeclaration" ||
      node.type === "FunctionExpression"
    ) {
      if (node.id?.name) {
        functions.push({
          name: node.id.name,
          line: node.loc?.start.line ?? 0,
        });
      }
    }

    // Arrow functions with variable binding
    if (node.type === "VariableDeclarator" && node.init?.type === "ArrowFunctionExpression") {
      if (node.id?.name) {
        functions.push({
          name: node.id.name,
          line: node.loc?.start.line ?? 0,
        });
      }
    }

    // Method definitions
    if (node.type === "MethodDefinition") {
      if (node.key?.name) {
        functions.push({
          name: node.key.name,
          line: node.loc?.start.line ?? 0,
        });
      }
    }

    // Recurse into children
    for (const key in node) {
      if (key === "loc" || key === "range" || key === "parent") continue;
      const child = node[key];
      if (Array.isArray(child)) {
        child.forEach(visit);
      } else if (child && typeof child === "object") {
        visit(child);
      }
    }
  }

  visit(ast);
  return functions;
}

/**
 * Extract import statements from AST.
 */
function extractImports(
  ast: ReturnType<typeof parse>,
): Array<{ source: string; line: number }> {
  const imports: Array<{ source: string; line: number }> = [];

  function visit(node: any) {
    if (!node || typeof node !== "object") return;

    if (node.type === "ImportDeclaration") {
      if (node.source?.value) {
        imports.push({
          source: node.source.value,
          line: node.loc?.start.line ?? 0,
        });
      }
    }

    // Recurse
    for (const key in node) {
      if (key === "loc" || key === "range" || key === "parent") continue;
      const child = node[key];
      if (Array.isArray(child)) {
        child.forEach(visit);
      } else if (child && typeof child === "object") {
        visit(child);
      }
    }
  }

  visit(ast);
  return imports;
}

/**
 * Extract type definitions from AST.
 */
function extractTypeNames(
  ast: ReturnType<typeof parse>,
): Array<{ name: string; line: number }> {
  const types: Array<{ name: string; line: number }> = [];

  function visit(node: any) {
    if (!node || typeof node !== "object") return;

    if (
      node.type === "TSInterfaceDeclaration" ||
      node.type === "TSTypeAliasDeclaration" ||
      node.type === "TSEnumDeclaration"
    ) {
      if (node.id?.name) {
        types.push({
          name: node.id.name,
          line: node.loc?.start.line ?? 0,
        });
      }
    }

    // Recurse
    for (const key in node) {
      if (key === "loc" || key === "range" || key === "parent") continue;
      const child = node[key];
      if (Array.isArray(child)) {
        child.forEach(visit);
      } else if (child && typeof child === "object") {
        visit(child);
      }
    }
  }

  visit(ast);
  return types;
}

/**
 * Extract class names from AST.
 */
function extractClassNames(
  ast: ReturnType<typeof parse>,
): Array<{ name: string; line: number }> {
  const classes: Array<{ name: string; line: number }> = [];

  function visit(node: any) {
    if (!node || typeof node !== "object") return;

    if (node.type === "ClassDeclaration") {
      if (node.id?.name) {
        classes.push({
          name: node.id.name,
          line: node.loc?.start.line ?? 0,
        });
      }
    }

    // Recurse
    for (const key in node) {
      if (key === "loc" || key === "range" || key === "parent") continue;
      const child = node[key];
      if (Array.isArray(child)) {
        child.forEach(visit);
      } else if (child && typeof child === "object") {
        visit(child);
      }
    }
  }

  visit(ast);
  return classes;
}

/**
 * Extract variable names from AST.
 */
function extractVariableNames(
  ast: ReturnType<typeof parse>,
): Array<{ name: string; line: number }> {
  const variables: Array<{ name: string; line: number }> = [];

  function visit(node: any) {
    if (!node || typeof node !== "object") return;

    if (node.type === "VariableDeclarator") {
      if (node.id?.name) {
        variables.push({
          name: node.id.name,
          line: node.loc?.start.line ?? 0,
        });
      }
    }

    // Recurse
    for (const key in node) {
      if (key === "loc" || key === "range" || key === "parent") continue;
      const child = node[key];
      if (Array.isArray(child)) {
        child.forEach(visit);
      } else if (child && typeof child === "object") {
        visit(child);
      }
    }
  }

  visit(ast);
  return variables;
}

/**
 * Fall back to text search when AST parsing fails.
 */
function extractViaTextSearch(content: string): CodeElements {
  const functionNames: Array<{ name: string; line: number }> = [];
  const imports: Array<{ source: string; line: number }> = [];
  const typeNames: Array<{ name: string; line: number }> = [];
  const classNames: Array<{ name: string; line: number }> = [];
  const variableNames: Array<{ name: string; line: number }> = [];

  const lines = content.split("\n");

  lines.forEach((line, idx) => {
    const lineNum = idx + 1;

    // Function declarations
    const fnMatch = line.match(/function\s+(\w+)/);
    if (fnMatch?.[1]) {
      functionNames.push({ name: fnMatch[1], line: lineNum });
    }

    // Arrow functions
    const arrowMatch = line.match(/const\s+(\w+)\s*=\s*\(/);
    if (arrowMatch?.[1]) {
      functionNames.push({ name: arrowMatch[1], line: lineNum });
    }

    // Imports
    const importMatch = line.match(/import\s+.*from\s+['"](.+)['"]/);
    if (importMatch?.[1]) {
      imports.push({ source: importMatch[1], line: lineNum });
    }

    // Types
    const typeMatch = line.match(/(?:type|interface)\s+(\w+)/);
    if (typeMatch?.[1]) {
      typeNames.push({ name: typeMatch[1], line: lineNum });
    }

    // Classes
    const classMatch = line.match(/class\s+(\w+)/);
    if (classMatch?.[1]) {
      classNames.push({ name: classMatch[1], line: lineNum });
    }

    // Variables
    const varMatch = line.match(/(?:const|let|var)\s+(\w+)/);
    if (varMatch?.[1]) {
      variableNames.push({ name: varMatch[1], line: lineNum });
    }
  });

  return {
    functionNames,
    imports,
    typeNames,
    classNames,
    variableNames,
  };
}

// ── Evidence Scoring ─────────────────────────────────────────────────

/**
 * Score evidence for a requirement based on code elements.
 *
 * Weighted scoring:
 * - Function names: weight 3 (highest confidence)
 * - Imports: weight 3 (security libraries)
 * - Type definitions: weight 2 (domain entities)
 * - Class names: weight 2
 * - Variables: weight 1 (lower confidence)
 *
 * Returns score 0 if no evidence found (triggers Layer 4b).
 *
 * Spec refs: Domain 1 (Code Evidence Search scenarios)
 * Design refs: Decision 3 (Evidence Scoring Algorithm)
 *
 * @param keywords - Requirement keywords
 * @param codeElements - AST-extracted code elements
 * @param filePath - File path (for location strings)
 * @returns EvidenceScore with score and sources
 */
export function scoreEvidence(
  keywords: RequirementKeywords,
  codeElements: CodeElements,
  filePath: string,
): EvidenceScore {
  const sources: EvidenceSource[] = [];

  // Function names (weight 3)
  for (const fn of codeElements.functionNames) {
    if (matchesKeywords(fn.name, keywords.keywords, keywords.phrases)) {
      sources.push({
        type: "function_name",
        weight: EVIDENCE_WEIGHTS.function_name,
        match: fn.name,
        location: `${filePath}:${fn.line}`,
      });
    }
  }

  // Imports (weight 3)
  for (const imp of codeElements.imports) {
    if (matchesKeywords(imp.source, keywords.keywords, keywords.phrases)) {
      sources.push({
        type: "import",
        weight: EVIDENCE_WEIGHTS.import,
        match: imp.source,
        location: `${filePath}:${imp.line}`,
      });
    }
  }

  // Type definitions (weight 2)
  for (const type of codeElements.typeNames) {
    if (matchesKeywords(type.name, keywords.keywords, keywords.phrases)) {
      sources.push({
        type: "type_def",
        weight: EVIDENCE_WEIGHTS.type_def,
        match: type.name,
        location: `${filePath}:${type.line}`,
      });
    }
  }

  // Class names (weight 2)
  for (const cls of codeElements.classNames) {
    if (matchesKeywords(cls.name, keywords.keywords, keywords.phrases)) {
      sources.push({
        type: "class_name",
        weight: EVIDENCE_WEIGHTS.class_name,
        match: cls.name,
        location: `${filePath}:${cls.line}`,
      });
    }
  }

  // Variables (weight 1)
  for (const variable of codeElements.variableNames) {
    if (matchesKeywords(variable.name, keywords.keywords, keywords.phrases)) {
      sources.push({
        type: "variable",
        weight: EVIDENCE_WEIGHTS.variable,
        match: variable.name,
        location: `${filePath}:${variable.line}`,
      });
    }
  }

  const score = sources.reduce((sum, s) => sum + s.weight, 0);
  return { score, sources };
}

/**
 * Check if identifier matches any keywords or phrases.
 * Case-insensitive matching with fuzzy acronym matching.
 */
function matchesKeywords(
  identifier: string,
  keywords: Set<string>,
  phrases: Set<string>,
): boolean {
  const lower = identifier.toLowerCase();

  // Match keywords (case-insensitive)
  for (const kw of keywords) {
    const kwLower = kw.toLowerCase();
    if (lower.includes(kwLower)) {
      return true;
    }
    
    // Fuzzy match for acronyms: "jwt" matches "jsonwebtoken"
    if (isAcronymMatch(kwLower, lower)) {
      return true;
    }
  }

  // Match phrases
  for (const phrase of phrases) {
    const phraseLower = phrase.toLowerCase();
    if (lower.includes(phraseLower)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if acronym matches identifier.
 * Example: "jwt" matches "jsonwebtoken", "sql" matches "sqlinjection"
 */
function isAcronymMatch(acronym: string, identifier: string): boolean {
  // Only match short keywords (2-5 chars) as potential acronyms
  if (acronym.length < 2 || acronym.length > 5) {
    return false;
  }
  
  // Check if identifier starts with acronym letters in sequence
  let pos = 0;
  for (const char of acronym) {
    const idx = identifier.indexOf(char, pos);
    if (idx === -1) {
      return false;
    }
    pos = idx + 1;
  }
  
  return true;
}

// ── Abuse Case Pattern Detection ─────────────────────────────────────

/**
 * Detect abuse case violations using OWASP-based heuristic patterns.
 *
 * Checks for presence of defensive patterns (parameterized queries, sanitization, etc.).
 * Returns flagged abuse cases (missing defensive patterns).
 *
 * Spec refs: Domain 1 (Abuse Case Pattern Detection)
 * Design refs: Decision 4 (OWASP-based abuse case pattern detection)
 *
 * @param abuseCases - Abuse cases from review.md
 * @param stagedFiles - Staged file paths
 * @param codeContents - Map of file path → file content
 * @returns FlaggedAbuseCase[] (abuse cases with missing defensive patterns)
 */
export function detectAbuseCasePatterns(
  abuseCases: Array<{ id: string; description: string; mitigation: string }>,
  stagedFiles: string[],
  codeContents: Map<string, string>,
): FlaggedAbuseCase[] {
  const flagged: FlaggedAbuseCase[] = [];

  for (const abuseCase of abuseCases) {
    // Classify abuse case to OWASP category
    const category = classifyAbuseCase(abuseCase.description);
    if (!category) continue; // Not security-relevant

    const pattern = OWASP_PATTERNS.find((p) => p.category === category);
    if (!pattern) continue;

    // Check if any staged files match the trigger patterns
    const relevantFiles = stagedFiles.filter((f) =>
      pattern.triggers.some((trigger) => f.includes(trigger)),
    );

    if (relevantFiles.length === 0) continue; // Abuse case not relevant to this commit

    // Check for defensive patterns in relevant files
    let foundDefense = false;
    for (const file of relevantFiles) {
      const content = codeContents.get(file) ?? "";
      if (pattern.defensivePatterns.some((regex) => regex.test(content))) {
        foundDefense = true;
        break;
      }
    }

    if (!foundDefense) {
      flagged.push({
        abuseCaseId: abuseCase.id,
        category,
        description: abuseCase.description,
        mitigation: abuseCase.mitigation,
        affectedFiles: relevantFiles,
        missingPattern: pattern.description,
      });
    }
  }

  return flagged;
}

/**
 * Classify abuse case description to OWASP category.
 */
function classifyAbuseCase(
  description: string,
): AbuseCasePattern["category"] | null {
  const lower = description.toLowerCase();

  if (/sql.*(injection|inject)/i.test(lower)) return "sqli";
  if (/xss|script.*inject|cross.*site.*script/i.test(lower)) return "xss";
  if (/auth.*(bypass|skip)|unauthorized.*access/i.test(lower))
    return "auth_bypass";
  if (/csrf|cross.*site.*request/i.test(lower)) return "csrf";
  if (/xxe|xml.*external/i.test(lower)) return "xxe";
  if (/deseriali[zs]ation|pickle|marshal/i.test(lower))
    return "deserialization";

  return null;
}

// ── File Scope Detection ─────────────────────────────────────────────

/**
 * Map files to requirements based on file path and requirement scope.
 *
 * Heuristic mapping:
 * - Check if file path matches directory patterns (e.g., src/auth/ for auth requirements)
 * - Check if file is explicitly mentioned in spec
 * - Skip files with zero mapped requirements (instant pass)
 *
 * Spec refs: Domain 1 (File-to-Requirement Scope Detection)
 * Design refs: Decision 2 (Scope detection heuristics)
 *
 * @param stagedFiles - Staged file paths
 * @param requirements - Requirement keywords
 * @param scopePaths - Scope paths from proposal (optional)
 * @returns Filtered list of relevant files
 */
export function filterScopeRelevantFiles(
  stagedFiles: string[],
  requirements: RequirementKeywords[],
  scopePaths?: string[],
): string[] {
  return stagedFiles.filter((file) => {
    // Check scope paths (if provided) — strict filtering
    if (scopePaths && scopePaths.length > 0) {
      return scopePaths.some((scope) => file.includes(scope));
    }

    // Check if file path suggests relevance to any requirement
    for (const req of requirements) {
      for (const keyword of req.keywords) {
        if (file.toLowerCase().includes(keyword)) {
          return true;
        }
      }
    }

    // Default: include file (conservative — Layer 4a will score it)
    return true;
  });
}

// ── Cache Key Computation ────────────────────────────────────────────

/**
 * Compute Layer 4a cache key.
 *
 * Cache key format: SHA256("l4a:" + fileSha + ":" + specKeywordsHash)
 *
 * Spec refs: Domain 1 (Heuristic Result Caching), Domain 3 (Cache key format)
 * Design refs: Decision 6 (Dual Cache System Design)
 *
 * @param fileSha - SHA256 of file content
 * @param specKeywordsHash - Hash of spec keywords
 * @returns Hex-encoded cache key
 */
export function computeL4aCacheKey(
  fileSha: string,
  specKeywordsHash: string,
): string {
  return createHash("sha256")
    .update(`l4a:${fileSha}:${specKeywordsHash}`)
    .digest("hex");
}

/**
 * Compute spec keywords hash (stable unless requirement text changes).
 *
 * Canonical format: requirementId:keyword1,keyword2,...|requirementId:...
 *
 * @param keywords - Array of RequirementKeywords
 * @returns Hex-encoded hash
 */
export function computeSpecKeywordsHash(
  keywords: RequirementKeywords[],
): string {
  const canonical = keywords
    .map(
      (kw) =>
        `${kw.requirementId}:${Array.from(kw.keywords).sort().join(",")}`,
    )
    .sort()
    .join("|");

  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
