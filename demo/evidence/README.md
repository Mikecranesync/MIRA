# Demo evidence — Conv_Simple conveyor bench

Supporting manuals / datasheets for the assets that **actually exist** in the downloaded demo we use:
the **Conv_Simple conveyor bench** (`plc/GS10_Integration_Guide.md` — *"GS10 DURApulse + Micro820
Complete Integration Guide"*).

This is **not** the Cappy Hour MES factory and **not** the synthetic `factory_context` fixture — it is
the physical/Factory-I/O conveyor cell driven by a GS10 VFD and a Micro820 PLC.

## The actual assets (from the bench files)

| Folder | Asset | Identity (as recorded in the repo) | Manual status |
|---|---|---|---|
| `vfd/` | Variable-frequency drive | **AutomationDirect DURApulse GS10** | ✅ official manual link (public) |
| `plc/` | Programmable controller | **Allen-Bradley Micro820 `2080-LC20-20QBB`** | ✅ official manual link (public) |
| `photoeye/` | Photoelectric sensor | **PE-101 on `DI_05`** (`di05_photoeye`) — exact model **not recorded** | ⚠ representative link + honest note |
| `motor/` | Conveyor motor | 3-phase induction gearmotor (4-pole, GS10-driven) — exact model **not recorded** | ⚠ honest note |
| `conveyor/` | Conveyor | Conv_Simple (Factory I/O visual layer + bench) | Factory I/O docs link |
| `wiring-or-io-map/` | Wiring / IO map | The bench's own Modbus-RTU map + GS10↔Micro820 comm map | repo files (authoritative) |

## What's in each folder

- a `.url` (or the link inside `notes.md`) for the official document where the model is known;
- a short `notes.md` saying what the document is and which asset it supports.

**Honesty note:** for the **photoeye** and **motor** the bench files name the *tag/role* (`PE-101`/`DI_05`,
"4-pole motor") but **not a manufacturer/catalog number**. Those `notes.md` say so plainly and link the
closest verifiable resource — no manufacturer/model is invented.

## Source of truth in the repo

- `plc/GS10_Integration_Guide.md` — VFD params, Modbus map, comm setup.
- `plc/MbSrvConf_ConvSimple_v2.1.xml` — the Modbus server / IO register map.
- `plc/conv_simple_anomaly/` — the anomaly rules referencing these assets (e.g. A12 photo-eye jam on `DI_05`).
