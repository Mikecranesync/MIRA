# Playbook — Classifying an unknown industrial dataset layer

**When to use:** a new industrial dataset arrives (a PLC export, a tag DB, an OEE/MES dump, a CMMS
extract, an alarm list) and you do not yet know *what layer it represents*. Knowing the layer
determines everything downstream — how to ground it, what MIRA can infer from it, and whether it
holds control logic, live process values, or aggregated production metrics.

This is the **general** procedure. The Ignition/Sepasoft MES case is the worked example in
`interrogating-ignition-mes-exports.md`; this playbook is the reusable decision tree for *any* layer.

## The industrial layer ladder (what you are classifying into)

| Layer | Holds | Tell-tale evidence |
|---|---|---|
| **Control logic** | Ladder/ST/FBD, routines, rungs, I/O addresses | `controllers`/routines present; `%IX/%QX`, `HR40001`, register maps; ladder XML (L5X, PLCopen) |
| **Tag / SCADA** | Live device tags, data types, scan classes | typed tags (Bool/Int/Float), device/driver bindings, alarms on tags |
| **MES / OEE** | ProductionRun, Counts, State, Blocked/Starved, OEE | UDT instances typed `Models/Equipment/*`, `MesTagPath`, count/state/availability fields |
| **CMMS / maintenance** | Work orders, assets, PMs, failure history | asset registry, WO ids, due dates, failure codes |
| **Documentation** | Manuals, schematics, nameplates | PDF/image; part numbers, wiring refs, procedures |

## Procedure (code first, LLM second)

> **Step 0 — Classify the evidence type before anything else** (`EVIDENCE_TYPES.md`). Is this raw
> licensed data (never commit; inspect locally) or already-derived? Build a synthetic stand-in for
> whatever you will commit.

1. **Parse, don't read.** Get it into a deterministic IR (a parser, `json`/`csv`, an XML reader).
   If no parser exists, the first deliverable is the smallest one that yields a node/record list.
2. **Check for control logic FIRST.** Are there controllers, routines, rungs, I/O addresses? If yes
   → **control layer**, stop. If the IR's `controllers`/logic containers are empty, it is *not*
   control logic — record that as a falsifiable claim (e.g. `controllers==0 and routines==0`).
3. **Check for MES/OEE markers.** UDT instances typed `Models/Equipment/*`, MES bindings
   (`MesTagPath`), and OEE field names (`ProductionRun`, `Counts`, `State`, `Blocked`, `Starved`,
   availability/performance/quality) → **MES/OEE layer**.
4. **Check the value/metadata ratio.** Do not assume every node is a live value. Classify each leaf
   (live vs. static metadata such as `NumberFormat`, `UnitsOfMeasure`, `TypeId`, `Min/Max/Range`).
   A high metadata ratio is the signature of a UDT/template model — the live surface is small.
5. **Use units to separate analog from discrete.** Engineering units (`L/min`, `bar`, `°C`, `%`)
   mark continuous-process analogs; their presence on an asset ⇒ a process asset, their absence with
   counts/states ⇒ a discrete/MES asset. Units are *necessary but not sufficient* — many live values
   (bools, counters, states) carry no unit, so name-pattern rules are also required.
6. **Extract hierarchy by node kind, not depth.** The asset boundary is usually a typed
   instance/equipment node, not a fixed folder depth; containers above it are site/area/line.

## Anti-patterns (each cost us time once)

- ❌ **Trusting a type field.** A `data_type`/`dataType` column can be entirely empty — classify by
  **name + unit** instead (Cappy: all 4090 `data_type` empty).
- ❌ **"N nodes = N live tags."** A UDT/MES model is mostly metadata (~92% for Cappy). Count the
  *classified live* signals, not raw nodes.
- ❌ **Asset = folder depth.** Detect the equipment/instance node kind; depth lies once UDTs nest.
- ❌ **Letting the LLM guess the layer.** Establish it by code (steps 2–4) and make each conclusion a
  reproducible claim; the model reasons *after* the layer is proven.

## Output

A recorded `sessions/` entry (with **failed hypotheses**), a deterministic `scripts/` interrogator
that emits the layer verdict + structure, a synthetic `fixtures/` stand-in, `tests/` that reproduce
the layer claims, and a generated `reports/` artifact. Anything less leaves the discovery
un-reproducible.
