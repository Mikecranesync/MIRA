# Phase 2 proof — extraction depth across real PLC programs + i3X mapping

This is the evidence for Phase 2: the parser run against **real** PLC programs (not just the test
fixtures), how deep it extracts, and how the output projects onto the **i3X** interoperability
schema. All read-only, offline, stdlib-only. Reproduce with the corpus harness (a throwaway script
that points `mira_plc_parser.run()` at the files below).

## Corpus + extraction depth

Columns: tags · rungs · outputs · fault · asset · vfd-signal · review candidates.

| Program (type) | fmt | tags | rungs | out | fault | asset | vfd | review |
|---|---|--:|--:|--:|--:|--:|--:|--:|
| **REAL** `plc/Micro820_v4.1.9_Program.st` (CCW, no VAR block) | structured_text | 67 | 192 | 67 | 20 | 4 | 10 | 3 |
| **REAL** `plc/Prog_init_ConvSimple_v2.1.st` (CCW, no VAR block) | structured_text | 30 | 49 | 30 | 4 | 2 | 6 | 0 |
| **REAL** `plc/vars_ConvSimple_v1.9.csv` (CCW Controller-Variables export) | csv_tags | 9 | – | – | 2 | 1 | 1 | 0 |
| **REAL** `plc/.../MbSrvConf_import.csv` (CCW Modbus I/O map) | csv_tags | 22 | – | – | 0 | 0 | 1 | 0 |
| **REAL** `plc/.../LogicalValues.csv` (full CCW variable dump, 68 KB) | csv_tags | 1251 | – | – | 292 | 1 | 290 | 2 |
| FIXTURE `conveyor.L5X` (Rockwell) | rockwell_l5x | 11 | 3 | 3 | 4 | 3 | 3 | 1 |
| FIXTURE `conveyor.st` (ST with VAR) | structured_text | 12 | 3 | 2 | 4 | 3 | 4 | 1 |
| FIXTURE `conveyor.plcopen.xml` (PLCopen tc6) | plcopen_xml | 10 | 2 | 2 | 4 | 3 | 4 | 1 |
| FIXTURE `gs10_tags.csv` (Kepware) | csv_tags | 7 | – | – | 2 | 2 | 5 | 1 |

All four Phase-2 formats parse real or representative inputs. The Rockwell L5X and CSV parsers are
unchanged from Phase 1.

## How deep — and the real-world gap we closed

**ST logic extraction is deep.** The real Micro820 program yields **192 rungs / 67 outputs** — the
full e-stop supervision, the 5-state conveyor state machine, the 5-step Modbus poll cycle, the LED
logic, and the diagnostics — because every `LHS := expr;` assignment is lifted into a synthetic rung
(output = driven variable, expression tags = conditions). The output-dependency map then reads, e.g.,
*"`vfd_cmd_word` true when: `dir_fwd`, `dir_rev`, `e_stop_active`, …"* straight off the state machine.

**The CCW "no VAR block" gap (found by running real files, then closed).** Allen-Bradley CCW keeps
the variable table OUT of the `.st` export — it lives in CCW's Controller-Variables grid (a separate
CSV). A declared-VAR pass therefore finds **zero** tags, and since fault/asset/VFD/review candidates
are inferred from tags, the first run produced **0 candidates** on the real programs. The fix:
when the body assigns to symbols that were never declared, synthesize those assignment targets as
MEDIUM-confidence tags (the symbol is a real, literal fact; only its type/address is unknown, and a
warning says to supply the companion CCW variables CSV). Result on the real Micro820: **0 → 20 fault,
4 asset, 10 VFD-signal, 3 review** candidates.

Two vocabulary fixes fell out of the real names (and help any program, not just CCW):
- the name tokenizer now treats camelCase humps as word breaks (`fault` in `FaultRoutine`);
- `err` and the separated `e_stop`/`e-stop` spellings classify (real code is full of `vfd_comm_err`,
  `e_stop_active`), and full-word `frequency` / underscored `dc_bus` map to VFD roles.

**The real-world unit is ST + CSV.** Logic comes from the `.st`; the variable *types and Modbus
addresses* come from the CCW Controller-Variables / `MbSrvConf` CSVs (which parse to 9 and 22 tags
here, 1251 in the full dump). Neither alone is complete; together they cover the asset.

## i3X mapping (`render_i3x`, schema `mira-plc-parser/i3x@1`)

The report projects onto i3X Objects per `docs/specs/public-ingest-api-spec.md` §10. On the real
Micro820: **1 Asset · 4 Components · 67 Signals · 23 Events.**

| Parser concept | i3X object | Notes |
|---|---|---|
| controller / POU | `Object(type=Asset)` | ElementId = uuid5(namespace); namespace `plc.<controller>` |
| asset candidate | `Object(type=Component)` | `HasComponent` edge from the Asset |
| tag / signal | `Object(type=Signal)` | ISA-95 namespace path, empty **VQT** (`value/quality/timestamp`), `BelongsTo` Asset; VFD signals carry their drive role |
| fault / review finding | `Object(type=Event)` | `severity` band (review→high), `RelatesTo` Asset, with provenance evidence |

**How well it maps:** cleanly for the static structure — Objects, deterministic ElementIds,
hierarchical namespaces, relationships, and VFD/role attributes all populate. **Limits (honest):**
(1) VQT values are empty — the parser is static and samples nothing; the shape is live-binding-ready
but unfilled. (2) The namespace is a *proposal* rooted at `namespace_root` (default `plc`), not a
canonical enterprise/site/area UNS path — that assignment is engine-side (this subproject does not
build UNS paths). (3) The Asset name is whatever the POU declares (`Prog2` on the real file), so a
human/engine still maps it to the real equipment identity. (4) No WorkOrder objects — those come from
the CMMS, not a program export.

## Multi-source correlation — the conveyor knowledge graph

The PLC program is one source among several; no single file is complete. `correlate()` (CLI
`correlate <f1> <f2> ...`, schema `mira-plc-parser/asset-graph@1`) fuses several exports about ONE
asset into a single graph: it runs each through the pipeline, fuses Signals by variable name (type/
address/scope/role/description filled from whichever source has them, with per-field provenance and a
completeness flag), lifts the control logic into Signal→`DependsOn`→Signal edges (from the IR rungs),
and hangs Components + Fault Events off one Asset.

On the **real conveyor** — `Prog_init_ConvSimple_v2.1.st` (logic) + `vars_ConvSimple_v1.9.csv`
(types) + `MbSrvConf_ConvSimple_v1.9.csv` (Modbus addresses, generated from the authoritative CCW
`MbSrvConf_ConvSimple_v1.9.xml` server map) — via the frozen exe from a clean dir:

```
Asset: Conveyor (plc.conveyor)   Sources: 3 (3 parsed)
Nodes: 1 Asset · 2 Component · 42 Signal · 27 Register · 8 Event
Edges: 42 BelongsTo · 27 MappedTo · 21 DependsOn · 8 RelatesTo · 2 HasComponent
Fusion: 42 signals | 29 typed | 27 addressed | 16 typed-by-fusion
```

The full three-way fusion: 16 signals the CCW `.st` could only NAME (`vfd_torque`, `vfd_power`,
`vfd_motor_rpm`, `e_stop_active`, `motor_running`, …) got their type AND Modbus address from the two
CSVs — e.g. `e_stop_active` = `Bool` + coil `000006` + roles `fault,safety` (type/address from the
Modbus map, role from the ST logic); `vfd_cmd_word` = `Word` + HR `400115` + `output`. Every
addressed signal gets a `MappedTo` edge to a first-class `Register` node, and the control logic is
`DependsOn` structure (`motor_running` DependsOn `dir_fwd`/`dir_rev`/`vfd_run_permit`).

**The address layer (earlier `addressed = 0`) is now closed.** The CCW Modbus export uses
`Variable`/`Mapping Address` headers; teaching `tag_csv` those two aliases makes the real
`MbSrvConf_*.csv` exports parse with addresses (the existing `MbSrvConf_import.csv` now yields 21
addressed tags too). The 13 remaining `name_only` signals are intermediate ST variables not exposed
on the Modbus map (correct — they have no address). (`LogicalValues.csv` is a runtime *value* dump,
not a declaration table — excluded; its earlier "1251 tags" was a CSV-dialect false positive.)

## Verification

78 tests pass; ruff clean. `report@1` and `i3x@1` shapes are pinned by golden snapshots for all four
fixtures (`tests/fixtures/golden/`). The standalone exe builds and runs the real Micro820 program
end-to-end from a clean directory (no repo, no Python), emitting md + json + i3x reports.
