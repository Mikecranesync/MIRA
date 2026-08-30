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
| 5 | Coverage labelled from the window | count only | `coverage {recorded, events, diffs, historyAvailable, diffsAvailable, admissible, from, to, earliest, latest, ingestLagMaxMs}` on the wire; header + `first … · last …` line from it; rows carry `simulated`/`source_system` provenance |
| 6 | Empty window never called `Live` | violated | the word only appears inside the labelled current-connection line; tests pin the header |
| 7 | No `_stale_s` / raw tag / UNS fragment in fault titles | violated (packet, Hub card, WO prefill) | writer persists `metadata.title/message`; ONE helper `conditionDisplayTitle()` (persisted title → canonical catalog parity-tested against `rules_core.py` → humanized rule id) feeds the packet, the Hub card, and the WO prefill; pseudo-topics never rendered |
| 8 | Both clocks visible when materially divergent | per-row only | + `ingestLagMaxMs` → "Recorded up to N s after it happened"; historical cards say `connection at capture: …` |
| 9 | Failed/empty replay ask persists no fabricated turn | violated (gate off) | route refuses **before** retrieval/provider/persistence: `422 machine_window_empty` / `422 machine_history_unavailable {reason}`; `recordTurn` never called |
| 10 | §9.3 read-only preflight | none | `tools/machine_memory_preflight.py` (15 reason codes, GO/NO-GO, fail-closed host allowlist + prod-Doppler refusal, tenant required, `--print-command` for Mike) |
| 11 | §9.4 seven-day observer | none | `tasks.machine_memory_observer` on the existing synthetic-dogfood beat, daily, read-only, inert by default; `series.json` evaluator |
| 12 | Invariants | held | one conversation/evidence model/route; no new store, historian, or scheduler; provider-free refusals; tenant-scoped reads; read-only equipment |

## 3. Files changed

**mira-hub**
- `src/lib/anomaly-titles.ts` (new) — canonical rule→title catalog, `isPseudoTopic`, `conditionDisplayTitle` (shared by packet, card, WO prefill)
- `src/components/MachineMemoryCard.tsx` — condition row + work-order prefill use the shared title; `src/components/equipment/notebook-chat-utils.ts` — labelled capture connection on the historical card
- `src/lib/machine-context-intelligence.ts` — `conditionTitle(diffType, tagPath, persistedTitle)` precedence
- `src/lib/machine-memory.ts` — `latest_diffs[].title` from `metadata.title`
- `src/lib/machine-memory-response.ts` — `LatestDiff.title?`
- `src/lib/machine-history.ts` — `HistoryCoverage`, `deriveCoverage()`, `coverage` on the wire
- `src/app/api/equipment-notebooks/[id]/chat/route.ts` — the §9.2 refusal seam (`422 machine_window_empty` / `422 machine_history_unavailable` / `503 machine_history_read_failed`)
- tests: `src/lib/__tests__/machine-history-coverage.test.ts` (new), `src/app/api/equipment-notebooks/[id]/chat/__tests__/replay-empty-window.test.ts` (new), `src/lib/machine-context-intelligence.test.ts` (+5), `…/chat/__tests__/machine-evidence.test.ts` (7 legacy cases rewritten to the new contract — see §4)

**mira-mobile**
- `src/lib/replay.ts` — `HistoryCoverage`, `effectiveCoverage`, `canAskWhatHappened`, `currentConnectionLabel`, `coverageHeader`, `ingestLagNote`, PRD sentences
- `src/api/resources.ts` — maps `coverage`
- `src/screens/ReplayTimeline.tsx` — two labelled facts; empty/unavailable sentences; lag note
- `src/screens/SensorSheet.tsx` — CTA gated on `canAskWhatHappened`
- tests: `src/lib/__tests__/replay.test.ts` (+5), `src/screens/__tests__/sensor-replay.test.tsx` (+4, 3 legacy assertions moved from `freshness-label` to `current-connection`)

**mira-crawler**
- `run_engine/machine_memory.py` — persists `metadata.title` + `metadata.message` (additive)
- `agents/machine_memory_observer.py` (new), `tasks/machine_memory_observer.py` (new), `celery_app.py` (task module registered), `celeryconfig.py` (route, rate limit, flag-gated daily beat entry on the synthetic-dogfood profile)
- tests: `tests/test_machine_memory_observer.py` (new, 11 — incl. task-registration + beat-gating + no-redirect pins), `tests/test_machine_memory.py` (+1)

**tools / tests / docs / infra**
- `tools/machine_memory_preflight.py` (new) + `tests/test_machine_memory_preflight.py` (new, 17)
- `tests/regime7_ignition/test_anomaly_title_catalog_parity.py` (new, 3)
- `docker-compose.saas.yml` — observer env on `mira-synthetic-dogfood-worker` + the flag on `-beat` (default `0`)
- `docs/prd/2026-08-28-sensor-v0-contract.md` — §4.4 amended for the §9.2 refusal semantics
- `docs/env-vars.md` — observer vars; `docs/runbooks/machine-memory-preflight-and-observer.md` (new)

## 4. RED → GREEN evidence

| Suite | RED (before implementation) | GREEN |
|---|---|---|
| `machine-context-intelligence.test.ts` (§9.2 titles) | `expected 'offline on _stale_s' to be 'PLC/bridge offline'` (4 ×) | 11/11 |
| `machine-history-coverage.test.ts` | `expected undefined to deeply equal {recorded: 3…}` (4 ×) | 4/4 |
| `replay-empty-window.test.ts` | 6 × (route answered 200 / persisted) | 7/7 (incl. 503 read-failed) |
| `test_anomaly_title_catalog_parity.py` | `missing catalog: …/anomaly-titles.ts` | 3/3 |
| `test_machine_memory.py::TestAnomalyTitlePersisted` | `KeyError: 'title'` | 27/27 |
| `replay.test.ts` (§9.2 helpers) | `canAskWhatHappened is not a function` (5 ×) | 45/45 |
| `sensor-replay.test.tsx` (§9.2 UI) | 3 × (CTA rendered, no `current-connection`, old sentence) | 16/16 |
| `test_machine_memory_preflight.py` | `ModuleNotFoundError: machine_memory_preflight` | 17/17 |
| `test_machine_memory_observer.py` | `ModuleNotFoundError: agents.machine_memory_observer` | 11/11 |

Regression (after both review rounds): mira-hub machine-memory/notebooks/history/components lanes **400 passed (31 files)**; mira-mobile full suite **326 passed (30 files)**; mira-crawler machine-memory + dogfood + observer **53 passed**; ESLint clean on changed hub files; `tsc --noEmit` 0 errors in changed hub files and mobile; ruff check/format clean; `git diff --check` clean.

**Deliberately rewritten legacy tests** (`machine-evidence.test.ts`, 7 cases): they pinned the pre-§9.2 behaviour — empty/unavailable windows answered from documents with an empty machine card, or 412 blaming approved context. Each now pins the new seam contract (422 + code, no provider, no `recordTurn`). This strengthens, not weakens: every "no provider call / nothing persisted" assertion is retained and extended.

## 5. Local / disposable proof (outside production)

Disposable `postgres:16` with migrations 033 + 038 + 040 applied, a seeded CV-101 `faulted` window and 31 `plc_bridge` rows (local only; nothing shared):

- wrong tenant + run-diff off → `NO-GO` `[RUN_DIFF_DISABLED, CV101_NOT_CONFIGURED, NO_FAULT_TRIGGERS, INGEST_NONE, HISTORIAN_NONE, NO_FAULT_WINDOW]` (exit 1)
- configured tenant, rows 20 min old → `NO-GO [INGEST_STALE]` with `fault_window.row_count=31, classification=physical, historian.age_s=33` — the honest verdict for a stale feed
- + one fresh ingest row → **`GO []`** (exit 0)
- `--db-url postgres://…ep-prod-1.neon.tech/…` → `REFUSED` (exit 2); `--print-command` prints the operator invocation and runs nothing

The observer's synthetic proof is its test suite (fake Hub, 3 GETs, daily file + `series.json` with `days_observed`, `operational:false`, `SEVEN_DAYS_NOT_ACCRUED`). It has **not** been run against staging/production from this session.

## 6. Dry-run / inert-by-default semantics

- Preflight: read-only connection (`default_transaction_read_only=on`, autocommit, SELECT only), never prints the URL/password. **Fail-closed allowlist gate** (review finding): only loopback or an operator-named dev/staging host (`--allow-host` / `MACHINE_MEMORY_PREFLIGHT_ALLOWED_HOSTS`) is readable, a `prd|prod|production` Doppler shell is refused regardless, a tenant is required (`TENANT_REQUIRED`, no query without one), and a driver failure prints only `DB_CONNECT_FAILED`. `--allow-production-by-operator` is Mike's lift via `--print-command`.
- Observer: `MACHINE_MEMORY_OBSERVER_ENABLED=0` by default in compose (worker **and** beat); the beat entry is registered only when `1`, the task module is registered in `celery_app._TASK_MODULES` (test-pinned), the task returns `{enabled:false}` and builds no client when off. When enabled it signs in as an **existing** user (never registers), performs GETs only, and never follows redirects with the session.

## 6b. Adversarial review round 1 (architecture / security / data-isolation) — disposition

| Sev | Finding | Fix |
|---|---|---|
| P1 | prod-URL refusal was a hostname denylist; real Neon hosts carry no `prod` marker | replaced with the fail-closed allowlist + Doppler-config refusal above; tests use real Neon host shapes |
| P1 | observer task never registered on the worker; beat entry always scheduled | `celery_app._TASK_MODULES` += `machine_memory_observer`; beat entry only when enabled; flag forwarded to the beat container; registration test |
| P2 | preflight scanned across tenants when `MIRA_TENANT_ID` unset | `TENANT_REQUIRED`, no query issued |
| P2 | contract change (empty window → 422) buried as a test rewrite | `docs/prd/2026-08-28-sensor-v0-contract.md` §4.4 amended; stated in PR body; **decision for Mike:** "documents attached + empty replay window → 422" (chosen) vs "answer from documents without a card" |
| P2 | transient history read failure surfaced as `machine_history_unavailable` | `503 machine_history_read_failed` — "Machine Memory could not be read just now. Try again in a moment." |
| P3 | driver error could print host/user; `sslmode=prefer` | `DB_CONNECT_FAILED` only; `require` except loopback |
| P3 | observer followed redirects with the session cookie | `follow_redirects=False` (test-pinned) |
| P3 | redaction regex narrow | accepted: the daily record never carries the cookie/URL/password by construction |

## 6c. Adversarial review round 2 (product truth / technician UX / PRD conformance) — disposition

| Sev | Finding | Fix |
|---|---|---|
| P1 | Hub web `MachineMemoryCard` row + work-order prefill still rendered `tag_path — diff_type` (`…_stale_s — anomaly_A0_OFFLINE`) | ONE shared helper `conditionDisplayTitle()` (`anomaly-titles.ts`) now feeds the packet, the card row, and the WO prefill (`[CV-101] PLC/bridge offline`); pseudo-topics never rendered; tests |
| P1 | observer could not detect simulated rows — served history rows carried no provenance, so the seven-day gate was fakeable by simulator data | `MachineHistoryRow` now carries `simulated` + `source_system` from `tag_events` (null on diffs); the observer classifies from row provenance, falls back to the server's freshness roll-up, and **never** calls provenance-less rows physical (`unknown` blocks `operational`); tests |
| P2 | persisted replay cards collapsed the two clocks (`… · Live`) | `… · connection at capture: Live` on both mobile and Hub cards (labelled, per §6.8) |
| P2 | window bounds shown only relatively | `first hh:mm:ss · last hh:mm:ss` line from `coverage.earliest/latest` on the phone |
| P2 | preflight prod refusal decorative | already replaced in round 1 (fail-closed allowlist + Doppler-config refusal) |
| P2 | `historian_heartbeat` overclaims | field keeps its PRD name but carries `kind: "latest_state_window_derivation"`; documented as not a historizer execution timestamp |
| P3 | "refuses before retrieval" was false (retrieval ran first) | machine-evidence fetch + refusal now precede `retrieveNodeChunks` — the claim is true |
| P3 | "Ingest lagged the machine clock…" is jargon | "Recorded up to N s after it happened" |
| P3 | observer verifies API self-consistency, not UI | accepted: the phone renders from the same `coverage`/rows (unit-pinned); a UI-level probe is emulator work (Workstream D/E tooling), noted in §9 |

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
- The observer's `api_state_consistent` checks the API's own claims against its rows (coverage vs rows vs reason); it does not drive the phone UI. The phone renders from the same fields (unit-pinned), and a device-level probe belongs to the emulator/device tooling.
