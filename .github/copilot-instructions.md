# SpecIA Development Instructions

When working in this repository, you have access to SpecIA, a security-aware spec-driven development workflow.

## Available Commands

Use the bash CLI for all SpecIA operations (96% token savings vs MCP protocol):

```bash
specia init                              # Initialize SpecIA in project
specia new my-change                     # Create new change proposal
specia review my-change --format json    # Run security review (MANDATORY)
specia audit my-change --format json     # Post-implementation audit
specia done my-change                    # Archive completed change
```

## Workflow

1. **Plan**: `specia new <change-name>` → generates proposal, spec, security review, tasks
2. **Implement**: Write code following tasks.md and security mitigations from review.md
3. **Audit**: `specia audit <change-name>` → verify implementation matches spec
4. **Archive**: `specia done <change-name>` → save to `.specia/specs/`

## Security

- Security review is MANDATORY (STRIDE + OWASP Top 10 + abuse cases)
- Post-implementation audit is MANDATORY by default
- All findings must be addressed before archiving

## See Also

- `.specia/specs/` — Archived change specifications
- `.specia/changes/` — Active changes (proposal, spec, review, tasks, audit)
