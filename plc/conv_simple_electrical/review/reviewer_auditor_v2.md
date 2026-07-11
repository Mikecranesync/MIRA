# Evidence & Hallucination Audit — CV-101 Electrical Print Package V2

**Reviewer role:** Evidence & hallucination auditor (deep-dive categories 1, 11, 12 + ALL hard-fails)
**Scope:** E-003 (VFD power), E-005 (PLC inputs), E-006 (PLC outputs), E-007 (RS-485/Modbus)
**Method:** Every fact enumerated per sheet, traced to `model/*.yaml`, then to the cited corpus document at
the cited line/page (grep + line-numbered reads + PyMuPDF text/vector extraction + pixel sampling).
Validator (`validate_model.py`) and matrix generator (`emit_matrices.py`) re-run and diffed against the
committed matrices. All three rendered formats (SVG/PNG/PDF) inspected per sheet, including direct PDF
vector-drawing inspection (`page.get_drawings()`) to bypass any rasterization ambiguity.

---

## 0. HEADLINE FINDING — package-wide HF2 (read this first)

**Every dashed ("FIELD VERIFY") conductor and box in the entire package renders as an indistinguishable
SOLID line in the PDF and PNG that a human actually receives — on all four sheets, with zero exceptions.**

### Proof (three independent methods)

1. **SVG source is correct.** The SVG text does encode `stroke-dasharray="7,4"` on `field_verify`
   conductors, e.g. E-003 wire W300: `<line x1="340.0" y1="190.0" x2="340.0" y2="236.0" ...
   stroke-dasharray="7,4" data-wire="W300" data-status="field_verify"/>`. Authoring intent is right.
2. **PNG pixel sampling proves it does not survive rasterization.** Sampling 96 consecutive pixels along
   wire W300 in `E-003_vfd_power.png` (which the SVG marks dashed) returns 95 dark pixels (~RGB 17,17,17,
   i.e. `#111111`) and 1 near-white edge pixel — no periodic gap. A genuinely dashed 2×-scale line with a
   `7,4` dasharray would show ~4 clear white gaps in that span.
3. **PDF vector inspection is conclusive.** `fitz`'s `page.get_drawings()` on the actual PDF (not the
   raster) shows **zero** drawing items with a non-empty `dashes` field on **any** of the four sheet PDFs
   or on any of the four pages of the merged `CV-101_print_set.pdf`:

   | File | Drawing items | Items with a dash pattern |
   |---|---|---|
   | E-003_vfd_power.pdf | 142 | **0** |
   | E-005_plc_inputs.pdf | 99 | **0** |
   | E-006_plc_outputs.pdf | 110 | **0** |
   | E-007_rs485_modbus.pdf | 64 | **0** |
   | CV-101_print_set.pdf (4 pages) | 415 | **0** |

### Root cause
`render_sheet.py::_emit()` converts the authored SVG via
`fitz.open(stream=svg, filetype="svg").convert_to_pdf()`. PyMuPDF's SVG→PDF path drops
`stroke-dasharray` entirely; every stroked path becomes a plain solid stroke. Color and fill are
preserved correctly (red wire-number tag boxes and red "FIELD VERIFY" text render fine) — **only the
dash pattern is lost.** This is a renderer/tooling defect, not a model (YAML) defect.

### The most concrete illustration: the legend lies to itself
E-003's own legend is supposed to teach the reader the convention:
```
──────────  VERIFIED — solid (no E-003 conductor qualifies yet; terminal names verified via table sources)
──────────  FIELD VERIFY — dashed + red wire flag (all E-003 conductors; wire numbers PROPOSED — OI-19)
```
Both sample lines render as **pixel-identical solid black segments** (verified by sampling: 8/100 "white"
pixels on each sample, both from anti-aliasing at the line ends, no periodic gap on either). A technician
cannot learn or apply the solid/dashed convention from this legend because it does not visually exist in
the artifact they hold. See crop evidence: both legend swatches are visually indistinguishable.

### Scope and severity
- **E-003:** 15/15 conductors are `field_verify` (0 verified) — 100% of the sheet's wiring, plus the
  dashed SUPPLY box and 3 dashed CB1 breaker-pole boxes, render with full "verified" visual confidence.
  This is the VFD power/energization sheet — the one where a false "this is confirmed" signal is most
  dangerous (LOTO/DC-bus-discharge decisions).
- **E-005:** 8/8 conductors are `field_verify` (0 verified) — same 100% failure.
- **E-006:** 10/10 conductors are `field_verify` (0 verified) — same 100% failure.
- **E-007:** 1/4 links (`SH`, the shield/chassis drain) is `field_verify`; the other 3 are genuinely
  `verified`. Net effect here is narrower (only the SH conductor is misrepresented) but the mechanism is
  identical and confirmed by the same PDF vector check (0 dashed items).

### Rubric mapping
This is **HF2** by the letter of the rubric ("A conductor rendered visually SOLID (in the PNG and PDF, not
just the SVG)... whose model status is not verified") — applies to all 4 sheets. It simultaneously
violates **Category 11**'s explicit requirement ("the PNG/PDF visually match the SVG's solid/dash
semantics") and guts **Category 12** ("no confident tone about unverified facts") since the *drawing*
itself — the primary channel — asserts confidence the model does not have. Text captions (red "FIELD
VERIFY" labels, the connection-table Status column, red note boxes) are honest and partially mitigate, but
do not cure an HF2 finding, which the rubric defines at the conductor-rendering level with zero tolerance.

### Tooling blind spot
`validate_model.py` Check G ("SVG audit") reads the **SVG text only** — it confirms `data-wire` elements
have the right `stroke-dasharray` string in the SVG source, which they do. It never opens the PDF/PNG, so
it reports **PASS** and the package prints "ALL CHECKS PASSED" while the actual deliverable is completely
broken on this axis. This is a false-confidence gap in the validator itself, not just the renderer. Check
G also only runs against **E-003 and E-006**; E-005 and E-007 aren't SVG-audited at all (their renderers
don't tag `data-wire` on most lines — EVIDENCE_MATRIX.md correctly self-reports this as
`"n/a (untagged renderer)"`).

### A second, independent, SVG-authoring-level defect (Defect A — smaller, but real)
Separately from the fitz/PDF conversion bug, the SVG **source itself** already draws solid at the point a
technician's eye lands: the glyph-drawing helpers `selector()`, `contact_no()`, `contact_nc()`,
`pushbutton()`, `photoeye()` (used for every E-005 rung) and `pilot()` / `coil()` (used for E-006's
pilot lights and contactor coil) build their connecting stub-lines with **no `dash=` parameter at all**,
so those segments are unconditionally solid regardless of the wire's true status. Verified directly in the
SVG: for E-005 wire W200 (`SS1.FWD → PLC1.I-00`, status `field_verify`), the two ~68px stub segments
immediately flanking the switch symbol (`x=310→378` and `x=402→470`) carry no `stroke-dasharray`
attribute, while the rail-side (`x=250→310`) and PLC-side (`x=470→1170`) segments of the *same logical
wire* correctly do. **This means fixing the fitz conversion alone would not fully cure E-005 or E-006** —
the glyph helpers need a `dash=not verified` parameter threaded through their stub-line calls too.

---

## Sheet-by-sheet detail

## E-003 — VFD POWER

### 12-category scores

| # | Category | Score /Max | Deductions |
|---|---|---|---|
| 1 | Electrical truth & evidence | 12/15 | -3, cat1, CB1 note "REQUIRED per GS10_UM L1758-1759", CB1 sidebar (render_sheet.py L749), the precise line-pin citation exists only in the renderer, not in devices.yaml/open_items.yaml (OI-15 only says "NEC and GS10 manual require upstream protection," no line cite). Underlying requirement IS accurate (verified against GS10_UM.txt L1758-1759 item #6) — soft HF6-adjacent gap, not a fabricated fact. |
| 2 | Technician troubleshooting readability | 9/12 | -3, cat2, whole sheet, the meter-lead trust signal (solid=confirmed) is non-functional per §0; text captions partially compensate. |
| 3 | Maintenance-engineer approvability | 6/8 | -2, cat3, whole sheet, an engineer cannot sign off "what's confirmed vs not" from the drawing itself; open items/caveat box present, which helps. |
| 4 | Standard symbols & reference designations | 7/8 | -1, cat4, breaker/contactor pole glyphs, minor: dashed-vs-solid symbol boxes (CB1 vs Q1) are meant to be visually distinct devices but the "dashed CB1 box" also renders solid — reduces the intended visual differentiation between breaker and contactor glyphs. |
| 5 | Wire & terminal identification | 6/10 | -4, cat5, all 15 conductors, wire-number flags are legible and correctly colored red, but the conductor-status check ("both endpoints... flags legible... verified") fails because the line itself no longer encodes status — the flag is the only surviving signal. |
| 6 | Power/control/grounding/safety separation | 6/8 | -2, cat6, PE bus (W315-317), PE is structurally distinct + orthogonal (good), but "safety-relevant paths distinguishable from status/indication" fails — the PE bond's field_verify (unconfirmed ≤0.1Ω) status is invisible in the render. |
| 7 | PLC I/O presentation | 8/8 | N/A — not a PLC I/O sheet, nothing to violate. |
| 8 | VFD power & control presentation | 6/8 | -2, cat8, folds in the CB1 citation-precision issue (dup of cat1 finding); line/load orientation (supply top → motor bottom), GS10 terminals verbatim (R/L1 etc.), and aux terminals shown WITH state (+1/+2 jumper, B1/B2 OPEN, DC+/DC- OPEN) are all genuinely well done. |
| 9 | Cross-references & continuation markers | 5/6 | -1, cat9, minor: E-002/E-004 are stub sheets so "to source PE (E-002)" / coil↔E-006 refs can't be independently cross-checked against real content yet; refs themselves are correctly named and bidirectional (Q1: "coil ← O-02 (E-006)" here, "poles on E-003" on E-006). |
| 10 | Title block, revision, notes, print-scale readability | 6/7 | -1, cat10, minor: complete title block, zone grid, all legible at 100%; "as-built UNVERIFIED" caveat is good practice. |
| 11 | YAML-to-render consistency | 1/5 | -4, cat11, whole sheet, see §0 — PNG/PDF do not match SVG solid/dash semantics; validator's Check G gives false confidence because it never opens the rendered artifact. |
| 12 | Absence of unsupported assumptions | 1/5 | -4, cat12, whole sheet, see §0 — every unconfirmed conductor visually presents with full confidence; this is precisely the "confident tone about unverified facts" category 12 exists to catch, and it is failing at the drawing level despite honest text. |
| **Total** | | **73/100** | |

### Hard-fail findings
- **HF2 (package-wide, see §0).** All 15 E-003 conductors + the SUPPLY box + 3 CB1 breaker-pole boxes.
- **HF1/HF3/HF4/HF5/HF6:** none found specific to E-003 beyond the soft CB1 citation-precision gap
  (documented above under cat1, not elevated to a clean HF6 because the underlying requirement — "upstream
  protection required" — IS present in `open_items.yaml` OI-15; only the specific line-pin is renderer-only).

### Invented / unsupported details list
NONE FOUND at the HF1 (invented element) level — every device (CB1, Q1, VFD1, M1) and terminal drawn
traces to `devices.yaml`/`terminals.yaml`, and 12 of 12 spot-checked citations resolved accurately (below).
One soft citation-precision gap noted above (not a fabrication).

### Citation spot-check table (12 checked, exceeds the ≥8 minimum)

| Cite (as printed) | Found? | Quote from source |
|---|---|---|
| terminals.yaml VFD1 R/L1,S/L2 → "GS10_UM.txt L1971/L1973" | FOUND | L1971 "R/L1, S/L2 ... Input Power phase 1"; L1973 "R/L1, S/L2, T/L3 Input Power phase 3" |
| terminals.yaml VFD1 U/T1,V/T2,W/T3 → "L1975 (prose T1: L1773-1776)" | FOUND | L1975 "U/T1, V/T2, W/T3 AC Motor Drive Output"; L1773-1776 "the motor will rotate counterclockwise... switch the connections of any of the two motor leads" |
| terminals.yaml VFD1 +1/+2 → "L1824-1826, L1977-1978" | FOUND | L1824-1826 "these terminals are connected with a short-circuit jumper. Remove this jumper before connecting a DC reactor"; L1977-1978 table row matches |
| terminals.yaml VFD1 DC+/DC- → "L1982, L1986" | FOUND | L1982 "DC+, DC- Common DC Bus"; L1986 "NOTE: 120VAC models do not have DC bus terminals DC-, DC+/+1" — exact match to "(absent on 120VAC models)" |
| terminals.yaml VFD1 GND → "L1984, L1760-1762" | FOUND | L1984 = table's Ground row; L1760-1761 "properly grounded. (Ground resistance should not exceed 0.1.)" (Ω symbol dropped by text-extraction, not a print defect) |
| render safety note "Never start/stop via input power (L1811-1813)" | FOUND | "Do NOT start/stop the GS10 AC drive by turning input power ON/OFF..." — exact |
| render safety note "MC ... emergency/safety switching only (L1754-1757)" | FOUND | "Cycling a power circuit switching device while the AC drive is in run mode should be done only in emergency situations" |
| render safety note "LOTO + wait ≥5 min for DC-bus discharge (WI p.2 §2)" | FOUND | `MIRA_PLC_WorkInstruction_v3.pdf` internal page "Page 2 of 28", §2 "Safety and lockout": "4. Wait five minutes for the GS10 DC bus to discharge." |
| render safety note "shield/conduit bonded both ends (L1792-95)" | FOUND | "Ground both ends of the shield wire or conduit for the power wiring" — exact |
| render/OI-17 "RFI jumper ... (L1693-1718)" | FOUND | "Asymmetric Ground System (Corner Grounded TN Systems)" section begins at L1693, RFI jumper procedure runs to ~L1718 |
| devices.yaml Q1 → "CCW_VARIABLES_v4.0.txt:80" | FOUND | line 80 (verified via `grep -n`): "O-02 ... ContactorQ1 (safety power)" |
| devices.yaml Q1 → "GS10_Integration_Guide.md:303" | FOUND | line 303: "Press E-stop during run → motor stops, contactor drops" (Phase 5 Safety Tests) |
| sheets.yaml E-003 "P00.01 rated current 1.60 A (2026-05-20 export)" | FOUND | `GS10_actual_parameters_5.20.26.xlsx`, row `00.01 Rated Current`, Content Value = `1.60` |
| open_items.yaml OI-14 "R-C surge absorber both ends recommended per GS10 manual" | FOUND | GS10_UM.txt L1753: "Both ends of the MC should have an R-C surge absorber." |

### SVG↔PNG↔PDF divergence
Full package-wide finding — see §0. E-003 is the most consequential instance (VFD power/energization).

---

## E-005 — PLC DIGITAL INPUTS

### 12-category scores

| # | Category | Score /Max | Deductions |
|---|---|---|---|
| 1 | Electrical truth & evidence | 12/15 | -3, cat1, safety note "NFPA 79 / EN 60204-1, stop cat 0/1" (render_sheet.py notes list, line ~664), HF6 — see below. Otherwise excellent: every device/terminal citation spot-checked below was accurate. |
| 2 | Technician troubleshooting readability | 8/12 | -4, cat2, all 6 rungs, both §0's systemic dash-drop AND Defect A (glyph-stub solid segments in the SVG source itself) apply here — the switch-adjacent segment a tech's eye lands on is solid regardless of which bug is "blamed." |
| 3 | Maintenance-engineer approvability | 6/8 | -2, cat3, whole sheet, same false-confidence issue; open items present (E-009 reference implied, though not named explicitly on-sheet — minor). |
| 4 | Standard symbols & reference designations | 6/8 | -2, cat4, `photoeye()` glyph (a plain rectangle + "▷→" text glyph) is not a recognized IEC 60617/photo-eye convention — ad hoc but clearly labeled, so usable, not misleading. |
| 5 | Wire & terminal identification | 5/10 | -5, cat5, all 6 rungs, worst instance of Defect A in the package: even the raw SVG (before the fitz bug) draws the wire solid at the switch; wire-number flags themselves are legible and correctly colored. |
| 6 | Power/control/grounding/safety separation | 6/8 | -2, cat6, single circuit family correctly maintained (24VDC DI only); status-distinguishability undercut as elsewhere. |
| 7 | PLC I/O presentation | 6/8 | -2, cat7, spares I-06..I-11 say "spare (no field wire — confirmed unused)" with **no OI number cited**, while the sibling sheet E-006 cites its spares' open item explicitly ("spare (confirm no field wire — OI-12)") — inconsistent even though `OI-08` exists in `open_items.yaml` for exactly this. Commons (COM0) and OPC tags ARE explicit — good. |
| 8 | VFD power & control presentation | 8/8 | N/A — not a VFD sheet. |
| 9 | Cross-references & continuation markers | 5/6 | -1, cat9, PS1/E-004 refs consistent and correctly named; E-009 (open items) isn't named on-sheet even though the legend points at "see E-009 open items". |
| 10 | Title block, revision, notes, print-scale readability | 6/7 | -1, cat10, complete and legible; minor. |
| 11 | YAML-to-render consistency | 1/5 | -4, cat11, whole sheet — see §0; additionally E-005 is **not covered by validate_model.py's SVG audit at all** ("untagged renderer"), so it has zero automated protection on this axis even at the SVG-text level. |
| 12 | Absence of unsupported assumptions | 1/5 | -4, cat12, whole sheet — see §0; arguably the most severe instance in the package because the solid stub sits exactly where a technician would put a meter lead. |
| **Total** | | **70/100** | |

### Hard-fail findings
- **HF2 (package-wide, see §0), plus the sheet-specific Defect A** (glyph-stub solid segments — an
  SVG-authoring bug independent of the fitz conversion bug, present in ALL 6 rungs).
- **HF6 — "NFPA 79 / EN 60204-1, stop cat 0/1."** Location: bottom-left SAFETY note block on the rendered
  sheet ("SAFETY: I-02/I-03 are MONITORED e-stop inputs only... A compliant install must hardwire S0 to
  remove drive power (NFPA 79 / EN 60204-1, stop cat 0/1)."), sourced in `render_sheet.py` lines
  ~664-665 (the `notes` list). **This text does not appear anywhere in any model YAML file** (`devices.yaml`
  S0's own note only says "Whether a safety relay sits between S0 and the PLC is FIELD VERIFY" — no
  standard-number, no stop-category). I searched the full evidence corpus for "EN 60204" / "60204" /
  "stop cat" / "category" — **zero hits** in `MIRA_PLC_WorkInstruction_v3.pdf` (all 28 pages),
  `GS10_UM.txt`, `GS10_Integration_Guide.md`, `Prog_init_ConvSimple_v2.1.st`, `CCW_VARIABLES_v4.0.txt`,
  `Conv_Simple_CommsToVFD.pdf`, or `Conv_Simple_GS10_Beginner_Verify_V2.pdf`. "NFPA 79" alone is
  corpus-grounded (WorkInstruction_v3 p.1 lists it as an applicable standard for the whole document), but
  the *specific* claim — EN 60204-1, "stop cat 0/1", and the causal link to hardwiring S0 — is not
  traceable to any evidence I was given. Note the underlying general point ("a monitored input is NOT a
  safety stop") IS backed (matches `open_items.yaml` OI-05 almost verbatim), so this is a case of a true
  general claim wrapped in a specific regulatory citation that is not evidenced.

### Invented / unsupported details list
1. **"NFPA 79 / EN 60204-1, stop cat 0/1"** — safety note, bottom-left of E-005. HF6. Element: the
   standard-number + stop-category clause. Location: `render_sheet.py` notes list (not in any YAML).
   Reason unsupported: zero occurrences of "60204" or "stop cat"/"category" anywhere in the 8-document
   evidence corpus searched.

Otherwise NONE FOUND — no invented devices, terminals, or wire numbers; every other citation checked below
was accurate.

### Citation spot-check table (9 checked)

| Cite (as printed) | Found? | Quote from source |
|---|---|---|
| devices.yaml S2 → tags.json "DI-04 Run pushbutton" | FOUND | `Inputs/tags.json`: `"documentation": "Embedded DI-04 — Run pushbutton"` — exact |
| devices.yaml B1 → "_IO_EM_DI_05 -> pe_latched" | FOUND | `Prog_init_ConvSimple_v2.1.st` L208-209: `IF _IO_EM_DI_05 THEN pe_latched := TRUE;` |
| devices.yaml SS1 → "dir_fwd/dir_rev" | FOUND | `Prog_init_ConvSimple_v2.1.st` L205-206: `dir_fwd := _IO_EM_DI_00 AND NOT _IO_EM_DI_01; dir_rev := ...` |
| terminals.yaml I-00 "healthy: 1 when FWD selected" | FOUND (consistent) | matches `dir_fwd` logic above and CCW_VARIABLES L69 "SelectorFWD (NO, knob LEFT)" |
| terminals.yaml I-02/I-03 healthy states (1=healthy NC / 0=healthy NO) | FOUND | `tags.json`: "Embedded DI-02 — E-stop NC channel (healthy = 1)"; "Embedded DI-03 — E-stop NO channel (healthy = 0)" — exact |
| render safety note "a monitored input is NOT a safety stop" | FOUND (paraphrase) | `open_items.yaml` OI-05: "a monitored input is NOT a safety stop (see safety note)" — near-verbatim |
| render SOURCES footer (4 files) | FOUND (union, hand-assembled) | Each file individually traces to a devices.yaml source field (PLC1, B1, S2); the renderer hand-transcribes the union rather than pulling it programmatically — faithful but not YAML-driven (style note, not a fabrication) |
| render safety note "NFPA 79 / EN 60204-1, stop cat 0/1" | **NOT FOUND** | see HF6 above |
| terminals.yaml I-06..I-11 "spare... confirmed UNused (no program/doc reference)" | FOUND (negative claim, verifiable) | `CCW_VARIABLES_v4.0.txt` I/O map lists only I-00..I-06 with function; I-07..I-11 explicitly "(spare)" — consistent |

### SVG↔PNG↔PDF divergence
§0 systemic finding applies to all 8 wires. **Additionally**, E-005's own SVG source (independent of the
PDF conversion bug) draws every switch-adjacent stub solid regardless of status — Defect A, detailed in
§0, confirmed by direct inspection of `E-005_plc_inputs.svg` lines 57-102 (rail/PLC segments correctly
carry `stroke-dasharray="7,4"`; the glyph-internal stub segments never do).

---

## E-006 — PLC OUTPUTS

### 12-category scores

| # | Category | Score /Max | Deductions |
|---|---|---|---|
| 1 | Electrical truth & evidence | 11/15 | -4, cat1: (a) "MODBUS CROSS-REF" box HF6 (below), (b) devices.yaml PL1 citation `CCW_VARIABLES_v4.0.txt:79` is the WRONG LINE (verified via `grep -n`: line 79 is O-01/LightRed = PL2's row; PL1/LightGreen is line 78). |
| 2 | Technician troubleshooting readability | 9/12 | -3, cat2, whole sheet, §0 dash-bug; layout itself (return-rail collector, bank commons) is otherwise clear. |
| 3 | Maintenance-engineer approvability | 6/8 | -2, cat3, same false-confidence issue as other sheets. |
| 4 | Standard symbols & reference designations | 7/8 | -1, cat4, minor: pilot-light (circle+X, IEC 60617-correct) and coil symbols are fine; small dock mirrors cat4 E-003 (glyph internal stubs, Defect A, at the pilot/coil terminals — smaller magnitude than E-005). |
| 5 | Wire & terminal identification | 6/10 | -4, cat5, all 10 conductors, §0 + a smaller-scale Defect A at the PL1/PL2/Q1-coil/S2-lamp terminal stubs; commons/spares are well labeled otherwise. |
| 6 | Power/control/grounding/safety separation | 6/8 | -2, cat6, single circuit family maintained; status-distinguishability undercut. |
| 7 | PLC I/O presentation | 7/8 | -1, cat7, does the OI-reference-on-spares thing RIGHT ("spare (confirm no field wire — OI-12)") — better than E-005; minor dock because `open_items.yaml` OI-09 flags a real, unresolved conflict ("output commons... suggests DC transistor banks; devices.yaml io line says 'relay DO' — conflict") that is not surfaced anywhere on the rendered sheet itself. |
| 8 | VFD power & control presentation | 7/8 | -1, cat8, MODBUS CROSS-REF content is well-integrated conceptually (this is the right sheet to cross-reference E-007's control path from); dock folds in the citation-misattribution issue at reduced weight since it's also counted in cat1. |
| 9 | Cross-references & continuation markers | 5/6 | -1, cat9, good bidirectional Q1↔E-003 ref ("poles on E-003" / "coil ← O-02 (E-006)") and Modbus↔E-007 ref; minor. |
| 10 | Title block, revision, notes, print-scale readability | 5/7 | -2, cat10, **legend is missing the "VERIFIED — solid" line** — only shows "FIELD VERIFY — dashed", inconsistent with E-003/E-005/E-007 which both show paired legend entries (E-003 even shows it for a sheet with zero verified conductors, captioned "no E-003 conductor qualifies yet" — E-006 should do the same but doesn't). |
| 11 | YAML-to-render consistency | 1/5 | -4, cat11, whole sheet — see §0; Check G DOES cover E-006 at the SVG-text level (and passes), which is necessary but nowhere near sufficient given the PDF/PNG divergence. |
| 12 | Absence of unsupported assumptions | 1/5 | -4, cat12, whole sheet — see §0. |
| **Total** | | **74/100** | |

### Hard-fail findings
- **HF2 (package-wide, see §0), plus a smaller-scale Defect A** at the PL1/PL2/Q1-coil/S2-lamp terminal
  stubs (the `pilot()`/`coil()` glyph helpers, like E-005's glyphs, never pass `dash=`).
- **HF6 + citation misattribution — "MODBUS CROSS-REF" box.** Location: right-hand notes column,
  rendered text: *"Run/dir/freq commands reach VFD1 over RS-485 (E-007): 0x2000 cmd (STOP=1, FWD+RUN=18,
  REV+RUN=34), 0x2001 freq. P00.20=1, P00.21=2 (RS-485) verified by 2026-05-20 parameter export."*
  (`render_sheet.py` `mb_lines`, lines ~1103-1111). **None of this — the 0x2000/0x2001 register roles or
  the command-word encoding (STOP=1/FWD+RUN=18/REV+RUN=34) — appears in any YAML model file** (checked
  `devices.yaml`, `wires.yaml`, `terminals.yaml`, `sheets.yaml`, `open_items.yaml`, `e007_rs485.yaml`).
  That is a clean HF6 on its own. Separately, the citation itself is **materially wrong for half the
  claim**: I opened `GS10_actual_parameters_5.20.26.xlsx` directly — it is a **parameter** export (rows
  `00.20 Source of FREQ = 1`, `00.21 Source of OPER = 2`, confirming those two numbers) and contains **no
  command-word/register-encoding table at all**. The real source for "0x2000/0x2001 register roles,
  STOP=1, FWD+RUN=18, REV+RUN=34" is `Conv_Simple_GS10_Beginner_Verify_V2.pdf` (cheat-sheet p.1 and
  pre-download checklist p.48) plus `Prog_init_ConvSimple_v2.1.st` — neither is cited here.
  **Compounding cross-source contradiction (soft HF4):** `GS10_Integration_Guide.md` (a corpus document
  covering the same command-word encoding) states **REV+RUN = 20** ("Common Command Words" table, and
  again in its "Command values in state machine" code block), directly contradicting this sheet's "34."
  E-006 does not acknowledge this discrepancy anywhere. **Important honesty check:** I traced the fuller
  lineage and confirmed **34 is in fact the correct, bench-verified value** — `Conv_Simple_Prog_VFD_PhaseB_V1.4.st`
  documents the exact correction ("FIX 2: REV+RUN cmd word 20 -> 34. 34 = bit 5 (REV) + bit 1 (Run)"),
  and `Conv_Simple_GS10_Beginner_Verify_V2.pdf` p.1's cheat sheet states "REV + RUN | 34 ... (NOT 20!)"
  explicitly. So the number on the sheet is right — but it arrived there uncited from its real source,
  attributed instead to a document that doesn't contain it, and the sheet gives the reader no way to know
  a conflicting value exists elsewhere in the corpus, unlike E-007's own analogous corrections which get
  an explicit red "CORRECTED from May-16 draft" callout. This is a genuine honesty/completeness gap even
  though no false engineering fact reaches the reader.

### Invented / unsupported details list
1. **MODBUS CROSS-REF register/command-word block** — HF6 + mis-citation, detailed above. Values are true
   but unsourced from the model and mis-attributed to a document that doesn't contain them.
2. **devices.yaml PL1 → `CCW_VARIABLES_v4.0.txt:79`** — off-by-one citation (should be line 78). Confirmed
   via `grep -n 'O-00\|O-01' CCW_VARIABLES_v4.0.txt`. Does not affect the sheet's own printed content
   (the sheet doesn't print YAML line numbers) but pollutes the underlying evidence trail a downstream
   auditor would trust.

### Citation spot-check table (9 checked)

| Cite (as printed) | Found? | Quote from source |
|---|---|---|
| terminals.yaml outputs → "CCW_VARIABLES_v4.0.txt:78-82" (range) | FOUND | lines 78-82 (grep-confirmed) span exactly the O-00..O-04..O-06 output block |
| devices.yaml Q1 → "CCW_VARIABLES_v4.0.txt:80" | FOUND | line 80: "O-02 ... ContactorQ1 (safety power)" — exact |
| devices.yaml PL2 → "CCW_VARIABLES_v4.0.txt:79" | FOUND | line 79: "O-01 ... LightRed (fault/e-stop)" — exact (this is PL2's correct citation) |
| **devices.yaml PL1 → "CCW_VARIABLES_v4.0.txt:79"** | **WRONG LINE** | line 79 is PL2's row (LightRed); PL1/LightGreen is line 78 |
| sheets.yaml E-006 fallback note (verbatim in `fb_lines`) | FOUND | render text is a faithful word-wrapped reproduction of `sheets.yaml` E-006's `note:` field (verified diff, only drops the trailing "Correction: July-3..." sentence — an acceptable abbreviation) |
| MODBUS CROSS-REF "P00.20=1, P00.21=2 ... verified by 2026-05-20 parameter export" | PARTIALLY FOUND | xlsx confirms `00.20=1`, `00.21=2` exactly — this half of the citation is accurate |
| MODBUS CROSS-REF "0x2000 cmd (STOP=1, FWD+RUN=18, REV+RUN=34)" | **NOT FOUND in cited source; found elsewhere, uncited** | xlsx has no such table; true source is `Beginner_Verify_V2.pdf` p.1/p.48 + `Prog_init_ConvSimple_v2.1.st` L216-221 |
| open_items.yaml OI-18 fallback DI wiring (matches render's red box) | FOUND | verbatim match, see above |
| open_items.yaml OI-09 output-bank-technology conflict | FOUND (present in YAML) but **not surfaced on the sheet** | `open_items.yaml`: "+CM0/-CM0/+CM1/-CM1 polarity naming suggests DC transistor banks; devices.yaml io line says 'relay DO' — conflict" — a real, tracked open item invisible on E-006 itself |

### SVG↔PNG↔PDF divergence
§0 systemic finding applies to all 10 wires. Smaller-scale Defect A at 4 glyph terminals (PL1, PL2, Q1
coil, S2 lamp).

---

## E-007 — RS-485 / MODBUS RTU COMMUNICATION

**This is the best-behaved sheet in the package** — real verified/field_verify differentiation in the
model (3 verified links, 1 field_verify), and the one place the package properly executes the HF4
carve-out (documented supersession WITH a supersession note).

### 12-category scores

| # | Category | Score /Max | Deductions |
|---|---|---|---|
| 1 | Electrical truth & evidence | 14/15 | -1, cat1, minor: no independent third-party corroboration of readback register 0x2103 beyond internal corpus consistency (Prog_init + GS10_Integration_Guide.md agree, so this is a very small ding). |
| 2 | Technician troubleshooting readability | 10/12 | -2, cat2, §0 dash-bug still applies, but damage is narrower since 3/4 links are genuinely verified (the drawing's "everything looks solid" happens to match truth for most of the sheet) — only the SH/shield link is misrepresented. |
| 3 | Maintenance-engineer approvability | 7/8 | -1, cat3, clean, sign-off-ready, good troubleshooting section. |
| 4 | Standard symbols & reference designations | 7/8 | -1, cat4, device-block + terminal-dot style is clear but not deeply IEC-standard (reasonable for a comms sheet, no register/relay symbology applies). |
| 5 | Wire & terminal identification | 7/10 | -3, cat5, wire labels (485+, 485-, SGND) are clear and legible; SH conductor's field_verify status is the one casualty of §0 here. |
| 6 | Power/control/grounding/safety separation | 7/8 | -1, cat6, single circuit family (Modbus only) correctly scoped — sheet explicitly states "NO FWD/REV/VI/ACM/FA" and honors it; good discipline. |
| 7 | PLC I/O presentation | 8/8 | N/A — not a discrete-I/O sheet. |
| 8 | VFD power & control presentation | 8/8 | Effectively the VFD-control sheet for comms purposes — handled well: register/pin citations accurate, 120Ω termination shown, channel/node called out. |
| 9 | Cross-references & continuation markers | 6/6 | Excellent — the "CORRECTED from May-16 draft" callout is the model example of how a supersession should be surfaced; properly names its lineage (MIRA-WI-001 / CommsToVFD §2). |
| 10 | Title block, revision, notes, print-scale readability | 6/7 | -1, cat10, complete, legible; minor. |
| 11 | YAML-to-render consistency | 2/5 | -3, cat11, still fails PNG/PDF-matches-SVG for the SH link (§0); E-007 is also excluded from validator Check G entirely; severity lower than other sheets since only 1 of 4 links is actually misrepresented. |
| 12 | Absence of unsupported assumptions | 2/5 | -3, cat12, SH conductor's unverified status is invisible in the line itself; the connection table's red "field_verify" cell and the "(floated / taped at GS10)" note compensate more effectively here than elsewhere because the table is prominent and most of the sheet legitimately is verified. |
| **Total** | | **84/100** | |

### Hard-fail findings
- **HF2 (package-wide, see §0)** — narrower scope than other sheets (1 of 4 links: `SH`), but the same
  proven mechanism (0 dashed drawing items in `E-007_rs485_modbus.pdf`).
- No HF1, HF3, HF4 (uncorrected), HF5, or HF6 found specific to E-007. This sheet's own "CORRECTED from
  May-16 draft" box is the correct pattern the rest of the package should be following for its own
  cross-source discrepancies (see E-006 finding above).

### Invented / unsupported details list
NONE FOUND. Every fact checked traced accurately to `e007_rs485.yaml` and, beyond that, to the cited
source PDFs, with the one real cross-source discrepancy in this sheet's own domain (Channel 0→2, SGND
pin 1/8→3, 8N2→8N1) explicitly and correctly acknowledged.

### Citation spot-check table (8 checked, meets the ≥8 minimum)

| Cite (as printed) | Found? | Quote from source |
|---|---|---|
| e007_rs485.yaml links → "CommsToVFD 2.2" | FOUND | `Conv_Simple_CommsToVFD.pdf` §2.2 "Terminal block — Micro 820 Channel 0" table: D+/D-/SG/shield rows match wire_label/src_terminal/dst_terminal exactly |
| e007_rs485.yaml SGND → "Beginner_Verify p48 (SGND -> pin 3...)" | FOUND | `Conv_Simple_GS10_Beginner_Verify_V2.pdf` p.48 checklist: "SGND landed at GS10 pin 3 (optional but recommended)" — exact |
| e007_rs485.yaml "CommsToVFD 'pin 1/8' SUPERSEDED" | FOUND (confirms the supersession is real) | CommsToVFD §2.3: "pin 1 or 8 = SGND" — confirmed this IS the older, different claim; properly flagged superseded |
| e007_rs485.yaml channel_note "Phase-A drawing said 'Channel 0' - SUPERSEDED" | FOUND | `Conv_Simple_Prog_VFD_PhaseA.st` L10-12: "Channel 0 = onboard RS-485... read_local_cfg.Channel := 0;" — confirmed the superseded claim is real and correctly identified as obsolete |
| e007_rs485.yaml serial_config "8N1 (P09.04=12)" vs "Older ... said 8N2 (P09.04=13) - SUPERSEDED" | FOUND (both) | `GS10_actual_parameters_5.20.26.xlsx` row `09.04` Content Value = 13 (8N2 — matches the "older/superseded" snapshot); `Beginner_Verify_V2.pdf` p.1 cheat sheet: "Drive protocol (P09.04) = 12 = 8N1 RTU" (matches the corrected value) |
| e007_rs485.yaml readback "Read 0x2103 (output freq, Hz x10) via FC03" | FOUND | `GS10_Integration_Guide.md`: "0x2103 | 8451 | Output Frequency | Hz x10 | Actual motor frequency"; `Prog_init_ConvSimple_v2.1.st` L164: `vfd_frequency := read_data[4]; (* 0x2103 output freq Hz x100 *)` — minor internal scale-note inconsistency (x10 vs x100) between the two corpus docs themselves, not asserted incorrectly on the sheet (sheet doesn't state a scale for this readback) |
| open_items.yaml OI-20 "2026-05-20 export = 38.4k/8N2 vs 2026-05-26 bench sniff = 9600/8N1" | FOUND | xlsx confirms `09.01 MODBUS BaudRate` Content Value = 38.4 and `09.04` = 13(8N2) — exactly the "2026-05-20 export" snapshot described; properly flagged as an open item requiring adjudication, not silently asserted |
| e007_rs485.yaml termination "120 ohm across SG+/SG- at the drive end" | FOUND | CommsToVFD troubleshooting note + `Conv_Simple_GS10_Beginner_Verify_V2.pdf` p.1 cheat sheet: "Termination resistor | 120 Ω across D+/D- at drive end (required)" |

### SVG↔PNG↔PDF divergence
§0 systemic finding applies to the 1 field_verify link (`SH`). The 3 verified links are unaffected in
practice (they're correctly solid both in intent and in the broken renderer, coincidentally).

---

## Machine-generated matrix audit (EVIDENCE_MATRIX / CROSSREF_MATRIX / FIELD_VERIFY_LIST)

**Mechanical fidelity: CONFIRMED.** Re-ran `emit_matrices.py`; the regenerated files are byte-identical to
the committed ones (`diff` reported zero lines changed across all three files). The matrices are not
hand-edited or stale.

**10 rows sampled and independently verified against the underlying YAML / corpus** (spanning devices,
terminals, wires, pseudo-nodes, and open items across all 4 sheets): all 10 were faithful to
`model/*.yaml`. Detail: EVIDENCE_MATRIX E-003 row W306, EVIDENCE_MATRIX E-005 row W205, EVIDENCE_MATRIX
E-007 row SH, CROSSREF_MATRIX terminal rows `PLC1.O-02` and `VFD1.GND`, CROSSREF_MATRIX device row `Q1`,
CROSSREF_MATRIX pseudo-node row `output return rail (E-006)`, CROSSREF_MATRIX terminal row `PS1.+24V`,
FIELD_VERIFY_LIST wire row `W306`, FIELD_VERIFY_LIST open-item row `OI-14`.

Three **minor matrix-quality findings** (not content-accuracy errors):

1. **The "Rendered" column reports SVG-level dash status only** — e.g. EVIDENCE_MATRIX shows W306 as
   `Rendered: dashed`, which is true of the SVG source but **false of the PDF/PNG a human receives** (see
   §0). The matrix itself, not just the sheets, gives false assurance on this axis — it should either
   check the actual PDF or caveat that "Rendered" reflects SVG-only.
2. **Silent truncation with no ellipsis marker.** `emit_matrices.py`'s `build_field_verify_list()` cuts
   the Open Items table's `item`/`verify` cells at `[:50]` characters with no continuation indicator.
   Confirmed via direct grep: row OI-14 prints `"Q1 contactor placement in the power chain (assumed"` —
   cut off mid-parenthetical with no "…" — and `"Trace conductors on the bench; verify Q1 poles 1-6"` —
   cut off mid-sentence, silently dropping "actual locations. R-C surge absorber both ends recommended per
   GS10 manual." A reader cannot tell a cell is truncated versus complete.
3. **The "Type" column header is overloaded across the EVIDENCE_MATRIX's own sub-tables.** For
   E-003/E-005/E-006 it means an electrical-function type (`power_line`, `control_output`, ...); for the
   E-007 sub-table it's re-mapped to the **cable description** (`Belden 3105A pair`, `tinned drain`) —
   same header, different semantics, in the same document.

---

## Package verdict

# NOT APPROVABLE

Per the rubric: "Any hard-fail = package NOT APPROVABLE regardless of points." **HF2 is present on all
four sheets** (proven three independent ways: SVG-text inspection, PNG pixel sampling, and direct PDF
vector-drawing inspection showing zero dashed elements across all four sheet PDFs and the merged
`CV-101_print_set.pdf`). Additionally, no sheet reaches the required ≥90/100 auditor score (73, 70, 74,
84), and two clean HF6 findings (E-005 NFPA79/60204-1 claim, E-006 Modbus command-word block) plus one
soft/technical HF4 (E-006's uncited REV+RUN 20→34 correction) compound the picture. The package cannot be
"APPROVABLE WITH FIELD VERIFICATION" either, because that verdict still requires zero hard-fails — HF2 is
not a field-verification gap, it's a rendering-pipeline defect that misrepresents the verification state
of the drawing itself.

## Top-5 fixes, in priority order

1. **Fix the SVG→PDF conversion to preserve `stroke-dasharray`.** This is the single highest-leverage fix
   in the package — it resolves HF2 on 3.5 of 4 sheets in one change. `fitz`'s native SVG→PDF path drops
   dash arrays; either post-process the generated PDF to re-apply dash patterns to paths tagged
   `data-status="field_verify"` (feasible via `page.get_drawings()` + redraw, since the geometry survives),
   switch to a different SVG→PDF converter that honors `stroke-dasharray` (e.g. `cairosvg`,
   `resvg`/`rsvg-convert`, or a headless-Chromium print-to-PDF), or add a hatch/opacity/weight-based
   secondary encoding that doesn't depend on dasharray at all (e.g. render `field_verify` conductors at
   50% stroke-opacity or a lighter gray, in addition to red tags) so the signal survives even if the dash
   pipeline breaks again silently.
2. **Fix Defect A: thread `dash=not verified` through every glyph-drawing helper** (`selector`,
   `contact_no`, `contact_nc`, `pushbutton`, `photoeye`, `pilot`, `coil`) so the switch/lamp/coil-adjacent
   stub segments respect wire status instead of hardcoding solid. Without this, fix #1 alone still leaves
   E-005 and (to a lesser extent) E-006 wrong at exactly the point a technician's eye lands.
3. **Extend `validate_model.py` Check G to open the rendered PDF (not just the SVG text) and to cover
   E-005 and E-007.** Assert on `page.get_drawings()`'s `dashes` field per `data-status`-tagged path,
   the same way Check G already asserts on the SVG's `stroke-dasharray` attribute. A validator that
   reports "ALL CHECKS PASSED" while the deliverable is 100% broken on this axis is worse than no
   validator — it manufactures false confidence.
4. **Move the E-006 "MODBUS CROSS-REF" register/command-word block into the model** (a new field on
   `sheets.yaml` E-006 or a small `model/e006_modbus_xref.yaml`, mirroring how `e007_rs485.yaml` already
   does this for E-007), citing its real sources (`Conv_Simple_GS10_Beginner_Verify_V2.pdf` p.1/p.48,
   `Prog_init_ConvSimple_v2.1.st`) instead of the parameter-export citation that doesn't contain the
   command-word encoding. While there, add a red "CORRECTED" callout for REV+RUN 20→34 in the same style
   E-007 already uses for its own corrections — the value is right, but the sheet should show its work
   the way its sibling sheet does. Fix the same way for E-005's "NFPA 79 / EN 60204-1, stop cat 0/1" claim:
   either find and cite a real source, or delete the standard-number/category specificity and keep only
   the YAML-backed general claim ("a monitored input is NOT a safety stop").
5. **Fix the devices.yaml PL1 citation** (`CCW_VARIABLES_v4.0.txt:79` → `:78`) and add an ellipsis marker
   to `emit_matrices.py`'s silent truncations (`item_text[:50]` / `verify[:50]` in
   `build_field_verify_list()`) so a reader can tell a cell is cut off. Both are small, but they're exactly
   the class of paper-cut that erodes trust in an otherwise well-sourced package once a reader finds one.
