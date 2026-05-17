# SpecIA CI/CD Templates

Ready-to-use CI/CD templates that automatically scan every PR/MR for security vulnerabilities — **no `.specia/` init required**.

## How it works

1. On every PR/MR, the workflow runs `specia scan --diff <base>..<head>`
2. Findings are posted as a PR comment with severity breakdown
3. Optionally fail the pipeline on HIGH severity issues

## Templates

| CI System | File | Docs |
|-----------|------|------|
| GitHub Actions | [`github-actions/specia-pr-scan.yml`](github-actions/specia-pr-scan.yml) | [GitHub Actions docs](https://docs.github.com/en/actions) |
| GitLab CI | [`gitlab-ci/specia-scan.yml`](gitlab-ci/specia-scan.yml) | [GitLab CI docs](https://docs.gitlab.com/ee/ci/) |

## GitHub Actions — Quick setup

```bash
# 1. Copy to your repo
mkdir -p .github/workflows
cp ci-templates/github-actions/specia-pr-scan.yml .github/workflows/

# 2. Commit and push
git add .github/workflows/specia-pr-scan.yml
git commit -m "ci: add SpecIA security scan"
git push
```

Every PR will now get a comment like:

> **🟡 SpecIA Security Scan — `FAIR`**
>
> | Severity | Count |
> |----------|-------|
> | 🔴 High  | 0 |
> | 🟡 Medium | 2 |
> | 🟢 Low   | 1 |

## GitLab CI — Quick setup

```yaml
# In your .gitlab-ci.yml:
include:
  - local: ci-templates/gitlab-ci/specia-scan.yml
```

Or copy the file to `.gitlab/ci/specia-scan.yml`.

## Options

| Variable | Default | Description |
|----------|---------|-------------|
| `VT_SPEC_FAIL_ON_HIGH` | `false` | Set `true` to block PRs with HIGH findings |
| `VT_SPEC_REPO_URL` | SpecIA public repo | Override to use a custom SpecIA fork |

## Run locally (same as CI)

```bash
# Scan last merged PR
specia scan --last-merge

# Scan current branch diff vs main
specia scan --diff main..HEAD

# Scan + debate findings
specia debate --last-merge
```
