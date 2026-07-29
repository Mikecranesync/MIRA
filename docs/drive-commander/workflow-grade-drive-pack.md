# Grade a generated drive pack

> Doctrine: [`drive-pack-trust-doctrine.md`](drive-pack-trust-doctrine.md). **The drive pack is
> not trusted because the extractor ran. It is trusted only when open, reproducible checks prove
> the JSON matches the source PDF within declared limits.** This doc is the *grade* half of that
> story — turning a candidate pack (see
> [`workflow-generate-drive-pack.md`](workflow-generate-drive-pack.md)) into a report a human can
> accept or reject.

## The five layers

Full contract: `tools/drive-pack-extract/grading/GRADING_SPEC.md`. Summary:

| Layer | File | Checks |
|---|---|---|
| **A. Schema validation** | `grading/schema_check.py` | Loads the candidate through the **real runtime loader** (`mira-bots/shared/drive_packs/loader.py::load_pack`). Any `ValueError`/`FileNotFoundError` fails closed. |
| **B. Citation integrity** | `grading/cite_check.py` | Re-reads the source PDF; every `source_citation` excerpt must appear verbatim on its cited page. A dropped **diagnostic-critical** citation is a hard fail. Without `--manual`, this layer reports `skipped (manual not available)`. |
| **C. Gold-set scoring** | `grading/gold_score.py` | Compares the pack against `gold/<family>/gold.json`. Precision over recall — a value that **contradicts** gold (wrong name/range/default) or a param id leaked into `related_faults` is a hard **fabrication** fail. |
| **D. Domain-quality rules** | `grading/domain_rules.py` | Deterministic, gold-independent invariants: fault codes look like fault codes, parameter ids never appear in `related_faults`, no duplicates, cited ranges/defaults/units, no header/footer junk, `provenance_tier` is a known value. |
| **E. Reproducible report** | `grading/report.py` + `grade.py` | Emits `grading_report.json` + `grading_report.md` and computes the final trust status, fail-closed, worst-wins. |

## The real command

```bash
cd tools/drive-pack-extract/grading
python grade.py --pack powerflex_525 --gold ../gold/powerflex_525/gold.json \
    --manual "<path>" --out grading_out [--residual "..."]
```

- Writes `grading_out/grading_report.json` + `grading_out/grading_report.md`.
- Prints the trust status and its reasons to the console.
- **Exits 1 iff the status is `rejected`** — this is the fail-closed CI/PR gate.
- Omitting `--manual` skips Layer B (cite-integrity) entirely and caps the status at
  `internal_only`, regardless of how clean everything else is.
- `--residual` is repeatable; use it to declare a known, honest gap (e.g. a skipped page range)
  rather than let it register as an *undeclared* gap (which itself blocks `beta`).

## How trust status is assigned

From `GRADING_SPEC.md`, computed fail-closed, worst-wins — a single hard failure anywhere caps the
whole pack at `rejected` regardless of how clean the other layers are:

| status | criteria |
|---|---|
| **rejected** | schema fails; OR any hard domain-rule violation; OR any gold fabrication; OR a diagnostic-critical citation dropped by cite-integrity |
| **internal_only** | schema + domain pass, but cite-integrity could not run (manual absent) OR gold recall of diagnostic-critical faults < 100% OR undeclared residuals |
| **beta** | schema + domain + cite-integrity all pass; gold **precision on diagnostic-critical == 100%**; overall fault recall >= 90%; residuals declared; NO bench-verified `live_decode` (manual-cited-only pack) |
| **trusted** | all `beta` criteria met **AND** a recorded human sign-off (see [`runbook-pr-b-acceptance.md`](runbook-pr-b-acceptance.md)) **AND** (bench-verified live_decode present OR explicit human waiver noting manual-only scope) |

The harness (`grade.py` / `report.py::compute_trust_status`) **never emits `trusted`** — the
automated ceiling for a manual-cited-only pack is `beta`. Promotion to `trusted` is always a
documented human action.

## Reviewer checklist

Run through this before accepting a `grading_report.md`:

- [ ] **Schema layer passes.** The pack loads through the real runtime loader, not a hand-rolled
      validator.
- [ ] **Diagnostic-critical fields are clean.** Every field `GRADING_SPEC.md` marks
      `diagnostic_critical: true` in the gold set (comm-loss faults F081/F082/F083,
      UnderVoltage/OverVoltage, comm params C123–C127) matches the manual exactly — name, range,
      default, and the fault↔parameter cross-reference direction.
- [ ] **Cite-integrity is 0 unverifiable — or the gap is explained.** If any excerpt failed
      verification, confirm it was a non-diagnostic-critical entry the extractor already dropped
      (unverifiable entries never make it into the pack in the first place — see
      `tools/drive-pack-extract/README.md` § "The cite-integrity guarantee") rather than something
      that slipped through.
- [ ] **Domain rules are clean.** No fault-shaped id in `parameters[]`, no parameter id in any
      `related_faults`, no duplicate codes/ids, no header/footer/page-number junk in a name.
- [ ] **Residuals are declared and honest.** Every known gap (a skipped page range, a
      comma-grouped row the extractor intentionally omitted, a nulled bleed field) shows up either
      in `PROVENANCE.md`'s "Sanitized fields" section or in the `--residual` list — not silently
      absent from the report.
- [ ] **No fabrication.** Gold-set scoring reports `fabrication_detected: false`. Spot-check a
      handful of non-gold entries against the manual yourself, especially anything unusually
      "clean" for a messy page.
- [ ] **The assigned trust status matches what you'd sign for.** `beta` is the automated ceiling —
      confirm you agree with *why* the report landed there before treating it as ready for the
      acceptance runbook.

## Cross-references

- [`drive-pack-trust-doctrine.md`](drive-pack-trust-doctrine.md) — the doctrine
- [`workflow-generate-drive-pack.md`](workflow-generate-drive-pack.md) — producing the candidate this grades
- [`runbook-pr-b-acceptance.md`](runbook-pr-b-acceptance.md) — the full acceptance flow + sign-off
- [`runbook-adding-a-drive-family.md`](runbook-adding-a-drive-family.md) — building a gold set for a new family
- `tools/drive-pack-extract/grading/GRADING_SPEC.md` — the grading contract (canonical)
- `docs/adr/0025-drive-intelligence-packs-and-drive-commander.md` — the product decision
