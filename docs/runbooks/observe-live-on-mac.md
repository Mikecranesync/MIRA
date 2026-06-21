# Runbook — run the observe layer LIVE on a Mac node

The observe eval/dashboard tooling runs anywhere in **mock** mode. To run it
**`--live`** (real `Supervisor` → real NeonDB retrieval → real cascade LLMs) you
want a **Mac node**, not the Windows laptop:

- **NeonDB SSL fails from Windows** (`channel_binding` not supported) — see root
  `CLAUDE.md` Gotchas. macOS connects cleanly. So live retrieval = Mac.
- Best Neon performance comes from a node on the same Tailnet with the pooled
  endpoint + `NullPool` (Neon's PgBouncer pools; never pool app-side — see
  `.claude/rules/python-standards.md`).

## Branch to use

```
integration/observe-live
```
This is `main` (which already has the merged observe layer #2154 + PII scrub
#2157) plus the three still-open pieces cherry-picked on top:
- `tools/langfuse_export.py` (#2172) — pull traces from Langfuse
- `simlab/observe/evalpacks/garage_conveyor_field.yaml` (#2185) — real-question pack
- `simlab/observe/dashboard.py` (#2201) — local dashboard

One checkout = the whole pipeline. (When #2172/#2185/#2201 merge, this branch is
disposable — just use `main`.)

## Which node

**Charlie** (`100.70.49.126`, KB host) is the natural home — it already runs the
MIRA KB. Bravo works too. Either reaches NeonDB over the Tailnet.

## Environment — STAGING, never prod

**Use `factorylm/stg`.** `--live` exercises the real engine, which **writes**
`decision_traces` / groundedness episodes. Pointing a feature build at **prod**
NeonDB contaminates the truth set (see `.claude/CLAUDE.md` § Environment
boundaries, and `docs/environments.md`). Read-only it is *not*. Staging only.

> Caveat: a fair **grounding** result needs the garage-conveyor / GS10 docs
> seeded in the **staging** KB. If they aren't, a `--live` run will look
> ungrounded — that reflects the seed gap, not the engine. Seed staging first
> (`apply-seeds.yml` / `seed-oem-manuals.yml`) and verify BM25 recall before
> trusting the score. See `.claude/skills/retrieval-diagnostics`.

## Steps (on Charlie)

```bash
ssh charlie
cd ~/MIRA                      # or wherever the repo lives on the node
git fetch origin
git checkout integration/observe-live
git pull --ff-only

# deps (uv per python-standards; bot deps power the live engine)
uv pip install -r mira-bots/requirements.txt   # or the per-adapter requirements

# 1) Run the real-question pack against the live engine (staging)
doppler run --project factorylm --config stg -- \
    python -m simlab.observe.run_eval garage_conveyor_field --live

# 2) Or the dashboard (the Run buttons call run_eval in MOCK mode; for live
#    runs use the CLI above and the report shows up in the History/reports view)
doppler run --project factorylm --config stg -- \
    python -m simlab.observe.dashboard            # → http://127.0.0.1:8770

# 3) Re-pull fresh Langfuse history any time (read-only; prd keys hold the data)
doppler run --project factorylm --config prd -- \
    python tools/langfuse_export.py --as-evalseed
```

## What a live run tells you

- **asset resolution** — does the engine resolve `enterprise.garage.line1.conveyor1`?
- **grounding** — do the GS10/Micro820 answers cite real KB chunks, or fall back
  to "general industrial knowledge"? (Historical export: ~26% ungrounded.)
- **regressions** — re-run after engine/prompt/retrieval changes; the pack's
  answer_points + hallucination/safety traps catch drift.

## Notes

- The dashboard's **Run** buttons execute **mock** mode (no engine) so the UI
  stays responsive and dependency-free. Live runs are the CLI form above; their
  JSON reports land in `simlab/observe/reports/` and appear in the dashboard's
  reports list.
- Never run `--live` against the prod Telegram bot token or prod NeonDB.
- Export output (`tools/langfuse-export/` or `~/langfuse-export`) is unsanitized
  customer data — git-ignored, never committed.
