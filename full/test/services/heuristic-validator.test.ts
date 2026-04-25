/**
 * Tests for Layer 4a: Heuristic Validation Engine
 *
 * Covers:
 * - Keyword extraction from spec requirements
 * - AST parsing and code element extraction
 * - Evidence scoring algorithm
 * - OWASP abuse case pattern detection
 * - File scope filtering
 * - Cache key computation
 */

import { describe, it, expect } from "vitest";
import {
  extractRequirementKeywords,
  parseCodeElements,
  scoreEvidence,
  detectAbuseCasePatterns,
  filterScopeRelevantFiles,
  computeL4aCacheKey,
  computeSpecKeywordsHash,
} from "../../src/services/heuristic-validator.js";

// ── Keyword Extraction Tests ────────────────────────────────────────

describe("extractRequirementKeywords", () => {
  it("should extract keywords from simple requirement", () => {
    const spec = `
#### Requirement: Authenticate users

The system MUST authenticate users via JWT tokens.
`;

    const result = extractRequirementKeywords(spec);
    expect(result).toHaveLength(1);
    expect(result[0].requirementId).toBe("Authenticate users");
    expect(result[0].keywords.has("authenticate")).toBe(true);
    expect(result[0].keywords.has("users")).toBe(true);
    expect(result[0].keywords.has("jwt")).toBe(true);
    expect(result[0].keywords.has("tokens")).toBe(true);
    // Stop words filtered
    expect(result[0].keywords.has("the")).toBe(false);
    expect(result[0].keywords.has("must")).toBe(false);
  });

  it("should extract technical phrases", () => {
    const spec = `
#### Requirement: Encryption

The system MUST encrypt data using AES-256 encryption.
`;

    const result = extractRequirementKeywords(spec);
    expect(result[0].phrases.has("aes 256")).toBe(true); // Technical phrase extracted
    expect(result[0].keywords.has("aes")).toBe(true);
    expect(result[0].keywords.has("256")).toBe(true);
  });

  it("should handle multiple requirements", () => {
    const spec = `
#### Requirement: Authentication

System must authenticate users.

#### Requirement: Authorization

System must authorize requests.
`;

    const result = extractRequirementKeywords(spec);
    expect(result).toHaveLength(2);
    expect(result[0].requirementId).toBe("Authentication");
    expect(result[1].requirementId).toBe("Authorization");
  });

  it("should handle empty spec", () => {
    const result = extractRequirementKeywords("");
    expect(result).toEqual([]);
  });

  it("should filter short tokens", () => {
    const spec = `
#### Requirement: Test

The system is at a new level.
`;

    const result = extractRequirementKeywords(spec);
    // "is", "at", "a" are too short (length <= 2)
    expect(result[0].keywords.has("is")).toBe(false);
    expect(result[0].keywords.has("at")).toBe(false);
    expect(result[0].keywords.has("new")).toBe(true);
    expect(result[0].keywords.has("level")).toBe(true);
  });
});

// ── AST Parsing Tests ───────────────────────────────────────────────

describe("parseCodeElements", () => {
  it("should extract function names from TypeScript", () => {
    const code = `
function authenticateUser(token: string) {
  return verify(token);
}

const validateToken = (token: string) => {
  return decode(token);
};
`;

    const result = parseCodeElements("test.ts", code);
    expect(result.functionNames).toHaveLength(2);
    expect(result.functionNames[0].name).toBe("authenticateUser");
    expect(result.functionNames[1].name).toBe("validateToken");
  });

  it("should extract imports", () => {
    const code = `
import jwt from 'jsonwebtoken';
import { verify } from './auth';
import bcrypt from 'bcrypt';
`;

    const result = parseCodeElements("test.ts", code);
    expect(result.imports).toHaveLength(3);
    expect(result.imports[0].source).toBe("jsonwebtoken");
    expect(result.imports[1].source).toBe("./auth");
    expect(result.imports[2].source).toBe("bcrypt");
  });

  it("should extract type definitions", () => {
    const code = `
interface User {
  id: string;
}

type AuthToken = string;

enum Role {
  Admin,
  User,
}
`;

    const result = parseCodeElements("test.ts", code);
    expect(result.typeNames).toHaveLength(3);
    expect(result.typeNames[0].name).toBe("User");
    expect(result.typeNames[1].name).toBe("AuthToken");
    expect(result.typeNames[2].name).toBe("Role");
  });

  it("should extract class names", () => {
    const code = `
class AuthService {
  verify(token: string) {
    return true;
  }
}
`;

    const result = parseCodeElements("test.ts", code);
    expect(result.classNames).toHaveLength(1);
    expect(result.classNames[0].name).toBe("AuthService");
  });

  it("should extract variable names", () => {
    const code = `
const jwtSecret = 'secret';
let tokenCache: Map<string, string>;
var legacyAuth = true;
`;

    const result = parseCodeElements("test.ts", code);
    expect(result.variableNames).toHaveLength(3);
    expect(result.variableNames[0].name).toBe("jwtSecret");
    expect(result.variableNames[1].name).toBe("tokenCache");
    expect(result.variableNames[2].name).toBe("legacyAuth");
  });

  it("should fall back to text search on syntax errors", () => {
    const code = `
function broken( {
  // syntax error
}

function working() {
  return true;
}
`;

    const result = parseCodeElements("test.ts", code);
    // Text search should still find the working function
    expect(result.functionNames.length).toBeGreaterThan(0);
    const names = result.functionNames.map((f) => f.name);
    expect(names).toContain("working");
  });

  it("should handle unsupported file types", () => {
    const code = `
def authenticate_user(token):
    return verify(token)
`;

    const result = parseCodeElements("test.py", code);
    // Non-JS/TS file → text search fallback
    expect(result.functionNames).toEqual([]);
    expect(result.imports).toEqual([]);
  });

  it("should extract method definitions from classes", () => {
    const code = `
class UserService {
  authenticateUser(token: string) {
    return verify(token);
  }

  validateSession() {
    return true;
  }
}
`;

    const result = parseCodeElements("test.ts", code);
    expect(result.functionNames).toHaveLength(2);
    expect(result.functionNames[0].name).toBe("authenticateUser");
    expect(result.functionNames[1].name).toBe("validateSession");
  });
});

// ── Evidence Scoring Tests ──────────────────────────────────────────

describe("scoreEvidence", () => {
  it("should score function name match (weight 3)", () => {
    const keywords = {
      requirementId: "auth",
      keywords: new Set(["authenticate", "user"]),
      phrases: new Set(),
    };

    const codeElements = {
      functionNames: [{ name: "authenticateUser", line: 5 }],
      imports: [],
      typeNames: [],
      classNames: [],
      variableNames: [],
    };

    const result = scoreEvidence(keywords, codeElements, "test.ts");
    expect(result.score).toBe(3);
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].type).toBe("function_name");
    expect(result.sources[0].match).toBe("authenticateUser");
  });

  it("should score import match (weight 3)", () => {
    const keywords = {
      requirementId: "auth",
      keywords: new Set(["jwt", "token"]),
      phrases: new Set(),
    };

    const codeElements = {
      functionNames: [],
      imports: [{ source: "jsonwebtoken", line: 1 }],
      typeNames: [],
      classNames: [],
      variableNames: [],
    };

    const result = scoreEvidence(keywords, codeElements, "test.ts");
    expect(result.score).toBe(3);
    expect(result.sources[0].type).toBe("import");
  });

  it("should score type definition match (weight 2)", () => {
    const keywords = {
      requirementId: "auth",
      keywords: new Set(["user", "auth"]),
      phrases: new Set(),
    };

    const codeElements = {
      functionNames: [],
      imports: [],
      typeNames: [{ name: "AuthenticatedUser", line: 3 }],
      classNames: [],
      variableNames: [],
    };

    const result = scoreEvidence(keywords, codeElements, "test.ts");
    expect(result.score).toBe(2);
    expect(result.sources[0].type).toBe("type_def");
  });

  it("should score class name match (weight 2)", () => {
    const keywords = {
      requirementId: "auth",
      keywords: new Set(["auth", "service"]),
      phrases: new Set(),
    };

    const codeElements = {
      functionNames: [],
      imports: [],
      typeNames: [],
      classNames: [{ name: "AuthService", line: 10 }],
      variableNames: [],
    };

    const result = scoreEvidence(keywords, codeElements, "test.ts");
    expect(result.score).toBe(2);
    expect(result.sources[0].type).toBe("class_name");
  });

  it("should score variable match (weight 1)", () => {
    const keywords = {
      requirementId: "auth",
      keywords: new Set(["jwt", "secret"]),
      phrases: new Set(),
    };

    const codeElements = {
      functionNames: [],
      imports: [],
      typeNames: [],
      classNames: [],
      variableNames: [{ name: "jwtSecret", line: 2 }],
    };

    const result = scoreEvidence(keywords, codeElements, "test.ts");
    expect(result.score).toBe(1);
    expect(result.sources[0].type).toBe("variable");
  });

  it("should return score 0 when no evidence found", () => {
    const keywords = {
      requirementId: "auth",
      keywords: new Set(["authenticate", "jwt"]),
      phrases: new Set(),
    };

    const codeElements = {
      functionNames: [{ name: "unrelated", line: 1 }],
      imports: [],
      typeNames: [],
      classNames: [],
      variableNames: [],
    };

    const result = scoreEvidence(keywords, codeElements, "test.ts");
    expect(result.score).toBe(0);
    expect(result.sources).toHaveLength(0);
  });

  it("should aggregate multiple evidence sources", () => {
    const keywords = {
      requirementId: "auth",
      keywords: new Set(["auth", "user", "jwt"]),
      phrases: new Set(),
    };

    const codeElements = {
      functionNames: [{ name: "authenticateUser", line: 5 }],
      imports: [{ source: "jsonwebtoken", line: 1 }],
      typeNames: [{ name: "User", line: 3 }],
      classNames: [],
      variableNames: [{ name: "authToken", line: 10 }],
    };

    const result = scoreEvidence(keywords, codeElements, "test.ts");
    // 3 (function) + 3 (import) + 2 (type) + 1 (variable) = 9
    expect(result.score).toBe(9);
    expect(result.sources).toHaveLength(4);
  });

  it("should include file:line location in sources", () => {
    const keywords = {
      requirementId: "auth",
      keywords: new Set(["authenticate"]),
      phrases: new Set(),
    };

    const codeElements = {
      functionNames: [{ name: "authenticate", line: 42 }],
      imports: [],
      typeNames: [],
      classNames: [],
      variableNames: [],
    };

    const result = scoreEvidence(keywords, codeElements, "src/auth.ts");
    expect(result.sources[0].location).toBe("src/auth.ts:42");
  });
});

// ── Abuse Case Pattern Detection Tests ──────────────────────────────

describe("detectAbuseCasePatterns", () => {
  it("should flag SQL injection without parameterized queries", () => {
    const abuseCases = [
      {
        id: "AC-001",
        description: "SQL injection via user input",
        mitigation: "Use parameterized queries",
      },
    ];

    const stagedFiles = ["src/db/users.ts"];
    const codeContents = new Map([
      [
        "src/db/users.ts",
        `
const query = "SELECT * FROM users WHERE id = " + userId;
db.execute(query);
`,
      ],
    ]);

    const result = detectAbuseCasePatterns(
      abuseCases,
      stagedFiles,
      codeContents,
    );

    expect(result).toHaveLength(1);
    expect(result[0].abuseCaseId).toBe("AC-001");
    expect(result[0].category).toBe("sqli");
    expect(result[0].affectedFiles).toContain("src/db/users.ts");
  });

  it("should NOT flag SQL injection with parameterized queries", () => {
    const abuseCases = [
      {
        id: "AC-001",
        description: "SQL injection via user input",
        mitigation: "Use parameterized queries",
      },
    ];

    const stagedFiles = ["src/db/users.ts"];
    const codeContents = new Map([
      [
        "src/db/users.ts",
        `
db.query($1, [userId]);
`,
      ],
    ]);

    const result = detectAbuseCasePatterns(
      abuseCases,
      stagedFiles,
      codeContents,
    );

    expect(result).toHaveLength(0);
  });

  it("should NOT flag SQL injection with ORM (prisma)", () => {
    const abuseCases = [
      {
        id: "AC-001",
        description: "SQL injection via user input",
        mitigation: "Use parameterized queries",
      },
    ];

    const stagedFiles = ["src/db/repository.ts"];
    const codeContents = new Map([
      [
        "src/db/repository.ts",
        `
const user = await prisma.user.findUnique({ where: { id: userId } });
`,
      ],
    ]);

    const result = detectAbuseCasePatterns(
      abuseCases,
      stagedFiles,
      codeContents,
    );

    expect(result).toHaveLength(0);
  });

  it("should flag XSS without sanitization", () => {
    const abuseCases = [
      {
        id: "AC-002",
        description: "XSS via script injection",
        mitigation: "Sanitize user input",
      },
    ];

    const stagedFiles = ["src/ui/display.tsx"];
    const codeContents = new Map([
      [
        "src/ui/display.tsx",
        `
const html = "<div>" + userInput + "</div>";
element.innerHTML = html;
`,
      ],
    ]);

    const result = detectAbuseCasePatterns(
      abuseCases,
      stagedFiles,
      codeContents,
    );

    expect(result).toHaveLength(1);
    expect(result[0].category).toBe("xss");
  });

  it("should NOT flag XSS with DOMPurify", () => {
    const abuseCases = [
      {
        id: "AC-002",
        description: "XSS via script injection",
        mitigation: "Sanitize user input",
      },
    ];

    const stagedFiles = ["src/ui/display.tsx"];
    const codeContents = new Map([
      [
        "src/ui/display.tsx",
        `
import DOMPurify from 'dompurify';
const clean = DOMPurify.sanitize(userInput);
`,
      ],
    ]);

    const result = detectAbuseCasePatterns(
      abuseCases,
      stagedFiles,
      codeContents,
    );

    expect(result).toHaveLength(0);
  });

  it("should flag auth bypass without token validation", () => {
    const abuseCases = [
      {
        id: "AC-003",
        description: "Authentication bypass via missing token validation",
        mitigation: "Verify JWT tokens",
      },
    ];

    const stagedFiles = ["src/auth/middleware.ts"];
    const codeContents = new Map([
      [
        "src/auth/middleware.ts",
        `
function auth(req, res, next) {
  const token = req.headers.authorization;
  // Missing validation
  next();
}
`,
      ],
    ]);

    const result = detectAbuseCasePatterns(
      abuseCases,
      stagedFiles,
      codeContents,
    );

    expect(result).toHaveLength(1);
    expect(result[0].category).toBe("auth_bypass");
  });

  it("should NOT flag auth bypass with jwt.verify", () => {
    const abuseCases = [
      {
        id: "AC-003",
        description: "Authentication bypass via missing token validation",
        mitigation: "Verify JWT tokens",
      },
    ];

    const stagedFiles = ["src/auth/middleware.ts"];
    const codeContents = new Map([
      [
        "src/auth/middleware.ts",
        `
import jwt from 'jsonwebtoken';
const decoded = jwt.verify(token, secret);
`,
      ],
    ]);

    const result = detectAbuseCasePatterns(
      abuseCases,
      stagedFiles,
      codeContents,
    );

    expect(result).toHaveLength(0);
  });

  it("should flag CSRF without protection", () => {
    const abuseCases = [
      {
        id: "AC-004",
        description: "CSRF attack via missing token",
        mitigation: "Add CSRF tokens",
      },
    ];

    const stagedFiles = ["src/api/routes.ts"];
    const codeContents = new Map([
      [
        "src/api/routes.ts",
        `
app.post('/transfer', (req, res) => {
  transferMoney(req.body.amount);
});
`,
      ],
    ]);

    const result = detectAbuseCasePatterns(
      abuseCases,
      stagedFiles,
      codeContents,
    );

    expect(result).toHaveLength(1);
    expect(result[0].category).toBe("csrf");
  });

  it("should NOT flag CSRF with csrf middleware", () => {
    const abuseCases = [
      {
        id: "AC-004",
        description: "CSRF attack via missing token",
        mitigation: "Add CSRF tokens",
      },
    ];

    const stagedFiles = ["src/api/routes.ts"];
    const codeContents = new Map([
      [
        "src/api/routes.ts",
        `
import csrf from 'csurf';
app.use(csrf());
`,
      ],
    ]);

    const result = detectAbuseCasePatterns(
      abuseCases,
      stagedFiles,
      codeContents,
    );

    expect(result).toHaveLength(0);
  });

  it("should skip non-security abuse cases", () => {
    const abuseCases = [
      {
        id: "AC-005",
        description: "Performance degradation under load",
        mitigation: "Add caching",
      },
    ];

    const stagedFiles = ["src/api/routes.ts"];
    const codeContents = new Map([["src/api/routes.ts", ""]]);

    const result = detectAbuseCasePatterns(
      abuseCases,
      stagedFiles,
      codeContents,
    );

    expect(result).toHaveLength(0);
  });

  it("should skip abuse cases for non-relevant files", () => {
    const abuseCases = [
      {
        id: "AC-001",
        description: "SQL injection via user input",
        mitigation: "Use parameterized queries",
      },
    ];

    const stagedFiles = ["docs/README.md"];
    const codeContents = new Map([["docs/README.md", ""]]);

    const result = detectAbuseCasePatterns(
      abuseCases,
      stagedFiles,
      codeContents,
    );

    expect(result).toHaveLength(0);
  });
});

// ── File Scope Filtering Tests ──────────────────────────────────────

describe("filterScopeRelevantFiles", () => {
  it("should filter by scope paths", () => {
    const stagedFiles = [
      "src/auth/login.ts",
      "src/db/users.ts",
      "docs/README.md",
    ];

    const requirements = [
      {
        requirementId: "auth",
        keywords: new Set(["authenticate"]),
        phrases: new Set(),
      },
    ];

    const scopePaths = ["src/auth/"];

    const result = filterScopeRelevantFiles(
      stagedFiles,
      requirements,
      scopePaths,
    );

    expect(result).toContain("src/auth/login.ts");
    expect(result).not.toContain("src/db/users.ts");
    expect(result).not.toContain("docs/README.md");
  });

  it("should filter by requirement keywords in file path", () => {
    const stagedFiles = ["src/auth/login.ts", "src/db/users.ts"];

    const requirements = [
      {
        requirementId: "auth",
        keywords: new Set(["auth", "login"]),
        phrases: new Set(),
      },
    ];

    const result = filterScopeRelevantFiles(stagedFiles, requirements);

    expect(result).toContain("src/auth/login.ts");
  });

  it("should include all files if no scope paths and no keyword matches", () => {
    const stagedFiles = ["src/utils/helpers.ts", "src/config.ts"];

    const requirements = [
      {
        requirementId: "auth",
        keywords: new Set(["authenticate"]),
        phrases: new Set(),
      },
    ];

    const result = filterScopeRelevantFiles(stagedFiles, requirements);

    // Conservative — include all files for Layer 4a scoring
    expect(result).toHaveLength(2);
  });
});

// ── Cache Key Computation Tests ─────────────────────────────────────

describe("computeL4aCacheKey", () => {
  it("should compute stable cache key", () => {
    const fileSha = "abc123";
    const specKeywordsHash = "def456";

    const key1 = computeL4aCacheKey(fileSha, specKeywordsHash);
    const key2 = computeL4aCacheKey(fileSha, specKeywordsHash);

    expect(key1).toBe(key2);
    expect(key1).toMatch(/^[a-f0-9]{64}$/); // SHA256 hex
  });

  it("should change cache key when file changes", () => {
    const specKeywordsHash = "def456";

    const key1 = computeL4aCacheKey("abc123", specKeywordsHash);
    const key2 = computeL4aCacheKey("xyz789", specKeywordsHash);

    expect(key1).not.toBe(key2);
  });

  it("should change cache key when spec keywords change", () => {
    const fileSha = "abc123";

    const key1 = computeL4aCacheKey(fileSha, "def456");
    const key2 = computeL4aCacheKey(fileSha, "ghi789");

    expect(key1).not.toBe(key2);
  });
});

describe("computeSpecKeywordsHash", () => {
  it("should compute stable hash", () => {
    const keywords = [
      {
        requirementId: "auth",
        keywords: new Set(["authenticate", "user"]),
        phrases: new Set(),
      },
    ];

    const hash1 = computeSpecKeywordsHash(keywords);
    const hash2 = computeSpecKeywordsHash(keywords);

    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
  });

  it("should be order-independent for keywords", () => {
    const keywords1 = [
      {
        requirementId: "auth",
        keywords: new Set(["user", "authenticate"]),
        phrases: new Set(),
      },
    ];

    const keywords2 = [
      {
        requirementId: "auth",
        keywords: new Set(["authenticate", "user"]),
        phrases: new Set(),
      },
    ];

    const hash1 = computeSpecKeywordsHash(keywords1);
    const hash2 = computeSpecKeywordsHash(keywords2);

    expect(hash1).toBe(hash2);
  });

  it("should be order-independent for requirements", () => {
    const keywords1 = [
      {
        requirementId: "auth",
        keywords: new Set(["authenticate"]),
        phrases: new Set(),
      },
      {
        requirementId: "validation",
        keywords: new Set(["validate"]),
        phrases: new Set(),
      },
    ];

    const keywords2 = [
      {
        requirementId: "validation",
        keywords: new Set(["validate"]),
        phrases: new Set(),
      },
      {
        requirementId: "auth",
        keywords: new Set(["authenticate"]),
        phrases: new Set(),
      },
    ];

    const hash1 = computeSpecKeywordsHash(keywords1);
    const hash2 = computeSpecKeywordsHash(keywords2);

    expect(hash1).toBe(hash2);
  });

  it("should change hash when keywords change", () => {
    const keywords1 = [
      {
        requirementId: "auth",
        keywords: new Set(["authenticate"]),
        phrases: new Set(),
      },
    ];

    const keywords2 = [
      {
        requirementId: "auth",
        keywords: new Set(["authenticate", "verify"]),
        phrases: new Set(),
      },
    ];

    const hash1 = computeSpecKeywordsHash(keywords1);
    const hash2 = computeSpecKeywordsHash(keywords2);

    expect(hash1).not.toBe(hash2);
  });
});
