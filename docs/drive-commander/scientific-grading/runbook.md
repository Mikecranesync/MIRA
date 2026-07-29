# Drive-Pack Scientific Grading — Runbook

How to grade a drive pack, read the result, add a gold set, support a new
vendor's identifier conventions, and what must be true before a pack is
promoted. Companion to `README.md` (the rubric + the published back-grade).

> **Doctrine: the grader measures; humans promote.** Grading never moves a pack
> into the live `mira-bots/shared/drive_packs/packs/` tree. Promotion is always a
> separate, human-approved step.

## 1. Run scientific grading locally

From `tools/drive-pack-extract/`:

```bash
# A STAGED CANDIDATE (default --packs-dir = candidates/), full grade:
python grading/grade_scientific.py --pack powerflex_40 \
  --gold gold/powerflex_40/gold.json --manual /path/to/22b-um001.pdf --out out

# A LIVE pack (grade in place — read-only, does NOT modify the pack):
python grading/grade_scientific.py --pack powerflex_525 \
  --gold gold/powerflex_525/gold.json --manual /path/to/pf525_520-um001.pdf \
  --packs-dir ../../mira-bots/shared/drive_packs/packs --out out

# A pack with NO gold set (gold-independent categories only):
python grading/grade_scientific.py --pack durapulse_gs10 \
  --packs-dir ../../mira-bots/shared/drive_packs/packs --out out
```

Outputs `out/scientific_report.{json,md}`. Exit code is **non-zero when the pack
is not promotable**. `grade.py` (same flags, requires `--gold`) emits the
`beta`/`trusted` trust-status report the scientific grade complements.

**OEM manuals are never committed.** Pass a local path; the report records only
the manual's filename + sha256, never the local path.

## 2. Read the grade

| Grade | Score | Meaning |
|---|---|---|
| **A** | 92–100 | Production-ready **after human sign-off** |
| **B** | 82–91 | Beta; **waiver required** for promotion |
| **C** | 70–81 | Candidate only; **remain staged** |
| **D** | 50–69 | Research only |
| **F** | <50 | Failed; not promotable (also forced by any hard-gate failure) |

- **Overall** = weighted average over the **gradeable** categories (the eight
  weights sum to 120; N/A categories drop out of the denominator).
- **INCOMPLETE** = at least one category could not be scored (no gold set →
  coverage/accuracy N/A; no manual → citation fidelity N/A). An INCOMPLETE pack
  is **not promotable regardless of score** — "cannot be fully graded" is itself
  a finding. Fix the missing evidence (author a gold set, supply the manual),
  then re-grade.
- **Hard gates** (schema validity, runtime compatibility, provenance): any
  failure forces **F** and blocks promotion.
- **Critical failures** (fabrication, dropped diagnostic-critical citation,
  domain violation, diagnostic-critical fault recall < 100%, a failed hard gate)
  block promotion regardless of score.

## 3. Add a new gold set

A gold set (`gold/<family>/gold.json`) is the human-approved reference the
coverage/accuracy/relationship categories score against. **Precision over
recall** — fewer, certain entries beat broad, shaky ones.

Minimum shape (see `grading/GRADING_SPEC.md` for the full contract, and
`gold/powerflex_525/gold.json` / `gold/durapulse_gs10/gold.json` for worked
examples):

```jsonc
{
  "manual": { "vendor": "...", "family": "...", "publication": "...",
              "sha256": "…", "page_numbering": "…" },
  "faults": [ { "fault_id": "...", "code": 58, "name": "<exact pack name>",
                "references_parameters": ["P09.03"], "page": "...",
                "diagnostic_critical": true } ],
  "parameters": [ { "parameter_id": "P09.03", "name": "...", "range": null,
                    "default": "00", "unit": "sec", "related_parameters": [],
                    "related_faults": ["CE10"], "page": "...",
                    "diagnostic_critical": true } ],
  "edge_cases": [ { "kind": "related_parameters_not_faults", "ids": ["P09.03"],
                    "expectation": "…" } ]
}
```

Rules that keep grading truthful:
- **Names/ranges/defaults must match the PACK exactly** (compared normalized) —
  a mismatch is a *fabrication* (hard fail), so the gold value must be the real
  manual value, not a guess.
- `range`/`default`/`unit` = `null` when the manual has no clean numeric value
  (worded/conditional default) — honest, not a miss.
- `related_faults` on a gold parameter is graded **strictly** — list exactly the
  fault ids the pack should carry (an extra pack entry is a fabrication, a
  missing one is a gap).
- Mark `diagnostic_critical: true` on the fields that MUST be right (comm-loss,
  under/over-voltage, the comm params). These drive the diagnostic-critical
  precision/recall gates.
- **Don't fake completeness.** If the manual evidence is partial (e.g. a
  bench-verified pack, or a page-label format the cite check can't verify),
  say so in the gold's `manual.notes` / `page_numbering` and let the grade come
  out INCOMPLETE. See GS10.

## 4. Vendor-specific identifier conventions

`grading/domain_rules.py` validates parameter ids and fault references **per
family** — keyed off the pack's declared `family` (manufacturer / series /
aliases), not one hardcoded vocabulary:

| family | param ids | fault references |
|---|---|---|
| `powerflex` | `^[APCTBDapctbd]\d{2,3}$` (A105, P042, C125, t094, d015) | `^F\d+$` (F081) |
| `durapulse` (GS10/GS20) | `^[A-Za-z]\d{2}\.\d{2}$` (P09.03) | mnemonics (CE10, GFF, Lvd, oL, EF) |
| *unknown* | **falls back to the strict `powerflex` pattern** | strict `powerflex` |

To add a vendor, add an entry to `_FAMILY_CONVENTIONS` and a branch in
`_family_key`. **This is not a relaxation:**
- an unknown family stays strict (conservative);
- the **param-id-leak guard is absolute** for every family (a parameter id in
  `related_faults` is always a hard fail);
- an id whose shape belongs to a *different* family than the pack declares is
  still flagged as wrong-family contamination.

Add tests mirroring `test_grading.py`'s family block: the new family's ids grade,
the other families' ids are caught, the leak guard holds, unknown stays strict.

## 5. Before a pack can be promoted

Promotion (moving a candidate into the live `packs/` tree, or updating a live
pack) requires ALL of:

1. a completed grading report (scientific + trust-status);
2. manual-grounded evidence (or an explicit, documented manual-cited-only /
   bench-verified scope waiver where citation can't be machine-verified);
3. **no unresolved critical failures**, and **not INCOMPLETE** (or a documented
   waiver for a category that is inherently N/A, e.g. GS10's chapter-section
   citations);
4. **explicit human approval**, recorded in the promoted pack's `PROVENANCE.md`
   (`runbook-pr-b-acceptance.md`);
5. **re-grading after promotion** at the live location.

A future **CI promotion gate** (design: `ci-promotion-gate-design.md`) will
enforce 1/3 automatically on any PR that touches
`mira-bots/shared/drive_packs/packs/*/pack.json`. Until it is wired, these are
enforced by review.
