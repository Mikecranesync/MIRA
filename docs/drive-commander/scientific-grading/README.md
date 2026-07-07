# Drive-Pack Scientific Grading

A deterministic, evidence-based grading system for MIRA / DriveSense drive-pack
JSON outputs. **No drive pack is promoted on subjective review alone.** Every
generated pack is compared against its OEM manual with repeatable measurements
and scored 0–100 with a letter grade and pass/fail gates.

Implements `Drive_Pack_Scientific_Grading_Spec`. It **complements** (does not
replace) the existing five-layer trust-status harness (`grade.py` →
`beta`/`trusted`): the same four measurement layers (schema / cite / gold /
domain) are the engine; this rubric adds the weighted score, the letter grade,
the critical-failure list, and the promotion recommendation.

- Rubric + scoring: `tools/drive-pack-extract/grading/scientific.py`
- CLI: `tools/drive-pack-extract/grading/grade_scientific.py`
- Measurement engine (reused): `grading/{schema_check,cite_check,gold_score,domain_rules}.py`

## Hard gates (any failure → grade F, not promotable)

| Gate | Proven by |
|---|---|
| Schema validity | the pack parses through the **real runtime loader** (`drive_packs/loader.py`) |
| Runtime compatibility | same loader — a pack that grades must be a pack that loads |
| Provenance present | `provenance.items` present, every tier ∈ `{bench_verified, manual_cited}` |

## Scored categories (weighted average over gradeable categories)

| # | Category | Weight | Needs a gold set? |
|---|---|---:|---|
| 1 | Manual provenance and traceability | 10 | no |
| 2 | Fault coverage and precision | 20 | yes |
| 3 | Fault field accuracy | 20 | yes |
| 4 | Parameter coverage and precision | 20 | yes |
| 5 | Parameter field accuracy | 15 | yes |
| 6 | Relationship accuracy | 10 | yes |
| 7 | Citation fidelity | 15 | needs the manual |
| 8 | Safety and technician usability | 10 | no |

The eight weights sum to **120**, so the overall score is a weighted **average**
— `Σ(score·weight) / Σ(weight)` — which normalizes the 120 cleanly and, crucially,
**renormalizes when a category is N/A** (no gold set → categories 2–6; no manual →
category 7) rather than silently scoring the missing evidence as zero. A pack with
any N/A category is flagged **INCOMPLETE** and is **not promotable** until the
missing evidence exists — "cannot be scientifically graded" is itself a finding.

## Grade bands

| Grade | Score | Meaning |
|---|---|---|
| **A** | 92–100 | Production-ready after human sign-off |
| **B** | 82–91 | Beta; waiver required for promotion |
| **C** | 70–81 | Candidate only; remain staged |
| **D** | 50–69 | Research only |
| **F** | <50 | Failed; not promotable |

## Promotion policy (spec)

No drive pack may be promoted without: **(1)** a completed grading report,
**(2)** manual-grounded evidence, **(3)** no unresolved critical failures,
**(4)** explicit human approval, **(5)** re-grading after promotion to the live
location. *Train before deploy. Grade before promote.*

## Running it

```bash
cd tools/drive-pack-extract
# staged candidate (default --packs-dir = candidates/)
python grading/grade_scientific.py --pack powerflex_40 \
  --gold gold/powerflex_40/gold.json --manual <path-to-manual.pdf> --out out
# a live/promoted pack:
python grading/grade_scientific.py --pack powerflex_525 \
  --gold gold/powerflex_525/gold.json --manual <manual.pdf> \
  --packs-dir ../../mira-bots/shared/drive_packs/packs --out out
# a pack with no gold set (graded on gold-independent categories only):
python grading/grade_scientific.py --pack durapulse_gs10 \
  --packs-dir ../../mira-bots/shared/drive_packs/packs --out out
```
Exit code is non-zero when the pack is **not promotable**. The real OEM manuals
are never committed; supply a local path.

---

# Back-grade (2026-07-07)

Every current pack, graded before any future promotion. Reports in this directory
(`<pack>.md` / `<pack>.json`).

| Pack | Status | Grade | Score | Promotable | Blockers / evidence |
|---|---|---|---:|---|---|
| **powerflex_40** | staged candidate | **A** | 100.0 | after sign-off | none — full gold + manual; graded against 22B-UM001J (sha `15c10c64…`) |
| **powerflex_525** | live pack | **A** | 96.9 | after sign-off | live pack still carries the P053 cross-ref gap (2/6 links missing). Fixed **candidate** grades **A / 100** — see below. Full gold + manual (520-UM001O, sha `b9445a63…`) |
| **durapulse_gs10** | live pack | **D** | 60.0 | **NO (INCOMPLETE)** | no gold set; non-PowerFlex ID conventions flagged (see below) |

## Findings

**powerflex_40 (A, 100)** — all eight categories 100. Cite-integrity 35/35 verbatim.
Confirms the staged candidate is production-grade *pending human sign-off* — the
promotion gate this rubric enforces.

**powerflex_525 (live A/96.9 → fixed candidate A/100)** — the deduction is **fault
field accuracy**: of the 6 gold fault→param links, the live pack resolves only 4.
**Root cause (corrected 2026-07-07, refs #2517):** the earlier back-grade guessed
"P053 was never extracted" — that was wrong. P053 *is* in the pack (from the
page-66 Basic Program grid). The real bug was in the extractor's cross-reference
detector: `F100 [Parameter Chksum]` and `F109 [Mismatch C-P]` both say *"Set P053
[Reset To Defaults] to 2/3"* in their action text, but pdfplumber renders the
bracket `[Reset` ~0.0003 pt *above* its own id `P053` on that physical line, so a
raw global `(top, x0)` sort put the bracket *before* the id and the "id
immediately followed by `[`" adjacency check silently dropped the reference
(`F101` survived only because its tokens tied). `extractor._find_cross_refs` now
clusters the action band into visual lines first (the same `_LINE_TOL` tolerance
the rest of the extractor uses) and scans each line in reading order. With the
fix, `P053.related_faults = [F100, F101, F109]` and all 6 links resolve. The gold
was also completed (P053 added as a graded parameter with its fault links), which
is why the *live* pack's honest score against the more-complete gold is **96.9**
(the gap was slightly undercounted before). The **regenerated staged candidate**
(`tools/drive-pack-extract/candidates/powerflex_525/`) grades **A / 100**; the
live pack reaches 100 only on a separate, human-gated **re-promotion** — the
grader measures, humans promote.

**durapulse_gs10 (D, 60, INCOMPLETE)** — **cannot be scientifically graded as-is**,
for two independent reasons the rubric correctly exposes:
1. **No gold set** → coverage/accuracy categories (2–6) are N/A → INCOMPLETE.
   *Recommendation: author `gold/durapulse_gs10/gold.json`.*
2. **Non-PowerFlex ID conventions** flagged by the (PowerFlex-oriented) domain
   rules: GS10 uses dotted params (`P09.03`) and `CE`-prefix comm faults (`CE10`
   in `related_faults`), which don't match `^[APCTBDapctbd]\d{2,3}$` / `^F\d+$`.
   *Recommendation: generalize `grading/domain_rules.py` to recognize GS10's
   dotted-param + CE-fault conventions (or confirm the IDs), so a legitimately
   cross-vendor pack isn't penalized as "wrong-drive contamination".*
   The GS10 pack is also `bench_verified` (no manual citations by design), so
   citation fidelity is N/A here too.

GS10 clearing this bar (author a gold set + generalize the domain rules) is
tracked as the follow-up before any GS10 re-promotion review. This back-grade is
exactly the intended result: **a pack promoted before this bar existed does not
automatically pass it.**
