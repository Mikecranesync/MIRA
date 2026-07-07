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
| **powerflex_525** | live pack | **A** | 98.3 | after sign-off | 4/6 fault→param links present (P053 links absent — P053 not extracted). Full gold + manual (520-UM001O, sha `b9445a63…`) |
| **durapulse_gs10** | live pack | **D** | 60.0 | **NO (INCOMPLETE)** | no gold set; non-PowerFlex ID conventions flagged (see below) |

## Findings

**powerflex_40 (A, 100)** — all eight categories 100. Cite-integrity 35/35 verbatim.
Confirms the staged candidate is production-grade *pending human sign-off* — the
promotion gate this rubric enforces.

**powerflex_525 (A, 98.3)** — the only deduction is **fault field accuracy (90)**:
2 of 6 gold fault→param links are missing because **P053 was never extracted into
the pack** (it is not in the pack's parameter pages). A real, precise gap in the
live pack surfaced by back-grading — not a blocker (the F081/F082/F083→C125
headline chain is intact), but a recommended follow-up (extract P053 so
F100/F101/F109→P053 resolve).

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
