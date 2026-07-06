# PR-B acceptance runbook

> Doctrine: [`drive-pack-trust-doctrine.md`](drive-pack-trust-doctrine.md). **The drive pack is
> not trusted because the extractor ran. It is trusted only when open, reproducible checks prove
> the JSON matches the source PDF within declared limits.** PR-A proves the extractor works
> (`tools/drive-pack-extract/README.md`); this runbook is how PR-B proves a **specific generated
> pack** is good enough to become an approved service pack.

## Step-by-step commands

1. **Generate the candidate pack** (see
   [`workflow-generate-drive-pack.md`](workflow-generate-drive-pack.md) for the full explanation):

   ```bash
   cd tools/drive-pack-extract
   python generate_pf525_pack.py --manual "<absolute path to manual.pdf>"
   ```

   This writes the **staged candidate** to `tools/drive-pack-extract/candidates/powerflex_525/` —
   NOT the live served `mira-bots/shared/drive_packs/packs/` tree. Confirm it prints
   `OK: schema validation of 'powerflex_525' candidate succeeded.` and note the fault/parameter
   counts it reports.

2. **Grade it** (see [`workflow-grade-drive-pack.md`](workflow-grade-drive-pack.md)):

   ```bash
   cd tools/drive-pack-extract/grading
   python grade.py --pack powerflex_525 --gold ../gold/powerflex_525/gold.json \
       --manual "<same path>" --out grading_out
   ```

   `--packs-dir` defaults to `tools/drive-pack-extract/candidates/`, so this grades the staged
   candidate the previous step just wrote — no extra flag needed. If you're knowingly shipping
   with a declared gap (e.g. an excluded page range), add `--residual "..."` once per known gap.

3. **Inspect the report.** Open `grading_out/grading_report.md` and walk the reviewer checklist in
   [`workflow-grade-drive-pack.md`](workflow-grade-drive-pack.md). Do not skip straight to the
   printed trust status — read the per-layer summaries and the diagnostic-critical numbers
   yourself.

4. **Run the offline tests** to confirm you haven't drifted from the tool's own self-tests:

   ```bash
   cd tools/drive-pack-extract
   python -m pytest -q
   python -m pytest grading/tests/ -q
   ```

   These run against the committed synthetic fixture (`fixtures/pf_sample.pdf`) — they don't need
   the real manual and are also enforced in CI (`.github/workflows/ci.yml`).

## Pass/fail criteria per layer

Restated from `GRADING_SPEC.md` (canonical) — a hard failure in any layer caps the whole pack at
`rejected`:

- **A. Schema** — must validate through `drive_packs.loader._parse_pack` (the same schema logic
  `load_pack` uses, run directly against the candidate file). Any exception is a hard fail.
- **B. Cite-integrity** — every cited excerpt must verify verbatim on its page. A dropped
  **diagnostic-critical** citation is a hard fail; a dropped non-critical one is a declarable gap.
- **C. Gold-set** — zero fabrications (a value that contradicts gold, or a param id leaked into
  `related_faults`) is a hard requirement at every trust level above `rejected`. Diagnostic-critical
  precision must be 100% for `beta`; overall fault recall must be >= 90%.
- **D. Domain rules** — zero hard violations (malformed ids, duplicates, header/footer junk,
  uncited numeric values, unknown provenance tier) required at every level above `rejected`.
- **E. Report** — must actually exist (`grading_report.json` + `.md`) with every declared residual
  reflected.

## What artifacts to attach to the PR

- `grading_out/grading_report.md` (and, if useful for reviewers, the `.json` alongside it).
- The pack's `PROVENANCE.md` (`tools/drive-pack-extract/candidates/<pack_id>/PROVENANCE.md` — the
  staged candidate location, not the live `packs/` tree).
- The fault/parameter counts (from either the generator's console output or the report's `Pack`
  section).
- The **sanitized-fields list** — copy it verbatim from `PROVENANCE.md`'s "Sanitized fields"
  section (or state "none" if empty).
- Do **not** attach the source manual PDF. It is gitignored and must never leave the local
  machine as a PR artifact either.

## Documenting residuals honestly

A residual is any known, deliberate gap — not a bug you're hiding. In the PR description, list
each one as a short bullet: *what* was skipped or nulled, *why* (usually a messy multi-column page
or an ambiguous comma-grouped row), and *where* it's declared (`--residual` flag text +
`PROVENANCE.md`'s sanitized-fields section). A residual that only exists in your head is an
undeclared gap — `report.py::compute_trust_status` treats undeclared gaps as blocking for `beta`,
and a human reviewer should apply the same standard to the PR narrative.

## Human sign-off

`beta` is the highest status the automated harness can assign. Moving a pack to `trusted` requires
a **recorded human action** — there is no script for this step by design (`GRADING_SPEC.md`:
"Promotion to `trusted` is a documented human action, never automatic"). The reviewer:

1. Independently inspects the **diagnostic-critical** parameters and faults against the real
   manual (not just the report's summary numbers) — the same discipline as the doctrine's 10-step
   acceptance flow, step 3 ("the orchestrator independently re-runs it").
2. Records, in the PR itself: their **name**, the **date**, and a short note confirming they
   inspected the diagnostic-critical fields against the manual (e.g. "Reviewed F081/F082/F083 and
   C123–C127 against 520-UM001O-EN-E pp.102,162 — match. — M. Crane, 2026-07-xx").
3. If promoting to `trusted` without bench-verified `live_decode` data, states the **explicit
   waiver** noting the pack is manual-only scope.

## Promotion gates (exact)

Per the trust table in `GRADING_SPEC.md` / [`workflow-grade-drive-pack.md`](workflow-grade-drive-pack.md):

- **`internal_only` → `beta`** requires: schema pass + domain pass + cite-integrity pass,
  diagnostic-critical precision == 100%, overall fault recall >= 90%, and all residuals declared
  (no undeclared gaps).
- **`beta` → `trusted`** requires: everything `beta` requires, **AND** a recorded human sign-off
  (name/date/note per the "Human sign-off" section above), **AND either** bench-verified
  `live_decode` data is present **OR** an explicit manual-only waiver is recorded alongside the
  sign-off.

Nothing in the harness will emit `trusted` on its own — if you see it in a report, something is
wrong with the harness, not a shortcut worth taking.

## Promotion (candidate → live) — a separate, human-gated step

Everything above (generate, grade, sign-off) operates entirely inside
`tools/drive-pack-extract/candidates/<pack_id>/` — a staged, non-served location. None of it
deploys anything: `resolve_pack()` cannot see a candidate, so a passing grading run has **zero**
runtime effect. Moving a candidate into the live served
`mira-bots/shared/drive_packs/packs/<pack_id>/` tree — where `resolve_pack()` can return it in
production — is a **separate, later, human-gated deploy step** (`.claude/rules/train-before-deploy.md`).
It is not performed by `generate_pf525_pack.py` or `grade.py`, and must not be automated as a
side-effect of either.

Promotion requires, in order:

1. **The trust status is human-approved.** Per "Human sign-off" above — at minimum `beta`, with a
   recorded reviewer name/date/note, and (if going further) the `trusted` sign-off criteria met.
   A pack graded `internal_only` or `rejected` is never promoted.
2. **Copy the four candidate files** (`pack.json`, `PROVENANCE.md`, `grading_report.md`,
   `grading_report.json`) from `tools/drive-pack-extract/candidates/<pack_id>/` to a new
   `mira-bots/shared/drive_packs/packs/<pack_id>/` directory, as a distinct, reviewable PR — not
   bundled into the generate/grade PR.
3. **Update `mira-bots/tests/test_drive_packs.py::test_resolve_pack_returns_none_for_unrelated_drive`.**
   That test's whole point is asserting `resolve_pack()` returns `None` for a drive family that
   has no live pack. Once `<pack_id>` is promoted, it is no longer a valid "unrelated" example —
   the test must be repointed at a still-unpackaged drive family (i.e. a family with no directory
   under the live `packs/` tree) so the assertion keeps testing what it claims to test.
4. **Re-run the full test suite** (`mira-bots/tests/test_drive_packs.py` and any grading
   self-tests) after promotion — a promoted pack changes `resolve_pack()`'s live behavior, and the
   regression-recheck discipline (`.claude/rules/session-discipline.md` § 2) applies.

## Cross-references

- [`drive-pack-trust-doctrine.md`](drive-pack-trust-doctrine.md) — the doctrine, the 10-step flow
- [`workflow-generate-drive-pack.md`](workflow-generate-drive-pack.md) — step 1 in detail
- [`workflow-grade-drive-pack.md`](workflow-grade-drive-pack.md) — step 2 in detail + reviewer checklist
- [`runbook-adding-a-drive-family.md`](runbook-adding-a-drive-family.md) — onboarding a new family
- `tools/drive-pack-extract/grading/GRADING_SPEC.md` — the grading contract (canonical)
- `docs/adr/0025-drive-intelligence-packs-and-drive-commander.md` — the product decision
