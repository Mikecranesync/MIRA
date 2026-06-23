# Session 001 — Cappy Hour Ignition export interrogation (layer + topology study)

**Date:** 2026-06-22
**Recorder:** Discovery Recorder (ProveIt 2027 northstar, Phase 0)
**Class of data:** Ignition / Sepasoft MES-OEE tag export

> Code-first interrogation per northstar operating principle #1. The licensed Cappy Hour corpus is
> **a derived-observation source only** — its structure/counts are recorded below as notes; no raw
> tag values and no licensed file are committed. All committed code/tests/report run on the
> **synthetic** stand-in `discovery_corpus/fixtures/synthetic_factory_export.json`.
> Evidence-type rules: `discovery_corpus/EVIDENCE_TYPES.md`.

---

## 1. Question being answered

What *layer* is the Cappy Hour Ignition tag export, and what is its structure? Is it low-level PLC
I/O/control logic, or an MES/OEE model? Are its ~4090 "nodes" live tags or UDT metadata? What are the
reusable signal archetypes, and which assets are discrete-MES vs. continuous-process — all
established by **deterministic code before any LLM reasons over it**.

## 2. Files inspected

- `mira-plc-parser/mira_plc_parser/parsers/ignition_json.py` — the Ignition tag-export parser
  (Folder/UdtInstance/AtomicTag → ISA-95 `NamespaceNode`; asset boundary = first `UdtInstance`).
- `mira-plc-parser/mira_plc_parser/ir.py` — the IR (`PLCProject.controllers` / `.namespace` /
  `.all_routines()`; `NamespaceNode.udt_type/mes_path/data_type/unit`).
- The licensed Cappy Hour export — inspected for *structure only*, never committed.
- `discovery_corpus/fixtures/synthetic_factory_export.json` — the committed synthetic stand-in.

## 3. Commands executed

```bash
# parse + dump every namespace node with level/unit/data_type (real corpus, structure only)
python -c "import sys; from pathlib import Path; sys.path.insert(0, 'mira-plc-parser'); \
  from mira_plc_parser.parsers import ignition_json; \
  p = ignition_json.parse(Path(EXPORT).read_text(encoding='utf-8')); \
  [print(n.level, n.name, repr(n.unit), repr(n.data_type)) for n in p.namespace]"

# the reusable interrogator + the one-command Phase 0 gate (synthetic fixture only)
python discovery_corpus/scripts/interrogate_ignition_export.py            # human report + claims
python discovery_corpus/scripts/interrogate_ignition_export.py --json     # machine JSON
python discovery_corpus/run_phase0.py                                     # interrogate → report → pytest → exit code
```

## 4. Python workflows used

- `load(path)` → `ignition_json.parse()` → read-only `PLCProject` (ISA-95 `namespace` node list).
- `classify_signal(name, unit)` — deterministic archetype classifier (precedence: static-subtree →
  live_state → static-leaf → live_bool → live_counter → live_analog → unknown).
- `interrogate(project)` — topology counts + area→line→asset hierarchy + archetype histogram +
  per-asset discrete/continuous family verdict.
- `assess_claims(project, report)` — the five falsifiable claim verdicts (C1–C5), each computed from
  the IR, not prose.

## 5. Hypotheses tested — including the ones that FAILED

Failed hypotheses are the methodology. Each was tested by code; the evidence that eliminated it is
what made the conclusion trustworthy.

| # | Hypothesis | How tested | Evidence | Verdict |
|---|---|---|---|---|
| **H1** | "This is a low-level PLC I/O / control export (ladder/ST, registers/bits)." | Inspect `PLCProject.controllers` + `all_routines()`; check signal `data_type`; scan leaf names for I/O markers vs MES UDT markers. | `controllers == []`, `all_routines() == []` (no logic at all); assets carry `udt_type=Models/Equipment/Process/*` and `mes_path=[MES]...`; leaf names are `ProductionRun/Counts/State/Blocked/Starved` (OEE), **not** `%IX/%QX/HR40001`. | **ELIMINATED** → it's the MES/OEE layer, not control. (Now claims **C1**, **C4**.) |
| **H2** | "`data_type` will tell me each signal's type (Bool/Int/Float)." | Read `node.data_type` across all signals. | **Empty for all 4090** nodes (the real export's AtomicTags omit `dataType`). | **ELIMINATED** → `data_type` is not a usable discriminator; classify by **dotted name + engUnit** instead. (Drove the classifier design.) |
| **H3** | "All 4090 nodes are live tags / sensors." | Archetype histogram + per-asset live-vs-metadata ratio. | Majority classify `static_metadata` (NumberFormat/UnitsOfMeasure/String/TypeId/Definition.*/Material.Item.*/Min/Max/Span/Range); a Filler is **~8 live of 74**. | **ELIMINATED** → "4090 sensors" is a trap (~92% metadata); the live surface is a few hundred values. |
| **H4** | "Engineering units identify all the live signals." | Count signals carrying `engUnit`. | Only **314/4090** carry a unit; many live values are unit-less bools/counters/states (`Running`, `Blocked`, `State.Name`). | **REFINED (not eliminated)** → units are necessary for analogs but insufficient; name-pattern rules are required for bool/counter/state. |
| **H5** | "Folder depth alone gives the asset boundary." | Inspect the parser's asset-detection rule. | The asset boundary is the **first `UdtInstance`** (typed `Models/Equipment/*`), not a fixed folder depth; nested `UdtInstance`s below it become signal-name prefixes (`Counts.Outfeed.Value.Value`). | **REFINED** → asset detection is UDT-kind-based; hierarchy extraction must follow node kind, not depth. |

## 6. Evidence that eliminated the failed hypotheses (now executable)

Every elimination above is re-run on the synthetic fixture by the claim checks in
`assess_claims()` and the tests:

- H1/control-logic absence → **C4** (`controllers==0, routines==0`).
- H1/MES-shape → **C1** (`assets_with_mes_markers>=1`, `has_production_run`, `has_control_logic=False`).
- H2/empty-types → recorded as C1 evidence `all_signal_data_types_empty=True`.
- H3/metadata-trap → archetype histogram (`static_metadata>0`, no `unknown`).
- H3/H4 live surface → **C2** (`live_counter>0`, `live_state>0`) and `signals_with_units`.

## 7. Results observed

**Real corpus (structure/counts only — NOT committed):** 1 enterprise (`Cappy Hour Inc`) / 1 site /
**4 areas / 15 lines / 43 assets / 4090 nodes**. Areas: Filler Production (3 lines: CapLoader+Washer+
Filler), Liquid Processing (TankStorage01: Tank01–06; MixRoom01: Vat01–04), Packaging (LabelerLine01–04:
Labeler+Sealer+Packager), Palletizing (Palletizer01/02: Robot+Pallet01+Pallet02+Wrapper;
PalletizerManual01–04: Workstation). `data_type` empty on all; 314 carry a unit; Sepasoft MES-OEE UDT
model. Two families: discrete-MES (Filler/Packaging/Palletizing) and continuous-process (Tanks/Vats:
L/min, bar, °C, kg/L, mPa·s, %).

**Synthetic fixture (committed — what code/tests/report actually run on):** interrogator prints
**1 enterprise / 1 site / 2 area / 2 line / 2 asset / 16 signal** (8 unit-bearing); archetypes
`static_metadata=4, live_bool=3, live_counter=2, live_state=2, live_analog=5, unknown=0`; families
`Filler01=discrete_mes`, `Tank01=continuous_process`; **all five claims C1–C5 PASS**.

## 8. Conclusions reached

- The export is a **two-family MES-OEE model**, not PLC control logic.
- "4090 tags" is a trap — ~92% is UDT metadata; the live surface per asset is ~8 values; reason over
  the **classified live signals**, not raw node counts.
- Classify by **name + unit** (not `data_type`); family falls out of process-unit presence.
- The **blocked/starved/counts/state** fields are the *symptom layer* — the upstream evidence onto
  which Phase 2/3 infer hidden component causes (sensor/conveyor/VFD/motor/air/comms/interlock).

## 9. Reusable logic discovered

Promoted into `scripts/interrogate_ignition_export.py` (with tests) so it is never re-derived:
`classify_signal(name, unit)` (archetype taxonomy), `interrogate(project)` (topology+hierarchy+family),
and **`assess_claims(project, report)`** (the five reproducible claim verdicts). Methodology distilled
into `playbooks/interrogating-ignition-mes-exports.md` and the general
`playbooks/classifying-an-unknown-dataset-layer.md`.

## 10. Tests added

`tests/test_interrogate_ignition.py` — pytest, **18 tests, green**: report consistency, full-taxonomy
coverage with **zero unknowns** on the synthetic fixture, the canonical `classify_signal` patterns,
the discrete-vs-continuous family split, and the **five claim verdicts C1–C5** (plus a determinism
check that the report + claims are byte-stable across runs).

## 11. Fixtures added

`discovery_corpus/fixtures/synthetic_factory_export.json` — a new synthetic Ignition/Sepasoft export
that mirrors the **structural shape** of the licensed Cappy evidence (UDT equipment assets, nested
UDT signal groups, ProductionRun/Blocked/Starved/Counts/State MES fields, a continuous-process tank)
with **fully fictional names and no values**. The licensed corpus is **not** committed (operating
principle #6; `EVIDENCE_TYPES.md`).
