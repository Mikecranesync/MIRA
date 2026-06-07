# Runbook: Run the Eval Suite

**Updated:** 2026-06-06
**Cross-links:** `tests/eval/README.md`, `tests/simlab/README.md`,
`tools/eval_watch.py`, `wiki/references/codegraph.md`

---

## Eval framework overview

MIRA has a 5-regime test framework plus SimLab. There are two separate runners:

| Runner | File | Use when | Output |
|---|---|---|---|
| **Offline local runner** | `tests/eval/offline_run.py` | Local development, pre-commit, CI | `tests/eval/runs/YYYY-MM-DDTHHMM-offline-{suite}.md` |
| **VPS/Celery runner** | `tests/eval/run_eval.py` | Nightly VPS judging, Celery queue | `tests/eval/runs/YYYY-MM-DD.md` (binary) or `*-judge.md` (nightly) |
| **SimLab runner** | `tests/simlab/runner.py` | Machine-behavior / direct-connection scenarios | `tests/simlab/runs/YYYY-MM-DDTHHMM-simlab.md` |
| **Watch-set watcher** | `tools/eval_watch.py` | On-save regression guard during prompt editing | Console; fires on file change |

**The offline runner is the correct tool for local development.** `tests/eval/README.md`
documents `run_eval.py` (VPS/Celery), which produces different output. If you see
`*-offline-text.md` in `tests/eval/runs/`, it came from `offline_run.py`.

---

## Current baseline

Latest run: `tests/eval/runs/2026-06-07T0009-offline-text.md`
**Pass rate: 42/57 (73%)**

Six checkpoints per fixture: FSM, RState, KeyKW, No5xx, TurnBudget, CitGrond.

Known failing: `vfd_danfoss_02`, `vfd_siemens_02` (manual-URL truncation),
`pf40`, `pf520`, `sew` (timeouts / hallucinations). See `tests/eval/README.md`
for the eval tier architecture.

---

## Prerequisites

- Doppler CLI authenticated for `factorylm/prd`
- Python 3.12, `httpx`, `psycopg`, `pyyaml`, `jinja2` installed
- `NEON_DATABASE_URL` in Doppler `factorylm/prd` (NeonDB recall is live during
  the offline run — it is NOT fully offline; only the UNS resolver has an
  offline floor per `.claude/rules/uns-compliance.md` rule #8)
- Inference cascade `GROQ_API_KEY`, `CEREBRAS_API_KEY`, `GEMINI_API_KEY` in
  Doppler `factorylm/prd` (Groq → Cerebras → Gemini; **never Anthropic** —
  removed PR #610)
- Do NOT set `ANTHROPIC_API_KEY` — any value will be rejected by the cascade
  and the PR #610 rule forbids Anthropic as a provider in any config

---

## Run the offline text suite

```bash
doppler run --project factorylm --config prd -- \
  python3 tests/eval/offline_run.py --suite text
```

**Suites:**

| Flag | What runs | When to use |
|---|---|---|
| `--suite text` | Text fixtures only (fast, ~3–5 min) | Default; pre-commit; CI |
| `--suite photos` | Photo fixtures only | After photo ingest changes |
| `--suite full` | Text + photos + judge | Before a major engine PR |

**Expected output:**

```
Running suite: text
Loaded 57 fixtures
[fixture name] ... PASS/FAIL
...
Results: 42/57 passed (73%)
Report: tests/eval/runs/2026-06-07T0009-offline-text.md
```

Output file naming: `tests/eval/runs/{date}T{time}-offline-{suite}.md`
(source: `tests/eval/offline_run.py:363`).

---

## Interpret results

Each fixture reports six checkpoints:

| Checkpoint | Meaning |
|---|---|
| `FSM` | Engine state machine reached expected state |
| `RState` | Resolved state matches expected |
| `KeyKW` | Key keywords present in response |
| `No5xx` | No 5xx error from any provider |
| `TurnBudget` | Completed within max turn count |
| `CitGrond` | Response cited at least one knowledge entry |

A fixture with `CitGrond=FAIL` and `No5xx=PASS` means the engine answered but
found no relevant knowledge in `knowledge_entries` — check ingest, not the engine.

---

## Run a single fixture (fast iteration)

```bash
doppler run --project factorylm --config prd -- \
  python3 tests/eval/offline_run.py --suite text --fixture 01_gs10_overcurrent
```

Fixture files live in `tests/eval/fixtures/*.yaml` (51 fixtures total).
Fixture name omits the `.yaml` extension.

---

## Run the watch-set watcher (on-save guard)

During prompt-tweak sessions, run this in a separate terminal:

```bash
doppler run --project factorylm --config prd -- \
  python3 tools/eval_watch.py
```

Or for a single run without watching:

```bash
doppler run --project factorylm --config prd -- \
  python3 tools/eval_watch.py --once
```

The watcher fires on edits to `mira-bots/shared/`, `mira-pipeline/`, and
`tests/eval/fixtures/`. Watch-set definition: `tests/eval/watch_set.txt` (10
fixtures: `01_gs10_overcurrent`, `04_yaskawa_out_of_kb`, `05_vague_opener_stuck_state`,
`06_safety_escalation`, `07_full_diagnosis_happy_path`, `08_asset_change_mid_session`,
`10_abbreviation_heavy`, `11_pilz_manual_miss`, `22_yaskawa_v1000_oc`,
`vfd_ab_01_pf525_f004_undervoltage`).

Source: `tools/eval_watch.py:42` — `WATCH_SET_FILE = "tests/eval/watch_set.txt"`.

---

## Run SimLab (machine-behavior scenarios)

SimLab evaluates direct-connection turn handling. Pre-seeds `source="direct_connection"`
to bypass the UNS gate (correct — direct connections are UNS-certified by construction;
see `.claude/rules/direct-connection-uns-certified.md`).

```bash
doppler run --project factorylm --config prd -- \
  python3 tests/simlab/runner.py
```

**5 scenarios** in `tests/simlab/scenarios/`. Output:
`tests/simlab/runs/YYYY-MM-DDTHHMM-simlab.md`.

SimLab was added in PR #1741 (commit `34ce186f`). It is a separate regime from
the 5-regime text/photo harness.

---

## Run golden-case regression

Golden cases are the diagnostic engine truth set. Run after any engine change:

```bash
doppler run --project factorylm --config prd -- \
  python3 tests/eval/offline_run.py --suite text --golden-only
```

Golden fixture files: `tests/golden_factorylm.csv`, `tests/golden_hybrid.csv`.

---

## Staging gate (before merging engine / RAG / classifier changes)

From `docs/environments.md` and root `CLAUDE.md`:

ALL engine / RAG / retrieval / classifier changes MUST pass the staging gate:

```bash
gh workflow run smoke-test.yml
```

Then confirm the relevant `tests/eval/` regime passes before merging to `main`.

---

## What can go wrong

| Symptom | Cause | Fix |
|---|---|---|
| `KeyError: 'GROQ_API_KEY'` | Doppler config not loaded | Prefix command with `doppler run --project factorylm --config prd --` |
| All fixtures fail with `No5xx=FAIL` | Cascade providers all down | Check Groq/Cerebras/Gemini status; `GROQ_API_KEY` in Doppler valid? |
| `CitGrond=FAIL` across many fixtures | `knowledge_entries` empty or recall broken | Run `SELECT count(*) FROM knowledge_entries WHERE tenant_id='<id>'` against NeonDB; see `docs/runbooks/upload-manual-verify-citable.md` |
| `FSM=FAIL` on fixtures that were passing | Engine state machine regression | Check recent commits to `mira-bots/shared/engine.py`; run `codegraph_impact` on changed symbols |
| NeonDB connection error | `NEON_DATABASE_URL` not in prd Doppler config | `doppler secrets --project factorylm --config prd | grep NEON` |
| UNS gate fires unexpectedly in fixture | Fixture missing expected asset context | Add UNS context to fixture YAML or check UNS resolver for the asset slug |
| SimLab `direct_connection` gate errors | Runner not seeding `source="direct_connection"` | See `tests/simlab/runner.py` — SimLab pre-seeds the context; check runner version |
| Watch-set watcher fires but runs wrong fixtures | `watch_set.txt` stale | Edit `tests/eval/watch_set.txt` to match current fixture names |
| Pass rate drops below 70% | Systemic regression | Run `--suite full` to identify which checkpoint family is failing; open issue before merging |

---

## Offline floor vs. full offline

The eval suite is **not** fully offline. Per `.claude/rules/uns-compliance.md` rule #8:

> *"Offline mode is the floor. The resolver must produce a useful result without
> NeonDB. DB enrichment is additive; any DB error falls back to the alias-table-only
> result."*

The UNS resolver has an offline floor (alias table). Everything else — NeonDB recall,
knowledge entry retrieval, pgvector cosine search — requires a live `NEON_DATABASE_URL`.
The `offline` in `offline_run.py` refers to running the engine locally (not on the
VPS Celery queue), not to eliminating external dependencies.

---

## Adding a new test fixture

1. Create `tests/eval/fixtures/<name>.yaml` following the schema in `tests/eval/README.md`.
2. For new troubleshooting features, add a golden case to `tests/golden_factorylm.csv`.
3. For direct-connection scenarios, add a SimLab scenario to `tests/simlab/scenarios/`.
4. Run the offline suite to confirm baseline: `python3 tests/eval/offline_run.py --suite text`.
5. If the fixture should be in the watch-set, add its name to `tests/eval/watch_set.txt`.
