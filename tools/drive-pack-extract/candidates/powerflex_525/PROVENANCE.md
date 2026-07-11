# PowerFlex 525 pack — provenance

**Status: STAGED CANDIDATE — validated + graded here, NOT deployed.** This
file records how the candidate `pack.json` in this directory
(`tools/drive-pack-extract/candidates/powerflex_525/`) was generated. This
location is NOT the live served `mira-bots/shared/drive_packs/packs/` tree —
`resolve_pack()` cannot see it. Grading happens against this candidate;
promotion into the live `packs/` tree is a SEPARATE, later, human-gated
deploy step (train-before-deploy), not asserted or performed here.

- Vendor: Rockwell Automation
- Family: PowerFlex 525 (520-series)
- Publication: PowerFlex 525 Adjustable Frequency AC Drive User Manual (520-UM001O-EN-E)
- Revision: O
- Date: September 2025
- Source filename: `pf525_520-um001.pdf`
- Source sha256: `b9445a63c78865037d22238ddedbb785b4309c9798da9da35029d628658636a6`
- Source PDF is **NOT committed to git** (proprietary Rockwell manual, ~34MB;
  see `tools/drive-pack-extract/.gitignore`).

## Page ranges used

- Fault-code table: pp. 161-165
- Parameter grid layout: pp. 65-66
- Parameter labeled-block layout: pp. 98-103

## Extraction command

```
extractor.extract(
    "pf525_520-um001.pdf",
    doc="PowerFlex 525 Adjustable Frequency AC Drive User Manual (520-UM001O-EN-E)",
    fault_pages=list(range(161, 166)),
    param_pages=[65, 66, 99, 100, 101, 102, 103],
)
```

Run via `python generate_pf525_pack.py --manual <path-to-manual>` from
`tools/drive-pack-extract/`.

## Tooling provenance

- Extractor source git short-sha: `974e79df` (`tools/drive-pack-extract/extractor.py`
  at generation time)
- Generation date: <fill at generation>

## Result counts

- Fault codes extracted (cite-integrity verified): 48
- Parameters extracted (cite-integrity verified): 45

## Sanitized fields (nulled as unreliable bleed)

6 field(s) were nulled as cross-row bleed:

- `P030.unit`
- `P040.unit`
- `P045.default`
- `P045.unit`
- `P052.default`
- `P052.unit`


## Notes

- `live_decode.status_bits`, `live_decode.cmd_word`, `live_decode.registers`,
  and `envelope` are intentionally EMPTY — PF525 has no bench data yet. No
  register address or command-word bit was invented.
- `keypad_navigation` is intentionally EMPTY — the extractor found no clean,
  citable keypad button-press procedure in the targeted page ranges. An
  empty list is honest; it is not hand-authored.
- Every fault_code and parameter entry passed `cite_integrity` verification
  against the real manual (unverifiable entries are dropped by the
  extractor before this script ever sees them).
