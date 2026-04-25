/**
 * Stack auto-detection for specia_init.
 *
 * Detects the primary technology stack from project files.
 *
 * Spec refs: Domain 10 (Auto-Detection of Stack — all scenarios)
 */

import * as fs from "node:fs";
import * as path from "node:path";

export interface DetectionResult {
  detected: string | null;
  multiple: boolean;
  candidates: string[];
}

const STACK_SIGNATURES: Array<{ file: string; stack: string }> = [
  { file: "package.json", stack: "Node.js" },
  { file: "tsconfig.json", stack: "TypeScript/Node.js" },
  { file: "Cargo.toml", stack: "Rust" },
  { file: "go.mod", stack: "Go" },
  { file: "pyproject.toml", stack: "Python" },
  { file: "requirements.txt", stack: "Python" },
  { file: "Gemfile", stack: "Ruby" },
  { file: "pom.xml", stack: "Java (Maven)" },
  { file: "build.gradle", stack: "Java (Gradle)" },
  { file: "build.gradle.kts", stack: "Kotlin (Gradle)" },
  { file: "composer.json", stack: "PHP" },
  { file: "mix.exs", stack: "Elixir" },
  { file: "pubspec.yaml", stack: "Dart/Flutter" },
  { file: "Package.swift", stack: "Swift" },
  { file: "CMakeLists.txt", stack: "C/C++ (CMake)" },
  { file: "Makefile", stack: "C/C++" },
  { file: ".csproj", stack: ".NET/C#" },
];

/**
 * Detect the primary stack from project root files.
 *
 * Heuristic: TypeScript > Node.js (if both package.json and tsconfig exist).
 * Multiple detections are returned as candidates.
 */
export function detectStack(projectRoot: string): DetectionResult {
  const candidates: string[] = [];

  for (const sig of STACK_SIGNATURES) {
    if (fs.existsSync(path.join(projectRoot, sig.file))) {
      if (!candidates.includes(sig.stack)) {
        candidates.push(sig.stack);
      }
    }
  }

  // Heuristic: if both Node.js and TypeScript/Node.js detected, prefer TypeScript
  const hasTs = candidates.includes("TypeScript/Node.js");
  const hasNode = candidates.includes("Node.js");
  if (hasTs && hasNode) {
    const idx = candidates.indexOf("Node.js");
    if (idx !== -1) candidates.splice(idx, 1);
  }

  if (candidates.length === 0) {
    return { detected: null, multiple: false, candidates: [] };
  }

  return {
    detected: candidates[0] ?? null,
    multiple: candidates.length > 1,
    candidates,
  };
}
