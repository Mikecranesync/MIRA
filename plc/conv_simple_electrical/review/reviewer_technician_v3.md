# CV-101 Electrical Print Package V3 — Technician Review (Independent, Round 3)

**Reviewer role:** Industrial maintenance technician, 20 years VFD/conveyor work. Deep-dive categories per rubric: **2 (technician readability), 5 (wire/terminal ID), 7 (PLC I/O presentation), 9 (cross-references)**. All 12 categories scored per rubric requirement.

**Method:** Read `review/GRADING_RUBRIC.md`, `GOLD_STANDARD_SOURCES.md`, `docs/reference/excalidraw_electrical_print_style.md`, all five `model/*.yaml` files, `EVIDENCE_MATRIX.md`/`CROSSREF_MATRIX.md`/`FIELD_VERIFY_LIST.md`. Viewed all 5 sheets (`sheets/*.png`) at native 3200x2080 resolution via quadrant crops (up to 3.5x zoom on specific details), cross-checked against `render_sheet.py` source where a rendering question needed a definitive answer (not a guess), and spot-verified 2 load-bearing OEM citations against the actual cited source files (`GS10_UM.txt` lines 1971-1975, `Prog_init_ConvSimple_v2.1.st` lines 217-221) — both confirmed accurate, not fabricated. Confirmed `sheets/E-003_vfd_power.png/.pdf/.svg` postdate the current `render_sheet.py` and all model YAML (not a stale render). Did **not** read `reviewer_*_v2.md` or `GRADES_V2.md` per instructions — this review is unanchored from the prior round.

---

## HARD FAILS

### HF5 — CONFIRMED, sheet E-003, 6 instances — text struck by a line

At **zone A2–A3** (CB1 breaker-pole labels) and **zone B2–B3** (Q1 contactor-pole labels) on E-003, the phase-identifier labels **"L1", "L2", "L3 (3φ)"** are visually struck through by the dashed SUPPLY→CB1 and CB1→Q1 conductor segments. Confirmed at 3.5x zoom — the dash literally bisects the "L" and "1" of "L1", the "L" and "2" of "L2", and the "(" of "L3 (3φ)", at both the CB1 row and the Q1 row (6 labels total: L1/L2/L3 × 2 rows).

**Root cause (verified in `render_sheet.py`):** the breaker/contactor pole helpers place their own label at `y‑22` from the pole center —
```python
def breaker_pole(s, x, y, label):
    ...
    s.text(x, y - 22, label, size=8, anchor="middle", weight="bold")   # line 229
def contactor_pole(s, x, y, label):
    ...
    s.text(x, y - 22, label, size=8, anchor="middle", weight="bold")   # line 239
```
but the *caller* draws the incoming dashed wire segment continuously through that exact y-range and does not stop short of it or box the label:
```python
for num, x in (("W300", xL), ("W301", xC), ("W302", xR)):
    seg(num, x, 190, x, 236, w_=2.0)      # line 916 — CB1 breaker label sits at y=228, inside 190-236
for num, x in (("W303", xL), ("W304", xC), ("W305", xR)):
    seg(num, x, 264, x, 346, w_=2.0)      # line 927 — Q1 contactor label sits at y=338, inside 264-346
```
This is a **layout bug**, not a fabrication — every value driving it (the wire, the terminal, the label text) traces correctly to the model. It is not HF6 either (the "L1/L2/L3" strings are generic phase designators, consistent with the *verified* `R/L1`/`S/L2`/`T/L3` naming already in `terminals.yaml` — not an invented asset-specific fact). But per rubric: **"Clipped, overlapping, unreadable, or off-frame content ... any text struck by a line" = HF5, zero tolerance, auto-fail.** PNG is a direct `fitz` rasterization of the PDF (`render_sheet.py:437-444`, `doc[0].get_pixmap(...)`), so this defect is identical in the PDF — verified by construction, not assumed.

**Per rubric: "Any hard-fail = package NOT APPROVABLE regardless of points."**

### HF1 / HF2 / HF3 / HF4 / HF6 — none found
- **HF1 (invented facts):** none. Every drawn terminal/wire/device on all 5 sheets traces to a model row. Spot-verified two of the most load-bearing citations directly against source: `GS10_UM.txt:1971,1973,1975` really does read "R/L1, S/L2" / "R/L1, S/L2, T/L3 Input Power" / "U/T1, V/T2, W/T3 AC Motor Drive Output"; `Prog_init_ConvSimple_v2.1.st:217,219,221` really does set `vfd_cmd_word := 18` (FWD+RUN) / `:= 34` (REV+RUN) / `:= 1` (STOP), matching `e007_rs485.yaml` exactly. All cited source files (`GS10_UM.txt`, `GS10_actual_parameters_5.20.26.xlsx`, `Conv_Simple_CommsToVFD.pdf`, `Conv_Simple_GS10_Beginner_Verify_V2`, `MIRA_PLC_WorkInstruction_v3`, `CCW_VARIABLES_v4.0.txt`, `LogicalValues.csv`, Ignition `tags.json`) exist on disk where cited.
- **HF2 (unverified solid conductor):** none. E-003/E-005/E-006 are 100% `field_verify`/dashed (matches `EVIDENCE_MATRIX.md`: 0 verified of 15/8/10 wires respectively). E-007's three solid conductors (485+, 485-, SGND) are all `status: verified` with two real endpoints and a cited source; the one field-verify conductor (SH) is correctly dashed.
- **HF3 (ambiguous PE/safety):** none. PE is a dedicated bus with a proper multi-bar earth symbol, distinct from any return/neutral path, on both E-003 (power) and E-007 (shield-drain, "land at PLC end ONLY" explicit). Every sheet touching the e-stop carries the "monitored input/output is NOT a safety function, hardwire to remove drive power" callout verbatim per style law §7.
- **HF4 (unacknowledged contradiction):** none — the opposite is a strength of this package. Every known supersession is loudly and explicitly flagged with a citation: I-05 "Entry sensor (spare)" vs. live photo-eye (E-005), REV+RUN=34 not 20 (E-007), Channel 2 not 0 / SGND pin 3 not 1-8 / 8N1 not 8N2 (E-007), the hardwired-fallback-NOT-ACTIVE caveat (E-006), and the open OI-20 comms-parameter conflict (38.4k/8N2 vs 9600/8N1) presented as unresolved, not papered over.
- **HF6 (render-only facts):** none found. Checked the two candidates most likely to be renderer-invented (CB1/Q1 pole labels "L1/L2/L3" hardcoded in `render_sheet.py` rather than pulled from YAML) — these are generic/conventional phase designators consistent with the verified terminal names, not asset-specific invented facts.

---

## Per-sheet scores (12 categories, 100 pts/sheet)

Legend: cat# → pts awarded / pts possible. N/A categories (no content of that kind on the sheet) scored full per rubric's E-001 carve-out, extended by the same logic to categories with literally nothing on-sheet to check (e.g., cat 8 on E-005, cat 7 on E-003/E-007).

### E-001 — Cover / Legend / Device Schedule — **98/100**

| Cat | Pts | /Max | Notes |
|---|---|---|---|
| 1 Electrical truth & evidence | 15 | 15 | All 13 device-schedule rows match `devices.yaml` verbatim (tag/type/model/role/evidence). |
| 2 Technician readability | 12 | 12 | 3-second test passes (title+subtitle state scope); §6 circuit-walk N/A (no circuit on a cover sheet). |
| 3 Maintenance-engineer approvability | 7 | 8 | -1: no open-items *count/pointer* on the cover itself (e.g. "20 open items — see E-009") — E-009 is listed only as a "stub" row in the sheet index, with no signal of how much is outstanding. |
| 4 Standard symbols | 8 | 8 | N/A — no device glyphs on a schedule sheet. |
| 5 Wire & terminal ID | 9 | 10 | -1, **element:** WIRE-NUMBERING KEY box, **location:** zone A5-A7, **reason:** style law §2 rule 8 requires **both** anti-spaghetti laws printed on E-001. Only law (b) ("number wires by [page][line]") is rendered (`render_sheet.py:522`, pulls `wires.yaml`'s `convention:` field verbatim). Law (a) — "same electrical node = same wire number; a number changes only through a device" — appears **nowhere** on the sheet. Confirmed by reading the render function; it emits only the `convention` string. Not ambiguous in practice (the PE-bus/rail exemption is consistent — W315/W316/W317 all land on "PE bus" as separate drop-numbers, same pattern as W24's rail), but the rule that *explains* that convention isn't stated. |
| 6 Power/control/ground/safety separation | 8 | 8 | N/A — no circuit; SAFETY block correctly scoped (LOTO + monitored-e-stop caveat, matches `sheets.yaml` verbatim). |
| 7 PLC I/O presentation | 8 | 8 | N/A. |
| 8 VFD power/control presentation | 8 | 8 | N/A. |
| 9 Cross-references | 6 | 6 | Sheet index lists all 9 sheets (E-001..E-009) with accurate status (5 drafted, 4 stub); no dangling reference. |
| 10 Title block/legend/print-scale | 7 | 7 | Complete title block, correct zone grid, line-style legend visually verified correct (see below). |
| 11 YAML-render consistency | 5 | 5 | Spot-checked all 13 device rows + wire-numbering convention text: exact match. |
| 12 Absence of unsupported assumptions | 5 | 5 | field_verify rows correctly red (M1, PS1, CB1, X1); SAFETY text matches model exactly. |

**Legend swatch check (explicitly requested):** zoomed the E-001 LINE-STYLE LEGEND at 4x. The "VERIFIED (solid)" swatch is a genuine continuous stroke; the "FIELD VERIFY (dashed)" swatch is a genuinely segmented dash-dash-dash-dot stroke. Not a rendering illusion — the semantics are real in the raster, both PNG and (by construction, since PNG is rasterized directly from the PDF via `fitz`) the PDF.

### E-003 — VFD Power — **89/100 — HF5 present (see above)**

| Cat | Pts | /Max | Notes |
|---|---|---|---|
| 1 Electrical truth & evidence | 15 | 15 | All 15 wires match `wires.yaml`; GS10 terminal citations verified against source (see HF section). |
| 2 Technician readability | 9 | 12 | -3, **element:** CB1 & Q1 pole labels, **location:** zone A2-A3 / B2-B3, **reason:** the struck-through "L1/L2/L3" labels are exactly the detail a tech needs to answer "which of these three parallel dashed runs is L1" during the meter-lead walk — legibility damage lands precisely on the step that matters most. Full walk detail below. |
| 3 Maintenance-engineer approvability | 7 | 8 | -1: same CB1/Q1 label defect — an approver would stop and ask "what does that say?" which the rubric's "nothing requiring verbal explanation" bar exists to prevent. |
| 4 Standard symbols | 6 | 8 | -2, **element:** CB1 breaker-pole glyph, **location:** zone A2-A3, **reason:** the X-cross + quarter-arc mark (`breaker_pole()`) reads closer to a fused-disconnect/isolator symbol in ANSI one-line convention than a circuit-breaker glyph (no trip-block/rectangle). Consistently used and distinguishable from the contactor's plain diagonal-arm glyph, so not ad-hoc/random — but not textbook IEC 60617 either. |
| 5 Wire & terminal ID | 10 | 10 | Every one of 15 conductors flagged (W300-W317), boxes opaque/off-line/not bisected (`wire_tag()` design confirmed in code and visually), both endpoints match `terminals.yaml` exactly, W3xx=sheet-3 numbering consistent. (The struck labels are pole-identity text, not wire-number flags — scored under cat 2/4/10, not double-counted here.) |
| 6 Power/control/ground/safety separation | 8 | 8 | Single circuit family; PE on its own bus with earth symbol, orthogonal drops; safety block thorough (never switch via input power, LOTO+5min DC-bus wait, monitored e-stop caveat). |
| 7 PLC I/O presentation | 8 | 8 | N/A — no PLC I/O on a power sheet. |
| 8 VFD power/control presentation | 8 | 8 | Supply-top/motor-bottom orientation; GS10 terminals verbatim; +1/+2 (jumpered, drawn as a closed bracket) vs B1/B2, DC+/DC- (open, drawn as flat stubs) — state is visually AND textually encoded, a nice touch. |
| 9 Cross-references | 6 | 6 | "SUPPLY (source — see E-002)" + "to source PE (E-002)"; "Q1 coil ← O-02 (E-006)" — confirmed bidirectional against E-006's "poles on E-003" note. |
| 10 Title block/legend/print-scale | 2 | 7 | **-4 + -1** (capped, not literally summed below zero), **element:** CB1 pole labels ("L1"/"L2"/"L3 (3φ)"), **location:** zone A2-A3; **element:** Q1 pole labels (same text), **location:** zone B2-B3. **Reason:** this category's own measurable check is "all text legible at 100% zoom" — violated 6 times on this one sheet. This is where HF5 lives; the low score is a direct, literal reading of the category bullet, not a double-penalty invention. Everything else on the sheet (title block, zone grid, connection table, legend) is fully legible and correctly bounded inside the frame. |
| 11 YAML-render consistency | 5 | 5 | Spot-checked wire numbers, terminal ids, notes, safety/caveat text, sources block — exact match. |
| 12 Absence of unsupported assumptions | 5 | 5 | Every conductor field_verify + red; phase count explicitly "unknown"; Q1 placement explicitly "assumed... verify" (OI-14); supply voltage explicitly undocumented. |

### E-005 — PLC Digital Inputs — **99/100**

| Cat | Pts | /Max | Notes |
|---|---|---|---|
| 1 Electrical truth & evidence | 15 | 15 | All 8 wires match; I-05 supersession printed with citation right on the sheet (HF4 carve-out honored). |
| 2 Technician readability | 12 | 12 | §6 walk (this sheet's native acceptance test) passes cleanly end-to-end — see walkthrough below. |
| 3 Maintenance-engineer approvability | 8 | 8 | "READS (acceptance)" note is effectively a built-in sign-off checklist; OI-02/OI-08/OI-13 cited. |
| 4 Standard symbols | 7 | 8 | -1, **element:** SS1 FWD/REV selector actuator tick ("∓" glyph), **location:** zone A6-B6 (I-00/I-01 rungs), **reason:** non-standard mark for a selector-switch detent (conventional practice is a small perpendicular bar or position dots); harmless since fully text-labeled, but not textbook. |
| 5 Wire & terminal ID | 10 | 10 | All 8 conductors flagged, legible, off-line; every field-device terminal id (S0 11-12/23-24, SS1 FWD/REV, S2 3-4, B1 BK) matches `terminals.yaml` exactly. |
| 6 Power/control/ground/safety separation | 8 | 8 | Pure DI family; safety block correct. |
| 7 PLC I/O presentation | 8 | 8 | COM0 explicit + field-verify + OI-02; OPC tags (`_IO_EM_DI_0x`) shown for every used input; spares I-06..I-11 explicitly marked "no field wire — OI-08." |
| 8 VFD power/control presentation | 8 | 8 | N/A. |
| 9 Cross-references | 6 | 6 | "(PS1 / E-004)" on both +24V and 0V rails; no dangling refs. |
| 10 Title block/legend/print-scale | 7 | 7 | Complete, correct "5 of 9," no legibility defects found anywhere on this sheet. |
| 11 YAML-render consistency | 5 | 5 | Spot-checked all 6 rungs' healthy-states/OPC tags/notes — exact match. |
| 12 Absence of unsupported assumptions | 5 | 5 | COM0 and every field wire flagged; I-05 vintage-drift honestly disclosed with citation. |

### E-006 — PLC Outputs — **99/100**

| Cat | Pts | /Max | Notes |
|---|---|---|---|
| 1 Electrical truth & evidence | 15 | 15 | All 10 wires match; hardwired-fallback-NOT-ACTIVE caveat is a model example of acknowledged-not-drawn honesty. |
| 2 Technician readability | 12 | 12 | Rail→PLC-output→load→return-rail walk is clean and consistent; spares clearly marked. |
| 3 Maintenance-engineer approvability | 8 | 8 | Thorough caveat/safety/notes/sources; OI-09/10/11/12/18 all cited. |
| 4 Standard symbols | 7 | 8 | -1, **element:** Q1 COIL glyph, **location:** zone B2 (O-02 row), **reason:** contactor coil drawn as a circle+arc rather than the more conventional IEC rectangle coil symbol. (Pilot-light circle+X glyphs ARE correct IEC practice — no issue there.) |
| 5 Wire & terminal ID | 10 | 10 | All 10 conductors flagged (W600-W609), endpoints match `terminals.yaml`, W6xx=sheet-6 numbering consistent. |
| 6 Power/control/ground/safety separation | 8 | 8 | Pure DO family; safety block correct (Q1 drop = power removal, verify it works). |
| 7 PLC I/O presentation | 8 | 8 | +CM0/-CM0/+CM1/-CM1 banks explicit with function text; OPC tags shown; spares O-04..O-06 marked "confirm no field wire — OI-12"; rung grammar mirrors E-005 (PLC as destination on inputs / source on outputs — see walkthrough). |
| 8 VFD power/control presentation | 8 | 8 | Correctly states GS10 control = Modbus, points to E-007, and explicitly disclaims drawing GS10 control-terminal wiring — control-source statement owned by the right sheet. |
| 9 Cross-references | 6 | 6 | PS1/E-004, E-007 (Modbus), E-003 ("poles on E-003" — confirmed bidirectional). |
| 10 Title block/legend/print-scale | 7 | 7 | Complete, correct "6 of 9," no legibility defects found. |
| 11 YAML-render consistency | 5 | 5 | Spot-checked O-00..O-06 functions/OPC tags/bank labels/caveat text — exact match. |
| 12 Absence of unsupported assumptions | 5 | 5 | All field-verify flagged; fallback-wiring caveat is exemplary "don't draw a guess as solid" discipline. |

### E-007 — RS-485 / Modbus RTU — **95/100**

| Cat | Pts | /Max | Notes |
|---|---|---|---|
| 1 Electrical truth & evidence | 15 | 15 | All 4 links match; every historical supersession (channel, pin, baud/format, command word) documented with citation. |
| 2 Technician readability | 10 | 12 | -2, **element:** shield/drain (SH) conductor, **location:** zone B3, **reason:** see cat 5 — a tech scanning the *drawing* (not the table) has no wire-number flag to write down for the drain lead, breaking the pattern every other conductor in the package establishes. Otherwise this is the most complete troubleshooting aid in the set (dedicated TROUBLESHOOTING block + readback test). |
| 3 Maintenance-engineer approvability | 8 | 8 | OI-20 parameter conflict (38.4k/8N2 vs 9600/8N1) presented as open, not resolved-by-fiat; no SAFETY block on this sheet is appropriate (pure low-voltage comms signaling, no line power/motor hazard depicted here). |
| 4 Standard symbols | 8 | 8 | Device boxes, termination-resistor rectangle, earth symbol all conventional; no ad-hoc glyphs. |
| 5 Wire & terminal ID | 7 | 10 | -3, **element:** SH (shield/drain) conductor, **location:** zone B3 (PLC1 box right edge → earth symbol), **reason:** confirmed by reading `render_sheet.py:608-626` — the loop drawing 485+/485-/SGND calls `wire_tag()` (line 605); the SH block that follows has **no** `wire_tag()` call. Confirmed visually at 3x zoom: no boxed "SH" flag anywhere on the printed run. It IS correctly flagged in the CONNECTION TABLE (`Wire: SH`, `Evidence: field_verify`, red) — so it's not un-traceable, just missing from the schematic itself, which is the one place every *other* conductor in the entire 5-sheet package gets a flag. |
| 6 Power/control/ground/safety separation | 8 | 8 | Comms-only family; shield handling explicit (land PLC end ONLY, float at GS10). |
| 7 PLC I/O presentation | 8 | 8 | N/A — Modbus comms, not discrete I/O. |
| 8 VFD power/control presentation | 8 | 8 | This sheet correctly owns the GS10 control-source detail (command words, serial config) with the same supersession rigor as everywhere else. |
| 9 Cross-references | 6 | 6 | Title-block lineage note ("recovers MIRA-WI-001 / Conv_Simple_CommsToVFD §2"); no dangling refs. |
| 10 Title block/legend/print-scale | 7 | 7 | Complete, correct "7 of 9," no legibility defects found. |
| 11 YAML-render consistency | 5 | 5 | Spot-checked all 4 links + command words + serial config against `e007_rs485.yaml` — exact match. |
| 12 Absence of unsupported assumptions | 5 | 5 | SH correctly field_verify+red; 120Ω termination appropriately hedged ("bench <2m usually fine," not overclaimed). |

---

## §6 Meter-lead walkthroughs (every wiring sheet)

### E-003 (VFD power)
1. **Start:** SUPPLY box, top of sheet, explicitly red "(FIELD VERIFY)" — no bench voltage/phase claimed.
2. **Device passed through:** CB1 (breaker, one pole/phase) → Q1 (contactor, one pole/phase). **Defective here** — the L1/L2/L3 pole identity labels are struck by the dash (HF5); a tech has to infer which vertical run is which phase from position alone (left=L1, center=L2, right=L3, consistently), which works but shouldn't be necessary.
3. **Wire numbers:** W300-W308 (supply→CB1→Q1→VFD1), all flagged, all legible.
4. **VFD terminal:** R/L1, S/L2, T/L3 (verbatim GS10 manual designations) → clean, unstruck.
5. **Function:** none needed beyond "line power in" — appropriate for a power sheet.
6. **Return/ground completion:** VFD1.GND (W315) + M1.PE (W316) both land on a dedicated PE bus → earth symbol → W317 back to source PE (E-002). Motor leads U/T1→T1, V/T2→T2, W/T3→T3 via W310-312, all clean.
7. **Verified vs field-verify:** 100% dashed, consistent with the "every conductor FIELD VERIFY" subtitle; legend correct.

**Worked meter check the sheet enables:** de-energize + LOTO, verify PE continuity drive-to-source ≤0.1Ω, then verify R/L1-S/L2-T/L3 phase presence at CB1 load side before energizing further downstream. The sheet supports this despite the label defect — but a technician working from a poor-contrast photocopy would need to count positions rather than read a name, which is exactly the failure mode a wiring print exists to prevent.

### E-005 (PLC digital inputs) — passes cleanly, no notes
1. +24 VDC starts at PS1 (E-004), rail tagged W24.
2. Passes through SS1 FWD/REV, S0 11-12 (NC) / 23-24 (NO), S2 3-4, B1 BK — each a distinct, correctly-chosen contact glyph (confirmed `GLYPH` dict maps `estop_nc→contact_nc` and `estop_no→contact_no` correctly, not swapped).
3. Wire numbers W500-W505, all flagged.
4. Lands on I-00 through I-05.
5. Function/OPC: dir_fwd/_IO_EM_DI_00 etc., printed directly under each terminal.
6. Returns via COM0 → W0V → 0V (E-004), explicitly field-verify/red.
7. Verified (PLC terminal+function, solid box) vs field-verify (all field wiring, dashed) cleanly distinguished throughout.

### E-006 (PLC outputs) — passes cleanly, no notes
Mirror image of E-005 as required by category 7: PLC1 box on the **left** (source), loads on the right, common return rail far right back to PS1 0V (E-004). O-00→PL1 (green run), O-01→PL2 (red fault/e-stop), O-02→Q1 coil ("poles on E-003" cross-ref), O-03→S2 lamp. Every rung: wire number → real terminal → function/OPC tag → load device with real terminal (X1/X2, A1/A2) → return. Banks +CM0/-CM0/+CM1/-CM1 explicit; spares O-04..O-06 marked with OI-12.

### E-007 (RS-485 Modbus) — passes, with the one gap noted
PLC1 D+(A)/D-(B)/SG/shield → Belden 3105A pair+conductor+drain → VFD1 RJ45 pin5/SG+, pin4/SG-, pin3/SGND, shield floated at GS10. 120Ω termination shown at the drive end. Command words and serial config double as the "what reading to expect" step (`vfd_comm_ok=TRUE`, nonzero 0x2103 readback). The one break in the pattern: the SH (drain) conductor has no on-print wire flag (cat 5/2 deduction above) — everything else about the walk is complete and, notably, this sheet has the best-documented troubleshooting section of the five.

---

## Deep-dive notes: commons/banks/spares clarity + cross-sheet trails

- **Commons/banks:** COM0 (E-005) and +CM0/-CM0/+CM1/-CM1 (E-006) are all explicit, named, and functionally labeled — no ambiguity about which bank feeds which terminal range. OI-09's noted tension (bank-naming suggests DC transistor output, `devices.yaml` says "relay DO") is correctly left as an open item rather than silently resolved either way.
- **Spares:** I-06..I-11 (E-005) and O-04..O-06 (E-006) are drawn as hollow/unterminated terminals with inline "(no field wire — OI-xx)" text — exactly the pattern a technician needs to distinguish "confirmed unused" from "just not drawn yet."
- **Coil↔poles cross-sheet trail:** Q1 coil (E-006, A1/A2) ↔ Q1 poles (E-003, terminals 1-6) is genuinely bidirectional — "poles on E-003" on E-006, "Q1 coil ← O-02 (E-006)" in E-003's notes. Confirmed both directions on-sheet, not just in the YAML.
- **Rails to E-004:** every +24V/0V reference on E-005 and E-006 is tagged "(PS1 / E-004)" consistently.
- **Modbus to E-007:** E-006 states the GS10 control-source is Modbus and explicitly does not draw GS10 control-terminal wiring, deferring correctly to E-007.
- **Numbering key on E-001:** present but incomplete — see cat 5 deduction on E-001 (law (a) of the two anti-spaghetti laws is missing).

---

## Verdict

**NOT APPROVABLE.**

Per rubric verdict rules this is unambiguous on two independent grounds: (1) HF5 is confirmed on E-003 (any hard-fail ⇒ package NOT APPROVABLE regardless of points), and (2) E-003 also scores 89/100, under the "every reviewer ≥90 on every sheet" bar even setting the hard-fail aside. The other four sheets (E-001 98, E-005 99, E-006 99, E-007 95) are genuinely strong — E-005 in particular is exemplary and should be the template the rest of the set is measured against.

## Remaining fixes I would demand before re-review

1. **(Blocking, HF5)** Fix the CB1/Q1 pole-label collision on E-003. Cheapest correct fix: stop the caller's `seg()` line short of the label band (mirror how the VFD1 R/L1 label avoids this — the wire segment there ends exactly at the box edge before the label is drawn), or give `breaker_pole()`/`contactor_pole()` labels the same opaque-background treatment `wire_tag()` already uses. Re-render and re-inspect **all five sheets** at 100% zoom afterward, not just E-003 — I found none elsewhere, but this exact bug class (independently-positioned label vs. independently-drawn full-length conductor) could recur anywhere a new symbol helper is added.
2. **(Should-fix)** Add a `wire_tag()` flag for E-007's SH conductor so every conductor in the package, without exception, carries an on-print wire number.
3. **(Should-fix)** Print anti-spaghetti law (a) ("same electrical node = same wire number; a number changes only through a device") on E-001 next to the existing [page][line] numbering key — style law §2 rule 8 asks for both.
4. **(Process)** `validate_model.py`'s SVG audit has no text/geometry overlap check — that's *why* HF5 shipped past the existing validator. Worth a cheap automated check (text bounding-box vs. line-path intersection) added to the audit before the next round, rather than relying on a human zooming in at 3.5x.
5. **(Optional, not blocking)** Reconsider the CB1 breaker glyph (X+arc reads as disconnect/fuse, not breaker) and the Q1/PL coil-as-circle glyph against stricter IEC 60617 practice, or add a one-line symbol-key note on E-001 if the current custom shapes are being kept intentionally.

---
---

# V3.1 RE-CHECK (Round 3.1) — same reviewer, re-verifying the re-render

**Scope:** verify each V3 finding's resolution against the actual re-rendered package in
`C:\wt-phase0\plc\conv_simple_electrical\` (working tree, uncommitted, branch
`feat/conv-simple-prints-v3` on top of V3 commit `777c4061`). Did **not** read
`reviewer_*_v2.md` / `GRADES_V2.md` (present in `review/`, correctly ignored per instructions).
Re-applied `review/GRADING_RUBRIC.md` fresh from this working tree (confirmed byte-identical in
structure/HF-defs/verdict-rules to what V3 used).

**Method / integrity checks performed before grading anything:**
1. **Render-freshness check.** `render_sheet.py`'s mtime (00:42:23) postdates the checked-in
   `sheets/*.png|svg` (00:41:4x–5x) by ~30–90s — the naive V3-style "does the source postdate the
   output" check would have read STALE. Resolved by copying the whole package to scratch and
   re-running `python render_sheet.py <SHEET>` for all 5 sheets from the current source/model: the
   fresh SVGs are byte-identical (`diff -q`) and the fresh PNGs are hash-identical (md5) to what's
   checked into `sheets/`. **Not stale** — the mtime gap is harmless (source touched after the last
   render with no net effect on output, e.g. the `validate_model.py` check-L companion edit landed
   in the same save pass). Verified by evidence, not assumed, per `debugging-conventions.md`.
2. **`validate_model.py` re-run**: `ALL CHECKS PASSED` (A–L), including the new **check L**
   (text/conductor collision) at zero hits across all 5 sheets — confirms the task brief's claim.
3. **Check L soundness test.** Read `check_text_conductor_collision()` (lines 332–454): it flags a
   collision only when a `<line data-wire=…>` segment's **endpoint** lands inside a text element's
   estimated bbox; it does not test true segment/rectangle intersection, does not look at `<rect>`
   elements at all (so a `wire_tag()` box border is invisible to it), and never compares two
   `<text>` elements against each other. Built a synthetic SVG reproducing the *exact* original HF5
   geometry (a continuous `y=190→236` segment with a label at mid-span `y=228`, endpoints outside the
   label bbox) and ran it through the real function: **0 errors returned** — check L would not have
   caught the original bug's geometry either, had the fix been a case where the offending segment
   endpoint stayed outside the label box. This matters below: check L's zero-hits PASS is real but
   **partial** evidence, not proof of a clean sheet — visual verification is still required, exactly
   as the task asked for. Confirmed against real findings, not just the synthetic case (see HF5 below).

## Finding-by-finding resolution

### HF5 (original) — CB1/Q1 pole-label strikes — **RESOLVED**
`breaker_pole()`/`contactor_pole()` (render_sheet.py:233–257) now draw the L1/L2/L3 pole label at
`x‑24, anchor="end"` instead of `x, anchor="middle"` — the label is relocated off the vertical
conductor's centerline entirely (a third fix strategy, cleaner than either the ledger's "shorten the
segment" or "opaque background" suggestions — doesn't touch the `seg()` call sites at all). **Zoomed
all 6 former collision points (CB1 L1/L2/L3, Q1 L1/L2/L3) at 3–10x** (`crops/e003_cb1_row.png`,
`crops/e003_q1_row.png`): every label is now fully clear of its dashed conductor, wire_tag boxes
intact, dashes crisp and unbroken. The literal 6-instance defect from V3 is genuinely gone.

### HF5 (NEW) — 2 fresh instances introduced by the same fix — **CONFIRMED, sheet E-003**

**Instance 1 — Q1 row, "L1" pole label vs. Q1 caption text, zone B2.** The relocated label (now at
`x‑24` = 316, anchor=end) lands inside the bbox of the adjacent
`"Q1 — SAFETY POWER CONTACTOR (MC · 'MLC' in WI-001)"` caption (anchor=end at x=310, y=342, size 8.5)
— arithmetic overlap of ~3 units in x and ~6 units in y, confirmed by direct 10x-zoom crop
(`crops/e003_q1_caption_L1_junction.png`): the "L" of "L1" and the ")" of "in WI-001)" visually fuse
into an unreadable glyph cluster ("...WI-001)L1" reads as mush at the junction). Only L1 is close
enough to the caption's right edge to collide — L2/L3 (3φ) are confirmed clean (visible in the wider
Q1-row crop, arithmetically ~66/126 units clear respectively). CB1's own row-caption ("CB1"/"(FIELD
VERIFY)") sits below the CB1 pole labels with a real (if tight, ~2.8-unit) gap — confirmed clean by
crop, not just arithmetic.

**Instance 2 — M1 caption vs. W310 wire_tag box, zone C1/D1.** The M1 caption block also moved (from
V3's `(372,726)`/`(372,737)` to `(300,714)`/`(300,724)`) — presumably to clear whatever the original
issue was (not documented in this ledger; possibly another reviewer's finding). In its NEW position,
`"(FIELD VERIFY)"` (x=300, anchor=end, y=724, size 6.5) collides with the **W310 wire_tag box**
(`wire_tag(s, xL, 722, "W310", ...)`, box left edge at `cxx‑16` = 298): confirmed at max zoom
(`crops/e003_m1_fv_w310_junction.png`) — the box's left border line is drawn **directly through** the
closing `")"` of `"(FIELD VERIFY)"`. This is the literal original-bug pattern ("text struck by a
line") reproduced with a box border instead of a conductor dash. "M1" itself (the primary identity
label, bold black, y=714) is unaffected and fully legible.

**Why check L missed both:** Instance 1 is text-vs-text (outside check L's scope entirely — it only
ever compares text to `data-wire` line segments). Instance 2 is text-vs-`<rect>` (wire_tag boxes are
drawn as `<rect>`, which check L's regex never extracts as a collidable object). Neither is a
hypothetical edge case — both are real, currently-shipping defects on the actual re-rendered E-003
PNG/PDF, verified by eye at up to 10x zoom and independently corroborated by pixel-coordinate
arithmetic from the source. **HF5 is not resolved — it recurred in a new form, on the same sheet,
as a direct side effect of the same fix.** Per rubric: "Any hard-fail = package NOT APPROVABLE
regardless of points," unconditionally, regardless of the fact both new instances are narrower in
scope than the original 6.

### Fix demand #1 (blocking, HF5) — **PARTIALLY RESOLVED** — see above. Original 6/6 fixed; 2 new instances now present.

### Fix demand #2 — E-007 SH `wire_tag()` — **RESOLVED**
`wire_tag(s, plx + pw + 45, shy, "SH", verified=verified_sh)` added (render_sheet.py:652). Confirmed
by crop (`crops/e007_sh_tag.png`): a clean, correctly red (field_verify) "SH" flag sits on the dashed
drain-conductor run, no collision with the earth symbol, the "shield / chassis" label, or the "Land
drain at PLC end ONLY..." caveat. Every conductor in the 5-sheet package now carries an on-print wire
flag without exception — the cat-5 gap from V3 is fully closed.

### Fix demand #3 — E-001 both anti-spaghetti laws — **RESOLVED**
`model/wires.yaml`'s `convention:` field now ends "...**Same electrical node = same wire number; a
number changes only through a device.**" (law a), appended after the existing [page][line]-numbering
text (law b). Confirmed rendered verbatim on E-001's WIRE-NUMBERING KEY box
(`crops/e001_numbering_key.png`) — both laws present, box auto-sized to fit, no overflow, no
collision with the LINE-STYLE LEGEND below it.

### Fix demand #4 (process) — validator collision check — **PARTIALLY RESOLVED**
Check L exists and passes 0/0 on the real sheets — but per the integrity check above, it has a real,
demonstrated soundness gap: endpoint-in-box only (not true segment/rect intersection), no `<rect>`
awareness, no text-vs-text comparison. It did not and structurally *could not* have caught either of
the 2 new HF5 instances found this round. The demand asked for "text bounding-box vs. **line-path
intersection**" — what shipped is text-bbox vs. line-**endpoint**, plus zero coverage of the
box-border and text-vs-text collision classes that actually bit this round. Recommend widening it
(real polygon/segment intersection, plus `<rect>` extraction, plus text-vs-text) before relying on it
as a substitute for the human zoom-pass.

### Fix demand #5 (optional, symbol practice) — not addressed this round, not blocking, unchanged from V3.

## New items outside the V3 ledger, verified this round

- **E-007 readback Hz x10→x100** (`model/e007_rs485.yaml`): corrected + cited. Verified both
  citations against real source: `plc/Prog_init_ConvSimple_v2.1.st:164` reads
  `vfd_frequency := read_data[4]; (* 0x2103 output freq Hz x100 *)` (exact match); external
  `GS10_UM.txt:15703` (`C:\Users\hharp\Documents\CCW\MIRA_PLC\docs\vfd\GS10_UM.txt`, 23,795 lines,
  not in git — same file V3 used) reads `"Output frequency (XXX.XX Hz) ... 2103 ..."`, confirming
  2-decimal-place (x100) scaling and directly contradicting the old x10 claim. Genuine, well-cited
  correction. Confirmed the corrected string renders in full on-sheet with no truncation/overflow/
  collision (`crops/e007_readback_full_width.png`) — fits inside the frame with margin.
- **OI-09 surfaced on E-006** (`model/sheets.yaml`): now an on-sheet NOTES bullet ("Output bank
  technology + common feed = FIELD VERIFY (OI-09)..."), not just something the V3 deep-dive notes
  had to synthesize. Confirmed clean render, no collision (`crops/e006_annotations.png`). Strictly
  better disclosure; doesn't move any V3 score (cat 12 was already 5/5).
- **Port-location disclosure on E-007** (`model/sheets.yaml`): new NOTES bullet flagging the
  CommsToVFD ("front-face RJ45") vs. WI-001 ("bottom-front") conflict as FIELD VERIFY. Confirmed
  rendered cleanly (`crops/e007_notes_region2.png`). This closes a latent HF4 risk the same way
  every other supersession in this package is handled — consistent, good practice.
- **"Drawn:" title-block line** (render_sheet.py:339, `title_block()`) — **INTRODUCED A NEW MINOR
  DEFECT on E-005 specifically.** The function now unconditionally prints a literal
  `"Drawn: MIRA / FactoryLM"` line, THEN a second line that's either the sheet's explicit `lineage=`
  string or, if none was passed, falls back to `f"Drawn: {meta['drawn_by']}"` —
  and `meta['drawn_by'] == "MIRA / FactoryLM"` (`model/devices.yaml:7`). E-001/E-003/E-006/E-007 all
  pass an explicit `lineage=` (confirmed by grep of every `title_block(...)` call site) and render
  correctly — two distinct lines. **E-005 is the only sheet that does NOT pass `lineage=`**
  (render_sheet.py:903), so it falls through to the duplicate default and now prints **"Drawn: MIRA /
  FactoryLM" twice in a row**, verbatim. Confirmed by crop (`crops/e005_titleblock.png`) against a
  clean comparison crop from E-003 (`crops/e003_titleblock.png`). Not HF5 (both lines are fully
  legible on their own, nothing struck/overlapping) — a documentation-quality ding, not a hard-fail.
- **Small font bumps** (E-003 FIELD VERIFY 7.2→7.5, E-006/E-007 various 7→7.5): cosmetic, checked for
  new overflow/collision in every crop reviewed this round — none found.
- **E-006 commons label color-by-status** (+CM0/-CM0/+CM1/-CM1 now red if `status != verified`):
  cosmetic/color-only change, no position change, no collision risk; confirmed rendering correctly in
  the E-006 overview.

## §6 meter-lead walkthrough deltas

**E-003** — step 2 updated: CB1 row is now clean (no defect) — a technician reads "L1/L2/L3" directly
beside each breaker pole, no more position-counting needed. **New caveat**: at the Q1 row, the L1
pole label visually merges with the adjacent "Q1 — SAFETY POWER CONTACTOR..." caption text; a
technician can still very likely resolve it (leftmost position = L1, consistent with the L2/L3
pattern, and "1" is legible even where "L" is compromised) but it is objectively degraded versus the
clean L2/L3 labels one inch to the right — the exact kind of ambiguity a wiring print exists to
prevent. At the motor, "M1" itself reads clean; "(FIELD VERIFY)" is legible except for its final
")" character, struck by the adjacent W310 tag-box border — the FIELD VERIFY *meaning* still comes
through, but the glyph is damaged.

**E-007** — the V3 "one gap noted" is now closed: SH carries an on-print wire flag like every other
conductor. **Walkthrough now passes cleanly, no notes** — same clean-pass status as E-005/E-006.

**E-005 / E-006** — no change to the underlying circuit-walk; E-005 gains a cosmetic title-block
duplicate line (not on the circuit-walk path, doesn't affect the walkthrough itself).

## Updated per-sheet scores

| Sheet | V3 | V3.1 | Δ | Notes |
|---|---|---|---|---|
| E-001 | 98 | **99** | +1 | cat 5: 9→10 (both anti-spaghetti laws now present, verbatim, confirmed on-sheet) |
| E-003 | 89 (HF5) | **93 (HF5 — new instances)** | +4, HF5 persists | cat 2: 9→11 (-1, was -3: Q1/L1-vs-caption, zone B2, narrower than original 6-instance defect but real); cat 3: 7→7 (unchanged, -1: same element, an approver still stops and asks); cat 10: 2→4 (+2, still -3: 2 confirmed struck-text instances — Q1/L1 zone B2, M1/(FIELD VERIFY) zone C1/D1 — this is where HF5 lives, again) |
| E-005 | 99 | **98** | -1 | cat 10: 7→6 (-1: duplicate "Drawn: MIRA / FactoryLM" line, zone D7-D8, title block — new, sheet-specific regression from the title-block change) |
| E-006 | 99 | **99** | 0 | unchanged — OI-09 disclosure + label-color change verified clean, no score impact (categories already at ceiling) |
| E-007 | 95 | **100** | +5 | cat 2: 10→12 (+2, SH gap closed); cat 5: 7→10 (+3, SH now flagged like every other conductor) |

All 5 sheets now individually score ≥90 — the point-threshold bar from the verdict rules is cleared.
**This does not change the verdict**, because HF5 is present independent of points (see below).

## Verdict

**NOT APPROVABLE.**

Per rubric: "Any hard-fail = package NOT APPROVABLE regardless of points." HF5 is confirmed present
on E-003 — 2 new instances, in a new form (label-vs-caption text fusion; label-vs-tag-box-border
strike), introduced as a direct side effect of fixing the original 6-instance HF5. The original defect
is genuinely, verifiably gone; the hard-fail is not. Every other V3 fix demand (SH tag, both
anti-spaghetti laws) is cleanly resolved and holds up under independent re-verification, and E-007 is
now a clean 100/100. This is real, substantial progress — but the rubric's zero-tolerance clause does
not grade on improvement, and this round's own evidence (a synthetic reproduction of the original bug
geometry that check L still can't catch, plus two live defects it missed) shows the underlying process
gap — "fix a collision by moving the label, verify only against the element that was originally
struck" — has not yet been closed, so it produced the same failure class twice.

## Remaining fixes I would demand before re-review

1. **(Blocking, HF5, instance 1)** Move Q1's "L1" pole label (or the Q1 caption text, or both) so
   they no longer share bbox space at zone B2. Cheapest fix: nudge the caption up/shorten its
   right-hand margin, or drop the L1 label further left/down — either breaks the collision without
   touching L2/L3's already-correct positions.
2. **(Blocking, HF5, instance 2)** Move M1's "(FIELD VERIFY)" line (or the W310 wire_tag box) so
   they clear zone C1/D1. Simplest: shift the FIELD VERIFY sub-caption down/left by a few more units,
   or nudge W310's tag box right.
3. **(Should-fix, process)** After making fixes 1–2, re-render and re-inspect **all five sheets at
   100% zoom** once more — this is the *second* round where a targeted label move fixed the named
   defect but broke something adjacent that wasn't checked. The fix discipline needs to change from
   "verify against the element this was originally struck by" to "verify against every text/graphic
   element within some radius of the new position."
4. **(Should-fix, process)** Strengthen `check_text_conductor_collision` (check L) to (a) true
   line-segment/rectangle intersection instead of endpoint-in-box, (b) extract `<rect>` elements
   (wire_tag boxes, device outlines) as collidable geometry, not just `<line>`, and (c) compare
   `<text>` elements against each other, not only against conductors. All three gaps were load-bearing
   this round — check L reported a clean PASS while 2 real defects shipped.
5. **(Should-fix, minor)** E-005's title block prints "Drawn: MIRA / FactoryLM" twice — pass an
   explicit `lineage=` for E-005 (matching every other sheet), or fix `title_block()`'s fallback so it
   doesn't restate the literal line above it when no lineage note exists.
6. **(Optional, not blocking, carried from V3)** CB1 breaker glyph / Q1-coil-as-circle glyph vs.
   stricter IEC 60617 practice — unchanged this round, still open if desired.

---
---

# V3.2 FINAL (Round 3.2) — same reviewer, final confirmation pass

**Role:** independent final-confirmation reviewer, working from the V3.1 ledger above only (its
NOT APPROVABLE verdict, its 2 named HF5 instances, its fix demands). Did not re-read `reviewer_*_v2.md`
/ `GRADES_V2.md`. Scope per assignment: (1) pixel-crop both former V3.1 strike zones on the
re-rendered E-003; (2) verify E-005's "Drawn:" line count; (3) sweep all 5 sheets at 100% for any
NEW strike given the layout moved (Q1 header/pole labels, M1 caption, E-005 rail texts, E-007 wrap
widths); (4) run `validate_model.py` myself; (5) render a verdict per `review/GRADING_RUBRIC.md`.

## Method

Worked directly against `C:\wt-phase0\plc\conv_simple_electrical\` (same working tree, still
uncommitted, branch `feat/conv-simple-prints-v3`). Confirmed the SVG canvas is 1600×1040 for every
sheet and the PNG raster is exactly 2× (`fitz.Matrix(2,2)`, `render_sheet.py:471`) — so every SVG
coordinate in `render_sheet.py` maps deterministically to a PNG pixel, letting me pixel-crop by
reading the source coordinates rather than guessing. Read the full `git diff` of `render_sheet.py`
and all `model/*.yaml` against the V3 baseline commit (`777c4061`) to get exact before/after
coordinates for every element that moved, then cropped the real re-rendered PNGs (not synthetic
mockups) at 3–4× zoom at each touched location, plus a full-page 100% sweep of all 5 sheets.

## 1. Former strike zone — Instance 1 (Q1 "L1" vs caption), zone B2

**Root cause of the fix:** `breaker_pole()`/`contactor_pole()` (`render_sheet.py:240–265`) now place
the pole label at **pole mid-height** (`y+2`, was `y-22`/row-top), and the Q1 caption is now pulled
from `devices.yaml`'s new `Q1.sheet_label: "Q1 — SAFETY POWER CONTACTOR (MC/'MLC' — WI-001)"` field
at `x=290` (was `x=310`), `y=342`. By the numbers: Q1 caption bbox is `y: 335.2–345.4`; the L1/L2/L3
pole-label row is `y: 355.6–365.2` — a clean **10.2 SVG-unit (≈20px) vertical gap**, not merely a
narrower horizontal miss. Cropped at 3× (`crops_v32/e003_q1_row_INSTANCE1_wide.png`): the full
caption "Q1 — SAFETY POWER CONTACTOR (MC/'MLC' — WI-001)" reads on its own line, fully clear of the
frame border on the left and of the L1/L2/L3 row below it. **No fusion, no strike, no truncation.**
**RESOLVED**, with real margin — not a knife-edge fix.

## 2. Former strike zone — Instance 2 (M1 "(FIELD VERIFY)" vs W310 box), zone C1/D1

M1's caption block moved to `(290, 712)`/`(290, 724)`, right-anchored. The W310 `wire_tag(...,
orient="v")` flag rect sits at `x: 298–330, y: 715–728`. By the numbers: `"(FIELD VERIFY)"` (size
7.2, 14 chars) has `xmax=290` — the box's `xmin=298` — an **8 SVG-unit (16px) horizontal gap**,
exactly matching the task brief's "relocated ≥8px" claim. Cropped at 4×
(`crops_v32/e003_m1_w310_INSTANCE2.png`): "M1" and "(FIELD VERIFY)" both read fully clean, W310's box
border is intact and does not touch either string. (Also note: M1's motor-symbol "3~" phase marker
is now red — `phase_color=RED if m1_fv else GRY` — a deliberate, legible status-color addition, not
a defect.) **RESOLVED**, with real margin.

## 3. E-005 "Drawn:" line count

`title_block()` (`render_sheet.py:339–356`) no longer has the buggy fallback (`lineage or f"Drawn:
{meta['drawn_by']}"`); it now prints `"Drawn: MIRA / FactoryLM"` exactly once, unconditionally, and
only adds a *lineage* line underneath if `lineage` is non-empty. E-005's call site
(`render_sheet.py:917`) still passes no `lineage=` (unchanged), so it now correctly renders with
nothing below the Drawn line rather than a duplicate. **Verified two independent ways:** (a) visual
crop of the E-005 title block (`crops_v32/e005_titleblock.png`) shows exactly one "Drawn: MIRA /
FactoryLM" line; (b) `grep -o "Drawn: MIRA / FactoryLM" sheets/*.svg | wc -l` returns **exactly 1**
for **every one of the 5 sheets**, including E-005. **RESOLVED**, confirmed at the source level, not
just by eye.

## 4. Full five-sheet sweep at 100% (targeted zones + full-page)

Cropped and inspected every location the diff touched, plus a full-page render of all 5 sheets:

- **E-003:** CB1 row (labels now at pole mid-height, same fix as Q1 — clean, `W300/W301/W302` tags
  intact); Q1 row (Instance 1, above); M1/W310 (Instance 2, above); the caveat/safety vs notes/sources
  annotation-column gap (widths tightened 610→540 / 720(at x=680 now)→400 specifically to clear the
  title block — confirmed real gap, no touch); VFD1 DC-bus stub text (+1/+2, B1/B2, DC+/DC- — font
  6.8→7.2, wrap 130→120 — all three multi-line descriptions clean, no overlap with the connection
  table to their right); the title-block footnote ("MC placement...", moved y=986→988, font 6.8→7.2)
  — sits fully inside the title-block box with a visible gap above its bottom border, not touching it
  despite tight hand-arithmetic suggesting it might. Full-page sweep: clean.
- **E-005:** title block (above); rail-top text ("+24 VDC"/"(PS1/E-004)", shifted 3px) — clean, no
  collision with the W24 tag or the SS1 FWD label; the I-05 photo-eye row, which grew its `note` text
  from font 6.4→7.2 and line-spacing 8→10 (2 wrapped red lines) — checked both boundaries at high zoom:
  I-04's tail content sits well clear above "I-05"/the relocated "healthy: 0=clear,1=blocked" text
  (moved `y+2`→`y-2` specifically to clear I-05's long function line), and the note's 2nd line sits
  with a real, visible gap above "I-06  spare (no field wire — OI-08)" below it — not touching. COM0
  row: clean. Full-page sweep: clean.
- **E-006:** commons block (+CM0/-CM0/+CM1/-CM1 labels now color-by-status red — cosmetic, legible,
  no collision with the "output bank..." description lines); Q1-coil "poles on E-003" cross-ref text
  (font 7→7.5, still clear of A1/A2 above and "S2 LAMP" below); spare rows (O-04..O-06, font 7→7.5,
  clean); W609/"→ PS1.0V (E-004)" (font 7→7.5, clean, clear of the dashed return rail). Full-page
  sweep: clean.
- **E-007:** SH wire_tag (clean flag on the dashed drain run, clear of the earth symbol and the "Land
  drain..." caveat text); termination wrap ("120 ohm across SG+/SG- at the drive end," font 7→7.5,
  still one line, clear of "black of pair"); readback line (corrected Hz×100 text, one line, margin
  both sides); command-words `rev_run_supersession` wrap (width 700→620 specifically to clear the
  TROUBLESHOOTING column at x=830) — both wrapped lines confirmed to stop well short of x=830, real
  gap visible in `crops_v32/e007_supersession_full_width.png`; `draw_annotations` width 720→620 for
  the same reason — confirmed clear of TROUBLESHOOTING with ~140px margin
  (`crops_v32/e007_annotations_troubleshoot_gap.png`). Full-page sweep: clean.
- **E-001:** device schedule Type column now runs `humanize_snake_case()` (e.g. `e_stop`→"e stop",
  `pushbutton_no`→"pushbutton (NO)", `photo_eye`→"photo eye") — every value fits cleanly inside the
  Type column, no overflow into Model, no truncation. WIRE-NUMBERING KEY box still carries both
  anti-spaghetti laws (V3.1 fix, re-confirmed intact). Full-page sweep: clean.

**No new HF5 instance found anywhere in the 5-sheet package.**

## 5. `validate_model.py` — run myself, plus an independent soundness test of check L

Ran `py -3 plc/conv_simple_electrical/validate_model.py` directly: **ALL CHECKS PASSED**, A through
L, with zero issues on every check including **L. Text/conductor collision** across all 5 sheets.

Because the V3.1 round demonstrated that a *previous* version of check L reported a clean PASS while
missing real defects (synthetic repro of the original HF5 geometry slipped past it), a bare "L passed"
is not by itself sufficient evidence this round — so I read the new implementation
(`validate_model.py:412–504`) and verified its claimed upgrade independently:

- **(a)** conductor-vs-text is now true **Liang-Barsky segment/rectangle intersection**
  (`_segment_crosses_box`), not endpoint-in-box;
- **(b)** **pairwise text-vs-text** bbox overlap (>1px²), naming both strings;
- **(c)** **wire_tag flag `<rect>` elements** extracted as their own obstacle class, checked against
  every other text bbox.

I then wrote and ran my own mutation tests (not reusing V3.1's code, independent construction) against
the real `check_text_conductor_collision()` function, using synthetic SVG snippets reproducing: (A) the
exact Instance-1 geometry class (overlapping text-vs-text), (B) the exact Instance-2 geometry class
(text-vs-flag-rect), (C) the original V3 HF5 class (conductor-through-text), and (D) a negative
control using the actual current, clean, real coordinates. Result: **all three defect classes were
correctly caught, and the negative control produced zero false positives.** This is materially
stronger evidence than a bare validator PASS — the checker's "0 hits" this round is now proven
meaningful, not merely unfalsified. Full transcript available in this session; summary:

```
MUTATION A: text-vs-text overlap (Instance-1 class)         -> FOUND (correctly caught)
MUTATION B: text-vs-flag-rect overlap (Instance-2 class)     -> FOUND (correctly caught)
CONTROL:    current real (clean) geometry                    -> silent (correctly NOT flagged)
MUTATION C: conductor-through-text (original V3 HF5 class)   -> FOUND (correctly caught)
```

## 6. HF1–HF4, HF6 — re-swept, still clear; no regression from this round's YAML-sourcing changes

This round also moved several previously renderer-hardcoded strings into model YAML: Q1's sheet
caption (now `devices.yaml Q1.sheet_label`), E-003's chain subtitle and "N/15 conductors FIELD
VERIFY" claim (now `sheets.yaml E-003.subtitle` + **computed** from live wire-status counts, per the
render comment referencing "auditor finding F3" — never hand-asserted), and E-006's subtitle (now
`sheets.yaml E-006.subtitle`). This *strengthens* the HF6 posture (less renderer-only text, not more)
and I spot-checked each against its source YAML — exact match. The new OI-09 disclosure text and the
E-007 port-location note (both added in the V3.1 round, re-confirmed present and unchanged this
round) still read correctly. No new invented fact, no new solid-line overclaim, no new PE ambiguity,
no new unacknowledged contradiction found anywhere in this round's diff.

## Updated per-sheet scores

HF5's resolution restores exactly the categories it was suppressing on E-003 (cat 2/3/10 — the same
categories the V3 and V3.1 rounds explicitly scoped the deduction to); E-005's fixed duplicate line
restores cat 10. No other category changed.

| Sheet | V3.1 | V3.2 | Δ | Notes |
|---|---|---|---|---|
| E-001 | 99 | **99** | 0 | unchanged — humanize_snake_case device-type display verified clean, no score impact |
| E-003 | 93 (HF5) | **98 (no HF5)** | +5, HF5 cleared | cat 2: 11→12 (+1, Q1/L1-vs-caption fully clear, ~20px margin); cat 3: 7→8 (+1, no defect left for an approver to stop on); cat 10: 4→7 (+3, both struck-text instances resolved — this is where HF5 lived; now at ceiling like every other sheet). cat 4 remains 6/8 (CB1 breaker glyph vs. IEC 60617 — optional, unchanged, never was HF-class). |
| E-005 | 98 | **99** | +1 | cat 10: 6→7 (+1, duplicate "Drawn:" line removed — confirmed both visually and via grep, exactly 1 occurrence on all 5 sheets) |
| E-006 | 99 | **99** | 0 | unchanged — commons color-by-status + font bumps verified clean, no score impact |
| E-007 | 100 | **100** | 0 | unchanged — wrap-width narrowing (clears TROUBLESHOOTING column) verified clean, still at ceiling |

**All 5 sheets ≥90. Zero hard-fails found this round**, across all 12 categories × 5 sheets, verified
by direct pixel inspection of the real re-rendered artifacts (not the SVG source in the abstract),
cross-checked against exact source-code coordinates, and independently confirmed by a validator whose
collision-detection logic I mutation-tested myself rather than taking on faith.

## Verdict

**APPROVABLE WITH FIELD VERIFICATION.**

Per `review/GRADING_RUBRIC.md` § Verdict rules: no hard-fails (HF5 — the only ever-confirmed hard-fail
in this package, across three rounds — is resolved with real margin at both former strike zones, and
the full 5-sheet sweep found no new instance); every reviewer score ≥90 on every sheet
(E-001 99, E-003 98, E-005 99, E-006 99, E-007 100 — all ≥90); every remaining unknown is
explicitly marked FIELD VERIFY (every E-003 conductor, PS1/CB1/X1/M1 in the device schedule, the
OI-20 serial-parameter conflict, the OI-09 output-bank-technology conflict, the E-007 SH ground
point) and is tracked in `model/open_items.yaml` (20 items, OI-01–OI-20) with E-009 ("Open items /
field verification") as the docket every sheet points to. Plain **APPROVABLE** is correctly not
reachable and should not be forced — the rubric's own parenthetical is explicit that it isn't
achievable while supply voltage/phase, GS10 exact model/frame, breaker rating, and wire gauge remain
undocumented, which they honestly still are (see the red CAVEAT box on E-003). That is exactly the
condition APPROVABLE WITH FIELD VERIFICATION exists for: a package with zero hard-fails, uniformly
high scores, and every open question disclosed and tracked rather than hidden or guessed.

This closes out the HF5 saga across three re-check rounds: V3 found 6 instances (conductor-through-
label), V3.1's fix introduced 2 new instances in a different geometry class (label-vs-caption,
label-vs-flag-box) because the first fix was verified only against the element it was originally
struck by, and V3.2's fix (mid-height label relocation + real-margin caption/caption-flag spacing,
verified this round against *every* neighboring element, not just the one named in the prior ledger)
holds up under independent re-derivation of the coordinates, independent visual inspection, and an
independent mutation test of the automated check that is supposed to catch this defect class in the
future.

## Residual, non-blocking items for a future round (not required for this verdict)

1. CB1 breaker-pole glyph (X + quarter-arc reads closer to disconnect/isolator than IEC 60617
   circuit-breaker practice) and Q1/PL coil-as-circle glyph — cat 4 -1/-2 deductions, cosmetic,
   carried unchanged since V3, never blocking.
2. Two open comms-parameter conflicts (OI-20: 38.4k/8N2 vs 9600/8N1) and one output-bank-technology
   conflict (OI-09) remain genuinely open per the model — correctly disclosed, not resolved, and not
   expected to be resolved by a rendering round; these are bench-verification tasks, not drafting
   defects.

---
---

# V3.3 FINAL (Round 3.3) — same reviewer, final confirmation pass

**Context:** after V3.2 FINAL above (APPROVABLE WITH FIELD VERIFICATION, E-003 98/100, HF5 clear),
the drafting-standards reviewer's own broader scan caught **2 more E-003 strikes that this ledger's
V3.2 sweep missed**: PE earth-glyph bars through the "NOTES" heading, and the table border bisecting
the "L1787" cite digit. V3.3 fixed both, plus moved the rightmost CB1/Q1 pole label ("L3 (3φ)") to
the opposite side after an **all-stroke check** (not just conductor-vs-text) found a contactor arm
striking it, plus footnote/frame-digit/wrap-metric touch-ups, plus upgraded check L itself to treat
every rendered stroke — not just `data-wire` conductors and wire_tag flags — as a text obstacle.
**Scope this round:** E-003 100%-zoom + zoomed crops of the 4 named zones, a 100% sweep of the other
4 sheets, one more §6 walk, and an independent run + soundness check of the validator.

## Method

Freshness first (same discipline as V3.1): copied the package to scratch, re-ran
`python render_sheet.py` for all 5 sheets from the current model/code, and diffed the output against
the checked-in `sheets/`. **All 5 SVGs byte-identical (`diff -q`, zero output); all 5 PNGs
hash-identical (md5).** Not stale. Then read `render_sheet.py`'s current `_pole_label` /
`breaker_pole` / `contactor_pole` / `draw_table` / `title_block` / `draw_frame` to get exact
post-fix coordinates, extracted the real numbers straight out of the rendered E-003 SVG with a small
script built on `validate_model.py`'s own `_text_boxes()`/`_attr()` helpers (so my bbox math matches
the validator's, not a hand-rolled estimate), then rendered fresh 4–9× crops of every named zone
directly from the real PDF via `fitz` (not the SVG in the abstract) for a final eyes-on check.

## 1. NOTES/PE zone (former strike: PE earth-glyph bars through "NOTES")

Real coordinates: `earth_symbol(700,795)`'s widest bar ends `x=716` (`y=807`); the right-column
`draw_annotations` call (notes+sources) now starts at `x=740` — a genuine **24px horizontal gap**,
matching the task brief exactly. Even the vertically-closest bar (narrowest, `y=815`, which does fall
inside the "NOTES" text's y-span 812.4–823.8) stops at `x=705` — still 35px short of the column's
`x=740` start. Cropped at 6× (`crops_v33/e003_notes_pe_zone.png`): clean, real whitespace between the
ground symbol and "NOTES," no touch.

## 2. W306 table row / cite clearance

Row 6 (0-indexed; W306 is the 7th data row), `y: 334–356`; Notes column `x: 1350–1555`. Cite text
`"route power ⊥ control wiring — GS10_UM.txt L1787"` starts `x=1355`; measured via the validator's own
bbox estimator, `xmax=1545.08` → **9.92px clear of the column's right border (1555)** — matches the
task brief's "9.9px" claim to one decimal. Cropped at 7× (`crops_v33/e003_w306_row.png`): real
whitespace visible before the border, cite fully legible, not touching the CB1/Q1 defect class or any
column rule.

## 3. CB1/Q1 pole-label rows — now split left/right — readability check

Current code: `_pole_label()` puts `side="left"` labels at `x−24` (anchor=end) and `side="right"`
labels at `x+24` (anchor=start); both `breaker_pole`/`contactor_pole` call sites pass
`("L1", xL, "left"), ("L2", xC, "left"), ("L3 (3φ)", xR, "right")`.

**Root cause of the split, confirmed by hand-reconstruction:** "L3 (3φ)" is 7 characters vs. "L1"/"L2"'s
2 — if left-anchored like its neighbors it would span roughly `x:405–436`, which overlaps the
**middle** pole's (L2, `x=400`) open-contact arm geometry (`x:400–410`, sweeping `y:350–366` on the Q1
contactor row) — a cross-pole collision caused by the wider label, not a self-collision. Verified this
hypothesis is real by mutation-testing the actual `check_text_conductor_collision()` against that exact
reconstructed geometry (§7 below): it fires. The real, current geometry does not.

**Real-geometry clearances (extracted from the live SVG, not estimated):** CB1 row — L1/L2 boxes end
`x=316`/`376` (17.2px+ clear of any neighboring glyph); L3 box starts `x=484`, 14px+ clear of its own
pole's X-cross/arc and far from anything else. Q1 row — same pattern, plus the Q1 caption sits a real
10.2 SVG-unit gap above the label row (unchanged from V3.2, re-confirmed). Zero overlap anywhere in
this cluster.

**Is the split still unambiguous for a tech?** Yes. Cropped the full SUPPLY→CB1→Q1→VFD1 cluster at 4×
(`crops_v33/e003_pole_cluster_wide.png`) plus each row at 8× (`crops_v33/e003_cb1_row_close.png`,
`crops_v33/e003_q1_row_close.png`): every label sits immediately beside its own pole at mid-height,
with nothing else occupying that position on either side — a tech doing the meter-lead walk reads
straight across from conductor to label on both rows, left-left-right pattern notwithstanding. No
ambiguity, no counting required.

## 4. Footnote zone

`"MC placement per manual recommendation; as-built UNVERIFIED"` at `(1132, 986)`, `fs=7.2` →
`ymax=988.88`. Title-block's own bottom border (rect edge) is at `y=990`, `x:1120–1550`. Real
clearance: **1.12 SVG-units (~2.2px at the 2× PNG raster)** — the tightest margin in the package.
Cropped at 9× (`crops_v33/e003_footnote_titleblock.png`): a real, visible (if thin) white line
separates the text from the border — confirmed not touching. Clean today; flagged below as worth
future headroom, not a defect.

## 5. Full 5-sheet 100% sweep

Viewed all 5 sheets full-page at native (2×) resolution. **No new HF5 instance found anywhere.** Frame
digits (1–8/A–D, shared `draw_frame()`, `fs=7` per its own "an fs-8 bbox crosses the inner frame edge"
comment) read clean on all 5 sheets. E-001 device schedule / numbering key / legend intact. E-005
single "Drawn:" line and rail/I-05 text intact (V3.2 fix holds, unchanged this round). E-006 commons /
notes / connection table intact. E-007 SH tag / corrected readback / troubleshooting block intact. No
sheet shows any sign of the notes-column, table-rebalance, or footnote/frame-digit/wrap-metric changes
disturbing anything outside E-003 (the shared functions they touch — `draw_frame`, `title_block`,
`_wrap` — render identically-safe on all 5).

## 6. §6 meter-lead walkthrough — E-003, re-walked once more

1. SUPPLY, red FIELD VERIFY, top of sheet — clean.
2. CB1: L1/L2 read directly left of their poles, L3 (3φ) directly right of its pole — all three
   legible at a glance, no position-counting needed despite the split.
3. W300–W308 wire flags: all present, legible, boxes intact, none bisected.
4. Q1: identical clean split-label pattern; "Q1 — SAFETY POWER CONTACTOR (MC/'MLC' — WI-001)" caption
   reads on its own line with real headroom above the pole row.
5. VFD1 terminals R/L1, S/L2, T/L3 — clean, verbatim GS10 manual designations.
6. Ground return: W315 (VFD1.GND) + W316 (M1.PE) → PE bus → earth symbol, clear of the NOTES column →
   W317 back to source PE (E-002).
7. Motor leads W310–312 → M1 T1/T2/T3, M1 caption + "(FIELD VERIFY)" both clean, clear of the W310 tag
   box.
8. Connection table: all 15 rows present; W306's cite fits its cell with real margin.

**No notes this round** — the walk completes end-to-end with zero ambiguity, including through the
newly-split pole-label convention.

## 7. Validator run + independent soundness check of "ALL strokes as obstacles"

`py -3 validate_model.py`: **ALL CHECKS PASSED**, A through L — check L reports 0 hits across all 5
sheets.

Per this round's own discipline (a bare PASS isn't enough on its own — V3.1 proved a prior check L
version could PASS while blind to a real defect class), read the current
`_stroke_obstacles()`/`check_text_conductor_collision()` (`validate_model.py:417–560`): it now
collects **every** `<line>` element in the SVG (not only `data-wire` conductors) plus **every**
`<rect>`'s four edges (except wire_tag flag rects, handled by the stricter opaque-area rule) as
collidable obstacles — confirming the "ALL strokes as obstacles" claim is real code, not an assertion.

Then independently mutation-tested it (own synthetic SVGs, not reusing V3.2's) against the three
defect classes this round's fixes actually target:

```
table column-separator <line> through a cite text (D2)                  -> FOUND (correctly caught)
title-block border <rect> edge through the footnote at the old y=988 (D3) -> FOUND (correctly caught)
contactor open-contact-arm <line> through a hypothetical left-side L3 (D4) -> FOUND (correctly caught)
all 3 real/current (fixed) geometries, same script                        -> silent (correctly clean)
```

All three of this round's fix classes are ones the *previous* check L (data-wire + wire_tag-rect only)
structurally could not have caught — none of a table rule, a title-block border, or a glyph's own
device-shape line is a `data-wire` conductor or a wire_tag flag rect. The upgrade is real and closes
exactly the gap that let the drafting reviewer's 2 findings ship past V3.2's validator run.

## HF1–HF4, HF6 — unchanged, no new content to verify this round

Diffed `sheets.yaml`/`wires.yaml`/`devices.yaml`/`e007_rs485.yaml` against the V3 baseline: every
content change present (E-003/E-006 subtitles, the OI-09 disclosure, the E-007 port-location note, the
Q1 `sheet_label` field, the anti-spaghetti law text, the Hz×100 readback correction) was already
fact-checked in the V3.1/V3.2 rounds above. This round's diff is layout/geometry only — no new claim,
citation, or fact entered the model. Nothing new to hunt for HF1/HF4/HF6 against.

## Updated per-sheet scores

No category changed from V3.2 FINAL — the 2 newly-found strikes lived in zones V3.2's own sweep
didn't examine (NOTES/PE, W306 cite), so they were never reflected in a V3.2 deduction to begin with;
now confirmed resolved, the score stays at V3.2's ceiling rather than moving further.

| Sheet | V3.2 | V3.3 | Δ | Notes |
|---|---|---|---|---|
| E-001 | 99 | **99** | 0 | unchanged — frame-digit/footnote-adjacent shared-code changes verified clean on this sheet too |
| E-003 | 98 | **98** | 0 | unchanged — both newly-reported strikes (NOTES/PE, W306 cite) confirmed resolved with real margin (24px, 9.9px); CB1/Q1 label split confirmed unambiguous; footnote clearance confirmed genuine (tight, ~1.1 units, but real). cat 4 still 6/8 (CB1 breaker glyph vs IEC 60617 — cosmetic, unrelated, unchanged) |
| E-005 | 99 | **99** | 0 | unchanged — full-page sweep clean |
| E-006 | 99 | **99** | 0 | unchanged — full-page sweep clean |
| E-007 | 100 | **100** | 0 | unchanged — full-page sweep clean |

**All 5 sheets ≥90. Zero hard-fails found this round**, across all 12 categories × 5 sheets — verified
by direct pixel inspection of the real re-rendered artifacts, cross-checked against exact source-code
and live-SVG coordinates (not hand-waved estimates), and independently corroborated by a validator
whose new "all strokes" collision logic I read AND mutation-tested against this round's own named
defect classes rather than trusting the PASS on its face.

## Verdict

**APPROVABLE WITH FIELD VERIFICATION.**

Per `review/GRADING_RUBRIC.md` § Verdict rules: no hard-fails (both strikes the drafting reviewer found
after V3.2 FINAL are confirmed resolved with real, measured margin — 24px at the NOTES/PE zone, 9.9px
at the W306 cite — and the CB1/Q1 pole-label split introduced by the same fix pass is confirmed
unambiguous for a technician, not a new HF5 in disguise); every reviewer score ≥90 on every sheet
(E-001 99, E-003 98, E-005 99, E-006 99, E-007 100); every remaining unknown is still explicitly
FIELD VERIFY and tracked in `model/open_items.yaml` / E-009. Plain **APPROVABLE** remains correctly out
of reach for the same reasons as every prior round (supply voltage/phase, GS10 exact model/frame,
breaker rating, wire gauge all still undocumented, still honestly flagged in the red CAVEAT box on
E-003) — that is exactly the condition this verdict tier exists for.

## Residual, non-blocking items for a future round (not required for this verdict)

1. **Footnote-to-title-block-border clearance (~1.12 SVG-units / ~2.2px)** is the thinnest margin found
   anywhere in the package. It is real and clean today (confirmed at 9× crop), but has the least
   headroom of anything checked this round — worth a couple extra px of breathing room next time the
   title block or footnote text is touched, so it isn't one small edit away from becoming a strike.
2. CB1 breaker-pole glyph (X + quarter-arc reads closer to disconnect/isolator than IEC 60617
   circuit-breaker practice) and Q1/PL coil-as-circle glyph — cat 4 deductions, cosmetic, carried
   unchanged since V3, never blocking.
3. Two open comms-parameter conflicts (OI-20) and one output-bank-technology conflict (OI-09) remain
   genuinely open per the model — correctly disclosed, bench-verification tasks, not drafting defects.
4. **Process note:** this round's 2 new-strike source was a gap between what one reviewer's sweep
   physically zoomed into and what actually needed checking (`draw_annotations`' dynamic y-offset and a
   table's rebalanced column width aren't obvious "strike-risk" zones until you go looking). Check L's
   upgrade to "all strokes as obstacles" is the right structural answer — it now catches this whole
   class without depending on a human choosing the right crop. Recommend this becomes the durable
   backstop and future rounds treat a passing check L as strong (not just partial) evidence, provided
   its mutation-test coverage is re-run whenever it changes again.
