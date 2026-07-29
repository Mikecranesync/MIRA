# PLC Program Teacher Status — Offline PLC Program → UNS/i3X/MIRA Context

**Date:** 2026-06-17 · **Author:** investigation (Claude Code) · **Branch:** `claude/plc-devops-status-y4gjuf`
**Scope:** ground-truth status of MIRA's ability to ingest **offline PLC program files** and turn them into structured maintenance intelligence (UNS / i3X / KG). Distinguished from the **live Ignition tag-mapper**, which is a different product.

> **Method note.** Every capability below was confirmed against code, tests, docs, git history, and open/merged PRs in the repo as of 2026-06-17. Where something exists only as a plan or an unmerged PR, it is marked as such. GitHub access was available and used (PRs #2062, #2065, #2068, #1709, #2074). Nothing here is inferred from intent alone.

---

## Executive Summary

MIRA **can already parse a real offline PLC program export and extract deterministic maintenance context** — this landed on `main` on 2026-06-17 (PR #2065) as the isolated `mira-plc-parser/` subproject. It reads **Rockwell L5X** (full logic) and **vendor tag CSVs**, builds one intermediate representation (IR), and extracts tags, routines, output dependencies, and fault/asset/VFD-signal/safety candidates — offline, stdlib-only, no LLM, read-only.

**What is NOT yet on `main`:** the bridge from that extracted context into MIRA's UNS/KG and i3X. The parser emits **no UNS paths and no i3X objects**, and it is **imported by nothing** outside its own package — it is a standalone CLI/desktop tool. The PLC→UNS/i3X proposal layer exists only in **open, unmerged PR #2068**. Separately, MIRA's **own i3X v1 read API is merged and live** (`mira-hub/src/app/api/i3x/v1/*`), but it projects the **verified knowledge graph** (`kg_entities`), which PLC-file-derived context cannot currently reach.

**Net:** the *extraction half* is real and merged; the *mapping/serving half from PLC files* is open-PR and not customer-reachable. There is **no customer self-serve path** to upload a PLC program file today.

**Status: 🟡 YELLOW.**

---

## What We Mean by "PLC Program Teacher"

Two related but distinct products. Keep them separate:

| | **Ignition Tag-Mapper ("live teacher")** | **PLC Program Teacher ("offline teacher")** |
|---|---|---|
| Input | Live tags on a running Ignition gateway | Offline PLC program **files** (`.L5X`, tag CSV, future `.st`/PLCopen/Siemens) |
| Needs SCADA online? | Yes | **No** — works from an export, before/without any gateway |
| Reads | Tag values + tag tree | Program logic: controllers, routines, rungs, tags, I/O, fault/interlock logic |
| Status | Merged + bench-verified (SetupWizard, VFD-Analyzer, #2065/#2074) | Parser merged (#2065); UNS/i3X mapping open (#2068); no upload path |
| Lives in | `ignition/`, `plc/ignition-project/`, `mira-hub` wizard | `mira-plc-parser/` (+ open `i3x_client.py` in #2068) |

The "PLC Program Teacher" is the harder, more general capability: a customer hands MIRA a PLC project export, and MIRA extracts equipment, signals, faults, interlocks, and relationships **from the logic itself** and proposes a standardized UNS/i3X model.

---

## Current Confirmed Capabilities

| Capability | Status | Where |
|---|---|---|
| Parse Rockwell **L5X** export → IR (controller, tags, routines, rungs, ST, UDTs) | ✅ **Merged** (#2065) | `mira-plc-parser/mira_plc_parser/parsers/rockwell_l5x.py` |
| Parse vendor **tag CSV** (Rockwell/Siemens/Kepware/generic dialects) → IR | ✅ **Merged** | `parsers/csv_tags.py` (reuses `ignition/webdev/FactoryLM/api/diagnose/tag_csv.py`) |
| Deterministic analysis: tag dict, routine summaries, **output-dependency map**, fault/asset/**VFD-signal**/safety-review candidates | ✅ **Merged** | `mira_plc_parser/analyze.py` |
| Closed/binary project files (`.ACD`/`.s7p`/`.project`/`.ap1x`/archives) **rejected with export instructions** (exit 3) | ✅ **Merged** | `mira_plc_parser/detect.py` |
| Offline CLI + Markdown/JSON reports + Windows `.exe` packaging spec | ✅ **Merged** | `cli.py`, `PACKAGING.md`, `mira-plc-parser.spec` |
| **UNS/ISA-95 proposals from PLC IR** | 🟡 **Open PR only** (#2068) | not on `main` |
| **i3X export / live i3X reconcile from PLC IR** | 🟡 **Open PR only** (#2068) | `mira_plc_parser/i3x_client.py` (unmerged) |
| Structured Text / PLCopen / Siemens TIA parsing | ❌ **Detected, not parsed** (planned) | `detect.py` recognizes; `pipeline.py` `_PLANNED` set |
| Customer upload of a PLC program file | ❌ **Not implemented** | — |

---

## Existing PLC Program Parsers / Importers

**Merged (`main`, via PR #2065 — `mira-plc-parser/`, stdlib-only, read-only, deterministic):**

- `detect.py` — content-first format detection. Recognizes `rockwell_l5x`, `csv_tags`; recognizes-but-defers `plcopen_xml`, `siemens_tia_xml`, `structured_text`; routes closed binary projects (`.ACD`, `.ap15–.ap18`, `.s7p`, `.project`, `.rss`/`.rsp`) and archives to **export-guidance** rather than "unknown."
- `parsers/rockwell_l5x.py` — L5X XML → IR. Extracts controller/processor type, software version, controller- and program-scoped tags, programs, routines (RLL + ST), rungs (text, comment, tag refs, output instructions, mnemonics), and UDTs. Confidence: HIGH for structural extracts.
- `parsers/csv_tags.py` — vendor-agnostic tag CSV → IR (reuses the dual-Py `tag_csv.py` engine).
- `ir.py` — the shared **MIRA PLC IR**: `Controller → Program → Routine → Rung → Tag`, with `Provenance` (source file, locator, confidence band).
- `analyze.py` — deterministic rules over the IR (no LLM): output-dependency map (HIGH), fault candidates (regex `fault|trip|alarm|estop|fail|overload|jam`, MEDIUM), asset candidates (`motor|conveyor|pump|valve|solenoid|vfd|fan|…`, MEDIUM), VFD-signal-role candidates (frequency/current/fault_code/dc_bus/setpoint/comm_ok — feeds the VFD-Analyzer roles), safety-review flags (REVIEW).
- `cli.py` / `__main__.py` — `mira-plc-parser analyze <file> [--out DIR] [--format md|json|both]`; exit 0/1/3.
- **Tests:** `mira-plc-parser/tests/` — 31 tests (L5X extraction, detect/closed-project routing, full pipeline, CLI). Fixtures: `tests/fixtures/conveyor.L5X`, `tests/fixtures/gs10_tags.csv`.

**Open / unmerged:**
- **PR #2062** ("PLC Parser Phase 1 — read-only export analysis + offline CLI", branch `plc-parser/phase1-offline-cli`, 38 tests) — a **parallel** standalone parser PR whose Phase-1 scope substantially **overlaps what already merged via #2065**. Likely needs reconcile/close or rebase to avoid a duplicate `mira-plc-parser/`. *(Recommend: confirm against `main` and close if superseded.)*

**Related but NOT parsers (they WRITE/build, they don't read logic):**
- `plc/build_conv_simple_*.py`, `plc/populate_variables.py`, `plc/inject_vars_accdb.py` — build/flash CCW projects (write `PrjLibrary.accdb` / `.st`); they do not parse a program's logic.
- `plc/discover.py` — read-only **network** field-device scanner, not a program-file parser.
- The many `plc/*.st` / `*.stf` files — hand-authored bench program sources, **not** parser test fixtures.

---

## Existing Sample PLC Program Sources

- **Parser fixtures (used as test inputs, merged):** `mira-plc-parser/tests/fixtures/conveyor.L5X` (ControlLogix conveyor: ~19 tags, 1 UDT, 2 routines RLL+ST, e-stop + VFD examples) and `gs10_tags.csv` (Kepware/Modbus dialect, GS10).
- **Bench program sources (NOT fixtures):** `plc/Micro820_v*.st`, `plc/Prog_init_ConvSimple_v2.1.st`, `plc/Prog2.stf`, etc. — these are the real bench Conv_Simple lineage; they are deploy artifacts, not parser eval inputs.
- **No external public corpus yet** (no OpenPLC/PLCopen/Studio-5000 sample library checked in for evaluation). Building one is the parser roadmap's "Phase 2 — eval dataset" and is **not done**.

**Conclusion:** the only PLC program currently exercised by the parser is the single `conveyor.L5X` fixture. It is a *test fixture*, not a *training/eval dataset*.

---

## Existing Machine Context Extraction

- **Deterministic / rule-based**, no LLM, on `main`: the `analyze.py` layer turns IR into tag dictionary, routine summaries, output dependencies, and fault/asset/VFD-signal/safety candidates with confidence bands and provenance.
- **What it does NOT do (on `main`):** infer a UNS hierarchy, infer equipment *relationships* (component↔fault↔tag edges), sequencer-state extraction, timer→fault chains, or permissive graphs. The PR #2068 body describes the UNS/ISA-95 proposal step, and deeper analysis (permissives, sequences) is a declared later phase.
- **No model training / fine-tuning anywhere.** Extraction is pure rules over parsed XML/CSV.

---

## Existing UNS Mapping Capability

**On `main` (merged), but NOT fed by the PLC parser:**
- `mira-crawler/ingest/uns.py` — ISA-95 ltree path builders (`manufacturer_path`, `model_path`, `assigned_equipment_path`, `fault_code_path`, …); reserved-label + grammar enforcement. (`mira-hub/src/lib/uns*.ts`, `simlab/uns.py` mirror it.)
- `mira-bots/shared/uns_resolver.py` — resolves **free-form chat text** → `{manufacturer, model, fault_code}` with confidence bands (vendor alias table, fault patterns).
- `mira-crawler/ingest/kg_writer.py` — `upsert_entity(uns_path=…)` / `upsert_relationship(…)` write to `kg_entities` / `kg_relationships`.

**The gap:** UNS today is built from **chat-resolved context** or the **onboarding/tag wizard**, never from an **offline PLC program**. `grep` over the merged parser confirms it emits **no `enterprise.*` paths and no UNS** (only an unrelated XML-namespace string in `detect.py`).

**Open PR #2068** ("PLC → UNS / i3X Namespace Builder") is exactly this missing link: parser IR → UNS/ISA-95 proposals → desktop Namespace Builder. It is **stacked on the now-merged #2065 and not merged**.

---

## Existing i3X Mapping Capability

Two different i3X directions exist; keep them straight:

1. **MIRA *as* an i3X server — MERGED on `main`.** `mira-hub/src/app/api/i3x/v1/*` implements the CESMII i3X read/query surface (`/info`, `/namespaces`, `/objecttypes`(+`/query`), `/relationshiptypes`(+`/query`), `/objects`(+`/list`, `/related`, `/value`, `/history`)). `mira-hub/src/lib/i3x/*` maps `kg_entities` → i3X `ObjectInstance` (`elementId = kg_entities.id`; UNS path is metadata; `approval_state='verified'` filter; bearer auth; tenant RLS). Conformance: **"1.0 Compatible (read/query)"**; writes disabled (`update.current/history=false`); subscriptions deferred. Migration `054_i3x_api_keys.sql`, contract tests present. Plan: `docs/implementation/i3x-mvp-plan.md` (Phase 2 ✅).
   - **Crucial:** this server projects the **verified KG**. It does **not** read parser output. PLC-file context can only appear here after it becomes a verified `kg_entities` row — a path that does not exist on `main`.

2. **MIRA *as* an i3X client (reconcile) — OPEN PR #2068.** `mira_plc_parser/i3x_client.py` (stdlib `urllib`) handshakes an **external** i3X server and reports which proposed nodes already exist vs. are new (`i3x-check`, `i3x-reconcile`). Correctly **does not push structure** (the i3X API has no create/upsert for types/instances). Unmerged.

**Conclusion:** i3X is "real code, not aspiration" — but the live server serves the KG, and the PLC→i3X path is reconcile-only and unmerged. PLC-derived context cannot be exposed through i3X today.

---

## Existing Customer Upload / Import Workflow

**Merged (customer-reachable):**
- PDF / image upload: `POST /api/uploads`, `/api/uploads/local`, `/api/uploads/folder` (MiraDrop) → `hub_uploads` → ingest → `knowledge_entries`. SUPPORTED_MIMES = PDF + images only.
- Folder=brain attach-to-node: `POST /api/namespace/node/[id]/files` (anchors chunks to a UNS node). E2E citation proof exists.
- Ignition tag CSV import: `POST /api/connectors/ignition/import` + tag-classifier → `ai_suggestions` of type `tag_mapping` (PR #2074, the live tag-mapper — open but advanced).

**NOT implemented:**
- ❌ **No endpoint accepts a PLC program file** (`.L5X`/`.ACD`/CCW/PLCopen/Siemens). The MIME allowlist is PDF+images; the parser is a CLI/library with **no HTTP surface** and is imported by nothing in `mira-hub`/`mira-mcp`/`mira-crawler`.
- A customer's only path today: export to L5X → run `mira-plc-parser analyze` locally (or the future desktop `.exe`). Not self-serve in the product.

**Smallest missing path to self-serve:** a Hub route that accepts an `.L5X`/CSV upload, invokes the (merged) parser, and renders the report — then (next) writes `ai_suggestions` for review.

---

## Existing Evaluation / Training / Golden Dataset Support

- **No model training / fine-tuning anywhere in the repo.** Everything is retrieval + prompt + deterministic rules (confirmed by both survey and the i3X strategy doc's validation checklist).
- **Diagnostic-engine eval (merged):** golden CSVs (`tests/golden_factorylm.csv`, `golden_hybrid.csv`, `golden_gs11_conveyor.csv`, staging benchmarks) + `mira-bots/benchmarks/deepeval_suite.py` (DeepEval, Groq judge, ≥0.85 gate) + the 5-regime framework + the beta gate (CI-enforced as of 2026-06-17, commit `5747e79`).
- **PLC-parser eval (merged):** 31 **unit tests** + 2 fixtures. This is **rule/test-fixture coverage**, NOT a golden extraction dataset and NOT confidence-calibrated against labeled ground truth. There is no labeled corpus of "L5X → expected equipment/UNS" pairs.

**Framing for "training itself on PLC programs":** the right framing is **(c) rule/test-fixture expansion + (e) a supervised, human-approved extraction dataset**, *not* (a) model fine-tuning. The product loop is: parse deterministically → propose with confidence → human approves in `/proposals` → approved set becomes the labeled corpus that hardens the rules. That approval→corpus loop is **not built**; the approval surface (`ai_suggestions`, `/proposals`) exists but the parser does not write to it.

---

## Relationship to the Ignition Tag-Mapping Teacher

- **Overlap (reused):** both use the dual-Py vendor-agnostic CSV engine (`tag_csv.py`); both target the same VFD-Analyzer **signal-role** vocabulary; both ultimately want rows in `ai_suggestions`/`kg_entities` for human approval.
- **Divergence:** the Ignition teacher reads **live tags** and is **merged + bench-verified** (SetupWizard Connect→Verify→Map→Save, `Saved 7 role(s)` live; PR #2074 adds classifier→propose→approve→enrich). The PLC Program Teacher reads **offline logic files** and is **merged only at the extraction layer**; its propose/approve/serve glue is open (#2068) and unwired.
- **Where the offline teacher stops today:** at a local report file. It never reaches the Hub, the KG, the proposals queue, or i3X.

---

## Gap Analysis

### P0 — required for a first useful demo (offline L5X → visible MIRA context)
1. **Hub upload + parse route.** `POST /api/connectors/plc/import` (or a `mira-mcp` tool) that accepts `.L5X`/tag-CSV, invokes the merged parser, returns the report JSON. *(no current HTTP surface — parser imported by nothing)*
   - Files: `mira-hub/src/app/api/connectors/plc/import/route.ts` (new); a thin Python invoker or port; reuse `mira-plc-parser/`.
2. **Parser IR → `ai_suggestions` writer.** Map asset/VFD/fault candidates to proposals (types: `kg_entity`, `tag_mapping`, `kg_edge`) with evidence + confidence, status `proposed`. *(this is the heart of #2068's UNS layer — land it)*
   - Files: a new `analyze → proposals` adapter; `mira-crawler/ingest/kg_writer.py`; `ai_suggestions` schema.
3. **Proposals review renders PLC-derived suggestions** in the existing Hub `/proposals` UI. *(surface only; approval already exists)*

### P1 — required for a reliable customer workflow
4. **Structured Text parser** (`.st`/`.stf`/`.iecst`) — unblocks Micro800/CCW, CODESYS, OpenPLC (detected-not-parsed today). The bench is itself Micro820/ST, so this is high-value.
5. **PLCopen XML parser** — CODESYS/AutomationDirect/OpenPLC interchange.
6. **UNS proposal correctness** — deterministic equipment-hierarchy inference from tag naming + logic usage, with a labeled golden dataset (not just unit tests) and confidence calibration.
7. **Tenant scoping + approval transitions** for PLC-derived rows (ADR-0017 `proposal_transition` helpers; `is_private` on any chunks).
8. **i3X exposure of approved PLC context** — already automatic once approved rows land in `kg_entities` verified (the merged i3X server reads them); add a golden projection test for a PLC-derived asset.

### P2 — required for a scalable product
9. **Siemens TIA Openness XML** parser.
10. **External i3X reconcile in-product** (land #2068's `i3x_client.py` reconcile as a Hub action, not just a CLI).
11. **Deeper logic analysis:** permissives, interlock graphs, sequencer states, timer→fault chains, cross-signal dependency edges (`kg_relationships` proposals).
12. **Supervised extraction corpus + regression gate** (approved extractions become labeled fixtures; CI gate like the DeepEval/beta gates).
13. **OCR/PDF fallback** for scanned ladder prints (declared roadmap Phase 7, low confidence).

---

## Recommended MVP

**"Upload an L5X in the Hub, get a reviewed equipment/signal proposal set, see it served over i3X after approval."** This proves the full offline chain end-to-end using **only merged extraction + a thin glue layer**, and it reuses the already-merged i3X server and `/proposals` approval surface.

Concretely: P0 #1–#3 (upload→parse→propose→review) + P1 #8 (i3X projection test for the approved asset). Everything else (ST/PLCopen/Siemens parsers, deeper analysis) is deferred.

---

## Recommended PR Plan (small PRs, in order)

> Constraint honored: this report is docs-only. The PRs below are **proposals**, not changes made here.

**PR-A — Parser packaging + import seam (no behavior change).**
- Objective: make the merged parser callable from the platform (today it's imported by nothing).
- Files: `mira-plc-parser/pyproject.toml` (confirm console entry), a small `mira-plc-parser/mira_plc_parser/api.py` exposing `analyze_path()->dict`; unit test that the JSON report is stable.
- Tests: extend `mira-plc-parser/tests/` with a golden report snapshot of `conveyor.L5X`.
- Acceptance: `from mira_plc_parser.api import analyze_path` returns the report dict; 31→~34 tests green; ruff clean.
- Risks: low (additive). Not-yet: no HTTP, no DB.

**PR-B — Hub PLC import route (parse + render, no DB writes).**
- Objective: `POST /api/connectors/plc/import` accepts `.L5X`/tag-CSV, runs the parser, returns report JSON; a read-only Hub page renders it.
- Files: `mira-hub/src/app/api/connectors/plc/import/route.ts`; a viewer page; invoke parser (port a minimal L5X read to TS, **or** shell to the Python CLI in the ingest sidecar — decide first, don't build both).
- Tests: route unit test with the fixture; tenant-auth test; reject `.ACD` with export guidance (mirror exit-3).
- Acceptance: upload fixture → report renders; binary project → export guidance; non-tenant → 401.
- Risks: file-type validation, large-file bounds. Not-yet: no proposals written.

**PR-C — IR → `ai_suggestions` proposals (this is #2068's UNS layer, landed cleanly).**
- Objective: write asset/VFD/fault candidates as `proposed` `ai_suggestions` with evidence + confidence; surface in `/proposals`.
- Files: new `analyze→proposals` adapter; `mira-crawler/ingest/kg_writer.py`; reuse ADR-0017 transition helpers; `is_private` discipline if any chunk lands.
- Tests: proposal-shape unit tests; "no auto-verify" guard; `/proposals` e2e shows PLC-derived rows.
- Acceptance: fixture import → N proposals pending, all `proposed`, none `verified`; approve one → `kg_entities` verified row with `uns_path`.
- Risks: UNS path correctness, tenant typing (`mira-hub-migrations` rule), pollution if confidence is weak — propose, never auto-verify.

**PR-D — i3X projection proof for a PLC-derived asset.**
- Objective: golden test that an approved PLC-derived asset appears via `/api/i3x/v1/objects` + `/value`.
- Files: `mira-hub/.../i3x/v1/__tests__/` golden projection case.
- Acceptance: approved asset → correct `ObjectInstance` + VQT; unapproved → invisible.
- Risks: low. Not-yet: subscriptions, writes.

**PR-E (P1) — Structured Text parser** (then PLCopen, then Siemens) against the same IR; expand fixtures into a small eval corpus.

**Housekeeping:** reconcile **PR #2062** against the merged #2065 parser (close if superseded); rebase **PR #2068** onto current `main` and split it into PR-C/PR-D-shaped pieces if review wants smaller diffs.

---

## Risks and Non-Goals

- **Read-only / no PLC writes — non-negotiable** (`.claude/rules/fieldbus-readonly.md`, train-before-deploy). The parser is read-only by construction; keep every PLC surface read-only. No customer-shipped fieldbus socket.
- **Never auto-verify** PLC-derived KG edges (`knowledge-graph-proposer` doctrine). Everything is `proposed` until a human approves.
- **i3X stays read-only** and serves only `verified` content (`approval_state='verified'`, `update.*=false`). Do not chase write-conformance.
- **Tenant typing + RLS** on any new Hub table/route (`.claude/rules/mira-hub-migrations.md`).
- **Don't over-model.** Keep the IR and ObjectType registry minimal (Karpathy simplicity).
- **Non-goals:** vendor-to-vendor translation, ladder↔ST round-trip, safety *validation* (we *flag* for review, never certify), parsing closed binary projects directly (require export), and any model fine-tuning.

---

## Final Verdict

- **Can we currently ingest a real PLC program and extract useful maintenance context?**
  **YES — merged on `main`** for Rockwell **L5X** (full logic) and vendor **tag CSV**, offline/deterministic, with fault/asset/VFD/safety candidates and provenance. Structured Text / PLCopen / Siemens are detected but **not parsed yet**; binary projects are rejected with export guidance.
- **Can we currently convert that context into a UNS?**
  **NO (not from PLC files).** The merged parser emits no UNS and is wired to nothing. UNS building exists, but only from chat-resolved context / the onboarding wizard. The PLC→UNS proposal layer is **open PR #2068**, unmerged.
- **Can we currently expose that context through i3X?**
  **NO (not for PLC-derived context).** MIRA's i3X v1 **read** API is merged and live, but it projects the **verified KG** — and nothing routes PLC-file output into the KG yet.
- **Can a customer do this self-serve today?**
  **NO.** There is no upload endpoint for PLC program files; the parser is a developer CLI / future desktop `.exe`.
- **What is the smallest next step to make a convincing demo?**
  Land **PR-A → PR-C** above: a Hub route that accepts an `.L5X`, runs the **already-merged** parser, and writes reviewable `ai_suggestions`. With the merged i3X server and `/proposals` approval already in place, that yields the full offline chain **L5X → extract → propose → approve → served over i3X** — the moat demo — without building any new parser format.

---

## Appendix — PR / branch ledger (as of 2026-06-17)

| PR | Title | State | Relevance |
|---|---|---|---|
| **#2065** | VFD Analyzer wizard + **PLC Parser Phase 1** | ✅ **MERGED** 2026-06-17 | Landed `mira-plc-parser/` (L5X+CSV, IR, analyze, CLI) on `main` |
| **#2062** | PLC Parser Phase 1 — offline CLI | 🟡 OPEN | Parallel parser PR; overlaps #2065 — reconcile/close |
| **#2068** | PLC → UNS / i3X Namespace Builder (+ desktop GUI) | 🟡 OPEN (stacked on #2065) | The missing PLC→UNS/i3X mapping + reconcile client |
| **#2074** | Ignition tag-mapper complete (Phases 1–4) | 🟡 OPEN | The **live** tag teacher (classifier→propose→approve→enrich) |
| **#1709** | Phase 6 direct_connection UNS gate | 🟡 OPEN (draft) | Live Ignition chat gate; not the offline path |
| i3X v1 read API | `mira-hub/src/app/api/i3x/v1/*` | ✅ MERGED | Serves verified `kg_entities` as i3X objects (read-only) |
