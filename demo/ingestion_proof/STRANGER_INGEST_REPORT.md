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

## The honest gap (signal SEMANTICS is domain-bounded)

24 live signals were extracted. The **vendor-neutral MES fields generalized** (ProductionRun→`live_bool`,
State→`live_state`, Counts→`live_counter`). But **13 industry-specific process tags** came back
`unknown` → **needs_review**, not guessed:

`FlowRate (gpm)`, `DischargePressure (psi)`, `MotorCurrent (A)`, `AirFlow (scfm)`, `DissolvedOxygen (mg/L)`,
`Temperature (C)`, `pH`, `Turbidity (NTU)`, `RakeTorque`…

That is the **correct** behavior (flag, don't hallucinate), and it pinpoints the real work to onboard a
**new vertical**: teach the archetype classifier the new domain's signal vocabulary (or route unknowns
through the existing LLM-classify suggestion). The *structure* transfers for free; the *signal meaning*
needs a small per-domain extension.

## Verdict

**Yes — the skeleton works on a stranger's factory with no tuning: it builds the UNS namespace, identifies
assets, infers relationships, and lands everything in the Hub approval queue as human-reviewable proposals.**
The bounded part is signal-role classification for an unfamiliar industry, where the system stays honest
(needs_review) instead of guessing. Pair this with the beta gate (a stranger's *manual* → cited answer,
CI-enforced) and both halves of "ingest a stranger's factory" are real: documents are proven end-to-end;
the tag-export → structured-namespace path works on foreign data with a known, scoped extension point.
