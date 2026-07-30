# MIRA Code Review Pipeline

This document owns the code-review details that used to live in root
`CLAUDE.md`. The root policy should only point here.

## Scope

The automated review pipeline is advisory unless a required GitHub check says
otherwise. It is meant to catch obvious security, shell, workflow, and
maintainability defects before human review.

## Workflow

| Component | File | Purpose |
|---|---|---|
| GitHub Action | `.github/workflows/code-review.yml` | shellcheck, ast-grep, cascade AI review, PR comment |
| ast-grep rules | `.ast-grep-rules/` | hardcoded IPs, secrets, socket handling, raw FastAPI body checks |
| ast-grep config | `sgconfig.yml` | rule discovery |
| Self-fix script | `scripts/pr_self_fix.sh` | reads important review comments, applies bounded fixes, pushes |
| Pre-commit hook | `.githooks/pre-commit` | shellcheck, credential scan, artifact scan, actionlint |

## Manual Commands

```bash
gh workflow run code-review.yml
bash scripts/pr_self_fix.sh <PR_NUMBER>
git config core.hooksPath .githooks
```

Local tools used by the pipeline include `shellcheck`, `rg`, `sg`
(ast-grep), `scc`, `difft`, and `actionlint`.

## Provider Notes

The review workflow has its own provider cascade in
`.github/workflows/code-review.yml`. Keep comments and PR footer text aligned
with that workflow when provider order changes.

## Agent Guidance

- Treat AI review output as a reviewer signal, not proof.
- Verify symbols, imports, state values, workflow permissions, and security
  claims against the repo before applying suggested patches.
- Do not loop indefinitely on self-fix. One bounded run is enough before
  reporting the blocker.
