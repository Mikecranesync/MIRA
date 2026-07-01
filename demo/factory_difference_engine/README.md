# Factory Difference Engine — Prove-It 2027 demo

The **automated, replayable** version of the 20-minute live arc in
`docs/plans/2026-06-22-proveit-2027-demo-runbook.md`. It walks a user through the
five stages on a live (simulated) factory, **offline and deterministic** so it can
be exercised repeatedly in one sitting — no cloud LLM, no NeonDB.

> **Connect → Pick → Prove → Explain → Learn**
> *Litmus/Ignition/OPC UA get the data. MIRA finds what changed, groups the
> differences into a machine event, and explains what it means for maintenance.*

## Run it

```bash
# narrated walkthrough, scenario A (filler underfill), deterministic
python -m demo.factory_difference_engine

# a different fault (A–F), or a SimLab scenario id
python -m demo.factory_difference_engine --scenario D

# machine-readable
python -m demo.factory_difference_engine --json

# opt-in: use the REAL Supervisor for the Explain stage (needs cloud LLM + Neon; non-deterministic)
python -m demo.factory_difference_engine --live

# the deterministic replay test (CI-safe, offline)
pytest tests/simlab/test_proveit_demo.py -v
```

## What each stage reuses (this demo builds NO new infrastructure)

| Stage | What it shows | Reused component |
|---|---|---|
| **Connect** | read-only discovery of N live signals, zero writes | `simlab.engine` snapshot + `mira-relay/ingest_contract.normalize_tag_path` |
| **Pick** | approve tags into the fail-closed allowlist + upload the asset's manuals | `approved_tags`(mig 035) + `knowledge_entries`(mig 001) **shapes**; `simlab/docs/{asset}` manuals |
| **Prove** | learn normal → detect differences → group into **one** machine event | `plc/conv_simple_anomaly/{baseline_learner, difference_detectors}` (merged to main) |
| **Explain** | grounded, cited answer (manuals + PLC signals + historical baseline), scored | `simlab.diagnostic.assemble_evidence`/`grade` + `event_context.build_event_context` |
| **Learn** | approve/reject the inferred context; state transitions | `mira-bots/shared/proposal_transition.py` (ADR-0017) |

The only new code is the **orchestration glue** (`pipeline.py` + `__main__.py`) and the
**deterministic offline Explain** (`build_grounded_explanation`) — the offline stand-in
for the Supervisor's LLM answer, which `--live` swaps for the real thing.

## Assets — the "Northwind Bottling / CV-200" alias

"Northwind Bottling" and "CV-200" **do not exist** in the repo — they are a demo alias
over SimLab's deterministic **juice-bottling line** (`enterprise.florida_natural_demo…`).
`CV-200` defaults to `filler01` (the richest, already-proven fault). Everything is real,
seeded, and replayable; only the display names are aliased (`pipeline.py` → `LINE_ALIAS`,
`ASSET_TAG`, `SCENARIOS`).

## Deterministic vs live

- **Deterministic (default):** SimLab seed `42` → byte-identical replay. Explain is a
  templated grounded answer assembled from the evidence packet + baseline + manuals; it
  **passes the SimLab rubric** (`grade()` → root-cause ✓, asset ✓, evidence-recall 100%,
  3 citations). This is the CI-safe path.
- **Live (`--live`):** hands the machine-event context block to the real
  `Supervisor.process` for an LLM-generated cited answer. Requires
  `INFERENCE_BACKEND=cloud` + provider keys + `NEON_DATABASE_URL`. Not used in CI.

## Gap analysis (what already existed vs what this filled)

Inventoried across the five stages (2026-07-01). **~85% already existed** and is reused:
Connect (discover.py, Litmus proof, ingest → `tag_events`), Pick (`approved_tags`,
`/api/documents/upload`, `ai_suggestions`), Prove (the difference engine), Explain
(Supervisor, RAG, citation compliance, SimLab evidence), Learn (`/decide` routes,
`proposal_transition.py`). **The gap was a single deterministic orchestration** walking
all five stages in one replayable sitting — plus an offline Explain so the replay needs
no cloud. That gap is what this package fills; nothing else was built.

## Cross-references

- `docs/plans/2026-06-22-proveit-2027-demo-runbook.md` — the live 20-min arc this automates
- `docs/product/mira_difference_engine_offering.md` / `…_prd.md` — the product framing
- `tests/simlab/test_difference_engine.py` — the difference-engine proof this composes
- `.claude/rules/one-pipeline-ingest.md`, `.claude/rules/fieldbus-readonly.md` — the laws honored (read-only, one pipeline)
