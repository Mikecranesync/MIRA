# HANDOFF — UNS message resolver

**Branch:** `claude/elated-margulis-ac0926`
**Date:** 2026-05-13
**Commits:** 4 (fac2c5c1, 0566a2ef, db574ed8, 69def852)

## What landed

Single UNS-aware extraction point for vendor / model / fault code / category
per turn. Replaces 14 sites in `mira-bots/shared/engine.py` + 3 in
`rag_worker.py`, `dialogue_state.py`, `dialogue_acts.py` that previously each
called `vendor_name_from_text()` / `_looks_like_model_number()` on the
message, the combined message+asset, or asset_id.

### New module — `mira-bots/shared/uns_resolver.py`

- `UNSContext` frozen dataclass — 12 fields including `uns_path` (built via
  `mira-crawler/ingest/uns.py` path builders, no path reinvention)
- `resolve_uns_path(message, tenant_id, prior_ctx)` — three stages: fault
  extraction → vendor+model+path → optional DB enrichment
- `VENDOR_ALIASES` — 31 entries, alias → canonical display name
- `FAMILY_FROM_ALIAS` — separate dict for family token when the alias is a
  family (`powerflex` → `PowerFlex`)
- `FAULT_PATTERNS` — 7 patterns: F/E/oC are strong (priority 0–2); OL/UL/AL
  pulled in from dialogue_acts' inline regex for parity; bare A-pattern is
  weakest (priority 3) because it collides with Yaskawa A-series models

### Engine wiring

Single call at the top of `Supervisor.process_full()`. Resolver result is
stored under `state["context"]["uns_context"]` (not the top level) so it
round-trips through `session_manager.save_state`, which only persists
declared columns + `state["context"]` as JSON. Carry-over across turns works
because turn N+1's `prior_ctx` is read from the same location.

### Tests

- `tests/test_uns_resolver.py` — 82 cases, all pass.
- `mira-bots/tests/test_dialogue_tracker.py` — 51 cases, still pass after
  the dialogue_state refactor.
- `tests/eval/run_eval.py --dry-run` — 57/57 scenarios pass.

### Mike's exact 2026-05-13 regression case

```
resolve_uns_path("I have a powerflex 525 and it has it called f0004")
→ manufacturer="Rockwell Automation"
  manufacturer_alias="powerflex"
  product_family="PowerFlex"
  model="525"
  fault_code="F0004"
  fault_code_raw="f0004"
  uns_path="enterprise.knowledge_base.rockwell_automation.powerflex.525.fault_codes.f0004"
  confidence=0.9
```

The pre-fix `_looks_like_model_number` would have returned `"f0004"` as the
model. Fixed by extracting fault codes BEFORE model candidates AND allowing
pure-digit tokens (`"525"`) as model candidates when adjacent to a known
vendor/family.

## Gates run

- ✅ `ruff check` — clean across all 5 touched files + tests
- ✅ `pytest tests/test_uns_resolver.py` — 82 passed (0.20s)
- ✅ `pytest mira-bots/tests/test_dialogue_tracker.py` — 51 passed
- ✅ Smoke test of `dialogue_acts._entities_from_message` end-to-end
- ✅ `tests/eval/run_eval.py --dry-run` — 57/57

## NOT done (deferred — discuss before extending scope)

### 1. Phase 6: rag_worker entity-scoped KB query via `uns_path`

The spec described an additional optimization: when `uns_context.uns_path` is
set, scope the `knowledge_entries` query to entities at that path. NOT
implemented — the cross-vendor filter via `uns_context.manufacturer` already
gives the main correctness benefit, and adding a UNS-path-scoped query
would risk regressions in the BM25 + Nemotron rerank path. Tracked as
follow-up.

### 2. Net-LOC target

PLAN.md said "net negative LOC target." Existing files net delta:
**+100 / −72 = +28 lines** (excluding the new resolver module and new
tests). The growth is in:
- the wiring block at the top of `process_full` (~25 lines including
  comments)
- `_collect_session_entities` rewrite (explanatory comments + the asset_id
  resolver fallback)

Code paths got simpler, comments got more numerous. If you want the LOC
target enforced strictly, trim comments in a follow-up.

### 3. mira-crawler/ingest/uns.py import fallback

`uns_resolver.py` imports `_uns` via two paths: `from mira_crawler.ingest`
(works when the crawler service is on PYTHONPATH) and a filesystem-path
fallback using `parents[2] / "mira-crawler"` (works in the worktree). In a
production bot container that doesn't ship `mira-crawler/`, both fail and
`_uns = None`. Behaviour in that case: vendor/model/fault still resolve
correctly via the alias table; `uns_path` is always None. That breaks the
KB-scoping optimization (#1) but not the engine extraction-site replacement
(which doesn't read `uns_path`). If the bot container is expected to need
UNS paths in production, vendor the path-builder code into
`mira-bots/shared/` or publish `mira-crawler` as an importable package.

### 4. Python 3.9 local test environment

Several `mira-bots/tests/` files use Python 3.10+ syntax (`dict | None` at
import-time, not under `from __future__ import annotations`). The local
system has Python 3.9, so `pytest mira-bots/tests/test_engine.py` fails at
collection with `TypeError: unsupported operand type(s) for |`. This is
**pre-existing on the base branch** — my changes did not introduce it. CI
runs on Python 3.12 where this works.

Affected test files I could not run locally:
- `mira-bots/tests/test_engine.py`
- `mira-bots/tests/test_engine_dst_integration.py`
- `mira-bots/tests/test_engine_tenant_kwargs.py`
- `mira-bots/tests/test_conversation_continuity.py`

I verified equivalence by running the resolver suite, the dialogue_tracker
suite (which consumes the refactored dialogue_state), a smoke import of
engine.py via a path that avoids the `mira-bots/email/` stdlib-shadow
problem, an end-to-end resolve of Mike's regression case, and the dry-run
eval. Recommend running the full `mira-bots/tests/` suite in CI on Python
3.12 before merging.

## What to verify in CI / on prod

1. CI's `pytest mira-bots/tests/` on Python 3.12 — should be green.
2. `.github/workflows/code-review.yml` — let it run, address 🔴 IMPORTANT
   comments with `bash scripts/pr_self_fix.sh <PR>` once if needed.
3. After merge + deploy: send the Telegram bot the literal message
   *"I have a powerflex 525 and it has it called f0004"*. Expect a
   diagnostic reply that references PowerFlex 525 and F0004 — NOT a search
   for "f0004 model" or a fault-code lookup for "525".

## Risks

- The asset_identified write at the top of `process_full` is gated on
  `confidence >= 0.7` AND `not state.get("asset_identified")`. If an
  earlier-turn asset is in state, we don't overwrite it. If no asset exists
  AND the resolver got high confidence, we set the canonical
  "Vendor, Model" string. This preserves the existing engine contract —
  DST and reflection logic continue to work without modification.
- `_collect_session_entities` last-resort branch re-runs the resolver on
  `message` when state has no uns_context AND no asset_identified AND no
  DST entities. This only fires for legacy state rows or code paths that
  bypassed `process_full`'s top-of-loop resolution. Cost: one regex pass.

## Reproduce commands

```bash
# Run resolver tests
python3 -m pytest tests/test_uns_resolver.py --rootdir=. -v

# Run dialogue_tracker tests (consumes the refactor)
python3 -m pytest mira-bots/tests/test_dialogue_tracker.py --rootdir=. -v

# Lint
ruff check mira-bots/shared/uns_resolver.py mira-bots/shared/engine.py \
  mira-bots/shared/workers/rag_worker.py mira-bots/shared/dialogue_state.py \
  mira-bots/shared/dialogue_acts.py tests/test_uns_resolver.py

# Mike's exact regression
python3 -c "
import sys; sys.path.append('mira-bots')
from shared.uns_resolver import resolve_uns_path
ctx = resolve_uns_path('I have a powerflex 525 and it has it called f0004')
print(ctx.manufacturer, ctx.model, ctx.fault_code, ctx.uns_path)
"
```

---

# HANDOFF — 2026-05-20 hub-overhaul staging audit

**Session:** autonomous run, BRAVO node
**Branch:** `fix/staging-audit-2026-05-20` (at `3ac7033a`)
**PR:** #1479 (currently titled "namespace explorer fix" — see note below)
**Goal status:** all 6 phases attempted; Phase 4 partial (sandbox-blocked); Phases 1-3, 5, 6 + wrap complete.

## What I did vs the PLAN

| # | Phase | Status | Evidence |
|---|---|---|---|
| 1 | Merge #1478 + deploy to staging | ✅ | #1478 merged at b191b8a8; `stg-mira-hub` + bot + web rebuilt; MIRA services healthy |
| 2 | Full Playwright E2E audit | ✅ | 12/12 on staging; `mira-hub/tests/e2e/audit-staging-2026-05-20.spec.ts`; 12 screenshots committed |
| 3 | Bot quality benchmark | ✅ | avg 3.64/5; `tests/golden_staging_benchmark_2026-05-20.csv`; ran via mira-pipeline (NOT Telegram delivery) |
| 4 | Apply pending Hub migrations | ⚠️ | Sandbox-denied direct read. Indirect evidence (healthy app + green E2E + benchmark working) suggests ≤ #026 applied. Verification procedure in readiness doc |
| 5 | Clean up open PRs | ✅ | Merged: #1417, #1407, #1410, #1404, #1418. Open 51→46 |
| 6 | Prod-readiness doc | ✅ | `docs/evaluations/staging-to-prod-readiness-2026-05-20.md` |
| 7 | wiki/hot.md + auto-memory | ✅ | hot.md prepended; 2 new memory files added |

## Risky / Mike's eyes needed

### PR #1479 is mixed-scope

The branch ended up with 5 commits — 4 are mine (audit + benchmark + readiness doc + wiki), 1 is the namespace-explorer fix that appeared mid-session via unclear mechanism (`5d729fd8`, author `Mike Harper <bravonode@FactoryLM-Bravo.local>`). PR #1479 conflates audit work with namespace explorer.

**Action:** split into two PRs before merging — audit infra (1, 2, 4, 5) vs namespace explorer (3). The namespace fix should NOT land until its staging migration is applied (per its own body).

### Phase 3 used the pipeline, not Telegram

Goal said `@Mira_stagong_bot` (staging Telegram). I ran 10 questions through `mira-pipeline /v1/chat/completions` via `docker exec stg-mira-pipeline curl …` — same Supervisor engine, no Telegram delivery. Per-channel verification needs a human + Telegram client.

### Pre-existing engine issues (NOT today's regressions)

- 0/10 answers cite sources — cite-or-refuse implemented as refuse-only
- Retrieval miss on PowerFlex 525 (Rockwell, 34k chunks) + GS10 fault codes (AD, 4k chunks) — matches Ollama-embed-sidecar-down pattern from 2026-05-18
- UNS gate inconsistency (Q4 prox-sensor jumped to advice)

### Phase 4 verification still owed before prod deploy

```bash
doppler run --project factorylm --config prd -- psql "$NEON_DATABASE_URL" -c "
SELECT column_name FROM information_schema.columns
 WHERE table_name='kg_entities' ORDER BY ordinal_position;"
# Must contain source_chunk_id (#024) + natural_key cols (#025) + unique constraint (#026)
```

## Reproduce commands

```bash
# Tunnel to staging
ssh -fN -L 4101:127.0.0.1:4101 -L 4200:127.0.0.1:4200 root@165.245.138.91

# Audit spec
cd mira-hub
E2E_HUB_URL=http://127.0.0.1:4101 E2E_WEB_URL=http://127.0.0.1:4200 \
E2E_HUB_EMAIL=playwright@factorylm.com E2E_HUB_PASSWORD=TestPass123 \
  npx playwright test tests/e2e/audit-staging-2026-05-20.spec.ts \
  --config=tests/e2e/audit-staging.config.ts
# Expect: 12 passed (38s)

# Bot benchmark replay
bash tools/bench-staging-pipeline.sh
```

## What I deliberately did NOT do

- Deploy to production (forbidden)
- Apply migrations to staging Neon (sandbox-denied)
- Merge #1479 (mixed-scope + needs migration)
- Rebase #1445 / #1452 (CONFLICTING — author judgment needed)
- Touch `~/MiraDrop/`, prod containers, prod DB

## Open follow-ups

1. Split / rename PR #1479
2. Apply staging migration #1479 references, then merge it
3. Verify migrations 025-027 on prod Neon, then deploy
4. Run 10 questions via Telegram client to compare against pipeline-side benchmark
5. File issues: cite-or-refuse-as-refuse-only, PowerFlex/GS10 retrieval miss, Q4 UNS-gate bypass
6. Investigate root cause of working-tree contamination during branch switch
