# Magnetek IMPULSE G+ Mini pack — provenance

**Status: STAGED CANDIDATE — genuine UNSEEN evaluation, NOT deployed.** Records
how the candidate `pack.json` here was generated. This location is NOT the live
`mira-bots/shared/drive_packs/packs/` tree — `resolve_pack()` cannot see it.
Nothing here is promoted to `gold/` or to the runtime resolver (train-before-deploy).

- Vendor: Magnetek (Columbus McKinnon)
- Family: IMPULSE G+ Mini — crane-hoist VFD
- Publication: Magnetek IMPULSE G+ Mini Technical Manual
- Document part number: 144-25085
- Firmware referenced: 14515
- Source URL: https://www.magnetekdrives.com/wp-content/uploads/sites/7/drives-g-mini-manual.pdf
- Source sha256: `56075883958090ed…` (2,915,657 bytes, 182 pages, PDF 1.4, text-readable)
- Source PDF is **NOT committed to git** (copyrighted Magnetek manual; provenance +
  SHA-256 + citations only — see `.gitignore`).
- Yaskawa relationship: **strongly_inferred** relabeled Yaskawa V1000 (CIMR-VU4A) with
  proprietary Magnetek crane firmware — see `../../MAGNETEK_YASKAWA_MATRIX.md`.

## Result — EMPTY (0 entries): a real generalization gap

Whole-document extract recovered **0 fault codes, 0 parameters**. Grade
**B (85.7/100) INCOMPLETE → NOT PROMOTABLE** (schema + domain layers only, on an
empty pack — NOT a quality signal). This is the honest unseen-eval finding, same
class as GS20 (#2685) / GS10:

- The G+ Mini **fault table** is a 3-column `Fault | Name/Description | Corrective
  Action` layout with **mnemonic codes** (`dnE`, `EF0`-`EF8`, `LF`, `LL1`/`LL2`,
  `oC`, `UV1`, `BE2`/`BE3`/`BE6`, `MNT`). The `live_decode.fault_codes` schema is
  `dict[int,str]`; mnemonic codes cannot key into it, and the position-aware parser
  is tuned to the PowerFlex 520-series table shape.
- **Parameters** are dotted (`H01.01`, `U01.10`, `C12.05`) — the parser looks for the
  PowerFlex grid/labeled-block layout, not this one.

**Next step (named follow-up, NOT in this PR):** capture the fault/parameter page
ranges + header shape and add a Magnetek extractor dialect (or a gold set). Tracked
as its own issue alongside GS20 (#2685).

## Reproduce

```
# manual cached at /tmp/gplus_mini.pdf (sha256 above)
python3.12 self_eval_scout.py --target magnetek_impulse_g_plus_mini --dry-run
# or, deterministically into candidates/:
#   extractor.extract(pdf, doc="Magnetek IMPULSE G+ Mini Technical Manual (144-25085)")
#   build_pack(fragment, target, provenance_note) -> pack.json
#   grading/grade_scientific.py --pack magnetek_impulse_g_plus_mini --manual <pdf>
```

Fault/parameter page anchors observed (for the future dialect): fault table ~pp.136-140,
mnemonic codes; parameter references throughout as `Hnn.nn` / `Cnn.nn` / `Unn.nn`.
