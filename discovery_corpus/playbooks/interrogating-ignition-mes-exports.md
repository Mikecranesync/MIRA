# Playbook — Interrogating an Ignition / Sepasoft MES-OEE tag export

**Class of data:** an Ignition tag export (`tags.json`) where the tag tree is a Sepasoft / Ignition
**MES-OEE UDT model** — i.e. the nodes are mostly *metadata*, not live tags.

**Goal:** establish, by deterministic code, what the export *is* — its ISA-95 topology, how many of
its nodes are actually live values vs. UDT scaffolding, and which assets are discrete-MES vs.
continuous-process — **before** any LLM reasons over it.

**Tool:** `discovery_corpus/scripts/interrogate_ignition_export.py` (read-only, stdlib-only + the
in-repo `mira_plc_parser` Ignition parser).

---

## Step 0 — Recognise the trap

An MES-OEE export *looks* like thousands of live tags. It is not. A single Filler asset's ~74 nodes
are roughly **8 live values** wrapped in static UDT metadata (NumberFormat, UnitsOfMeasure,
TypeId/TypeName, Min/Max/Span/Tolerance, Definition.\*, Material.Item.\*, …). If you let a model
count nodes, it will hallucinate "thousands of sensors." Code first.

## Step 1 — Parse into the IR

Feed the export through `mira_plc_parser.parsers.ignition_json.parse()` (the interrogator's `load()`
does this). The parser maps the `Folder` / `UdtInstance` / `AtomicTag` tree onto an explicit ISA-95
`NamespaceNode` hierarchy: folder depth → enterprise/site/area/line; the **first `UdtInstance`** under
a folder chain is the **asset** boundary; everything below it is a **signal** whose name is the
dotted path from the asset (`ProductionRun.Running`, `Counts.Outfeed.Value.Value`).

## Step 2 — Count the topology

`interrogate()` returns `counts` (enterprise/site/area/line/asset/signal) and a `hierarchy`
(area → line → assets). This is the structural ground truth. For the real Cappy Hour corpus it is:
**1 enterprise / 1 site / 4 areas / 15 lines / 43 assets / 4090 signal nodes** — and that 4090 is
the trap: most of it is metadata, which Step 3 separates out.

## Step 3 — Classify every signal into an archetype

`classify_signal(name, unit)` puts each signal leaf into exactly one reusable archetype:

| Archetype | What it is | How to recognise it |
|---|---|---|
| `static_metadata` | UDT scaffolding, never a live value | leaf in {NumberFormat, UnitsOfMeasure, TypeId/TypeName, Min/Max/Span/Range/Tolerance, IdealCycleTime, …} or under a `Definition.*` / `Material.Item.*` subtree |
| `live_bool` | a running/blocked/starved flag | leaf `*.Running`, or `Blocked.Value.Value` / `Starved.Value.Value` |
| `live_counter` | a production counter | `Counts.*.Value.Value` (Infeed/Outfeed/Defect), or a `*.Value.Value` carrying unit `Units` |
| `live_state` | PackML/OEE state + dwell | `State.Name`, `State.FromName`, `State.Duration.*Seconds*` |
| `live_analog` | a process measurement | carries an engineering unit (%, s, m, mA, L/min, bar, °C, kg/L, mPa·s, …) |
| `unknown` | fallback — surface for review | nothing above matched |

The histogram tells you the live-vs-metadata ratio at a glance. A healthy MES export is dominated by
`static_metadata`, with a thin band of `live_*`.

## Step 4 — Decide each asset's family

`asset_family` labels each asset **continuous_process** if *any* of its signals carry a process unit
(L/min, bar, °C, kg/L, mPa·s, kg/m³, m³, kg, L, gal, ft) — these are tanks and vats — else
**discrete_mes** (counts + states: fillers, labelers, palletizers). This split drives how the
synthesizer later models each asset and what maintenance causes apply.

## Step 5 — Record the session

Write a `sessions/<date>-session-NNN-*.md` using the 9-field template. Capture *structure and counts*
from the real corpus as notes — **never raw tag values, never the licensed file**.

---

## Reusable findings (promote these into code, not chat)

- The asset boundary is the **first UdtInstance** under a folder chain; nested UdtInstances are just
  dotted-name grouping for signals. (Lives in `ignition_json.py`.)
- `data_type` is empty for every node in a Sepasoft MES export; the engineering `unit` (and the
  dotted leaf name) is the only reliable per-signal discriminator. (Drives `classify_signal`.)
- Two asset families fall straight out of units: process-unit-bearing → continuous_process; counts +
  states only → discrete_mes. (Drives `asset_family`.)

## Anti-patterns

- ❌ Counting raw nodes and calling them "tags" or "sensors." Most are metadata.
- ❌ Asking an LLM "how many machines are there?" before code has produced the topology.
- ❌ Committing or pasting the licensed corpus. Mini fixture only.
