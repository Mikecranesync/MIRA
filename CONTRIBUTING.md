# Contributing to MIRA

Thanks for your interest in MIRA. This guide covers how to propose a change, how we structure work, and what to expect during review.

If you only want to **report a bug** or **ask a question**, see [SUPPORT.md](SUPPORT.md) first — it'll route you to the right place faster than opening a PR.

---

## Quick start

```bash
# 1. Fork the repo on GitHub, then clone your fork
git clone https://github.com/YOUR-USERNAME/MIRA.git
cd MIRA

# 2. Add the upstream remote
git remote add upstream https://github.com/Mikecranesync/MIRA.git

# 3. Create a branch
git checkout -b feat/your-feature-name

# 4. Make changes, run the smoke test
bash install/smoke_test.sh

# 5. Commit, push, open a PR
git push origin feat/your-feature-name
gh pr create --fill
```

---

## Spec-first rule

Any change beyond a typo or one-line bug fix needs a short spec under `docs/specs/<feature-name>-spec.md` **before** code lands.

A spec answers four questions:

1. **Why** — what problem this solves
2. **What** — what's in scope and out of scope
3. **How** — the file-level change list
4. **Done** — acceptance criteria, written so anyone can run them

Specs live in the same PR as the code. Reviewers read the spec first, then the diff. If you can't write a one-page spec, the change isn't ready.

See `docs/specs/help-documentation-spec.md` for an example.

---

## Branch and commit conventions

**Branch names:**

```
feat/<topic>     # new feature
fix/<topic>      # bug fix
chore/<topic>    # tooling, deps, refactor with no behavior change
ops/<topic>      # infra, deployment, observability
docs/<topic>     # docs-only change
security/<topic> # security fix
```

**Commit messages — conventional format:**

```
<type>(<scope>): <one-line summary>

<optional longer body explaining why>
```

Types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `security`, `ops`, `BREAKING`.
Scopes are usually a service name: `feat(mira-hub): ...`, `fix(mira-mcp): ...`.

Examples:
- `feat(mira-pipeline): add Cerebras as second cascade provider`
- `fix(mira-bots): strip @mentions before intent classification`
- `docs(spec): help documentation for in-app help + repo docs`

We squash-merge by default. Keep commit messages on the branch tidy enough that the squash message reads well.

---

## Code standards

Hard rules — these come from `.claude/rules/`:

- **Python:** 3.12, `uv` for packages, `ruff` for lint+format, `httpx` for HTTP, `yaml.safe_load`, `NullPool` for SQLAlchemy on NeonDB. Full rules: [`.claude/rules/python-standards.md`](.claude/rules/python-standards.md).
- **Security:** Doppler for all secrets — never `.env`. PII sanitized via `InferenceRouter.sanitize_context()`. Safety keywords trigger STOP escalation. Full rules: [`.claude/rules/security-boundaries.md`](.claude/rules/security-boundaries.md).
- **No banned dependencies:** Apache 2.0 / MIT only. No LangChain, no TensorFlow, no n8n, no Anthropic SDK (removed in PR #610 — never reintroduce).
- **Containers:** one service per container, pinned image tags, `restart: unless-stopped`, healthcheck, named networks. No `:latest`, no `privileged: true`, no `network_mode: host`.

Linters and formatters run in pre-commit and CI:

```bash
# Python
ruff check --fix .
ruff format .

# JS/TS (mira-hub, mira-web)
cd mira-hub && bun run lint
cd mira-hub && bun run typecheck

# Shell
shellcheck scripts/*.sh

# AST-grep custom rules
sg scan
```

---

## Tests

Add tests for new behavior. Don't break existing tests.

```bash
# Python services
cd mira-bots && pytest
cd mira-mcp && pytest
cd tests && pytest

# JS/TS
cd mira-hub && bun test

# End-to-end smoke (services must be running)
bash install/smoke_test.sh
```

Coverage target is 80% on new code. The CI gate is currently soft — broken existing tests must not be ignored, but coverage gaps in new code get a comment, not a block.

For evals (offline diagnostic accuracy), see [`tests/eval/README.md`](tests/eval/README.md).

---

## Pull request workflow

1. Push your branch: `git push origin feat/your-feature-name`.
2. Open a PR against `main`.
3. The automated review pipeline runs (shellcheck → ast-grep → LLM cascade review). Comments arrive within a few minutes.
4. Address 🔴 IMPORTANT comments before requesting human review. Use `bash scripts/pr_self_fix.sh <PR_NUMBER>` for an automated fix loop, or fix manually.
5. Tag a maintainer when ready. Reviews target a 1-business-day SLA.
6. After approval and a green CI run, a maintainer squash-merges.

PR description must include:
- Link to the spec (or "trivial — no spec needed" with one-line justification)
- Test plan — bulleted checklist of what you ran and what passed
- Screenshots for any UI change (desktop + mobile, before + after for visible changes — see the screenshot rule in `CLAUDE.md`)

---

## What we won't merge

- Changes without a spec (when one is required).
- Code that adds a banned dependency (LangChain, Anthropic SDK, etc.).
- Hardcoded secrets, IPs, or production URLs (the AST-grep rules will flag these and block CI).
- Backwards-compatibility shims for unreleased internal APIs.
- Drive-by reformatting unrelated to the change at hand.
- AI-generated content that wasn't reviewed by a human (no auto-merged AI PRs).

---

## Maintainers

- **Mike Harper** ([@Mikecranesync](https://github.com/Mikecranesync)) — lead maintainer. Email: `mike@cranesync.com`.

For sensitive issues (security, conduct), email Mike directly rather than opening a public issue. See [SECURITY.md](SECURITY.md).

---

## License

By contributing, you agree your contribution is licensed under the project license — see [LICENSE](LICENSE). MIRA is proprietary; bundled third-party dependencies retain their original open-source licenses.
