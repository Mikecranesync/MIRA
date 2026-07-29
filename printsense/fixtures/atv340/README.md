# ATV340 — defective calibration benchmark (Schneider Altivar ATV340, NVE97896-02)

The **negative** calibration anchor for PrintSense grading — the opposite of the SCU2 gold
package. This is a real Claude-produced interpretation of Schneider's ATV340 wiring diagram
whose prose scored 81/B from the LLM judge while its structured graph carries P0 electrical
errors. It exists to prove the deterministic import gate FAILs a structurally-unsafe graph no
matter how fluent the prose — **good prose does not imply a trustworthy graph.**

## Files

| File | What |
|---|---|
| `graph.json` | The **defective** PrintSynth graph (frozen copy of `internet_print_tests/schneider-atv340-vfd/extraction.json`). |
| `explanation.md` | The **verified truth-set** — every defect, the correct reading, and the gate that catches it. `truth_status: draft_llm_authored` until Mike freezes it. |
| `judgement.json` | The acceptance audit — the P0 defects that must be caught + the two-axis verdict. |
| `source.json` | Provenance: source URL + sha256 to re-fetch / re-render (the rendered page is gitignored). |

## Verdict (measured, not hardcoded)

`quality_tier=USEFUL_DRAFT` · `import_verdict=FAIL` · `bot_importable=false` · `score=74/100`.
Rubric: `printsense/benchmarks/atv340_vfd/rubric.json`. Test: `tests/printsense/test_atv340_benchmark.py`.

Six deterministic import-blockers fire: `exact_label_mismatch` (DQ→DO), `dangling_reference` (CN3),
`duplicate_identifier`, `incorrect_connector_ownership` (RS422→CN4 not CN3),
`incompatible_functional_path` (braking `PC/-`), `variant_crossover` (S1S2 × dc_bus). (Plus
`confident_misread` + `off_page_from_pagination`.)

## ⚠️ Truth freeze — human action required (PRD §10.7)

`truth_status` is **`draft_llm_authored`** — the facts are verified against the rendered page
(durable spec §3) but await **Mike's review-and-freeze**. Until it is `frozen_human_confirmed`,
`test_atv340_frozen_verdict` **skips** (it must not block CI on unfrozen truth). To freeze: confirm
the defect rows in `explanation.md`, then set `"truth_status": "frozen_human_confirmed"` in the
rubric.

## Trust state — ⚠️ this is a *defective* graph on purpose

Unlike the SCU2 gold package, this graph is the **failing** reference. Do not treat its entities as
correct; the correct reading lives in `explanation.md`. Every entity is `trust: "proposed"`.
