# FactoryLM Contextualization Demonstration — plan

**Date:** 2026-06-24. **Status:** plan (no MQTT, no new transport). **Thesis we are proving:**
> *"Can FactoryLM take factory signals, contextualize them, and help someone understand what is
> happening?"*

The question is **no longer "can data get in?"** (the ingest foundation landed on main, v3.40.0,
8/8 staging-validated). The question is **"what useful thing happens after the data gets in?"** —
i.e. **contextualization**: turning raw signals into an asset-aware, evidence-cited explanation a
human can act on.

**Design rule (from the brief):** optimize for what a **conference attendee / maintenance technician
/ plant engineer / customer** actually sees and understands — **not** for technology. Every choice
below is judged by: *would a non-engineer in the audience get it in 10 seconds?*

---

## The one-sentence demo
> A factory is running on screen → something breaks → a person asks in plain English *"what's wrong?"*
> → **MIRA names the asset, explains the cause, shows its evidence, and says what to do** — without
> the person knowing a single tag name.

That is the whole product. Everything below makes that one sentence real, twice (a deterministic
software factory + a real hardware bench), using assets that already exist.

---

## A. Demonstration architecture

Two surfaces, same pipeline — a **deterministic** track (repeatable on a laptop/projector) and a
**physical** track (credibility: real PLC, real fault).

```
 TRACK 1 — SimLab juice bottling line (deterministic, on-screen, primary)
   simlab (89 tags, 6 fault scenarios, PackML)         simlab/scenarios.py
        │ advance() → snapshot (UNS-mapped)
        │  [INGEST FOUNDATION — landed v3.40.0]
        ▼
   relay /api/v1/tags/ingest → ingest_batch → tag_events + live_signal_cache (UNS)
        │
        ├──────────────► Hub Command Center  (tree + freshness; live VALUE panel = GAP D1)
        │                                     mira-hub/(hub)/command-center
        └──────────────► Hub "Ask MIRA"  /api/mira/ask
                              reads:  live_signal_cache  (current signal state, cited)
                                    + knowledge_entries  (SimLab manuals/fault-codes — seed-simlab-docs.py)
                                    + kg_entities         (asset ↔ UNS context)
                              engine: shared/engine.py (Supervisor) → grounded, cited answer

 TRACK 2 — Garage conveyor (real hardware, credibility)
   Micro820 PLC + GS10 VFD ──Modbus──► Ignition gateway (ConvSimpleLive)
        │ A0–A12 in-gateway anomaly rules + trend viewer
        ▼
   Ignition "Ask MIRA" panel → diagnose_core.py (ignition/webdev/FactoryLM/api/diagnose)
        → same grounded-diagnosis contract (asset + evidence + action)
```

**Why two tracks:** SimLab is **repeatable and safe** for a stage (no hardware to fail mid-keynote);
the garage conveyor is **proof it's not a toy** (a real motor, a real fault, a real answer). The
audience sees the *same kind of answer* from both → the pipeline is real, not staged.

---

## B. Data flow — the 8 steps a human watches

| # | Demo goal | What the audience SEES | What's happening underneath | Asset |
|---|---|---|---|---|
| 1 | **Factory data exists** | A UNS tree of a real bottling line — areas, lines, 43 assets, live values (fill level 12.0 oz, conveyor running) | SimLab snapshot; Command Center tree from `kg_entities` + `live_signal_cache` | ✅ exists |
| 2 | **FactoryLM ingests it** | Values tick live on screen | `advance()` → relay → `tag_events`/`live_signal_cache` (UNS-mapped) | ✅ landed v3.40.0 |
| 3 | **FactoryLM contextualizes it** | The tree *means* something — Filler01 under Line01, its manual + fault codes attached | `kg_entities` (UNS) + `knowledge_entries` (SimLab docs) bind signal→asset→knowledge | ✅ seedable |
| 4 | **A fault occurs** | Fill level drops 12→4 oz; a valve-fault indicator lights; the node goes amber | `simlab/scenarios.py` underfill scenario; freshness/state on the tree | ✅ scenarios exist |
| 5 | **MIRA identifies the affected asset** | "**Filler01, Line 01**" | engine resolves UNS context from the live signal + question | ✅ engine + UNS gate |
| 6 | **MIRA explains the root cause** | "fill_level 4.2 oz vs 12 oz setpoint, CIP valve-fault bit active → underfill from a stuck CIP valve" | engine reads `live_signal_cache` + manual; composes diagnosis | ✅ `/api/mira/ask` |
| 7 | **MIRA cites evidence** | `[live: filler01…fill_level_oz=4.2, valve_fault=true]` + `[Filler manual §3.2]` | citation compliance over live signal + KB chunks | ✅ citations |
| 8 | **MIRA recommends action** | "Inspect the CIP valve actuator on Filler01; verify it seats during fill" | engine action step | ✅ engine |

**The payoff moment is step 5–8 rendered as ONE chat reply with citations** — that single screen is
the demo. Steps 1–4 set it up in ~30 seconds; steps 5–8 are the 15-second reveal.

---

## C. Required assets & dependencies (all exist unless flagged)

| Asset | Role in demo | Status |
|---|---|---|
| `simlab/` juice line + `scenarios.py` (6 faults) | the factory + the fault | ✅ on main |
| Ingest foundation (publisher → relay → `ingest_batch` → cache) | signals land, UNS-mapped | ✅ landed v3.40.0, 8/8 staging-proven |
| `tools/seeds/approved_tags_simulator.sql` | allowlist so SimLab tags land | ✅ on main |
| `tools/seeds/seed-simlab-docs.py` | SimLab **manuals/fault-codes** → `knowledge_entries` (so MIRA can CITE) | ✅ exists — **must be applied to the demo tenant** |
| `kg_entities` (SimLab UNS subtree) | asset↔UNS context | ✅ schema; needs the SimLab namespace seeded |
| Hub **Ask MIRA** `/api/mira/ask` | the question→cited-answer surface | ✅ reads live_signal_cache + KB |
| Hub **Command Center** tree + freshness | "the factory exists" visual | ✅ tree; ⚠️ value panel = Gap D1 |
| `shared/engine.py` Supervisor + citation compliance | the grounded diagnosis | ✅ on main |
| `tests/simlab/runner.py` + `supervisor_answerer.py` | run scenarios against the **real** Supervisor | ✅ on main |
| Reserved `SIMLAB_TENANT_ID` | the demo tenant | ✅ |
| Garage conveyor (Micro820+GS10+Ignition) + `diagnose_core.py` | hardware credibility track | ✅ bench-proven |

**Infra to stand up for a live (non-pre-seeded) demo:** a relay + Neon (or run the relay locally as
in the staging validation), the SimLab docs seeded for the demo tenant, and a screen for the Hub.

---

## D. Missing capabilities (the build list, smallest-first)

| # | Gap | Why it matters to the audience | Size |
|---|---|---|---|
| **D1** | **Command Center live-VALUE panel** (numeric + sparkline from `live_signal_cache`) | Step 1–2/4: the audience must *see* the fill level drop. Today the tree shows freshness dots, not values. | M (roadmap Lane 4) |
| **D2** | **One assembled demo runner** — fault → land → "ask MIRA" → cited answer, as a single scripted flow | Right now the pieces pass tests separately; nobody can press one button and watch the arc | S–M |
| **D3** | **SimLab grounded docs seeded for the demo tenant** (run `seed-simlab-docs.py` + the UNS namespace) | Without manuals in `knowledge_entries`, MIRA can describe the live signal but **cannot cite a root cause** → ungrounded answer (the beta-gate failure mode) | S (seed exists) |
| **D4** | **Production bridge: `live_signal_cache` → engine `live_tags`** for the non-Hub paths | `/api/mira/ask` injects live state Hub-side; other surfaces (Ignition/bench) need the same bridge | M (roadmap Lane 5) |
| **D5** | **Fault→state visualization** (node turns amber/red on the tree at step 4) | The "something broke" beat must be visible, not just a number | S (freshness exists; add state) |

**Note:** none of these is MQTT. The demo runs entirely on the **HTTP relay path that already
landed** (or even direct seeding). MQTT adds *nothing* to this demonstration.

---

## E. Highest-risk gaps (what would make the demo fall flat)

1. **Ungrounded answer (P0).** If the SimLab manuals/fault-codes aren't in `knowledge_entries` for
   the demo tenant (D3), MIRA recites the live numbers but can't *cite a cause* — it looks like a
   thermometer, not an expert. **This is the difference between "data dashboard" and
   "contextualization."** Mitigation: D3 is a one-command seed; verify retrieval (a cited answer)
   on the demo tenant **before** the demo, exactly like the beta gate.
2. **Nothing visible changes (P0 for a live audience).** Without D1/D5, the "fault occurs" beat is
   invisible — the reveal lands flat. Mitigation: build the value panel + node-state (D1/D5), or, as
   a fallback, drive the visual from the Ignition trend viewer (already exists) for Track 2.
3. **Answer quality variance (P1).** The Supervisor is grounded but LLM-cascade answers vary. Run
   the chosen scenario through `tests/simlab/runner.py` + the rubric repeatedly and **lock the
   scenario** that scores best; the demo is scripted, not improvised.
4. **Live infra flakiness on stage (P1).** A live relay/Neon can hiccup. Mitigation: the
   deterministic SimLab track can run **fully local** (relay-as-process + local/seeded data, as in
   the staging validation) — no cloud dependency during the keynote.
5. **Over-claiming autonomy (P2, narrative risk).** MIRA *recommends*, it does not *act* (read-only
   in beta). Keep the narrative honest — "it tells the technician what to check," not "it fixes the
   plant." This is also a *strength* for a maintenance audience (no scary auto-control).

---

## F. Recommended implementation order

Smallest, highest-leverage first; each step is independently demoable.

1. **D3 — seed SimLab grounded docs + namespace for the demo tenant**, then **verify a cited answer**
   (`/api/mira/ask` returns asset+cause+citation+action for the underfill scenario). *This alone
   proves contextualization* — even before any new UI. **(Do this first; it's the thesis.)**
2. **D2 — assemble the one-button demo runner**: trigger scenario → land via relay → call Ask MIRA →
   print/show the cited answer. Reuses the staging-validation harness. Gives a repeatable arc.
3. **Lock the scenario** via `tests/simlab/runner.py` + rubric (pick the clearest-cited fault).
4. **D1 + D5 — Command Center live-value panel + node-state** so the audience *sees* signals tick and
   the fault light up. (Roadmap Lane 4.)
5. **D4 — production bridge** so the Ignition/bench surfaces share the Hub's live-context injection
   (enables Track 2 to match Track 1). (Roadmap Lane 5.)
6. **Garage-conveyor parity pass** — same arc on real hardware via the Ignition Ask MIRA panel.

Steps 1–3 deliver a **complete contextualization demo today** (cited answer to a live fault) with
*no new UI*. Steps 4–6 make it *visually compelling* for a stage.

---

## G. ProveIt-ready narrative (what the presenter says)

> **(Screen: the bottling line tree, values ticking.)**
> "This is a real juice-bottling line — 43 machines, 4,000 signals. Most plants have this data, but
> it's a wall of cryptic tags nobody can read. FactoryLM has already organized it into a namespace
> and attached each machine's manuals and fault codes."
>
> **(Trigger the underfill fault; fill level drops, the filler lights amber.)**
> "Now something goes wrong — bottles are coming out underfilled. On a normal SCADA screen you'd get
> a red light and a tag number. A technician would start guessing."
>
> **(Type into Ask MIRA: "Why are the bottles on line 1 underfilled?")**
> "Instead, the technician just asks — in plain English."
>
> **(MIRA's cited answer appears.)**
> "FactoryLM answers: it's **Filler 1**. The fill level is **4 ounces against a 12-ounce target**, and
> the **CIP valve fault is active** — *here's the live signal* — and *here's the line in the Filler
> manual* that says a stuck CIP valve causes exactly this. **Check the CIP valve actuator.**
>
> No tag names. No manual-flipping. No SCADA training. A question and a grounded answer — with its
> evidence shown. **That's the difference between data and understanding.**"
>
> **(Optional Track 2: the same on the real conveyor.)**
> "And this isn't a simulation. Same question, same kind of answer — on a real PLC and motor."

**The single takeaway line:** *"FactoryLM turns factory signals into answers a technician can act on —
and shows its work."*

---

## What this plan deliberately does NOT do
- No MQTT / Sparkplug / new transport (covered by the separate Phase 3a readiness assessment).
- No PLC writes / control (read-only in beta — and a strength for the maintenance narrative).
- No new diagnostic *engine* — it uses the existing Supervisor + citations; the work is **wiring +
  seeding + visualization**, not new intelligence.

## Cross-references
- `docs/simlab/README.md`; `simlab/scenarios.py`; `tests/simlab/runner.py` + `supervisor_answerer.py`.
- `tools/seeds/seed-simlab-docs.py`; `tools/seeds/approved_tags_simulator.sql`.
- `mira-hub/src/app/api/mira/ask/route.ts` (cited Ask MIRA); Command Center (`(hub)/command-center`).
- `docs/plans/2026-06-22-simlab-uns-ingest-roadmap.md` (Lanes 4/5 = D1/D4).
- `docs/runbooks/2026-06-24-2254-deploy-readiness.md`; `NORTH_STAR.md` (ProveIt 2027).
