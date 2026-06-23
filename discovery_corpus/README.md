# Discovery Corpus — the permanent industrial-interrogation library

> **Operating principle #1 (ProveIt 2027 northstar plan, non-negotiable):**
> *"Code-first interrogation. Every dataset is interrogated by **deterministic code first, LLM
> second.** Every investigation is recorded; every discovery becomes reusable code in
> `/discovery_corpus/`. (Discovery Recorder is MANDATORY.)"*
> — `docs/plans/2026-06-22-proveit-northstar-contextualized-factory-plan.md`

This directory is the **Discovery Recorder**: a permanent, append-only library of how we
interrogate real industrial data. It exists so that we never re-derive the same structural finding
twice, and so that every "we figured out what this export *is*" moment turns into deterministic,
testable code instead of a one-off chat.

## The discipline: interrogate by code first, LLM second

When a new industrial dataset arrives (an Ignition tag export, a PLC program, a CMMS dump), the
order of operations is:

1. **Deterministic code first.** Parse it, count it, classify it, map its hierarchy — with a
   read-only, stdlib-only script that produces the same answer every run. This is what makes the
   data *legible* and *trustworthy* before any model is asked a question about it.
2. **LLM second.** Only once the structure is established by code does an LLM reason over it. The
   model never gets to *guess* the topology; code already established it.

A real Sepasoft/Ignition MES-OEE export is the canonical example: 4090 "nodes" look like 4090 live
tags, but a deterministic pass shows they are a UDT *metadata model* — a single Filler's ~74 nodes
are ~8 live values wrapped in static metadata. The LLM would hallucinate "4090 sensors"; the code
says "~8 live values per asset, the rest is scaffolding."

## Layout

| Path | Purpose |
|---|---|
| `sessions/` | One Markdown record per investigation (9-field template). The *recorded* part of the recorder. |
| `playbooks/` | Reusable methodology distilled from sessions — how to interrogate a *class* of export. |
| `scripts/` | The deterministic interrogators. Read-only, stdlib-only (+ the in-repo `mira_plc_parser`). |
| `tests/` | Pytest for every script, run against the committed **synthetic** mini fixture only. |
| `fixtures/` | Pointer to the committed synthetic mini fixture. **The licensed corpus is never copied here.** |

## Hard rules (inherited from the northstar plan)

- **Read-only, deterministic, no network.** Every script in `scripts/` runs the same offline.
- **The licensed Cappy Hour corpus is NEVER committed.** All code and tests run on the synthetic
  mini fixture at `mira-plc-parser/tests/fixtures/ignition_cappy_hour_mini.json`. Session records may
  capture the real corpus's *structure and counts* as notes — never raw tag values.
- **Every discovery becomes reusable code.** A finding that only lives in a chat or a doc is not
  done; it lands as a function in `scripts/` with a test.

## Current contents

- `scripts/interrogate_ignition_export.py` — deterministic Ignition/Sepasoft MES-export
  interrogator: topology counts, area→line→asset hierarchy, signal-archetype histogram, per-asset
  discrete-MES vs continuous-process family verdict.
- `tests/test_interrogate_ignition.py` — pytest for the interrogator on the mini fixture.
- `playbooks/interrogating-ignition-mes-exports.md` — the reusable methodology.
- `sessions/2026-06-22-session-001-cappy-interrogation.md` — the first recorded session (the Cappy
  Hour topology study).
