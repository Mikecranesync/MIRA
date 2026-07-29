# V2 Grading Results — CV-101 electrical print package
Panel: 4 independent reviewers (Sonnet) + 1 prior adversarial style review (R0). Rubric:
`GRADING_RUBRIC.md`. Full per-reviewer ledgers: `reviewer_{technician,controls,drafting,auditor}_v2.md`.
Package graded at V2 = commit `b1900a0f` (branch `feat/conv-simple-e003-e006`).

## Scoreboard (per sheet / per reviewer)

| Sheet | Technician | Controls | Drafting | Auditor | Min |
|---|---|---|---|---|---|
| E-003 VFD power | 63 | 86 | 81 | 73 | **63** |
| E-005 PLC inputs | 77 | 87 | 83 | 70 | **70** |
| E-006 PLC outputs | 77 | 77 | 69 | 74 | **69** |
| E-007 RS-485/Modbus | 93 | 87 | 83 | 84 | **83** |

**Package verdict: NOT APPROVABLE** (unanimous — hard-fails present; every sheet under the 90 floor
for at least one reviewer).

## Hard-fail census

| HF | Where | Found by | Finding |
|---|---|---|---|
| HF2 solid-renders-unverified | ALL 4 sheets + print set | all 5 reviews | PyMuPDF SVG→PDF/PNG conversion drops `stroke-dasharray`; every field_verify conductor (28/31 modeled) prints as a confident solid line. Proven at SVG-source, PNG-pixel, and PDF-vector (`get_drawings()` = 0 dashed items) levels. Both legends' own VERIFIED vs FIELD-VERIFY swatches print pixel-identical. Validator only audited SVG text → false green. |
| HF5 illegible safety-critical labels | E-003 (11/15 wire tags), E-006 (W600) | technician, R0 | Wire-number tags centered on vertical runs are bisected by their own conductor stroke. |
| HF6 render-only engineering content | E-006 Modbus box; E-005 NFPA-79 note; E-003 annotations broadly | controls, drafting, auditor | Register/command values + safety/caveat text exist only in `render_sheet.py`, not the model. Values independently re-verified CORRECT (34, 0x2000/0x2001, P00.20/21) — provenance defect, not factual error. E-005's NFPA-79/EN-60204 note is REQUIRED by the style law §7 — fix is model-backing + cite, not removal. |
| HF4 unacknowledged cross-source conflict | E-006 (and E-007 context) | drafting, auditor | REV+RUN printed as 34 while two cited-corpus docs (`GS10_Integration_Guide.md`, ControlsToVFD) still print the documented-superseded 20 with no on-sheet adjudication. (Supersession evidence: PhaseB_V1.4 "FIX 2", Beginner_Verify "NOT 20!", WI-001 Table 9, live Prog_init v2.1 `vfd_cmd_word := 34`.) |

## Invented / unsupported details (deliverable 4)

- **HF1 invented devices/terminals/wires: NONE FOUND** (auditor; 40+ cites spot-checked, ~95%
  accurate; one off-by-one line citation caught on PL1).
- Unsupported-by-model (HF6 items above): E-006 Modbus cross-ref block; E-005 NFPA-79 note
  (supported by style law, unbacked by model); E-003 annotation strings (all accurate vs manual,
  all architecturally unsourced).
- Undisclosed-uncertainty items: E-007 states 9600/8N1 without the OI-20 caveat (2026-05-20 export
  read 38.4k/8N2; later 2026-05-26 bench sniff read 9600/8N1); E-005 draws I-05 as photo-eye
  without acknowledging CCW_VARIABLES v4.0's conflicting "Entry sensor (spare)" label (live
  program supersedes; disclosure owed).

## Other cross-reviewer deductions driving V3

1. Glyph stubs render solid regardless of wire status (helper functions hardcode) — auditor.
2. CB1 vs Q1 pole symbols are identical ad-hoc chevrons — not recognizable IEC/NEMA; need distinct
   breaker vs contactor symbols — drafting.
3. Wire-numbering convention inconsistent (E-005 W2xx vs E-003 W3xx/E-006 W6xx vs law's
   [page][line]; E-007 mnemonics) and documented nowhere — drafting, technician. E-001 (cover/
   legend/convention key) is the law's designated home and remains a stub.
4. Validator must audit the rendered artifact (PNG/PDF), not just SVG text — technician, auditor.
5. Full manufacturer names; MC/MLC alias; W306 full cite; O-02 do-not-reuse cite — R0 nits.

## Reviewer top-fix consensus

1. Fix dash preservation through to PDF/PNG (clears HF2 package-wide).
2. Move ALL sheet engineering text into the model; render only lays out (clears HF6; discloses
   34-vs-20 on-sheet, clearing HF4).
3. Fix wire-tag legibility (opaque + perpendicular offset) (clears HF5).
4. Standardize + document the wire-numbering convention (draft E-001 from the model).
5. Extend validator to raster-side assertions.
