# MIRA — Rules & Constraints
**Last Updated:** 2026-05-05

Every rule that any agent or human contributor must follow, consolidated from `CLAUDE.md`, `.claude/rules/*`, and the cluster's 7 Laws. Anything in conflict with this file is wrong unless explicitly amended here in the same change.

## Hard product constraints (CLAUDE.md §4)
1. **Licenses:** Apache 2.0 or MIT only. GPL upstream allowed for opaque images (`mira-cmms` Atlas) where no code is imported.
2. **Cloud LLMs:** Groq + Cerebras + Gemini cascade only. NeonDB persistence. Doppler-managed secrets. **No Anthropic** (removed PR #610 + #649; never reintroduce — runtime silently ignores any `ANTHROPIC_API_KEY`).
3. **No frameworks that abstract the LLM call:** No LangChain, LlamaIndex, n8n, TensorFlow.
4. **Secrets in Doppler only:** `factorylm/prd`. Never in committed `.env`. `.env.template` carries placeholders only.
5. **Containers:** One per service. `restart: unless-stopped`. Healthcheck. Pinned image versions (`:latest` is forbidden).
6. **Commits:** Conventional format — `feat(scope) / fix(scope) / security / docs / refactor / test / chore / BREAKING`.

## Python standards (`.claude/rules/python-standards.md`)
- Python 3.12; package manager `uv` (NOT pip / poetry / conda).
- Lint + format: `ruff` (NOT flake8 / pylint / black). CI gate: `ruff check .` must pass.
- HTTP: `httpx` async (NOT requests / urllib).
- YAML: always `yaml.safe_load()`.
- SQLAlchemy on Neon: `NullPool`, `sslmode=require`, `pool_pre_ping=True`.
- SQLite: stdlib `sqlite3`, always `PRAGMA journal_mode=WAL`.
- Async end-to-end; `asyncio.run()` only at entry points.
- Modern type hints: `list[str]`, `dict[str,int]`, `str | None`. `from __future__ import annotations` for forward refs.
- Logging: stdlib `logging`, never `print()`. Per-service logger names.
- Error handling: catch specific exceptions; log with context; LLM calls return fallback never raise to user.
- Imports: stdlib → third-party → local (`ruff I`); relative within packages; absolute from `shared` for bot adapters.
- Secrets: never hardcode; every getenv has explicit empty-default + warn-then-disable.

## Security boundaries (`.claude/rules/security-boundaries.md`)
- All secrets via Doppler `factorylm/prd`. Never in committed `.env`.
- Rotate before commit: `WEBUI_SECRET_KEY`, `MCPO_API_KEY` (both have a leak history).
- Pre-commit checks: `git remote -v`, `git diff --cached`.
- PII sanitizer: `InferenceRouter.sanitize_context()` — IPv4 → `[IP]`, MAC → `[MAC]`, Serial → `[SN]`. Default-on inside `complete()`. `mira-sidecar` Open WebUI fallback also sanitizes. `sanitize=False` only in offline evals.
- Safety keywords: 21 phrase-level triggers in `mira-bots/shared/guardrails.py`. Match → immediate `SAFETY_ALERT`. Add as phrases (not single words) to avoid false positives.
- Tier limits: `check_tier_limit(tenant_id)` returns `(allowed, reason)`. Fail-open on DB errors. Wire to HTTP 429 in ingest endpoints.
- Docker: never `privileged: true`; never `network_mode: host`; never `:latest` / `:main` tags. Always `restart: unless-stopped`, healthcheck, pinned versions, named networks.
- API auth: bearer tokens for mira-mcp REST, Open WebUI, mira-pipeline. Mira-ingest is core-net only (no auth). Mira-web JWT per tenant.
- Input validation: Telegram 20 MB PDF limit; Slack MIME allowlist (images + PDF). Strip `@mention` tags via `guardrails.strip_mentions()` in every adapter.
- Never accept arbitrary file paths, execute user strings as shell, or deserialize untrusted pickle.

## Cluster 7 Laws (from `~/factorylm/CLUSTER.md`)
1. **Evidence-only completion.** "Done" requires deterministic proof: file exists, port open, test exited 0. Write the proof to `/cluster/betterclaw/logs/`.
2. **LLM vs. script separation.** LLM for reasoning + planning + language. Binary checks (file exists? port open? test pass?) are bash one-liners. Never use an LLM where a one-liner works.
3. **300-line orchestrator limit.** This agent writes ≤ 300 lines of code directly. Larger tasks → write `Task.md` → delegate to coder sub-agent.
4. **Task.md protocol.** Before any delegation: write `/cluster/betterclaw/task_queue/TASK-<DATE>-<NAME>.md` with why, full context, SSoT links, measurable pass/fail acceptance criteria. No Task.md = no delegation.
5. **Lesson log every session.** Log human mistakes, AI mistakes, fine-tune candidates. Not optional.
6. **Pattern rule creation.** Same mistake twice → write a new rule to `/cluster/betterclaw/rules/`. Rules must be specific (keyword triggers, examples, measurable conditions). "Be careful" is not a rule.
7. **Self-patching.** Mistake despite an existing rule → inspect rule, patch with the new edge case, commit. Don't re-flag.

## Workflow & process
- **CLAUDE.md target:** ~120 lines. Compliance drops past ~150. If you repeat an instruction in chat > 2x, add it there. Delete rules followed naturally. Audit monthly.
- **PRD reference:** Every PR mentions which `NORTH_STAR.md` flywheel step it supports.
- **PLAN.md before code:** Create or update `PLAN.md` before writing code in `factorylm` repo (when applicable).
- **Wiki cadence:** Read `wiki/hot.md` at session start; update at session end.
- **Active 90-day plan:** `docs/plans/2026-04-19-mira-90-day-mvp.md` — locked window 2026-04-19 → 2026-07-19. Read its "Currently in-flight" section + run the 3-command coordination check before claiming any work.
- **Promo screenshot rule:** Every Playwright proof-of-work screenshot must also be saved to `docs/promo-screenshots/` as `YYYY-MM-DD_feature-name_viewport.png`, capturing both desktop (1440 × 900) and mobile (412 × 915). Append-only archive — never delete.
- **Design screenshot rule (memory `feedback_design_screenshot_routine`):** Any visible mira-web UI change ships a before/after screenshot pair via `bun run snapshot:before/after` and commits to `docs/design-history/`.
- **Doppler secrets memory (`feedback_doppler_secrets_just_use`):** When keys are in Doppler `factorylm/prd` and Mike's authorized the purpose, pull and apply directly — don't re-ask.
- **LLM cascade memory (`feedback_llm_cascade_default`):** Always Groq → Cerebras → Gemini cascade for any LLM call; never single-provider, never Anthropic.
- **RESOLVED → new fault memory (`feedback_resolved_state_wo_rebuild`):** Clearing `cmms_pending` alone is insufficient when leaving `RESOLVED`; `_clear_diagnostic_carryover` must reset `state["state"]` too.

## Code review (automated pipeline, installed 2026-04-20)
- GH Action `.github/workflows/code-review.yml` runs on every PR to `main / develop / dev`: shellcheck → ast-grep (IPs / secrets / raw FastAPI body / missing socket error handling) → cascade review (Groq → Cerebras → Gemini) → PR comment.
- ast-grep rules in `.ast-grep-rules/`; config in `sgconfig.yml`.
- Self-fix: `bash scripts/pr_self_fix.sh <PR>` reads 🔴 IMPORTANT comments, asks the cascade for patches, applies + pushes (max 3 loops).
- Pre-commit hook: shellcheck + rg credential scan + debug artifact scan on staged files. `git config core.hooksPath .githooks` (already set).
- Tools required locally: `shellcheck`, `rg`, `sg` (ast-grep), `scc`, `difft`.

## What we do not do
- Push directly to `main`.
- Skip Stripe-signature / HMAC verification on inbound webhooks.
- Use a single LLM provider for any user-facing call.
- Introduce LangChain / LlamaIndex / TensorFlow / n8n / Anthropic.
- Run two Telegram pollers on the same token (singleton enforced by self-healer).
- Mutate user data from an admin-bypass token (read-only).
- Modify `# SAFETY`, `# PLC`, or `# CRITICAL`-tagged code without explicit approval.
