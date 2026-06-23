# Session 003 — Maintenance-causality engine: symptom → likely cause → evidence → checks (Phase 2)

**Date:** 2026-06-22
**Recorder:** Discovery Recorder (ProveIt 2027 northstar, Phase 2)
**Class of work:** maintenance-causality engine (NOT a factory simulator)

> Deterministic, synthesizer-free. Built on the Phase 1 context model + the committed synthetic
> fixture only. No MQTT/Sparkplug/OpenPLC/Modbus/OPC-UA/Ignition. The product is the *explanation*.

---

## 1. Question being answered

Can FactoryLM make **Ask MIRA look intelligent** — given a symptom ("why is this line blocked?"),
deterministically explain the likely *hidden cause*, the *chain of effects*, the *supporting tags*,
the *related manual pages*, and the *technician checks* — grounded in the factory Phase 1 discovered,
as ranked hypotheses (never asserted as fact)?

## 2. Files inspected

- `factory_context/` (Phase 1 model + UNS draft) — the factory the engine reasons over.
- `discovery_corpus/scripts/interrogate_ignition_export.py` — Phase 0 archetypes (reused).
- `.claude/rules/` (train-before-deploy, groundedness, citation discipline) — to keep the engine
  honest (ranked, cited, suggested-not-asserted).

## 3. Commands executed

```bash
python causality/run_phase2.py        # Phase 1 -> build -> inject -> explain -> report -> pytest
make causality-phase2
python -m pytest causality/tests/ -q
python -m ruff check causality
```

## 4. Python workflows used

- `failure_modes.CATALOG` — 8 hidden causes (photoeye / conveyor jam / VFD / motor overload / sensor
  drift / low air / interlock / comm loss), each with a causal chain + symptom + supporting-tag roles.
- `components.build_causality(model)` — infer components under assets (generic binding by asset class)
  as `needs_review` suggestions.
- `explain.inject(cmodel, mode, asset)` (forward: create symptoms) + `explain.explain(cmodel, symptom)`
  (reverse: rank likely causes) + `explain.score` (top cause == injected).
- `knowledge.load_knowledge()` — synthetic manual pages + checks (citable evidence).

## 5. Hypotheses tested — including the ones that FAILED

| # | Hypothesis | How tested | Evidence | Verdict |
|---|---|---|---|---|
| **H1** | "Phase 2 should be a realistic factory **simulator**." | Re-read the ProveIt goal: nobody asks "can your simulator model a bottling line?" — they ask "why should I care?". | The product is MIRA's *explanation*, not the simulation; the simulator is just a machine that creates symptoms. | **ELIMINATED** → build a maintenance-**causality** engine; simulate **causes**, not machines. |
| **H2** | "Generic MES symptoms (Blocked/counts/state) are enough to identify the cause." | Inject photoeye-blocked; rank candidates by abnormal-tag overlap. | photoeye, conveyor-jam, and motor-overload **all** share Blocked/counts/state — they tie without a **signature** tag. | **REFINED** → need component-specific signature tags (the **photoeye** tag) to discriminate; that is why the component sublayer + per-mode roles exist. |
| **H3** | "MIRA should state THE cause." | Diagnostic/groundedness doctrine. | A single asserted cause is wrong and dangerous; real diagnosis is ranked hypotheses with evidence. | **ELIMINATED** → output is **ranked** "most likely / also possible", each with confidence + evidence; never "the cause". |
| **H4** | "Components are facts we can assert (the export has them)." | The tag export has assets + MES signals but **no** photoeye/VFD/motor components. | Components are an **inference** (the maintenance sublayer). | **ELIMINATED** → components are `needs_review` suggestions with evidence (same Phase 1 honesty); not asserted. |
| **H5** | "One flagship machine (a conveyor) is enough." | Mike's steer: generic binding across asset types. | A second scenario (sensor drift on a **tank** → quality reject) must also explain correctly. | **CONFIRMED needed** → generic binding by asset class; both flagship (conveyor) + breadth (tank) scenarios score. |

## 6. Evidence that eliminated the failed hypotheses (now executable)

- H1 → the whole engine is `explain()`, not a value loop; no simulator runtime exists.
- H2 → `test_flagship_photoeye_is_top_ranked_cause` (photoeye's signature tag breaks the tie; score 4 > 3).
- H3 → `test_explanation_is_ranked_hypotheses_not_fact` (≥2 ranked, headline says "likely … hypothesis").
- H4 → `test_components_are_needs_review_with_evidence` + `cmodel.evidence_violations() == []`.
- H5 → `test_generic_binding_sensor_drift_on_tank`.

## 7. Results observed (synthetic fixture)

Flagship: inject `photoeye_blocked` on `Conveyor01` → ask "why is this line blocked?" → MIRA's
**top-ranked** cause = **Photoeye blocked / fouled on Conveyor01 (high confidence)** with the 5-step
chain, 4 supporting tags (incl. the photoeye tag), 2 manual citations, 4 technician checks; #2 = conveyor
jam (medium). Breadth: `sensor_drift` on `Tank01` → quality reject → top cause = sensor drift. Both
`score()` True; `evidence_violations() == []`. `PHASE 2: OK`.

## 8. Conclusions reached

The maintenance layer — not the simulator — is the product. The engine turns a symptom into a
**grounded, cited, ranked explanation** a technician can act on, using only the factory Phase 1
discovered + synthetic manuals. This is the deterministic precursor to the Ignition "Ask MIRA" answer:
when it is correct against injected ground truth, plugging in real live data later is a data-source swap,
not a redesign. Nervous system (MQTT/PLC/Ignition) still deferred.

## 9. Reusable code created

`causality/{failure_modes,components,knowledge,explain,answer,run_phase2}.py` + `fixtures/maintenance_knowledge.json`
+ `make causality-phase2`. Reuses Phase 0 archetypes + Phase 1 model + the parser's `slug`.

## 10. Tests added

`causality/tests/test_causality.py` — **9 pytest, green**: catalog shape, manual+check coverage
(cite-evidence), component inference (needs_review + evidence), the flagship photoeye ranking, ranked-
not-fact honesty, generic binding on a tank, asset classification, and determinism.

## 11. Fixtures added / extended

Extended `synthetic_factory_export.json`: added `Conveyor01` upstream on `BottlingLine1` carrying a
`Photoeye.Blocked.Value.Value` tag (the photoeye signature) + `Drive.MotorCurrent` (mA), so the iconic
chain works literally. Phase 0 asset count 3→4; both prior gates stay green. Still fully synthetic.
