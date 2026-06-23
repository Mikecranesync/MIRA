# Discovery Corpus — the permanent industrial-interrogation library

> **Operating principle #1 (ProveIt 2027 northstar plan, non-negotiable):**
> *"Code-first interrogation. Every dataset is interrogated by **deterministic code first, LLM
> second.** Every investigation is recorded; every discovery becomes reusable code in
> `/discovery_corpus/`. (Discovery Recorder is MANDATORY.)"*
> — `docs/plans/2026-06-22-proveit-northstar-contextualized-factory-plan.md`

This directory is the **Discovery Recorder**: a permanent, append-only library of how we interrogate
real industrial data. It exists so that we never re-derive the same structural finding twice, and so
that every "we figured out what this export *is*" moment becomes deterministic, testable code — not a
one-off chat.

## The North Star loop

```
Claude discovers once  →  deterministic Python  →  synthetic fixture  →  test + report
        →  future datasets interrogated by code first, AI second
```

A new dataset is **parsed, counted, classified, and claim-checked by code** before any model reasons
over it. The model never gets to *guess* the topology or the layer; code already established it and a
test re-proves it.

## Layout

| Path | Purpose |
|---|---|
| `EVIDENCE_TYPES.md` | The five evidence classes + what may/never be committed. Read this first. |
| `sessions/` | One Markdown record per investigation — **including failed hypotheses**. The *recorded* part of the recorder. |
| `playbooks/` | Reusable methodology — how to interrogate a *class* of dataset (general + Ignition-MES). |
| `scripts/` | The deterministic interrogators. Read-only, stdlib-only (+ the in-repo `mira_plc_parser`). |
| `tests/` | Pytest that re-derives every claim against the committed **synthetic** fixture only. |
| `fixtures/` | The committed **synthetic** stand-ins. The licensed corpus is **never** copied here. |
| `reports/` | Generated reports from running the interrogator on the synthetic fixture. |
| `run_phase0.py` | The one-command verification gate (interrogate → report → pytest → exit code). |

## One-command verification

```bash
python discovery_corpus/run_phase0.py     # from the worktree root (cross-platform)
make discovery-phase0                       # convenience wrapper (same thing)
```

This runs the deterministic interrogation against the synthetic fixture, writes/updates
`reports/phase0_synthetic.{md,json}`, runs the Phase 0 pytest suite, and **exits nonzero** on any
failing claim, failing test, or parser warning.

## What "a discovery" must produce (the core rule)

> **Every useful discovery must become deterministic code, a fixture, a test, and a recorded session.**

A finding that only lives in prose is not done. It lands as a function in `scripts/`, a synthetic
fixture in `fixtures/`, a claim verdict re-proved in `tests/`, and a `sessions/` record (with the
hypotheses you *rejected*, not just the conclusion).

## Hard rules (inherited from the northstar plan)

- **Read-only, deterministic, no network.** Every script runs the same offline, every run.
- **The licensed Cappy Hour corpus is NEVER committed.** All committed code/tests/report run on
  `fixtures/synthetic_factory_export.json`. Sessions capture the real corpus's *structure/counts* as
  notes — never raw tag values. See `EVIDENCE_TYPES.md`.
- **Claims are reproducible.** Important conclusions ("MES not PLC", "no ladder logic", "counts/state
  present") are computed by `assess_claims()` and re-proved by tests — not asserted in prose.

## Current contents (Phase 0)

- `scripts/interrogate_ignition_export.py` — deterministic interrogator: topology counts,
  area→line→asset hierarchy, signal-archetype histogram, discrete-MES vs continuous-process family
  verdict, and **five reproducible claim verdicts (C1–C5)**.
- `tests/test_interrogate_ignition.py` — 18 pytest, green, on the synthetic fixture.
- `fixtures/synthetic_factory_export.json` — the committed synthetic Ignition/Sepasoft export.
- `reports/phase0_synthetic.md` / `.json` — the generated Phase 0 report.
- `playbooks/classifying-an-unknown-dataset-layer.md` (general) +
  `playbooks/interrogating-ignition-mes-exports.md` (worked example).
- `sessions/2026-06-22-session-001-cappy-interrogation.md` — the first recorded session, with failed
  hypotheses.
- `run_phase0.py` — the one-command gate.
