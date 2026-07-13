# Factory Difference Engine — Visual Workflow (Discovery + Plan)

**Status:** discovery + design (2026-07-01). **No code yet** — this doc precedes any build.
**Principle:** the deterministic CLI (`python -m demo.factory_difference_engine`) stays UNDERNEATH
as the replay engine. The human (Mike, non-programmer) should experience it as **click → view →
approve → explain → export** — never Python, CLI, JSON, or test files.

> **Product framing:** FactoryLM *is* the Factory Difference Engine. MIRA is the maintenance agent
> that explains the differences. Litmus / Ignition / OPC-UA / MQTT / CSV are **connection paths**,
> not the product.

---

## 0. The 8 discovery questions — short answers

1. **What supports a visual workflow today?** The whole engine (SimLab + difference detectors +
   evidence + `event_context` + ADR-0017 proposals) already runs offline and returns **pure JSON**
   (`run_pipeline()`), plus a Hub with a demo tenant, demo auth, a `/demo/conveyor/[tag]` sandbox,
   and report generators (`tools/proof/build_pdf.py`, a self-contained HTML sample).
2. **Overlapping Hub surfaces?** `/command-center` (Connect), `/documents` + `/plc-import` +
   `/contextualization` (Pick), `/knowledge/suggestions` + `review/review-queue.tsx` (Learn),
   `/knowledge/map` (evidence). **No** diff / timeline / maintenance-explanation view exists.
3. **Litmus work?** `plc/litmus/` reads a Micro820 *through* Litmus Edge, read-only. It is a
   **Connect-stage data-source adapter**, not the product (see §6).
4. **Demo code + outputs?** `demo/factory_difference_engine/` → `run_pipeline(scenario, seed)` returns
   a 5-stage JSON dict (connect/pick/prove/explain/learn) + a narrated CLI. Deterministic (seed 42).
5. **Engine modules?** `plc/conv_simple_anomaly/{difference_detectors,baseline_learner,event_context}.py`,
   `simlab/diagnostic.py` (`assemble_evidence`/`grade`), `mira-bots/shared/proposal_transition.py` (ADR-0017).
6. **What would a non-programmer click?** A guided 5-step wizard (or a single report page): pick a
   source → pick a machine → run → see difference cards + timeline + explanation + evidence →
   approve/reject learnings → **Export the Factory Difference Report**.
7. **Visual proof outputs?** Difference cards, event timeline, baseline-vs-current, evidence panel,
   What-changed / Why-it-matters / What-to-check-first, Learn approve/reject, and a shareable Report.
8. **What's missing?** Only the **thin visual layer**: a report renderer + (later) a Hub page. The
   engine, data, evidence, and approval logic all exist.

---

## 1. Repo inventory — what exists, mapped to the 5 stages

| Stage | Already exists (reuse) | Where |
|---|---|---|
| **Connect** | SimLab snapshot (read-only), Litmus read proof, fieldbus discovery, ingest → `tag_events` | `simlab/engine.py`, `plc/litmus/mira_on_litmus.py`, `plc/discover.py`, `mira-relay/ingest_contract.py` |
| **Pick** | `approved_tags` allowlist + shapes, doc upload, tag/entity proposals | `approved_tags`(mig 035), `mira-hub /api/documents/upload`, `ai_suggestions`(mig 027) |
| **Prove** | difference engine (baseline learn + 5 detectors + group→event) | `plc/conv_simple_anomaly/{baseline_learner,difference_detectors}.py` |
| **Explain** | evidence assembly + grade, event→prompt block, Supervisor(live) | `simlab/diagnostic.py`, `plc/conv_simple_anomaly/event_context.py`, `mira-bots/shared/engine.py` |
| **Learn** | proposal state machine (ADR-0017), decide routes | `mira-bots/shared/proposal_transition.py`, `mira-hub /api/proposals|suggestions/[id]/decide` |
| **Orchestration** | deterministic 5-stage runner + JSON + narrated CLI + replay test | `demo/factory_difference_engine/`, `tests/simlab/test_proveit_demo.py` |

`run_pipeline()` output (JSON, no DB) is the single data contract for every visual surface:
`{scenario, line, asset_tag, backing_asset, seed, deterministic, stages:{connect, pick, prove, explain, learn}}`.

## 2. Current user-facing surfaces (Hub) + overlap map

Hub = Next.js app-router under `mira-hub/src/app/(hub)/`, served at `app.factorylm.com/hub/*`.
Nav registered in `mira-hub/src/providers/access-control.ts` (`NAV_ITEMS`); sidebar in
`components/layout/sidebar.tsx`. Pages are `"use client"` components that `fetch()` `/api/*`.
Reusable UI: `components/ui/{card,badge,button,tabs,input,skeleton,select}.tsx`,
`components/review/review-queue.tsx` (approve/reject), design tokens in `app/globals.css`.

| Stage | Closest existing Hub page | Reuse verdict |
|---|---|---|
| Connect | `/command-center` (tree + gateway status + freshness) | Reuse for source/asset browse |
| Pick | `/documents` (upload), `/plc-import`, `/contextualization` (extract→propose) | Reuse upload + proposal surfaces |
| Prove | — (none: no diff/timeline view) | **Build** |
| Explain | `/knowledge/map` (graph), `/knowledge/suggestions` (reasoning/evidence) | Partial; **build** the maintenance-explanation card |
| Learn | `/knowledge/suggestions` + `review/review-queue.tsx` | Reuse approve/reject |

Demo plumbing already live: demo tenant `00000000-…-d1`, `sessionOrDemo` auth (`lib/demo-auth.ts`),
`/api/demo/*` routes, and a tablet demo UI at `/demo/conveyor/[tag]`.

## 3. Missing UI pieces (the only genuine gaps)

1. A **Prove view** — difference cards + event timeline + baseline-vs-current sparkline.
2. An **Explain view** — maintenance-facing What-changed / Why / What-to-check + evidence panel.
3. A **Factory Difference Report** — a shareable, manager-readable artifact.
4. A **thin bridge** to get `run_pipeline()` JSON into a browser (report file → later a Hub API route).

Everything else (Connect browse, Pick upload, Learn approve/reject) already has a Hub home.

## 4. Proposed Hub workflow (reuse-first)

A guided **5-step wizard** on one new section, each step reusing an existing surface where possible:

1. **Connect** — source picker (Litmus · Ignition · CSV/upload · **SimLab demo**) + read-only banner
   (“zero writes”) + discovered-signal count. *Reuses command-center tree styling + demo source.*
2. **Pick** — choose factory/line/machine (CV-200 → filler01), see suggested tags + confidence,
   approve/reject, show linked manuals. *Reuses documents upload + proposal cards.*
3. **Prove** — baseline vs current, difference cards, a simple timeline, grouped into one event. **New view.**
4. **Explain** — maintenance explanation + cited evidence + relevant tags + recommended checks. **New view.**
5. **Learn** — proposed context updates, accept/reject, accepted→verified. *Reuses `review-queue.tsx`.*
6. **Report** — one-click **Export Factory Difference Report** (HTML now, PDF later).

## 5. Proposed UI route map (based on the real Hub structure)

Two options; **recommend the single-page stepper (5.A)** for weekend simplicity — fewer files, one
data fetch, matches the `command-center` single-page pattern.

**5.A — single page + stepper (recommended)**
```
/hub/difference-engine            → the guided wizard (Connect→…→Learn tabs/steps) + Export button
/hub/difference-engine/report/[runId]  → the rendered Factory Difference Report (also downloadable)
```
**5.B — sub-routes (only if step-deep-linking is needed later)**
```
/hub/difference-engine/{connect,pick,prove,explain,learn,report}
```
Nav: add one `NAV_ITEMS` entry (`key:"difference-engine", group:"primary", icon:"TrendingUp"`) in
`providers/access-control.ts` + `ICON_MAP` in `sidebar.tsx`.

## 6. Litmus integration role — a Connect-stage adapter (not the product)

Litmus is **one data-source option in Connect**, alongside Ignition / OPC-UA / MQTT / CSV / SimLab.
`plc/litmus/mira_on_litmus.py` already reads a machine *through* Litmus Edge read-only. In the visual
workflow it appears as a **selectable source tile**; when picked, it lands tags into the same
`tag_events`/snapshot the difference engine reads — so the Prove/Explain/Learn stages are identical
regardless of source. **This weekend the demo uses the SimLab source; Litmus shows as “available,
connect later.”** Nothing about the product depends on Litmus specifically — that's the point.

## 7. Factory Difference Report — format (manager-readable)

A **self-contained HTML file** (inline CSS, no deploy) reusing the palette/structure of
`docs/sample-reports/weekly-digest/2026-04-28_weekly-digest.html`. Sections answer the manager's
questions directly, sourced 1:1 from the `run_pipeline()` JSON:

| Section | Answers | From |
|---|---|---|
| Header | What factory/machine was analyzed? | `line`, `asset_tag`, `backing_asset`, `scenario` |
| Connect | What signals were discovered? (read-only, 0 writes) | `stages.connect` |
| Pick | What tags were approved? What docs? | `stages.pick` |
| Prove | What changed from normal? What event? (**difference cards + timeline + baseline-vs-current**) | `stages.prove` |
| Explain | What evidence? What to check first? (**cited**) | `stages.explain.answer` + `rubric` |
| Learn | What did the system learn / what did the human accept-reject? | `stages.learn.proposals` |
| Footer | What's still unproven? Reproducibility (scenario, seed, deterministic) | caveats + `seed` |

Later: the same dict renders to PDF via the proven `tools/proof/build_pdf.py` (reportlab) pattern.

## 8. Implementation phases

**Phase 1 — Weekend, zero deploy (RECOMMENDED FIRST).** A Python renderer
`demo/factory_difference_engine/render_html.py` that turns `run_pipeline()` JSON → a self-contained
HTML report. Mike double-clicks the file; sees difference cards, timeline, baseline-vs-current,
evidence, What-changed/Why/What-to-check, and the Learn accept/reject summary. No Hub, no cloud, no
Python knowledge. *~1 small file; reuses the weekly-digest CSS.* Add a `--html out.html` flag to the CLI.

**Phase 2 — Hub page (mid-week).** `/hub/difference-engine` page (client component) + one Hub API
route `/api/factory-difference/run` that returns the pipeline JSON. Smallest bridge: a tiny Python
HTTP wrapper (`api_server.py`) behind `FACTORY_DIFFERENCE_ENGINE_URL` (mirrors the `INGEST_URL`
pattern), or pre-generated JSON. Renders the 5-step wizard; “Export Report” downloads the Phase-1 HTML.

**Phase 3 — Productionize (later).** Reuse `review-queue.tsx` for real Learn decisions via
`/api/suggestions/[id]/decide`; log runs to `workflow_runs`; PDF export; wire real Connect adapters
(Litmus/Ignition/CSV) so the same UI runs on live data, not just SimLab.

## 9. Non-programmer acceptance test (Mike, no code)

**Phase 1 (this weekend):**
1. Double-click `Factory-Difference-Report.html` (or run one provided `.bat`/one command someone set up).
2. In the browser: read the header (Northwind Bottling / CV-200), Connect (89 signals, **0 writes**).
3. See **difference cards** (bowl pressure 5.1 vs normal ~12; fill level low; drift down) on a **timeline**.
4. Read the **explanation** (“what changed / why it matters / check compressed-air header first”) with **cited manuals**.
5. See the **Learn** panel: 2 accepted (verified), 1 rejected — no code, no CLI.
6. Save/print/share the report with a maintenance manager.

**Phase 2 (Hub):** Open Hub → Demo Mode → *Difference Engine* → pick CV-200/filler01 → choose
scenario B → click Run → see cards + explanation + evidence → Accept/Reject learnings → Export Report.

## 10. Risks / caveats (honest)

- **CV-200 / Northwind = alias** over SimLab `filler01` — real deterministic data, branded names only.
- **Deterministic Explain is templated** (grounded, passes the rubric); the real LLM answer is the
  opt-in `--live` path (needs cloud + Neon) — keep it out of the weekend/CI path.
- **Hub is TypeScript, engine is Python** — Phase 2 needs a bridge (tiny HTTP wrapper or pre-generated
  JSON); don't inline Python into Next.js. Phase 1 avoids this entirely.
- **Don't rebuild** command-center / documents / suggestions — reuse them; only Prove + Explain views
  and the report are new.
- **Scope discipline:** thin visual orchestration over the existing JSON. No new engine, no new DB
  tables for Phase 1–2. Scenario E (palletizer e-stop) yields no event — pick A/B/D/F for demos.

## 11. Recommendation

Build **Phase 1 (static HTML report)** first — it's the smallest thing that makes the demo *visual*
and shareable, needs no Hub/cloud, and is testable by Mike this weekend. It also becomes the “Export
Report” output that Phase 2's Hub page reuses. Everything else is deferred and reuse-heavy.

## Cross-references
- `demo/factory_difference_engine/README.md` — the deterministic engine underneath
- `docs/plans/2026-06-22-proveit-2027-demo-runbook.md` — the live arc this visualizes
- `docs/product/mira_difference_engine_offering.md` — product framing
- `docs/sample-reports/weekly-digest/2026-04-28_weekly-digest.html` — HTML report pattern to reuse
- `tools/proof/build_pdf.py` — PDF pattern (Phase 3)
- `mira-hub/src/providers/access-control.ts` + `components/review/review-queue.tsx` — nav + approval reuse
