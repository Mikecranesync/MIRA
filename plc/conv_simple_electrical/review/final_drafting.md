# CV-101 Electrical Print Package — Final Independent Review
## Role: Electrical Drafting Standards (NFPA 79 / UL 508A / IEC 61082+60617 / NEMA ICS 19 / ISA-5.1)
## Deep-dive categories: 4 (symbols/designations), 5 (wire & terminal ID), 6 (power/control/ground/safety separation), 10 (title block/revision/notes/legibility)

Reviewed independently against `review/GRADING_RUBRIC.md`, `review/GOLD_STANDARD_SOURCES.md`,
`docs/references/industrial-wiring-diagram-standards.md`, `docs/reference/excalidraw_electrical_print_style.md`
(house style law), the model YAMLs (`devices.yaml`, `terminals.yaml`, `wires.yaml`, `sheets.yaml`,
`e002_oneline.yaml`, `e007_rs485.yaml`, `open_items.yaml`), `review/CROSSREF_MATRIX.md` and
`review/EVIDENCE_MATRIX.md`. Did **not** read `review/reviewer_*_v2.md`, `review/reviewer_*_v3.md`,
`review/GRADES_V2.md`, `review/GRADES_V3.md` per instructions. All nine sheets inspected as both PNG
and the bound `sheets/CV-101_print_set.pdf`; PDF page order verified programmatically (PyMuPDF text
extraction, not just visual scan); line-style semantics (solid vs. dashed) verified with pixel
run-length sampling, not eyeballing.

**Verdict (this reviewer's scope only):** No hard-fails found in categories 4/5/6/10. All 9 sheets
score ≥90 (range 95–100). This reviewer's portion is consistent with **APPROVABLE WITH FIELD
VERIFICATION**, contingent on the technician / controls-engineer / evidence-auditor reviewers also
clearing their bars — not assessed here (out of scope, and their ledgers were deliberately not read).

---

## Verification method notes (how findings below were established, not asserted)

1. **PDF set order** — extracted text from all 9 pages of `CV-101_print_set.pdf` via PyMuPDF;
   confirmed page 0→8 headers read `E-001 COVER…` through `E-009 OPEN ITEMS…` in strict order, each
   page's embedded "E-0xx" title-block text matches its position. Order is correct, not assumed.
2. **Line-style semantics (solid=verified / dashed=field_verify)** — sampled raw pixel rows: the
   E-007 `485+` link (`status: verified`) is a single unbroken 1196px black run inside its drawn
   span (genuinely solid, not a rendering artifact); the E-005 `W500` link (`status: field_verify`)
   resolves to 46 discrete ~14px dashes on a consistent ~8px pitch (a clean, regular dash, not a
   broken solid line). Both match their `wires.yaml` status. Spot-check only (per HF2/rubric cat 11
   the full audit is the Evidence & Hallucination Auditor's remit), but the raster is confirmed real,
   not just visually plausible.
3. **Table-overflow check (E-008 40-row / E-009 27-item)** — cropped and inspected the bottom of
   every table column against the sheet frame/title-block boundary at native resolution. Both tables
   terminate with clear whitespace before the frame on every column; no clipped row, no text/line
   collision found.
4. **Half-scale legibility proxy** — rendered the bound PDF at 72 DPI (1600×1040 px, half the linear
   pixel density of the shipped 3200×2080 PNGs) to stress-test the smallest/lightest-weight text.
   Bold black primary labels hold up; the specific risk identified is documented under Finding C below.

---

## Cross-sheet findings (apply to more than one sheet — cited once here, scored per-sheet below)

**Finding A — CB1 (breaker) and Q1 NO-contact glyphs are the same base symbol.** On E-002 and E-003,
`CB1` and `Q1`'s power contacts (`13-14`, `43-44`) are drawn with an identical diagonal switch-blade
glyph; the only differentiator is a small "X" mark on CB1's blade. Neither matches the canonical
IEC 60617 disconnector/breaker glyph (a rectangle/box on the line) or the NEMA/IEEE-315 breaker
convention (blade + small trip-mechanism square); the X-mark is a house convention, not a
standards glyph. It is internally consistent and the device TAG carries the disambiguation, so this
is not an HF — a technician who knows this print's own key reads it correctly — but a reader relying
on symbol shape alone (the category-4 measurable check) would not recognize CB1 as a breaker from the
glyph. **E-002 −1 pt, E-003 −1 pt (cat 4).**

**Finding B — red is used for two undisclosed meanings.** The printed LEGEND (present on every sheet)
defines red as exactly one thing: *"proposed wire number (red = unverified)"* — this is also the
house style law's rule (`excalidraw_electrical_print_style.md` §2 rule 4: *"Reserve red for the
unverified/FIELD-VERIFY marker only. Do not encode signal type in color alone."*). But every SAFETY
block on the package (E-001, E-003, E-004, E-005, E-006) mixes red and black bullets for what reads
as emphasis, not verification status — and the split is not tied to evidence quality. Confirmed by
direct color inspection of each safety box:
  - E-001: "LOTO + wait ≥5 min…" = black; "Monitored e-stop is NOT a safety stop…" = red.
  - E-003: "Never start/stop via input power…" = **red**; "LOTO + wait ≥5 min…" = black; "Monitored
    e-stop is NOT a safety stop…" = **red**; "PE resistance ≤0.1Ω…" = black.
  - E-004: "PS1 is fed from AC mains — LOTO…" = black; "Monitored e-stop is NOT a safety stop…" = red.
  - E-005: "I-02/I-03 are MONITORED e-stop inputs…" = red; "De-energize + LOTO before metering." = black.
  - E-006: "Monitored outputs are NOT a safety function." = red; "E-stop must remove power per
    NFPA 79." = black; "Q1/MLC is a CONTROL RELAY…always LOTO at CB1 or upstream." = red.
  Both the red and the black bullets in every case cite a real source (manual line numbers, WI
  section, NFPA 79/EN 60204-1) — verification status does not explain the split, so the legend's own
  stated rule for red is being silently broken. Not ambiguous enough to be HF3 (nothing is
  mischaracterized — the safety facts stated are all correct and repeatedly, unambiguously worded),
  but it is a real, specific, repeated violation of this package's own documented color law, and it
  dilutes red's single meaning right where a fast/stressed reader needs it least diluted.
  **E-001 −2, E-003 −2, E-004 −2, E-005 −2, E-006 −2 pts (cat 4).** (E-002/E-007/E-008/E-009 carry no
  `safety:` block — not applicable, confirmed against `sheets.yaml`.)

**Finding C — the selector-switch "maintained" actuator glyph is small, thin, and light gray.**
E-005's `SS1 FWD`/`SS1 REV` contacts carry a light-gray, thin-stroke "maintained contact" cap glyph,
clearly distinguished (correctly) from the bold black pushbutton T-cap used for `S2 RUN` — good
symbol differentiation logically, confirmed at native res. But it is the single lowest-contrast,
smallest-stroke element on the sheet. At the half-scale render proxy this glyph is the first thing to
approach the legibility floor, ahead of every bold black element. **E-005 −1 pt (cat 4).**

---

## Per-sheet findings and scores

### E-001 — Cover / Legend / Device Schedule — **97/100**
- Cat 4 (8→6): Finding B (−2). Legend swatches (solid/dashed/red-box) render correctly and match
  actual usage elsewhere (pixel-verified, see method note 2).
- Cat 5 (10→10, N/A=full — schedule/legend sheet, no conductors of its own).
- Cat 6 (8→8, N/A=full).
- Cat 10 (7→6): Device Schedule "Role" column truncates 6 of 13 rows with a bare `…` and no way to
  recover the full text from the sheet itself (only from `devices.yaml`) — e.g. VFD1, M1, PS1, DB1,
  CB1, Q1 all end mid-sentence. Minor but real — a plant engineer signing this print off the paper
  copy alone cannot read Q1's full role. **−1 pt, cat 10, Device Schedule table, location col 4
  rows PLC1–X1.** Title block itself is complete and correct (id/title/project-asset/rev/date/
  drawn-by/"1 of 9"); wire-numbering key text matches `wires.yaml` `convention:` field verbatim.
- Other categories: no findings in my sampling; evidence column, sheet index, safety/legend content
  all check out.

### E-002 — Power One-Line — **99/100**
- Cat 4 (8→7): Finding A (−1). Conductor-count tick marks correct (2 ticks/1φ,2W; 3 ticks/3φ,3W,
  matching `n_conductors`), device boxes (VFD1/PS1) and motor circle clean and conventional.
- Cat 5 (10→10, N/A=full — one-line carries no wire numbers by explicit design, per its own caveat
  box and the `wires.yaml` convention note).
- Cat 6 (8→8, N/A=full — this sheet legitimately spans multiple circuit families as a documented
  summary; its own caveat states "not a substitute" for E-003/E-004).
- Cat 10 (7→7): title block, legend, notes, sources all correct; nothing overflows.

### E-003 — VFD Power — **95/100**
- Cat 4 (8→5): Finding A (−1), Finding B (−2). Earth/ground symbol (three descending bars) correct
  and recognizable; VFD terminal block glyph and its aux-terminal state presentation (see cat 8, not
  my deep-dive but directly relevant to symbol reading) are good — factory jumper `+1/+2` drawn as a
  small solid bracket (jumpered), `B1/B2` and `DC+/DC-` drawn as plain unbracketed stubs (open) — this
  correctly differentiates jumpered-vs-open state by shape, not just text.
- Cat 5 (10→9): Finding D (−1) — CB1 is the only device on the entire package whose individual
  terminal numbers (`.1/.2/.3/.4` per `terminals.yaml`) are not printed on the symbol itself (only
  "L1"/"L2" phase captions are); every other device (Q1, VFD1, PL1/PL2, S2, PS1, DB1) prints its
  terminal IDs directly on the graphic. A technician must open the Connection Table to learn CB1's
  line-side pole is literally `CB1.1`. Wire-number tags pixel-confirmed opaque/not-bisected; real
  GS10-manual terminal names used verbatim (`R/L1`, `U/T1`, etc., cited to `GS10_UM.txt` line numbers).
- Cat 6 (8→7): Finding G (−1) — the PE bus (`W315`/`W316`/`W317`) is drawn with the identical dash
  weight/pattern as the power conductors around it; it is identifiable (ground symbol + "PE" text +
  its own W3xx numbers + orthogonal routing, which IS correct) but not independently
  line-style-distinct from power, which is what the category asks for as its own checkbox.
- Cat 10 (7→7): title block, Connection Table, Notes/Safety/Sources all clean; nothing overflows;
  zone grid present.

### E-004 — 24 VDC Control Power — **96/100**
- Cat 4 (8→6): Finding B (−2). DB1 distribution-block glyph (a box with a tick-marked bus rail) is a
  good, recognizable terminal-strip pictograph.
- Cat 5 (10→10): terminal IDs correct throughout (PE/N/L in; +V/-V/DC-OK out; +24V-bus/0V-bus).
- Cat 6 (8→8): clean single-family (24 VDC control power) sheet; AC-in stage visually separated from
  the DC distribution stage.
- Cat 10 (7→5): **−2 pts, cat 10, PS1 device box, mid-sheet.** The PS1 model string is truncated
  inside its own box with an **unclosed parenthesis and no ellipsis or continuation marker**:
  *"Mean Well DIN-rail supply (24 V / 1.0 A; 100"* — the real value in `devices.yaml` continues
  "…100-240 VAC in @ 0.55 A; +V / -V / DC-OK out, N / L / PE in, +V ADJ pot, DC-OK LED)". Unlike
  E-001's Device Schedule (which signals truncation with a proper "…"), this reads as a rendering
  defect — the text simply stops mid-clause with no visual cue that it was cut. This is a distinct,
  worse instance of the same underlying truncation behavior as E-001's finding, and specific to this
  sheet/location.

### E-005 — PLC Digital Inputs — **97/100**
- Cat 4 (8→5): Finding B (−2), Finding C (−1). NC vs. NO differentiation (vertical bar = NC, absent =
  NO) is consistent and unambiguous once read against the printed legend/labels; photo-eye glyph
  (triangle+arrow) is a reasonable, recognizable photoelectric-sensor pictograph.
- Cat 5 (10→10): every conductor wire-tagged; tags pixel-confirmed opaque/not-bisected by the dash
  pattern (method note 2); both ends of every conductor carry real terminal IDs matching
  `terminals.yaml` (I-00…I-11, COM0, S0 `11-12`/`23-24`, SS1 `FWD`/`REV`, S2 `3-4`, B1 `BN`/`BU`/`BK`).
- Cat 6 (8→8): single-family input sheet, no cross-family content.
- Cat 10 (7→7): title block correct; this is the style law's own §6 acceptance-test sheet and it
  reads that way — nothing overflows, spares I-06…I-11 uniformly shown with an open-circle
  "unused" convention.

### E-006 — PLC Outputs — **98/100**
- Cat 4 (8→6): Finding B (−2). Pilot-light (circle+X), relay-coil (circle+arc), and lamp (circle+X)
  glyphs are internally distinct (coil vs. lamp is not a color-only distinction — good); coil terminals
  `A1/A2` and aux-contact numbers `13/14`/`21/22`/`31/32`/`43/44` are the REAL terminal markings
  photographed off the physical Schneider TeSys CA3KN22BD device, not invented IEC-style
  decoration — correct use of evidence-backed, verbatim designations.
- Cat 5 (10→10): every terminal ID printed directly on its symbol (better than E-003's CB1 in this
  respect); `+CM0/-CM0/+CM1/-CM1` bank labels verbatim from `CCW_VARIABLES_v4.0.txt`.
- Cat 6 (8→8): Q1's power contacts are correctly NOT shown here (only the coil) — the best
  cross-sheet family-separation example in the package, and it is bidirectionally cross-referenced
  ("→ O-02 (E-006)" on E-003; "see E-003" on E-006).
- Cat 10 (7→7): title block's 2-line caption wraps cleanly inside its box with no overflow; spares
  O-04…O-06 use the same open-circle convention as E-005's spares (good cross-sheet consistency).

### E-007 — RS-485 / Modbus RTU — **99/100**
- Cat 4 (8→8): no safety block on this sheet (confirmed against `sheets.yaml` — none expected), so
  Finding B does not apply here; box-with-terminal-label convention for PLC1/VFD1 matches the rest of
  the package. (Note only, not scored: the 120 Ω termination symbol is drawn as an IEC-style
  rectangle rather than an ANSI zigzag — a minor regime mix, but clearly labeled and not confusing.)
- Cat 5 (10→10): mnemonic conductor labels (`485+/485-/SGND/SH`) are explicitly exempted from the
  W-number scheme by E-001's own key and applied consistently; `SH` is correctly the one dashed/
  field-verify conductor among three solid/verified ones, matching its evidence status exactly.
- Cat 6 (8→8): single-family comms sheet.
- Cat 10 (7→7): title block correct; the corrected-value caveat box (Channel 0→2, SGND pin 1/8→3,
  8N2→8N1) is the package's clearest example of "documented supersession with the supersession note."

### E-008 — Terminal Strip (X1) + Wire List — **100/100**
- Cat 4 (8→8, legend swatches only, correct).
- Cat 5 (10→10, N/A=full — this sheet is the generated cross-reference index, not a drawn circuit).
- Cat 6 (8→8, N/A=full).
- Cat 10 (7→7): the 40-row table was specifically checked for row overflow at native pixel resolution
  against the sheet frame/title block — clean, generous whitespace below the last row (`SH`), no
  clipped/overlapping text anywhere in the table.

### E-009 — Open Items / Field Verification — **100/100**
- Cat 4 (8→8, legend swatches only, correct).
- Cat 5 (10→10, N/A=full).
- Cat 6 (8→8, N/A=full).
- Cat 10 (7→7): the 27-item, two-column table was specifically checked for row overflow — both
  columns terminate with clear whitespace before the frame; multi-line wrapped rows (OI-16, OI-19,
  OI-22, OI-25, OI-26) stay fully inside their row boundary with no collision with neighboring rows;
  RESOLVED items (OI-21, OI-27) are correctly grayed rather than deleted, preserving traceability.

---

## Designation census (cat 4/5 cross-check against `terminals.yaml`/`devices.yaml`)

| Family | Values seen on sheets | Consistent with model? |
|---|---|---|
| Device tags | `PLC1, VFD1, M1, S0, SS1, S2, B1, PS1, DB1, CB1, Q1, PL1, PL2, X1` | Yes — identical set/spelling on E-001 schedule and every detail sheet |
| PLC inputs | `I-00…I-11`, `COM0` | Yes, verbatim silk-screen IDs |
| PLC outputs | `O-00…O-06`, `+CM0/-CM0/+CM1/-CM1` | Yes, verbatim from CCW_VARIABLES |
| VFD power | `R/L1, S/L2, T/L3` → `U/T1, V/T2, W/T3`; `GND` | Yes, verbatim GS10 manual terminal table |
| VFD aux | `+1/+2, B1/B2, DC+/DC-` | Yes, states (jumpered/open) correctly shown |
| VFD control | `FWD, REV, DI3-5, +24V, DCM, +10V, ACM, AI, AO1, DO1, DOC, PE` | Yes (E-006 note only; not drawn as a control-wired circuit — correctly deferred, hybrid map = OI-22) |
| Relay/contactor | `Q1` coil `A1/A2`; NO `13/14`,`43/44`; NC `21/22`,`31/32` | Yes — real IEC-numbered terminals off the physical device (photo-verified), not invented |
| Comms | `D+ (A), D- (B), SG`, RJ45 `pin 3/4/5`, `485+/485-/SGND/SH` | Yes, and correctly exempted from the W-number scheme |
| Wire numbers | `W300–W317` (E-003), `W400–W405` (E-004), `W24,W0V,W500–W505` (E-005), `W600–W609` (E-006) | Yes, `W[sheet][line-2d]` scheme holds; rails exempted as documented |
| Terminal families named in the brief | `A1/A2` ✓ (Q1 coil, E-006); `13-14/43-44` ✓ (Q1 NO contacts, E-003); `+24V-bus/0V-bus` ✓ (DB1, E-004) | All present, correctly used, cross-sheet consistent |

No ad-hoc/invented device-tag or terminal-family shapes found anywhere in the package.

---

## Hard-fail screen (within cats 4/5/6/10 scope only)

- **HF1** (invented element): none found. Every symbol/tag/terminal traced to a model row or a cited
  manual/photo source. The E-003 `+1/+2` DC-reactor jumper bracket is drawn solid but is not a
  `wires.yaml` row — however both its endpoints (`+1`,`+2`) carry `status: verified` with a cited
  manual source in `terminals.yaml`, so it satisfies HF2's actual test even though it is not literally
  a wire; flagged here as diligence, not scored as a defect.
- **HF2** (unverified solid conductor): none found; spot-checked pixel-level (method note 2).
- **HF3** (ambiguous PE/safety): none found; PE is textually/symbolically unambiguous even where not
  line-style-distinct (E-003, Finding G, scored as a cat-6 deduction, not HF).
- **HF4** (unacknowledged contradiction): none found; the V6 single-phase/MLC corrections are
  supersession notes, explicitly dated and cited (`OI-21`/`OI-27` marked RESOLVED with evidence).
- **HF5** (clipped/overlapping/off-frame/cut-off row): none found. E-008/E-009 tables specifically
  checked and clean. The E-004 PS1 truncation (Finding under E-004 cat 10) is NOT scored as HF5 — the
  text stays inside its own box, is not struck by a line, and is not a cut-off table row; it is a
  poor truncation choice, not a physical collision.
- **HF6** (render-only fact, no model backing): none found in my sampling; full render-vs-model diff
  is the Evidence & Hallucination Auditor's deep-dive, not mine — noted as a scope boundary.

---

## Summary table

| Sheet | Cat 4 /8 | Cat 5 /10 | Cat 6 /8 | Cat 10 /7 | **Total /100** |
|---|---|---|---|---|---|
| E-001 | 6 | 10(N/A) | 8(N/A) | 6 | **97** |
| E-002 | 7 | 10(N/A) | 8(N/A) | 7 | **99** |
| E-003 | 5 | 9 | 7 | 7 | **95** |
| E-004 | 6 | 10 | 8 | 5 | **96** |
| E-005 | 5 | 10 | 8 | 7 | **97** |
| E-006 | 6 | 10 | 8 | 7 | **98** |
| E-007 | 8 | 10 | 8 | 7 | **99** |
| E-008 | 8 | 10(N/A) | 8(N/A) | 7 | **100** |
| E-009 | 8 | 10(N/A) | 8(N/A) | 7 | **100** |

Package minimum (this reviewer) = **95 (E-003)**. No hard-fails. Every sheet ≥90.

## Top fixes, priority order
1. Stop overloading red for safety-emphasis; reserve it strictly for the FIELD-VERIFY/unverified
   marker per the sheet's own legend (E-001, E-003, E-004, E-005, E-006).
2. Fix the E-004 PS1 model-text truncation — either shorten the source string intentionally or make
   the renderer append "…" the way the E-001 Device Schedule already does.
3. Give CB1 a distinct breaker glyph (or at minimum print its `.1/.2/.3/.4` terminal numbers on the
   symbol like every other device on the package) so it doesn't read as "a relay contact with an X."
4. Make the PE bus line-style-distinct from power conductors on E-003 (dash-dot, or a second visual
   channel beyond the ground symbol + text label).
5. Bump the SS1 maintained-contact actuator glyph's stroke weight/contrast so it survives half-scale
   printing as well as the bold pushbutton glyph does.
