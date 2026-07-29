# Gold-Standard Comparison Set — CV-101 print package grading

The measuring sticks for the V2→V3 grading campaign. Local-first: the repo already curates a
verified gold-standard catalog (`docs/reference/electrical_print_examples.md`, 9 categories with
resolving URLs + a per-sheet emulation map) and a standards pack
(`docs/references/industrial-wiring-diagram-standards.md`). Reviewers judge against THESE — do
not substitute taste for the catalog. Where a URL fetch fails, the catalog's per-source
"what makes it human-readable / pattern to copy" descriptions are the authoritative criteria.

## A. OEM manuals present locally (primary authorities)

| Source | Where | Gold-standard content |
|---|---|---|
| AutomationDirect **DURApulse GS10 User Manual** (1st Ed Rev B) | `C:\Users\hharp\Documents\CCW\MIRA_PLC\docs\vfd\GS10_UM.pdf` (+ `.txt` twin for grep) | Ch.2 "Installation and Wiring": main-circuit vs control-circuit separation, Full I/O Wiring Diagram, verbatim terminal designations (`R/L1,S/L2,T/L3`/`U/T1,V/T2,W/T3`, `+1/+2`,`B1/B2`,`DC+/DC-`, `DI1..DI5`,`DCM`,`R1O/R1C/R1`, RJ45 `SG+/SG-/SGND`), grounding + RFI-jumper doctrine. THE canonical model for E-003's power presentation (catalog entry 4a). |
| Rockwell **Micro820 Installation Instructions 2080-IN009** | URL in catalog entries 2b/3a (fetch if network allows) | Input/output terminal wiring grammar for the exact bench PLC: real `I-00…I-11`/`O-00…O-06` + commons, loads grouped per common bank. Model for E-005/E-006 I/O presentation. |

## B. Recovered bench prior art (the style ancestors)

| Source | Where | Virtue to grade against |
|---|---|---|
| `Conv_Simple_CommsToVFD.pdf` §2 | `CCW\MIRA_PLC\docs\instructions\` | Narrow scope, device-to-device wiring with terminal TABLE (`PLC terminal / Label / Wire / GS10 terminal`), "why this step" notes, troubleshooting block. Direct ancestor of the sheets' CONNECTION TABLE. |
| `Conv_Simple_ControlsToVFD.pdf` | same dir | Sectioned runbook clarity; "Read this before downloading" honesty callout (ancestor of the red caveat boxes). CAUTION: contains documented-superseded values (Channel 0; REV+RUN=20 — corrected to Channel 2 / 34 by PhaseB V1.4 "FIX 2" + Beginner_Verify + WI Table 9). Grade sheets on ACKNOWLEDGING supersessions, not on matching this doc's stale values. |
| `MIRA_PLC_WorkInstruction_v3.pdf` (MIRA-WI-001 Rev A) | same dir | Controlled-document discipline: issue date, verified-config tables, LOTO §2, safety-regression steps. |

## C. Catalog-verified external gold standards (fetch-optional)

From `docs/reference/electrical_print_examples.md` (each entry lists URL + what-to-copy):
- **2a/2c** AutomationDirect + DirectLOGIC input-loop & bank-common patterns → E-005 grammar.
- **3a/3b** Micro820 2080-IN009 outputs + DirectLOGIC fused-output pattern → E-006 grammar
  (per-bank fuse callouts are the aspirational bit V2 lacks — grade as improvement, not HF).
- **4a/4b** GS10 Ch.2 + Honeywell SmartVFD power ordering → E-003 grammar.
- **5a/5b/5c** Rockwell 1606 + E-T-A distribution → E-004 (future sheet; context only).
- **8c** suffixed relay/contact tags → device-tag discipline.

## D. Standards pack (drawing-practice law)

- `docs/references/industrial-wiring-diagram-standards.md` — NFPA 79 / UL 508A / NEMA / IEC
  61082+60617 / ISA-5.1 summaries as adopted by this repo.
- Repo style law: `docs/reference/excalidraw_electrical_print_style.md` (hard rules §2, sheet
  taxonomy §3, acceptance test §6, safety §7).

## E. Explicit anti-model

- `plc/conv_simple_wiring_diagram.pdf` (the July-3 device-map "workbench" drawing) — the REJECTED
  regression: one giant page, color-as-meaning, generic labels, no terminals/wire numbers/title
  block. Any V3 drift back toward it is an automatic category-2/4/5 collapse.
