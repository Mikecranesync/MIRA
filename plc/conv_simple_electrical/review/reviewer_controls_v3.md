# Controls Engineer Review — CV-101 Electrical Print Package V3

**Reviewer role:** Controls Engineer (Rockwell/AutomationDirect) — deep-dive categories 1, 7, 8, 9, 11
**Scope:** E-001, E-003, E-005, E-006, E-007 (drafted sheets). Independent review — did not read reviewer_*_v2.md or GRADES_V2.md.
**Method:** Every citation on every sheet was traced to the primary artifact, not just to the model YAML. Verified line-by-line against:
- `plc/Prog_init_ConvSimple_v2.1.st` (the LIVE, currently-flashed program — highest authority for what the PLC actually does)
- `plc/CCW_VARIABLES_v4.0.txt` (I/O mapping table, L65-82)
- `C:\Users\hharp\Documents\CCW\MIRA_PLC\docs\vfd\GS10_UM.txt` (OEM manual, 1st Ed Rev B — primary authority per GOLD_STANDARD_SOURCES.md), specifically L1690-1990 (Ch.2 Installation and Wiring) and the Modbus register table (L13490-13530, L15440-15730)
- `GS10_actual_parameters_5.20.26.xlsx` via openpyxl (`Different Value` sheet = bench delta-from-factory-default; `Group 0`/`Group 2`/`Group 9` sheets = raw parameter dump)
- `plc/GS10_Integration_Guide.md`
- Recovered docs, extracted to text via `pypdf`: `Conv_Simple_ControlsToVFD.pdf`, `Conv_Simple_GS10_Beginner_Verify_V2.pdf`, `MIRA_PLC_WorkInstruction_v3.pdf`
- `Conv_Simple_Prog_VFD_PhaseB.st` (original) and `Conv_Simple_Prog_VFD_PhaseB_V1.4.st` (the "FIX 2" correction)
- `render_sheet.py` (to confirm the renderer doesn't originate facts — HF6 hunt)

---

## HEADLINE FINDING (HF4) — E-007 frequency-readback scale factor

**E-007's "Read 0x2103 (output freq, Hz x10) via FC03" is wrong, and the sheet cites the two
sources that disagree with each other without adjudicating.**

- **OEM manual** (`GS10_UM.txt` L15703-15705, the primary authority): register table gives
  `Frequency command (XXX.XX Hz) 2102` / `Output frequency (XXX.XX Hz) 2103`. The format
  `XXX.XX Hz` is two decimal places → **scale = value / 100** (raw 3000 → 30.00 Hz).
- **Live PLC program**, cited as an E-007 source (`Prog_init_ConvSimple_v2.1.st:164`):
  `vfd_frequency := read_data[4]; (* 0x2103 output freq Hz x100 *)` — explicit inline comment,
  **x100**, matching the manual. The file's own header additionally states
  "vfd_freq_sp is x100 (3000 = 30.00 Hz), same scale as vfd_freq_cmd... tracks output 0x2103
  1:1 (the acceptance check)" — a x10 output register would break that 1:1 comparison outright.
- **`plc/GS10_Integration_Guide.md:127-128`** (a MIRA-authored secondary doc, dated 2026-03-16,
  the SAME doc already known to carry the stale `REV+RUN=20` value the sheet correctly
  overrides elsewhere): states `Hz x10` for both 0x2102 and 0x2103. This is the source of the
  error — it disagrees with its own manual citation basis.
- **`model/e007_rs485.yaml` line ~91 and the rendered E-007 sheet** copied the Integration
  Guide's `Hz x10` value verbatim, in plain (non-caveated, non-red) text, presented as settled
  fact — while the SOURCES block for this exact fact lists BOTH `GS10_Integration_Guide.md`
  AND `Prog_init_ConvSimple_v2.1.st`, which conflict.

This is a textbook HF4: "a contradiction between YAML, PLC logic, OEM documentation... and the
rendered sheets that the sheet does not explicitly acknowledge/adjudicate." It is materially
misleading — a technician who reads back register 0x2103 = 3000 during comms troubleshooting
and applies the sheet's stated x10 scale gets "300.0 Hz" (nonsensical for this drive/motor,
versus the correct 30.00 Hz), actively worsening diagnosis rather than helping it.

**This is not an HF6** (render inventing a fact): I traced `render_e007()` (render_sheet.py
L644-646) — the readback text is pulled verbatim from `e007_rs485.yaml`'s `readback:` list with
no renderer-side transformation. The defect lives entirely in the model layer, one line, easily
fixed (`Hz x10` → `Hz x100`), but as drawn it is a genuine, uncaveated factual error the sheet
presents with full confidence.

By contrast — and this is what makes the miss notable — **every other supersession on E-007 is
handled with exemplary discipline** (see per-sheet section below): Channel 0→2, REV+RUN 20→34,
SGND pin 1/8→pin 3, 8N2→8N1 are all correctly identified, correctly cited, and correctly
red-flagged as corrected-from-stale-draft. The Hz scale is the one place the same rigor wasn't
applied to a value inherited from the same known-partially-stale document.

---

## Per-sheet findings

### E-001 — Cover / Legend / Device Schedule — **99/100**

Device schedule (12 rows) traced 1:1 against `devices.yaml` — tag/type/model/role/evidence all
match exactly, including the field_verify vs verified coloring. Wire-numbering key text matches
`wires.yaml`'s `convention:` string verbatim. Sheet index matches `sheets.yaml` id/title/status
for all 9 sheets. Safety box (LOTO + monitored-e-stop-is-not-a-safety-stop) matches
`sheets.yaml` E-001 annotations exactly. No invented content found.

- `-1 pt, cat 3 (approvability), sheet-wide, E-001`: no explicit "see E-009 for the field-verify
  docket" pointer on the cover itself (a reader gets there via the sheet index, which is
  adequate but not a direct pointer). Minor.

No HF. No deep-dive category (7/8) applicable — conductor/circuit-specific categories scored
full per the rubric's cover-sheet carve-out.

### E-003 — VFD Power — **95/100**

**This is the most heavily source-verified sheet in the package.** Every GS10_UM.txt line
citation was checked against the manual text directly and all resolved exactly:

| Sheet claim | Manual text (verified) |
|---|---|
| L1754-1757 "MC is emergency/safety switching only" | "Do not use a power circuit contactor... for normal run/stop control... only in emergency situations" — exact match |
| L1811-1813 "never start/stop via input power" | "Do NOT start/stop the GS10 AC drive by turning input power ON/OFF" — exact match |
| L1758-1759 "CB1 REQUIRED" | "Make sure the appropriate protective devices (circuit breaker or fuses) are connected" — exact match |
| L1760-61 "PE resistance ≤0.1Ω" | "Ground resistance should not exceed 0.1[Ω]" — exact match |
| L1773-1776 "swap any two motor leads to reverse" | verbatim match |
| L1787 "route power ⊥ control wiring" | "Route the power and control wires... at 90 degree angle" — exact match |
| L1824-1826/1977-1978 "+1/+2 factory jumper, leave unless reactor installed" | exact match |
| L1842/1980 "B1/B2 brake resistor, optional" | exact match (see minor note below) |
| L1982/1986/1844 "DC+/DC- leave open; absent on 120VAC models" | "120VAC models do not have DC bus terminals DC-, DC+/+1" — exact match |
| L1971-1986 terminal table (R/L1,S/L2,T/L3 / U/T1,V/T2,W/T3) | exact match, including the 1φ-only R/L1,S/L2 row the sheet's caveat correctly flags |

`devices.yaml`/`Prog_init` citations for Q1 (O-02 coil source, Integration Guide "Phase-5" test
at line 303) also confirmed exact.

- `-1 pt, cat 1, B1/B2 note, E-003 notes box`: "brake resistor (optional; else OPEN)" — the
  "else OPEN" instruction is directly stated in the manual for +1/+2/DC- (L1844) but not
  verbatim for B1/B2 specifically; standard VFD practice supports it, but the citation is
  slightly looser than the rest of this sheet's otherwise-exact citations.
- `-1 pt, cat 8 (VFD presentation, my deep-dive), E-003, no location marker`: control-source
  statement is correctly OMITTED from this sheet (owned by E-006/E-007) but there is no
  forward-pointer ("VFD1 control = Modbus, see E-007") — see cat 9 finding below, same root gap.
- `-2 pts, cat 9 (cross-references, my deep-dive), E-003, sheet-wide`: Q1 coil↔poles
  cross-reference to E-006 is excellent and bidirectional ("Q1 coil ← O-02 (E-006)" on E-003;
  "poles on E-003" on E-006). But VFD1 appears on both E-003 (power) and E-007 (comms) with no
  pointer from E-003 to E-007 — a technician tracing "how does this VFD get told to run" from
  the power sheet has no signpost that control is entirely off-sheet via Modbus.
- `-1 pt, cat 4 (symbols, general)`: breaker/contactor glyphs are simplified generic
  switch icons rather than fuller IEC 60617 breaker symbols — a light, general note; not my
  deep-dive category, defer to the drafting-standards reviewer.

No HF.

### E-005 — PLC Digital Inputs — **99/100**

This is the style law's own reference implementation and it shows. Every I-00..I-05 terminal
function/OPC-tag/healthy-state matches `terminals.yaml` exactly, itself traced to
`Prog_init_ConvSimple_v2.1.st` (dir_fwd/dir_rev L205-206, pe_latched L208-212) and
`CCW_VARIABLES_v4.0.txt` L65-82 I/O map. The I-05 "Entry sensor (spare)" (CCW v4.0) →
photo-eye/pe_latched (live Prog_init v2.1) supersession is **exactly** the honest-acknowledgment
pattern the rubric wants: stated in red on the sheet, cites OI-13, doesn't hide the drift.

I independently checked I-06 too (CCW v4.0 nominally labels it "Exit sensor (spare)", a
different wording than the model's inline comment "no program/doc reference"): I confirmed by
reading the full 256-line live program that `_IO_EM_DI_06` is never referenced anywhere in
`Prog_init_ConvSimple_v2.1.st`, so the drawn conclusion (I-06 = spare/unused) is correct — this
is a very minor wording imprecision in an internal YAML comment, not a drawing defect, so no
deduction.

Cat 7 (my deep-dive): rung grammar (device contact → wire# → PLC terminal → function/OPC tag)
is clean, commons explicit (COM0), spares marked with OI-08, and mirrors E-006's output grammar
correctly (see E-006 below). Cat 9: `(PS1/E-004)` source reference correctly named, no dangling
references.

- `-1 pt, cat 3, sheet-wide`: same minor "no direct E-009 pointer" pattern as E-001 (present via
  open-items references inline, e.g. OI-02, OI-08, OI-13, but no single "see E-009" line).

No HF.

### E-006 — PLC Outputs — **96/100**

O-00..O-03 functions (LightGreen/LightRed/ContactorQ1/PBRunLED) match `CCW_VARIABLES_v4.0.txt`
L78-82 exactly; O-02→Q1 coil is independently corroborated by `Prog_init_ConvSimple_v2.1.st:214`
(`vfd_run_permit := _IO_EM_DO_02 AND e_stop_ok AND NOT pe_latched`) exactly as the sheet claims
("O-02 corroborated by live Prog_init v2.1"). The "O-02 do-not-reuse" title-block note is
independently confirmed against `MIRA_PLC_WorkInstruction_v3.pdf` ("DO_02 is already the MLC
drive-enable coil and must never be reused"). The hardwired-fallback caveat (DO_03..DO_07 →
GS10 DI1..DI5+DCM, NOT ACTIVE) is confirmed **exactly** against WorkInstruction_v3 §3/Figure 1
("Wire DO_03..DO_07 to GS10 DI1..DI5 per Figure 1. Land DCM to the panel 24V common") and
independently against the bench parameter export: **P02.00-P02.16 (the GS10's own
multi-function-terminal group) are entirely absent from the `Different Value` sheet of
`GS10_actual_parameters_5.20.26.xlsx`**, meaning every P02.xx value is still at factory default —
directly supporting the sheet's claim that no such fallback function is configured on the drive
side, regardless of physical wiring presence (which the sheet correctly leaves as OI-18).

Q1 coil↔poles cross-reference to E-003 confirmed bidirectional; "GS10 run/dir/freq = Modbus —
see E-007" cross-reference present and correct.

- `-3 pts, cat 1, +CM0/-CM0/+CM1/-CM1 labels, E-006 (and terminals.yaml)`: `open_items.yaml`
  OI-09 documents a real, unresolved conflict — `devices.yaml` describes PLC1's outputs as
  "7 relay DO," but `terminals.yaml`'s polarity-style naming (`+CM0`/`-CM0`) is the convention
  for DC transistor-sourcing banks, not relay commons (relay commons are typically non-polar).
  This conflict is tracked in `open_items.yaml` but **not surfaced on the E-006 sheet itself** —
  only the OI-18 hardwired-fallback issue gets a caveat box; OI-09 gets none. This is not HF4
  (the sheet doesn't assert either technology in its own text — it just shows the CCW-verbatim
  bank labels — so there's no confident-and-wrong claim visible on the drawing), but it is a
  real category-1 gap: a technician reading E-006 alone has no way to know there's live
  uncertainty over relay-vs-transistor output technology, which matters for device selection
  (inrush current, wetting current, snubber requirements differ).

No HF.

### E-007 — RS-485 / Modbus RTU — **80/100 — HARD FAIL (HF4)**

See headline finding above for the Hz x10/x100 defect (HF4). Everything else on this sheet is
exceptionally well-sourced — I want that on the record because it's what makes the one miss
stand out:

- **Command words** (`stop=1, fwd_run=18, rev_run=34`) verified against the LIVE program
  (`Prog_init_ConvSimple_v2.1.st:216-222`) exactly, and the full supersession chain was traced
  end-to-end: `Conv_Simple_Prog_VFD_PhaseB.st` (original, unversioned) has `REV+RUN := 20`
  (confirmed) → `Conv_Simple_Prog_VFD_PhaseB_V1.4.st` "FIX 2" comment: *"REV+RUN cmd word 20 ->
  34. 34 = bit 5 (REV) + bit 1 (Run); 20 was bit 4 (FWD) + bit 2 (reserved) with no Run bit"*
  (confirmed verbatim) → `Conv_Simple_GS10_Beginner_Verify_V2.pdf`: *"Command word for REV+RUN =
  34 (not 20)"* (confirmed) → live Prog_init v2.1 uses 34. The sheet's caveat box states this
  chain accurately.
- **Channel 2** (not 0) confirmed in the live program's own comment ("Channel := 2 (* embedded
  RS-485 -- NOT 0 *)") and Beginner_Verify_V2 ("Channel 0 → 2... remain valid").
- **SGND = RJ45 pin 3** (not pin 1/8) confirmed against Beginner_Verify_V2 ("Drive RJ45 pin for
  SGND: Pin 3 — GS10 manual p.10") and independently against the OEM manual's own RJ45
  annotation at L1953 ("SG+ Pin5, SG- Pin4, SGND Pin 3,7").
- **9600 8N1** (P09.04=12, not 8N2/P09.04=13) confirmed against Beginner_Verify_V2 exactly, and
  the sheet's own OI-20 hedge ("2026-05-20 export = 38.4k/8N2 vs 2026-05-26 bench sniff =
  9600/8N1 — adjudicate") is independently confirmed against the raw xlsx: P09.01 and P09.04 are
  **absent** from the `Different Value` sheet of the 2026-05-20 export, meaning they were still
  at factory default (384=38.4k, 13=8N2) at that time — exactly what the sheet says, and the
  sheet correctly draws the LATER bench-verified value while flagging the conflict rather than
  silently picking one. This is the same good-practice pattern that makes the Hz miss stand out.

- `-7 pts, cat 1, readback text, E-007` (HF4, see above) — the Hz x10/x100 contradiction.
- `-3 pts, cat 2, readback text, E-007`: the wrong scale actively misleads a technician
  performing the sheet's own suggested comms-troubleshooting readback check.
- `-5 pts, cat 8 (VFD presentation, my deep-dive), readback text, E-007`: same defect, scored
  again here because it specifically concerns interpreting a VFD-reported operating parameter —
  squarely within "VFD power & control presentation."
- `-4 pts, cat 12, readback text, E-007`: the claim is stated with full confidence (plain black
  text, no FIELD VERIFY marker, no caveat box) despite being contradicted by a source the sheet
  itself cites — worse than an unverified claim, because it reads as settled.
- `-1 pt, cat 4 (symbols, general)`: same light general note as E-003/E-005.

**HF4** — flagged separately per rubric instruction ("mark it HF, not a deduction"); it governs
the sheet's approvability regardless of point total.

---

## Cross-sheet consistency findings

1. **Q1 coil↔poles split (E-003↔E-006):** correctly bidirectional. Good practice, worth calling
   out as a positive example for the rest of the package.
2. **GS10 control-source ownership (E-003 vs E-006/E-007):** correctly NOT duplicated on E-003
   (no P00.20/P00.21 text there), correctly stated once on E-006/E-007 — but E-003 lacks a
   forward-pointer to E-007, a minor gap noted above in both E-003's and this section.
3. **The Integration Guide is a known-partially-stale secondary source, and the package treats
   it inconsistently.** `GS10_Integration_Guide.md` (2026-03-16) is *correctly* overridden for
   `REV+RUN=20` (superseded by 34) but *silently trusted* for the Hz scale factor (Hz x10,
   contradicted by both the OEM manual and the live program). Since this doc has now been shown
   to carry at least two stale/wrong values, I'd recommend a pass that specifically re-verifies
   every remaining fact sourced solely from this document against the OEM manual or live code —
   the same pattern could be hiding elsewhere (e.g., its P09.09 response-delay range/default
   "0-2000ms / 20" does not match the OEM manual's own "0.0-200.0 ms / 2.0" — not rendered on any
   V3 sheet, so no scoring impact, but corroborates the doc's general reliability problem).
4. **HF6 hunt:** traced `render_sheet.py`'s data flow (all `draw_annotations`/table-emission
   calls read from `sheets.yaml` annotations or the per-sheet model file, e.g. `render_e007()`
   L644-646 pulls the `readback:` list verbatim from `e007_rs485.yaml`). No renderer-originated
   facts found. The Hz x10 defect is a model-layer (YAML) defect, not a renderer defect — HF6
   does not apply.
5. **Bench parameter export corroboration (independent, not previously cross-checked in the
   model docs):** P00.01=1.60A, P00.20=1, P00.21=2 all confirmed directly from
   `GS10_actual_parameters_5.20.26.xlsx`'s `Different Value` sheet (i.e., these values differ
   from factory default in the actual bench export, matching what the sheets claim). P02.0x and
   P09.01/P09.04 confirmed ABSENT from that same list (still at factory default as of
   2026-05-20), corroborating both the E-006 hardwired-fallback-inactive claim and the E-007
   OI-20 hedge.

---

## Verdict (controls-engineer deep-dive)

| Sheet | Score | HF |
|---|---|---|
| E-001 | 99/100 | none |
| E-003 | 95/100 | none |
| E-005 | 99/100 | none |
| E-006 | 96/100 | none |
| E-007 | 80/100 | **HF4** |

**NOT APPROVABLE** from this review. Driven entirely by E-007: one hard-fail (HF4, the Hz
x10/x100 frequency-readback contradiction) and a sub-90 score. E-001/E-003/E-005/E-006 all clear
the ≥90 bar with no hard-fails and would be approvable-with-field-verification sheets on their
own.

**The fix is narrow and low-risk:** change `model/e007_rs485.yaml`'s readback bullet from
`"Read 0x2103 (output freq, Hz x10) via FC03..."` to `"Hz x100"` (or, more robustly, drop the
scale claim from the bullet and point to the register-map table instead), re-render E-007, and
this sheet's HF4 clears. I'd also recommend fixing `GS10_Integration_Guide.md`'s register table
(0x2102/0x2103/0x2104 currently say "Hz x10"/"A x10"; OEM manual + live code say x100 for both)
so the error can't re-propagate into a future sheet. Everything else on this sheet — and the
package as a whole — reflects careful, well-cited engineering work; this was a single missed
cross-check in an otherwise disciplined supersession-tracking process.

---

## V3.1 re-check (independent re-verification, controls engineer)

**Scope:** V3.1 was applied and sheets re-rendered at `C:\wt-phase0\plc\conv_simple_electrical\`.
This pass re-verifies only *my own* V3 findings (HF4 + the two secondary notes) against the
re-rendered artifacts, per instruction — `reviewer_*_v2.md`/`GRADES_V2.md` not read; rubric
re-applied from `review\GRADING_RUBRIC.md`.

### HF4 re-verification — Hz x10/x100

- `model/e007_rs485.yaml:90` now reads: `"Read 0x2103 (output freq, Hz x100) via FC03; nonzero
  readback confirms end-to-end. (Prog_init v2.1:164 'Hz x100'; GS10_UM.txt L15703-05 format
  XXX.XX Hz)"` — confirmed by direct read of the model file.
- **Re-traced independently against both primary sources (not just the citation string):**
  - `C:\wt-phase0\plc\Prog_init_ConvSimple_v2.1.st:164` — read directly:
    `vfd_frequency := read_data[4]; (* 0x2103 output freq Hz x100 *)` — exact match, "x100" not
    "x10".
  - `C:\Users\hharp\Documents\CCW\MIRA_PLC\docs\vfd\GS10_UM.txt` L15703 ("Frequency command
    (XXX.XX Hz) 2102...") and L15705 ("Output frequency (XXX.XX Hz) 2103...") — read directly:
    two-decimal-place display format confirms scale = value/100, consistent with "x100," not the
    old "x10" claim.
  - The two sources now **agree** (previously the sheet cited both while they conflicted — the
    core HF4 defect). Contradiction is resolved, not just reworded.
- **Rendered artifacts confirmed** — both PNG (`E-007_rs485_modbus.png`) and PDF
  (`E-007_rs485_modbus.pdf`, text-extracted) show the corrected line verbatim, in plain
  (non-red) confident text, appropriate now that the fact is dual-sourced and consistent:
  `"Read 0x2103 (output freq, Hz x100) via FC03; nonzero readback confirms end-to-end. (Prog_init
  v2.1:164 'Hz x100'; GS10_UM.txt L15703-05 format XXX.XX Hz)"`.
- **Verdict: HF4 CLEARS.** No remaining contradiction between YAML, PLC logic, OEM manual, and
  the rendered sheet on this fact.

### Secondary note 1 — E-006 OI-09 surfaced on-sheet

- `model/sheets.yaml` E-006 `notes` now includes: `"Output bank technology + common feed = FIELD
  VERIFY (OI-09): WI-001 p.4 says relay dry contacts; ±CM polarity naming suggests DC-fed banks —
  conflicting evidence, resolve per 2080-IN009 + meter."`
- Confirmed **rendered** in the NOTES block of `E-006_plc_outputs.png`, third bullet, black text
  (consistent with how other FIELD VERIFY notes render elsewhere in the package, e.g. E-005's
  COM0 note).
- Cross-checked against `model/open_items.yaml` OI-09 — item text and verify text match the
  sheet note's substance (DC-transistor-bank-naming vs. relay-DO conflict; resolve per 2080-IN009
  + meter). No orphaned reference; docketed on E-009's source (`open_items.yaml`).
- **Verdict: closes the V3 -3 pt cat-1 gap.** The conflict is no longer silent on the sheet
  itself.

### Secondary note 2 — E-003 forward-pointer to E-007

- `model/sheets.yaml` E-003 `notes` now includes: `"VFD control source = Modbus — see E-007. No
  control wiring on this sheet."`
- Confirmed **rendered** in the NOTES block of `E-003_vfd_power.png`, last bullet, naming the
  destination sheet explicitly (rubric cat 9 requirement).
- **Verdict: closes both the V3 -1 pt cat-8 ("no location marker") and -2 pt cat-9 ("no pointer
  E-003→E-007") findings** — the ledger noted these were "same root gap," and one fix closes both.

### Re-scored (deductions restored only where the underlying defect is verified fixed; unrelated
V3 deductions — E-003 B1/B2 citation looseness, general cat-4 symbol-glyph notes on
E-003/E-005/E-007, E-001/E-005 missing direct E-009 pointer — carry forward unchanged, as V3.1's
changelog does not claim to touch them and spot-checks of E-001/E-005 show no regression):

| Sheet | V3 | Restored | V3.1 | HF |
|---|---|---|---|---|
| E-001 | 99 | — | **99/100** | none |
| E-003 | 95 | +1 (cat8) +2 (cat9) | **98/100** | none |
| E-005 | 99 | — | **99/100** | none |
| E-006 | 96 | +3 (cat1, OI-09 surfaced) | **99/100** | none |
| E-007 | 80 | +7 (cat1) +3 (cat2) +5 (cat8) +4 (cat12) | **99/100** | **none (HF4 cleared)** |

### Verdict (controls-engineer deep-dive, V3.1)

**Remaining HF: 0.** Every sheet ≥90. Per `GRADING_RUBRIC.md` verdict rules: not full
**APPROVABLE** (E-003 still carries undocumented supply voltage/phase/breaker/GS10
model — OI-15/OI-16 — which is a FIELD-VERIFY item blocking safe energization, so full APPROVABLE
is correctly withheld per the rubric's own parenthetical). Meets **APPROVABLE WITH FIELD
VERIFICATION**: no hard-fails, every sheet ≥90, and every remaining unknown is explicit
FIELD-VERIFY, present in `open_items.yaml` (OI-01..OI-20, all cross-checked present and
non-orphaned), and docketed to E-009.

**Still-open, non-blocking, for a future pass:** (1) general cat-4 note — breaker/contactor
glyphs are simplified switch icons, not full IEC 60617 (E-003/E-005/E-007), owned by the
drafting-standards reviewer, not mine; (2) my V3 recommendation to audit
`GS10_Integration_Guide.md` for other stale values beyond REV+RUN and Hz scale (e.g. its
P09.09 response-delay mismatch, not rendered on any current sheet so zero scoring impact) still
stands as hygiene, not a defect on these 5 sheets.
