# CV-101 Electrical Print Package — Grading Rubric (100 points/sheet)

Applies to every drafted sheet (E-003, E-005, E-006, E-007) independently. Graders score all 12
categories; each reviewer role also carries a designated deep-dive (below). Scores are per sheet;
the package score is the minimum sheet score. **Any hard-fail = package NOT APPROVABLE regardless
of points.**

## Hard-fail conditions (auto-fail, zero tolerance)

HF1. An invented terminal, wire, device, relay contact, protection device, voltage, conductor
     size, color, or safety function — anything drawn/stated with no backing in the model YAML or
     a cited source.
HF2. A conductor rendered visually SOLID (in the PNG **and** PDF, not just the SVG) whose model
     status is not `verified` with two known endpoints + recorded evidence/source.
HF3. An ambiguous protective-earth or safety connection (PE that can be misread, a safety
     function implied but not stated, an e-stop path drawn as if it removes power without
     evidence).
HF4. A contradiction between YAML, PLC logic, OEM documentation, prior source drawings, and the
     rendered sheets that the sheet does not explicitly acknowledge/adjudicate. (A documented
     supersession WITH the supersession note is not a contradiction — it is required honesty.)
HF5. Clipped, overlapping, unreadable, or off-frame content (any element outside the border, any
     text struck by a line, any table row cut off).
HF6. Engineering information present only in the render (renderer source code) with no model
     (YAML) backing — the render may layout/abbreviate, never originate facts.

## Categories (points)

| # | Category | Pts | Measurable checks |
|---|---|---|---|
| 1 | Electrical truth & evidence | 15 | Every drawn element traces to a model row; every `verified` claim carries a source cite reachable from the sheet (SOURCES block or table); no unacknowledged conflict with OEM manual / PLC program / recovered art. |
| 2 | Technician troubleshooting readability | 12 | The §6 meter-lead walk (style law) completes for the sheet's main circuit without ambiguity; 3-second orientation (title/scope line says what/where); flow direction obvious; a tech knows where to put leads and what reading to expect (or that it's FIELD VERIFY). |
| 3 | Maintenance-engineer approvability | 8 | A plant engineer could sign it: scope note, revision/date, open-items pointers, honesty boxes; nothing requiring verbal explanation. |
| 4 | Standard symbols & reference designations | 8 | Glyphs recognizable against IEC 60617/NEMA practice (contactor poles, coil, pilot light, breaker, motor, earth); device tags consistent (Q/CB/PL/S/SS/B/M/PS/X families); no ad-hoc shapes for standard devices. |
| 5 | Wire & terminal identification | 10 | Every conductor carries a wire-number flag; flags legible (opaque background, not bisected); both endpoints labeled with REAL terminal ids matching terminals.yaml; numbering scheme consistent and sheet-mappable (law §2 rule 8). |
| 6 | Power / control / grounding / safety separation | 8 | One circuit family per sheet; PE visually distinct + orthogonal; safety-relevant paths distinguishable from status/indication; no cross-family content beyond explicit cross-references. |
| 7 | PLC I/O presentation | 8 | Rung convention consistent between E-005 and E-006 (mirrored input/output grammar); commons/banks explicit terminals; OPC variable names shown; spares marked with their open item. |
| 8 | VFD power & control presentation | 8 | Line/load orientation conventional (supply top/left → motor bottom/right); GS10 terminals verbatim (`R/L1…`, `U/T1…`); aux terminals (+1/+2, B1/B2, DC+/DC-) shown WITH state (jumpered/open); control-source statement correct (Modbus, P00.20/P00.21) and owned by the right sheet. |
| 9 | Cross-references & continuation markers | 6 | Off-sheet arrows/notes name the destination sheet (E-002/E-004/E-006/E-007); coil↔poles split across sheets is bidirectionally cross-referenced; no dangling reference. |
| 10 | Title block, revision, notes, print-scale readability | 7 | Complete title block (sheet id, title, project/asset, rev, date, drawn-by, N of 9), zone grid, legend; all text legible at 100% zoom; nothing outside frame. |
| 11 | YAML-to-render consistency | 5 | Rendered content == model content (spot-check ≥5 facts/sheet); abbreviations in tables lossless or recoverable; validator's SVG audit passes AND the PNG/PDF visually match the SVG's solid/dash semantics. |
| 12 | Absence of unsupported assumptions | 5 | Every unknown marked FIELD VERIFY; every proposed id labeled proposed; honesty/caveat boxes present where the model says so; no confident tone about unverified facts. |

**Deduction discipline:** list every deduction as `-N pts, category, element, location, reason`.
No vague deductions. If a defect is HF-class, mark it HF (not a deduction).

## Reviewer roles (all score everything; each deep-dives its focus)

- **Industrial maintenance technician** — deep-dive categories 2, 5, 7, 9 (can I fix the machine
  at 2am with this print and a meter?).
- **Controls engineer** — deep-dive 1, 7, 8, 9, 11 (does the drawing match the program, the
  drive config, and the physics?).
- **Electrical drafting standards** — deep-dive 4, 5, 6, 10 (IEC/NFPA79/UL508A drawing practice,
  symbol correctness, layout discipline).
- **Evidence & hallucination auditor** — deep-dive 1, 11, 12 + ALL hard-fails (hunt invented
  details; verify every claim's cite actually exists; diff YAML↔SVG↔PNG semantics).

## Verdict rules

- **APPROVABLE** — no hard-fails; every reviewer ≥90 on every sheet; zero FIELD-VERIFY items
  blocking safe energization documented as resolved. (Not achievable while supply/model/breaker
  facts are undocumented — do not force it.)
- **APPROVABLE WITH FIELD VERIFICATION** — no hard-fails; every reviewer ≥90 on every sheet; all
  remaining unknowns explicitly FIELD-VERIFY + present in open_items.yaml + on E-009's docket.
- **NOT APPROVABLE** — any hard-fail or any reviewer score <90 on any sheet.
