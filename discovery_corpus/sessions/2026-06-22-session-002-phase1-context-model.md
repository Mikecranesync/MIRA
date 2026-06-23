# Session 002 — Evidence export → approval-ready contextual model + UNS draft (Phase 1)

**Date:** 2026-06-22
**Recorder:** Discovery Recorder (ProveIt 2027 northstar, Phase 1)
**Class of data:** Ignition / Sepasoft MES-OEE tag export (Phase 0 output → contextualization)

> Code-first, synthesizer-free. Built on the committed synthetic fixture only; the licensed corpus is
> never touched. Evidence-type rules: `EVIDENCE_TYPES.md`.

---

## 1. Question being answered

Given **only** a structural evidence export (the Phase 0 interrogation), can FactoryLM deterministically
produce an **approval-ready contextual model + a UNS draft** that a human could review in the Hub —
where *every* entity/signal/relationship is a suggestion with source evidence, confidence, a reason,
the human approval it needs, and a status — and where nothing inferred is presented as a fact?

## 2. Files inspected

- `discovery_corpus/scripts/interrogate_ignition_export.py` — Phase 0 taxonomy (reused as the single
  source of `classify_signal`).
- `mira-plc-parser/mira_plc_parser/uns.py` (`slug`), `ir.py` (`Provenance`, `Confidence`,
  `NamespaceNode.udt_type/mes_path/path`) — reused, not reinvented.
- `discovery_corpus/fixtures/synthetic_factory_export.json` — extended this session (see §9).
- MIRA approval doctrine: `.claude/rules/train-before-deploy.md`, the `kg_entities` proposed→verified
  model, ADR-0017 status transitions — to shape "approval-ready".

## 3. Commands executed

```bash
# build the model + UNS draft + report, run both test suites, enforce invariants (one command)
python factory_context/run_phase1.py        # or: make context-phase1
python -m pytest factory_context/tests/ -q
python -m ruff check factory_context
```

## 4. Python workflows used

- `build.build_model(project, source)` → `FactoryModel` (entities + signals + relationships, all
  `Suggestion`s with evidence/confidence/status/approval_needed).
- `uns_draft.entity_uns_path` / `signal_uns_path` — slugged UNS paths; signal category from archetype.
- `report.render(model)` + `run_phase1.success_condition(model)` + `model.evidence_violations()`.

## 5. Hypotheses tested — including the ones that FAILED

| # | Hypothesis | How tested | Evidence | Verdict |
|---|---|---|---|---|
| **H1** | "Asset order in the export encodes physical material flow (upstream→downstream)." | Look for any conveyance/sequence field on the export; otherwise order is just JSON sibling order. | The tag export carries **no flow/sequence metadata**; sibling order is incidental. | **ELIMINATED as fact** → `feeds` edges are emitted **LOW + needs_review** ("export order; physical flow NOT confirmed"), never as fact. |
| **H2** | "There is a cell layer between line and asset." | Count namespace levels. | Levels are enterprise/site/area/line/asset — **no intermediate cell** container. | **ELIMINATED** → no fabricated cell; emit a **needs_review cell *proposal*** per line instead. |
| **H3** | "A signal's archetype is a fact we can assert." | The archetype is a deterministic name/unit pattern-match — but it is a *semantic* interpretation. | A bool named `Blocked.Value.Value` is *structurally* certain but its *meaning* is inferred. | **REFINED** → signal *existence* = HIGH; signal *role* = **MEDIUM, suggested** (not verified). |
| **H4** | "We can auto-approve high-confidence structural entities." | Check against train-before-deploy + `kg_entities` proposed→verified (promotion is an admin action). | Even a structurally-certain entity must be **human-confirmed** before it is verified/deployed. | **ELIMINATED** → the machine emits `status=suggested` only; **never `approved`** (enforced by a test + the gate). |
| **H5** | "`MesTagPath` / `udt_type` prove the asset identity outright." | Inspect asset nodes. | They are **strong evidence** (HIGH confidence) but still require placement confirmation. | **REFINED** → HIGH confidence, still `suggested` with `approval_needed`. |

## 6. Evidence that eliminated the failed hypotheses (now executable)

- H1 → `test_feeds_relationships_are_inferred_low_and_needs_review` + the gate's success condition.
- H2 → `test_cell_layer_is_proposed_not_asserted`.
- H3 → live signals carry confidence `medium`, status `suggested` (`test_*` + report).
- H4 → `test_nothing_is_auto_approved` + `success_condition` rejects any `approved`.
- The umbrella guarantee → `model.evidence_violations() == []` (`test_no_fact_without_evidence`): every
  suggestion has evidence + statement + confidence + status + approval_needed.

## 7. Results observed (synthetic fixture)

Interrogation → model → UNS draft, all green (`PHASE 1: OK`):
- Entities: 1 enterprise / 1 site / 2 area / 2 line / **2 proposed cells (needs_review)** / 3 asset —
  all HIGH-confidence `suggested` with UNS paths (`synthetic_beverage_co.demo_site.bottling.bottlingline1.filler01`).
- Live signals categorized: `live_bool`→`.status.`, `live_counter`→`.production.`, `live_state`→`.status.`,
  `live_analog`→`.process.`; 7 static-metadata excluded; 0 unknown.
- Relationships: 8 `contains` (HIGH) + 1 inferred `feeds` (`caploader01 → filler01`, LOW, needs_review).
- Invariants: **0 facts-without-evidence**, **0 auto-approved**.

## 8. Conclusions reached

FactoryLM can turn a bare structural export into an **approval-ready** contextual model + UNS draft,
deterministically, with honest uncertainty: structural entities HIGH/suggested, inferred roles
MEDIUM/suggested, inferred flow + the cell layer LOW/needs_review, nothing auto-approved. The
`uns_draft.json` + `phase1_context_model.md` are exactly what a Hub reviewer would accept/reject/send
to review (mirrors `kg_entities` + `ai_suggestions` as `proposed`). **Phase 1 success condition met.**

## 9. Reusable code created

`factory_context/{model,build,uns_draft,report,run_phase1}.py` — the deterministic contextualizer +
one-command gate (`make context-phase1`). Reuses Phase 0's `classify_signal` and the parser's `slug`
/ `Provenance` / `Confidence` (no reinvented path builders).

## 10. Tests added

`factory_context/tests/test_factory_context.py` — **15 pytest, green**: entity coverage, the
no-fact-without-evidence invariant, nothing-auto-approved, UNS-path shape, blocked/starved/count/state
present in the draft, metadata excluded, `feeds` inferred-not-fact, cell proposed-not-asserted, the
success condition, and determinism.

## 11. Fixtures added / extended

Extended `discovery_corpus/fixtures/synthetic_factory_export.json`: added `CapLoader01` upstream of
`Filler01` on `BottlingLine1` (now a 2-asset line) so the upstream→downstream (`feeds`) inference has
a chain to operate on. Phase 0's asset-count assertion updated 2→3; both gates stay green. Still fully
synthetic — no licensed names/values.
