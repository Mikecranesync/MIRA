# MIRA — The Signal Difference Engine with a Contextual Supervisor

**Status:** product positioning (2026-06-30). **Sharpens, does not replace,** the
canonical wedge in `NORTH_STAR.md` (FactoryLM = maintenance-context layer; MIRA =
grounded agent). This doc names the *engine underneath* that wedge.

---

## One-line pitch

> **MIRA helps machines tell maintenance what changed, what is abnormal, and what is likely to need attention next.**

## Final product sentence

> Litmus, Ignition, OPC UA, MQTT, and PLC exports get the machine data. **MIRA finds what changed, groups the differences into machine events, and explains what those events mean for maintenance.**

---

## Why this framing

We proved on the bench (2026-06-30) that raw PLC connectivity is a **commodity**:
Litmus Edge read the Micro820 by name and over Modbus TCP in minutes; so can
Ignition, OPC UA, and MQTT. Connectivity is not the moat. The moat is what you do
*after* the data arrives: notice what changed, compress the noise into events, and
explain it in maintenance terms with evidence.

So MIRA is **not** competing with Litmus/Ignition — it **rides on top of them**.

## What MIRA is

A **maintenance intelligence layer for connected machines**, built as two things
stacked:

1. **A signal difference engine (low level).** It watches raw tag values as
   *signals*. It does **not** need to fully understand the human meaning of every
   tag first. It detects: value out of learned-normal range, drift, stuck values,
   broken/late boolean transitions, out-of-order sequences, cycle-time drift,
   changed analog ramps, broken correlations, rising nuisance events, and patterns
   never seen before. It outputs **factual observations**, not explanations:
   > "Signal C normally stays between 318 and 325 during startup. Today it dropped to 287."
   > "Signal A normally changes 0.4 s after Signal B. Today it changed 3.2 s later."

2. **A contextual supervisor (high level).** It maps observations/events to real
   machine context — tag names, PLC logic, approved tag map, asset hierarchy,
   manuals, wiring diagrams, nameplate/photos, prior evidence — and explains them
   for the operator, with citations:
   > "The conveyor startup behavior changed. The drive is alive, but startup is
   > abnormal: the DC bus sagged more than normal, output frequency ramped slower,
   > and motor-running feedback was delayed. Likely targets: belt drag, mechanical
   > load, motor/gearbox, drive current limit, or incoming power."

## What MIRA is not

- ❌ A chatbot for factories. (The chat surface is the *last* layer, not the product.)
- ❌ A Litmus/Ignition/SCADA/historian replacement. **They are integration sources.**
- ❌ A raw-connectivity play. Connectivity is commodity; **difference + context** is the value.
- ❌ A system that "thinks like a human technician" from the first byte. It thinks
  like a **difference engine first**, then borrows human context. That ordering is
  the point — it can flag an abnormal signal before anyone has mapped what it means.
- ❌ A control system. **Read-only. Zero PLC writes.** Ever. (`.claude/rules/fieldbus-readonly.md`)

## The layered architecture (see the PRD for detail)

| Layer | Job | Status in repo |
|---|---|---|
| 1. Signal ingestion | Store raw signal values (source, path, type, value, ts, quality, unit) | ✅ **exists** — `mira-relay` → `tag_events` / `live_signal_cache` / `approved_tags` |
| 2. Difference engine | Detect what changed vs normal → factual observations | ⚠️ **partial** — threshold rules (A0–A12) exist; **learned-baseline/drift is the new build** |
| 3. Event grouping | Compress many observations → few machine events (anti-spam) | ✅ **exists** — `mira-relay/tag_diff_logger.py` (edges/thresholds/fault-windows) + timing/baseline seed |
| 4. Context resolver | Map events → machine/component/asset via names, KG, manuals | ✅ **exists** — `uns_resolver`, `approved_tags` UNS map, `knowledge_entries`, `component_templates` |
| 5. Supervisor / explanation | Operator-facing "what changed, how bad, what to check, evidence" | ✅ **exists** — `mira-bots/shared/engine.py`, Ask MIRA, `citation_compliance` |

**The honest headline: ~70% of this already exists.** The reposition names the
through-line and fills two real gaps (learned-baseline detectors, continuous
trending) — it does not rebuild the stack.

## Relationship to Litmus / Ignition / OPC UA / MQTT

Read-only integration sources, all equal citizens:
- **Litmus Edge** — proven on the bench (`plc/litmus/`). Reads the Micro820, MIRA sits on top.
- **Ignition** — the Maintenance Intelligence Module (`docs/RESUME_2026-06-14_...`) already runs the detectors in-gateway.
- **OPC UA / MQTT (Sparkplug) / PLC exports / historian / CSV** — adapters into the one canonical ingest path (`mira-relay`, per `.claude/rules/one-pipeline-ingest.md`).

MIRA never forks a second ingest core per source. One pipeline, many adapters.

## Business offering

FactoryLM/MIRA is a **maintenance intelligence layer for connected machines**:

- Trending engine
- Difference engine
- Anomaly / event detection
- Contextual supervisor
- Visual machine-health view
- Ask MIRA explanation layer
- **Machine Context Pack** (the per-machine approved map + baselines + manuals + fault lexicon that makes the above trustworthy)
- Read-only integration with Litmus / Ignition / OPC UA / MQTT / PLC exports

### Land offer: Machine Context Audit → Machine Context Pack

- **Machine Context Audit** — we point MIRA at one connected line (via the customer's
  existing Litmus/Ignition/OPC UA), learn its normal, and deliver a report of what's
  drifting and what's un-mapped.
- **Machine Context Pack** — the durable asset: approved tag→context map, learned
  baselines, fault lexicon, manuals/wiring/photos bound to the asset. This is the
  reusable, sellable artifact and the thing competitors' raw connectivity can't produce.

## First MVP — Micro820 conveyor / ProveIt bottling sim

Demonstrates, end to end:
1. Ingest live tag values from Litmus (or the existing bridge / SimLab stream).
2. Store time-series history.
3. Learn or define a normal baseline.
4. Detect simple differences (out-of-baseline, stuck, delayed transition).
5. Group differences into machine events.
6. Show trend evidence.
7. Let a user ask *"What changed?"* / *"Why is this machine in warning?"*
8. Answer from differences **plus** approved context, with citations.

## Trade-show demo story

"Every vendor here can *connect* to this conveyor. Watch." → connect via Litmus in
60 seconds. "Connection is commodity. Here's what's different." → trip a fault (or
replay a SimLab scenario); MIRA shows *one* machine event, not a wall of alarms,
with the trend that caused it, and answers *"what changed?"* in maintenance language
with a citation to the customer's own manual. "Litmus got the data. **MIRA told you
what it means.**"

## Careful-language guardrails (do not overclaim)

MIRA **surfaces early-warning patterns**, **identifies maintenance targets**,
**detects differences from normal**, **explains likely causes**, and **supports
predictive maintenance**. It does **not** "predict all failures" or provide
production predictive-maintenance certainty. It never invents a spec, never
silently truncates a manual, and says when it isn't sure. Read-only, always.

## Cross-references

- `NORTH_STAR.md` — the canonical wedge this sharpens
- `docs/product/mira_signal_difference_engine_prd.md` — the technical PRD
- `docs/plans/2026-06-30-mira-difference-engine-backlog.md` — phased backlog
- `docs/RESUME_2026-06-14_maintenance-intelligence-module.md` — "detect AND explain" (already shipping this)
- `plc/litmus/README.md` — the "MIRA on top of Litmus" bench proof
- `.claude/rules/one-pipeline-ingest.md`, `.claude/rules/fieldbus-readonly.md` — the ingest + read-only laws
