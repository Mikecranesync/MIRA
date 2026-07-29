# Controls Engineer Review — CV-101 Electrical Print Package V2

**Reviewer role:** Controls engineer (PLC + drives, Rockwell/AutomationDirect). Deep-dive categories: **1
(Electrical truth & evidence), 7 (PLC I/O presentation), 8 (VFD power & control presentation), 9
(Cross-references), 11 (YAML-to-render consistency)**. All 12 categories scored per sheet per the rubric.
Independent review — scored strictly against `review/GRADING_RUBRIC.md`.

**Method:** Every citation on every sheet in scope was traced to its primary source and independently
re-verified — `plc/Prog_init_ConvSimple_v2.1.st`, `plc/CCW_VARIABLES_v4.0.txt`,
`GS10_actual_parameters_5.20.26.xlsx` (opened with openpyxl, all 18 tabs), `GS10_UM.txt` (line-by-line
grep against every cited line number), `Conv_Simple_CommsToVFD.html`, `Conv_Simple_GS10_Beginner_Verify_V2.html`,
and — critically — `render_sheet.py` itself, to determine which on-sheet facts are actually sourced from
`model/*.yaml` versus hardcoded in the renderer.

---

## Headline finding

The underlying controls engineering in this package is **excellent and unusually well-cited** — I
independently re-verified roughly two dozen specific claims (GS10 terminal names, safety doctrine, the
O-02→ContactorQ1 interlock, the Modbus command-word bit table, the P00.20/P00.21 control-source claim, the
RS-485 pinout, the DC-reactor/brake/DC-bus jumper doctrine) against the actual manual, the actual PLC
program, and the actual parameter export, and found the *facts* correct in essentially every case, often
down to the exact cited line number. **The defect is architectural, not factual:** a material fraction of
the engineering content shown on the sheets — most seriously the Modbus command-word decode table on
E-006 — exists **only** as a hardcoded literal string in `render_sheet.py`, with **zero** corresponding row
in any `model/*.yaml` file. That is a clean **HF6** on E-006 per the rubric's own letter, independent of
the fact that the values themselves are correct. A second, softer instance of the same pattern appears on
E-007 (a synthesized "corrected from May-16 draft" callout) and pervasively on E-003 (nearly every
annotation on that sheet is hardcoded prose, not a YAML field). See "Engineering-consistency findings"
below for the full evidence trail.

---

## E-003 — VFD POWER

### Score table (100 pts)

| # | Category | Pts | Score | Deductions |
|---|---|---|---|---|
| 1 | Electrical truth & evidence | 15 | **11** | see below |
| 2 | Technician troubleshooting readability | 12 | 11 | -1 minor: motor terminal row is visually distant from VFD1 output terminals across the motor glyph; still unambiguous |
| 3 | Maintenance-engineer approvability | 8 | 7 | -1: OI pointers live only in the general red box, not inline at CB1/Q1 |
| 4 | Standard symbols & reference designations | 8 | 7 | provisional (not my deep-dive); no defect found |
| 5 | Wire & terminal identification | 10 | 9 | provisional; all conductors flagged, legible |
| 6 | Power/control/grounding/safety separation | 8 | 7 | -1: PE bus run is visually distinct (dashed + earth symbol) but threads through the power-column area rather than fully to one side |
| 7 | PLC I/O presentation | 8 | 7 | N/A-ish (power sheet); the one I/O-adjacent fact ("coil ← O-02, E-006") is correct |
| 8 | VFD power & control presentation | 8 | **7** | see below |
| 9 | Cross-references & continuation markers | 6 | **5** | see below |
| 10 | Title block/revision/notes/scale | 7 | 7 | complete: sheet id, rev A, date, drawn-by, 3 of 9, zone grid, legend |
| 11 | YAML-to-render consistency | 5 | **3** | see below |
| 12 | Absence of unsupported assumptions | 5 | 5 | FIELD VERIFY dashing + red flags applied to all 15 conductors; honest |
| **Total** | | **100** | **86** | |

### Deductions (categories 1, 8, 9, 11 — my deep-dive)

- **-2 pts, cat 1, "CB1/Q1/aux-terminal annotation text"**, `plc/conv_simple_electrical/render_sheet.py:746-821`
  (`render_e003`) — "REQUIRED per GS10_UM L1758-1759 · type/rating: OI-15", "R-C absorber both ends
  recommended", "NOT for routine run/stop", "+1/+2 — factory jumper", "B1/B2 — OPEN", "DC+/DC- — OPEN
  (absent on 120VAC models)", "swap any two leads to reverse — L1773-1776". Every one of these facts is
  **individually accurate** (independently re-verified against `GS10_UM.txt`, see below) but exists **only**
  as a literal Python string in the renderer — none of it is a field in `devices.yaml`, `terminals.yaml`,
  or `wires.yaml`. Fails the category-1 measurable check "every drawn element traces to a model row."
  Note: `terminals.yaml`'s `CB1:` block *does* carry a `#` comment with this same citation
  ("REQUIRED by manual (L1758-1759)") — but YAML comments are not parsed data; they don't reach the
  renderer, so there is no programmatic guarantee the two stay in sync.
- **-1 pt, cat 1, Q1 power-chain placement**, sheet body vs. `model/open_items.yaml` OI-14 — OI-14
  ("Q1 contactor placement in the power chain... assumed line side... verify actual location") is a real,
  filed open item directly about what's drawn, but isn't cross-cited at the Q1 symbol the way OI-15/OI-17
  are cross-cited elsewhere on the same sheet.
- **-1 pt, cat 8, same hardcoded aux-terminal state text** (+1/+2, B1/B2, DC+/DC-) — the *content* is
  correct (confirmed against `GS10_UM.txt` L1824-1844, L1977-1986) but carries the same provenance gap as
  above; category 8 explicitly wants aux terminals "shown WITH state," and the state shown is right, but
  unauditable from the model.
- **-1 pt, cat 9, OI-14 not cross-referenced** at the Q1 symbol (duplicate of the cat-1 note, scored once
  more here because category 9 specifically measures cross-reference discipline).
- **-2 pts, cat 11, same hardcoded annotation set**, `render_sheet.py:746-821` — category 11's measurable
  check is literally "rendered content == model content (spot-check ≥5 facts/sheet)." Of the ~9 facts I
  spot-checked on this sheet, the wire geometry and terminal *names* trace cleanly to `wires.yaml`/
  `terminals.yaml`, but the majority of the *annotation* text (CB1 requirement, Q1 doctrine, aux-terminal
  state, motor-reversal note) does not exist as YAML at all. `validate_model.py`'s Check G (SVG dash/solid
  audit) formally **PASSES** for E-003 — I re-ran it and confirmed — but that check only audits wire
  geometry, not this class of content, so "ALL CHECKS PASSED" overstates model-render fidelity for this sheet.

No hard-fails found on E-003 from this reviewer. The pattern above is serious enough that I recommend the
hallucination auditor evaluate whether it independently qualifies as HF6 on this sheet too (see "Top fixes").

---

## E-005 — PLC DIGITAL INPUTS

### Score table (100 pts)

| # | Category | Pts | Score | Deductions |
|---|---|---|---|---|
| 1 | Electrical truth & evidence | 15 | **12** | see below |
| 2 | Technician troubleshooting readability | 12 | 11 | -1 minor |
| 3 | Maintenance-engineer approvability | 8 | 7 | -1 minor |
| 4 | Standard symbols & reference designations | 8 | 7 | provisional |
| 5 | Wire & terminal identification | 10 | 9 | provisional |
| 6 | Power/control/grounding/safety separation | 8 | 7 | provisional |
| 7 | PLC I/O presentation | 8 | **6** | see below |
| 8 | VFD power & control presentation | 8 | 7 | N/A-ish (not a VFD sheet) |
| 9 | Cross-references & continuation markers | 6 | 6 | both `(PS1/E-004)` refs correct |
| 10 | Title block/revision/notes/scale | 7 | 7 | complete |
| 11 | YAML-to-render consistency | 5 | **4** | see below |
| 12 | Absence of unsupported assumptions | 5 | **4** | see below |
| **Total** | | **100** | **87** | |

### Deductions (categories 1, 7, 9, 11 — my deep-dive)

- **-3 pts, cat 1, I-05 function label "Photo-eye (beam blocked -> pe_latched)", status: verified (solid
  line)**, sheet body + `model/terminals.yaml:34-38` — this is the most material engineering-consistency
  finding on this sheet. `plc/CCW_VARIABLES_v4.0.txt:74` (the I/O map, "unchanged from v3.1") labels this
  exact physical terminal **"Entry sensor (spare)"**. The sheet instead asserts, with full confidence and a
  solid line, that I-05 is an active photo-eye driving `pe_latched` — which I independently confirmed is
  what `plc/Prog_init_ConvSimple_v2.1.st:208-212` actually does in the *running* program
  (`IF _IO_EM_DI_05 THEN pe_latched := TRUE...`). Both sources are real and both are cited elsewhere in the
  model, but the conflict between them (is I-05 spare, or is it a live safety-relevant interlock input?) is
  **not adjudicated anywhere on the E-005 sheet itself**. The only acknowledgment I could find,
  `open_items.yaml` OI-13 ("v4.0 input half drifted — I-05"), is filed under **E-006's** docket (sheet:
  E-006) even though it's describing an E-005 *input*, and doesn't appear on any rendered sheet (E-009 is
  still a stub). Per HF4's carve-out, a documented supersession with a note is not a contradiction — but
  this supersession has no note on the sheet that shows the conflicting fact. I am not calling this an
  outright HF4 myself (I-05's function is functionally well-evidenced from the *live* program, which should
  reasonably win), but it is very close, and I flag it explicitly for the hallucination auditor.
- **-2 pts, cat 7, spares I-06..I-11** legend text "spare (no field wire — confirmed unused)", sheet body
  (right column) — no open-item id is shown. `OI-08` exists for exactly this claim ("Confirm no field wires
  land on I-06..I-11") but isn't cross-referenced here, which is inconsistent with **E-006's** spares
  (O-04..O-06), which correctly cite "OI-12" inline. Category 7 explicitly requires "spares marked with
  their open item" — E-006 does it, E-005 doesn't.
- **-1 pt, cat 11, process gap**, `plc/conv_simple_electrical/validate_model.py:244` — the automated SVG
  dash/solid audit (Check G) only loops `["E-003_vfd_power", "E-006_plc_outputs"]`; E-005 is never audited
  by the tool (its own `EVIDENCE_MATRIX.md` self-reports "Rendered: n/a (untagged renderer)" for all 8
  wires). I manually parsed `E-005_plc_inputs.svg`'s `<line>` elements as a substitute and confirmed the
  dash/solid semantics **are** correct (every field-device→PLC wire run is drawn with `stroke-dasharray`,
  matching `wires.yaml`'s `field_verify` status on W200-W205/W24/W0V; the short solid segments are just the
  contact-symbol glyph, not a wire-status claim) — so the sheet itself passes on inspection, but the
  package's own tooling doesn't confirm it, which is what category 11 is asking for.
- **-1 pt, cat 12**, spares wording "confirmed unused" (see cat-7 note above) slightly overclaims: it's
  verified-in-*logic* (no program reference), not verified-in-*field* (no stray physical wire) — those are
  different claims and OI-08 exists precisely because the second one is still open.

---

## E-006 — PLC OUTPUTS

### Score table (100 pts)

| # | Category | Pts | Score | Deductions |
|---|---|---|---|---|
| 1 | Electrical truth & evidence | 15 | **6** | **HF6 — see below** |
| 2 | Technician troubleshooting readability | 12 | 10 | -2: Modbus cross-ref, while accurate, is a comms-internals digression on a sheet about physical outputs |
| 3 | Maintenance-engineer approvability | 8 | 7 | -1 minor |
| 4 | Standard symbols & reference designations | 8 | 7 | provisional |
| 5 | Wire & terminal identification | 10 | 9 | provisional |
| 6 | Power/control/grounding/safety separation | 8 | 7 | provisional |
| 7 | PLC I/O presentation | 8 | **8** | full marks — see below |
| 8 | VFD power & control presentation | 8 | **6** | see below |
| 9 | Cross-references & continuation markers | 6 | 6 | E-007/E-004/E-003 all correct, Q1 coil↔poles bidirectional |
| 10 | Title block/revision/notes/scale | 7 | 7 | complete |
| 11 | YAML-to-render consistency | 5 | **1** | see below |
| 12 | Absence of unsupported assumptions | 5 | **3** | see below |
| **Total** | | **100** | **77** | **NOT APPROVABLE (HF6)** |

### HARD FAIL — HF6

**The "MODBUS CROSS-REF (run/dir/freq)" box** — `plc/conv_simple_electrical/render_sheet.py:1103-1111`:

```
"Run/dir/freq commands reach VFD1 over RS-485
(E-007): 0x2000 cmd (STOP=1, FWD+RUN=18,
REV+RUN=34), 0x2001 freq. P00.20=1, P00.21=2
(RS-485) verified by 2026-05-20 parameter export."
```

This is a **fully hardcoded literal string**. I grepped every file in `model/` for `18`, `34`,
`STOP=1`, `FWD+RUN`, `REV+RUN`, `cmd_word`, `0x2000` — there is **no row in `devices.yaml`,
`terminals.yaml`, `wires.yaml`, `sheets.yaml`, or `open_items.yaml`** that carries the command-word bit
values. `sheets.yaml`'s E-006 `scope:` field carries only `P00.21=2` in prose; nothing else in this box has
any YAML backing at all. This is HF6 by the rubric's own definition: "Engineering information present only
in the render (renderer source code) with no model (YAML) backing."

**Important nuance:** I independently re-verified every fact in this box and **all of it is correct**:
- `plc/GS10_UM.txt:15733-15748` — the drive's actual command-word bit table: bits[1:0] `01B=Stop,
  10B=Run`; bits[5:4] `01B=FWD, 10B=REV`. Decoding: 1 = Stop ✓; 18 (0b10010) = Run+FWD ✓; 34 (0b100010) =
  Run+REV ✓.
- `plc/Prog_init_ConvSimple_v2.1.st:217,219,221` — `vfd_cmd_word := 18` (FWD+RUN), `:= 34` (REV+RUN),
  `:= 1` (STOP) — matches exactly.
- `plc/Prog_init_ConvSimple_v2.1.st:243-245` — writes to `Addr 16#2001` (AB firmware subtracts 1 → wire
  `0x2000`) for 2 elements (cmd word + freq) → wire `0x2001` is the freq register — matches "0x2000
  cmd... 0x2001 freq" exactly.
- `GS10_actual_parameters_5.20.26.xlsx`, "Different Value" tab: `P00.20 Content Value = 1`, `P00.21 Content
  Value = 2` — matches "P00.20=1, P00.21=2" exactly, and `GS10_UM.txt:15857,15865,21902-21903` confirm code
  `1`/`2` mean "RS-485 communication input" for frequency/operation source respectively.

So this is a **provenance/architecture defect, not a factual error** — but the rubric's HF6 is written to
catch exactly this class of thing (content that bypasses the model layer), and it does so here cleanly. The
fix is mechanical and low-risk (the facts don't need re-investigation, just a YAML home — see "Top fixes").

### Other deductions (categories 7, 8, 11, 12 — my deep-dive)

- **Cat 7 — full marks (8/8).** E-006 is the *best*-behaved sheet on this category in the package: all four
  commons (`+CM0/-CM0/+CM1/-CM1`) are explicit with feed/return notes, OPC names (`_IO_EM_DO_0X`) are shown
  on every terminal, the grammar mirrors E-005 (device-right vs. device-left, consistently), and — unlike
  E-005 — the spares (O-04..O-06) correctly cite their governing item inline: "spare (confirm no field wire
  — OI-12)."
- **-2 pts, cat 8**, same Modbus cross-ref box — the control-source *statement* is correct and rightly
  owned by this sheet (category 8 asks for exactly that), but the specific values backing it are
  unauditable from the model, which undercuts the "traceable" half of the requirement.
- **-4 pts, cat 11**, same box — this is the single clearest violation of "rendered content == model
  content" in the package. `validate_model.py`'s Check G formally **PASSES** for E-006 (re-ran it, confirmed
  — wire dash/solid geometry for all 10 field_verify wires is correct), but that check has no visibility
  into annotation content, so the "ALL CHECKS PASSED" banner materially overstates this sheet's
  model-fidelity.
- **-2 pts, cat 12**, the phrase "verified by 2026-05-20 parameter export" *inside* the hardcoded box —
  asserting a specific verification source with total confidence for a claim that is not reachable from the
  model violates the spirit of "no confident tone about unverified facts," even though (per above) the
  underlying fact is in fact true.

---

## E-007 — RS-485 / MODBUS

### Score table (100 pts)

| # | Category | Pts | Score | Deductions |
|---|---|---|---|---|
| 1 | Electrical truth & evidence | 15 | **12** | see below |
| 2 | Technician troubleshooting readability | 12 | 11 | -1 minor |
| 3 | Maintenance-engineer approvability | 8 | 7 | -1 minor |
| 4 | Standard symbols & reference designations | 8 | 7 | provisional |
| 5 | Wire & terminal identification | 10 | 9 | provisional |
| 6 | Power/control/grounding/safety separation | 8 | 8 | full marks — comms-only, explicitly excludes FWD/REV/VI/ACM/FA |
| 7 | PLC I/O presentation | 8 | 7 | N/A-ish (not an I/O sheet) |
| 8 | VFD power & control presentation | 8 | **7** | see below |
| 9 | Cross-references & continuation markers | 6 | 6 | self-contained, E-006 refs it correctly (bidirectional) |
| 10 | Title block/revision/notes/scale | 7 | 7 | complete |
| 11 | YAML-to-render consistency | 5 | **3** | see below |
| 12 | Absence of unsupported assumptions | 5 | **3** | see below |
| **Total** | | **100** | **87** | |

### Deductions (categories 1, 8, 11 — my deep-dive)

- **-3 pts, cat 1, the "CCW SERIAL PORT" strip (9600 · 8N1 · Channel 2 · Node 1) + the red "CORRECTED from
  May-16 draft" callout**, `render_sheet.py:443-463`, cross-referenced against `model/open_items.yaml`
  **OI-20**. This is a genuine, evidence-backed finding, not a nitpick:
  - The sheet presents `9600 baud / 8N1 (P09.04=12)` as settled fact, no hedge, no dashing.
  - `GS10_actual_parameters_5.20.26.xlsx` (Group 9 tab, the most recent **machine-generated** evidence in
    the repo, dated 2026-05-20) shows `P09.01 Content Value = 38.4` (kbps, i.e. **38400 baud**, sitting at
    factory *default*) and `P09.04 Content Value = 13` (**8N2**, also at factory default) — i.e. neither
    parameter has actually been changed from factory default as of the most recent hard export.
  - The model's own `open_items.yaml` **OI-20** already flags this exact tension: *"GS10 comms line params:
    2026-05-20 export = 38.4k/8N2 vs 2026-05-26 bench sniff = 9600/8N1 — adjudicate."* — i.e. the model
    itself considers this **unresolved**, yet the sheet shows total confidence.
  - I traced the "May-16 draft" (`Conv_Simple_CommsToVFD.html`) precisely: its own "Set to" column (not the
    "Default" column, which I initially misread — corrected after re-fetching full table context) instructs
    `P00.20=1, P00.21=2, P09.00=1, P09.01=9.6(9600bps), P09.04=13(8N2), Channel 0`. So the May-16→current
    correction genuinely is Channel 0→2, SGND pin 1/8→3, and 8N2→8N1 (all three of which I independently
    confirmed against `GS10_UM.txt`) — baud was **never** part of the correction (both old and new intend
    9600) — so the callout's 3-item list is complete and correctly composed, not missing a baud item as I
    initially suspected. **What's missing is disclosure that the most recent hard parameter export still
    shows the pre-correction protocol/baud state**, and that OI-20 calls this "adjudicate," not "closed."
    The underlying corrected values are very likely right (`Beginner_Verify_V2.html`'s keypad readback
    checklist explicitly reads back `P09.01=9.6, P09.04=12` and is real field evidence) — this is a
    disclosure gap, not a wrong value.
- **-2 pts, cat 8**, same serial-config values — terminal/pin names (`SG+/SG-/SGND` → RJ45 pin `5/4/3`) and
  the `120Ω` termination are independently verbatim-verified (`GS10_UM.txt:1953,15991`); the ding is solely
  for the same unresolved-per-OI-20 confidence gap on the protocol parameters.
- **-1 pt, cat 11, process gap** — same as E-005: `validate_model.py`'s Check G doesn't cover E-007
  (`EVIDENCE_MATRIX.md` self-reports "untagged renderer" for all 4 links). I manually audited
  `E-007_rs485_modbus.svg`: the three `evidence: verified` links (485+, 485-, SGND) render **solid**
  (no `stroke-dasharray`); the one `field_verify` link (SH/shield) renders **dashed** — this is **correct**,
  matches `e007_rs485.yaml` exactly. Note E-007's `serial_config` strip (line 447,
  `f"{sc['driver']} · {sc['baud']}..."`) is properly YAML-interpolated — the best-behaved renderer of the
  four on this specific point.
- **-1 pt, cat 11**, the red correction callout, `render_sheet.py:456-463` — the *consolidated sentence* has
  no single matching YAML field (its components are scattered across `channel_note`, one link's `source`
  text, and `serial_config.note`); separately, each link's `source` evidence field (e.g. "Beginner_Verify
  p48 (SGND -> pin 3; CommsToVFD 'pin 1/8' SUPERSEDED)") is defined in `e007_rs485.yaml` but is **never
  rendered** — the connection table has no "Source" column, only "Evidence" (verified/field_verify) and
  "Notes."
- **-2 pts, cat 12**, same OI-20 non-disclosure as cat 1.

---

## Engineering-consistency findings (sheet ↔ program ↔ export ↔ manual)

Answering the deep-dive prompts directly:

1. **Does E-006 match what actually drives O-00..O-06?** Yes. `plc/CCW_VARIABLES_v4.0.txt:78-82` names
   O-00=LightGreen, O-01=LightRed, O-02=ContactorQ1, O-03=PBRunLED, O-04..O-06=spare — matches the sheet
   exactly.
2. **Is the O-02→contactor claim evidenced?** Yes, independently, two ways: `CCW_VARIABLES_v4.0.txt:80`
   names it directly, and `Prog_init_ConvSimple_v2.1.st:214`
   (`vfd_run_permit := _IO_EM_DO_02 AND e_stop_ok AND NOT pe_latched;`) uses the **physical output's own
   state** as a read-back interlock gating the Modbus run command — i.e. the program won't tell the drive to
   run unless the safety contactor output is actually commanded on. This is good, deliberate engineering
   and the sheet represents it correctly.
3. **Is the Modbus-vs-terminal control story correct per the parameter export?** Yes — `P00.20=1` and
   `P00.21=2` are both confirmed as the *actual* Content Value in the 2026-05-20 export, and `GS10_UM.txt`
   independently confirms `1`/`2` mean RS-485 for frequency/operation source respectively. Separately, the
   claim that the *hardwired* DI1-DI5 fallback (P02.0x) is inactive is also confirmed: the export's Group 2
   tab shows every P02.0x parameter sitting at factory default (Default==Content for all of P02.01-P02.05,
   P02.13, P02.16).
4. **Are E-003's GS10 terminal names verbatim per the manual?** Yes, extensively verified —
   `R/L1,S/L2,T/L3` (`GS10_UM.txt:1971,1973`), `U/T1,V/T2,W/T3` (`:1975`), `+1,+2` (`:1977-1978,1824-1826`),
   `B1,B2` (`:1980,1842`), `DC+,DC-` (`:1982,1844,1986`) — all verbatim, including the "120VAC models do not
   have DC bus terminals" caveat.
5. **Is anything on any sheet contradicted by the program or the export?** One real, evidence-backed
   conflict: **E-005's I-05 label** ("Photo-eye... pe_latched," rendered solid/verified) versus
   `CCW_VARIABLES_v4.0.txt:74`'s "Entry sensor (spare)" for the identical terminal — see the E-005 cat-1
   deduction above. The Prog_init program (the live logic) supports the sheet's reading, but the conflict
   with the CCW table is not visible anywhere on the rendered sheet.
6. **Is every register/parameter value on any sheet backed by the model YAML or a cited source (HF6
   hunt)?** No — **confirmed HF6 on E-006** (Modbus command-word box, zero YAML backing, see above), plus a
   pervasive softer version of the same pattern on E-003 (nearly all annotation/citation text is hardcoded
   in `render_sheet.py`, not YAML) and E-007 (the correction callout). One additional side-finding:
   `devices.yaml`'s PLC1 description says "7 relay DO" — per Rockwell's published spec for the
   `2080-LC20-20QBB` (12 DC inputs, **7 24V DC *source* outputs** + 1 AO), the outputs are transistor/DC
   *sourcing*, not electromechanical relay. The package's own `open_items.yaml` **OI-09** already flags this
   exact tension ("+CM0/-CM0 naming suggests DC transistor banks; devices.yaml says 'relay DO' — conflict")
   — good self-auditing — but it's resolvable from vendor literature alone (no bench trip needed) and should
   be closed rather than left as a metering task.

---

## Package verdict (this reviewer)

**NOT APPROVABLE.**

- **HF6 confirmed on E-006** (Modbus command-word table, zero YAML backing) — per the rubric, "Any
  hard-fail = package NOT APPROVABLE regardless of points," full stop.
- Independent of the HF, every sheet scored **below the 90 threshold** from this reviewer (E-003: 86,
  E-005: 87, E-006: 77, E-007: 87) — the rubric's APPROVABLE / APPROVABLE-WITH-FIELD-VERIFICATION verdicts
  both require "every reviewer ≥90 on every sheet."
- The engineering *content* underlying all four sheets is genuinely strong and unusually well-cited; the
  defects found are concentrated in **provenance/architecture** (hardcoded facts bypassing the YAML model)
  and **disclosure** (confident presentation of parameters the model's own open-items tracker calls
  unresolved), not in incorrect engineering. This should be a fast V3, not a re-design.

## Top 5 fixes (prioritized)

1. **Close the E-006 HF6.** Move the Modbus command-word table (STOP=1/FWD+RUN=18/REV+RUN=34, 0x2000/0x2001,
   P00.20=1/P00.21=2) into a YAML-backed field — extend `sheets.yaml`'s E-006 entry or add a small
   `model/e006_modbus_control.yaml` — citing `GS10_UM.txt:15733-15748` and
   `Prog_init_ConvSimple_v2.1.st:217-221,243-245`. The facts are already correct; this is a refactor, not a
   re-investigation.
2. **Resolve OI-20 for real, not just flag it.** Get a fresh GS10 keypad readback or parameter export dated
   after 2026-05-26 that confirms `P09.01=9.6/P09.04=12` on the physical drive, and cite *that* on E-007 — or
   at minimum surface OI-20's "adjudicate" status on the sheet itself so the technician's confidence matches
   the model's.
3. **Acknowledge the I-05 conflict on E-005 itself**, not just in a misfiled open item. Add a visible note
   ("`CCW_VARIABLES_v4.0.txt` labels this terminal 'Entry sensor (spare)'; the running `Prog_init_v2.1`
   program actively uses it for `pe_latched` — treated as current per the live program; physical sensor
   identity remains FIELD VERIFY per OI-06") and re-file OI-13's "v4.0 input half drifted — I-05" text under
   E-005's docket, not E-006's.
4. **Migrate the remaining hardcoded annotation/citation strings into YAML** (E-003's CB1/Q1/aux-terminal
   notes; E-007's correction callout) following the pattern E-007's own `serial_config` strip already uses
   correctly (`f"{sc['driver']} · {sc['baud']}..."`). While doing so, add a "Source" column to E-007's
   connection table so each link's `source` field (already in `e007_rs485.yaml`, currently never rendered)
   is actually visible.
5. **Extend `validate_model.py`'s Check G to E-005 and E-007** (currently hardcoded to
   `["E-003_vfd_power", "E-006_plc_outputs"]` at line 244) by tagging their renderer's `<line>` elements with
   `data-wire`/status like the other two sheets already do. Right now "ALL CHECKS PASSED" silently covers
   only half the package's conductors — I substituted a manual SVG audit for both and they pass, but that
   shouldn't depend on a human doing it by hand every time.
