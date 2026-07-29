# Electrical-Print Tooling — Reuse / Salvage Audit

**Date:** 2026-07-02. **Type:** read-only reuse audit — *no code built*. **Rule honored:** old diagrams / IO tables
are treated as **candidate historical evidence only**; the cited CV-101 photo evidence
(`docs/onboarding/cv-101-evidence/`) is authoritative wherever they disagree.

**Method:** four parallel per-repo audits + direct verification of the headline finding. Repos inspected:
`MIRA` (local), `factorylm-conveyor-demo`, `ladder-logic-editor`, `openclaw`, `MIRA_PLC` (all shallow-cloned).

> **Headline:** we do **not** need to build a print compiler from scratch. FactoryLM already owns one —
> **`openclaw/openclaw/diagram/`** — MIT, pure-Python, ~1,600 LOC, a real electrical IR + IEC-60617 symbol
> library + auto-layout/wire-router + SVG renderer. **Verified present and clean.** The smallest path is to
> lift it and feed it a `DiagramSpec` built from the **cited CV-101 evidence** (not from an LLM guess).

---

## 1. Reusable code

| Asset | Repo / path | License | Lang | Verdict |
|---|---|---|---|---|
| **`diagram/` engine** — `schema.py`(110) + `symbols.py`(663) + `layout.py`(289) + `renderer.py`(453) + `style.py`(85) = **1,606 LOC** | `openclaw/openclaw/diagram/` | **MIT** (FactoryLM) | Python | ⭐ **COPY** — verified: deps = `pydantic` only; no Anthropic/LangChain/TF; `render_svg()→str` is dependency-free. |
| **`print_worker.py`** — live photo-print Q&A worker w/ anti-hallucination prompt; wired at `engine.py:114,768,2405` | `MIRA/mira-bots/shared/workers/print_worker.py` | first-party | Python | **COPY** — already shipped & routed; reuse for "ask about the print" follow-ups. |
| **`_analyze_schematic_with_question`** — vision+OCR multipart, OCR fallback | `MIRA/mira-bots/shared/engine.py:883-917` | first-party | Python | **REUSE** for chat-photo schematic Q&A. |
| `WiringDiagram.tsx` (device/terminal/wire SVG auto-place) · `PrintRungSvg.tsx` (grid + bus-line routing) | `ladder-logic-editor/src/components/…` | **MIT** | **TS/React** | **ADAPT — JS only.** Not liftable into the Python engine; use only if a JS front end renders prints. |

## 2. Reusable schemas / IRs

| IR / schema | Where | Notes |
|---|---|---|
| ⭐ **`DiagramSpec`** (`Terminal`, `Ratings`, `Component`, `Connection`, `Bus`, `LayoutHints`) — Pydantic | `openclaw/openclaw/diagram/schema.py` | **Verified.** A real electrical print IR (components + terminals + nets + buses). **This is our IR** — no need to design one. |
| **`variable-manifest.json`** schema `{name, alias, direction, modbusAddress, terminalLabel, sourceDevice, gaps[]}` | `MIRA_PLC` (`Conv_Simple_QuickStart.html` §5.1) | Commissioning manifest with **explicit `gaps[]`** — matches MIRA's "mark unknown, don't invent" rule. Liftable as the evidence→spec bridge. |
| `VariableDeclaration` / `VariableManifest` / `ManifestGap` (TS) | `ladder-logic-editor/src/models/plc-types.ts` | Same vocabulary (terminalLabel, sourceDevice, modbusAddress, gap-tracking). Design reference; TS, so pattern-only. |
| MIRA has **no** print IR of its own | — | `vision_data{ocr_items[], drawing_type}` is a flat OCR string list, not a wire/terminal model. Confirms the IR must come from openclaw, not MIRA. |

## 3. Reusable rendering / layout

| Asset | Where | Verdict |
|---|---|---|
| ⭐ `layout.py` (`compute_layout` + `route_wires` + bus bars) + `renderer.py` (`WiringRenderer` SVG) + `symbols.py` (20 IEC-60617 symbols: motor 3ph/1ph, contactor, overload, breaker, fuse, PB NO/NC, e-stop, terminal block, PLC I/O card, VFD, transformer, prox, relays) | `openclaw/openclaw/diagram/` | **COPY.** Complete render/layout. Use `render_svg()` (pure) + rasterize/PDF via **`fitz`** (already installed) to **avoid `cairosvg`** (LGPL — fails MIRA's MIT/Apache-only rule). |
| Column/row **grid** layout + first/last-node edge stitching + vertical **bus-line routing** | `ladder-logic-editor/src/transformer/layout/{rung-layout,diagram-layout}.ts` | **IDEA reference** (TS). Confirms grid (not force-directed) is the right approach; openclaw already implements the equivalent in Python. |
| HTML print-CSS work-instruction template (`@page Letter`, callouts) | `MIRA_PLC/docs/instructions/*.html` | **ADAPT** if we want an HTML→PDF work-instruction wrapper — but **re-skin to `--fl-*` tokens** (`.claude/rules/ui-style.md`); it hardcodes hex. |
| `vfd_diagram.svg`, `vfd_motor_schematic.svg` | `factorylm-conveyor-demo/` | **IGNORE.** Flattened matplotlib **glyph-path** SVGs — 0 `<text>` nodes, no semantic terminal/wire data. Useless as a rendering reference. |
| `drawings/*.d2` (D2 diagram-as-code) + `ezdxf`→layered-DXF pattern | `factorylm-conveyor-demo/` | **Template pattern only** (re-author content); generator scripts were never committed. |

## 4. Reusable prompts

| Prompt | Where | Use |
|---|---|---|
| **`SPEC_SCHEMA_PROMPT`** — strict JSON `DiagramSpec` contract + 7 wiring rules; **`MICRO820_IO_REFERENCE`** baked-in I/O map | `openclaw/openclaw/skills/builtin/diagram.py` | **ADAPT** — spec-*generation* prompt. ⚠️ Its baked-in Micro820 I/O map is a *legacy assumption* — must be replaced with CV-101 evidence, not trusted (see §7). |
| **`V3 pdfgen.txt`** — 11-section enrichment prompt with "do not invent citations… mark SOURCE NEEDED" | `MIRA_PLC/docs/instructions/V3 pdfgen.txt` | **COPY** — print-*extraction/enrichment* prompt; already matches MIRA grounding doctrine. |
| **`ELECTRICAL_PRINT_PROMPT`** — "base ALL answers ONLY on OCR / I cannot see that in the drawing" | `MIRA/mira-bots/shared/workers/print_worker.py:11-44` | **COPY** — the shipped anti-hallucination Q&A prompt. |
| `messages/intent.py` DIAGRAM classifier (`wiring|diagram|schematic|blueprint|circuit`) | `openclaw` | **ADAPT** keyword set only; MIRA has its own classifier. |

## 5. Reusable tests

| Test | Where | Verdict |
|---|---|---|
| `test_schematic_qa.py` (+ `SCHEMATIC_VISION_DATA` fixture) | `MIRA/tests/` | **COPY** — covers the vision-cascade path. |
| `test_fsm_states.py`, `test_multi_photo.py`, `regime3_nameplate/test_classification.py` (reference `ELECTRICAL_PRINT`) | `MIRA/tests/` | **REUSE** for regression. |
| ⚠️ **openclaw `diagram/` has NO tests** (only `test_intent.py`, `test_config.py`) | `openclaw` | **GAP to fill on lift** — the engine is untested; add tests when we copy it. |
| ladder-editor `*.test.ts`, Playwright, fast-check | `ladder-logic-editor` | Pattern reference only (TS, ladder-specific). |

## 6. Reusable demo artifacts

| Artifact | Where | Verdict |
|---|---|---|
| **CV-101 evidence pack** (`wiring_evidence.md`, `cv101_electrical_print.md`, `cv101_evidence_reconciliation.md`) | `MIRA/docs/onboarding/cv-101-evidence/` | ⭐ **The real input** — cited, current, photo-grounded. The `DiagramSpec` gets built from this. |
| `MbSrvConf_import.csv` (Micro820 Modbus coil/reg map), `.st` programs (GS10 cmd-word `34=0x22`) | `MIRA_PLC/drive_test/`, `docs/instructions/` | **Candidate reference** — cross-check vs CV-101, don't adopt blind. |
| HTML/PDF work-instructions | `MIRA_PLC/docs/instructions/` | Template + content reference. |
| DXF/SVG/BOM/BUILD-GUIDE | `factorylm-conveyor-demo/` | **Historical only** — wrong bench (see §7). |

## 7. Conflicts with current CV-101 evidence — **DOCUMENTED, NOT RESOLVED**

> **The meta-finding:** there are **four** legacy I/O maps for "the Micro820 conveyor" and **they disagree with each
> other *and* with CV-101.** That inconsistency is itself the strongest argument for the "mark UNKNOWN, inherit
> nothing" discipline. None of the four may be promoted to CV-101 ground truth without a confirming photo.

**Output loads (the task's flagged conflict):**
- `MIRA/docs/legacy/IO_Table.md:31-42` claims **known**: O-00=Green pilot, O-01=Red pilot, **O-02=Contactor Q1 coil**, O-03=RUN LED; O-04/05/06 spare.
- `MIRA_PLC` claims **DO-00=motor contactor, DO-01=fault_lamp, DO-07=heartbeat LED**.
- **CV-101** (`wiring_evidence.md:107-118`, `cv101_electrical_print.md:139-150`): **all O-0x loads UNKNOWN** — "not established by any photo."
- → **OPEN ITEM.** Two legacy sources even disagree on which output is the contactor (O-02 vs DO-00). Do not resolve without a labeled photo.

**Input I-05 (the task's flagged conflict):**
- `IO_Table.md:17` says **I-05 = spare**.
- **CV-101** (`wiring_evidence.md:97`) says **I-05 wired, likely photo-eye, NOT label-confirmed**.
- → **OPEN ITEM.** Do not resolve without a photo.

**Inputs I-00 / I-01 (new conflict surfaced by the audit):**
- **CV-101:** I-00 = **FWD**, I-01 = **REV** (3-position FWD-OFF-REV selector), I-04 = **START** (NO PB).
- `MIRA_PLC`: DI-00 = **estop_a**, DI-01 = **estop_b** (dual-channel E-stop; `e_stop_ok := DI_00 AND DI_01`).
- `factorylm-conveyor-demo`: DI00 = Start PB, DI01 = Stop-NC, DI02 = E-Stop — a *third* scheme (Start/Stop PBs, not a selector).
- → **OPEN ITEM.** Three different input maps. CV-101 photo wins; the others are candidate evidence.

**Device identity (conveyor-demo, wholesale mismatch — treat as a different machine):**
- VFD **GS1 (`GS11N-20P5`)** vs CV-101 **GS10**; **hardwired FWD/REV + 0-10V analog** control vs CV-101 **RS-485 Modbus** (`P00.20=5`); PLC **`2080-LC30-48QWB`** vs CV-101 **`2080-LC20-20QBB`**; motor **1800 rpm / 2.4 A** vs CV-101 **1725 rpm / 3.8 A**; Dorner gearbox not on CV-101. → **IGNORE its electrical content entirely.**

**PLC identity / one-vs-two-PLC (bonus):**
- `IO_Table.md:56` MAC **`5C:88:16:D8:E4:D7`** *corroborates the CV-101 front-label reading* (`…E4:D7`), which differs from the CV-101 nameplate MAC (`…D9:75:DC`). → Feeds the still-open "one PLC or two" question (`cv101_evidence_reconciliation.md`). Note only.

**Firmware:** `IO_Table`/legacy vs CV-101 nameplate **FW 12.011** vs repo CIP **rev 14.11** — cosmetic, already logged.

## 8. What should be copied directly
1. **`openclaw/openclaw/diagram/`** (all 5 modules) → new MIRA module. Render via `render_svg()`; PDF/PNG via `fitz` (skip `cairosvg`).
2. `MIRA/mira-bots/shared/workers/print_worker.py` + `ELECTRICAL_PRINT_PROMPT` (already in-tree — keep).
3. `MIRA/tests/test_schematic_qa.py` + fixtures.
4. `MIRA_PLC` **`variable-manifest.json` schema** (the evidence→spec bridge) + **`V3 pdfgen.txt`** enrichment prompt.
5. FSM `ELECTRICAL_PRINT` state + sticky transition (`fsm.py:44,146-149`) — already in-tree, keep.

## 9. What should be adapted
1. **`SPEC_SCHEMA_PROMPT`** (openclaw) → retarget to emit a `DiagramSpec` **from the cited CV-101 evidence**, marking unknown loads as **gaps**, not inventing them. **Replace its baked-in `MICRO820_IO_REFERENCE`** with CV-101 facts.
2. **`style.py`** + MIRA_PLC HTML template → re-skin to `--fl-*` design tokens (`.claude/rules/ui-style.md`).
3. **Add tests** to the lifted `diagram/` engine (it ships with none).
4. `print_worker.py` OWUI call → Groq→Cerebras→Together cascade (ADR-0015).
5. ladder-editor grid/bus-routing algorithm → reference only, and only if a JS front end is later built.

## 10. What should be ignored
- `factorylm-conveyor-demo` **electrical content** (wrong drive/control/PLC/motor/IO), its matplotlib glyph-path SVGs, committed DXF content, `upload_to_imgur.py`, wood-frame/Dorner/BOM prose. (No LICENSE — proprietary; irrelevant since we're ignoring it.)
- openclaw **`llm/providers/anthropic.py`** + the `anthropic` dep (PR #610 ban). The diagram engine has **no** provider dependency, so this is not an obstacle.
- ladder-editor React-Flow node components, CodeMirror ST editor, Lezer grammar, `ir-to-react-flow.ts` glue (ladder-specific / TS UI).
- PRD Phase B/C: YOLOv8 symbol detection, Mermaid auto-topology, PDF-print ingest — never built.
- **`glm-ocr`** as an OCR dependency — license unverified **and it is currently returning HTTP 400 in prod** (observed 2026-07-02 during the Telegram photo test). MIRA already runs `qwen2.5vl:7b`; prefer it.
- Legacy I/O maps (`IO_Table.md`, MIRA_PLC, conveyor-demo, openclaw's baked-in ref) as **ground truth** — candidate evidence only (§7).

---

## Smallest reuse-first implementation plan (proposal — do NOT start until approved)

**The build is mostly a *lift*, not a *write*.** openclaw already provides the IR + symbols + layout + SVG renderer.

- **Phase 0 — Audit.** ✅ this document.
- **Phase 1 — Lift the engine (small, no behavior change).** Copy `openclaw/openclaw/diagram/` into a MIRA module
  (proposed `mira-bots/shared/print/` or a new `mira-plc-parser/print/`). Swap the PNG path to `fitz` (drop
  `cairosvg`). Add the missing unit tests (round-trip a `DiagramSpec` → SVG, assert symbols/terminals/wires present).
  Keep the MIT attribution. **Deliverable:** `render_from_json(spec)` produces an IEC SVG/PDF in MIRA, green tests.
- **Phase 2 — CV-101 spec from cited evidence (the first real print).** Hand-author a `DiagramSpec` for CV-101
  **from `wiring_evidence.md`** — motor (1 HP, 230/460 V, FLA 3.8 A, 1725 rpm), Micro820, GS10, operator station,
  RS-485 link, confirmed inputs (FWD=I-00, REV=I-01, START=I-04). **UNKNOWN loads / power terminals → `gaps[]`,
  drawn as unpopulated stubs, never invented.** Render → the first real IEC print. Replaces the ASCII one-line in
  `cv101_electrical_print.md`. **Deliverable:** `cv101_print.svg/pdf`, gaps visibly marked.
- **Phase 3 — (later, gated) auto-spec from photos.** Wire the adapted `SPEC_SCHEMA_PROMPT` so MIRA emits a
  `DiagramSpec` from OCR'd nameplate/terminal text, reusing the `ELECTRICAL_PRINT` FSM + `print_worker` for
  follow-up Q&A. **Gated on:** (a) the `glm-ocr` 400 fix or a switch to `qwen2.5vl`, (b) the no-invention/gap
  discipline, (c) resolving the §7 I/O conflicts with real photos — not legacy maps.

**Not building the print compiler yet.** This is the audit + proposal only.

---

## Cross-references
- `docs/onboarding/cv-101-evidence/` — the authoritative CV-101 evidence pack (wins all conflicts).
- `openclaw/openclaw/diagram/` (MIT, FactoryLM) — the engine to lift.
- `MIRA/mira-bots/shared/workers/print_worker.py`, `fsm.py:44` — the in-tree print state + worker.
- `MIRA/docs/legacy/{PRD-electrical-print-intelligence.md, IO_Table.md}` — legacy spec + the conflicting I/O table.
- `MIRA_PLC` — `variable-manifest.json` schema + `V3 pdfgen.txt` prompt + HTML print templates.
- `ladder-logic-editor` (MIT, TS) — grid/bus-routing layout ideas for a future JS front end.
