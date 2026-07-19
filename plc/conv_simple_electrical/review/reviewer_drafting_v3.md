# CV-101 Print Package V3 — Electrical Drafting Standards Review

**Reviewer role:** Electrical drafting standards (IEC 60617/61082/NFPA 79/UL 508A/NEMA practice).
**Deep-dive categories:** 4 (symbols & designations), 5 (wire/terminal ID), 6 (power/control/PE/safety
separation), 10 (title block/revision/print-scale). All 12 categories scored per rubric; this reviewer is
independent — did not read `reviewer_*_v2.md` or `GRADES_V2.md`.

**Method note (unusual for this pass, disclosed for reproducibility):** in addition to visual review of the
5 PNGs and the bound PDF, I opened `sheets/CV-101_print_set.pdf` programmatically (pymupdf) to verify
line-style semantics *in the raster/vector artifact of record*, not just by eye: confirmed solid vs. dashed
conductors are built from genuinely different path primitives (solid = one continuous `l` segment; dashed =
discrete short segments on a fixed pitch), confirmed wire-tag text colors numerically (`RGB(17,17,17)`
near-black for `verified`, `RGB(192,57,43)` red for `field_verify`/proposed — matches the legend's own claim
on all 5 sheets), and ran an exhaustive text-vs-line-segment bounding-box collision scan across all 5 sheets
to catch "text struck by a line" (HF5) that is easy to miss by eye at normal zoom. One confirmed hard-fail
came directly from that scan (E-003, see below), then was re-confirmed by eye at 20x crop and independently
in the **standalone PNG** (not just the PDF).

---

## Hard-fail summary

| HF | Sheet(s) | Verdict |
|---|---|---|
| HF1 (invented detail) | — | Not found. Every drawn device/terminal/wire I checked traces to `devices.yaml` / `terminals.yaml` / `wires.yaml` / `e007_rs485.yaml`. |
| HF2 (unverified solid) | — | Not found. Spot-checked E-003 (all field_verify → all dashed) and E-007 (485+/485-/SGND verified → solid single-segment lines; SH field_verify → dashed). Render matches model status exactly, confirmed at the vector level. |
| HF3 (ambiguous PE/safety) | — | Not found. PE bus uses a proper, distinct earth glyph (stem + 3 descending bars), never a bare dot; every sheet touching the e-stop carries the "monitored input is NOT a safety stop — hardwire S0" note. |
| HF4 (unacknowledged contradiction) | — | Not found — and this package is unusually good here. Every supersession I could find is explicitly adjudicated with a citation (E-007 Channel 0→2 / SGND pin 1→3 / 8N2→8N1; E-005 I-05 "Entry sensor" vs. live photo-eye, OI-13; E-006 hardwired-fallback-NOT-ACTIVE with the specific reasons DO_07 doesn't exist and DO_03 collides with PBRunLED). This is the rubric's "documented supersession = required honesty" case, not a violation. |
| **HF5 (text struck by a line)** | **E-003** | **CONFIRMED — hard fail.** 7 instances. Package NOT APPROVABLE on this alone. Details below. |
| HF6 (render-only fact, no YAML) | — | Not found in content I spot-checked (see YAML-render consistency notes per sheet). |

### HF5 detail — E-003, terminal-designation labels struck by the FIELD-VERIFY dash pattern

The `L1` / `L2` / `L3 (3φ)` phase labels directly under **both** the CB1 pole row and the Q1 pole row sit
on the same x-coordinate as the vertical dashed (field_verify) conductor, and a dash segment of that
conductor passes **through** the glyphs — "L1" reads as a bar-struck "Ц1"-like glyph, "L2" similarly, and
the parenthesis in "L3 (3φ)" is bisected. A dashed strike also lands on the "(FIELD VERIFY)" caption under
M1. This is exactly the rubric's own example of HF5 ("any text struck by a line").

Verified two independent ways:
1. **Geometric** — extracted every text span bounding box and every stroked line-segment rect (buffered by
   half the stroke width) from the PDF and computed intersections. Confirmed overlaps (not touching, actual
   area overlap) at:
   - `L1` CB1 row, bbox (335.3, 219.4)-(344.7, 230.5), overlap 2.0×7.7 pt
   - `L2` CB1 row, bbox (395.3, 219.4)-(404.7, 230.5), overlap 2.0×7.7 pt
   - `L3 (3φ)` CB1 row, bbox (446.5, 219.4)-(473.5, 230.5), overlap 2.0×7.7 pt
   - `L1` Q1 row, bbox (335.3, 329.4)-(344.7, 340.5), overlap 2.0×8.6 pt
   - `L2` Q1 row, bbox (395.3, 329.4)-(404.7, 340.5), overlap 2.0×8.6 pt
   - `L3 (3φ)` Q1 row, bbox (446.5, 329.4)-(473.5, 340.5), overlap 2.0×8.6 pt
   - `(FIELD VERIFY)` under M1, bbox (324.0, 730.0)-(372.0, 738.9), overlap 1.4×3.9 pt
   Sanity check: this scan returned **zero** hits on E-001, E-005, E-006, E-007 — the defect is isolated to
   E-003, not a false-positive-prone method (the only other borderline result anywhere was a 0.6pt graze
   between the small selector-actuator glyph and its own operating stem on E-005, which is an intentional
   touch, not a strike — legible in the 20x crop).
2. **Visual, at 16-20x zoom, in both artifacts** — confirmed by eye in `sheets/CV-101_print_set.pdf` AND
   independently in the standalone `sheets/E-003_vfd_power.png` (same defect, same six label locations,
   present in the raster artifact of record, not a PDF-only quirk).

This is a rendering-pipeline defect (label baseline placed exactly on the routed conductor's centerline with
no keep-out), not a content/evidence problem — the underlying facts (CB1/Q1 are on phases L1/L2/L3,
field_verify) are correct. But per the rubric, HF-class is HF-class regardless of cause. **Fix:** offset the
`L1/L2/L3` terminal-designation labels off the conductor centerline (or add a white halo/keep-out box like
the wire-number tags already have) in `render_sheet.py`'s pole-label placement for CB1/Q1-style multi-pole
devices, and re-render.

---

## Per-sheet scores

Rubric header scopes the formal 12-category/100-pt rubric to E-003/E-005/E-006/E-007; E-001 is scored per
this campaign's instruction ("applicable categories only, conductor-only cats N/A = full") and is reported
separately from the package minimum.

### E-001 — Cover / Legend / Device Schedule — **95/100** (no HF)

Conductor-only categories N/A→full: cat 5 (10/10), cat 6 (8/8), cat 7 (8/8), cat 8 (8/8) = 34 pts.

| # | Category | Pts | Score | Deduction |
|---|---|---|---|---|
| 1 | Electrical truth & evidence | 15 | 15 | — |
| 2 | Technician readability | 12 | 11 | -1, no "start here" reading-order cue for a first-time user (sheet index + wire-key substitute, but no explicit pointer) |
| 3 | Approvability | 8 | 7 | -1, sheet index shows sheet status but doesn't point to E-009 for the consolidated open-items docket |
| **4** | **Symbols & designations** | **8** | **6** | **-2, cat 4, "Type" column of the Device Schedule, all 13 rows, location: table col 2** — renders the raw YAML `type:` slug verbatim (`e_stop`, `pushbutton_no`, `photo_eye`, `power_supply`, `circuit_breaker`, `pilot_light`, `terminal_block`, `selector_switch`) instead of professional drafting nomenclature (E-STOP, PUSHBUTTON N.O., PHOTOEYE, 24VDC SUPPLY, CIRCUIT BREAKER, PILOT LIGHT, TERMINAL BLOCK, SELECTOR SW). Reads like an unprocessed data export on an otherwise professional sheet; not ambiguous, not HF-class, but a plant engineer would flag it before sign-off. |
| 5 | Wire & terminal ID | 10 | 10 | N/A→full (no conductors on cover) |
| 6 | Power/ctrl/PE/safety separation | 8 | 8 | N/A→full |
| 7 | PLC I/O presentation | 8 | 8 | N/A→full |
| 8 | VFD power presentation | 8 | 8 | N/A→full |
| 9 | Cross-references | 6 | 6 | Sheet index is a correct, complete cross-reference table (E-001..E-009 with status) |
| **10** | **Title block/rev/notes/scale** | **7** | **6** | **-1, cat 10, title-block field 4 ("cover generated from model/\*.yaml")** — see set-level "Drawn-by" finding below; this sheet doesn't carry an explicit "Drawn:" label the way E-005 does |
| 11 | YAML-render consistency | 5 | 5 | Spot-checked 8 device-schedule rows + the SAFETY box text + the wire-numbering-key text verbatim against `devices.yaml`/`sheets.yaml`/`wires.yaml` — exact matches, no drift |
| 12 | Unsupported assumptions | 5 | 5 | Evidence column correctly splits verified (6) vs. field_verify (4: M1, PS1, CB1, X1); Q1's role text is honestly truncated with a real `…` ellipsis (not silently clipped) |

### E-003 — VFD Power — **83/100** — **HARD FAIL (HF5)**

| # | Category | Pts | Score | Deduction |
|---|---|---|---|---|
| 1 | Electrical truth & evidence | 15 | 14 | -1, connection table + drawing match `wires.yaml` exactly for all 15 rows checked; small deduction because the L1/L2/L3 collision (below) momentarily undermines confidence in which node is labeled |
| 2 | Technician readability | 12 | 8 | **-4, cat 2, the six struck phase labels sit exactly where a tech needs to read "which phase is this" at the CB1 and Q1 pole rows** — the meter-lead walk (SUPPLY→CB1→Q1→VFD1→M1, PE bus) is otherwise sound |
| 3 | Approvability | 8 | 7 | -1, same collision undermines "nothing requiring verbal explanation" — a reviewer has to ask "does that say L1?" |
| **4** | **Symbols & designations** | **8** | **7** | **-1, cat 4, CB1/Q1 pole glyphs** — CB1 (breaker) uses a curved blade **+ bold X** at the break point; Q1 (contactor) uses a **plain diagonal blade, no X**. This distinction is real and correctly applied (breaker vs. contactor pole IS visually distinct, confirmed at 8x zoom) — good. Minor deduction only because the breaker glyph is a blade+X hybrid rather than the more universally-recognized box-with-X breaker symbol; still unambiguous. |
| **5** | **Wire & terminal ID** | **10** | **4** | **-6, cat 5, the defining defect of this sheet.** Every conductor does carry a wire-number flag (W300-W317, legible, opaque, correctly red=proposed) — that part is fine. But the **terminal designations** (a required element of this category — "both endpoints labeled with REAL terminal ids") are bisected by a conductor at 7 of 15 label locations (6 phase labels + 1 caption). This is precisely "flags legible... not bisected" failing at the terminal-ID layer. |
| **6** | **Power/ctrl/PE/safety separation** | **8** | **8** | One circuit family, correctly scoped; PE bus uses a proper, distinct earth glyph (stem + 3 bars) at the far right, routed on its own horizontal run, never conflated with a phase conductor; T1/T2/T3/PE motor terminals correctly shown as 4 independent drops with no false bus tying them together; safety separation explicit ("MC is emergency/safety switching only — never start/stop via input power"). The struck-text defect lives in cat 2/5/10, not here — separation *logic* is sound. |
| 7 | PLC I/O presentation | 8 | 8 | N/A, correctly no PLC I/O content on a power sheet |
| 8 | VFD power presentation | 8 | 8 | Line/load flow conventional top→bottom; GS10 terminals verbatim; aux terminals (+1/+2, B1/B2, DC+/DC-) shown WITH state (jumpered/open/absent) exactly as the rubric asks; control-source statement correctly deferred to E-007 rather than fabricated here |
| 9 | Cross-references | 6 | 6 | "SUPPLY (E-002)" / "to source PE (E-002)" / "Q1 coil ← O-02 (E-006)" — bidirectional with E-006's "poles on E-003" |
| **10** | **Title block/rev/notes/scale** | **7** | **3** | **-1 title-block "Drawn:" gap (set-level finding) · -1 smallest body text on this sheet is 6.5pt ("(FIELD VERIFY)" callouts), the worst half-scale legibility margin in the set alongside E-005 · -2, the confirmed HF5 struck text is itself a category-10 "all text legible" failure, independent of the HF flag** |
| 11 | YAML-render consistency | 5 | 5 | Spot-checked all 15 connection-table rows against `wires.yaml` — exact from/to/signal/type/status matches |
| 12 | Unsupported assumptions | 5 | 5 | Every conductor honestly field_verify; caveat box names exactly what's undocumented (supply voltage/phase, GS10 frame, breaker rating, wire gauge); "(if 3φ)" correctly hedges phase count |

### E-005 — PLC Digital Inputs — **99/100** (no HF) — cleanest sheet in the set

| # | Category | Pts | Score | Deduction |
|---|---|---|---|---|
| 1 | Electrical truth & evidence | 15 | 15 | Matches `terminals.yaml` exactly; the I-05 "Entry sensor" (CCW v4.0) vs. live photo-eye supersession is flagged in red with an OI-13 citation — exemplary |
| 2 | Technician readability | 12 | 12 | The NOTES block literally spells out the style-law §6 meter-lead walk in-sheet (+24VDC→PS1→contact→wire#→I-0x→function/OPC→COM0→0V) |
| 3 | Approvability | 8 | 8 | Scope, notes, sources, safety box, OI-02/OI-08 pointers all present |
| **4** | **Symbols & designations** | **8** | **8** | Contact family is correctly disambiguated: S0 11-12 (NC) carries an added perpendicular tick through the blade that SS1 FWD/REV, S0 23-24 (NO), and S2 3-4 (NO) do NOT have — real, consistently-applied NC/NO distinction (confirmed at 10x zoom). Selector-switch actuator glyph (double-bar) is also visually distinct from the pushbutton actuator glyph (single T-bar) on S2 — a level of symbol discipline better than most simplified schematics bother with. |
| **5** | **Wire & terminal ID** | **10** | **10** | Every conductor flagged (W24, W500-W505, W0V), correctly red; zero struck-text hits (confirmed by the exhaustive scan at two thresholds); terminal ids match `terminals.yaml` verbatim (I-00..I-11, COM0, S0 11-12/23-24, SS1 FWD/REV/COM, S2 3-4, B1 BN/BU/BK) |
| **6** | **Power/ctrl/PE/safety separation** | **8** | **8** | Pure 24VDC DI circuit family, no cross-contamination; e-stop dual channel is drawn as two clearly separate rows with correct NC/NO marking; explicit "a monitored input is NOT a safety stop" |
| 7 | PLC I/O presentation | 8 | 8 | Filled dot = populated terminal, hollow circle = spare (I-06..I-11) — clean, self-consistent grammar; OPC tags shown per point |
| 8 | VFD power presentation | 8 | 8 | N/A, correctly no VFD content |
| 9 | Cross-references | 6 | 6 | "(PS1 / E-004)" at both the +24VDC source and the 0V return |
| **10** | **Title block/rev/notes/scale** | **7** | **6** | **-1**, smallest body text 6.4pt (the I-05 supersession footnote) — tied for the worst half-scale legibility margin in the set. This is the ONE sheet with an explicit "Drawn: MIRA / FactoryLM" label (no deduction there). |
| 11 | YAML-render consistency | 5 | 5 | I-00..I-05 + COM0 opc/function/healthy_state text verified verbatim against `terminals.yaml` |
| 12 | Unsupported assumptions | 5 | 5 | COM0 explicitly FIELD VERIFY + OI-02; spares explicitly "no field wire — OI-08" |

### E-006 — PLC Outputs — **97/100** (no HF)

| # | Category | Pts | Score | Deduction |
|---|---|---|---|---|
| 1 | Electrical truth & evidence | 15 | 15 | The hardwired-fallback-NOT-ACTIVE caveat (DO_03..DO_07 → GS10 DI1..DI5+DCM per WI-001, explicitly NOT drawn, with the specific reasons DO_07 doesn't exist on this PLC and DO_03 collides with PBRunLED) is a model example of adjudicating a conflict instead of hiding it |
| 2 | Technician readability | 12 | 11 | -1, the vertical "output return rail (E-006)" text runs close and parallel to the solid return-rail line it labels — not touching (confirmed, 0 collision hits), but visually tight |
| 3 | Approvability | 8 | 8 | Caveat box, safety box, notes, sources all present and specific |
| **4** | **Symbols & designations** | **8** | **7** | **-1, cat 4**, PL1/PL2 use the correct pilot-light convention (circle + X = crossed-filament lamp glyph); Q1's coil glyph (circle + small arc) is recognizable and clearly distinct from the pilot-light X, but is a step off the more textbook plain-circle NEMA coil symbol. Spare outputs (O-04..O-06) use the same hollow-circle convention as E-005's spare inputs — good cross-sheet consistency. |
| **5** | **Wire & terminal ID** | **10** | **10** | W600-W609 all flagged and correctly red; zero struck-text hits; O-00..O-06, +CM0/-CM0/+CM1/-CM1, PL1/PL2.X1/X2, Q1.A1/A2, S2.X1/X2 all verified against `terminals.yaml`/CROSSREF |
| **6** | **Power/ctrl/PE/safety separation** | **8** | **8** | Pure DO circuit family; explicit "Monitored outputs are NOT a safety function" / "Q1 drop path is the power-removal; verify it works" |
| 7 | PLC I/O presentation | 8 | 8 | Output grammar exactly mirrors E-005's input grammar (same dot/hollow-circle/dash conventions) — the rubric's "mirrored input/output grammar" requirement, met |
| 8 | VFD power presentation | 8 | 8 | Correctly states "GS10 control = Modbus (E-007), NO GS10 DI wiring" in the scope line — an explicit architectural statement that avoids exactly the OI-18 fallback-wiring trap this sheet's own caveat box describes |
| 9 | Cross-references | 6 | 6 | "poles on E-003" (bidirectional with E-003's "Q1 coil ← O-02 (E-006)"); "see E-007" for GS10 run/dir/freq |
| **10** | **Title block/rev/notes/scale** | **7** | **6** | **-1**, title-block "Drawn:" gap (set-level finding) |
| 11 | YAML-render consistency | 5 | 5 | O-00..O-03 + bank commons verified verbatim against `terminals.yaml`/`wires.yaml` |
| 12 | Unsupported assumptions | 5 | 5 | Spares explicitly "confirm no field wire — OI-12"; the +CM/-CM naming vs. "relay DO" conflict is flagged as OI-09, not silently resolved |

### E-007 — RS-485 / Modbus RTU — **97/100** (no HF)

| # | Category | Pts | Score | Deduction |
|---|---|---|---|---|
| 1 | Electrical truth & evidence | 15 | 15 | The whole sheet is a supersession-correction record (Channel 0→2, SGND pin 1/8→3, 8N2→8N1) with citations to CommsToVFD, Beginner_Verify_V2 p48, Prog_init v2.1, GS10_Integration_Guide.md; the 2026-05-20-export-vs-bench-sniff line-param conflict is flagged OI-20, not guessed |
| 2 | Technician readability | 12 | 12 | Troubleshooting block gives concrete diagnostic actions (swap 485+/485- if silent; CE10/F30 = comm timeout; 120Ω termination at long runs) |
| 3 | Approvability | 8 | 8 | Red caveat box up top: "CORRECTED from May-16 draft… Do not copy the old values" — exactly the honesty the rubric wants |
| **4** | **Symbols & designations** | **8** | **8** | PLC1/VFD1 boxes clearly labeled with real terminal names (D+(A)/D-(B)/SG/shield ↔ RJ45 pin5/pin4/pin3); shield/chassis termination uses a proper, recognizable earth glyph; 120Ω termination resistor drawn as a plain rectangle (an acceptable IEC-consistent resistor glyph) |
| **5** | **Wire & terminal ID** | **10** | **8** | **-2, cat 5**, the 485+/485-/SGND conductors each carry an on-sheet boxed mnemonic tag (correctly black/verified, confirmed `RGB(17,17,17)`) — but the field_verify **SH** (shield) conductor has **no on-sheet tag box at all**, only a connection-table row and a text caption. Every other field_verify conductor in the set (down to spare-adjacent W-numbers) gets a boxed red tag; SH breaks that pattern, a minor but real "every conductor carries a wire-number flag" gap. |
| **6** | **Power/ctrl/PE/safety separation** | **8** | **8** | Scope line explicitly reads "Modbus-only… NO FWD/REV/VI/ACM/FA" — a strong, explicit anti-scope-creep statement; shield ground uses a proper earth glyph with "land at PLC end ONLY; tape/float at GS10 end" |
| 7 | PLC I/O presentation | 8 | 8 | N/A, correctly no DI/DO grammar on a serial-comms sheet |
| 8 | VFD power presentation | 8 | 8 | N/A, correctly no VFD power content (deferred to E-003) |
| 9 | Cross-references | 6 | 6 | Self-contained; no dangling references |
| **10** | **Title block/rev/notes/scale** | **7** | **6** | **-1**, title-block "Drawn:" gap (set-level finding) |
| 11 | YAML-render consistency | 5 | 5 | Connection table + command words (register 0x2000, stop=1, fwd_run=18, rev_run=34-with-supersession-note) verified verbatim against `e007_rs485.yaml` |
| 12 | Unsupported assumptions | 5 | 5 | Shield chassis landing point explicitly field_verify; OI-20 line-param conflict explicitly left open |

---

## Designation census (cat 4 cross-cutting)

Device-tag family used across the set, from `CROSSREF_MATRIX.md` + on-sheet labels:

| Prefix | IEC 81346-2 class (per the adopted standards pack) | Devices | Consistent? |
|---|---|---|---|
| `S` | S — detects human action | S0 (e-stop), S2 (run PB), SS1 (selector) | Yes — all three are human-actuated devices under one letter, sub-disambiguated by full-name label (E-STOP/RUN/FWD-REV), not ad-hoc |
| `B` | B — picks up information | B1 (photo-eye) | Yes |
| `M` | M — mechanical movement | M1 (motor) | Yes |
| `PS` | G — controllable energy (power supply) | PS1 | Yes (NEMA-flavored "PS" over IEC "G", but internally consistent, never mixed) |
| `CB` | F/Q — protection/switching | CB1 (breaker) | Yes |
| `Q` | Q — controlled switching of energy | Q1 (contactor) | Yes, and correctly matches the pack's own §"IEC 81346-2 device class letter codes" table (Q1 = contactor, not a random letter) |
| `PL` | P — presents perceptible information | PL1, PL2 (pilot lights) | Yes |
| `X` | X — connects/interfaces | X1 (terminal block) | Yes |
| `PLC1` / `VFD1` | K / T | PLC1, VFD1 | Yes — plain-English tags for the two "smart" devices, distinct from the passive-device letter families, no collision |

No ad-hoc / invented tag families found. This is a hybrid NEMA-flavored / IEC-class-letter convention
(plain descriptive names, not IEC `=/+/-` aspect-prefixed tags) — a legitimate, documented choice for a
NEMA-market machine, applied with full internal consistency across all 5 sheets. Real strength.

## Wire-numbering convention audit (cat 5 cross-cutting)

`wires.yaml convention:` = `W[sheet-digit][line-2d]`, rails (`W24`, `W0V`) exempt, E-007 uses mnemonic
labels. Verified:
- E-003 → W300-W317 (sheet digit 3) ✓. E-005 → W500-W505 + W24/W0V exempt (sheet digit 5) ✓. E-006 →
  W600-W609 (sheet digit 6) ✓. E-007 → 485+/485-/SGND/SH mnemonic, exempt as documented ✓.
- The convention statement on E-001 is verbatim-identical to `wires.yaml`'s `convention:` string (checked
  character-for-character) — the key a technician relies on matches the source of truth exactly.
- One gap: SH (E-007) has no on-sheet tag at all (see E-007 cat-5 deduction above) — the ONE conductor in
  the drafted set that doesn't carry a visible flag on its own sheet.

## Set-level findings (order, consistency, print-scale — the bound PDF)

- **Order:** correct. Bound PDF page order is E-001, E-003, E-005, E-006, E-007 — ascending sheet number,
  with the undrafted stubs (E-002, E-004, E-008, E-009) correctly omitted from the bound set rather than
  included as blank/placeholder pages.
- **Frame/border consistency:** verified byte-identical across all 5 pages — outer frame rect
  `(30, 30, 1570, 1010)` pt on every sheet, inner accent rect `(40, 40, 1560, 1000)` pt on every sheet,
  zone-grid tick geometry pixel-identical between sheets spot-checked (E-001 vs. E-006).
- **Title-block consistency:** the title-block outer frame is at the **exact same rect**
  `(1120, 894, 1550, 990)` pt and the "SHEET" label sits at the **exact same bbox**
  `(1408.0, 905.4, 1434.7, 916.4)` pt on all 5 sheets — genuinely uniform placement, not just visually
  similar. Fields present on every sheet: sheet title, asset line, org line, a 4th free-text line, "SHEET" +
  sheet id, "REV A", date, "N of 9". All present, matches the rubric's required field list.
- **Title-block "Drawn:" gap (minor, set-level, affects 4 of 5 sheets):** the title block's 4th text line
  does double duty — on E-005 it explicitly reads `Drawn: MIRA / FactoryLM`; on E-001/E-003/E-006/E-007 that
  same slot instead holds a sheet-specific caveat/provenance string (`"cover generated from model/*.yaml"`,
  `"terminals per GS10 UM 1st Ed Rev B; …"`, `"output map CCW v4.0 + live Prog_init; …"`,
  `"recovers MIRA-WI-001 / Conv_Simple_CommsToVFD §2"`), with no explicit "Drawn:" label anywhere on those
  four sheets — a reader has to infer that the (also-present, unlabeled) "MIRA / FactoryLM" line one row up
  is the drawn-by attribution. Not HF-class (the information is present, just inconsistently labeled), but
  it is a genuine "uniform across the set" miss, deducted once per affected sheet under cat 10.
- **Print-scale / half-scale legibility:** all 5 sheets are pure vector (0 raster images on any page,
  confirmed via `page.get_images()`), so there is no rasterization/blur penalty at any print scale — a real
  strength. The limiting factor is font size: smallest body text ranges from 6.4pt (E-005 supersession
  footnote) to 7.6pt (E-007) across the set, on a sheet that is physically ~22.2×14.4 in at 100%. At full
  scale that is already at or below common engineering-drawing minimum lettering guidance (~2.3-2.5mm
  cap-height); printed at half-scale (a realistic field practice — a D/C-size drawing reduced to carry in a
  binder) the smallest footnotes would fall to roughly 1-1.2mm, effectively unreadable without magnification.
  Not HF-class on its own (nothing is clipped or struck), but a real cat-10 deduction applied set-wide, worst
  on E-003 (6.5pt) and E-005 (6.4pt). Recommend a minimum body-text floor of ~8-9pt in `render_sheet.py` for
  any text intended to survive half-scale reproduction.
- **Legend/line-style semantics — verified genuinely real, not just visually implied:** solid conductors are
  a single continuous vector path segment; dashed conductors are multiple discrete short segments on a fixed
  pitch (confirmed on E-003 and E-007, both with a ~contrasting solid/dashed pair on the same page); the
  legend's own "Wxxx" swatch renders in the same red `RGB(192,57,43)` it claims on all 5 sheets, and real
  proposed-wire tags (e.g. `W502`) match that exact RGB while verified mnemonic tags (e.g. `485+`) render
  `RGB(17,17,17)` near-black. This is a real strength worth stating plainly: the verified/field-verify
  encoding is not just a good idea in the legend, it is faithfully and consistently executed in the render.
- **Spare-terminal convention (minor, unscored observation):** hollow vs. filled terminal dot (spare vs.
  populated) is used consistently between E-005 and E-006, but is not itself listed in the LEGEND box (only
  line-style and the wire-number swatch are). It's self-evident in context (every hollow dot has adjacent
  "spare (no field wire — OI-xx)" text), so this is not scored as a deduction, but a legend entry would make
  it rigorous rather than inferred.

---

## Verdict

Per rubric: **NOT APPROVABLE.**

Two independent triggers, either one sufficient:
1. **Hard-fail HF5 on E-003** (7 confirmed instances of text struck by a line) — "Any hard-fail = package
   NOT APPROVABLE regardless of points."
2. **E-003 scores 83/100**, below the required ≥90 floor — "any reviewer score <90 on any sheet" also forces
   NOT APPROVABLE.

E-005 (99), E-006 (97), E-007 (97), and E-001 (95, scored for completeness though outside the rubric's
formal per-sheet scope) all clear the ≥90 bar comfortably and carry no hard-fails from this reviewer.
**The blocker is narrow and localized:** one rendering defect on one sheet (CB1/Q1 pole-label placement
colliding with the routed conductor) plus the set-wide title-block "Drawn:" labeling gap and the half-scale
font-floor concern. Nothing here is an evidence, safety, or contradiction problem — the underlying
engineering content is sound and unusually honest about what's verified vs. field-verify.

## Remaining fixes (priority order)

1. **(Blocks approval) Fix the E-003 CB1/Q1 pole-label collision.** Offset the `L1`/`L2`/`L3 (3φ)` terminal
   designation labels off the conductor centerline (or give them the same opaque-background treatment the
   wire-number tags already have) in `render_sheet.py`; re-render E-003 (PNG+SVG+PDF) and re-bind the PDF.
   Re-run the text/line collision check (or eyeball at ≥10x zoom) before resubmitting.
2. Add an explicit `Drawn:` label to the title block's 4th line on E-001, E-003, E-006, E-007 (or add a 5th
   line so the caveat/provenance text doesn't have to evict the drawn-by attribution).
3. Raise the minimum body/footnote text size (currently 6.4-6.8pt on several sheets) to protect half-scale
   legibility — target ≥8pt for anything not already large-format (titles, sheet IDs).
4. Give the E-007 `SH` (shield) conductor an on-sheet boxed tag matching every other field_verify conductor
   in the set, for wire-numbering-convention completeness.
5. (Optional, cosmetic, cat 4) Convert the E-001 Device Schedule's `Type` column from raw YAML snake_case
   (`e_stop`, `pushbutton_no`, …) to proper drafting nomenclature.

---

# V3.1 re-check (re-rendered 2026-07-11 00:41-00:42, same paths)

Re-ran the full text-vs-conductor collision scan (same method, stroke-width-buffered) on the re-bound
`CV-101_print_set.pdf`: **0 hits on all 5 sheets** — the 7 V3 HF5 instances are FIXED (CB1 row labels
moved left of conductors, M1 caption relocated; visually confirmed at 6-12x). Also ran a NEW
**text-vs-text** overlap scan (the validator's check L covers text/conductor only):

- **NEW HF5-class defect, E-003 (1 instance):** the relocated Q1-row `L1` label (bbox 306.7,329.4-316.0,340.5)
  now strikes the device-name line `Q1 — SAFETY POWER CONTACTOR (MC · 'MLC' in WI-001)` (overlap 3.3×7.6pt);
  confirmed visually at 12x — the closing paren and "L1" are superimposed, mutually unreadable. Introduced by
  the V3.1 label move. L2/L3 rows are clean.
- E-003 `PE`/`NOTES` bbox contact: glyphs clear at 12x — not a strike. E-005 `∓` actuator-glyph kiss under
  SS1 FWD/REV labels: pre-existing V3 geometry, intentional actuator-under-label, not a strike (unchanged stance).

**My fixes 2-5:**
- Fix 2 (Drawn:) — DONE on E-001/E-003/E-006/E-007. NEW minor regression: **E-005 title block now carries
  "Drawn: MIRA / FactoryLM" twice** (4th line + smaller 5th line).
- Fix 3 (fonts) — PARTIAL: 7.0pt strings raised to 7.2-7.5 (E-006 spare labels, E-007 120Ω note); smallest
  offenders unchanged (E-005 6.4pt supersession footnote, E-003 6.5pt "(FIELD VERIFY)" + 6.8pt annotations,
  E-006 6.7-6.8pt OPC/sources). Print reality: ~1.1mm at half-scale for those — full-scale legible, half-scale
  not. Deductions retained on E-003/E-005 only (consistent with V3 treatment).
- Fix 4 (SH tag) — DONE: red boxed `SH` tag (RGB 192,57,43) on the dashed shield conductor, matching set convention.
- Fix 5 (Type column) — PARTIAL: de-snake_cased ("e stop", "selector switch"…); "pushbutton no" reads as
  negation rather than N.O. Deduction reduced -2→-1.

Cross-confirmed other reviewers' fixes: Hz x10→x100 with citations (Prog_init v2.1:164, GS10_UM L15703-05);
OI-09 surfaced on E-006; port-location disclosure with FIELD VERIFY on E-007; both anti-spaghetti laws now in
the E-001 key.

## V3.1 final scores

| Sheet | V3 | V3.1 | Notes |
|---|---|---|---|
| E-001 | 95 | **97** | cat4 6→7 (Type de-slugged), cat10 6→7 (Drawn) |
| E-003 | 83 | **92** | cats 1/2/3/5/10 recover on collision fix; -2 cat2, -2 cat5, -1 cat10 for the NEW L1/device-name strike; -1 cat10 font floor |
| E-005 | 99 | **98** | -1 font (unchanged 6.4pt), -1 NEW duplicate Drawn line |
| E-006 | 97 | **98** | cat10 6→7 (Drawn) |
| E-007 | 97 | **100** | SH tagged (cat5 8→10), Drawn (cat10 6→7) |

**Remaining HF count: 1** (E-003 text-on-text strike, HF5 "overlapping/unreadable content", zero tolerance).

## V3.1 verdict: **NOT APPROVABLE**

All five sheets now clear the ≥90 floor (min = E-003 at 92), but one hard-fail remains. Still-open fixes:
1. **(Blocking)** E-003: move the Q1-row `L1` label clear of the Q1 device-name text (or shorten/wrap that
   line); extend validator check L to text-vs-text collisions so this class can't recur silently.
2. E-005: de-duplicate the title-block "Drawn:" line.
3. (Non-blocking, accepted-risk candidate) 6.4-6.8pt footnotes remain half-scale-illegible; either raise or
   record as a known limitation.
4. (Cosmetic) "pushbutton no" → "pushbutton N.O.".

One more render pass fixing #1 (+#2), with a text-text collision check added, should clear the package to
**APPROVABLE WITH FIELD VERIFICATION** from this reviewer's chair.

---

# V3.2 FINAL confirmation pass (re-rendered 2026-07-11, `C:\wt-phase0\plc\conv_simple_electrical\`)

**Role:** independent final-confirmation check on the V3.2 render. Did not assume the V3.1-tracked defect
was the only thing wrong — re-ran the full scan from scratch, on both artifacts, plus the validator itself.

## Validator run

`py -3 plc/conv_simple_electrical/validate_model.py` from `C:\wt-phase0`: **ALL 12 CHECKS PASS**, including
**L. Text/conductor collision** (now genuinely three-part: (a) conductor-segment-vs-text Liang-Barsky, (b)
text-vs-text bbox overlap >1px², (c) wire-flag-rect-vs-text — confirmed by reading the code, not just the
PASS line).

**Mutation-tested check L myself** (did not just trust the V3.2 changelog's claim), on scratch copies only —
confirmed the real repo SVG/PDF/PNG were untouched (`git status`/`git diff --stat` before and after):
- Reverted the Q1-row `L1` label onto the Q1 header's row (x=295,y=342, overlapping "Q1 — SAFETY POWER
  CONTACTOR…") → **check L(b) FAILS**, correctly names both strings, 36.5px² overlap. Reproduces the exact
  V3.1 fusion class.
- Reverted the CB1-row `L1` label onto the W300 conductor (x=344,y=228, straddling the dashed line at
  x=340) → **check L(a) FAILS**, correctly names `collides with conductor W300`. Reproduces the exact
  original V3 defect class.
Both mechanisms genuinely work, independently confirmed, not a vacuous pass.

## Independent geometric scan (my own implementation, PDF artifact, not a re-run of check L)

PyMuPDF against `sheets/CV-101_print_set.pdf`, real glyph-accurate span bboxes (not the SVG heuristic
formula) + every stroked vector segment on all 5 pages, deliberately **broader** than check L(a) (which is
scoped to `data-wire`-tagged segments only) — this scan includes device/symbol-glyph strokes and
table/box-border strokes too, specifically to hunt for defects outside check L's own scope. Only exclusion:
the two frame/border rects (30,30)-(1570,1010) / (40,40)-(1560,1000), byte-identical on all 5 sheets and
already established as intentional ANSI zone-tick geometry in the V3 pass — leaving them in produces 32
identical false hits per sheet (zone-tick digits straddling the border by design), which is inconsistent
with any prior pass's findings and would drown the real signal.

**Raw hit counts: text-vs-conductor = 6 (E-003: 4, E-006: 2), text-vs-text = 26 (5-6 per sheet, all
sheets).** Adjudicated every text-vs-conductor hit by eye at high zoom in BOTH the PDF and the standalone
PNG; sampled text-vs-text hits across the full size range (2.8-93.2px²) and every distinct visual pattern
found:

| Hit | Verdict | Why |
|---|---|---|
| E-003 "NOTES" × 2 segments | **REAL — HF5** | see below |
| E-003 footnote citation × 1 segment | **REAL — HF5** | see below |
| E-003 "MC placement…" caveat vs title-block cell rule | False positive | visually clean, real whitespace gap; bbox heuristic edge-graze only (title-block cell text sitting normally above its own cell border) |
| E-006 "CONNECTION TABLE" heading × 2 segments (table's own top/left border) | False positive | visually clean, real whitespace gap; heading sits normally above the table it labels |
| ALL 26 text-vs-text hits (sampled: SHEET/sheet-id title-block stack ×1 representative, E-001 "LINE-STYLE LEGEND"/"LEGEND" 2-line heading, E-006 "FAULT/E-STOP"/"Q1 COIL" caption/label stack, E-003 "+1/+2"/wrapped-description, pre-adjudicated E-005 `∓` actuator kiss) | False positives | universally the same pattern: a short bold label/mnemonic stacked tightly above a wrapped description or smaller caption above a larger value — full font ascent/descent bounding boxes graze by a few pt² at the shared baseline, but the rendered ink never touches. Confirmed legible at high zoom in every sampled case. Same class the V3 predecessor already excluded for the E-005 `∓` graze. |

## NEW confirmed HF5 — 2 instances, both E-003, both OUTSIDE check L(a)'s scope

**Not** the V3.1-tracked defect (that one is cleared — see below). These are different locations, found by
this pass's broader scan, invisible to check L(a) because check L(a) only inspects `data-wire`-tagged
conductor segments — neither of these two strikes is a conductor; one is a symbol-glyph stroke, one is a
table-border stroke. Confirmed in **both** the bound PDF and the standalone PNG (not a PDF-only artifact).

1. **"NOTES" section heading struck by the PE earth-ground symbol's own glyph strokes.** The PE bus's real
   terminus (a genuine routed dashed field_verify conductor, not a decorative legend swatch — it arrives
   from the upper-left and lands on this earth glyph) is positioned so close to the "NOTES" heading directly
   below it that the earth symbol's two lower horizontal bars strike straight through "OTE" — reads as a
   strikethrough. text bbox (680.0,809.8)-(712.7,822.9); struck by segments (690,811)-(710,811) and
   (695,815)-(705,815), stroke width 1.6, color `#111111`. Visually unambiguous at 5-10x zoom in both the
   PDF and `E-003_vfd_power.png`.
2. **Connection-table citation text struck by the table's own right-border rule.** The rightmost
   annotation-column text "…route power ⊥ control wiring — GS10_UM.txt L1787" (bbox
   (1435.5,341.3)-(1556.3,351.2)) overflows its column and the final digit of "L1787" is bisected by the
   table's vertical border line at x=1555 (segment (1555,334)-(1555,356), width 0.7, color `#111111`).
   Confirmed at 16x zoom in both artifacts — the "7" is visibly split by the rule.

Both are genuine per rubric HF5 ("any text struck by a line" — no exception for what kind of line), present
in the actual delivered PDF/PNG, and were not reported by V3 or V3.1. Whether they are pre-existing misses
(their originating conductor/table-border strokes are not `data-wire`-tagged, so no prior scan scoped to
conductors would have caught them) or a side effect of the V3.2 changes is not established either way — not
material to a confirmation pass; what matters is current-state truth.

## V3.1-tracked defect: CONFIRMED CLEARED

The Q1-row `L1` label vs. the Q1 device-name line ("Q1 — SAFETY POWER CONTACTOR (MC/'MLC' — WI-001)"):
header now sits on its own row (y=332.9-344.6, ends x=290.0) and the shortened header + relocated pole-label
row (y=353.4-364.5) no longer share a y-band at all — 8.8pt full vertical clearance, confirmed by exact word
coordinates from the PDF and visually at 10-16x zoom (both a full-zone crop and a tight crop dead-centered on
the old collision point). The original V3 7-instance CB1/Q1-vs-conductor strike is also independently
reconfirmed clear (visual: labels sit in open space left of each pole, clean; geometric: my broader PDF scan
found zero hits in that zone, cross-confirming check L(a)'s PASS via a second, independently-implemented
method on a different artifact).

## Other V3.2 claims checked

- **E-005 duplicate "Drawn:" — CONFIRMED FIXED.** Exact string search across the bound PDF: "Drawn:" appears
  **exactly once per sheet**, at the identical bbox (1132.0,948.3)-(1160.5,960.7), on all 5 sheets. (E-006
  also contains the substring "drawn:" lowercase at an unrelated location, y=214.7 — that's mid-sentence
  English in the hardwired-fallback caveat ("…is NOT ACTIVE and NOT drawn: P02.0x at factory default…"), not
  a title-block field; not a duplicate, not a regression.)
- **E-001 Type column "(NO)" rendering — CONFIRMED.** S2 row renders `pushbutton (NO)` cleanly (words at
  x=127.0 "pushbutton" + x=164.6 "(NO)", same baseline, unambiguous parenthetical, not read as negation).
  Spot-checked the rest of the column too (`e stop`, `selector switch`, `photo eye`, `power supply`,
  `circuit breaker`, `pilot light`, `terminal block` — all de-snake_cased, no raw slugs remaining). This
  fully clears V3.1's residual -1 (cat 4) that was specifically about the "pushbutton no" ambiguity.
- **Font floor ("6.4-6.8pt raised to ≥7.2") — PARTIALLY true, correcting the claim.** Measured every
  `font-size` attribute directly: E-003 min is now **7.0pt** (was 6.5), E-005 min is now **7.0pt** (was
  6.4) — both improved but neither actually reached the claimed 7.2 floor (2 strings each still at 7.0).
  E-006 remains at 6.7pt (19 strings <7.2) and E-007 at 6.8pt (1 string) — unchanged, and never claimed to
  be touched. Not HF-class (nothing clipped/struck by this alone), kept as a cat-10 deduction at the same
  flat weight prior passes used.

## V3.2 FINAL per-sheet scores

| Sheet | V3.1 | V3.2 FINAL | What changed |
|---|---|---|---|
| E-001 | 97 | **98** | cat4 7→8 (full recovery — "(NO)" ambiguity fully resolved, not just partial) |
| E-003 | 92 | **89** | cat5 8→10 (full recovery, terminal-label strike class fully gone) and cat1/2/3/9/10 net down: 2 NEW confirmed HF5 instances (NOTES-vs-PE-glyph, footnote-vs-table-border) replace the old defect class. **Still HF-flagged; still <90.** |
| E-005 | 98 | **99** | duplicate "Drawn:" fix confirmed clean (font floor deduction retained, now 7.0pt not 6.4pt but still sub-target) |
| E-006 | 98 | **98** | no material change (2 scan hits, both confirmed false positives) |
| E-007 | 100 | **100** | no material change |

E-003 detail (14+10+6+7+10+8+8+8+5+3+5+5 = 89): cat1=14(-1, struck citation nudges confidence), cat2=10(-2,
struck NOTES undermines the 3-second/caveat read), cat3=6(-2, two separate struck-text instances, not one),
cat4=7(unchanged), cat5=10(full recovery), cat6-8=8/8/8(unaffected), cat9=5(-1, the struck text is literally
a source line-number citation), cat10=3(-3 for two HF5 instances in this category's own domain, -1 font
floor still short of target), cat11=5, cat12=5.

## V3.2 FINAL verdict: **NOT APPROVABLE**

**HF5 is NOT cleared.** The V3.1-tracked instance (Q1-row `L1` vs. device-name) is genuinely fixed — but
this pass's broader independent scan (deliberately wider than check L(a)'s `data-wire` scope) found **2 new
confirmed HF5 instances**, both on E-003, both real in the delivered PDF and PNG: the "NOTES" heading struck
by the PE earth-glyph's own strokes, and a connection-table citation's last digit bisected by the table's
right-border rule. E-003 also independently falls below the ≥90 floor again (89/100) — two triggers, either
sufficient. E-001 (98), E-005 (99), E-006 (98), E-007 (100) all clear comfortably and carry no hard-fails.

**Fixes needed before the next pass:**
1. **(Blocking)** Move the PE earth-glyph (or the NOTES heading) so the symbol's bars clear "NOTES" —
   they're on the same routed-PE-bus-terminus-meets-footer collision, not the pole-label class.
2. **(Blocking)** Widen the connection table's rightmost citation column (or wrap/shorten the "…GS10_UM.txt
   L1787" string) so it stops overflowing into the table's own border rule.
3. **Extend check L again**, this time beyond `data-wire`: add device/symbol-glyph strokes and table/box
   border strokes as obstacles, the same way flag rects were added in V3.2. Both new defects would have been
   invisible to check L(a) forever without this — the scope gap, not a math bug, is the reason a PASS
   coexisted with 2 real strikes. (Mutation-tested both existing branches myself this pass — the math is
   solid; the gap is purely what check L(a) is allowed to look at.)
4. (Non-blocking) E-003/E-005 font floor: raise the 2 remaining 7.0pt strings on each sheet to the claimed
   ≥7.2, or correct the changelog claim.
5. (Optional) E-006/E-007 have smaller minimum fonts (6.7pt/6.8pt) than the sheets that keep getting the
   font-floor deduction — worth a consistent pass across all 5 sheets rather than continuing to single out
   E-003/E-005.

---

# V3.3 FINAL confirmation pass (re-rendered 2026-07-11, `C:\wt-phase0\plc\conv_simple_electrical\`)

**Role:** final confirmation on the V3.3 render. Fresh independent PDF-based scan (own implementation, not
a re-run of check L), visual verification of both tracked HF5 zones + the L3 label move at high zoom in
both artifacts, own run of the validator, and — since the two prior confirmed-clear claims in this thread
(V3.1's collision fix, V3.2's HF5 clearance) both later turned out to have gaps — an independent mutation
test of check L(a) rather than trusting the changelog's "mutation-tested" claim at face value.

## Validator run

`py -3 plc/conv_simple_electrical/validate_model.py` from `C:\wt-phase0`: **ALL 12 CHECKS PASS**, including
**L. Text/conductor collision**.

**Mutation-tested check L(a) myself** (scratch copies of the SVG only; confirmed via `git status`/`git diff
--stat` before and after that the real repo tree was untouched — diff-stat identical pre/post):
- Reintroduced the NOTES-vs-PE-glyph defect (moved the `NOTES` heading to x=695,y=810, back into the earth
  glyph's bar footprint x=684-716/y=807,811) → **check L(a) FAILS**, 3 errors, correctly naming `NOTES` vs.
  both earth-glyph bar lines and the glyph's vertical stem. (First attempt, y-shift only with x unchanged
  at 740, produced 0 errors — informative, not a bug: V3.3's real fix moved NOTES in **both** x and y, so
  the heading no longer shares any x-range with the glyph at all, a more robust fix than a minimal
  y-margin nudge would have been.)
- Reintroduced the citation-vs-table-border overflow (shoved the citation text 60pt right) → **check L(a)
  FAILS**, 3 errors, correctly naming the citation text vs. the connection-table's own cell rect edge
  `(800,334 755x22)` plus the frame rects. Both mechanisms genuinely fire; not a vacuous pass.

## Independent geometric scan (fresh implementation, PDF artifact)

Own PyMuPDF script against `sheets/CV-101_print_set.pdf`: glyph-accurate text spans (`get_text("dict")`,
per-character verified via `rawdict` where needed) + every vector-drawing primitive (`get_drawings()` —
`l`/`re`/`c`/`qu` items, not just `data-wire` conductors) on all 5 pages, Liang-Barsky segment-vs-box
(own re-implementation) for text-vs-stroke, bbox-overlap >1px² for text-vs-text. Rotated spans (1 found,
E-006's "output return rail (E-006)") excluded from the stroke check only, per the same rationale check L
uses, and separately visually confirmed (see below). Frame/border rects `(30,30)-(1570,1010)` and
`(40,40)-(1560,1000)` re-verified byte-identical to the V3.2-documented coordinates on all 5 pages before
exclusion (not assumed).

**Raw hit counts: text-vs-stroke = 8 (all E-006), text-vs-text = 28 (2-12 per sheet, all 5 sheets). E-003:
zero hits of either kind.**

| Hit class | Count | Verdict | Why |
|---|---|---|---|
| E-006 coil glyph: `⌒` arc + `A1`/`A2` terminal labels vs. curve-segs | 6 | False positive | Visually confirmed at 14x: the arc is the coil symbol's own decorative flourish nested inside the circle (not informational text); A1/A2 sit with clear whitespace below the circle. My crude control-polygon approximation of the true bezier curve (connects raw control points, which the real curve doesn't pass through) overestimates the curve's footprint — a limitation of my own scan, not a rendering defect. |
| E-006 "CONNECTION TABLE" heading vs. an unrelated large box's bottom-edge rule (150,170)-(430,750) | 2 | False positive — but the closest call this pass | Rigorous per-column pixel scan (30x-render, threshold-crossing) across the full heading width found a **positive real gap everywhere**, minimum **0.2pt** at one point under the "A" in TABLE (extreme-zoom crop confirms clean whitespace at that exact point). A medium-zoom (14x) crop initially looked like fusion, but that was the vertical zone-furniture tick line (which legitimately T-junctions the horizontal border by design) sitting almost exactly at the "B" glyph's x-position, not text-to-line contact. Not HF-class, but flagged here since 0.2pt is a thin margin. |
| Text-vs-text, all 28 (title-block `SHEET`/sheet-id ×5, E-001 legend 2-line heading, E-003 `+1/+2`/`B1/B2`/`DC+/DC-` wrapped-caption chains + `SOURCES:` wrap, E-005 `∓` actuator kiss ×2 [pre-adjudicated] + `FWD contact`/`SS1 REV` + 6× `I-0x`/OPC-caption stack + `SOURCES:` wrap, E-006 `FAULT/E-STOP`/`Q1 COIL` + title-block wrap, E-007 wrapped "…at the drive end") | 28 | False positive | Same class V3.2 already established: short bold label/mnemonic stacked directly above/below a wrapped continuation or adjacent-row caption — full font ascent/descent bbox grazes at the shared line pitch, real ink never touches. Spot-verified at high zoom: `FWD contact`/`SS1 REV` (E-005), `FAULT/E-STOP`/`Q1 COIL` (E-006), the rotated rail label (E-006, confirmed it genuinely parallels its rail with a real gap along its full length, not just at the ends). |
| Zone-tick ruler digits vs. frame border rects (excluded from the table above; checked separately) | 84 (16-20/sheet, all 5 sheets, unchanged) | False positive, re-confirmed | Re-ran the scan WITHOUT the frame-rect exclusion specifically to test this. `render_sheet.py:338` even carries a code comment recording the deliberate tuning ("an fs-8 bbox crosses the inner frame edge" → shipped at fs=7). Visually confirmed at 12x: real ~1pt whitespace on both sides of the digit. Font-bbox ascender padding (generous even for digits with no actual ascender ink) causes my glyph-bbox method to register a technical overlap the real ink never reaches. Identical, unchanged across all 5 sheets — pre-existing intentional zone-grid geometry, same conclusion two prior independent reviewers already reached. |

**Zero real hits. Zero new HF5-class defects found anywhere in the package.**

## Both tracked HF5s: CONFIRMED CLEARED

Visually verified at high zoom in **both** the bound PDF and the standalone PNG (`E-003_vfd_power.png`):

1. **"NOTES" vs. PE earth-glyph** — the glyph's terminus (dot, stem, 3 bars) now sits with a full clear
   text-line of whitespace above "NOTES"; "PE" labels the glyph on its own row. No contact at any zoom.
2. **Connection-table citation vs. border rule** — "…GS10_UM.txt L1787", full string including the final
   "7", sits entirely inside its cell with visible clearance before the right border. No contact.

## L3 pole-label move + contactor-arm fix: CONFIRMED

Cropped and visually inspected both the CB1 row (breaker, blade+X glyph) and the Q1 row (contactor, plain
blade) at 10x. On both rows: `L1`/`L2` sit left of their conductors in open whitespace; `L3 (3φ)` — the
former collision point — now sits to the **right** of its (rightmost) pole/conductor, also in open
whitespace, clear of the pole glyph, the contactor arm, and the wire-tag boxes above. Matches the "rightmost
pole labels now right-side" claim exactly; the original V3 7-instance strike class and the V3.1 Q1-row
fusion class are both independently reconfirmed clear (this pass found zero stroke hits anywhere on E-003).

## V3.3 FINAL per-sheet scores

| Sheet | V3.2 | V3.3 FINAL | What changed |
|---|---|---|---|
| E-001 | 98 | **98** | No material change — 2 scan hits, both re-confirmed established FP (title-block stack, legend heading). |
| E-003 | 89 | **98** | Both HF5s confirmed cleared, zero new real defects. cat1 14→15, cat2 10→12, cat3 6→8, cat9 5→6, cat10 3→6 (HF5 penalty removed, -1 font-floor retained: min font still 7.0pt, 20 strings <7.2pt, unchanged by this pass's scope). cat4-8,11,12 unchanged. |
| E-005 | 99 | **99** | No material change — 12 scan hits, all re-confirmed established FP. |
| E-006 | 98 | **98** | No material change — 8 stroke + 3 text hits, all re-confirmed FP (closest call: CONNECTION TABLE heading, real min gap 0.2pt, not a strike). |
| E-007 | 100 | **100** | No material change — 2 scan hits, both re-confirmed established FP. |

E-003 detail (15+12+8+7+10+8+8+8+6+6+5+5 = 98): cat1=15 (citation no longer struck), cat2=12 (NOTES no
longer struck, meter-lead walk now unambiguous), cat3=8 (nothing left requiring verbal explanation),
cat4=7 (unchanged — breaker blade+X vs. contactor plain-blade distinction, minor), cat5=10 (unchanged,
full recovery already reached V3.1), cat6-8=8/8/8 (unaffected), cat9=6 (citation no longer struck),
cat10=6 (HF5 penalty removed; -1 retained for the still-unraised font floor), cat11=5, cat12=5.

## V3.3 FINAL verdict: **APPROVABLE WITH FIELD VERIFICATION**

**Zero hard-fails.** Both HF5 triggers from V3.2 are genuinely cleared (confirmed independently: scan,
visual in 2 artifacts, and a from-scratch mutation test proving check L(a) still catches both defect
classes if reintroduced). This pass's broader scan found 36 raw geometric hits across all 5 sheets and
adjudicated every one — including the closest call (a 0.2pt real gap on E-006) via rigorous per-column
pixel measurement, not just eyeballing — and every hit resolves to an already-established or newly-verified
false-positive class. No new HF-class defect anywhere.

**All five sheets clear the ≥90 floor** (minimum 98, tied E-001/E-003/E-006). Per `review/GRADING_RUBRIC.md`,
full **APPROVABLE** is explicitly not available while supply voltage/phase, GS10 frame, breaker rating, and
wire gauge remain undocumented — but every one of those is honestly marked FIELD VERIFY, tracked in
`model/open_items.yaml` (`sheet_ref: E-009`, 20 items), and referenced from E-001's sheet index, exactly
matching the rubric's **APPROVABLE WITH FIELD VERIFICATION** precondition. This is the first pass in this
reviewer's thread (V3 → V3.1 → V3.2 → V3.3) to clear all blocking conditions.

**Non-blocking, carried forward (unchanged, not this pass's scope):**
1. E-003/E-005 minimum font still 7.0pt (target was ≥7.2pt per the V3.2 changelog claim); E-006/E-007
   remain lower still (6.7/6.8pt) and were never targeted. Cosmetic legibility-at-half-scale concern, not
   HF-class.
2. E-006 "CONNECTION TABLE" heading clears its neighboring box-edge by as little as 0.2pt at one point —
   real, not struck, but thin enough that a future re-render touching that box or that heading's position
   should re-check it specifically.
