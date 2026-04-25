<!-- Guardian Spec-Aware Validation (Layer 4) -->
# Guardian Layer 4: Spec-Aware Validation

**Version:** 0.4.0  
**Status:** Production-ready

Guardian Layer 4 extends SpecIA's pre-commit validation engine with **spec-aware code analysis**. Instead of just checking whether a spec exists, Layer 4 validates that the code in your commit **actually implements the requirements** defined in the spec.

## What is Layer 4?

Guardian has four validation layers:

| Layer | Check | Speed | Required |
|-------|-------|-------|----------|
| **Layer 1** | Spec exists | Fast | Yes |
| **Layer 2** | Security review complete | Fast | Yes |
| **Layer 3** | Mitigations implemented | Fast | Yes |
| **Layer 4** | Code matches spec requirements | Slow | Optional |

Layer 4 is **optional** and **off by default**. When enabled, it uses a two-phase analysis:

### Layer 4a: Heuristic Validation (Fast)

- AST-based keyword matching
- Detects missing implementations via code element extraction
- Scores requirement satisfaction (0-1 confidence)
- **Performance:** <200ms per file
- **Accuracy:** ~70-80% (keyword-based heuristics)

### Layer 4b: LLM Validation (Slow, High-Accuracy)

- Deep semantic analysis via LLM (Claude Haiku or GPT-4o-mini)
- Triggered only when Layer 4a flags potential violations
- Reads full code + spec requirements + abuse cases
- **Performance:** ~2-5s per file (LLM call)
- **Accuracy:** ~95%+ (LLM reasoning)

**Smart caching** ensures Layer 4 only re-analyzes files when they change. Typical commit time remains **<2s**.

---

## Enabling Layer 4

### Option 1: MCP Tool (Recommended for AI Agents)

```javascript
// Call specia_hook_install with spec_validation config
{
  "mode": "warn",
  "spec_validation": {
    "enabled": true,
    "enable_llm": true,
    "llm_provider": "anthropic",
    "llm_model": "claude-3-5-haiku-20241022",
    "heuristic_threshold": 0.5
  }
}
```

### Option 2: CLI

```bash
# Install hook with Layer 4 enabled
specia hook install --spec-aware --mode warn

# Check status
specia hook status
# Output:
#   Guardian hook installed (warn mode)
#   Layer 4 spec-aware validation: enabled
#   Cache: 12 L4a entries, 3 L4b entries
```

### Option 3: Manual Config

Edit `.specia/config.yaml`:

```yaml
guardian:
  enabled: true
  mode: warn
  spec_validation:
    enabled: true           # Enable Layer 4
    enable_llm: true        # Enable Layer 4b (LLM validation)
    llm_provider: anthropic # or 'openai'
    llm_model: claude-3-5-haiku-20241022
    llm_budget: 10000       # Max tokens for LLM prompt
    cache_ttl: 168          # Cache TTL in hours (default: 7 days)
    heuristic_threshold: 0.5 # Confidence threshold for L4a (0-1)
```

Then install the hook:

```bash
specia hook install
```

---

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable Layer 4 validation |
| `enable_llm` | boolean | `false` | Enable Layer 4b (LLM analysis) |
| `llm_provider` | string | `"anthropic"` | LLM provider: `"anthropic"` or `"openai"` |
| `llm_model` | string | `"claude-3-5-haiku-20241022"` | Model to use |
| `llm_budget` | number | `10000` | Max tokens for LLM prompt |
| `cache_ttl` | number | `168` | Cache TTL in hours (7 days) |
| `heuristic_threshold` | number | `0.5` | L4a confidence threshold (0-1) |

### Environment Variables

Layer 4b requires an API key for the configured LLM provider:

- **Anthropic:** `ANTHROPIC_API_KEY`
- **OpenAI:** `OPENAI_API_KEY`

If the API key is missing, Layer 4b gracefully degrades to Layer 4a-only.

---

## How It Works

### Validation Flow

```
Staged File
    ↓
Layer 1-3 (spec exists, review done, mitigations checked)
    ↓
Layer 4a: Heuristic Analysis
    • Extract code elements (functions, classes, imports)
    • Extract spec requirements keywords
    • Score evidence (keyword matches, element presence)
    • Flag requirements with low confidence (<threshold)
    ↓
  [Flagged requirements found?]
    ↓ YES
Layer 4b: LLM Validation
    • Build audit prompt (spec + code + abuse cases)
    • Send to LLM (Anthropic or OpenAI)
    • Parse structured verdict (pass/fail + evidence)
    ↓
Final Verdict (pass | warn | fail)
```

### Caching Strategy

Layer 4 uses **two separate caches**:

1. **L4a Cache** (`.specia/.spec-cache/l4a-{hash}.json`)
   - Key: `hash(file_content + spec_keywords)`
   - Stores: heuristic match result, flagged requirements, confidence scores

2. **L4b Cache** (`.specia/.spec-cache/l4b-{hash}.json`)
   - Key: `hash(file_content + spec_content + review_content)`
   - Stores: LLM verdict, flagged requirements, abuse case analysis

**Cache invalidation:** Cache entries expire after `cache_ttl` hours OR when file/spec content changes.

---

## Interpreting Results

### CLI Output

```
SpecIA Guardian — Validating 3 staged files...

  ✓ src/utils.ts — covered by "auth-refactor" (spec ✓, review ✓, mitigations ✓)
  ✗ src/auth.ts — "auth-refactor": spec_mismatch

━━━ Spec Violation: src/auth.ts ━━━

Change: auth-refactor
Verdict: fail

Failed Requirements (2):

  • REQ-2: Secure password storage
    Reason: Missing bcrypt implementation
    Evidence: no bcrypt import, plaintext storage detected

  • REQ-4: Rate limiting
    Reason: No rate limit middleware found
    Evidence: express-rate-limit not imported

Remediation:

  1. Review the spec requirements in .specia/changes/auth-refactor/spec.md
  2. Update src/auth.ts to satisfy the flagged requirements
  3. Address abuse case patterns identified above
  4. Re-run validation or commit again to re-check

Summary: 1 passed, 0 warning(s), 1 violation(s)
Mode: warn (commit allowed)
```

### JSON Output

Set `SPECIA_JSON=1` for structured output:

```json
{
  "timestamp": "2026-04-05T10:30:00Z",
  "mode": "warn",
  "staged_files": 3,
  "results": [
    {
      "file": "src/auth.ts",
      "status": "fail",
      "change": "auth-refactor",
      "reason": "spec_mismatch",
      "checks": {
        "spec_exists": true,
        "review_complete": true,
        "mitigations_done": true,
        "spec_match": false
      },
      "spec_match_details": {
        "verdict": "fail",
        "layer": "L4b",
        "confidence": 0.95,
        "flagged_requirements": [
          {
            "requirement_name": "REQ-2: Secure password storage",
            "reason": "Missing bcrypt implementation",
            "evidence": ["no bcrypt import", "plaintext storage detected"]
          }
        ],
        "flagged_abuse_cases": []
      }
    }
  ],
  "summary": {
    "passed": 1,
    "warnings": 0,
    "violations": 1
  }
}
```

---

## Performance Characteristics

### Typical Commit (5 files, warm cache)

- **Layer 1-3:** ~50ms
- **Layer 4a (all files):** ~200ms
- **Layer 4b (1 file flagged):** ~2-3s
- **Total:** ~2.5s

### Cache Hit (all files)

- **Total:** ~100ms (no re-analysis)

### Benchmarks

Run benchmarks with:

```bash
npx vitest bench --run test/benchmarks/guardian-layer4.bench.ts
```

Expected results:
- 5 files, heuristics-only: <2s
- Cache hit speedup: 2-5x faster

---

## Troubleshooting

### Layer 4 not running

**Symptom:** Hook runs but no spec validation happens

**Fixes:**
1. Check config: `specia hook status` — should show "Layer 4 enabled"
2. Verify `.specia/config.yaml` has `guardian.spec_validation.enabled: true`
3. Ensure the change has a valid spec (`.specia/changes/{name}/spec.md`)

### LLM validation failing

**Symptom:** Layer 4b errors or falls back to L4a

**Fixes:**
1. Check API key: `echo $ANTHROPIC_API_KEY` or `echo $OPENAI_API_KEY`
2. Verify model name is correct in config
3. Check LLM service status
4. Layer 4a-only mode works without LLM (set `enable_llm: false`)

### False positives

**Symptom:** Layer 4 flags valid implementations

**Fixes:**
1. Increase `heuristic_threshold` (e.g., `0.7` for stricter L4a)
2. Enable Layer 4b for higher accuracy
3. Review spec wording — use concrete keywords that appear in code

### Slow commits

**Symptom:** Commits take >5s

**Fixes:**
1. Check cache: `specia hook status` — should show cache entries
2. Reduce `llm_budget` to limit prompt size
3. Disable Layer 4b for faster commits (heuristics-only)
4. Add frequently-changed files to `guardian.exclude`

---

## Best Practices

1. **Start with heuristics-only** — Enable Layer 4a first, test on a few commits, then enable Layer 4b
2. **Tune the threshold** — Start with `0.5`, adjust based on false positive rate
3. **Use `warn` mode initially** — Don't block commits until you're confident in the tuning
4. **Exclude generated files** — Add `dist/`, `build/`, `*.gen.ts` to `guardian.exclude`
5. **Review .guardian-last.json** — Debugging file saved after each validation run

---

## Example Workflow

### 1. Enable Layer 4

```bash
specia hook install --spec-aware --mode warn
```

### 2. Create a Change

```bash
# Agent creates proposal, spec, review, tasks
specia propose auth-refactor --intent "Add JWT authentication"
specia spec auth-refactor --requirements '[...]'
specia review auth-refactor
specia tasks auth-refactor
```

### 3. Implement Code

```typescript
// src/auth.ts
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12); // Satisfies REQ-2
}

export function validateToken(token: string): boolean {
  return jwt.verify(token, process.env.JWT_SECRET!) !== null; // Satisfies REQ-1
}
```

### 4. Commit

```bash
git add src/auth.ts
git commit -m "Implement JWT auth with bcrypt"
```

Guardian runs automatically:
- **Layers 1-3:** Pass (spec exists, review done, mitigations checked)
- **Layer 4a:** Extracts keywords (`bcrypt`, `jwt`), matches REQ-1 and REQ-2
- **Layer 4b:** (Not triggered — no flags from L4a)
- **Verdict:** ✓ Pass

---

## Limitations

1. **Language support:** Layer 4a works best with TypeScript, JavaScript, Python, Go. Other languages have limited heuristic support.
2. **Semantic gaps:** Heuristics can't detect logic errors (e.g., wrong bcrypt rounds). Use Layer 4b for deeper analysis.
3. **LLM costs:** Layer 4b incurs API costs (~$0.01 per file with Claude Haiku). Cache reduces this significantly.
4. **Monorepo support:** Layer 4 is file-scoped. Large monorepos may need per-package tuning.

---

## See Also

- [Guardian Pre-Commit Hook](../README.md#guardian-pre-commit-validation) — Overview of all Guardian layers
- [Security Review](../README.md#security-posture) — How the review phase feeds into Layer 4
- [SpecIA Workflow](../README.md#quick-start) — Full workflow from propose to done
