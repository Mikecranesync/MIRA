# Session 001 — Cappy Hour Ignition export interrogation (topology study)

**Date:** 2026-06-22
**Recorder:** Discovery Recorder (ProveIt 2027 northstar, Phase 0)
**Class of data:** Ignition / Sepasoft MES-OEE tag export

> Code-first interrogation per northstar operating principle #1. The licensed Cappy Hour corpus is
> NOT committed; the structural notes below are counts/shape only — no raw tag values, no licensed
> file.

---

## 1. Question being answered

What *is* the Cappy Hour Ignition tag export? Specifically: its ISA-95 topology, whether its 4090
"nodes" are live tags or UDT metadata, what the reusable signal archetypes are, and which assets are
discrete-MES vs. continuous-process — established by deterministic code before any LLM reasons over
it.

## 2. Files inspected

- `mira-plc-parser/mira_plc_parser/parsers/ignition_json.py` — the Ignition tag-export parser (maps
  Folder/UdtInstance/AtomicTag → ISA-95 NamespaceNode hierarchy).
- `mira-plc-parser/mira_plc_parser/ir.py` — the IR (`PLCProject`, `NamespaceNode`, `NamespaceLevel`).
- `mira-plc-parser/tests/fixtures/ignition_cappy_hour_mini.json` — the committed synthetic mini
  fixture (shaped like the real export; the only data file used by code/tests).
- The licensed Cappy Hour export — inspected for *structure only*, never committed.

## 3. Commands executed

```bash
# parse the mini fixture and list every namespace node + its level/unit/data_type
python -c "import sys; from pathlib import Path; sys.path.insert(0, str(Path('mira-plc-parser').resolve())); \
  from mira_plc_parser.parsers import ignition_json; \
  p = ignition_json.parse(Path('mira-plc-parser/tests/fixtures/ignition_cappy_hour_mini.json').read_text()); \
  [print(n.level, n.name, repr(n.unit)) for n in p.namespace]"

# the reusable interrogator (human report + machine JSON)
python discovery_corpus/scripts/interrogate_ignition_export.py
python discovery_corpus/scripts/interrogate_ignition_export.py --json

# the test suite
python -m pytest discovery_corpus/tests/ -q
```

## 4. Python workflows used

- `load(path)` → `mira_plc_parser.parsers.ignition_json.parse()` → a read-only `PLCProject` whose
  `namespace` is the ISA-95 node list.
- `classify_signal(name, unit)` — deterministic archetype classifier (precedence: static-subtree →
  live_state → static-leaf → live_bool → live_counter → live_analog → unknown).
- `interrogate(project)` — composes topology counts, area→line→asset hierarchy, archetype histogram,
  signals-with-units count, and per-asset discrete/continuous family verdict.

## 5. Results observed

**Real corpus (structure/counts only — NOT committed):**

- Topology: **1 enterprise (`Cappy Hour Inc`) / 1 site (`Site 1`) / 4 areas / 15 lines / 43 assets /
  4090 signal nodes.**
- Areas → lines → assets:
  - **Filler Production** — 3 lines (FillingLine01/02/03); each line = CapLoader (45 sig) + Washer
    (45) + Filler (74).
  - **Liquid Processing** — TankStorage01 (Tank01–06 @210 sig each) + MixRoom01 (Vat01–04 @199 each).
  - **Packaging** — LabelerLine01–04; each = Labeler (66) + Sealer (66) + Packager (66).
  - **Palletizing** — Palletizer01/02 (Robot + Pallet01 + Pallet02 + Wrapper @243) +
    PalletizerManual01–04 (Workstation @66 each).
- Signal reality: `data_type` is **empty for all 4090 nodes**; only **314** carry an engineering
  `unit`. The nodes are a Sepasoft/Ignition MES-OEE UDT model, **not** 4090 live tags — a Filler's
  74 nodes are ~8 live values wrapped in UDT metadata.
- Example Filler live signals: `ProductionRun.Running`, `Blocked.Value.Value`, `Starved.Value.Value`,
  `Counts.Infeed/Outfeed/Defect.Value.Value` (unit `Units`), `State.Name`,
  `State.Duration.TotalSeconds.Value` (unit `s`). Static metadata leaves: `NumberFormat`,
  `UnitsOfMeasure`, `String`, `StringValueHigh/Low`, `TypeId`, `TypeName`, `Definition.*`,
  `Material.Item.*`, `Min/Max/Span/Range/Tolerance/IdealCycleTime`, `LogId`, `LogTrigger`.

**Mini fixture (committed, what code/tests actually run on):**

- Topology printed by the interrogator: **1 enterprise / 1 site / 2 area / 2 line / 3 asset /
  9 signal**; 3 signals carry a unit.
- Hierarchy: Filler Production → FillingLine03 → {CapLoader, Filler}; Packaging → LabelerLine01 →
  {Labeler}. All three assets resolve to `discrete_mes` (no process units present in the mini tree).

## 6. Conclusions reached

- The export is a **two-family MES-OEE model**: **discrete-MES** assets (Filler/Packaging/Palletizing
  — counts + PackML states) and **continuous-process** assets (Tanks/Vats — units L/min, bar, °C,
  kg/L, mPa·s, %).
- The "4090 tags" figure is a **trap**: ~92% is UDT metadata. The live surface per asset is ~8
  values. Any downstream reasoning must operate on the *classified live signals*, not raw node
  counts.
- Family membership falls straight out of engineering units (process unit ⇒ continuous_process),
  which is exactly what the synthesizer (Phase 2) and the maintenance-cause layer (Phase 3) need.

## 7. Reusable logic discovered

Promoted into `scripts/interrogate_ignition_export.py` (with tests), so this is never re-derived:

- **Signal archetype taxonomy** — `classify_signal(name, unit)` → one of
  `static_metadata / live_bool / live_counter / live_state / live_analog / unknown`.
- **Topology + hierarchy extraction** — `interrogate(project)` streams the depth-first namespace
  list into counts + area→line→asset hierarchy.
- **Asset-family verdict** — process-unit presence ⇒ `continuous_process`, else `discrete_mes`.

Methodology distilled into `playbooks/interrogating-ignition-mes-exports.md`.

## 8. Tests added

`tests/test_interrogate_ignition.py` (pytest, 10 tests, green): report internal-consistency, every
signal classifies to a known archetype without crashing, the canonical taxonomy assertions
(`Counts.Outfeed.Value.Value`/`Units` → `live_counter`; `ProductionRun.Running` → `live_bool`;
`Counts.Outfeed.Value.NumberFormat` → `static_metadata`; `Level.Value.Value`/`%` → `live_analog`;
`State.Name` / `State.Duration.TotalSeconds.Value` → `live_state`), and the family logic. Assertions
are robust to fixture size (>0 / membership, not magic totals).

## 9. Fixtures added

None new. Code and tests run on the existing committed synthetic mini fixture
`mira-plc-parser/tests/fixtures/ignition_cappy_hour_mini.json`. The licensed corpus is **not**
committed (northstar operating principle #6); `discovery_corpus/fixtures/README.md` records the
"never copy the licensed corpus here" rule.
