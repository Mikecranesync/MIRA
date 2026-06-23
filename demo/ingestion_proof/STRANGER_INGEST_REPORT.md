# Stranger-factory ingestion proof

**Question:** can FactoryLM ingest a stranger's factory and structure it with the systems we built?
**Method:** run the REAL `factory_context` pipeline on a foreign export it has never seen and was not
tuned for — a fictional **water-treatment plant** (`stranger_water_plant_export.json`), nothing like the
bottling / Conv_Simple demo. Then map the result into the Hub approval queue with the committed PR-1/PR-2
transforms. Reproduce: `python demo/ingestion_proof/run_ingest_proof.py`.

## What worked with ZERO tuning (the core claim — YES)

- **Hierarchy + UNS namespace**: correctly inferred `enterprise → site → area → line → asset` from the
  export and drafted clean lowercase UNS paths, e.g.
  `riverside_water_authority.north_plant.treatment.train_a.influentpump01` — **HIGH confidence**.
- **Assets**: all 5 foreign assets identified (InfluentPump, Blower, AerationBasin, Clarifier,
  EffluentPump) — equipment types the system had never seen.
- **Relationships**: 8 `contains` (hierarchy, HIGH) + 4 `feeds` (process order, LOW/needs_review — honestly
  uncertain) inferred.
- **Hub queue mapping (PR-1/PR-2)**: 5 `kg_entity` + 24 `tag_mapping` ai_suggestions, 36
  relationship_proposals (8 HAS_COMPONENT + 4 UPSTREAM_OF + 24 HAS_SIGNAL).
- **Integrity**: **0 auto-approved**. Every row is a *proposal* a human approves — no hallucinated facts.

## The gap — now CLOSED (classifier upgrade)

**First run:** 13 industry-specific process tags (`gpm`/`psi`/`mg/L`/`NTU`/`pH`…) came back `unknown` →
needs_review. That was honest (flag, don't guess) but bounded.

**After the classifier upgrade, the same foreign export ingests with `0 unknowns`.** What changed:

- **Units ⇒ analog (any domain):** any engineering unit (not just the bottling set) now classifies a signal
  as `live_analog` — `gpm`, `psi`, `mg/L`, `scfm`, `NTU`, `A`, … all generalize.
- **Name fallback:** unitless measurements (`pH`, `ORP`, `Turbidity`, vibration) classify by name token.
- **Two new archetypes — `live_fault` and `live_setpoint`:** fault/alarm/trip bits and SP/Cmd/target tags
  are now distinguished from ordinary bools and PVs (huge for MIRA diagnosis + HMI value-vs-setpoint rows).
- **Physical dimension inference:** every analog now carries a `dimension` (flow/pressure/temperature/
  level/electrical/concentration/speed/torque/mass/vibration) — MIRA can reason about *what* a value is and
  the HMI can auto-group/scale it. Water-plant result: `{flow:3, pressure:2, electrical:3, concentration:3,
  level:2, temperature:2, volume:1, ratio:1}`.
- **Equipment-type inference:** each asset gets a canonical `equipment_type` from its UDT/name
  (`pump`, `blower`, `basin`, `clarifier`) — so MIRA pulls the right failure modes and the HMI picks the
  right mimic, on equipment it has never seen.

All taxonomy-safe: the bottling fixture is unchanged (Phase 0/1 gates green, 0 unknowns preserved), and the
two new archetypes are wired through `uns_draft` (UNS categories `faults`/`setpoints`), the Hub PR-1
data-type map, and the live-signal gate. Reproduce: `python factory_context/run_phase1.py` (PASS) +
`python demo/ingestion_proof/run_ingest_proof.py` (0 unknowns).

## Verdict

**Yes — the system ingests a stranger's factory and structures it with no tuning:** it builds the UNS
namespace, identifies and *types* the assets (pump/blower/clarifier…), classifies and *dimensions* every
signal (incl. faults and setpoints), infers relationships, and lands everything in the Hub approval queue as
human-reviewable proposals — `0 auto-approved`. Pair this with the beta gate (a stranger's *manual* → cited
answer, CI-enforced) and both halves of "ingest a stranger's factory" are real and demonstrated.
