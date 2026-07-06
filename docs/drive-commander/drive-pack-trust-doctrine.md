# Drive Pack Trust Doctrine

> **The drive pack is not trusted because the extractor ran. It is trusted only
> when open, reproducible checks prove the JSON matches the source PDF within
> declared limits.**

This is the load-bearing principle of the Drive Commander product. "We use AI to
read manuals" is easy to claim; the boring, evidence-backed, regression-tested
*compiler layer* that turns ugly industrial PDFs into safe, cited diagnostic
service packs is the hard, ownable thing. A confidently-wrong output — a real
page citation on a mis-parsed value — is **worse than no answer**, because it
breaks the whole trust story.

## PR-A ("parser works") ≠ PR-B ("pack is trusted")

Two things stay distinct. Do not let one blur into the other:

| | Proves | Gate |
|---|---|---|
| **PR-A — Extractor** | the parser can correctly extract *this manual family's* shape | tests pass on synthetic + real fixtures |
| **PR-B — Pack** | the extracted output is good enough to become a real *approved service pack* | the **grading workflow** in this repo passes AND a human signs off |

Tests passing on a synthetic fixture are **necessary but not sufficient**. Never
merge a pack because tests pass. Merge a pack only when the **real manual's** JSON
output is human-readable, evidence-backed, and *boringly clean*, and the grading
report assigns a trust status a human accepts.

## The five trust checks (all reproducible, all open)

A generated pack earns a trust status from a grading harness that runs these
layers, in order, fail-closed:

1. **Schema validation** — the JSON conforms to the current drive-pack schema.
2. **Citation integrity** — every cited excerpt appears verbatim on the cited PDF
   page; unverifiable claims are dropped or fail. *The PDF is the source of truth.*
3. **Gold-set scoring** — the generated JSON is compared against a small,
   human-approved gold review set drawn from the manual. **Precision over recall:**
   missing a low-value field is less dangerous than inventing a diagnostic fact.
4. **Domain-quality rules** — deterministic invariants: fault codes are fault
   codes; parameter IDs never appear in `related_faults`; no duplicate codes/IDs;
   diagnostic-critical fields are citation-backed; ranges/defaults/units are cited
   or marked uncertain; no PDF header/footer/page-number/table-artifact junk in
   names; inferred relationships are marked inferred, not manual-stated.
5. **Trust status** — the report assigns exactly one of `trusted`, `beta`,
   `internal_only`, or `rejected`, from the check results plus declared residuals.

## The anti-fabrication rules (never weaken these)

- **The PDF is the only source of truth.** Not the extractor's confidence, not a
  prior pack, not domain knowledge. If the excerpt is not on the cited page, the
  claim does not ship.
- **Fault → parameter only.** A fault may reference a parameter to modify (e.g.
  F081 → C125). A parameter's own "Related Parameters:" line is `related_parameters`,
  **never** `related_faults`. Conflating them is a critical bug.
- **Mark inferred as inferred.** A relationship the manual does not state
  explicitly is `inferred`, and the report must surface it as such.
- **Honest residuals.** Known parse imperfections (e.g. conditional-default bleed,
  header-furniture bleed) are documented in the grading report, not silently
  "fixed" by weakening a check.

## The flywheel (why each ugly manual makes the next one easier)

Manual breaks extractor → harden extractor → **add the discovered messiness back
into the CI fixtures** → the corpus/gate gets stronger → the next manual is
easier. Each ugly manual permanently hardens the compiler. This is the moat.

## The 10-step acceptance flow (every new drive family)

1. Build extractor against a synthetic fixture.
2. Run it against the **real** OEM manual.
3. **Independently inspect the actual JSON output** — the orchestrator re-runs it;
   do not trust the builder's self-report.
4. Confirm parameter names are clean (no footnote markers, no description bleed).
5. Confirm ranges/defaults/units survived table extraction (position-aware, not
   dropped columns).
6. Confirm fault codes are real fault codes only.
7. Confirm parameter references are **not** mislabeled as `related_faults`.
8. Confirm every important field has page/text evidence (cite-integrity).
9. Add the discovered real-manual messiness back into the CI fixtures.
10. **Only then** open the PR.

## Cross-references

- `tools/drive-pack-extract/README.md` — the extractor (PR-A)
- `tools/drive-pack-extract/grading/` — the grading harness (PR-B)
- `docs/drive-commander/workflow-generate-drive-pack.md`
- `docs/drive-commander/workflow-grade-drive-pack.md`
- `docs/drive-commander/runbook-pr-b-acceptance.md`
- `docs/drive-commander/runbook-adding-a-drive-family.md`
- `docs/adr/0025-drive-intelligence-packs-and-drive-commander.md`
