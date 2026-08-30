# HANDOFF — Technician Beta Recovery, Workstream C (Machine Memory truth and operation)

**Date:** 2026-08-30
**Branch:** `codex/technician-beta-recovery-c` (worktree `C:/Users/hharp/.codex/worktrees/technician-beta-recovery-c`)
**Base:** `origin/main` @ `6250dd442819f172901eb6c724074a2c18f886bb` (Workstream B merged, #3480)
**PRD:** `docs/prd/2026-08-29-technician-beta-recovery-prd.md` §9 (delivery-sequence PR 3A)
**Scope delivered:** Workstream C only. Workstreams A and B were **not redone**; D and E untouched.
**Status:** GREEN for code + deterministic tests + local disposable-DB proof. HELD PR — no merge, no deploy. Human/time gates in §8.
**Production posture:** no production mutation, deploy, dispatch, Doppler `factorylm/prd` read/change, production SQL, or bench action occurred in this session.

---

## 1. Root causes (traced, not guessed)

| # | Symptom (issue) | Root cause |
|---|---|---|
| 1 | Empty REPLAY window still offered **Ask MIRA what happened**, then 412 (#3469) | `SensorSheet.ReplayPanel` rendered the CTA for every 200 history; the route only refused later, via the approved-context gate, blaming "approved asset context" for what was really "nothing recorded". |
| 2 | Header read `… · Live · anchored …` beside **0 recorded observations** (#3470) | `ReplayTimeline` printed the current-cache freshness roll-up (`FRESHNESS_LABEL`) unlabelled on the same line as the window — two facts, one sentence (PRD §6.8). |
| 3 | Fault title `offline on _stale_s` (#3470) | The historian persists an anomaly's **evidence topic** as `run_diff.tag_path` (A0's pseudo-topic `_stale_s`) and did **not** persist the rule title; `conditionTitle()` composed "<rule words> on <tag leaf>". |
| 4 | An empty replay ask could persist an `answered` turn wearing an empty machine-evidence card (gate off), or 412 (gate on) | The route answered from documents when the served window had zero rows; the refusal lived in the wrong seam. |
| 5 | No way to know, without secrets, whether Machine Memory is operational on CV-101 | No preflight; `db-inspect.yml` only has schema-drift probes. |
| 6 | The differentiating faculty had no continuous proof | No observer on the scheduled synthetic-dogfood runner. |

## 2. CURRENT → REQUIRED gap table — final disposition

| # | §9 requirement | Before | After (this PR) |
|---|---|---|---|
| 1 | CTA only when ≥1 admissible row and `reason != unavailable` | always rendered | server `coverage.admissible`; `canAskWhatHappened()` gates the button |
| 2 | Empty window sentence + no `machineEvidence` | old sentence + CTA | `Nothing was recorded in this window. Widen the window or check the gateway.` — no CTA, nothing sent |
| 3 | Unavailable ≠ empty | distinguished server-side only | `coverage.historyAvailable`, distinct sentences, distinct refusal codes |
| 4 | Current freshness labelled separately | unlabelled `Live` | `Current connection: Live/Stale/Simulated/No tags` (`data-testid=current-connection`) |
| 5 | Coverage labelled from the window | count only | `coverage {recorded, events, diffs, historyAvailable, diffsAvailable, admissible, from, to, earliest, latest, ingestLagMaxMs}` on the wire; header from it |
| 6 | Empty window never called `Live` | violated | the word only appears inside the labelled current-connection line; tests pin the header |
| 7 | No `_stale_s` / raw tag / UNS fragment in fault titles | violated | writer persists `metadata.title/message`; Hub prefers persisted title → canonical catalog (`anomaly-titles.ts`, parity-tested against `rules_core.py`) → humanized rule id; pseudo-topics never rendered |
| 8 | Both clocks visible when materially divergent | per-row only | + `ingestLagMaxMs` → "Ingest lagged the machine clock by up to N s" |
| 9 | Failed/empty replay ask persists no fabricated turn | violated (gate off) | route refuses **before** retrieval/provider/persistence: `422 machine_window_empty` / `422 machine_history_unavailable {reason}`; `recordTurn` never called |
| 10 | §9.3 read-only preflight | none | `tools/machine_memory_preflight.py` (13 reason codes, GO/NO-GO, prod-URL refusal, `--print-command` for Mike) |
| 11 | §9.4 seven-day observer | none | `tasks.machine_memory_observer` on the existing synthetic-dogfood beat, daily, read-only, inert by default; `series.json` evaluator |
| 12 | Invariants | held | one conversation/evidence model/route; no new store, historian, or scheduler; provider-free refusals; tenant-scoped reads; read-only equipment |

## 3. Files changed

**mira-hub**
- `src/lib/anomaly-titles.ts` (new) — canonical rule→title catalog + `isPseudoTopic`
- `src/lib/machine-context-intelligence.ts` — `conditionTitle(diffType, tagPath, persistedTitle)` precedence
- `src/lib/machine-memory.ts` — `latest_diffs[].title` from `metadata.title`
- `src/lib/machine-memory-response.ts` — `LatestDiff.title?`
- `src/lib/machine-history.ts` — `HistoryCoverage`, `deriveCoverage()`, `coverage` on the wire
- `src/app/api/equipment-notebooks/[id]/chat/route.ts` — the §9.2 refusal seam (`machine_window_empty` / `machine_history_unavailable`)
- tests: `src/lib/__tests__/machine-history-coverage.test.ts` (new), `src/app/api/equipment-notebooks/[id]/chat/__tests__/replay-empty-window.test.ts` (new), `src/lib/machine-context-intelligence.test.ts` (+5), `…/chat/__tests__/machine-evidence.test.ts` (7 legacy cases rewritten to the new contract — see §4)

**mira-mobile**
- `src/lib/replay.ts` — `HistoryCoverage`, `effectiveCoverage`, `canAskWhatHappened`, `currentConnectionLabel`, `coverageHeader`, `ingestLagNote`, PRD sentences
- `src/api/resources.ts` — maps `coverage`
- `src/screens/ReplayTimeline.tsx` — two labelled facts; empty/unavailable sentences; lag note
- `src/screens/SensorSheet.tsx` — CTA gated on `canAskWhatHappened`
- tests: `src/lib/__tests__/replay.test.ts` (+5), `src/screens/__tests__/sensor-replay.test.tsx` (+4, 3 legacy assertions moved from `freshness-label` to `current-connection`)

**mira-crawler**
- `run_engine/machine_memory.py` — persists `metadata.title` + `metadata.message` (additive)
- `agents/machine_memory_observer.py` (new), `tasks/machine_memory_observer.py` (new), `celeryconfig.py` (route, rate limit, daily beat entry on the synthetic-dogfood profile)
- tests: `tests/test_machine_memory_observer.py` (new, 9), `tests/test_machine_memory.py` (+1)

**tools / tests / docs / infra**
- `tools/machine_memory_preflight.py` (new) + `tests/test_machine_memory_preflight.py` (new, 13)
- `tests/regime7_ignition/test_anomaly_title_catalog_parity.py` (new, 3)
- `docker-compose.saas.yml` — observer env on `mira-synthetic-dogfood-worker` (default `0`)
- `docs/env-vars.md` — observer vars; `docs/runbooks/machine-memory-preflight-and-observer.md` (new)

## 4. RED → GREEN evidence

| Suite | RED (before implementation) | GREEN |
|---|---|---|
| `machine-context-intelligence.test.ts` (§9.2 titles) | `expected 'offline on _stale_s' to be 'PLC/bridge offline'` (4 ×) | 11/11 |
| `machine-history-coverage.test.ts` | `expected undefined to deeply equal {recorded: 3…}` (4 ×) | 4/4 |
| `replay-empty-window.test.ts` | 6 × (route answered 200 / persisted) | 6/6 |
| `test_anomaly_title_catalog_parity.py` | `missing catalog: …/anomaly-titles.ts` | 3/3 |
| `test_machine_memory.py::TestAnomalyTitlePersisted` | `KeyError: 'title'` | 27/27 |
| `replay.test.ts` (§9.2 helpers) | `canAskWhatHappened is not a function` (5 ×) | 45/45 |
| `sensor-replay.test.tsx` (§9.2 UI) | 3 × (CTA rendered, no `current-connection`, old sentence) | 16/16 |
| `test_machine_memory_preflight.py` | `ModuleNotFoundError: machine_memory_preflight` | 13/13 |
| `test_machine_memory_observer.py` | `ModuleNotFoundError: agents.machine_memory_observer` | 9/9 |

Regression: mira-hub machine-memory/notebooks/history/components lanes **380 passed (29 files)**; mira-mobile full suite **326 passed (30 files)**; mira-crawler machine-memory + dogfood + observer **48 passed**; ESLint clean on changed hub files; `tsc --noEmit` 0 errors in changed hub files and mobile; ruff check/format clean; `git diff --check` clean.

**Deliberately rewritten legacy tests** (`machine-evidence.test.ts`, 7 cases): they pinned the pre-§9.2 behaviour — empty/unavailable windows answered from documents with an empty machine card, or 412 blaming approved context. Each now pins the new seam contract (422 + code, no provider, no `recordTurn`). This strengthens, not weakens: every "no provider call / nothing persisted" assertion is retained and extended.

## 5. Local / disposable proof (outside production)

Disposable `postgres:16` with migrations 033 + 038 + 040 applied, a seeded CV-101 `faulted` window and 31 `plc_bridge` rows (local only; nothing shared):

- wrong tenant + run-diff off → `NO-GO` `[RUN_DIFF_DISABLED, CV101_NOT_CONFIGURED, NO_FAULT_TRIGGERS, INGEST_NONE, HISTORIAN_NONE, NO_FAULT_WINDOW]` (exit 1)
- configured tenant, rows 20 min old → `NO-GO [INGEST_STALE]` with `fault_window.row_count=31, classification=physical, historian.age_s=33` — the honest verdict for a stale feed
- + one fresh ingest row → **`GO []`** (exit 0)
- `--db-url postgres://…ep-prod-1.neon.tech/…` → `REFUSED` (exit 2); `--print-command` prints the operator invocation and runs nothing

The observer's synthetic proof is its test suite (fake Hub, 3 GETs, daily file + `series.json` with `days_observed`, `operational:false`, `SEVEN_DAYS_NOT_ACCRUED`). It has **not** been run against staging/production from this session.

## 6. Dry-run / inert-by-default semantics

- Preflight: read-only connection (`default_transaction_read_only=on`, autocommit, SELECT only), never prints the URL/password, refuses prod-looking URLs unless `--allow-production-by-operator` (Mike).
- Observer: `MACHINE_MEMORY_OBSERVER_ENABLED=0` by default in compose; with `0` the task returns `{enabled:false}` and builds no client, writes no file. When enabled it signs in as an **existing** user (never registers) and performs GETs only.

## 7. Collision notes

No open PR touches `machine-history.ts`, `machine-context-intelligence.ts`, `ReplayTimeline.tsx`, `SensorSheet.tsx`, `celeryconfig.py`'s synthetic profile, or `run_engine/machine_memory.py` (checked `gh pr list` at session start; #3477 owns `equipment-notebooks.ts` — untouched).

## 8. What remains human / production / time-gated

1. **Merge = Mike.** PR is HELD.
2. **Production preflight**: Mike runs the printed command with `factorylm/prd` Doppler access; any `MIRA_RUN_DIFF_ENABLED` / UNS-path / trigger change is a Doppler change Mike makes.
3. **Observer enablement**: Mike sets `MACHINE_MEMORY_OBSERVER_*` in Doppler and redeploys the dogfood worker/beat via `deploy-vps.yml`.
4. **Seven consecutive scheduled days** can only accrue with wall-clock time after (3); `series.json` reports it — never asserted. At least one **real** (non-simulated) CV-101 fault window with rows is required; if none occurs, Mike creates one with the bench's physical controls.
5. **Pixel device acceptance** of the new REPLAY copy (emulator/unit-proven here).

## 9. Accepted lower-severity limitations

- `historian.age_s` uses `machine_state_window.created_at` as the derivation heartbeat (040 has no `updated_at`); a long-open window that is only being *extended* would read older than the last historizer beat. Documented; a dedicated historizer heartbeat row is a follow-up, not a §9.3 requirement.
- Hub web (`NotebookChat`) has no REPLAY CTA; its persisted-card captions were already honest (`No machine changes recorded in this window` / `Machine history unavailable`) and are unchanged.
- The mobile `LIVE_UNAVAILABLE_BANNER` ("Live unavailable — showing recorded history") is now shown only on non-empty windows; wording kept to avoid churning a pinned string.
