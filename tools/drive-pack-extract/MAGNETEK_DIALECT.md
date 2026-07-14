# Magnetek IMPULSE manual dialect — the durable extractor spec (Run B)

Source of truth for `magnetek_dialect.py`. Compiled 2026-07-14 from two
independent Sonnet inspections of the official **IMPULSE G+ Mini Technical
Manual** (144-25085, Nov 2020, sha256 `56075883…d00be`, 182 pp) **plus
geometry spikes against the embedded text layer** — which falsified two
visual-inspection claims (see “Corrections” below). PDF page number ==
printed page number (no offset). Footer on every page:
`IMPULSE®•G+ Mini Technical Manual / November 2020 / Page NNN` (renders below
y≈735 — excluded as bleed).

## Fault table (G+ Mini pp.135–140)

- **3 columns**: `Fault | Fault or Indicator Name/Description | Corrective
  Action`. Header **repeats on every page** of the table.
- **Row separation**: full-width horizontal rules (`page.rects`, width ≈504pt).
  There are **no vertical rules** — pdfplumber `extract_tables()` finds
  nothing; parse by row-rects × column x-bands.
- **Headers are CENTERED over their columns; cells are left-aligned** — header
  word x0s are NOT band edges (the ‘Corrective’ header sits ~70pt right of the
  action cell’s left edge). Real boundaries: the description column is the
  occupied x-interval holding the most words; the action column starts at the
  leftmost numbered-step token (`1.`, `2.` …).
- **Identifiers are mnemonics, casing is semantic** (75 distinct codes):
  `bb`, `rr`, `oC`, `oH`/`oH1..4`, `oL1/2/8`, `oV`(×2: plain + flashing),
  `oPE01..23`, `CoF`, `CPF02..24`, `CE`, `CF`, `CALL`, `CRST`, `dnE`, `EF`,
  `EF0..7`, `GF`, `Hbb`, `LC`, **`LC dn`** (two tokens, one space), `LF`,
  `LL1/2`, `MNT`, `OT1/2`, `PF`, `UL1..3`, `UT1/2`, **`Uv`**, `Uv1..3`,
  `BE0/4/5`, `MNT`. `Uv` ≠ `UV`; `oC` ≠ `OC` ≠ `0C`; `bb` ≠ `BB`.
- **Confusable glyph classes** (flag, never normalize): `o/O/0`, `l/I/1`,
  `v/V`, `b/B`, `r/R`. Extraction preserves the text layer verbatim and emits
  `ambiguous_glyphs` per entry.
- **Left cell structure**: code line, optional `(flashing)` marker line,
  optional secondary display label line(s) (`Base Block`, `LC Done`, `Over
  Current`). ⚠️ `LC Done` LOOKS like a two-token code — a two-token identifier
  is only valid when the second token is ≤2 chars lowercase (`LC dn`);
  anything else is a display label (first live run fabricated `LC Done`).
- **Multi-code cells**: `CPF18 and CPF19` / `CPF20 and CPF21` share one
  description/action. The `and` conjunction renders 4pt right of the code
  tokens (its own x-interval!) and the partner code may sit PAST the next
  horizontal rule — handle `…-and` continuation across row spans.
- **A ruled span can hold several logical rows** (no rule between `oH1`/`oH2`
  and `oH3`/`oH4`): every code-parsing left line anchors a sub-row;
  description/action lines attach to the nearest anchor at-or-above.
- **Corrective actions** are numbered flat lists; they cross-reference dotted
  parameters (`Check H01.01 through H01.07`, `(U01.10)`) → captured as
  `references_parameters` (fault→param), never emitted as parameter defs.
- **Fault vs alarm**: same namespace; `(flashing)` is indicator behavior
  metadata, not a namespace split. Extract all pp.135–140 rows as one corpus
  with the `flashing` flag.

## Parameter listing (G+ Mini pp.144–173, “Appendix A: Parameter Listing”)

- **6 columns, header repeats per page**:
  `Parameter | Parameter Name | Default | Range | Units | Page`.
- **Identifiers are dotted**: `[A-Za-z]\d{2}\.\d{2}` — prefixes A B C D E F H
  L N O T U (12 groups, ~458 rows incl. U-group).
- **Ranges**: en-dash (`0.00–150.00`), tilde (`0000~0001`), hex (`00–1F`),
  comma-enumerated (`00, 02`), negatives (`–200.0–0.0`). PRESERVE VERBATIM —
  no PowerFlex `lo/hi` split.
- **Defaults**: numeric, hex, `–`, footnote-starred (`0.00*`, up to `****`;
  legend on p.173). Preserve verbatim.
- **Units**: `-` / `–` → None; otherwise verbatim (`Hz`, `%`, `sec`, …).
- **Enum meanings** render as sub-lines under their parameter
  (`00: Digital Reference Only`, `0F: Not Used`), sometimes with a trailing
  manual page int — accumulate as `value_meanings` of the open row.
- **Trailing `Page` column is the manual’s own cross-reference** — the
  citation page is the PDF page the row was read on, never that column.
- **Geometry**: parameter/name boundary = first whitespace channel;
  Default/Range/Units/Page cells are short and sit under their centered
  headers → nearest-header-center assignment on the right side.
- **Citation excerpt = the row’s first physical line only** (a joined
  multi-line string fails the verbatim cite gate).
- **Description prose (pp.42–127) is NOT extracted** — ids there are
  navigation/context (`set H01.01 to 5`), not definitions. The per-page
  listing header is the gate.
- **Grouped-range rows are DELIBERATELY skipped** (`F07.23 to F07.32 DOA116
  (1 to 10)`, `F07.33 to F07.42 …`, p.154): one row defines 10 instances that
  cannot be attributed per-id — skipped with a loud log line, same
  precision-over-recall posture as the PowerFlex comma-group skip. Known
  limitation, surfaced by adversarial verification (Run B).
- **The trailing Page column may be a dash** (`L03.20`, `N02.04`, `T01.05`) —
  a legitimate "no cross-reference"; the row still extracts
  (`manual_page_ref=None`).
- **p.173 gotcha**: the footnote-legend paragraphs bridge the id/name
  whitespace channel — the id/name boundary must come from the per-line
  dotted-id token, never from page-wide occupied intervals.

## Explicitly out of scope

| What | Where | Why |
|---|---|---|
| Auto-tune faults `Er-01..12`, `End 1..3` | p.141 | own namespace under a DIFFERENT header (`Fault Display`) — Run C decision whether to carry |
| U-group fault-trace/history/maintenance/monitor tables | pp.129–133 | monitor read-backs (`Monitor|Name|Function|Units` headers), not fault defs |
| Symptom / maintenance-checklist tables | p.134 | 2-col guidance, no codes |
| Power-section / braking checks | pp.142–143 | test procedures |
| X-Press lookup matrices, Modbus register maps | pp.44–45, appendix | not parameter definitions |

## Corrections to the visual inspections (spike-verified against the text layer)

1. The fault header **is repeated on every page** (inspector claimed p.135
   only). `extract_text()` shows it on 136–140.
2. The flashing undervoltage code is **`Uv`**, not `UV` — the text layer is
   authoritative; the “UV” reading was itself the o/O-class visual misread
   this dialect flags.
3. Fault-table “ruled table with cell borders” is **horizontal rules only**.

## Representation contract (Run B — candidate layer only)

- Mnemonic faults: `code=None`, `fault_id=<verbatim string>` →
  `fault_entries[]` in the candidate pack (extra top-level key; the runtime
  loader tolerates and ignores it). `live_decode.fault_codes` stays `{}` —
  **no invented integers**. This is the preserved evidence for the Run C
  schema decision; nothing is promoted to runtime or `gold/`.
- Parameters fit the existing `ParameterCard` (string ids) unchanged.

## Technician confirmations (2026-07-14)

Crane-application semantics confirmed by the owner/technician live in
`candidates/magnetek_impulse_g_plus_mini/TECHNICIAN_CONFIRMATIONS.json`
(sidecar overlay — `pack.json` stays deterministic extractor output and is
never hand-edited):

- **LL1/LL2 are axis-dependent** (CONFIRMED): on a hoist drive they are the
  hoist **lower limit** (LL1 slow-down, LL2 stop); on a traverse drive
  (trolley/bridge) the same inputs are **travel / end-of-travel limits**. Any
  answer surface must establish the motion (hoist vs traverse) before naming
  the limit — and never advise bypassing a limit input.
- **UL1–UL3 symmetry** is PROPOSED only — not confirmed; do not assert it.

The overlay-merge mechanism + `technician_confirmed` provenance tier are Run C
scope (`RUN_C_PLAN.md` item 6).
