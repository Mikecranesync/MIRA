# CV-101 Electrical Print Package — Controls Engineer Review (Independent)

**Reviewer role:** Controls Engineer (PLC + drives, Rockwell/AutomationDirect/Schneider)
**Deep-dive categories:** 1 (Electrical truth & evidence), 7 (PLC I/O presentation), 8 (VFD power &
control presentation), 9 (Cross-references), 11 (YAML-to-render consistency)
**Method:** Independent verification against primary sources — did NOT read prior
`reviewer_*`/`GRADES_*` ledgers. Verified every load-bearing claim myself against:
`Prog_init_ConvSimple_v2.1.st`, `CCW_VARIABLES_v4.0.txt`, `GS10_UM.txt` (23,795 lines, read at
source line numbers), `GS10_actual_parameters_5.20.26.xlsx` (parsed directly with openpyxl — own
column mapping verified against the P00.01=1.60A known-good value before trusting other rows), the
real Schneider Electric CA3KN22BD datasheet (fetched live), all 9 rendered PNGs, all `model/*.yaml`
files, and ran `validate_model.py` myself (12/12 automated checks passed).

---

## KEY CHECKS (as assigned)

**(a) Is the E-003 single-phase topology engineering-correct and internally consistent across
E-002/E-003/E-004/E-006?**
YES, with two documentation gaps (below). Topology: 230 V 1φ (2-wire L1/L2) → CB1 (2-pole) →
Q1/MLC NO contacts 13→14 (leg 1) and 43→44 (leg 2) → VFD1 R/L1, S/L2 (T/L3 correctly unused on a
1φ-input model) → VFD1 U/T1, V/T2, W/T3 (3φ output — physically correct: a 1φ-input PWM VFD still
synthesizes 3φ output via its inverter stage; this is not a contradiction) → M1 (230 V 3φ,
technician-confirmed). Verified GS10 terminal table verbatim against `GS10_UM.txt` L1971-1986
myself (R/L1,S/L2,T/L3 / U/T1,V/T2,W/T3 / +1,+2 / B1,B2 / DC+,DC- / ground) — exact match, no
invented terminal names. Using two discrete NO poles of one relay to gang-switch both hot legs of a
230 V 1φ circuit off one coil is correct 2-pole disconnect practice (not single-pole switching).
E-002 (one-line) matches E-003/E-004 exactly at the summary level (see key check d). E-004's 24 VDC
branch is correctly isolated from the VFD power path (separate tap off the same source, never
touches R/L1-S/L2). E-006's Q1 coil (A1/A2 ← O-02) is bidirectionally cross-referenced with E-003's
Q1 power contacts (13-14/43-44). No HF1 (invented device/terminal/voltage) found in this chain.

**(b) Is the MLC-as-supply-switch use of a CA3KN22BD control relay defensible at ~1.6 A?**
Defensible on the numbers, but under-documented and applied outside its stated duty class — a real
finding (detailed below). Independently pulled the actual Schneider datasheet: Ith (thermal,
50°C) = **10 A**, rated making capacity = **110 A** (IEC 60947), associated fuse = 10 A gG.
Against a 1.60 A drive (P00.01, independently confirmed from the raw xlsx), that is a ~6× thermal
margin and a wide making-capacity margin over plausible inrush for a drive this small. **However**,
the datasheet's own `Contactor application` field reads **"Control circuit"** and its utilization
category is **AC-15 / DC-13** — pilot-duty for electromagnet/coil control, not a power-circuit
(AC-1/AC-3) rating. Schneider does not publish a power-switching rating for this part at all. The
model's own justification text ("used within its contact rating for the small drive, P00.01=1.60A",
`devices.yaml` Q1 note) cites only the *load's* current, never the *device's* rating — it is an
uncited engineering conclusion. My independent check shows the conclusion is probably *right in
practice*, but the package doesn't show its work, and doesn't flag that this is pilot-duty hardware
pressed into supply-switching service. See Finding 2 below.

**(c) E-004: PS1 → DB1 → the +24V/0V nodes E-005/E-006 consume — consistent?**
YES. Verified the electrical-node identity directly: E-004's `W402`(PS1.+V→DB1.+24V-bus)/`W403`
(PS1.-V→DB1.0V-bus)/`W404`/`W405` land on the *same* PS1.+24V/PS1.0V nodes that E-005 consumes as
`W24`/`W0V` and E-006 consumes as `W600`/`W609` — no renaming drift, no duplicate/competing node
names across sheets. PS1 device identity + ratings (Mean Well, 24 V/1.0 A out, 100-240 VAC/0.55 A
in) are photo-verified, not invented. One completeness gap: PS1's own PE/chassis-ground terminal is
explicitly drawn "(not drawn)" on E-004 with no wire — meaning **no PE bonding path for the 24 VDC
supply enclosure exists anywhere in the whole 9-sheet package**, and it isn't tracked as its own
open item (only DB1's polarity is, under OI-25). Not an HF (nothing false is asserted — it's
honestly marked "not drawn"), but a real completeness gap worth its own open item. Minor deduction,
E-004 cat 1.

**(d) Does E-002 one-line match E-003/E-004?**
YES, verified line-by-line against `model/e002_oneline.yaml` and the two rendered PNGs side by
side: node labels, evidence status (verified/field_verify), conductor tick-counts (2W single-phase
supply/CB1/Q1 leg, 3W motor output), and the Q1/MLC description all agree exactly with E-003's
detail. No drift.

**(e) Any value not backed by model YAML (HF6), or contradicting the program/manual (HF4)?**
**HF6: none found.** Ran `validate_model.py` myself — all 12 automated checks pass, including
"K. No render-only engineering text" and the SVG audit (E-003:12/12, E-004:6/6, E-005:8/8,
E-006:10/10, E-007:4/4). I independently spot-checked well over the ≥5-facts/sheet minimum on every
sheet against `sheets.yaml`/`devices.yaml`/`terminals.yaml`/`wires.yaml`/`e002_oneline.yaml`/
`e007_rs485.yaml`/`open_items.yaml` and found no engineering fact on any rendered sheet that isn't
traceable to a YAML row.
**HF4: none found as a flat, provable contradiction** — but two near-misses that I score as
deductions rather than hard-fails (reasoning below), plus one new independent finding:

1. **GS10 manual's "don't cycle a power contactor for normal run/stop" guidance is cited for CB1
   but not extended to Q1/MLC — the device that actually does this job.** `GS10_UM.txt` L1754-1757:
   *"Do not use a power circuit contactor or disconnect switch for normal run/stop control of the
   GS10 AC drive and motor. This will reduce the operating life cycle... Cycling a power circuit
   switching device while the AC drive is in run mode should be done only in emergency situations."*
   L1811-1813: *"Do NOT start/stop the GS10 AC drive by turning input power ON/OFF... it is
   recommended to do so only ONCE per hour."* E-003's own SOURCES block cites `GS10_UM.txt`
   "topology L1750-1813" — a range that **includes both of these warnings** — yet the sheet's safety
   note only applies the ONCE-per-hour caution to CB1 ("CB1 is branch protection only, not a
   run/stop device"). Q1/MLC is the device whose entire function, per the sheet's own caveat, is to
   "power the drive on" when O-02 energizes — functionally exactly the "power circuit contactor"
   the manual is warning about. I traced the actual run/stop mechanism in `Prog_init_ConvSimple_
   v2.1.st`: motor start/stop is commanded via Modbus `vfd_cmd_word` (18/34/1 to register 0x2000),
   NOT by cycling Q1 — this is the correct, sanctioned approach (P00.21=2 = RS-485 as the run
   source). `vfd_run_permit := _IO_EM_DO_02 AND e_stop_ok AND NOT pe_latched` reads O-02 as an
   *input* to the permit calc, consistent with O-02/Q1 being a session-level "safety power" enable
   (tied to e-stop/ready state) rather than a per-cycle run/stop switch — which, if true, IS exactly
   the sanctioned "emergency situations" carve-out. But **the ladder logic that actually drives O-02
   (Prog1) is not in this repo as text** — I cannot independently confirm Q1's cycling cadence, and
   neither can the print package: it doesn't state or verify the cadence anywhere, despite citing
   the manual range that makes cadence safety-and-longevity relevant. This is a real, well-founded
   gap — not a proven contradiction (I can't prove Q1 IS cycled improperly), but an unacknowledged
   risk sitting inside an already-cited source range. **Recommend:** add an open item to confirm
   Q1/O-02 assertion cadence (session-level vs per-cycle) and cite `GS10_UM.txt` L1754-1757/L1811-
   1813 explicitly against Q1 (not just CB1) on E-003 and/or E-006.

2. **R-C surge absorber recommendation (`GS10_UM.txt` L1750-1753: "Both ends of the MC should have
   an R-C surge absorber") is never surfaced on E-003 or E-006** despite being inside the same cited
   source range and directly relevant to Q1 (the MC-equivalent device in this design). It appears
   only as a fragment inside OI-14's "Verify" text (about contactor *placement*, a different
   question), uncited to a line number (inconsistent with this package's otherwise very precise
   line-cite discipline) and not on E-009 as its own item. **Recommend:** its own open item + a note
   on E-003/E-006.

3. **NEW finding (independent, not previously flagged anywhere in the model): P09.09 (Response
   Delay Time) is called "CRITICAL" in the PLC program's own header comment** —
   `Prog_init_ConvSimple_v2.1.st` "COMMS PRECONDITIONS (bench-verified 2026-05-26, unchanged): ...
   P09.09=10.0 ms <-- CRITICAL (default 2.0 ms => ErrorID-55)" — yet **P09.09 does not appear
   anywhere on E-007** (the Modbus sheet) or in `open_items.yaml`/E-009, even though E-007 lists
   `Prog_init_ConvSimple_v2.1.st` as a source and E-007 already tracks the sibling baud/protocol
   question as OI-20. Independently confirmed from the raw xlsx (`GS10_actual_parameters_5.20.26.
   xlsx`, row `09.09`): Default=2.0, Content=2.0 as of the 2026-05-20 export (i.e., still at the
   error-prone factory default at that snapshot) — consistent with the same "05-20 snapshot predates
   the 05-26 bench fix" story that already explains the baud/protocol gap, so this isn't a new
   contradiction, just a parameter the package should be tracking alongside OI-20 and isn't.
   **Recommend:** fold P09.09 into OI-20 or add a sibling open item, and show it on E-007.

**Why these are deductions, not HF4:** HF4 requires "a contradiction... that the sheet does not
explicitly acknowledge." None of the three items above is a *stated* fact on any sheet that
conflicts with the program/manual — they are *omissions* of a caution/parameter from within an
already-cited source range or already-cited source file. I score them as meaningful category-1/8
deductions on the sheets where they land, not hard-fails.

**Independent cross-check of package's own numeric claims (all confirmed correct):** Pulled the raw
xlsx myself (own column mapping verified against the known P00.01=1.60 A value first). Confirmed
directly: P00.01=1.60 A ✓, P00.20 Content=1 ("RS485 COMM") ✓, P00.21 Content=2 ("RS485 Interface")
✓, P09.00=1 ✓, P09.01 Content=38.4 (kbps, matching the package's own "2026-05-20 export read
38.4k/8N2" disclosure) ✓, P09.04 Content=13 (8,N,2 for RTU, matching the same disclosure) ✓, and
**P02.00 through P02.05 are ALL at factory default (Default==Content for all six)** — independently
verifies E-006's "P02.0x at factory default per the 2026-05-20 parameter export" claim, which
underpins the whole "hardwired fallback NOT ACTIVE" conclusion (OI-18). This is a real strength: the
package's parameter citations, where checked, are accurate to the source spreadsheet.

---

## Per-sheet scores (100 pts each; my full 12-category pass, deep-dive cats weighted most carefully)

Per task framing: E-001/E-002/E-008/E-009 are cover/one-line/list/docket sheets — categories 5, 6,
7, 8 (conductor-only) are N/A=full credit on those four.

### E-001 — Cover / legend / device schedule: **97**
- Cat 1 (15/15): device schedule matches `devices.yaml` exactly; evidence status correctly shown.
- Cat 2 (11/12): -1, several device-schedule Role cells are truncated with "..." (Q1, PS1, CB1) —
  not unreadable/HF5 (clean ellipsis, not a collision), but reduces cover-sheet self-sufficiency.
- Cat 3 (8/8), Cat 4 (7/8): -1, Q1 tagged "Q1" (contactor-family letter) though the actual device is
  manufacturer-classed a *control relay*; defensible since it performs contactor-like duty in this
  design, but a purist NFPA-79/IEC tag convention would favor K1/CR1 — noted, not scored harshly.
- Cats 5/6/7/8 (34/34): N/A=full.
- Cat 9 (6/6), Cat 10 (7/7).
- Cat 11 (4/5): -1, truncated table cells are recoverable only via the repo YAML, not from the sheet
  itself.
- Cat 12 (5/5).

### E-002 — Power one-line: **99**
- Cat 1 (15/15): verbatim match to `e002_oneline.yaml`; earlier 3φ-supply error explicitly disclosed
  as a corrected supersession (HF4 carve-out honored).
- Cat 2 (12/12): whole power path stated in the header subtitle — excellent 3-second orientation.
- Cat 3 (8/8).
- Cat 4 (7/8): -1, the "tap"/break symbol at the PS1 branch point isn't in the sheet's own legend.
- Cats 5/6/7/8 (34/34): N/A=full.
- Cat 9 (6/6): explicit forward-refs to E-003/E-004; those sheets refer back to E-002 as "SUPPLY" —
  bidirectional.
- Cat 10 (7/7), Cat 11 (5/5): 1:1 content match verified directly against the YAML. Cat 12 (5/5).

### E-003 — VFD power (CB1 → VFD1 → M1): **92** — lowest sheet, primary deep-dive findings land here
- Cat 1 (10/15): -3 Finding 1 (Q1 cycling-caution not extended from CB1), -2 Finding 2 (R-C surge
  absorber omitted from this sheet despite the cited source range containing it).
- Cat 2 (11/12): -1, PE line uses a dash-dot rendering not separately explained in the legend
  (VERIFIED/FIELD-VERIFY legend covers status, not the PE symbol convention).
- Cat 3 (8/8), Cat 4 (8/8, not deep-dive — conventional breaker/switch/motor symbols).
- Cat 5 (10/10): every conductor (W300-W317) flagged, both ends real terminal ids matching
  `terminals.yaml` exactly.
- Cat 6 (8/8): pure power sheet, explicitly "No control wiring on this sheet" — clean separation.
- Cat 7 (8/8): N/A content, full credit (no I/O on this sheet).
- Cat 8 (6/8): -2, same two findings recur here under "VFD power & control presentation" (this is
  precisely where MC/protective-device guidance belongs); control-source deferral to E-007 is
  correctly worded.
- Cat 9 (6/6): bidirectional refs to E-006 (Q1 coil), E-007 (control source), E-002 (supply/PE).
- Cat 10 (7/7): clean title block, no clipping.
- Cat 11 (5/5): validator SVG audit passed 12/12 for this sheet; ≥5 facts spot-checked against
  `wires.yaml`/`terminals.yaml` and `GS10_UM.txt` L1971-1986 directly — exact matches.
- Cat 12 (5/5): entirely, correctly, dashed field_verify — no overclaiming.
- **Sum: 10+11+8+8+10+8+8+6+6+7+5+5 = 92**

### E-004 — 24 VDC control power distribution (PS1): **99**
- Cat 1 (14/15): -1, no PE bonding path for PS1's enclosure anywhere in the package, and not its own
  open item (key check c).
- Cat 2 (12/12): clear meter-lead walk; DB1 polarity uncertainty explicitly flagged.
- Cat 3 (8/8), Cat 4 (8/8, not deep-dive).
- Cat 5 (10/10), Cat 6 (8/8): clean power-only separation.
- Cats 7/8 (16/16): N/A, full credit (no PLC I/O or VFD detail on this sheet).
- Cat 9 (6/6): cross-refs E-002 (source) and E-005/E-006 (load nodes) correctly, verified as the
  *same electrical node*, not a re-derivation (key check c).
- Cat 10 (7/7), Cat 11 (5/5): matches model exactly, PS1's "(not drawn)" PE/DC-OK terminals honestly
  marked rather than invented. Cat 12 (5/5).

### E-005 — PLC digital inputs: **100** — strongest sheet for my deep-dive (cat 7)
- Cat 1 (15/15): I-05 CCW-v4.0-vs-live-program supersession explicitly and correctly disclosed
  (I-06 correctly NOT flagged the same way — its status genuinely didn't change, verified against
  `Prog_init_ConvSimple_v2.1.st`, which never references `_IO_EM_DI_06`).
  All OPC tags (_IO_EM_DI_00..05) verified directly against the live program.
- Cat 2 (12/12): explicit "READS (acceptance)" walk, textbook meter-lead clarity.
- Cat 3 (8/8), Cat 4 (8/8, not deep-dive).
- Cat 5 (10/10): every conductor flagged, real terminal ids.
- Cat 6 (8/8): pure DI sheet.
- Cat 7 (8/8) — DEEP DIVE: rung grammar mirrors E-006 (source→device→PLC on E-005; PLC→load on
  E-006 — a deliberate, consistent, left-to-right convergence-on-PLC1 convention); COM0 shown as an
  explicit terminal with its own open item (OI-02); OPC tags shown under every terminal; all 6
  spares (I-06..I-11) individually marked with their open item (OI-08).
- Cat 8 (8/8): N/A, full credit.
- Cat 9 (6/6): cross-refs E-004 (PS1 source) correctly.
- Cat 10 (7/7).
- Cat 11 (5/5) — DEEP DIVE: SVG audit passed 8/8; spot-checked all 6 input rows + COM0 + all 6
  spares against `terminals.yaml`/`wires.yaml` — zero discrepancies.
- Cat 12 (5/5): monitored-e-stop-is-not-a-safety-stop note present and correctly worded.

### E-006 — PLC outputs (O-00..O-06): **97**
- Cat 1 (13/15): -2, same Finding 1/2 gap recurs (lighter weight than E-003 since E-006's own safety
  block already substantially covers Q1's limitations — "NOT an NFPA-79/EN-60204-1 safety-rated
  disconnect... Do not treat this circuit as the LOTO isolation point" is genuinely good, prominent
  disclosure); still missing the CA3KN22BD's actual rated numbers and the manual's cycling caution.
- Cat 2 (12/12), Cat 3 (8/8), Cat 4 (8/8, not deep-dive).
- Cat 5 (10/10): every conductor flagged, real terminal ids (Q1.A1/A2/13/14/43/44 etc.).
- Cat 6 (8/8): pure DO sheet.
- Cat 7 (8/8) — DEEP DIVE: mirrors E-005 grammar exactly; commons explicit (+CM0/-CM0/+CM1/-CM1);
  OPC tags shown; spares (O-04..O-06) marked with OI-12. OI-09's bank-technology conflict (WI-001
  "relay dry contacts" vs ±CM naming suggesting DC-fed banks) is disclosed as a genuine unresolved
  ambiguity rather than guessed at — exemplary honesty, not a defect (cat 12 credit, not a
  deduction).
- Cat 8 (7/8) — DEEP DIVE: control-source statement correctly carries P00.20=1/P00.21=2 with its
  export-date citation (satisfies the rubric's explicit "Modbus, P00.20/P00.21" ask); -1 for the
  same Finding 1/2 residue.
- Cat 9 (6/6): bidirectional to E-003 (Q1 power contacts), E-004 (PS1), E-007 (hybrid control map,
  OI-22) — excellent.
- Cat 10 (7/7).
- Cat 11 (5/5) — DEEP DIVE: SVG audit passed 10/10; spot-checked O-00..O-03, spares, all 4 commons,
  and Q1's full terminal set against `sheets.yaml`/`terminals.yaml`/`wires.yaml` — exact matches.
- Cat 12 (5/5).

### E-007 — RS-485 Modbus (PLC1 Ch2 <-> VFD1 RJ45): **95**
- Cat 1 (13/15): -1, P00.20/P00.21 (the control-source parameters) are entirely absent from the one
  sheet dedicated to Modbus control — they only appear on E-006. -1, NEW Finding 3 (P09.09 "CRITICAL"
  response-delay parameter, called out by name in the PLC program's own header comment, is untracked
  anywhere in this package).
- Cat 2 (12/12): excellent troubleshooting block (polarity swap, CRC vs silence diagnosis, baud
  confirm, termination, SGND-not-shield).
- Cat 3 (8/8), Cat 4 (8/8, not deep-dive — RJ45 pinout table is clear).
- Cat 5 (10/10): all 4 conductors (485+/485-/SGND/SH) flagged with real terminal ids.
- Cat 6 (8/8): pure comms sheet.
- Cat 7 (8/8): N/A, full credit.
- Cat 8 (5/8) — DEEP DIVE: this is "the right sheet" for a Modbus control-source statement per the
  rubric's own wording, yet P00.20/P00.21 never appear on it (they're on E-006 instead) — -3. The
  baud/8N1-vs-8N2 tension IS well-handled: stated with confidence in the headline, immediately
  qualified in a RED "pending re-verify (OI-20)... Fresh keypad/readback to adjudicate" box directly
  beneath it, both historical readings dated and cited. Independently confirmed both readings against
  the raw xlsx (38.4k/8N2 as of 2026-05-20) and the manual's own factory-default table (`GS10_UM.txt`
  L5618-5652, default P09.04=13/P09.01=38.4 — matches). This is honest handling of a genuine
  unresolved fact, not a defect.
- Cat 9 (6/6): cross-refs E-006 (hybrid control map, OI-22) correctly.
- Cat 10 (7/7): clean.
- Cat 11 (5/5) — DEEP DIVE: SVG audit passed 4/4; command words (STOP=1, FWD+RUN=18, REV+RUN=34)
  independently verified against `Prog_init_ConvSimple_v2.1.st` lines 216-222 — exact match,
  including the 34-not-20 supersession note.
- Cat 12 (5/5): OI-20 tension and SH field_verify both correctly hedged in red.

### E-008 — Terminal strip (X1) + wire list: **100**
- Cat 1 (15/15): mechanically generated from `wires.yaml`/`e007_rs485.yaml`; I compared every row —
  complete, correctly sorted, zero fabrication or omission.
- Cat 2 (12/12, audit-sheet context), Cat 3 (8/8), Cat 4 (8/8, not deep-dive).
- Cats 5/6/7/8 (34/34): N/A=full per task framing.
- Cat 9 (6/6): every row's Sheet column correctly cross-references its owning sheet.
- Cat 10 (7/7).
- Cat 11 (5/5) — DEEP DIVE: this sheet's entire purpose IS YAML-to-render fidelity; row-by-row
  verification found zero discrepancies against `wires.yaml`/`e007_rs485.yaml`.
- Cat 12 (5/5): status coloring (verified/field_verify) correctly mirrors source.

### E-009 — Open items / field verification: **100**
- Cat 1 (15/15): matches `open_items.yaml` exactly — all 27 items + 2 resolved, resolved items
  correctly grayed (not deleted), traceability preserved.
- Cat 2 (12/12), Cat 3 (8/8), Cat 4 (8/8).
- Cats 5/6/7/8 (34/34): N/A=full.
- Cat 9 (6/6) — DEEP DIVE: verified every OI cited from E-003/E-004/E-005/E-006/E-007 exists here
  with a matching Sheet column and no dangling reference in either direction.
- Cat 10 (7/7).
- Cat 11 (5/5) — DEEP DIVE: mechanically generated, verified exact.
- Cat 12 (5/5): this sheet IS the package's honesty mechanism, executed well.

---

## Summary table

| Sheet | Score | Deep-dive findings |
|---|---|---|
| E-001 | 97 | truncated device-schedule cells; Q1 tag-family nitpick |
| E-002 | 99 | unlegended tap symbol (minor) |
| E-003 | **92** | Finding 1 (Q1 cycling caution) + Finding 2 (R-C absorber) land hardest here |
| E-004 | 99 | no PE path for PS1 enclosure (not its own open item) |
| E-005 | **100** | clean — strongest cat-7 execution in the package |
| E-006 | 97 | Findings 1/2 residue (lighter — safety block already covers Q1 limits well) |
| E-007 | 95 | P00.20/P00.21 absent from the Modbus sheet; NEW Finding 3 (P09.09 untracked) |
| E-008 | 100 | mechanically generated, verified exact |
| E-009 | 100 | mechanically generated, verified exact |

**Package score (rubric = minimum of all sheet scores): 92**

## Hard-fails: ZERO (HF1-HF6)

## Verdict (controls-engineer lens only — full package verdict needs all 4 reviewer roles ≥90)

Every sheet clears the ≥90 bar under this deep-dive. No hard-fail found. The package's evidence
discipline is genuinely strong — the automated validator passes cleanly, my own independent parsing
of the raw parameter-export spreadsheet confirms every numeric claim I checked (P00.01, P00.20,
P00.21, P09.00/01/04, and P02.00-P02.05 all at factory default), and the package's habit of
explicitly dating and citing its own supersessions (3φ→1φ supply, Channel 0→2, SGND pin1/8→3,
8N2→8N1, REV 20→34, motor-contactor removed-then-restored) is exactly the honesty behavior the
rubric's HF4 carve-out is designed to reward.

From this lens: **APPROVABLE WITH FIELD VERIFICATION**, conditional on adding three new open items
before final sign-off:
1. Confirm Q1/O-02 assertion cadence (session-level safety-enable vs. per-cycle run/stop) and
   extend the GS10 manual's "don't cycle a power contactor for normal run/stop" caution
   (L1754-1757/L1811-1813) explicitly to Q1 on E-003/E-006, not just CB1.
2. Add the GS10 manual's R-C surge absorber recommendation (L1750-1753) as its own open item / note
   on E-003, tied to Q1.
3. Track P09.09 (response delay, called "CRITICAL" in the PLC program's own comments) alongside
   OI-20 and show it on E-007.

None of these are hard-fails and none contradict a stated fact — they are gaps in an otherwise very
rigorous evidence trail, on a source range the package already cites.

## Top fixes (priority order)

1. **E-003/E-006:** extend the "never cycle for normal run/stop" caution to Q1/MLC explicitly (not
   just CB1); state or open-item Q1's actual assertion cadence.
2. **E-003:** add the R-C surge absorber recommendation as a proper note + open item.
3. **E-003 or E-006 (devices.yaml):** replace the uncited "used within its contact rating" claim
   with the real CA3KN22BD numbers (Ith=10A/50°C, making capacity=110A, IEC 60947) and flag the
   AC-15/DC-13 "control circuit" duty-class mismatch explicitly rather than asserting suitability
   without showing the device-side evidence.
4. **E-007:** add P00.20/P00.21 to the Modbus-authority sheet (currently only on E-006); add P09.09
   to OI-20 or a sibling item.
5. **E-004:** add PS1 enclosure PE bonding as its own open item (currently undocumented and
   untracked).
