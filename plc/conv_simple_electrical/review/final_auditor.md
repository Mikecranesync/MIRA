# CV-101 Electrical Print Package — Evidence & Hallucination Auditor Report (DRAFT — pending sub-audit integration)

Role: Evidence & Hallucination Auditor. Deep-dive categories 1, 11, 12 + ALL hard-fails.
Scope: all 9 sheets (E-001..E-009), SVG+PNG+PDF each.
Package: `C:\wt-phase0\plc\conv_simple_electrical\`

Method note: matrices in `review/` (EVIDENCE_MATRIX.md, CROSSREF_MATRIX.md, FIELD_VERIFY_LIST.md)
read and spot-checked (10 rows) against source YAML — 10/10 faithful mirror (emit_matrices.py only
truncates via `source[:20]`/`notes[:30]`, does not fabricate). reviewer_*.md and GRADES_*.md were
NOT read, per instructions. V2_TO_V3_CHANGES.md was read (permitted) — it establishes the V3.3
package (5 sheets: E-001,E-003,E-005,E-006,E-007) predates E-002/E-004/E-008/E-009 and predates the
V4/V5/V6 photo-evidence rounds and the OI-21/OI-27 resolutions entirely; its "unanimous APPROVABLE
WITH FIELD VERIFICATION" mention is therefore NOT evidence about the current 9-sheet package and was
not relied on.

## Independently verified (auditor's own primary-source tracing, before sub-audits)

- `validate_model.py` re-run by auditor: **ALL 12 CHECKS PASS** (A-L). Check G breakdown:
  `E-003:12/12 E-004:6/6 E-005:8/8 E-006:10/10 E-007:4/4` — confirms **E-002 is excluded from the
  automated solid/dashed conductor audit** (see Finding F2 below).
- GS10_UM.txt citations in `terminals.yaml`/`sheets.yaml` E-003 spot-verified line-by-line via grep:
  L1758 (CB1 required), L1760-61 (PE ≤0.1Ω), L1773-1776 (motor lead swap), L1792 (ground both ends
  shield), L1811-1813 (never start/stop via input power), L1824-1826 (+1/+2 DC reactor), L1842 (B1/B2
  brake resistor), L1844 (DC- leave open), L1971/1973 (R/L1,S/L2/T/L3), L1975 (U/T1,V/T2,W/T3),
  L1977-1978 (+1/+2), L1980 (B1/B2), L1982 (DC+/DC-), L1984 (Ground), L1986 (120VAC note) — **every
  one precisely accurate to the exact line number.** Excellent citation discipline on this sheet.
- `Prog_init_ConvSimple_v2.1.st` verified directly: line 219 `vfd_cmd_word := 34; (* REV+RUN *)`
  confirms e007's "34 NOT 20" supersession claim; line 128/238 `Channel := 2`; line 214
  `vfd_run_permit := _IO_EM_DO_02 AND e_stop_ok AND NOT pe_latched` confirms devices.yaml's exact
  line-214 citation for O-02; lines 205-206 confirm dir_fwd/dir_rev on I-00/I-01; lines 208-212
  confirm photo-eye/pe_latched on I-05/I-04.
- `GS10_actual_parameters_5.20.26.xlsx` (2026-05-20 export) dumped via openpyxl and cross-checked:
  P00.01=1.60A, P00.20=1, P00.21=2, P09.01=38.4 (kbps), P09.02=0, P09.03=5.0, P09.04=13 (8N2),
  P02.00-P02.09 ALL Content==Default (factory default) — **every one of these exact figures matches
  the model's claims precisely**, including the OI-20 "38.4k/8N2 export vs 9600/8N1 bench" tension
  and the E-006 "P02.0x at factory default" claim. Excellent, falsifiable, verified evidence chain.
- `CCW_VARIABLES_v4.0.txt` verified directly (I-00..I-11, O-00..O-06 table, lines 67-82) — matches
  terminals.yaml I/O map exactly, INCLUDING the honestly-disclosed I-05 "Entry sensor (spare)" vs
  live photo-eye supersession (OI-13) — a documented supersession, not a hidden contradiction (HF4
  compliant).
- render_sheet.py mechanics verified: `_emit()` uses PyMuPDF (`fitz`) to parse the authored SVG once
  and derive BOTH the PDF (`convert_to_pdf()`) and the PNG (render page 0 of the SAME doc object) —
  meaning PDF and PNG share one rendering pass and should never diverge from EACH OTHER; the live
  divergence risk is SVG-source vs MuPDF's-interpretation-of-it, not PDF-vs-PNG. Dashing is
  implemented as REAL discrete short `<line>` segments (`SVG.line(dash=True)`, on=7px/off=4px, forced
  >=3 segments even on short runs) specifically because "PyMuPDF drops stroke-dasharray" (source
  comment) — a deliberate, documented HF2 mitigation. All 27 sheet artifacts (svg+png+pdf x9) share
  file-mtimes within one ~7s window — confirmed single render run, no stale-artifact risk.
- validate_model.py Check K (render-only engineering text blocklist) re-verified by independent grep
  across ALL string literals in render_sheet.py for a broader numeric/unit pattern than the
  blocklist covers. No invented/uncited numeric engineering facts found. Two instances of
  **hand-typed-but-currently-accurate** strings noted as a process/drift-risk observation (not HF6,
  since both currently match their YAML source): `"230 V 1φ SUPPLY"` (E-003 SUPPLY node label, matches
  wires.yaml/sheets.yaml text) and `"+24V-bus"`/`"0V-bus"` (E-004 DB1 rail labels, matches
  terminals.yaml DB1 proposed ids) are typed directly in Python rather than read programmatically
  from the YAML dict at that call site — currently correct, but nothing would catch future drift
  since neither string is on the K_BLOCKLIST.
- Photos independently viewed by auditor: `wire_2.jpg` (PS1 nameplate — confirms "24V/1.0A",
  "100-240VAC 0.55A 50/60Hz", "+V -V DC OK"/"⏚ N L" terminals, "MW MEAN WELL" logo verbatim; also
  independently confirms OI-23 Siemens CPU1212C and OI-24 "PMC"/"192." sticky note are accurate
  reads), `wire_1.jpg` (DB1 — WAGO-style push-in block, bare-copper jumper top-left plausible, mixed
  blue/beige/reddish conductors, consistent with hedged claims), `mlc_full.jpg` +
  `mlc_top_terminals.jpg` + `mlc_bottom_terminals.jpg` (Q1/MLC — ALL terminal-id text
  13NO/21NC/31NC/43NO/+A1 top and 14NO/22NC/32NC/44NO/-A2 bottom, "Schneider Electric", "CA3KN22BD",
  "24V", "1,3 N.m Max" verbatim-confirmed; which specific contacts carry conductors is genuinely hard
  to adjudicate from a static photo — matches the model's own hedged "destinations not traceable"
  language, i.e. the model does NOT overclaim beyond what the photo shows), `gs10_control_terminals.jpg`
  (confirms top FWD/REV/DI3-5/+24V/DCM row is cleanly EMPTY across all 9 positions; bottom
  +10V/ACM/AI/AO1/DO1/DOC/PE row shows at least some wire presence, exact terminals unclear —
  consistent with the model's own "not fully traceable" hedge).

## HEADLINE FINDING — OI-27 "technician-confirmed" is not supported by its own cited source

**Classification: HF1 (unsupported/invented specific fact) with HF4 overtones (unacknowledged
contradiction with the cited prior-evidence document). Appears on E-002, E-003, and E-009.**

`model/open_items.yaml` OI-27:
> "RESOLVED (2026-07-11): motor is 230 V (technician-confirmed) — the GS10 is a standard 230 V
> 1φ-in / 230 V 3φ-out drive; the earlier reported 480 V was a misstatement."

Same claim, same date, repeated in `devices.yaml` (M1: "230 V 3~ ... voltage technician-confirmed
2026-07-11"; VFD1: "motor is 230 V, technician-confirmed 2026-07-11"), `sheets.yaml` E-002 segment
source ("motor voltage technician-confirmed 2026-07-11 (OI-27 resolved)"), and E-003
`annotations.notes` ("...230 V 3φ to a 230 V motor (technician-confirmed 2026-07-11).").

The ONLY cited source for this claim, `review/PHOTO_EVIDENCE_V6.md` (same date, 2026-07-11), says
the OPPOSITE. Full quotes:
- What Mike (the technician) actually stated, item 5: *"(Flagged, see below) 'the drive is
  converting it to 480 V output.'"*
- V6.md's own resolution at the time, verbatim: *"Mike reported 230 V in / 480 V out. A standard
  PWM VFD (incl. the GS10) cannot boost output above its input... Drawn on V6: input = 230 V 1φ (per
  technician), output voltage = CONFIRM (new open item OI-27) pending the motor nameplate voltage
  and the exact GS10 model. **Not encoding "480 V out" as verified until confirmed** — a wrong
  voltage on a power print misleads a troubleshooter."*

No other repo artifact (no V7 doc, no motor-nameplate photo, no updated field note) shows the
technician subsequently confirmed 230V or retracted the 480V statement. The 230V figure is the model
author's own (sound) engineering deduction — a 230V single-phase-input GS10 physically cannot output
480V — but the resolution text inverts the record: it credits the technician with confirming a
number he never stated, and dismisses what he DID say as an unevidenced "misstatement." An engineering
deduction correctly overriding an implausible field report is legitimate methodology — but it must be
labeled as what it is, not mislabeled as field confirmation. [PENDING: exact rendered-sheet quotes
and severity assessment from Fork A (E-002/E-003) and Fork C (E-009) to be merged here.]

Contrast with **OI-21**, which IS legitimately resolved: V6.md documents Mike's direct, unambiguous
statement ("MLC1 sits between the main service breaker and the VFD supply. When its coil energizes,
it supplies the incoming voltage to the VFD") — genuine field authority, correctly closed.

## Finding F2 — E-002 is invisible to the automated solid/dashed (HF2) audit

`validate_model.py`'s `SHEET_SVGS` dict (Check G) covers only E-003/E-004/E-005/E-006/E-007 — **not
E-002**. All 5 segments in `model/e002_oneline.yaml` are `evidence: field_verify` (none verified).
Code review of `render_e002()`/`_oneline_run()` shows the dash logic IS correctly wired to
`seg.get("evidence") == "verified"` per-segment (same real-multi-segment dash technique used
elsewhere) — so it should be correct by construction — but this is a genuine, undisclosed gap in
mechanical enforcement: nothing in CI would catch a future regression that draws an E-002 conductor
solid. The code comment's justification ("no wire numbers by design") conflates "no per-conductor
wire-number labels" (true, intentional) with "no solid/dashed verified-status semantics" (false —
`e002_oneline.yaml`'s own `convention:` field commits to identical solid/dashed semantics as every
other sheet). [PENDING: Fork A's empirical confirmation that all 5 E-002 segments actually render
dashed in the shipped SVG/PNG/PDF.]

## Finding F3 — CCW_VARIABLES_v4.0.txt citation-line errors (PL1, S2)

Verified via `grep -n` against the real file: line 78 = O-00/LightGreen, line 79 = O-01/LightRed,
line 80 = O-02/ContactorQ1, line 81 = O-03/PBRunLED, line 73 = I-04/PBRun. But `devices.yaml` cites:
- **PL1** ("load of O-00 LightGreen") → cites `CCW_VARIABLES_v4.0.txt:79` — **wrong, that's
  O-01/LightRed. Should be line 78.**
- **PL2** ("load of O-01 LightRed") → cites `:79` — **correct.**
- **S2** ("Run/rearm PB to I-04 ... lamp fed by O-03 PBRunLED") → cites `:80` — **wrong, that's
  O-02/ContactorQ1, unrelated. Should be line 73 and/or 81.**

Not HF1 (the underlying facts — O-00=LightGreen, O-03=PBRunLED — are true and present a line or two
away in the same file) but a real category-1 evidence-precision defect: "every verified claim
carries a source cite reachable from the sheet" is violated at the literal citation level even
though the fact itself is correct. [PENDING: Fork B confirmation of whether this mis-numbered cite
is ever printed verbatim on the rendered E-006 sheet, or is purely a YAML/audit-trail issue.]

## Package-level completeness (combined `CV-101_print_set.pdf`)

Verified via fitz: **9 pages, uniform 1600x1040 page size, correctly ordered E-001→E-009, each page
self-identifies with matching "N of 9" text** (1 of 9 through 9 of 9, sequential, no gaps/dupes/
misorders). Confirms package-level category-10 completeness at the combined-artifact level.

## Per-sheet scores and HF findings

### E-001 — Cover / Legend / Device Schedule — 99/100 — 0 HF
All 14 schedule rows trace to devices.yaml; all 9 index rows to sheets.yaml; wire-key = wires.yaml
`convention` verbatim; safety box matches E-001 annotations (LOTO black, "monitored e-stop NOT a
safety stop" red). PNG clean, no clipping, "1 of 9"/REV A/2026-07-11 correct.
- Deduction: -1 cat2, device-schedule Model/Role columns truncated with "..." (full text on per-device
  sheets — acceptable, minor lookup friction).
- Cats 5/6/7/8 N/A=full (cover/legend sheet, no conductors/circuit-family/PLC-I/O/VFD detail).
- HF: NONE. Invented/unsupported: NONE. **Verdict contribution: APPROVABLE.**

### E-002 — Power One-Line — 100/100 — 0 HF
**Special-scrutiny A (validator's E-002 dash gap) — CLEAN, no HF2.** Fork A directly inspected the
SVG: all 5 field_verify segments render as real `<g data-dashed="true">` multi-segment groups; the
only solid `<line>` elements are device-glyph stubs (no `data-wire`) — correct. Verified at PDF vector
level: SOURCE→CB1 run reproduces as 7 discrete short PDF segments at exact SVG coords (not a collapsed
solid); PNG shows real dash gaps. Finding F2's regression *risk* stands (E-002 still has no automated
CI guard), but the shipped artifact is correct.
- **E-002 does NOT print the OI-27 false claim on its face.** Its only "technician-confirmed" text is
  "Supply is 230 V SINGLE-PHASE (2-wire), technician-confirmed" — that refers to INPUT phase count,
  which Mike genuinely stated (V6.md item 2) and is TRUE. The VFD1→M1 label is just "230 V 3φ motor
  output (U/T1,V/T2,W/T3)" with no confirmation language. The YAML `source:` misattribution does not
  render.
- Cats 5/7/8 N/A=full (sheet's own stated design: "Summary sheet only — no wire numbers assigned").
- HF: NONE. Invented/unsupported: NONE. **Verdict contribution: APPROVABLE.**

### E-003 — VFD Power — 96/100 numeric, but HARD-FAILED (HF1) → NOT APPROVABLE
Exceptional evidence discipline everywhere EXCEPT the OI-27 claim. Fork A independently re-verified
every GS10_UM.txt line cite on the sheet against the source — all exact to the line number (matches my
own trace). All 12 connection-table wires + 10 VFD1/Q1 terminal ids clean vs terminals.yaml/wires.yaml.
PE bus (W315/316/317) visually distinct/orthogonal with dedicated IEC earth glyph — no HF3. Category-8
VFD presentation is textbook (terminals verbatim, +1/+2 jumper glyph + B1/B2 + DC+/DC- shown WITH
state, control-source correctly deferred to E-007). PNG: no clipping/overlap/off-frame.
- **HF1 (+HF4 cross-note): E-003 PRINTS the OI-27 false claim, UNHEDGED.** SVG lines 316-317 / PNG
  NOTES box, verbatim: *"Supply is 230 V SINGLE-PHASE (2-wire); drive output = 230 V 3φ to a 230 V
  motor (technician-confirmed 2026-07-11)."* Rendered in the **same plain black NOTES typography as
  the sheet's genuinely well-sourced facts** — NOT in the red caveat-box styling the same sheet uses
  elsewhere for exactly this kind of hedge ("Bench supply voltage & phase count... NOT DOCUMENTED").
  A technician reading E-003 cold would take the 230V output as field-confirmed fact. It is not (see
  Headline Finding). The dashed M1 conductors do NOT hedge this — dash = "routing unconfirmed", not
  "voltage contested"; orthogonal concerns.
- Deductions (numeric, shown for completeness though HF overrides): -1 cat10 (title-block lineage
  clause "terminals per GS10 UM 1st Ed Rev B;" reads truncated); -3 cat12 (confident
  "(technician-confirmed)" tone on a fact its own source contests — exactly category 12's concern).
  cat1 kept at 15/15 because the defect is booked as HF-class per rubric §deduction-discipline, not
  double-counted as a category deduction.
- Cat 7 N/A=full (no PLC I/O belongs on a VFD power sheet).
- Invented/unsupported: 1 item (the technician-confirmation attribution for motor output voltage).
- **Verdict contribution: NOT APPROVABLE** (hard-fail present; overrides the 96 numeric).

### E-004 — 24 VDC Control Power — 91/100 — 0 HF (one HF5-adjacent defect)
**Special-scrutiny A (DB1/PS1 "verified" justification): sound.** All 6 conductors (W400-W405) render
dashed/red (field_verify) — verified at PDF vector level (W401=5-seg, W404=22-seg discrete dash runs).
PS1/DB1 device OUTLINES solid (device existence genuinely verified from wire_2.jpg nameplate, which I
independently confirmed), while DB1's `+24V-bus`/`0V-bus` proposed rail ids are red-caveated FIELD
VERIFY (OI-25). PS1's PE/DC-OK terminals honestly marked "(not drawn)". No overclaim of internal
polarity.
- **Confirmed defect (booked HF5-adjacent, scored as heavy deduction not hard-fail): renderer silently
  truncates a source string.** `render_sheet.py:1566` hard-slices `dev_by_tag["PS1"]["model"][:44]`
  with no wrap/ellipsis → the PS1 symbol prints *"Mean Well DIN-rail supply (24 V / 1.0 A; 100"* —
  cut mid-token, no closing paren. I independently confirmed both the `[:44]` slice and that the
  devices.yaml PS1 string is 120+ chars. Not scored as HF5 because the FULL correct text is printed
  legibly in the red caveat box lower on the same sheet (no technician misled), but rubric cat-10
  "all text legible at 100% zoom" is arguably violated by a sentence that just stops. Recommend fix.
- Deductions: -1 cat1 (DB1 rail bars solid though field_verify — defensible as device-body glyph +
  red-caveated, close call), -1 cat2 (no explicit READS meter-walk, unlike E-005), -2 cat10 + -1 cat11
  (the truncation). Cats 7/8 N/A=full.
- HF: NONE (hard-fail severity). Invented/unsupported: NONE.
- **Verdict contribution: APPROVABLE WITH FIELD VERIFICATION** (fix the truncation before "done").

### E-005 — PLC Digital Inputs — 99/100 — 0 HF (strongest sheet in package)
Fork B independently verified Prog_init_ConvSimple_v2.1.st:205-212 matches every I-00/I-01/I-04/I-05
claim exactly (matches my own trace). All 8 wires (W0V/W24/W500-W505) field_verify → zero solid
`data-wire` lines (correct); W24 rail = 32 discrete PDF dash segments. **HF4 documented-supersession
test: CLEAN** — the I-05 "Entry sensor (spare)" (CCW v4.0) vs live photo-eye conflict is printed in
full, in red, with the OI-13 citation — required honesty, not a contradiction. READS meter-lead walk
complete and unambiguous (cat2 12/12).
- Deduction: -1 cat4 (selector-switch actuator uses "∓" glyph rather than a conventional IEC selector
  tick — consistent, minor style note).
- HF: NONE. Invented/unsupported: NONE.
- **Verdict contribution: APPROVABLE WITH FIELD VERIFICATION.**

### E-006 — PLC Outputs — 90/100 numeric, but HARD-FAILED (HF6) → NOT APPROVABLE
**SECOND HARD FAIL (independently re-verified by me against render_sheet.py + model grep).**
- **HF6: render-only engineering claim with no model backing.** `render_sheet.py:1400` hardcodes
  `lineage="output map CCW v4.0 + live Prog_init; O-02 do-not-reuse (WI-001 p.4)"` — printed into the
  E-006 title block (confirmed present in the delivered SVG/PNG/PDF; `"O-02 do-not-reuse" in
  page.get_text()` → True). I grepped all 7 model YAML files: the ONLY "WI-001 p.4" reference is
  `sheets.yaml:146` ("WI-001 p.4 says relay dry contacts") — a DIFFERENT claim about output-bank
  technology. **"O-02 do-not-reuse" exists nowhere in the model.** It is a distinct, citation-bearing
  engineering constraint typed straight into the renderer — exactly what HF6 forbids ("the render may
  layout/abbreviate, never originate facts"). **Compounding process finding:** validate_model.py Check
  K's blocklist (`NFPA,0x20,P00.,P09.,L17,L19,kbps,8N1,8N2,REV+RUN,DC-bus,LOTO`) contains no token
  that matches "do-not-reuse"/"WI-001", so the only automated guard against this defect class reports
  PASS while the defect ships. Fix is narrow: delete the fragment from render_sheet.py:1400, OR add
  the claim to sheets.yaml E-006 annotations with a real citation and pull it from there.
- Otherwise excellent: Q1/MLC device (Schneider CA3KN22BD, coil A1/A2←O-02, NO 13-14/43-44) verbatim
  from photos I independently confirmed; the "Q1 is NOT an NFPA-79/EN-60204-1 safety-rated disconnect"
  safety note renders clearly (HF3-clean); P00.20=1/P00.21=2/P02.0x-default all match the xlsx I
  dumped; W603 (Q1 coil) dashed as real PDF segments.
- Fork B independently re-derived Finding F3 (PL1 miscites CCW:79 s/b :78; S2 miscites CCW:80 s/b
  :73/:81 — true facts, wrong line, cat-1 precision defect, does NOT print on sheet face).
- Scores (informational, HF overrides): cat11 0/5, cat12 4/5, cat8 6/8; else strong. 90/100 moot.
- Invented/unsupported: 1 item ("O-02 do-not-reuse (WI-001 p.4)").
- **Verdict contribution: NOT APPROVABLE** (hard-fail HF6).

### E-007 — RS-485 / Modbus RTU — 100/100 — 0 HF
All 12 categories scored (conductor-bearing). Fork C independently re-verified 8 cites to exact source
line numbers (Channel 2 = Prog_init:128/238; RJ45 pinout = Integration_Guide §3; REV+RUN=34 =
Prog_init:219; FWD+RUN=18 = Prog_init:217; OI-20 38.4k/8N2 = xlsx P09.01/P09.04; Hz×100 =
Prog_init:164) — all exact. **Dash fidelity proven at PDF vector level:** 485+/485-/SGND (verified)
each render as ONE continuous 500→1090 segment (solid); SH (field_verify) renders as 9 discrete short
segments — real gaps in the PDF, not cosmetic. Documented supersession caveat ("Channel 0→2, pin1/8→3,
8N2→8N1") present and legible (HF4-compliant). HF: NONE. Invented: NONE. **APPROVABLE.**

### E-008 — Terminal Strip (X1) + Wire List — 100/100 — 0 HF
**Special-scrutiny A (table fidelity): Fork C read ALL 40 rows (not just 10) and cross-checked every
one against wires.yaml/e007_rs485.yaml — 40/40 exact** (wire#, from, to, signal, sheet, status). Row
count on rendered table = exactly 40 (12 E-003 + 6 E-004 + 8 E-005 + 10 E-006 + 4 E-007). **Color audit
confirmed:** the 3 verified E-007 rows render `#111111` black; all 37 field_verify rows render
`#C0392B` red — matches the sheet's stated convention. No truncation/overlap/cutoff. Cats 4/5/6/7/8
N/A=full (generated cross-family audit table, draws no conductors/devices of its own — sheet says so).
HF: NONE. Invented: NONE. **APPROVABLE.**

### E-009 — Open Items / Field Verification — 89/100 numeric, but HARD-FAILED (HF1) → NOT APPROVABLE
**Special-scrutiny B (OI-21/OI-27 legitimacy): OI-21 legitimately resolved** (V6.md item 1 = Mike's
direct statement on MLC placement — correctly closed). **OI-27 is the second rendered surface of the
Headline Finding.** Fork C read the actual E-009 SVG/PNG: OI-27's row renders GRAYED (via
`render_e009()` `color_fn`, which grays any Item starting with "RESOLVED"), printing verbatim:
*"RESOLVED (2026-07-11): motor is 230 V (technician-confirmed) — the GS10 is a standard 230 V 1φ-in /
230 V 3φ-out drive; the earlier reported 480 V was a misstatement..."* **On the rendered docket, OI-27
is visually and textually indistinguishable from the legitimately-resolved OI-21** — same gray, same
"RESOLVED (date):" phrasing, same confident tone, no hedge anywhere on E-009. A plant engineer signing
the docket gets zero cue that one resolution rests on a direct quote and the other on an inference that
contradicts the quote it cites. Sharpest irony: E-009's own printed NOTES state the very standard
OI-27 violates — *"Closing an open item requires evidence... not a re-assertion."* Header count "27
open items; 2 resolved" is arithmetically correct (OI-21, OI-27).
- Deductions: -8 cat1 (OI-27 asserts unsupported "technician-confirmed"); -3 cat12 (confident RESOLVED
  tone, no hedge). Cats 4/5/6/7/8 N/A=full (pure text docket). Numeric 89/100.
- **HF1 (+HF4): OI-27 "technician-confirmed" — unsupported, contradicts its own cited source, silently
  overwritten (not a documented supersession).**
- Invented/unsupported: 1 item (OI-27 technician-confirmation attribution). Nothing else on E-009.
- **Verdict contribution: NOT APPROVABLE** (hard-fail; overrides 89 numeric).

## Consolidated per-sheet scorecard

| Sheet | Title | Score | Hard fail | Verdict |
|---|---|---|---|---|
| E-001 | Cover / legend / schedule | 99/100 | — | APPROVABLE |
| E-002 | Power one-line | 100/100 | — | APPROVABLE |
| E-003 | VFD power | 96 (moot) | **HF1 (+HF4)** | **NOT APPROVABLE** |
| E-004 | 24 VDC control power | 91/100 | — | APPROVABLE W/ FIELD VERIFY |
| E-005 | PLC digital inputs | 99/100 | — | APPROVABLE W/ FIELD VERIFY |
| E-006 | PLC outputs | 90 (moot) | **HF6** | **NOT APPROVABLE** |
| E-007 | RS-485 Modbus | 100/100 | — | APPROVABLE |
| E-008 | Terminal strip + wire list | 100/100 | — | APPROVABLE |
| E-009 | Open items / field verify | 89 (moot) | **HF1 (+HF4)** | **NOT APPROVABLE** |

Package score = min sheet score. **Hard fails: 2 distinct root defects across 3 sheets** (the OI-27
defect surfaces on both E-003 and E-009; the HF6 defect on E-006).

## Consolidated hard-fail / invented-content ledger

| # | Class | Sheet(s) | Element | Evidence | Fix |
|---|---|---|---|---|---|
| 1 | HF1 + HF4 | E-003, E-009 | OI-27 "motor is 230 V (technician-confirmed 2026-07-11)" / E-003 NOTES "230 V 3φ to a 230 V motor (technician-confirmed)" | Sole cited source PHOTO_EVIDENCE_V6.md says the technician stated **480V out** and explicitly withholds confirmation ("Not encoding '480 V out' as verified until confirmed"). 230V is the author's own (correct) engineering deduction, mislabeled as field confirmation; the real technician statement is silently overwritten, not adjudicated as a supersession. | Relabel as an OPEN item / engineering-inference (not "technician-confirmed"); OR genuinely confirm via motor nameplate + exact GS10 model, then cite that. |
| 2 | HF6 | E-006 | Title-block lineage "O-02 do-not-reuse (WI-001 p.4)" | render_sheet.py:1400 string literal; grep of all 7 model YAML shows no "do-not-reuse" anywhere and WI-001 p.4 is cited in the model only for a different ("relay dry contacts") claim. Render originates a cited engineering fact. Check-K blocklist misses it. | Delete the fragment from render_sheet.py:1400, OR move the claim into sheets.yaml E-006 annotations with a real citation. Add "do-not-reuse"/"WI-001" to Check-K. |

**Everything else in the 9-sheet package is genuinely well-grounded.** No other invented conductors,
terminals, devices, voltages, or fault codes were found across ~40 conductors, ~90 terminals, 14
devices, and all annotation text. GS10_UM.txt line citations (E-003/E-007), Prog_init/CCW_VARIABLES
citations (E-005/E-006), and the GS10 parameter xlsx (E-006/E-007) are exact and falsifiable. Dash
truth survives to the PDF vector layer on every wired sheet (HF2 mitigation works). No HF3 safety
ambiguity, no HF5 clipping/off-frame content (the E-004 PS1 truncation is a bounded sub-HF5
string-slice defect, mitigated by full text elsewhere).

## Secondary (non-blocking) findings for the fix pass

- **F2 — validator gap:** E-002 is excluded from Check G's automated solid/dashed audit (SHEET_SVGS
  omits it). The shipped E-002 artifact is correct (verified by hand), but no CI guard protects it.
  Add E-002 to SHEET_SVGS (its e002_oneline.yaml segments key on `evidence`, so the check needs a
  small adapter) — or accept the documented risk.
- **F3 — citation line drift:** devices.yaml PL1 cites CCW_VARIABLES_v4.0.txt:79 (should be :78);
  S2 cites :80 (should be :73/:81). True facts, wrong line addresses. Does not render on the sheet
  face. Cat-1 precision cleanup.
- **E-004 truncation:** render_sheet.py:1566 `[:44]` slice mutilates the PS1 model string on the
  sheet face. Cosmetic (full text in caveat box) but unprofessional. Wrap or widen.
- **Check-K brittleness:** the blocklist is a hardcoded 11-substring list; the HF6 defect proves it
  can't catch novel render-only facts. Consider an inversion (assert lineage/annotation strings are
  pure provenance) rather than an ever-growing denylist.

## Verdict

**PACKAGE: NOT APPROVABLE.** Two independent, primary-source-confirmed hard fails:
1. **HF1 (+HF4) on E-003 & E-009** — the OI-27 "technician-confirmed" 230V motor-output attribution
   is contradicted by its own and only cited source (PHOTO_EVIDENCE_V6.md), which records the
   technician stating 480V and explicitly declining to confirm the output voltage. Printed unhedged
   on E-003 (NOTES, plain black) and rendered as a fully-"RESOLVED" gray docket row on E-009,
   indistinguishable from the legitimately-closed OI-21.
2. **HF6 on E-006** — "O-02 do-not-reuse (WI-001 p.4)" is a citation-bearing engineering claim that
   exists only in render_sheet.py, with zero model backing, and slips past the validator's Check-K.

Per the rubric ("Any hard-fail = package NOT APPROVABLE regardless of points"), either alone blocks
the package. Six of nine sheets (E-001/E-002/E-004/E-005/E-007/E-008) are clean and would be
APPROVABLE / APPROVABLE-WITH-FIELD-VERIFICATION on their own — the package is close, and both defects
are narrow, well-localized, and cheap to fix. After fixing both (and ideally the 4 secondary items),
a re-audit should reach **APPROVABLE WITH FIELD VERIFICATION** (all remaining unknowns are honestly
open-itemed and dashed).

**Note on the honesty of the package:** apart from the two defects, this is an unusually
well-disciplined evidence package — status bands, dashed-until-verified conductors, real
per-line-number citations, honest supersession notes (I-05, Channel-0→2, pin-1/8→3, 8N2→8N1), and a
27-item open-items docket. The two hard fails are precisely the two places where an authored
narrative got ahead of the cited evidence — which is exactly what this audit exists to catch.

---

# RE-AUDIT (2026-07-11, post-cleanup) — verifying the claimed fixes to HF-A and HF-B

Scope: verify HF-A (OI-27 provenance) and HF-B (E-006 render-only fact) are genuinely fixed; sweep
for any NEW defect the cleanup introduced; HF1-HF6 pass over the changed content only (git diff
against HEAD `527b74c7`, working tree uncommitted); re-score E-003/E-004/E-006/E-009.

## HF-A (OI-27 provenance) — CLEARED

Read `review/PHOTO_EVIDENCE_V7.md` directly: it records a distinct 2026-07-11 confirmation —
technician asked point-blank whether the reported 480V held, replied **"it's 230."** — dated,
attributed, in the same evidentiary style as V4/V5/V6. Legitimate record.

Grepped every artifact my original flag named:
- `open_items.yaml` OI-27 `verify:` — now cites `review/PHOTO_EVIDENCE_V7.md §3 ('it's 230')`, and
  explicitly disclaims V6 ("not PHOTO_EVIDENCE_V6.md, which predates this confirmation").
- `devices.yaml` VFD1 note + M1 `source:` — both cite V7 explicitly for the 230V claim; VFD1 note
  explicitly disclaims V6 too.
- `sheets.yaml` E-003 caveat — cites V7 for the 230V claim. E-003's `sources:` list still carries V6,
  but now scoped correctly to the DIFFERENT fact V6 legitimately supports (single-phase supply
  topology / OI-21) — not reused as backing for the 230V/OI-27 claim. No conflation.
- `e002_oneline.yaml` VFD1→M1 segment `source:` — cites V7 explicitly, disclaims V6 inline.
- Rendered proof: viewed `E-009_open_items.png` — OI-27's row (grayed/RESOLVED) prints the V7 citation
  verbatim on the actual docket a technician/engineer would sign. Viewed `E-003_vfd_power.png` —
  SOURCES box lists both V6 (supply topology) and V7 (230V output, OI-27 resolved) as separate,
  correctly-scoped lines.

**Citation chain is sound.** Every instance of the specific 230V/OI-27 claim now traces to V7; V6 is
never reused as backing for that specific claim.

## HF-B (E-006 render-only fact) — CLEARED, mutation-tested

`git diff` against HEAD confirms the exact fix: `render_sheet.py` E-006 title-block call changed
`lineage="output map CCW v4.0 + live Prog_init; O-02 do-not-reuse (WI-001 p.4)"` (hardcoded literal)
→ `lineage=_sheet_row("E-006").get("lineage", "")` (pulled from the model). Same treatment applied to
E-007 (`lineage="recovers MIRA-WI-001 / Conv_Simple_CommsToVFD §2"` → model lookup), which had the
identical defect shape though it wasn't named in my original flag.

Grep of `render_sheet.py` for `do-not-reuse|WI-001 p\.4|must never be reused|reuse` → **0 matches.**
The fact now lives in `sheets.yaml` E-006 `annotations.safety`, fully cited: *"O-02 is the sole
MLC/Q1 drive-enable coil output — do not reuse it for any other load (MIRA_PLC_WorkInstruction_v3.pdf
§3: 'DO_02 is already the MLC drive-enable coil and must never be reused')."* Confirmed rendered
verbatim in the SAFETY box on `E-006_plc_outputs.png`; the title block now prints a short pointer
("...— see SAFETY") instead of a standalone unbacked citation.

**Mutation test:** edited `render_sheet.py`'s E-001 lineage literal to append `do-not-reuse`, re-ran
`validate_model.py` → **Check K correctly FAILED**, citing `render_sheet.py:681` and both matched
markers. Reverted the edit; re-ran → clean 12/12 PASS, `git diff --stat` back to the pre-mutation
17ins/3del baseline. Check K is a real, working guard, not decorative.

## New citations added by the cleanup — all verified real

- `GS10_UM.txt` L1754-1757 — read directly: verbatim matches the new E-003/E-006 "do not use a power
  circuit contactor... only in emergency situations" caution. L1811-1813 (pre-existing cite, now
  cross-referenced as "same caution") — also verbatim-confirmed.
- CA3KN22BD Ith=10A / AC-15,DC-13 (`devices.yaml` Q1 "CR-2" note) — confirmed **true** against
  Schneider's own product pages (se.com + 3 distributors, via web search): Ith=10A, AC-15/DC-13,
  2NO+2NC, 24VDC coil — exact match. Not itself cited to a source in the package (no datasheet in the
  corpus), but this text is NOT rendered on any sheet (grepped all SVGs for "Ith"/"AC-15"/"CR-2" — 0
  hits) — internal model note only, no sheet-face impact, not HF-class.
- `Prog_init_ConvSimple_v2.1.st:79` — confirmed `P09.09=10.0 ms <-- CRITICAL (default 2.0 ms =>
  ErrorID-55)`, matches E-007's new note exactly. GS10_UM.txt:13773 confirms P09.09's real name is
  "Communication Response Delay Time" — the "(Response Delay)" gloss is accurate, not invented.
- `CCW_VARIABLES_v4.0.txt` PL1→`:78` and S2→`:73` — both read directly and confirmed verbatim
  (line 78 = `O-00 LightGreen (running)`, matches PL1 exactly; line 73 = `I-04 PBRun (illuminated
  momentary)`, matches S2 exactly). **These were WRONG before the cleanup** (old cites pointed at
  PL2's line and O-02's line respectively — a real citation-precision defect I flagged as secondary
  Finding F3 in the original audit) — now fixed and independently re-verified correct.

## Sweep for NEW defects — none introduced by the cleanup itself

All touched content (E-003 caveat, E-006/E-007 lineage+notes+safety, E-004 PS1 label→`short_label`,
E-001 legend note, devices.yaml citations, new OI-28) is internally consistent, accurately cited, and
renders cleanly. Visually inspected `E-003_vfd_power.png`, `E-004_24vdc_control_power.png`,
`E-006_plc_outputs.png`, `E-009_open_items.png` — no clipping/overlap/off-frame content, Check L
(layout collision) passes. E-004's PS1 label now reads the full `short_label` ("Mean Well 24 V / 1.0 A
DIN supply") with no truncation — this also fixes my original secondary finding about the `[:44]`
slice mutilating the PS1 model string. New OI-28 (PS1 chassis/DC-0V-to-PE bonding) is framed as an
honest open question, not an asserted answer — no overclaim.

## RESIDUAL (not new — pre-existing, untouched by this diff) — same defect class survives at E-003

`render_sheet.py:1230`, E-003's title-block call, still hardcodes
`lineage="terminals per GS10 UM 1st Ed Rev B;"` — confirmed **unchanged** by `git diff` (byte-identical
before/after this cleanup). Grepped all of `model/*.yaml` for "1st Ed"/"Rev B"/"GS10 UM" edition
info — **zero hits**: no model backing, architecturally the same shape as the just-fixed HF-B
(a `lineage=` literal citing a specific external document by name+edition). The fact IS true (grepped
the real `GS10_UM.txt`: "DURApulse GS10 Drive User Manual — 1st Ed., Rev B" / "Issue: First Edition,
Rev B" appear repeatedly) — not a hallucination — but it originates only in the renderer. It renders
live on the actual E-003 print (confirmed in the title block on `E-003_vfd_power.png`), so it's not
inert metadata. `K_BLOCKLIST` doesn't catch it (no matching marker) — living proof of my original
secondary finding ("Check-K brittleness... an ever-growing denylist") : the cleanup added 5 markers
for the ONE reported case (`reuse`, `WI-001`, `do-not-reuse`, `p.4`, `Prog_init`) but didn't sweep the
same file for sibling instances of the same pattern.

**Calibration against my own V4 pass:** my original audit already saw this exact string and scored it
`-1 cat10 ("reads truncated")` — a readability nit, filed under category 10, NOT run through the
HF6 model-backing grep I applied to the WI-001 case. On the model-backing test actually used to
convict WI-001, this string fails the same test. But unlike WI-001 (a specific operational
prohibition — "never reuse this output"), this is bibliographic/edition metadata with no
safety/operational content, and the sheet's own properly-cited SOURCES block already anchors the
underlying manual (`GS10_UM.txt` L1971-1986, L1750-1813) independently of the edition string. Given
that distinction, and consistent with my own prior scoring of this specific string, I am NOT
escalating it to a third package-blocking hard-fail — but flagging it prominently as an unresolved,
trivially-fixable instance of exactly the pattern this cleanup pass targeted, that should be closed
before calling the HF6 class fully eradicated. Fix: identical pattern already proven twice in this
same file — add `lineage:` to E-003 in `sheets.yaml` and change line 1230 to
`lineage=_sheet_row("E-003").get("lineage", "")`.

## Re-scores

| Sheet | Score | HF | Verdict contribution |
|---|---|---|---|
| E-003 VFD power | 98/100 | none (residual finding above, scored as deduction not HF, per calibration) | APPROVABLE WITH FIELD VERIFICATION |
| E-004 24VDC control power | 98/100 | none | APPROVABLE WITH FIELD VERIFICATION (truncation bug from V4 pass now fixed) |
| E-006 PLC outputs | 99/100 | none (HF6 confirmed fixed, mutation-tested) | APPROVABLE WITH FIELD VERIFICATION |
| E-009 Open items | 99/100 | none (HF1 confirmed fixed) | APPROVABLE WITH FIELD VERIFICATION |

## RE-AUDIT VERDICT

**APPROVABLE WITH FIELD VERIFICATION.** Both original hard-fails (HF-A OI-27 provenance, HF-B E-006
render-only fact) are genuinely, cleanly fixed — verified against primary sources, not rubber-stamped
— including a live mutation test proving Check K actually functions. No new defect was introduced by
the cleanup; every new citation it added checks out against the real corpus (GS10_UM.txt line ranges,
Prog_init P09.09, corrected CCW_VARIABLES line numbers, CA3KN22BD catalog rating). One residual,
pre-existing, same-class issue remains at E-003 (title-block lineage with no model backing) —
recommended for immediate fix using the identical pattern already applied to E-006/E-007, and called
out explicitly rather than silently accepted, but not scored as a fresh package-blocking hard-fail per
the calibration above.
