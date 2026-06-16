# MIRA Repo Sync Baseline — 2026-04-25

Recorded: 2026-04-25 20:55 UTC

## Current Development Base

- Active branch after sync: `codex/repo-sync-baseline`
- Branch base: `origin/main`
- Latest `origin/main` commit at sync: `ca3c54a chore: eval run 2026-04-25T2040 UTC (no judge)`
- Previous checkout preserved as local branch: `codex/preserve-lsp-claude-code-20260425`
- Preserved branch divergence from `origin/main`: 44 commits ahead, 204 commits behind

## Preserved Local Work

The sync did not delete, reset, or stash local/user work.

Untracked files/directories still present:

- `.agents/`
- `.playwright-mcp/page-2026-04-12T10-33-13-951Z.yml`
- `.playwright-mcp/page-2026-04-12T10-33-19-358Z.yml`
- `.playwright-mcp/page-2026-04-12T10-34-52-723Z.yml`
- `AGENTS.md`
- `marketing/prospects/hardening-alerts.jsonl`

Top preserved local-only commits on the old branch:

- `2be1b03 fix(lsp): correct plugin source paths to .claude-plugin/plugins/`
- `1f61d67 docs(lsp): plan for LSP servers in Claude Code`
- `2ee1a25 feat(lsp): add marksman markdown language server`
- `f01085c feat(lsp): add bash-language-server (shellcheck-backed)`
- `fc10a40 feat(lsp): add taplo TOML language server`
- `ff1586b feat(lsp): add Dockerfile language server`
- `3cabc32 feat(lsp): add Postgres Language Server (sql LSP)`
- `cd099be feat(lsp): add yaml-language-server`
- `7fdad70 feat(lsp): add ruff LSP via local marketplace`
- `1ca6030 chore(lsp): scaffold local plugin marketplace`
- `e1a0765 feat(lsp): enable typescript-lsp plugin`
- `e82cdc2 feat(lsp): enable pyright-lsp plugin`

## Coordination Check

Recent `origin/main` commits at sync:

- `ca3c54a chore: eval run 2026-04-25T2040 UTC (no judge)`
- `83912d9 security(web): self-host lucide v1.11.0 with SRI, drop unpkg.com supply-chain (#621) (#636)`
- `1344118 chore(claude): enable typescript-lsp, pyright-lsp, compound-engineering plugins`
- `3695e5b chore(ci): unbreak main — skip aspirational tests + fix bot Dockerfile context (#633)`
- `f45af28 chore: eval run 2026-04-25T1923 UTC (no judge)`
- `214440a fix(hub): force dynamic rendering so auth gate actually fires (#632)`
- `b76545f feat(hub): real auth + per-tenant isolation for app.factorylm.com/hub/ (#612)`
- `5bad8fc chore(web-review): daily canary 2026-04-25T1746Z`
- `b55ba3a feat(ci): web-review canary as scheduled GitHub Action (#631)`
- `6e8001e chore(web-review): daily canary 2026-04-25T0000Z`

Open PRs at sync:

- `#637 feat/mvp-unit-9a-landing` — Unit 9a landing page
- `#635 fix/code-review-credit-fallback` — CI billing/auth skip handling
- `#634 fix/hub-auth-secret` — hub auth secret wiring
- `#610 chore/remove-anthropic-runtime` — runtime LLM cascade refactor
- `#609 research/competitor-intel`
- `#608 feat/comic-pipeline-openai-panels`

Active MVP in-flight claim from `docs/plans/2026-04-19-mira-90-day-mvp.md`:

- Unit 6 hybrid retrieval is claimed by `agent-claude` on `feat/mvp-unit-6-hybrid-retrieval`.
- Avoid editing `mira-bots/shared/neon_recall.py` or migration 006 work until that claim is cleared or coordinated.

## Collaboration Map

- Engine/RAG: `mira-bots/shared`, especially `engine.py`, `workers/rag_worker.py`, and `neon_recall.py`
- Active chat API: `mira-pipeline`
- Customer, QR, funnel, and admin web: `mira-web`
- Ingestion and Neon schema: `mira-core/mira-ingest`
- Evals and regression truth: `tests/eval`

## Baseline Verification

- `pytest mira-bots/tests/test_citation_gate.py -v` — passed, 25 tests.
- `pytest tests/ -m "not network and not slow"` — blocked during collection.
  - First sandboxed run also hit a `tiktoken` DNS/download error for `cl100k_base`.
  - Escalated network rerun cleared the `tiktoken` error.
  - Remaining collection blockers:
    - `hypothesis` missing for property tests.
    - `fastapi` cannot import `status` from local `starlette`.
    - `tests/test_session_memory.py` cannot import `shared.session_memory`.
- `cd mira-web && bun test` — failed on existing environment/dependency issues.
  - 90 passed, 15 failed, 6 unhandled module-load errors.
  - Repeated blocker: `@neondatabase/serverless` no longer exports named `Client`.
  - `src/lib/__tests__/qr-tracker.test.ts` requires `NEON_DATABASE_URL`.
  - `requestSoftDelete` attempted Stripe cancellation and received a network failure, so the expected `stripeCanceled="ok"` assertion failed.

## Operating Rules

- Start feature work from `origin/main` on a focused `codex/<task-name>` branch.
- Port only the specific preserved changes needed for the task.
- Run the three-command coordination check before claiming a unit:
  - `git fetch origin main`
  - `git log origin/main --oneline -10`
  - `gh pr list --state open --json number,title,headRefName`
- Keep work inside MVP Units 2-9 unless the plan of record is updated.
