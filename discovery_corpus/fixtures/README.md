# Fixtures

The Discovery Recorder's scripts and tests run against **one committed, synthetic mini fixture**:

```
mira-plc-parser/tests/fixtures/ignition_cappy_hour_mini.json
```

(referenced from this directory as `../../mira-plc-parser/tests/fixtures/ignition_cappy_hour_mini.json`;
`scripts/interrogate_ignition_export.py` resolves it as its default PATH.)

That file is a small, hand-authored tree shaped like the real Cappy Hour Ignition tag export —
1 enterprise / 1 site, a couple of areas, a few lines, a handful of assets (CapLoader, Filler,
Labeler), and representative signals (a `ProductionRun.Running` bool, unit-bearing counts, a CESMII
`MachineIdentification` nameplate). It is enough to exercise the parser and every archetype branch
without containing any licensed data.

## RULE: never copy the licensed corpus here

The licensed Cappy Hour corpus (the full `tags.json` / `Enterprise B` export) is **never committed**
to this repo — not here, not anywhere. The ProveIt northstar plan makes this non-negotiable
(operating principle #6): *"Licensed Cappy corpus is **never committed** — code + tests run on the
synthetic mini fixture."*

If you have the real corpus on a local machine, point the interrogator at it explicitly:

```bash
python discovery_corpus/scripts/interrogate_ignition_export.py /path/to/real/tags.json --json
```

…but do **not** copy that file into this directory, and do **not** paste raw tag values from it into
any session record. Session records capture *structure and counts only*.
