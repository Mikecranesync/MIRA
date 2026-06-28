# Critical Technical-Debt Audit — 2026-06-09

**Auditor:** Claude (CHARLIE node) · **Branch:** `fix/tech-debt-sweep` (cut off `origin/main` @ `50aa09b5`)
**Lens:** things that could **FAIL in front of a customer, judge, or beta tester** — not style nits.
**Method:** all checks re-run against a fresh `origin/main` worktree (local working branch was 47 commits behind — see Lesson #1). Python checks use the **3.12 `.venv`** (system `python3` is 3.9.6 and gives false `dict | None` failures — see Lesson #2).

---

## TL;DR

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| 1 | `mira-bots/email/` shadowed stdlib `email`, crashing every httpx importer when run from repo root / `cd mira-bots` | **P2** (prod-safe, but broke import-checks + bot test suite) | ✅ **FIXED** (rename → `email_adapter`) |
| 2 | `conversation_router._call_router_llm` POSTs raw msgs to Groq (#1528 PII leak) | P1 | ✅ Already fixed on `origin/main` — no action |
| 3 | `/api/quickstart/ask` rate limit (#1838) | P1 | ✅ Merged 2026-06-09 |
| 4 | Safety-keyword detection (#1839, closes #1834) | P1 | ✅ Merged 2026-06-09 |
| 5 | `com.factorylm.health-monitor` launchd job exits **127** every run | P2 (ops/host) | 🔧 Issue filed — points at a missing script |
| 6 | `mira-hub` TS errors (9) | P3 | ⏭️ Skipped — all in `.test.ts`, none in routes |
| 7a | Migration numbering gap 040–042 on `origin/main` | P3 | ⏭️ Noted — planned layer never built |
| 7b | **Dev NeonDB ~13 migrations behind (applied through 030; 031–047 missing)** | P2 (dev-env) | 🔧 Verified — run `apply-migrations.yml` on dev |
| 8 | Git hygiene (144 stale `.git` locks, 3 stashes, 12 worktrees) | P3 | ⏭️ Reported, **not** auto-cleaned (concurrent-writer hazard) |

**No P0s found.** With the correct interpreter, every critical import on `origin/main` passes; no hardcoded secrets; no container restart loops.

---

## 1. Broken imports / dead code paths

Re-run with the **3.12 `.venv`** against `origin/main`:

| Import | Result |
|--------|--------|
| `from shared.engine import Supervisor` | ✅ OK |
| `from shared.guardrails import classify_intent, SAFETY_KEYWORDS` | ✅ OK (52 keywords) |
| `from shared.inference.router import InferenceRouter` | ✅ OK |
| `from shared.uns_resolver import resolve_uns_path` | ✅ OK |
| `from shared.citation_compliance import check_citation` | ⚠️ **wrong name** — the real export is `check_citation_compliance` (imports fine). The audit command had a typo; no code imports `check_citation`. |

### Finding 1 (FIXED): `mira-bots/email/` shadowed the stdlib `email` module — **P2**

**Symptom.** Running the documented import-checks exactly as written (`cd mira-bots && python -c "from shared.engine import Supervisor"`) crashed with:

```
File ".../mira-bots/email/__init__.py", line 3, in <module>
    from chat_adapter import EmailChatAdapter
ModuleNotFoundError: No module named 'chat_adapter'
```

**Root cause.** A package directory literally named `email/` becomes importable as a top-level package the moment `mira-bots/` is on `sys.path[0]` (any `cd mira-bots`, the import-checks, and the bot test suite run from repo root). `httpx → urllib.request → import email` then resolved to the **local** package instead of the stdlib. The local `__init__.py` used a bare `from chat_adapter import …` (the whole package uses bare sibling imports, designed to run via `sys.path.insert`), so the import exploded — taking down every module that imports `httpx` (engine, router, `citation_compliance`).

**Blast radius / why it's P2 not P0.** Production was **never** affected: `slack/Dockerfile` and `telegram/Dockerfile` copy only `shared/` + their own files — never `email/` — so no container shadows the stdlib. The adapter is **dormant**: no Dockerfile, not in any compose, no SES/Lambda wiring (only self-references + tests). But it was a **chronic dev/test footgun** worked around in ~7 places: `tests/conftest.py` (caches stdlib `email` first), `shared/analysis/session_analyzer.py` (append-not-insert), `tools/run_agents.py`, `tests/eval/analyze_sessions.py`, `tests/mira_bench_scorer.py`, and two HANDOFF docs. `wiki/hot.md` listed `email_adapter` among "5 pre-existing import/isolation issues."

**Why the obvious one-line fix is a trap.** Changing `__init__.py` to `from .chat_adapter import …` does **not** fix it — `import email` then loads the package, which triggers `chat_adapter.py`'s next bare import (`from allowlist import AllowList`) → fails differently. The relative-import-only fix would make the import-check *appear* to pass on a load-time-only path while leaving a runtime landmine. **Tested empirically and rejected.**

**Fix (commit `6135e562`).** `git mv mira-bots/email → mira-bots/email_adapter` + the one `sys.path.insert` line in `test_email_adapter.py`. This removes the shadow at the root — `import email` always resolves to stdlib again. Internal modules keep their bare-import structure (dormant; proper relative-package conversion is a follow-up, see §7).

**Evidence.**
- Before: import-check → `ModuleNotFoundError: chat_adapter`.
- After (3.12 venv): engine / guardrails / router / resolver / citations all import OK.
- `test_email_adapter.py` (a prior "pre-existing import/isolation failure"): **39 passed**.

The ~7 workaround comments now describe a fixed problem — harmless, left in place to keep this diff surgical. Cleanup is a follow-up.

---

## 2. TypeScript compilation (`mira-hub`)

`npx tsc --noEmit` → **9 errors, exit 2.** All 9 are in test files; **zero in customer routes/pages**:

- `src/app/api/namespace/tree/route.test.ts` ×6 — `EntityFixture` missing `files_count` / `equipment_status` (fixture drift after `KgEntityRow` gained columns).
- `src/lib/auth/__tests__/rls-deny.integration.test.ts` ×1 — unused `@ts-expect-error`.
- `src/lib/command-center-freshness.test.ts`, `src/lib/workflow.test.ts` ×2 — `Cannot find module 'bun:test'` (tsc lacks Bun types; these run under Bun, not tsc).

**Severity P3, skipped.** `tsc --noEmit` is not the Hub's test runner (Bun is), so these don't gate CI and never reach a customer. Suggested follow-up (not done): exclude `*.test.ts` from the `tsc --noEmit` config or refresh the `EntityFixture`.

---

## 3. Docker health on CHARLIE

`docker ps` — **all 12 MIRA containers UP, none in a restart loop:**

```
mira-core, mira-hub, mira-ingest, mira-pipeline, mira-mcp   Up 2 weeks (healthy)
mira-bot-slack                                              Up 3 weeks (healthy)
mira-bridge                                                 Up 3 hours (healthy)
mira-redis, mira-mosquitto, mira-tika, mira-proxy,          Up 7–11 days
mira-ignition-origin-proxy
```

No finding.

---

## 4. Database schema drift

- **`origin/main` migration set (mira-hub/db/migrations):** … 037, 038, 039, **[gap 040–042]**, 043, 044, 045, 046, 047.
- The 040–042 gap is **not** missing-but-needed migrations — per `wiki/hot.md`, a "040–042 source-preservation layer" was *planned* after #1710 but never built under those numbers. `apply-migrations.yml` runs files that exist, so a numbering gap is cosmetic. **P3, noted.**

### Finding 4 (verified): dev NeonDB is ~13 migrations behind `origin/main` — **P2 (dev-env)**

Queried the dev branch directly (`doppler -c dev`, host `ep-lingering-salad-…` = the dev endpoint, **not** prod, via `docker run postgres:16 psql`). The hub has **no single version-table** for these migrations — `schema_migrations` is legacy (stops at `002`) and `migrations` is a different app's TypeORM table (n8n/Paperclip-style). The hub migrations are **applied idempotently** (re-run every deploy, no version row — which is exactly why 032/033 needed idempotency guards, per `wiki/hot.md`). So applied-state is verified by checking for the actual schema objects:

| Migration | Object | In dev? |
|---|---|---|
| 016 component_templates | `component_templates` | ✅ |
| 027 ai_suggestions | `ai_suggestions` | ✅ |
| 030 display_endpoints | `display_endpoints` | ✅ |
| **031 ignition_audit_log** | `ignition_audit_log` | ❌ |
| **032 decision_traces** | `decision_traces` | ❌ |
| **033 tag_events** | `tag_events` | ❌ |
| **035 approved_tags** | `approved_tags` | ❌ |
| **044 workflow_runs** | `workflow_runs` | ❌ |
| **046/047 asset-agent** | `asset_agent_status`, `asset_validation_runs` | ❌ |

**Cutoff: dev is applied through 030; migrations 031–047 are in code but NOT in the dev DB.** Anyone running a feature locally against dev that touches Command Center / decision-traces / tag ingest / workflow-runs / asset-agent validation will hit missing-table errors. Not customer-facing (dev is "safe to break" and gets reset from prod periodically — see memory `project_neon_env_state`), but it's real dev-env hygiene drift.

**Fix (ops, not in this PR):** run `apply-migrations.yml` against dev (`dry-run` then `apply`) — the 031+ migrations are idempotent, so this is low-risk. **PROD state was NOT checked** (forbidden by `prod-guard`); verify prod separately via `apply-migrations.yml --dry-run`.

---

## 5. Known broken features

- `docs/known-issues.md` — nothing newly critical surfaced beyond items already tracked.
- **Open `beta-readiness` issues (already filed — not duplicated here):** #1831 (Stripe in TEST mode), #1830 (Gemini 403 on both keys), #1833 (tenant-scope drift `/api/documents`), plus audit-lens issues #1825–#1829, #1836.
- `wiki/hot.md` — eval scorecard 50/57; failures are FSM over-qualification clusters tracked in #1788. Not a customer-facing crash.

---

## 6. Security gaps

- **#1528 / `conversation_router._call_router_llm`:** ✅ **Already fixed on `origin/main`.** The function now calls `messages = InferenceRouter.sanitize_context(messages)` immediately before the Groq POST, with a comment referencing the #1528 adversarial triage. **Note:** the task referenced "PR #1839" for this — that's a mislabel. #1839 is the *safety-keyword* fix (closes #1834). The sanitization fix merged under a different PR; this is *why* a stale local checkout could still look vulnerable. Lesson #1 again.
- **#1838 quickstart rate limit:** ✅ merged 2026-06-09T07:32Z.
- **Hardcoded secrets in `mira-hub/src`:** none. The scan returned only false positives (form field `name`/`autoComplete="current-password"` attributes). All real keys go through `process.env`.

---

## 7. Stale / broken scheduled tasks

No `.scheduled/` dir in the repo — scheduled work is **launchd** on CHARLIE. `launchctl list` last-exit codes:

| Job | Last exit | Note |
|-----|-----------|------|
| `com.factorylm.health-monitor` | **127** | 🔧 **Finding 5** — runs `/Users/charlienode/factorylm/scripts/health-check.sh`, which **does not exist** → command-not-found every run. Silent. |
| `com.factorylm.mira-offline-eval` | 1 | non-zero; lower priority, investigate |
| `com.mira.lead-hunter` | 1 | non-zero; marketing tooling |
| `com.mira.eval-fixer`, `brain-ingest`, `brain-mcp`, `mira-drop-watcher`, `jarvis-node`, `vastai-tunnel` | 0 / running | healthy |

`mira-eval-heartbeat` / `launchd-health-check` (named in the task) don't exist under those labels; the closest live job is `com.factorylm.health-monitor`, which is the one broken at exit 127. These are **host/ops** concerns (factorylm repo + launchd), not MIRA code — filed as an issue, not in this PR.

---

## 8. Git hygiene

- **144 stale `.git/*.lock` files.** **Not auto-deleted** — the working copy is a known concurrent-writer environment (crons + peer sessions); blindly removing `index.lock`/ref locks while another git process runs can corrupt state. Recommend a guarded sweep when no git process is active.
- **3 aging stashes** (`chore/demo-hub-seed` peer WIP, `fix/switch-asset-gate-first-mention`, a `main` peer WIP). Review + drop or branch.
- **12 worktrees / 8 dirs under `.claude/worktrees/`** — several on likely-merged branches (`feat/path-to-beta`, `folder-brain`, `workflow-runs-primitive`, etc.). Candidate for `git worktree prune` after confirming each branch is merged.

All **P3, reported not actioned** (skip-P3 per audit scope; the lock sweep is also a safety call).

---

## Lessons (for the next agent)

1. **`git fetch origin/main` before claiming feature state.** The working branch was 47 commits behind; the #1528 sanitization fix and #1838/#1839 were all already merged. Three "findings" evaporated once checked against `origin/main`. (Reinforces existing memory `feedback_fetch_origin_before_state_claims`.)
2. **Run Python checks with the 3.12 `.venv`, never system `python3` (3.9.6).** 3.9 raises `TypeError: unsupported operand type(s) for |` on PEP-604 `X | None` runtime annotations, producing false import failures unrelated to any real bug.
3. **Empirically test the "obvious" fix before shipping it.** The relative-import one-liner for the email shadow looked right and was a half-fix trap; only `cd mira-bots && python -c …` proved it.

---

## What this PR contains

- `fix(bots): rename mira-bots/email → email_adapter` (commit `6135e562`) — the one safe, verified code fix.
- This report (`docs/tech-debt/2026-06-09-critical-debt-audit.md`).

Everything else is either already merged, P3 (skipped per scope), or filed as an issue for human/ops review.
