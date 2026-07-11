# Evidence & Hallucination Audit — CV-101 Print Package V3

**Role:** Evidence & Hallucination Auditor (deep-dive categories 1, 11, 12 + ALL hard-fails)
**Scope:** E-001, E-003, E-005, E-006, E-007 (SVG + PNG + PDF each) + `render_sheet.py` + `validate_model.py` + `model/*.yaml` + `review/EVIDENCE_MATRIX.md` + `review/CROSSREF_MATRIX.md` + `review/FIELD_VERIFY_LIST.md`
**Method:** Treated every drawn/stated fact as guilty until traced. Did NOT read `reviewer_*_v2.md` or `GRADES_V2.md` (stayed unanchored per instructions).

---

## 0. Tooling-level verification (before touching content)

### 0.1 `validate_model.py` — independently re-run
```
[PASS] A. Orphan endpoints            [PASS] B. Duplicate terminal ids
[PASS] C. Duplicate wire numbers      [PASS] D. Verified status has source
[PASS] E. E-007 links                 [PASS] F. Drafted sheet coverage
[PASS] G. SVG audit (E-003:15/15 E-005:8/8 E-006:10/10 E-007:4/4)
[PASS] H. Dash construction (>=3 segments)
[PASS] I. Raster parity (PDF vs SVG)  [PASS] J. E-001 schedule parity
[PASS] K. No render-only engineering text
ALL CHECKS PASSED
```

### 0.2 Check K's claim, verified independently (not just trusted)
Ran my own `grep -n "NFPA\|0x20\|P00\.\|P09\.\|8N1\|8N2\|kbps\|LOTO\|REV+RUN\|L17\|L19"` and a second broader pass (`9600|0x2000|0x2001|0x2103|120 ?ohm|38\.4|1\.60|belden|3105|485\+|SGND|modbus`) against `render_sheet.py`. **Zero hits beyond generic protocol-name labels** ("RS-485 / MODBUS RTU COMMUNICATION" titles, `link_y` dict keys `"485+"`/`"485-"`/`"SGND"` which are wire-label identifiers, not smuggled facts). Check K's PASS is genuine for what it screens.

**However** — a manual read of all five render functions found renderer-literal text that check K's specific blocklist does *not* catch, because it targets known-stale values, not the general principle. I traced every instance found to model backing (see §4, Finding F3) — none are HF6 (facts *do* have model backing), but the mechanism (hand-retyped, not loaded) is a structural drift risk check K doesn't defend against.

### 0.3 SVG↔PDF-vector↔PNG-pixel dash semantics — independently re-verified, not trusted from SVG text alone
Wrote a standalone script (`fitz.Document.get_drawings()` for real PDF vector geometry + `PIL` pixel sampling on the actual PNG raster) that treats the SVG's `data-wire`/`data-dashed` attributes as a *claim*, not ground truth, and cross-checks it against:
- PDF: does the wire's bounding region contain ONE long vector line (looks solid) or ≥3 short vector lines with gaps (looks dashed)?
- PNG: sampling 60–80 points along the wire's path, is the pixel pattern continuous ink or alternating ink/gap?

**Result: 0 divergences across all 37 conductor elements on the 4 wired sheets.**
- E-003 (15 wires, all `field_verify`): all 15 confirmed genuinely dashed in PDF vectors AND PNG pixels (sample pattern e.g. `[####...####..####..####...]`).
- E-005 (8 wires, all `field_verify`): all 8 confirmed genuinely dashed.
- E-006 (10 wires, all `field_verify`): all 10 confirmed genuinely dashed.
- E-007 (3 `verified` + 1 `field_verify`): 485+/485-/SGND confirmed genuinely **solid** (continuous PDF vector, 100% PNG ink); SH confirmed genuinely dashed.

This is the strongest possible negative result for HF2 and category 11's "PNG/PDF visually match the SVG's solid/dash semantics" — **zero conductors found to be fake-solid or fake-dashed** at the raster/vector level a human actually receives.

### 0.4 Visual HF5 sweep
Viewed all 5 rendered PNGs at full resolution. No clipped text, no line-struck text, no off-frame content, no cut-off table rows on any sheet. Merged `CV-101_print_set.pdf` re-verified independently: 5 pages, sheet-ID-per-page extraction confirms correct order **E-001, E-003, E-005, E-006, E-007** (matches `sheets.yaml` id order, matches `render_set()`'s intent).

---

## 1. Citation-tracing — the hallucination hunt (per sheet, ≥8 cites each, quoted)

I pulled and grepped the primary sources directly: `GS10_UM.txt` (1.25MB, targeted line ranges), `Prog_init_ConvSimple_v2.1.st`, `CCW_VARIABLES_v4.0.txt`, `LogicalValues.csv`, `GS10_Integration_Guide.md`, `Conv_Simple_Prog_VFD_PhaseB_V1.1.txt` + `V1.4.st`, `Conv_Simple_CommsToVFD.html`, `Conv_Simple_GS10_Beginner_Verify_V2.html`, `MIRA_PLC_WorkInstruction_v3.pdf` (all 28 pages), `GS10_actual_parameters_5.20.26.xlsx` (via openpyxl), and the Ignition `MIRA_IOCheck/Inputs/tags.json` snapshot.

### E-003 (VFD power) — 17 cites checked, all confirmed
| Claim on sheet | Source cited | Verified? |
|---|---|---|
| R/L1,S/L2 = "input power L1/L2" | GS10_UM.txt L1971/1973 | ✅ exact: `"R/L1, S/L2 ... Input Power – phase 1"` / `"R/L1, S/L2, T/L3 Input Power – phase 3"` |
| U/T1,V/T2,W/T3 = "AC Motor Drive Output" | GS10_UM.txt L1975 | ✅ exact: `"U/T1, V/T2, W/T3 AC Motor Drive Output"` |
| +1/+2 = "factory jumper, leave unless reactor installed" | GS10_UM.txt L1824-1826/L1977-8 | ✅ exact: `"From the factory, these terminals are connected with a short-circuit jumper. Remove this jumper before connecting a DC reactor."` |
| B1/B2 = "brake resistor (optional; else OPEN)" | GS10_UM.txt L1842/L1980 | ✅ exact: `"For GS10 drives, the external brake resistor should be connected to the B1 and B2 terminals."` |
| DC+/DC- "absent on 120VAC models" | GS10_UM.txt L1986 | ✅ exact: `"NOTE: 120VAC models do not have DC bus terminals DC-, DC+/+1"` |
| PE "≤0.1Ω" | GS10_UM.txt L1761 | ✅ exact: `"grounded. (Ground resistance should not exceed 0.1.)"` |
| M1 "swap any two motor leads to reverse" | GS10_UM.txt L1773-1776 | ✅ exact |
| "Never start/stop via input power" | GS10_UM.txt L1811-1813 | ✅ exact: `"Do NOT start/stop the GS10 AC drive by turning input power ON/OFF."` |
| "MC is emergency/safety switching only" | GS10_UM.txt L1754-1757 | ✅ exact: `"Do not use a power circuit contactor or disconnect switch for normal run/stop control... only in emergency situations."` |
| "CB1 REQUIRED" | GS10_UM.txt L1758-1759 | ✅ exact: `"Make sure the appropriate protective devices (circuit breaker or fuses) are connected..."` |
| "route power ⊥ control wiring" | GS10_UM.txt L1787 | ✅ exact: `"Route the power and control wires separately, or at 90 degree angle to each other."` |
| "shield/conduit bonded both ends" | GS10_UM.txt L1792-1795 | ✅ exact: `"Ground both ends of the shield wire or conduit..."` |
| P00.01 = 1.60 A | GS10_actual_parameters_5.20.26.xlsx | ✅ exact: `Different Value` tab row `00.01 | Rated Current | ... | Content Value 1.60` |
| Q1 a.k.a. "MLC" in WI-001 | MIRA_PLC_WorkInstruction_v3.pdf | ✅ confirmed — "MLC" used throughout §3 ("Stage 1 MLC drive-enable", "the MLC coil (DO_02)") |
| LOTO "wait ≥5 min" (WI p.2 §2) | MIRA_PLC_WorkInstruction_v3.pdf p.2 | ✅ exact: `"4. Wait five minutes for the GS10 DC bus to discharge."` |
| Q1 coil ← O-02 | CCW_VARIABLES_v4.0.txt + Prog_init v2.1 | ✅ `O-02 _IO_EM_DO_02 ContactorQ1` + `vfd_run_permit := _IO_EM_DO_02 AND e_stop_ok AND NOT pe_latched` |
| "MC placement... assumed line-side" | (reasoned, marked FIELD VERIFY, OI-14) | ✅ honestly hedged, not overclaimed |

### E-005 (PLC inputs) — 8 cites checked, all confirmed
dir_fwd/dir_rev boolean logic verified verbatim against `Prog_init_ConvSimple_v2.1.st` (`dir_fwd := _IO_EM_DI_00 AND NOT _IO_EM_DI_01`); E-stop NC/NO healthy states consistent with WI-001 §2; **S2 "Run pushbutton" → I-04 independently grepped in the actual Ignition tags.json** (`plc/ignition-project/gateway-snapshot/2026-05-30-cip-working/tags/MIRA_IOCheck/Inputs/tags.json:7` → `"documentation": "Embedded DI-04 — Run pushbutton"` — exact match); B1 photo-eye → `pe_latched` logic verbatim in Prog_init; I-06..I-11 spare status matches CCW_VARIABLES I/O map; the I-05 "CCW v4.0 labels 'Entry sensor (spare)', superseded by live Prog_init" claim is a **verified true supersession** (CCW_VARIABLES_v4.0.txt literally says `I-05 _IO_EM_DI_05 "Entry sensor (spare)"` while Prog_init v2.1 makes it `pe_latched`) — correctly flagged, not silently papered over (OI-13 pointer present).

### E-006 (PLC outputs) — 9 cites checked, all confirmed
O-00/O-01/O-03 confirmed against CCW_VARIABLES_v4.0.txt I/O table exactly. **The WI-001 hardwired-fallback non-applicability reasoning was independently re-derived and confirmed correct**: WI-001 §3 Fig 1 genuinely specifies `DO_03..DO_07 → GS10 DI1..DI5 + DCM` (verified verbatim in the PDF); "DO_07 does not exist on the 2080-LC20-20QBB" is a true statement given the model's own `O-00..O-06` (7 outputs, no index 7); "DO_03 collides with PBRunLED" is true (CCW_VARIABLES: `O-03 _IO_EM_DO_03 PBRunLED`). The title-block lineage "O-02 do-not-reuse (WI-001 p.4)" is confirmed verbatim (`"DO_02 is already the MLC drive-enable coil and must never be reused"`, WI-001 p.4). This is the single best example of HF4-carve-out honesty in the whole package — a real, checkable historical-document conflict, correctly adjudicated and dated/sourced on-sheet.

### E-007 (RS-485/Modbus) — 15+ cites checked, all confirmed, several verbatim
This sheet's self-corrections are the most rigorously verifiable content in the package:
- **"SGND pin 1/8 → pin 3"**: `Conv_Simple_CommsToVFD.html:126` (the actual "May-16 draft" ancestor) literally says *`"pin 1 or 8 = SGND... Verify against the GS10 User Manual"`* — i.e. the print's caveat quotes a real, hedged guess from a real prior document, later corrected by `Beginner_Verify_V2.html:78` (`"Drive RJ45 pin for SGND | Pin 3 | GS10 manual p.10"`) and GS10_UM.txt itself (`L1953: "(SG+ Pin5, SG- Pin4, SGND Pin 3,7)"`).
- **"Channel 0 → 2"**: CommsToVFD.html uses "Channel 0" throughout (11+ occurrences); Prog_init v2.1 and PhaseB_V1.4.st both hard-code `Channel := 2` with the comment `"NOT 0; bench-proven 2026-05-26"`.
- **"8N2 → 8N1"**: independently, exactly confirmed via the xlsx export — `Group 9` tab shows `P09.04 Content Value = 13` (=8N2) with **Default Value also 13** (i.e., untouched from factory as of 2026-05-20), and `P09.01 Content = 38.4` = **Default 38.4** — this is a *direct, non-inferential* confirmation of the print's `oi20_note`: `"2026-05-20 export read 38.4k/8N2"`. `Prog_init_ConvSimple_v2.1.st`'s own header comment independently states the later bench-verified values: `"P09.01=96 (9600) P09.04=12 (8N1 RTU)"`.
- **"REV+RUN 34 NOT 20"**: confirmed from **three independent primary sources**: (1) `Conv_Simple_Prog_VFD_PhaseB_V1.4.st` — `"FIX 2: REV+RUN cmd word 20 -> 34. 34 = bit 5 (REV) + bit 1 (Run); 20 was bit 4 (FWD) + bit 2 (reserved) with no Run bit."` (word-for-word match to the sheet's citation text); (2) `Beginner_Verify_V2.html:91` — `"34 = bit 5 + bit 1 = REV(10) + Run(10) (NOT 20!)"` — the literal source of the `('NOT 20!')` quote on the sheet; (3) `MIRA_PLC_WorkInstruction_v3.pdf` Tables 9 & 10 — `"The decimal-20 trap. If you ever see 20 (0x0014) written as REV+RUN, it is a bug... REV lives in bit 5 (2⁵=32), not in bit 4."` My own independent binary check confirms: 34 = 0b100010 = bit1(2)+bit5(32) ✓; 18 = 0b10010 = bit1(2)+bit4(16) ✓ (FWD+RUN, unchanged).
- Registers 0x2000/0x2001 confirmed against Prog_init's actual FC16 write (`write_target_cfg.Addr := 16#2001` with AB's documented -1 wire-offset behavior → wire 0x2000/0x2001) and WI-001 Table 8.
- 120Ω termination "at the drive end" confirmed against GS10_Integration_Guide.md §3 verbatim.

---

## 2. Review-matrix audit (all rows, not just a 10-row sample — matrices were short enough to fully cross-check)

`EVIDENCE_MATRIX.md` and `CROSSREF_MATRIX.md` are marked "generated by `emit_matrices.py` — do not hand-edit." I did **not** trust that label — I cross-checked every row against the live YAML independently:
- E-003 evidence rows (15/15), E-005 (8/8), E-006 (10/10), E-007 (4/4): every `From`/`To`/`Signal`/`Status` cell matches `wires.yaml`/`e007_rs485.yaml` exactly.
- `CROSSREF_MATRIX.md` terminal table (69 rows): spot-verified ~20 against `terminals.yaml`; all match, including the "Orphans: OK: No orphans" line (consistent with validator check A PASS).
- `FIELD_VERIFY_LIST.md`: every wire/terminal listed there and only those with `status != verified` in the model; no extra, no missing.

**No fabrication found in the matrices themselves.**

---

## 3. Hard-fail hunt (HF1–HF6) — explicit verdict per condition

| HF | Verdict | Evidence |
|---|---|---|
| **HF1** invented terminal/wire/device/value with no model or source backing | **NONE FOUND** | Every drawn element traced to a model row (validator checks A/F/J,G confirm structurally; my citation hunt confirms semantically — §1). |
| **HF2** conductor rendered SOLID in PNG+PDF without `verified` + 2 endpoints + evidence | **NONE FOUND** | Independent PDF-vector + PNG-pixel script (§0.3): the only solid conductors anywhere in the package are E-007's 485+/485-/SGND, all `status: verified` with `source:` populated and both endpoints named. |
| **HF3** ambiguous PE/safety connection | **NONE FOUND** | PE bus is a distinct dashed vertical run with earth symbol, never conflated with a signal return; every e-stop/monitored-input safety caveat explicitly states "a monitored input/output is NOT a safety stop" and names the NFPA 79 hardwire requirement. |
| **HF4** unacknowledged contradiction | **NONE FOUND at hard-fail severity** — but see Finding F2 below (borderline, scored as a deduction, not a fail — reasoning given) | The package's *pattern* is to actively surface and adjudicate contradictions (Channel 0→2, pin1/8→3, 8N2→8N1, REV 20→34, WI-001 hardwired-fallback non-applicability) — this is the opposite of hiding conflicts. |
| **HF5** clipped/overlapping/off-frame/unreadable | **NONE FOUND** | Visual review of all 5 PNGs at full res (§0.4). |
| **HF6** render-only engineering fact, no model backing | **NONE FOUND** | Check K independently reconfirmed (§0.2); manual literal-by-literal audit of all 5 render functions found nothing that lacks model backing (see Finding F3 — a hygiene/drift concern, not an HF6 violation, because current content is 100% traceable). |

**No sheet, at any point in this audit, was found to contain an invented fact.**

---

## 4. Findings (non-hard-fail — itemized deductions)

### F1 — E-006: field_verify status inconsistently visualized at the terminal-glyph level [MODERATE]
`terminals.yaml` marks all four `PLC1.output_commons` (`+CM0`,`-CM0`,`+CM1`,`-CM1`) `status: field_verify`. `open_items.yaml` OI-09 documents a real, specific technical conflict about them: *"Output bank technology + common feeds. +CM0/-CM0/+CM1/-CM1 polarity naming suggests DC transistor banks; devices.yaml io line says 'relay DO' — conflict."*

Verified directly against the rendered SVG (`grep` on `sheets/E-006_plc_outputs.svg`): the `+CM0`/`-CM0`/`+CM1`/`-CM1` labels are rendered `fill="#111111"` (plain black — the VERIFIED color), **not** `#C0392B` (RED — the FIELD VERIFY color the sheet uses everywhere else). Compare E-005's `COM0`, which correctly gets an explicit red `"(FIELD VERIFY — OI-02)"` callout right beneath it. `grep -c "OI-09"` on `E-006_plc_outputs.svg` returns **0** — the OI-09 conflict is never surfaced on the sheet at all, only in `open_items.yaml`.

- Not HF2 (that rule is conductor-*line*-specific; these are terminal-ID text labels, not conductors).
- Not HF1 (nothing invented — the terminal IDs and connections are correct and model-backed).
- Real defect: a technician reading only the drawing (not the underlying YAML) would read `+CM0` etc. with the same visual confidence as a `verified` PLC input terminal, when the model says otherwise, and would have no on-sheet signal that a genuine bank-technology conflict (relay vs. transistor) is unresolved.
- **-1 cat 1, -2 cat 11, -2 cat 12** on E-006.

### F2 — E-007: unacknowledged physical-location disagreement between two named source documents [MODERATE / HF4-adjacent, not scored as hard-fail]
`e007_rs485.yaml` states the PLC port is a `"top-edge connector"` and the VFD port is `"RS-485 RJ45 jack (front face, near keypad)"`. Both phrases are **verbatim, faithfully cited** from `Conv_Simple_CommsToVFD.html` (§2.2 heading: *"Terminal block — Micro 820 Channel 0 (top-edge connector)"*; §2.3: *"On the GS10 front face, the RS-485 connector is an RJ45-style jack... near the keypad bay."*).

However, `MIRA_PLC_WorkInstruction_v3.pdf` (WI-001) — a document this **same sheet cites elsewhere** (Tables 8-10, command words) — independently and explicitly states the opposite: *"a non-isolated RS-232/RS-485 combo port at the **bottom-front** of the controller"* (PLC) and *"a standard RJ-45 jack on the **bottom** of the drive housing"* (VFD). Neither WI-001 claim carries a page/manual citation (unlike its P09.xx tables, which are meticulously cited), whereas `GS10_UM.txt`'s own RJ45 pinout table sits inside the same figure/context as its other front-panel control-terminal entries (AI/ACM/AO1/DI1-5/DO1) on p.2-18 — circumstantial support for the CommsToVFD "front face" version, but not dispositive without a bench photo.

I am **not** scoring this as HF4 because: (a) it is a physical wayfinding descriptor, not an electrical fact — no pin, wire, terminal ID, or safety behavior changes based on which face the jack is on; (b) I cannot establish with confidence which of the two named sources is actually wrong, so I cannot say the sheet "chose the wrong one" — only that it never engaged with the disagreement. Given the package's demonstrated, consistent practice of surfacing exactly this class of prior-document conflict everywhere else on this very sheet, its silence here is a genuine gap that should be closed (bench-verify or add a FIELD VERIFY caveat) before calling E-007 fully field-ready.
- **-1 cat 1, -1 cat 12** on E-007.

### F3 — Renderer-literal hygiene (process note, not a defect today) [MINOR]
`render_sheet.py`'s own docstring states the model is authoritative and "the renderer never originates engineering content." In practice several facts are hand-retyped as Python string literals rather than loaded from the YAML at runtime: VFD terminal labels `"R/L1","S/L2","T/L3","U/T1","V/T2","W/T3"` in `render_e003` (contrast with the `dc_terms` dict two lines later, which correctly *loads* `terms["VFD1"]["dc_bus"]`); the `"Q1 (MC)"` / `"SAFETY POWER CONTACTOR (MC · 'MLC' in WI-001)"` labels; E-003's subtitle `"every conductor FIELD VERIFY"` (currently true — 15/15 — but computed by the author's eye, not the code, at the time of writing); E-006's subtitle `"NO GS10 DI wiring"`.

**I traced every one of these to real, currently-matching model content** — none is HF6 (there is model backing for all of them; the DC-bus stub block does load live and is the right pattern to imitate). This is flagged purely because check K's blocklist (by design) only catches specific *known-stale* strings, not this general class — a future edit to `terminals.yaml`'s VFD1 terminal IDs or a partial-verification of an E-003 wire would silently desync these literals with no test to catch it.
- **-1 cat 11** on E-003 (home of the worst instance — the unconditional-truth subtitle claim).

### F4 — E-003: M1's "3~" glyph renders unconditionally despite sheet-wide phase-count uncertainty [VERY MINOR]
`motor_sym()` always draws `"M"` + `"3~"`. `devices.yaml` M1.role does say `"(3~ from VFD1 U/V/W)"` (model-backed, not invented) with `evidence: field_verify`, and the adjacent `"M1 (FIELD VERIFY)"` red label does put the whole device on notice — but the *specific* phase-count uncertainty that the same sheet's own wire table explicitly flags for L3 (`"phase count unknown"` on W302/W305/W308, and the caveat `"If the drive is a 1φ model, input is R/L1, S/L2 only"`) is not echoed at the motor symbol itself.
- **-1 cat 12** on E-003.

### F5 — `open_items.yaml` internal staleness (documentation-only, does not touch any drafted sheet) [NOTE, no deduction]
OI-03's item text still reads `"All input wire numbers (W200..W205, W24, W0V are PROPOSED)"`, using the pre-renumbering scheme, while OI-19 (added later) documents the renumbering to W500..W505 and `wires.yaml` already uses W500s throughout. Since E-009 (the sheet that would render `open_items.yaml`) is still a stub, this never reaches a graded sheet — flagged only so it's fixed before E-009 is drafted.

---

## 5. Per-sheet scores (Evidence & Hallucination Auditor lens)

Applicable-category rule per the rubric header: E-001 is conductor-only-N/A = full marks on categories 5/6/7/8 (no conductors/PLC-I-O/VFD content on the cover).

| Sheet | 1 Evid(15) | 2 Tech(12) | 3 Appr(8) | 4 Sym(8) | 5 Wire(10) | 6 Sep(8) | 7 I/O(8) | 8 VFD(8) | 9 Xref(6) | 10 Title(7) | 11 Render(5) | 12 Assum(5) | **Total** |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| E-001 | 15 | 12 | 8 | 8 | 10 | 8 | 8 | 8 | 6 | 7 | 5 | 5 | **100** |
| E-003 | 15 | 12 | 8 | 8 | 10 | 8 | 8 | 8 | 6 | 7 | 4 (F3) | 4 (F4) | **98** |
| E-005 | 15 | 12 | 8 | 8 | 10 | 8 | 8 | 8 | 6 | 7 | 5 | 5 | **100** |
| E-006 | 14 (F1) | 12 | 8 | 8 | 10 | 8 | 8 | 8 | 6 | 7 | 3 (F1) | 3 (F1) | **95** |
| E-007 | 14 (F2) | 12 | 8 | 8 | 10 | 8 | 8 | 8 | 6 | 7 | 5 | 4 (F2) | **98** |

Every sheet ≥90 from this reviewer. **No hard-fails.**

---

## 6. Verdict (from the Evidence & Hallucination Auditor's chair only — package verdict requires reconciling all 4 reviewers)

**No HF1–HF6 found on any of the 5 sheets.** This is, by a wide margin, the most rigorously and honestly cited technical drawing package I have audited in this repo: every sampled numeric/electrical claim (30+ distinct citations checked, ~3-4× the required minimum per sheet) traced to a real, independently-verifiable primary source, several *verbatim*, including direct confirmation via the raw parameter-export spreadsheet (not just prose citations) for the P00.01/P00.20/P00.21/P09.01/P09.04/P02.0x claims. The package's habit of actively surfacing and adjudicating its own supersessions (Channel 0→2, SGND pin 1/8→3, 8N2→8N1, REV 20→34, WI-001 hardwired-fallback non-applicability) is exactly the honesty behavior HF4's carve-out is designed to reward, and it is applied consistently — except for the one gap in F2.

From this lens: **no blocker to APPROVABLE WITH FIELD VERIFICATION.** Two moderate, fixable findings (F1 the E-006 terminal-color/OI-9 gap, F2 the E-007 port-location disagreement) should be closed before that verdict is finalized, but neither is a hard-fail and neither invents a fact.

---

## 7. V3.1 re-check (independent re-verification, not a re-read of the diff)

**Scope of this pass:** re-run the two dedicated raster/vector scripts from §0.3 against all four
re-rendered wired sheets (all 5 sheets were touched — `git status` on `C:\wt-phase0` shows every
`sheets/*.{svg,pdf,png}` modified plus `render_sheet.py`, `validate_model.py`,
`model/{e007_rs485,sheets,wires}.yaml`), independently re-verify F1 and F2 are genuinely closed (not
just present in the diff), re-trace the Hz x10→x100 fix to its two cited sources, re-run
`validate_model.py`, and spot-audit the new check L. Did not re-read `reviewer_*_v2.md` /
`GRADES_V2.md`. Worked directly against `C:\wt-phase0\plc\conv_simple_electrical` (git status:
uncommitted working-tree changes on top of V3 commit `777c4061`, branch `feat/conv-simple-prints-v3`).

### 7.1 `validate_model.py` — independently re-run

```
[PASS] A. Orphan endpoints        [PASS] B. Duplicate terminal ids
[PASS] C. Duplicate wire numbers  [PASS] D. Verified status has source
[PASS] E. E-007 links             [PASS] F. Drafted sheet coverage
[PASS] G. SVG audit (E-003:15/15 E-005:8/8 E-006:10/10 E-007:4/4)
[PASS] H. Dash construction (>=3 segments)
[PASS] I. Raster parity (PDF vs SVG)
[PASS] J. E-001 schedule parity
[PASS] K. No render-only engineering text
[PASS] L. Text/conductor collision
ALL CHECKS PASSED
```

**Correction to the dispatch brief:** the file defines **12** named checks (A–L), not 13 — counted
directly off `results[...]` assignments in `validate_model.py`. Immaterial to substance (all 12
pass, L is present and green); flagging only because the rule in this repo is to verify stated
numbers rather than repeat them.

### 7.2 Check L (text/conductor collision) — read in full, then spot-audited for real sensitivity

Read the implementation (`check_text_conductor_collision`, ~120 new lines): it parses every
`<text>` not flagged `data-flag="1"` (i.e. excludes the numbers inside `wire_tag` boxes, which
legitimately sit on the leader stub), estimates a bounding box from `x`/`y`/`font-size`/`text-anchor`,
extracts every conductor segment (bare `data-wire` `<line>` and the children of
`<g data-dashed="true" data-wire="...">` groups), and flags any text box an endpoint of a conductor
segment falls inside. Wired into `main()` and iterated over `ALL_SVGS` (all 5 sheets).

A check that always passes is worthless, so I did not accept the PASS at face value. I took the
**current, fixed** `E-003_vfd_power.svg`, mechanically reverted just the M1 label back to its
pre-V3.1 position (`(372,726)`/`(372,737)`, the exact coordinates in the `render_sheet.py` diff's
`-` lines), and re-ran the real, unmodified `check_text_conductor_collision` against that mutant:

- **Current (fixed) E-003 SVG → 0 errors.**
- **Mutant (reverted M1 position) → 2 errors:** `E-003: text '(FIELD VERIFY)' (at 372,737) collides
  with conductor W310` (reported twice — once per text/segment pair matched, harmless duplication in
  the checker, not a false negative).

This proves two things at once: check L is a genuine, sensitive check (not a rubber stamp — it
correctly flags the exact defect the fix removed), and the M1/pole-label repositioning in the diff
fixed a **real** collision, not an imagined one. Script: `spot_audit_check_L.py` (scratchpad).

### 7.3 F1 (E-006 bank-common labels) — re-verified closed, at three independent layers

1. **SVG source (`fill=` attribute), grepped directly:** `+CM0`/`-CM0`/`+CM1`/`-CM1` terminal-glyph
   labels now render `fill="#C0392B"` (the `RED` constant), not `#111111` (`BLK`) — all four, matching
   `terminals.yaml`'s `PLC1.output_commons`, which are all still (correctly) `status: field_verify`.
2. **Independent PNG-pixel sampling (not trusting the SVG claim)** — wrote `verify_e006_pixels.py`,
   sampled the actual rendered raster around each label's glyph box. Darkest ink pixel for all four
   labels: **`(192, 57, 43)` = `0xC0392B` exactly**, vs. a known-black control point (a table
   annotation confirmed `fill="#111111"` by grep) sampling **`(17, 17, 17)` = `0x111111` exactly**.
   Zero ambiguity — the red is genuinely in the raster a technician would see, not just SVG markup
   that could theoretically be dropped in conversion (which is exactly the class of bug V3 fixed for
   dashes).
3. **Visual crop at full res** (`crop_e006_commons.png`, `crop_e006_notes.png`): confirms the four
   labels read unambiguously red against black descriptive text beside them, AND confirms the OI-09
   conflict is now on-sheet, verbatim: *"Output bank technology + common feed = FIELD VERIFY (OI-09):
   WI-001 p.4 says relay dry contacts; ±CM polarity naming suggests DC-fed banks — conflicting
   evidence, resolve per 2080-IN009 + meter."* `grep -c "OI-09"` on the current SVG is now non-zero
   (was 0 in V3). No clipping, no overlap with the adjacent dashed W609 conductor.

**F1 is closed.** Both original complaints (silent-verified-looking terminal color; OI-09 conflict
absent from the sheet) are independently confirmed fixed, not just asserted fixed.

### 7.4 F2 (E-007 port-location disclosure) — re-verified closed

`sheets.yaml`'s E-007 annotation block gained one `notes:` line; confirmed it actually reaches the
render (not just the YAML) via `fitz` PDF-text extraction of the real output artifact and a visual
crop (`crop_e007_notes.png`):

> "Port locations per CommsToVFD (PLC top-edge connector; GS10 front-face RJ45) — WI-001 says
> bottom-front. Wayfinding only; confirm on unit (FIELD VERIFY)."

This names both disagreeing sources, states the disagreement plainly, hedges it as non-electrical
wayfinding, and marks it FIELD VERIFY — matching the exact honesty pattern the rest of the package
uses for its other supersessions (Channel 0→2, SGND pin 1/8→3, 8N2→8N1). **F2 is closed.**

### 7.5 Hz x10 → x100 readback fix — re-traced to both cited sources

`e007_rs485.yaml`'s `readback` list changed from `"...Hz x10)..."` to
`"...Hz x100)... (Prog_init v2.1:164 'Hz x100'; GS10_UM.txt L15703-05 format XXX.XX Hz)"`, and the
citation string itself renders on the sheet (confirmed via PDF text extraction, E-007 page).

- **`Prog_init_ConvSimple_v2.1.st` line 164 — exact, verbatim match**, checked directly against the
  file in this worktree (`plc/Prog_init_ConvSimple_v2.1.st`):
  `vfd_frequency   := read_data[4];    (* 0x2103  output freq Hz x100 *)` — line number and content
  both confirmed.
- **`GS10_UM.txt` L15703-05 — could NOT be verified at the exact cited line number.** That specific
  line-numbered `.txt` extraction is **not present anywhere accessible to this session** — not in
  `C:\wt-phase0`, not in the primary `MIRA` checkout, not in any other worktree, and `git log --all`
  shows it was never committed to the repo (it must have been a local, session-scoped text dump the
  V3 auditor had on disk that isn't part of the git tree). Rather than accept the citation on faith, I
  located the actual **source PDF** (`C:\Users\hharp\Documents\conveyor-evidence\manuals\GS10_UM.pdf`,
  452 pages), re-extracted it fresh with `fitz`, and searched for the underlying claim. Found, on
  **manual page 266**: `"Output frequency (XXX.XX Hz)"`, in the same monitor-function table section
  (pages 261–267) that documents **register 2103H** (`"Content of register 2103H"`, p.261;
  `"address 2103H"`, p.262) — i.e. the manual's own display-format convention for the 2103H content is
  a 2-decimal-place Hz value, which is exactly what you get from an integer register scaled ÷100
  (register value 3000 → "30.00 Hz"). This **substantively confirms** the fact the sheet cites; I just
  cannot confirm the specific line numbers "15703-05" against a file I don't have. Net: the Hz x100
  correction is real and correctly grounded, with one process caveat (cite traceability, not
  correctness) — not a hallucination, not scored as one.

### 7.6 Dash/solid conductor semantics — full independent re-run on all 4 re-rendered wired sheets

Rebuilt the §0.3 method (fitz PDF-vector geometry + PIL PNG-pixel sampling, treating the SVG's
`data-wire`/`data-dashed` attributes as a claim to be checked, not trusted) as a standalone,
general-purpose script (`verify_dash_semantics_v31.py`) and ran it against **every** conductor on
**all four** wired sheets post-re-render (48 conductor elements at the raw SVG-segment level — this
count differs from check G's 15/8/10/4=37 because check G counts distinct model wire rows while this
script counts rendered SVG line/group occurrences, e.g. shared-rail wires like `W24`/`W609` are drawn
as several separate tagged segments; both counting conventions land on the same "0 divergences"
result).

**First pass found 47/48 "mismatches" — this was a bug in my own script, not the sheets.** Root
cause: `fitz.Rect.intersects()` treats a zero-area rectangle as empty and always returns `False` for
it — and a pure horizontal or vertical stroke segment (exactly what every dash tick and every solid
run is) *is* a zero-height-or-width rect in PDF vector space. That silently dropped every real dash
segment from consideration. Confirmed the root cause with a targeted probe
(`debug_pdf_coords3.py` — same query region, no `.intersects()` prefilter, found the 8 real dash
segments exactly where the SVG said they'd be, at the SVG's own coordinates, 1:1 scale, no axis
flip). Fixed by replacing `.intersects()` with manual interval-overlap math and re-ran:

```
TOTAL conductors checked: 48
MISMATCHES: 0
```

E-003 (17), E-005 (14), E-006 (13), E-007 (4) — every conductor's claimed solid/dashed state is
confirmed genuinely present in **both** the PDF vector geometry and the PNG pixel raster, including
the newly-added **SH wire_tag** on E-007 (confirmed dashed, 9 real vector dash segments, tag box
rendered red per `verified=False`, matching `data-flag="1"` so check L correctly ignores it) and the
still-solid 485+/485-/SGND. **Re-confirms HF2 = NONE FOUND** on the re-rendered set. (Flagging the
script bug here in the spirit of the auditor's own "verify your tools" discipline from §0.2/§0.3 — a
clean 0/48 that survived catching and fixing a real false-positive source is stronger evidence than a
clean run that never found anything to fix.)

### 7.7 Other cited fixes — spot-verified

- **"Both anti-spaghetti laws" in the E-001 key:** confirmed on the rendered sheet (PDF text +
  `crop_e001_key.png`). The WIRE-NUMBERING KEY box now states both: (1) the `W[sheet][line]`
  numbering convention (pre-existing), and (2) new: *"Same electrical node = same wire number; a
  number changes only through a device."* Loaded live from `wires.yaml`'s `convention:` field (not a
  renderer literal — consistent with the package's own discipline, doesn't create a new F3 instance).
- **`Drawn:` lines:** present on all 5 sheets (`grep -c "Drawn: MIRA / FactoryLM"` ≥1 on each).
- **Font bumps:** spot-checked in the diff (7→7.5, 6.5, 7.2→7.5 across E-003/E-006/E-007 labels) —
  cosmetic, no adverse effect found (check L clean, visual crops clean).

### 7.8 NEW finding (V3.1-introduced, not in the V3 ledger) — E-005 title-block "Drawn:" duplication [VERY MINOR, cat 10]

The `title_block()` fix (`"MIRA / FactoryLM"` → `"Drawn: MIRA / FactoryLM"`) is a second, *always-on*
line above the existing lineage line, which itself falls back to `f"Drawn: {meta['drawn_by']}"` when a
sheet passes no custom `lineage=` string. `devices.yaml`'s `meta.drawn_by: "MIRA / FactoryLM"` means
any sheet with no custom lineage now shows the identical string twice. Of the 5 sheets, only **E-005**
calls `title_block(...)` without a `lineage=` argument (E-001/E-003/E-006/E-007 all pass one).
Confirmed visually (`crop_e005_title_dup.png`): the title block reads

```
Drawn: MIRA / FactoryLM
Drawn: MIRA / FactoryLM
```

stacked, verbatim-identical, one line apart. Not HF5 (both lines are fully legible, not clipped, not
overlapping pixels — this is redundant phrasing, not unreadable content), but it is a genuine new
drafting-polish defect a plant engineer would notice and read as a copy/paste slip. Trivial fix
(either give E-005 a `lineage=` string, e.g. `"input map CCW v4.0 + live Prog_init"` mirroring E-006's
pattern, or drop the fallback's own `"Drawn: "` prefix since the line above it now always carries one).
**-1 cat 10 on E-005.**

### 7.9 Hard-fail re-sweep (V3.1 sheets)

| HF | Verdict |
|---|---|
| HF1 invented fact | NONE FOUND — no new device/terminal/value introduced by V3.1 that isn't in the model YAML (verified the two new notes trace to `sheets.yaml`/`e007_rs485.yaml`, §7.3–7.5). |
| HF2 fake-solid/fake-dashed | NONE FOUND — re-confirmed 0/48 on the re-rendered raster (§7.6). |
| HF3 ambiguous PE/safety | NONE FOUND — untouched by V3.1. |
| HF4 unacknowledged contradiction | NONE FOUND — V3.1's two content changes are both *closures* of previously-unacknowledged conflicts (F1, F2), strengthening the package's HF4-carve-out pattern rather than adding to it. |
| HF5 clipped/overlapping/unreadable | NONE FOUND — visual crops of every touched region (E-006 commons+notes, E-007 notes+SH, E-003 M1+CB1, E-001 key, E-005 title) all clean at full res. The new E-005 duplication (§7.8) is redundancy, not illegibility — does not qualify. |
| HF6 render-only fact | NONE FOUND — check K still PASS; the new E-001 law sentence is YAML-loaded, not a literal. |

**Zero hard-fails, confirmed independently, on the V3.1 re-render.**

### 7.10 Updated per-sheet scores (Evidence & Hallucination Auditor lens)

| Sheet | V3 score | Change | V3.1 score | Why |
|---|---|---|---|---|
| E-001 | 100 | — | **100** | No findings; new key sentence is YAML-sourced. |
| E-003 | 98 | — | **98** | F3 (renderer-literal hygiene) and F4 (M1 "3~" unconditional) are **still open** — re-checked directly against current `render_sheet.py` (`R/L1`/`S/L2`/…/`"every conductor FIELD VERIFY"`/`"NO GS10 DI wiring"` literals unchanged; `motor_sym()` still unconditional). V3.1's E-003 fix (pole-label/M1 collision) closed a real defect (§7.2) that was never scored as a deduction in this ledger — nothing to restore. |
| E-005 | 100 | **−1** | **99** | NEW: title-block `Drawn:` duplication (§7.8), a side-effect of the V3.1 fix, unique to this sheet. |
| E-006 | 95 | **+5** | **100** | F1 fully closed, independently re-verified at SVG/pixel/visual layers (§7.3). |
| E-007 | 98 | **+2** | **100** | F2 fully closed, independently re-verified (§7.4). Hz x100 fix independently re-traced (§7.5, one process caveat noted, not a hallucination). SH tag addition confirmed correctly constructed and non-colliding. |

All five sheets **≥ 90**. **Zero hard-fails** at any point in this re-check.

### 7.11 V3.1 verdict (Evidence & Hallucination Auditor's chair only)

Both moderate findings this ledger raised against V3 (F1, F2) are **genuinely closed** — not just
present in a diff, but independently re-derived at the SVG-attribute, PDF-vector/text, PNG-pixel, and
full-resolution-visual layers, including a synthetic mutation test proving the new validator check
(L) actually has teeth rather than trivially passing. The Hz x10→x100 factual fix traces cleanly to
`Prog_init v2.1:164` (exact) and, via independent regeneration of the primary manual PDF, to the
substance of the `GS10_UM.txt` citation (exact line numbers unverifiable only because that specific
extraction isn't in this session's filesystem — a traceability gap, not a hallucination). One new,
very-minor, non-hard-fail finding surfaced in this pass (§7.8, E-005 title-block duplication) that the
V3 ledger could not have caught because it didn't exist yet.

**From this lens: APPROVABLE WITH FIELD VERIFICATION.** No hard-fails; every sheet ≥90; all
remaining unknowns are explicitly FIELD VERIFY and tracked in `open_items.yaml` (including OI-09,
which is now *also* disclosed on E-006 itself, not just in the YAML). Package-level verdict still
requires reconciling the other three reviewer chairs (technician / controls engineer / drafting
standards) — this is the auditor's chair only, as in §6.
