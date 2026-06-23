# Fixtures

The Discovery Recorder's scripts, tests, and report run against **committed, synthetic** fixtures
only. The default (and the Phase 0 stand-in) is:

```
discovery_corpus/fixtures/synthetic_factory_export.json
```

(`scripts/interrogate_ignition_export.py` resolves it as its default PATH; `run_phase0.py` runs the
whole Phase 0 gate against it.)

That file is a hand-authored Ignition/Sepasoft tag-export tree that mirrors the **structural shape**
of the real Cappy Hour export — UDT equipment assets (`Models/Equipment/Process/*`) with `MesTagPath`
bindings, nested UDT signal groups, the MES-OEE fields (`ProductionRun.Running`, `Blocked.Value.Value`,
`Starved.Value.Value`, `Counts.Outfeed/Defect.Value.Value`, `State.Name`,
`State.Duration.TotalSeconds.Value`) wrapped in static metadata (`NumberFormat`, `UnitsOfMeasure`,
`Definition.TypeId`), and a continuous-process tank (`Level %`, `Flow L/min`, `Temperature °C`,
`Pressure bar`, `Density kg/L`). It exercises **every archetype branch and both asset families** with
**fully fictional names and no real values**.

> A second, thinner synthetic tree also exists at
> `mira-plc-parser/tests/fixtures/ignition_cappy_hour_mini.json` (the parser's own unit-test fixture).
> The Discovery Recorder owns and defaults to `synthetic_factory_export.json` because it is curated to
> exercise the full archetype taxonomy + the C1–C5 claim checks.

## RULE: never copy the licensed corpus here (Evidence class 1)

The licensed Cappy Hour corpus (the full `tags.json` / `Enterprise B` export) is **never committed**
to this repo — not here, not anywhere (northstar operating principle #6; `../EVIDENCE_TYPES.md`).

If you have the real corpus on a local machine, point the interrogator at it explicitly:

```bash
python discovery_corpus/scripts/interrogate_ignition_export.py /path/to/real/tags.json --json
```

…but do **not** copy that file into this directory, and do **not** paste raw tag values from it into
any session record. Session records capture *structure and counts only* (Evidence class 2).
