# Electrical Drafting Standards Review — CV-101 Print Package V2

**Reviewer role:** Electrical drafting standards (IEC 60617 symbols / IEC 61082 layout / NFPA 79 /
UL 508A / NEMA ICS 19 / ISO-IEC 81346 reference designations). Deep-dive categories: **4 (symbols &
designations), 5 (wire & terminal ID), 6 (power/control/grounding/safety separation), 10 (title
block/revision/notes/print-scale)**. All 12 categories scored per the rubric's instruction that
every reviewer scores everything.

**Package under review:** `C:\wt-phase0\plc\conv_simple_electrical\` — sheets E-003, E-005, E-006,
E-007 (PNG + PDF + SVG), `model/*.yaml`, `review/CROSSREF_MATRIX.md`, bound set
`sheets/CV-101_print_set.pdf`.

**Method note:** every symbol/dash/legend claim below was verified against the *shipped raster
artifact* (`.png`, and where relevant `.pdf`, opened with PyMuPDF and cropped/zoomed 4x-10x), not
just the SVG source or a compressed full-page view — the rubric (HF2) is explicit that PNG/PDF
rendering is what counts, and a compressed full-page PNG can visually mislead on fine details (dash
periods, small glyphs). Where I quote a fact against a cited source file, I opened and grepped that
file directly, including two files that live *outside* the git worktree
(`C:\Users\hharp\Documents\CCW\MIRA_PLC\...`) but are cited by the sheets/YAML.

---

## HEADLINE FINDING — HF2, package-wide, all 4 sheets (dash rendering is dead in the shipped artifacts)

**What I found:** `render_sheet.py` correctly implements the model's verified→solid /
field_verify→dashed rule at the Python level (e.g. `render_e005()` line 606:
`dash=not verified_wire`; `breaker_pole()` draws its box with `dash=True`; the E-007 shield line at
line 374 passes `dash=True`). The SVG source correctly contains `stroke-dasharray="7,4"` on every
one of these lines (confirmed by grep — 15 dashed `<line>` elements in `E-005_plc_inputs.svg`
alone). **But the SVG→PDF/PNG conversion step drops the dash pattern entirely.**

Proof (not inference): I cropped and zoomed the shipped `sheets/E-005_plc_inputs.png` at the
sheet's own LEGEND box (10x zoom, SVG coords x=60-260,y=590-640 → the exact "VERIFIED" vs "FIELD
VERIFY" sample-line pair the sheet uses to teach its own convention). **Both lines render as
solid, unbroken black strokes — visually identical.** I repeated the test independently on
`sheets/E-003_vfd_power.png`'s legend (its own "VERIFIED — solid" / "FIELD VERIFY — dashed + red
wire flag" pair, at SVG y=942/956) — same result, both solid. I then cropped the actual W200 field
wire on E-005 (8x zoom) — solid, no dash gaps, despite `stroke-dasharray="7,4"` in the source.

**Scope:** every wire in `model/wires.yaml` (27 conductors across E-003/E-005/E-006) is
`status: field_verify` — there is not one `status: verified` wire in that file. In
`model/e007_rs485.yaml`, 3 of 4 links (`485+`, `485-`, `SGND`) are `evidence: verified` and 1
(`SH`, the shield) is `field_verify`. **Net: 28 of the package's 31 modeled conductors are
supposed to render dashed, and none of them do** in the shipped `.png`/`.pdf`. The red wire-number
tag boxes are unaffected (they're `<rect>`+`<text>`, not stroke-dashed) and still correctly flag
field-verify wires in red vs. black — that is the one surviving cue — but the line-weight/dash
convention the style law calls a *hard rule* ("Unknown wiring is dashed... never draw a guess as a
confident solid line," `excalidraw_electrical_print_style.md` §2 rule 2-3) and every sheet's own
legend promises, is non-functional in the artifact a technician would actually open or print.

**Rubric mapping:** this is **HF2** verbatim — "A conductor rendered visually SOLID (in the PNG
and PDF, not just the SVG) whose model status is not verified" — on **every one of the 28
non-verified conductors, on all 4 sheets**. It also fails category 11's explicit measurable check
("the PNG/PDF visually match the SVG's solid/dash semantics") outright.

**Root cause (for the fix):** `_emit()` (render_sheet.py ~L302-315) and the inlined equivalent in
`render_e005()` (~L693-701) do `fitz.open(stream=svg, filetype="svg")` →
`doc.convert_to_pdf()` / `doc[0].get_pixmap(...)`. PyMuPDF's SVG importer does not appear to
preserve `stroke-dasharray` through either the PDF-conversion or the direct-pixmap path. This is a
**tooling defect**, not a modeling defect — the YAML discipline and the Python dash logic are both
correct; the renderer silently loses the signal on the way out.

**Verdict impact:** per the rubric ("Any hard-fail = package NOT APPROVABLE regardless of points"),
this alone makes the package **NOT APPROVABLE** as shipped.

---

## SECOND FINDING — HF6 + undisclosed HF4-candidate, E-006 "MODBUS CROSS-REF" box

Located at `render_sheet.py` lines 1103-1108, rendered text: *"MODBUS CROSS-REF (run/dir/freq):
Run/dir/freq commands reach VFD1 over RS-485 (E-007): 0x2000 cmd (STOP=1, FWD+RUN=18, REV+RUN=34),
0x2001 freq. P00.20=1, P00.21=2 (RS-485) verified by 2026-05-20 parameter export."*

**HF6 (render-only facts, no YAML backing):** I grepped all six model files
(`devices.yaml, terminals.yaml, wires.yaml, sheets.yaml, open_items.yaml, e007_rs485.yaml`) for
`0x2000, 0x2001, STOP=1, FWD+RUN=18, REV+RUN=34, P00.20`. None of it is there — `sheets.yaml`'s
E-006 note mentions only the bare fact "P00.21=2" in prose. Every other number in that box
(register addresses, bit-field command words, P00.20's value) is typed directly into
`render_sheet.py` with **zero model row**. That is HF6's literal definition: "Engineering
information present only in the render... with no model (YAML) backing."

I did not stop at "unsourced" — I independently verified the *content*, and it's mixed:
- `P00.20=1` and `P00.21=2` check out: I opened the externally-cited parameter export
  `C:\Users\hharp\Documents\CCW\MIRA_PLC\docs\vfd\GS10_actual_parameters_5.20.26.xlsx` (not in the
  git worktree) — its "Different Value" sheet shows `00.20 ... = 1` and `00.21 ... = 2`. Real,
  bench-read values. So the render pulled a true fact, cited its source in the sheet's own
  SOURCES list at the bottom — it just skipped the YAML modeling step everything else in this
  package goes through.
- `FWD+RUN=18` checks out against `plc/GS10_Integration_Guide.md` L116 (0x0012=18) **and**
  `plc/Prog_init_ConvSimple_v2.1.st` L217 (`vfd_cmd_word := 18`) — both agree.
- **`REV+RUN=34` does NOT match `plc/GS10_Integration_Guide.md`, which states (L117) `REV + RUN =
  0x0014 = 20 decimal`.** It DOES match the live PLC program,
  `plc/Prog_init_ConvSimple_v2.1.st` L219: `vfd_cmd_word := 34; (* REV + RUN *)`. Both files are
  cited elsewhere in this same package as VFD1 evidence sources (`devices.yaml`, VFD1 entry).

**HF4 candidate:** two of the package's own cited primary sources disagree (20 vs. 34) on the same
fact, and neither the E-006 sheet nor `sheets.yaml`'s E-006 note discloses it. This package is
otherwise *excellent* about flagging exactly this kind of conflict — E-007 has a whole red
"CORRECTED from May-16 draft: Channel 0→2 · SGND pin 1/8→pin 3 · 8N2→8N1" callout, and E-006 itself
has a well-written note explaining why the CR-relay hardwired fallback is superseded by
Modbus — so the absence of a same-style note here ("Integration Guide says 20; live program uses
34 — program governs, guide stale") is conspicuous. I am not adjudicating *which* value is correct
(that's a controls-engineering / PLC-logic call, and the live-running-program value is the more
likely ground truth) — I'm reporting, with file:line citations, that an unacknowledged contradiction
between cited sources exists on this exact fact, which is HF4's literal definition. Flagging for the
evidence & hallucination auditor to formally adjudicate; I score it as a strong deduction under E-006
categories 1 and 12 below.

---

## Per-sheet scoring

Deduction format per rubric: `-N pts, category, element, location, reason`.

### E-003 — VFD POWER — **81/100** (+ HF2)

| # | Category | Pts | Score |
|---|---|---|---|
| 1 | Electrical truth & evidence | 15 | 14 |
| 2 | Technician troubleshooting readability | 12 | 9 |
| 3 | Maintenance-engineer approvability | 8 | 7 |
| 4 | Standard symbols & reference designations | 8 | **4** |
| 5 | Wire & terminal identification | 10 | 7 |
| 6 | Power/control/grounding/safety separation | 8 | 8 |
| 7 | PLC I/O presentation | 8 | 7 |
| 8 | VFD power & control presentation | 8 | 8 |
| 9 | Cross-references & continuation markers | 6 | 6 |
| 10 | Title block/revision/notes/print-scale | 7 | 5 |
| 11 | YAML-to-render consistency | 5 | **1** |
| 12 | Absence of unsupported assumptions | 5 | 5 |

**Hard fails:** HF2 (see headline finding — every field_verify conductor on this sheet renders
solid; W300-W317 all `field_verify`, none render dashed in the shipped PNG/PDF).

**Deductions:**
- -1 pt, cat 1, Q1 label, main drawing area ("Q1 — SAFETY POWER CONTACTOR (MC)"): `devices.yaml`'s
  Q1 note records the alias "a.k.a. MLC in WorkInstruction_v3" but the render surfaces "MC," a
  different alias never defined in any model row. Minor YAML↔render alias drift, not a fabrication
  (MC is a plausible generic term) but not what the model actually says either.
- -3 pts, cat 2, whole sheet: the §6 meter-lead acceptance test depends on "verified vs field-verify
  clearly marked" — HF2 breaks the dash half of that; the red wire-tag color survives, which is why
  this isn't a full HF2-driven zero here, but a tech scanning line weight alone (the way the legend
  teaches them to) gets no signal.
- **-4 pts, cat 4 (deep-dive), CB1 and Q1 pole symbols, main drawing (`breaker_pole()` /
  `contactor_pole()`, render_sheet.py L161-180):** both functions draw the identical glyph — a
  rectangle with two flanking stubs and an inverted-V "chevron" — differing in source only by
  dashed-vs-solid box outline. Neither glyph is a recognized IEC 60617 or NEMA/IEEE-315 breaker or
  contactor-pole symbol (real breaker glyphs show a break/trip mark; real contactor NO-pole glyphs
  are the same lifted-blade-between-two-dots symbol this same file *already implements correctly*
  as `contact_no()`, used on E-005 — but E-003 doesn't reuse it). Because of the HF2 dash-drop bug,
  the one surviving differentiator (dashed box vs. solid box) is *also* erased in the shipped PNG —
  I cropped CB1's and Q1's pole rows side by side at 3x zoom and they are pixel-identical apart from
  the text label above each row. A technician cannot tell a breaker pole from a contactor pole by
  symbol alone anywhere on this sheet.
- -3 pts, cat 5 (deep-dive), wire numbers W300-W317, main drawing: internally consistent within this
  sheet (one exclusive 300-block, no collisions), but this is not the style law's own stated
  numbering rule (§2 rule 8b: `[page][line]`, e.g. "5003" = sheet E-005 line 3 — this sheet would
  need 3-thousands like `3001`, not `300`). No legend or note anywhere in the package documents the
  hundreds-per-sheet convention actually in use (confirmed: grepped all 4 SVGs for
  "legend/convention/scheme" text — none exists). See the cross-sheet wire-numbering finding below.
- -2 pts, cat 10 (deep-dive), legend box, bottom-left: the "VERIFIED — solid" / "FIELD VERIFY —
  dashed" legend key is the specific mechanism broken by HF2; a title-block-adjacent required
  element (category 10 asks for "legend... legible at 100% zoom") that no longer teaches what it
  claims to teach in the shipped file.
- -4 pts, cat 11, whole sheet: category 11's own measurable check ("the PNG/PDF visually match the
  SVG's solid/dash semantics") fails outright — this is the category most directly written to catch
  exactly HF2.

**What's good (not deducted):** PE bus occupies its own orthogonal lane, fully separated from the
power conductors (no crossing ambiguity) — clean category-6 execution. GS10 terminal names are
verbatim manufacturer designations with line-cited evidence (`GS10_UM.txt` L1971-1986). The `GND`
label on VFD1 is explicitly disclosed as "OUR label" (not a manufacturer marking) — exactly the
honesty the style law demands, not a silent invention. DC-bus/jumper terminals shown WITH state
(+1/+2 factory jumper, B1/B2 OPEN, DC+/DC- OPEN) per category 8's explicit ask. Coil↔pole
cross-reference to E-006 is bidirectional and correct.

---

### E-005 — PLC DIGITAL INPUTS — **83/100** (+ HF2)

| # | Category | Pts | Score |
|---|---|---|---|
| 1 | Electrical truth & evidence | 15 | 14 |
| 2 | Technician troubleshooting readability | 12 | 10 |
| 3 | Maintenance-engineer approvability | 8 | 7 |
| 4 | Standard symbols & reference designations | 8 | 6 |
| 5 | Wire & terminal identification | 10 | **6** |
| 6 | Power/control/grounding/safety separation | 8 | 8 |
| 7 | PLC I/O presentation | 8 | 8 |
| 8 | VFD power & control presentation | 8 | 7 (n/a, neutral) |
| 9 | Cross-references & continuation markers | 6 | 6 |
| 10 | Title block/revision/notes/print-scale | 7 | 5 |
| 11 | YAML-to-render consistency | 5 | **1** |
| 12 | Absence of unsupported assumptions | 5 | 5 |

**Hard fails:** HF2 (W24, W200-W205, W0V are all `field_verify`; none render dashed).

**Deductions:**
- -2 pts, cat 2, whole sheet: same HF2 line-weight signal loss as E-003, partially offset here by
  the sheet's own printed "READS (acceptance)" walkthrough text, which still correctly narrates the
  verified/field-verify split in words even though the drawing doesn't show it visually.
- -2 pts, cat 4 (deep-dive), SS1 FWD/REV selector actuator glyph, `selector()` render_sheet.py
  L122-133: the actuator cap is rendered as the Unicode character "∓" (plus-minus). Verified at 4x
  zoom crop — it is unambiguously the math glyph, not a recognized selector-switch actuator symbol
  (real practice: a simple angled lever/knob line, or a position-dot convention). Ad-hoc,
  non-standard, and the only glyph in the package that reads as a typo/placeholder rather than a
  deliberate symbol choice.
- **-4 pts, cat 5 (deep-dive), wire numbers W200-W205/W24/W0V, main drawing:** this is the sheet
  that breaks the package's own semi-consistent numbering pattern. E-003 (sheet 3) uses the
  300-block; E-006 (sheet 6) uses the 600-block — both match a "sheet-number × 100" scheme. E-005
  (sheet 5) uses the **200**-block, not 500. Sheets.yaml even notes E-005 was "rendered first, per
  the new rule" — plausible explanation (the numbering convention was set after this sheet was
  drafted and never backfilled), but nothing on the sheet or in the model documents the deviation.
  W24 and W0V are additional mnemonic (non-block-numeric) exceptions layered on top, also
  undocumented. This is the most significant, precisely-located wire-numbering consistency defect
  in the package.
- -2 pts, cat 10 (deep-dive), legend box: same HF2-driven legend-signal loss as E-003.
- -4 pts, cat 11, whole sheet: same category-11 dash-semantics failure as every sheet.

**What's good (not deducted):** best-evidenced sheet in the package — PLC terminal↔function mapping
traces to `Prog_init_ConvSimple_v2.1.st`, Ignition `tags.json`, and `LogicalValues.csv` with
verbatim silk-screen terminal IDs (I-00..I-11). `contact_nc()`/`contact_no()` glyphs are correctly
and distinctly applied — I confirmed in source (`plan` dict, render_e005() L519-526) that I-02
(NC channel) maps to `estop_nc`→`contact_nc()` and I-03 (NO channel) maps to `estop_no`→
`contact_no()`, matching `terminals.yaml`'s stated function for each. This is the standard,
recognizable NC/NO differentiation (diagonal blade vs. diagonal blade + perpendicular bar) done
right. Spares (I-06..I-11) use a distinct hollow-circle glyph with "confirmed unused" text — a
clean, honest state marker. Safety note on monitored-vs-hardwired e-stop is prominent and correctly
worded per NFPA 79/EN 60204-1.

---

### E-006 — PLC OUTPUTS — **69/100** (+ HF2, HF6, HF4-candidate) — weakest sheet

| # | Category | Pts | Score |
|---|---|---|---|
| 1 | Electrical truth & evidence | 15 | **7** |
| 2 | Technician troubleshooting readability | 12 | 8 |
| 3 | Maintenance-engineer approvability | 8 | 7 |
| 4 | Standard symbols & reference designations | 8 | 6 |
| 5 | Wire & terminal identification | 10 | 8 |
| 6 | Power/control/grounding/safety separation | 8 | 8 |
| 7 | PLC I/O presentation | 8 | 6 |
| 8 | VFD power & control presentation | 8 | 7 |
| 9 | Cross-references & continuation markers | 6 | 6 |
| 10 | Title block/revision/notes/print-scale | 7 | 4 |
| 11 | YAML-to-render consistency | 5 | **0** |
| 12 | Absence of unsupported assumptions | 5 | 2 |

**Hard fails:** HF2 (W600-W609 all `field_verify`, none render dashed) + **HF6** (MODBUS CROSS-REF
box, register/command values with zero YAML backing) + **HF4-candidate** (REV+RUN=34 vs. the cited
Integration Guide's REV+RUN=20, undisclosed — see Second Finding above).

**Deductions:**
- **-8 pts, cat 1, MODBUS CROSS-REF box, right column (render_sheet.py L1103-1108):** HF6 (facts
  with no model row) compounded by the undisclosed REV+RUN discrepancy against a co-cited source —
  this is the single worst evidence-discipline lapse I found in the package. The box's own claim
  "verified by 2026-05-20 parameter export" is only true for P00.20/P00.21; the export contains no
  register-address or command-word data at all (I opened it — it's a parameter-number/value table,
  nothing else), so that citation over-claims what its own source actually supports for the rest of
  the box's content.
- -4 pts, cat 2, whole sheet: same HF2 signal loss, plus the undisclosed REV+RUN conflict is a
  genuine "wrong lead placement" risk if a technician cross-checks the Integration Guide and gets a
  different number than the sheet without any note explaining why.
- -2 pts, cat 4 (deep-dive), Q1 COIL symbol, main drawing (`coil()`, render_sheet.py L183-195):
  drawn as a circle with a stylized "⌒" arc (NEMA/ANSI-style relay/contactor coil body) but labeled
  with IEC terminal names A1/A2 (IEC 60445). Confirmed at 5x zoom crop. Not wrong — Q1's own
  IEC-flavored tag choice (see designation census) makes this a defensible hybrid — but it's a
  genuine mixed-convention pairing (NEMA body + IEC terminals) worth a technician's awareness; a
  pure-IEC print would draw the coil as a rectangle, not a circle.
- -2 pts, cat 5 (deep-dive), wire numbers W600-W609: same "undocumented block convention" issue as
  every sheet, milder here because this sheet's 600-block *does* match the sheet-number×100 pattern
  (internally and cross-sheet consistent with E-003).
- -2 pts, cat 7, PLC I/O presentation: the MODBUS CROSS-REF content undermines the otherwise-clean
  "OPC variable names shown" discipline this category rewards, by mixing in unsourced material in
  the same visual block.
- -3 pts, cat 10 (deep-dive), legend box, right column: this sheet's legend shows only ONE sample
  line ("FIELD VERIFY — dashed") — no "VERIFIED" sample at all, unlike E-005 and E-007, which both
  show the pair. Minor bound-set consistency gap (every sheet should teach the same two-state key
  the same way) on top of the HF2 rendering failure.
- -5 pts, cat 11, whole sheet: worst of the 4 sheets for this category — fails the dash-semantics
  check like every sheet, AND fails the more basic "rendered content == model content" check via
  HF6. Category 11 explicitly asks for "spot-check ≥5 facts/sheet" — of the 7 distinct facts in the
  MODBUS CROSS-REF box alone, 5 have no model row at all.
- -3 pts, cat 12, MODBUS CROSS-REF box: presenting REV+RUN=34 in a confident, "verified by..." tone
  while a co-cited source states 20, with no caveat, is the closest thing in this package to
  "confident tone about an unverified/contested fact" — the one place the package's otherwise-good
  honesty discipline lapses.

**What's good (not deducted):** rung grammar correctly mirrors E-005 (same rail/rung/terminal
layout pattern, satisfying category 7's "mirrored input/output grammar" ask). Output-return-rail
routing is clean and orthogonal, no crossing ambiguity. Hardwired-fallback-NOT-ACTIVE note
(DO_07 doesn't exist on this PLC model, DO_03 collides with PBRunLED) is a genuinely excellent,
well-evidenced supersession disclosure — exactly the pattern the REV+RUN box should have followed
and didn't. `pilot()` glyph correctly and consistently reused for PL1/PL2/S2's lamp element (a
device-family consistency win: S2 correctly gets a *different*, appropriate glyph on E-005 [contact]
vs. E-006 [lamp] because those are genuinely two different physical elements of the same device).

---

### E-007 — RS-485 / MODBUS RTU — **83/100** (+ HF2, mildest instance)

| # | Category | Pts | Score |
|---|---|---|---|
| 1 | Electrical truth & evidence | 15 | 14 |
| 2 | Technician troubleshooting readability | 12 | 10 |
| 3 | Maintenance-engineer approvability | 8 | 7 |
| 4 | Standard symbols & reference designations | 8 | 8 |
| 5 | Wire & terminal identification | 10 | **5** |
| 6 | Power/control/grounding/safety separation | 8 | 8 |
| 7 | PLC I/O presentation | 8 | 7 (n/a, neutral) |
| 8 | VFD power & control presentation | 8 | 7 |
| 9 | Cross-references & continuation markers | 6 | 6 |
| 10 | Title block/revision/notes/print-scale | 7 | 5 |
| 11 | YAML-to-render consistency | 5 | 2 |
| 12 | Absence of unsupported assumptions | 5 | 4 |

**Hard fails:** HF2, but the mildest case in the package — only 1 of this sheet's 4 conductors
(`SH`, the shield/drain) is `field_verify`; the other 3 (`485+`, `485-`, `SGND`) are genuinely
`evidence: verified` and correctly render solid (unaffected by the bug either way). I confirmed
`render_e007()` L374 does pass `dash=True` for the SH line specifically — the Python intent is
correct, same systemic rendering defect erases it.

**Deductions:**
- -2 pts, cat 2 / -3 pts cat 11: same HF2 mechanism, scoped to the one affected wire.
- **-5 pts, cat 5 (deep-dive), CONNECTION TABLE "Wire" column + drawing tags, this sheet's central
  identification scheme:** this is the starkest wire-numbering inconsistency in the package. E-003/
  E-005/E-006 all use a `W###` numeric tag (even if the block assignment itself is inconsistent, as
  documented above). **E-007 abandons the numeric scheme entirely** and tags its 4 conductors with
  mnemonic signal names — `485+`, `485-`, `SGND`, `SH` — with no wire number at all. A technician
  used to reading "Wxxx" tags on the other 3 sheets of this same bound set hits a sheet with a
  completely different tagging vocabulary. This is defensible on its own terms (the labels are
  arguably more useful than an arbitrary number for a 4-conductor point-to-point comms link) but it
  is a real, unaddressed break in the "numbering scheme consistent and sheet-mappable" measurable
  check category 5 states verbatim, and nothing in the package acknowledges the sheet made a
  deliberate departure.
- -1 pt, cat 12, open items: `open_items.yaml` OI-20 ("GS10 comms line params: 2026-05-20 export =
  38.4k/8N2 vs 2026-05-26 bench sniff = 9600/8N1 — adjudicate") is a live, unresolved conflict about
  *this exact sheet's* central parameter (baud rate), but OI-20 is never inline-cited anywhere on
  the E-007 sheet — unlike E-003/E-006, which both inline-cite their OI numbers directly. The sheet's
  "CORRECTED from May-16 draft" callout discloses the *format* correction (8N2→8N1) but not that a
  baud-rate discrepancy (38.4k vs 9600) is also still open.

**What's good (not deducted):** cleanest sheet in the package for symbols/layout — minimal glyph
inventory (device blocks, earth symbol reused correctly from E-003, a plain-rectangle IEC-style
termination-resistor glyph), fully orthogonal, no crossings, shield-grounding handled with the
correct "land one end only" doctrine and explicitly called out in red. Real, verbatim terminal
designations on both ends (PLC `D+(A)/D-(B)/SG/shield`; VFD `RJ45 pin 5/4/3`) — appropriately NOT
forced into a shared naming scheme since they are genuinely different connector families. The
"CORRECTED from May-16 draft" callout is the best-practice model for supersession disclosure in the
whole package (exactly what E-006's REV+RUN box should have done).

---

## Designation census (every device tag + terminal-ID family observed)

### Device tags

| Tag | Class | Family/heritage | Consistency verdict |
|---|---|---|---|
| PLC1 | plc | generic + number | Unique, no conflicts |
| VFD1 | vfd | generic + number, matches standards-pack §5.1 worked table exactly | Unique, no conflicts |
| M1 | motor | NEMA (`M`), matches §5.1 table | Unique |
| S0 | e_stop | NEMA-ish (`S`), matches rubric's expected family | Unique |
| SS1 | selector_switch | NEMA-ish (`SS`), matches rubric's expected family | Unique |
| S2 | pushbutton_no | NEMA-ish (`S`) | Reused correctly across E-005 (contact) / E-006 (lamp) — same tag, two elements of one physical device, both sheets consistent with each other |
| B1 | photo_eye | IEC 81346-2 class **B** ("picks up/converts information") — exact class-letter match | Unique |
| PS1 | power_supply | NEMA-ish (`PS`) | Unique |
| CB1 | circuit_breaker | NEMA/JIC (`CB`) — verbatim match to standards-pack §5.1 "Branch breaker/fuses" row | Unique |
| Q1 | contactor | **IEC 81346-2 class `Q`** ("controlled switching of energy flow") used bare, without the full `-Q1` aspect-prefix syntax — a hybrid: IEC letter semantics in NEMA-style flat numbering | Unique. Rubric's own category-4 measurable-checks line explicitly lists "Q/CB/PL/S/SS/B/M/PS/X" as the expected family — this exact mixed set is what the rubric anticipates, so **not scored as a deduction**, but flagged per my task charter as a documented tension worth a reader's awareness (see E-006 coil-symbol note above, where the mixed heritage becomes visible in the glyph choice) |
| PL1, PL2 | pilot_light | NEMA-ish (`PL`) | Unique, consistent glyph reuse |
| X1 | terminal_block | NEMA-ish (`X`, also IEC 81346-2 class `X`="connects/interfaces" — coincides in both regimes) | Stub (E-008 not yet drawn); no terminals rendered yet |

**No duplicate/colliding tags found.** No tag reused for two different physical devices.

### Terminal-ID families

| Family | Devices | Convention | Verdict |
|---|---|---|---|
| `I-00..I-11`, `O-00..O-06`, `COM0`, `±CM0/±CM1` | PLC1 | Real Micro820 silk-screen IDs | Verified, consistent |
| `R/L1,S/L2,T/L3` / `U/T1,V/T2,W/T3` / `+1,+2` / `B1,B2` / `DC+,DC-` / `GND` | VFD1 | Real GS10 silk-screen IDs, **except** `GND` which `terminals.yaml` explicitly discloses as "OUR label" (manual gives only a silk-screen symbol, no letter ID) | Verified where cited; the one non-verbatim ID is honestly flagged, not silently invented |
| `1..6` (poles), `A1/A2` (coil) | CB1, Q1 | IEC 60445/60947 | Internally consistent between the two switching devices on E-003; note the CB1↔Q1 pole numbering is identical in style, good |
| `11-12` (NC), `23-24` (NO) | S0 | Plausible IEC 60947-5-1 dual-contact-block pattern | Proposed/unverified, but pattern-consistent with real E-stop practice |
| `3-4` | S2 | Simpler single-block IEC-ish pattern (distinct from the `X-14`-style aux-contact pattern used for contactor aux contacts) | Proposed/unverified, plausible |
| `X1/X2` | PL1, PL2, S2 (lamp) | IEC lamp-terminal convention | Consistent across all three instances |
| `BN/BU/BK` | B1 | Wire-COLOR convention (brown/blue/black) for a 3-wire DC sensor cordset — not a terminal number at all | Correct, realistic convention for a cordset-connectorized sensor |
| `D+(A)/D-(B)/SG/shield` vs `pin 5/4/3` (RJ45) | PLC1 vs VFD1, E-007 | Two different real connector-family conventions, correctly NOT forced into a shared scheme | Correct |

### Wire-numbering scheme (cross-sheet — the specific check my task brief called out)

| Sheet | Scheme observed | Matches style law §2 rule 8b (`[page][line]`, e.g. `5003`)? | Matches "sheet-number×100" (informal, undocumented) pattern? |
|---|---|---|---|
| E-003 | `W300`-`W317` | No | **Yes** (sheet 3 → 3xx) |
| E-005 | `W24`, `W200`-`W205`, `W0V` | No | **No** — outlier; sheet 5 uses 2xx, would need 5xx |
| E-006 | `W600`-`W609` | No | **Yes** (sheet 6 → 6xx) |
| E-007 | `485+`, `485-`, `SGND`, `SH` (no `W` numbers at all) | No | No — different scheme entirely (mnemonic, not numeric) |

**Finding: no sheet implements the style law's own literally-stated numbering rule.** Three of
four sheets (E-003/E-006, and by extension the still-unstubbed E-004) are internally consistent
with an *undocumented* alternative (hundred-block = sheet number × 100); E-005 breaks even that
pattern; E-007 doesn't use the `W`-number vocabulary at all. No legend, cover sheet, or note
anywhere in the current 4-sheet deliverable explains which convention is actually in force — I
confirmed this by grepping all 4 SVGs for legend/convention/scheme text and finding none. The
planned cover sheet (E-001, "wire-number convention key" per `sheets.yaml`'s own file-taxonomy
table) is still a stub, which is the root cause: the convention was never actually written down
anywhere, so E-005 (drafted first, per its own status note) and E-007 (a structurally different
circuit — point-to-point comms, not a rung-based I/O sheet) both drifted from what E-003/E-006
happen to agree on.

---

## Package verdict

**NOT APPROVABLE.**

- Hard-fails present: **HF2 on all 4 sheets** (package-wide dash-rendering failure — see headline
  finding), **HF6 on E-006** (MODBUS CROSS-REF box, unmodeled facts), and one **HF4 candidate on
  E-006** (undisclosed REV+RUN=34-vs-20 conflict between two cited sources) that I'm flagging for
  the auditor's formal call. Per the rubric, any hard-fail makes the package NOT APPROVABLE
  regardless of points.
- Independently, my scores put every sheet below the 90-point approvability floor: E-003 81,
  E-005 83, E-006 **69**, E-007 83. Package score (minimum of the four) = **69**.
- This is a drafting-standards read only; I have not scored categories 1/7/8/9 with the same depth
  a controls engineer or maintenance technician would bring, though nothing I found in passing
  contradicts my category-4/5/6/10 focus except where explicitly noted (the REV+RUN conflict, which
  I surfaced because it fell directly out of my YAML-traceability pass for category 5/11).

## Top 5 fixes (priority order)

1. **Fix the SVG→PDF/PNG dash-rendering pipeline (HF2, blocks everything).** The model and Python
   logic are already correct; only the PyMuPDF conversion step needs a fix (e.g., bake dash
   patterns into explicit multi-segment `<line>` runs before handing to `fitz`, or switch the
   rasterizer/PDF backend, or post-process the PDF content stream to inject a real dash array).
   Until this is fixed, re-verify by re-running the exact legend-crop test in this report (zoom the
   shipped PNG's own VERIFIED/FIELD VERIFY legend swatches) — don't trust the SVG source alone.
2. **Move the E-006 MODBUS CROSS-REF box's facts into `model/` (HF6) and adjudicate/disclose the
   REV+RUN discrepancy (HF4 candidate).** Add the register map + command words to
   `e007_rs485.yaml` or a new `model/vfd_control.yaml`, cite `GS10_Integration_Guide.md` AND
   `Prog_init_ConvSimple_v2.1.st` explicitly, and add a "SUPERSEDED" note for REV+RUN matching the
   package's own established pattern (E-007's "CORRECTED from May-16 draft" callout is the template
   to copy).
3. **Draft E-001 (cover/legend/wire-number-convention key) and pick one real numbering rule** —
   either implement the style law's own `[page][line]` rule as written, or formally adopt and
   document the "sheet-number×100" convention already implicit in E-003/E-006, and backfill E-005
   (200→500 block) and E-007 (adopt `W7xx` alongside, or beside, its mnemonic labels) to match.
4. **Replace the ad-hoc `breaker_pole()`/`contactor_pole()` chevron-box glyph** with a recognizable
   IEC 60617/NEMA breaker symbol and reuse the already-correct `contact_no()` glyph (or a proper
   IEC contactor-pole glyph) for Q1 — the file already has the right NO-contact symbol implemented
   for E-005, it's just not used on E-003.
5. **Fix the `selector()` actuator glyph** (drop the "∓" character for a real lever/knob mark) and
   add a "VERIFIED" legend sample to E-006 to match E-005/E-007's two-sample legend for bound-set
   consistency. (Low-cost, but both are visible on every print of the affected sheets.)

## Minor / out-of-scope note

`review/CROSSREF_MATRIX.md` (and likely `EVIDENCE_MATRIX.md`/`FIELD_VERIFY_LIST.md`, sharing the
same code path) contains visible mojibake — `â€"` for em-dash, `Ï†` for φ, `Î©` for Ω — e.g. "existence,
type, rating unconfirmed" rendered as "â€” existence..." and "L3 (3Ï†)". Root cause confirmed:
`emit_matrices.py::load_yaml()` (L40) opens YAML files with bare `open(path, "r")` — no
`encoding="utf-8"` — so on Windows it decodes with the platform-default codepage (not UTF-8),
corrupting every non-ASCII character from the YAML source before it's (correctly) UTF-8-written
back out. `render_sheet.py`'s own loader is NOT affected (`_load()` uses
`Path.read_text(encoding="utf-8")` explicitly), which is why the actual sheets render "3φ" cleanly —
only the machine-generated matrix files are corrupted. One-line fix
(`open(path, "r", encoding="utf-8")`), not a sheet-scoring issue, but worth fixing since this
document is a named input to the grading process itself.
