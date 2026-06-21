# RESUME — VFD Analyzer wizard (live-walk blocked) + MIRA PLC Parser (Phase 1 done)

**Date:** 2026-06-16 · **Branch:** `feat/vfd-analyzer-auto-map` (NOT yet PR'd) · paste-to-resume after a context clear.

This session produced two parallel threads. Read this, then the linked memories/specs, then continue.
Memories: `[[project_vfd_analyzer_auto_map]]`, `[[project_mira_plc_parser]]`,
`[[reference_plc_open_export_not_closed_project]]`.

---

## THREAD A — VFD Analyzer Setup Wizard (Ignition, gateway) — BLOCKED on a live-walk

### Where it is
A 4-step **Connect → Verify → Map → Save** wizard for mapping a customer's VFD tags to analyzer
signal roles, in the **`testing` sandbox** Perspective project. Built as **4 separate full-frame
views** (the earlier single-view version crammed all steps onto one screen — see `badui.PNG`):
`WizardConnect` (`/`,`/setup`), `WizardVerify` (`/verify`), `WizardMap` (`/map`), `WizardSave`
(`/save`); old single-screen `TagMapper` kept at `/mapper` as a fallback. Backend logic in
`plc/ignition-project/ConvSimpleLive/ignition/script-python/mira_setup/code.py` (synced into the
sandbox by `DEPLOY_TESTING.ps1`).

### The blocker (do this FIRST)
The wizard renders well and navigation works, BUT cross-page state failed twice in live Playwright
walks: navigate-params didn't populate view.params, then session.custom writes didn't survive a page
nav. **Current fix (commit `a2e52307`, UNVERIFIED-LIVE):** the chosen folder is persisted in a String
**memory tag** `[default]MIRA/Config/_wizard_folder` (helpers `set_setup_folder`/`get_setup_folder`/
`_ensure_setup_tag`); Connect writes it, Verify/Map read it. assetId/pollMs stay on session.custom
(constant defaults persist fine). Then the **Ignition trial expired**, so the walk never confirmed.

**MORNING STEPS:**
1. Mike runs **elevated** `plc/ignition-project/testing/DEPLOY_TESTING.ps1` (restarts Ignition →
   fresh 2-hour trial AND deploys the `a2e52307` fix).
2. Claude re-walks `http://localhost:8088/data/perspective/client/testing/setup` with Playwright:
   Connect (open `[default]MIRA_IOCheck/VFD` → Use this folder → Next) → **confirm Verify header
   shows the VFD folder and the sample table lists VFD tags, NOT JuiceLine** (that's the bug's
   tell) → Map (slots + Accept-all suggestions) → Save & Finish.
3. If green: nothing to commit (already committed); proceed to the CSV UI wiring below.
   If the folder STILL doesn't carry: the memory-tag read/write is the suspect — verify
   `[default]MIRA/Config/_wizard_folder` exists + holds the path after "Use this folder".

### Next after the walk passes — wire the CSV-import Connect source (gateway-side)
Mike's direction: add a **"Tag-export file (CSV)"** source to the Connect step for the **standalone
Exchange/VFD-Analyzer** product. The pure parser is DONE + tested: `tag_csv.py` (commit `79be9310`,
gateway `ignition/webdev/FactoryLM/api/diagnose/tag_csv.py`, 18 tests, Jython-safe, multi-vendor
auto-detect). Keep the map data model **Hub-compatible** (source/confidence/evidence already match
`ai_suggestions`/`CanonicalTag`). **Do NOT build the Hub LLM classifier in this branch.** The CSV
source rides the same cross-page mechanism — that's why it was sequenced after the walk.

### Reference
Static mockups of all 4 pages + the CSV source were rendered + sent to Mike (scratch, not committed).
Full design rationale: `docs/research/2026-06-15_vfd-analyzer-mapping-ux-study.{pdf,md}` (committed).

---

## THREAD B — MIRA PLC Parser (new project) — Phase 1 DONE + committed

### What it is
`mira-plc-parser/` — a **read-only, vendor-agnostic** pipeline that parses PLC program EXPORTS into
ONE **MIRA PLC IR** and extracts maintenance intelligence. Mike's order: **parser → normalizer →
analysis → eval → translation-later**. NOT a PLC writer; NO vendor-to-vendor translation; NO safety
validation. Commits `a23c3cba` (Phase 1) + `13ded6ce` (closed-project detection). 31 tests, ruff clean.

### Built (Phase 1)
`detect.py` (content-first format detector + closed-project `needs_export` guidance) →
`parsers/rockwell_l5x.py` (L5X → IR) + `parsers/csv_tags.py` (reuses gateway `tag_csv.py`) →
`ir.py` (the IR: Controller/Program/Routine/Rung/Tag + Provenance + Confidence high/med/low/**review**)
→ `analyze.py` (deterministic: tag dictionary + usage xref, routine summaries, **output-dependency
map**, fault candidates, asset candidates, **VFD-signal candidates → feeds the VFD-Analyzer auto-map**,
safety **review** flags) → `pipeline.py` run()+render_markdown(). README + pyproject.

### Doctrine baked in
`.ACD` (Rockwell binary project) → we say "export to L5X", not "great", not "unknown". Same for
Siemens TIA project (→ Openness XML), CODESYS `.project` (→ PLCopen XML), archives (→ unpack). See
`[[reference_plc_open_export_not_closed_project]]`.

### Next phases (Mike's roadmap, in order)
1. **Eval dataset** — public + synthetic L5X / OpenPLC / PLCopen XML / ST samples (the repo already
   has an `OpenPLC/` upload, untracked — a source of fixtures).
2. **IR hardening** — the schema is the asset; grow it as formats arrive.
3. **Deeper analysis** — timer→fault chains, permissives/interlocks, sequence/state extraction;
   camelCase name tokenization (current `_kw()` is letter-boundary only, misses "FaultRoutine").
4. **PLCopen XML + Structured Text** parsers (ST = the reasoning bridge).
5. **Siemens** via TIA Openness XML exports (never closed project files).
6. **PDF / screenshot** OCR fallback — last, low confidence.
7. (Strategic, separate) the **Hub LLM classifier** (`tag_classifier.py`) that the 2026-06-15
   readiness report scoped — the deterministic analysis here is the foundation it explains.

---

## Verify anything
```
python -m pytest mira-plc-parser/tests/ -q          # 31 — the PLC parser
python -m pytest tests/regime7_ignition/ -q          # 86 — gateway (incl. tag_csv 18, diagnose parity)
python -m ruff check mira-plc-parser/                 # clean
```

## Session commit trail (branch feat/vfd-analyzer-auto-map)
`97b3bfa0` matching-game TagMapper + assetId save fix · `ea1eddb1` UX study PDF · `08dd557d` v1
SetupWizard · `2fd7c423` split to 4 full-frame pages · `13be3a58` session.custom (superseded) ·
`a2e52307` **memory-tag folder fix (unverified-live)** · `79be9310` tag_csv CSV parser ·
`a23c3cba` **MIRA PLC Parser Phase 1** · `13ded6ce` **closed-project (.ACD) detection**.

## Housekeeping
Untracked **foreign WIP** to leave alone: `OpenPLC/`, `plc/CCW_VARIABLES_v4.1.9_DELTA.md`.
Branch is unmerged — no PR opened yet (open one when Thread A's walk is green).
