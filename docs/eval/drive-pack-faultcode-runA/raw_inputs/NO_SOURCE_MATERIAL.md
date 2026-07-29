# Run A raw inputs — data-availability floor (READ THIS FIRST)

**Finding: there is NO IMPULSE "G+ Mini" source material in this repository or on
the build host.** This is a real, verifiable Run-A result, captured before any
schema repair (per the freeze constraint). It means the empty G+ Mini pack has
**two independent causes**, which must not be conflated:

1. **Data-availability floor (this file).** No G+ Mini manual, candidate, gold
   set, or registry entry exists. There is literally nothing to extract.
2. **Schema-representation floor (`gplus_mini_faultcodes_synthetic_probe.json`).**
   Even *given* source material, the current production schema
   (`live_decode.fault_codes: dict[int, str]`) + loader
   (`loader.py::_int_keyed`) cannot represent mnemonic fault identifiers such as
   `oC` / `BE2` / `LL1`; it hard-rejects them.

## Evidence for cause #1 (data availability)

Gathered read-only on the frozen commit (see `../env.json` for the SHA):

| Check | Command | Result |
|---|---|---|
| Repo-wide G+ Mini / IMPULSE / Magnetek / crane / hoist refs (source dirs) | `grep -rilE "g\+ ?mini\|impulse\|magnetek\|columbus.?mckinnon" mira-bots tools docs` | only `test_cross_vendor_canonical.py`, YouTube corpus tags, eval logs, competitor notes — **no manual, no pack, no candidate** |
| Extractor manual registry | `tools/drive-pack-extract/registry/sources.json` | 3 manuals: PowerFlex 525, DURApulse GS10, PowerFlex 40. **No IMPULSE / G+ Mini.** |
| Gitignored manuals dir | `ls tools/drive-pack-extract/manuals/` | empty |
| Extractor candidates | `ls tools/drive-pack-extract/candidates/` | `powerflex_40`, `powerflex_525` only |
| Filesystem-wide (home, Downloads, MiraDrop) | `find ~ -iregex '.*(impulse\|g.?plus.?mini\|magnetek).*\.(pdf\|json\|txt\|md)'` | **0 hits** |
| Vendor recognition | `mira-bots/tests/test_cross_vendor_canonical.py:56` | asserts `canonical_vendor("Magnetek") is None` — the OEM of the IMPULSE G+ Mini is **not even a recognized vendor** |

**Conclusion for cause #1:** the extractor cannot be run against a real G+ Mini
manual because none is present. No real manual content was fabricated to fill
this gap — doing so would violate the evidence-integrity rule this baseline
exists to protect.

## What the synthetic probe is (and is NOT)

`gplus_mini_faultcodes_synthetic_probe.json` is a **synthetic, clearly-labeled
probe** used *only* to exercise the real production loader gate against
mnemonic-style keys. Its purpose is to isolate cause #2 (schema representation)
from cause #1 (data availability). It is NOT:

- extracted from any manual,
- authoritative or complete,
- a candidate or a proposed pack,
- input to any promotion / `gold/` path.

The mnemonic tokens it uses (`oC`, `BE2`, `LL1`, …) are drawn from the publicly
documented IMPULSE-series fault-code *naming convention* (mnemonic alphanumeric
codes, not integer enums). They stand in for "any source-preserved mnemonic
identifier" — the point being tested is the loader's key-type contract, not the
specific semantics of any one code. See the file's own header for its provenance
label.
