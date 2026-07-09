# PowerFlex 40 pack — provenance

**Status: STAGED CANDIDATE — validated + graded here, NOT deployed.** This
file records how the candidate `pack.json` in this directory
(`tools/drive-pack-extract/candidates/powerflex_40/`) was generated. This
location is NOT the live served `mira-bots/shared/drive_packs/packs/` tree —
`resolve_pack()` cannot see it. Grading happens against this candidate;
promotion into the live `packs/` tree is a SEPARATE, later, human-gated deploy
step (train-before-deploy), not asserted or performed here.

- Vendor: Rockwell Automation
- Family: PowerFlex 40 (22B)
- Publication: PowerFlex 40 Adjustable Frequency AC Drive User Manual (22B-UM001J-EN-E)
- Revision: J
- Date: September 2025
- Source filename: `22b-um001.pdf`
- Source sha256: `15c10c6420379e8d286ee4c8a210b11683e97e727b39b592e6a9e0dfd023cae9`
- Source PDF is **NOT committed to git** (proprietary Rockwell manual, ~6.5MB;
  see `tools/drive-pack-extract/.gitignore`).

## Page ranges used

- Fault-code table: pp. 93-95 (Table 10 – Fault Types, Descriptions, and Actions)
- Parameter pages: p. 53 (motor nameplate/limits) + p. 76 (comm / Advanced Program)

## Extraction command

```
extractor.extract(
    "22b-um001.pdf",
    doc="PowerFlex 40 Adjustable Frequency AC Drive User Manual (22B-UM001J-EN-E)",
    fault_pages=[93, 94, 95],
    param_pages=[53, 76],
)
```

Run via `python generate_pf40_pack.py --manual <path-to-manual>` from
`tools/drive-pack-extract/`.

## Tooling provenance

- Extractor source git short-sha: `bdd4b715` (`tools/drive-pack-extract/extractor.py`
  at generation time)
- Generation date: <fill at generation>

## Result counts

- Fault codes extracted (cite-integrity verified): 26
- Parameters extracted (cite-integrity verified): 9

## Headline cross-vendor proof

- **F81 [Comm Loss] -> A105 [Comm Loss Action]** — the fault's action text
  "Turn off using A105 [Comm Loss Action]" makes A105.related_faults include
  F81. The Allen-Bradley PowerFlex 40 analog of GS10 CE10->P09.03 and
  PowerFlex 525 F081->C125.

## Sanitized fields (nulled as unreliable bleed)

No fields were nulled as bleed.

## Declared residuals

- Worded/conditional defaults (P031 [Motor NP Volts], P033 [Motor OL Current] =
  "Based on Drive Rating") are emitted as `null` — honest, not a miss.
- Shared-group fault continuations (F39/F40, F42/F43) and a few informational
  faults (F48/F71/F80) carry no own Fault-Type glyph; they are emitted with
  `fault_type "—"` (not fabricated). `fault_type` is not carried into the pack.
- The analog-scaling param group (p.77) and graph-callout pages (p.71 "A034
  [Minimum Freq]" typo) are excluded from the param page range — precision over
  recall.

## Notes

- `live_decode.status_bits`, `live_decode.cmd_word`, `live_decode.registers`,
  and `envelope` are intentionally EMPTY — PF40 has no bench data yet. No
  register address or command-word bit was invented.
- `keypad_navigation` is intentionally EMPTY — the extractor found no clean,
  citable keypad button-press procedure in the targeted page ranges.
- Every fault_code and parameter entry passed `cite_integrity` verification
  against the real manual (unverifiable entries are dropped by the extractor
  before this script ever sees them).

## Promotion to live (human sign-off)

- **2026-07-09 — PROMOTED to the live served `mira-bots/shared/drive_packs/packs/`
  tree** (from the staged candidate) by **human approval (Mike)** — selected as the
  Drive Commander AB-3 second model.
- Trust status at promotion: **`beta`** (schema PASS; cite-integrity pass; gold
  precision 100%, diagnostic-critical recall + precision 100%, overall fault recall
  100%, 0 fabrications, 0 residuals; domain clean). Grading report: `grading_report.md`.
- **Manual-cited-only scope waiver:** PF40 has no bench data, so `live_decode`
  (status_bits/cmd_word/registers) and `envelope` are empty. Deployed as a
  **read-only, manual-cited** diagnostic pack per the doctrine's manual-only waiver
  for a `beta` pack. No control writes; no invented bench values.
