# Session 004 — Evidence grounding & explainability: "How do you know?" (Phase 3)

**Date:** 2026-06-22
**Recorder:** Discovery Recorder (ProveIt 2027 northstar, Phase 3)
**Class of work:** evidence graph + explainability (auditable reasoning)

> Deterministic, brain-side only. Built on Phases 0–2 + the committed synthetic fixture. NO MQTT /
> Sparkplug / OPC-UA / Modbus / OpenPLC / Ignition / broker / live pipeline / PLC simulator.

---

## 1. Question being answered

Can every Ask-MIRA conclusion expose its **evidence chain** — supporting AND contradicting — so a
technician, supervisor, or engineer can ask "How do you know?" and get receipts (tags, asset edges,
manual pages, historical events, recommended actions) before any live integration exists?

## 2. Files inspected

- `causality/` (Phase 2): failure modes, components, role resolver — the cause layer the graph grounds.
- `factory_context/` (Phase 1): asset/signal/UNS model the structural nodes come from.
- MIRA groundedness/citation doctrine (`.claude/rules/`, `citation_compliance`) — auditable-reasoning intent.

## 3. Commands executed

```bash
python evidence_graph/run_phase3.py        # Phase 2 -> build graph -> explain -> report -> pytest
make explainability-phase3
python -m pytest evidence_graph/tests/ -q
python -m ruff check evidence_graph
```

## 4. Python workflows used

- `models.EvidenceGraph` (nodes+edges; `violations()` = no anonymous facts / no dangling edges).
- `builder.build_evidence_graph(cmodel, knowledge, history, procedures)` — the full graph.
- `explainer.explain_cause(graph, symptom, line, observation, history)` — ranked hypotheses with
  supporting + contradicting evidence + citations + actions; `observe()` (forward) + `score()`.
- `citations` (typed `[Type] statement`), `failure_library` (known-failure-mode library + contradicting
  roles + procedures), `history` + `procedures` loaders.

## 5. Hypotheses tested — including the ones that FAILED

| # | Hypothesis | How tested | Evidence | Verdict |
|---|---|---|---|---|
| **H1** | "A confidence number is enough to be trustworthy." | Try to answer "how do you know?" from Phase 2 output alone. | Phase 2 gives a ranked cause but no traceable receipts; a supervisor can't audit it. | **ELIMINATED** → every claim must cite typed evidence; build an evidence **graph**, not a score. |
| **H2** | "Only supporting evidence matters." | Inject photoeye-blocked but with counts still **increasing**. | If counts rise, the line isn't really blocked — that **contradicts** the cause; ignoring it overstates confidence. | **ELIMINATED** → model **contradicting** evidence; it must lower confidence (photoeye high→medium under conflict). |
| **H3** | "Recompute the answer in the explainer." | Two sources of truth (graph + ad-hoc recompute) drift. | The answer must be **read from graph edges** so "backed by graph edges" is literally true. | **REFINED** → `explain_cause` traverses SUPPORTED_BY/CONTRADICTED_BY/CITES/PRECEDED_BY/RECOMMENDS edges; the graph IS the source. |
| **H4** | "Facts can be anonymous (just store the value)." | Add nodes without a source. | An un-sourced fact can't be audited; it's indistinguishable from a hallucination. | **ELIMINATED** → **no anonymous facts**: every node carries source + evidence_ref; `violations()` + the gate enforce it. |
| **H5** | "History is a future concern." | Mike's spec wants "similar fault occurred 3 times / last action: clean lens". | A synthetic history fixture (same shape as a CMMS export) makes the answer instantly more credible and is the CMMS bridge. | **CONFIRMED needed** → `maintenance_history.json` + historical evidence in every explanation. |

## 6. Evidence that eliminated the failed hypotheses (now executable)

- H1/H4 → `test_graph_has_no_anonymous_facts_or_dangling_edges` + the gate's `graph.violations()==[]`.
- H2 → `test_contradicting_evidence_lowers_confidence` + the gate's contradiction demo.
- H3 → `test_cause_chain_edges_exist` (the answer's receipts are graph edges).
- H5 → `test_flagship_top_cause_is_photoeye_with_full_receipts` (historical evidence present).
- No-unsupported-claims → `test_no_hypothesis_lacks_tag_or_manual_evidence` + the gate's `_unsupported_claims`.

## 7. Results observed (synthetic fixture)

Flagship: photoeye-blocked on `Conveyor01` → *"why is this line blocked?"* → top cause **Photoeye blocked
(High)** with **Tag** (PhotoeyeBlocked=TRUE, Blocked=TRUE, counts rate dropped to 0/min, State=Down/Fault),
**Asset** (Conveyor01 hosts the photoeye; Conveyor01 feeds CapLoader01), **Documentation** (Conveyor O&M
p.42; Sensor Maintenance p.11), **Historical** (occurred 3×; last action: cleaned lens), **Recommended
checks** + **reference procedure**. #2 conveyor jam (Medium). Contradiction demo: counts still increasing
→ photoeye confidence **High→Medium** with explicit *Evidence AGAINST*. `PHASE 3: OK`.

## 8. Conclusions reached

MIRA can now answer **What is wrong / what supports it / what contradicts it / what manuals / what
procedures / what similar failures / what to check** — every answer traceable, explainable, reproducible,
evidence-backed. This is what makes Ask MIRA trustworthy *before* any live integration. When MQTT/Ignition/
OPC-UA/PLC/CMMS data arrives later, MIRA already knows how to justify its answers.

## 9. Reusable code created

`evidence_graph/{models,citations,failure_library,history,procedures,builder,explainer,reports,run_phase3}.py`
+ `fixtures/{maintenance_history,procedures}.json` + `make explainability-phase3`. Reuses Phases 0–2.

## 10. Tests added

`evidence_graph/tests/{test_evidence_graph,test_explanations,test_citations}.py` — **15 pytest, green**:
no anonymous facts, all node kinds + the cause→evidence chain, history→corrective-action edges; flagship
full-receipts answer, ranked-not-fact, contradicting-evidence-lowers-confidence, generic binding, no
unsupported claims, determinism; citation rendering + evidence types.

## 11. Fixtures added

`evidence_graph/fixtures/maintenance_history.json` (synthetic past faults + corrective actions; the CMMS
bridge) + `procedures.json` (synthetic reference procedures). Both fully synthetic — no licensed content.
