# V2 → V3 Change Report — CV-101 electrical print package
V2 = `b1900a0f` (branch feat/conv-simple-e003-e006, preserved). V3 = `777c4061`+ (branch
feat/conv-simple-prints-v3). Driven by the 4-reviewer V2 panel (review/GRADES_V2.md): V2 verdict
NOT APPROVABLE — min score 63; HF2/HF4/HF5/HF6 present.

## What changed and why (mapped to panel findings)

1. **Dash truth now survives to the printed artifact (HF2, all sheets).** PyMuPDF's SVG import
   silently dropped `stroke-dasharray`, so every FIELD-VERIFY conductor printed as a confident
   solid line — including both legends' own swatches (pixel-identical in V2). V3 constructs dashes
   as real geometry: `SVG.line(dash=True)` emits 7/4-px child segments inside
   `<g data-wire data-status data-dashed>`. No converter feature is relied on. Glyph conductor
   stubs inherit rung status (V2 hardcoded them solid); device outlines are never dashed (V2
   conflated unconfirmed-device with unconfirmed-conductor).
2. **Every engineering sentence now lives in the model (HF6).** V2 hardcoded the E-006 Modbus
   block, E-005's NFPA-79 note, and most E-003 annotations in `render_sheet.py`. V3 moves all
   sheet text into `sheets.yaml annotations:` blocks / `e007_rs485.yaml` — the renderer only lays
   out. New validator check K bans engineering markers in renderer string literals (AST scan).
3. **The 34-vs-20 conflict is adjudicated on-sheet (HF4).** E-007 gained a model-backed
   "COMMAND WORDS (0x2000)" strip: STOP=1 · FWD+RUN=18 · REV+RUN=34 with the red supersession
   note naming BOTH stale sources (GS10_Integration_Guide.md 2026-03-16 and ControlsToVFD/original
   PhaseB.st print 20) and the four corrected sources (PhaseB_V1.4 'FIX 2', Beginner_Verify_V2,
   WI-001 Table 9, live Prog_init v2.1). E-006's V2 Modbus box shrank to a one-line cross-ref to
   E-007 (register facts belong to the comms sheet).
4. **Wire tags legible everywhere (HF5).** Opaque white flag boxes; on vertical runs the flag
   offsets ~26px beside the conductor with a leader tick (V2 centered flags on the line — 11/15
   E-003 tags were bisected by their own wire).
5. **Numbering convention adopted + documented (drafting).** W[sheet-digit][line-2d] per the
   style law §2 rule 8: E-005 renumbered W200..W205 → W500..W505 (proposed numbers; OI-03/OI-19);
   rails (W24/W0V) and E-007 mnemonics (485+/485-/SGND/SH) declared exempt. The convention string
   lives in `wires.yaml convention:` and renders on the new cover sheet.
6. **E-001 cover drafted (drafting).** Fully model-driven: device schedule (devices.yaml), sheet
   index (sheets.yaml), the numbering key, line-style legend, package safety banner. Set grows to
   5 drafted sheets; CV-101_print_set.pdf now opens with it.
7. **Distinct standard symbols (drafting).** Breaker poles (arc + X, IEC-style) vs contactor
   poles (open-contact pair) — V2 drew identical chevrons for both.
8. **Disclosures added (controls).** E-005: I-05 vintage-drift note (CCW v4.0 'Entry sensor
   (spare)' superseded by live Prog_init v2.1 photo-eye; OI-13). E-007: OI-20 line-params
   disclosure (2026-05-20 export 38.4k/8N2 vs 2026-05-26 bench sniff 9600/8N1 — shown value is
   the later verification, fresh readback owed).
9. **Validator audits the artifact, not just the SVG text (technician/auditor).** New checks:
   H dash-construction (≥3 segments per dashed group), I raster parity (PDF `get_drawings()`
   segment count vs SVG), J E-001 schedule parity, K no render-only engineering text. Check G is
   group-aware and now covers all five sheets (E-005/E-007 conductors were untagged in V2).
10. **Naming/cite polish (R0 nits).** Full manufacturer device names; Q1 labeled
    "(MC · 'MLC' in WI-001)"; W306's full "GS10_UM.txt L1787" cite; E-006 title-block
    "O-02 do-not-reuse (WI-001 p.4)".

## What deliberately did NOT change
- No new electrical facts. Zero conductors were promoted to `verified` — V3 fixes rendering,
  provenance, and disclosure, not evidence. All 33 field-verify conductors remain dashed and
  open-itemed (OI-01..OI-20). Unknown-but-marked stays unknown-but-marked.
- V2 remains intact at `b1900a0f` for comparison.

## Recommended follow-up outside this package (flagged, not fixed here)
- `plc/GS10_Integration_Guide.md` still prints the superseded REV+RUN=20 (its 2026-03-16 vintage)
  — a one-line doc fix in a separate change would stop the stale value from propagating.

## Post-V3 fix iterations (V3.1 → V3.3, driven by the fresh-eyes re-grade)
- **V3.1:** E-007 readback scaling corrected "Hz x10" → **"Hz x100"** (a genuine factual error the
  whole V2 cycle missed — manual XXX.XX format + live program comment both say x100; the x10 came
  from the stale Integration Guide); E-003 pole-label/dash collisions cleared; SH conductor
  tagged; OI-09 + port-location + Modbus-pointer disclosures added; both anti-spaghetti laws on
  E-001; "Drawn:" title-block lines; validator check L (text/conductor collision) introduced.
- **V3.2:** V3.1's label relocation regressions fixed (Q1 "L1" text fusion; M1 caption vs flag
  border); check L hardened to Liang-Barsky segment-rect + text-text + flag-rect obstacles,
  mutation-tested; E-005 duplicate "Drawn:" removed; footnote fonts ≥7.2; "pushbutton (NO)";
  M1 "3~" recolored to field-verify red; remaining renderer literals (terminal names, subtitles)
  moved model-first.
- **V3.3:** drafting's all-stroke scan findings fixed (PE earth-bars vs "NOTES"; table border
  bisecting "L1787"); check L extended to ALL strokes (containment-aware), which surfaced + fixed
  one more real strike (contactor arm into the L3 label) and forced systemic wrap-metric
  harmonization. Final state: 12/12 validator checks, zero collisions, unanimous
  APPROVABLE WITH FIELD VERIFICATION (see GRADES_V3.md).
