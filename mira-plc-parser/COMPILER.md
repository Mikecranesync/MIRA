# PLC Asset Compiler (offline)

Point it at a folder of messy customer PLC/SCADA exports; it produces a reviewed, vendor-neutral
**asset model** — deterministically, offline. No LLM, no cloud, no live PLC, no writes, no input
files mutated.

```
messy exports → discovery → deterministic parsers → normalized signals/registers/logic
            → fusion by signal name → provenance + confidence → asset graph → human-review report
            → (later) live VQT attachment
```

## What it does

```bash
# from mira-plc-parser/ (installed: `plc-asset-compiler compile ...`)
python -m mira_plc_parser compile ./path/to/export_folder --out ./out
```

Writes into `--out`:

| File | What |
|---|---|
| `asset_graph.json` | the full graph: nodes (Asset/Component/Signal/Register/Event) + edges (`HAS_SIGNAL`/`MAPPED_TO`/`DEPENDS_ON`/`HAS_COMPONENT`/`RELATES_TO`) + fusion + discovery |
| `signals.csv` | one row per fused signal: name, status, data_type (+confidence), address (+confidence), scope, categories, roles, review, and **which file each field came from** |
| `registers.csv` | one row per Modbus register and the signals mapped to it |
| `edges.csv` | the graph edges, resolved to readable `from_name` / `to_name` |
| `compiler_report.md` | the human-review report: sources, fusion summary, **signals needing review**, conflicts, ignored/closed files |

Exit code: `0` if at least one file compiled, `1` if the folder held nothing parseable.

## How it fits MIRA / FactoryLM

This is the **offline onboarding** half of *train-before-deploy*. The Command Center builds and
validates an asset's intelligence before any HMI deployment; the compiler turns a customer's
existing program/tag/Modbus exports into the first draft of that asset model — signals, types,
addresses, control dependencies, and a list of safety/fault/control signals a human must review.
It emits in the same i3X-flavored vocabulary (Asset / Signal / Register / namespace) the rest of the
platform speaks, so the graph is a feed into the namespace builder, not a dead end. It stays
**read-only troubleshooting intelligence**: it never writes to a PLC and never proposes control.

## How it differs from live Ignition / PLC VQT reading

The compiler describes **what the program *is*** — statically, from files. It does **not** read live
values: every signal's VQT (Value / Quality / Timestamp) is empty by construction. Live value
reading is a separate, later layer and lives elsewhere in the repo:

- `mira-connect/mira_connect/drivers/modbus_driver.py` — async Modbus TCP client returning
  `TagValue(value, quality, timestamp)`.
- `mira-relay/tag_ingest.py` — production tag ingest → `live_signal_cache` (latest value + quality +
  freshness), the canonical live layer.

The compiler's graph is shaped to *receive* those values: a `Register` node + `MAPPED_TO` edge is
exactly the binding point where a live Modbus read attaches to a static signal. **Compile offline
first, attach VQT live later.**

## Supported inputs

| Input | Parser | Notes |
|---|---|---|
| Structured Text (`.st`, `.scl`, IEC 61131-3) | `parsers/structured_text` | Extracts VAR declarations; for CCW exports with **no VAR block**, synthesizes signals from assignment targets. FB-call named args (`mb_read(IN := x)`) are **not** minted as signals (only top-level `:=`). |
| Rockwell L5X | `parsers/rockwell_l5x` | Tags, programs, routines, rung logic. |
| PLCopen XML (tc6) | `parsers/plcopen_xml` | Interface vars + ST body. |
| Controller-Variables CSV | `parsers/csv_tags` | Flexible headers (Rockwell / Siemens / Kepware / generic / CCW `Variable`). Supplies **types**. |
| Modbus map CSV (CCW MbSrvConf) | `parsers/csv_tags` | `Variable` / `Mapping Address` dialect. Supplies **addresses**. |
| Runtime value dumps | — | **Detected and ignored** (e.g. `[Version1]` / `Name,Value` snapshots) so they aren't mis-counted as tags. |
| Closed vendor projects (`.ACD`, TIA `.ap*`, `.project`) | — | Rejected with precise export instructions; not parsed. |

## Confidence and provenance

Every signal field is labelled and auditable:

- **exact** — read directly from a declaration (a CSV type, a Modbus address).
- **inferred** — derived from logic/name (e.g. a role from how a tag is used).
- **name_only** — referenced/assigned but never declared (a bare name; type/address unknown).
- **missing** — no source provided it.
- **conflict** — sources disagree on a non-empty value. The value is **flagged, not silently
  overwritten**; `signals.csv` and the report show every conflicting value and its source.

`signals.csv` carries `name_from` / `type_from` / `address_from` so any field traces to its file(s).
Fusion joins sources **by signal name** (original names preserved), first non-empty wins per field,
roles union. Safety / fault / control signals are flagged `review = yes`.

## What remains for future work

- **Modbus register semantics:** a second `MAPPED_TO` hop to the *drive's* internal registers (e.g.
  GS10 RTU `0x2103`), distinct from the PLC's Modbus-TCP server map.
- **Siemens TIA Openness XML** parser (recognized + rejected today; no fixture yet).
- **ST type inference** from usage when neither a VAR block nor a variables CSV is present.
- **Multi-asset folders:** DONE — a folder is partitioned into assets by subfolder (each subdir =
  one asset; signals are asset-scoped so two machines' `motor_run` never collide; CSVs carry an
  `asset` column). Remaining refinement: splitting *multiple controllers inside one flat folder*
  (today a flat folder fuses to one asset).
- **Live VQT attachment:** the OFFLINE slice is DONE — `attach <asset_graph.json> <snapshot>` binds a
  values snapshot (address→value) onto the graph's `MAPPED_TO` signals, writing `asset_graph.live.json`
  with per-signal VQT + quality + freshness (see `VQT_ATTACH_SPEC.md`). Remaining (issue #2102): a
  real `live_logger`-CSV adapter (friendly-name + scale/offset), live Modbus polling via
  `mira-connect`, engineering-unit scaling, and pushing live VQT to `mira-relay`'s `live_signal_cache`.
- **Ground-truth eval corpus:** labeled tag sets per program to measure extraction accuracy.
