# CI Promotion Gate — Design Note (not yet wired)

Refs #2518. Designed here; **deliberately NOT wired in this change** (see
"Why not wired yet"). This is the design note + the proposed workflow, so wiring
later is a mechanical, reviewed step rather than a rushed one.

## Goal

Block a PR from promoting a drive pack into the live tree when the pack is not
promotion-safe. Promotion = a diff that adds/changes
`mira-bots/shared/drive_packs/packs/*/pack.json`. The gate enforces the
grader's verdict so a sub-bar pack can never reach production by review-miss.

## Trigger scoping (must be narrow)

The gate MUST run **only** on promotion-relevant changes, never on unrelated docs
or tooling edits (the scientific-grading PRs themselves must not be gated by it):

```yaml
on:
  pull_request:
    paths:
      - 'mira-bots/shared/drive_packs/packs/**/pack.json'   # a promotion/update
```

For a PR touching only `tools/drive-pack-extract/**`, `docs/**`, or `gold/**`,
the job does not run. It fires exactly when a live pack.json is added or changed.

## Block criteria

For each `packs/<id>/pack.json` added or modified in the PR, run
`grade_scientific.py` against it (`--packs-dir mira-bots/shared/drive_packs/packs`)
and **fail** the PR when the pack is any of:

- **below band B** (`overall_score < 82`), or
- **INCOMPLETE** (a scored category is N/A — missing gold set / unverifiable
  citation), unless the pack carries a documented waiver (below), or
- **any hard gate failed** (schema validity / runtime compatibility / provenance),
  or
- **any critical failure** (fabrication, dropped diagnostic-critical citation,
  domain violation, diagnostic-critical fault recall < 100%).

The grader already exits non-zero for "not promotable", so the job is thin — it
just needs to locate the changed packs and pass each the right gold/manual.

## The two hard problems to resolve before wiring

1. **Manuals are never committed → citation fidelity can't run in CI.** Every
   pack would be INCOMPLETE on citation and the gate would block *every*
   promotion. Options (pick one before wiring):
   - **(a) Waiver field on the pack** — a `manual_cited` / `bench_verified`
     scope waiver (mirroring the existing human promotion waiver) that lets the
     gate treat citation-N/A as acceptable when a human has signed off. The gate
     reads the waiver from the pack's `PROVENANCE.md` / a provenance field.
   - **(b) sha256-pinned fixture manuals** fetched at gate time from a trusted
     store (not the repo) keyed by the gold's `manual.sha256`. Heavier; keeps
     real citation verification in CI.
   - **(c) Grade the committed `candidates/<id>/scientific_report.json`** as the
     evidence-of-record (produced with the manual at authoring time) and have
     the gate verify the promoted pack.json is byte-identical to that graded
     candidate. Cheapest; shifts trust to the committed report.
   Recommendation: **(c)** for the first cut (verify the promotion matches a
   committed, human-reviewed graded candidate), with **(a)** as the waiver escape
   hatch for bench-verified / chapter-section-citation packs like GS10.

2. **Chapter-section page labels** (GS10 `4-188`) aren't verifiable by the
   integer-page `cite_integrity`. Until a chapter-section-aware cite check
   exists, GS10-style packs are structurally INCOMPLETE on citation and need the
   waiver path (option a) to be promotable.

## Why not wired yet

- The packs this gate protects must first be **clean enough to pass it** — the
  PF525 (#2519) and GS10 (#2520) grading improvements are still open PRs. Wiring
  the gate before they merge would either block their own follow-up work or gate
  against a moving target.
- The **manual-in-CI decision above is unmade.** Wiring the gate without it would
  block 100% of promotions (all INCOMPLETE on citation) — noisy CI that fails
  closed on the wrong axis. The mission is explicit: *if the repo is not ready to
  wire it safely, produce a design note and draft PR instead of forcing it.*

## Proposed workflow (draft — do not add to `.github/workflows/` until the above
## is resolved)

```yaml
name: Drive-Pack Promotion Gate
on:
  pull_request:
    paths: ['mira-bots/shared/drive_packs/packs/**/pack.json']
jobs:
  promotion-gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-python@v5
        with: { python-version: '3.12' }
      - run: pip install pdfplumber
      - name: Grade each promoted pack
        run: |
          set -euo pipefail
          changed=$(git diff --name-only origin/${{ github.base_ref }}... \
            -- 'mira-bots/shared/drive_packs/packs/**/pack.json')
          cd tools/drive-pack-extract
          for f in $changed; do
            id=$(basename "$(dirname "../../$f")")
            gold="gold/$id/gold.json"; [ -f "$gold" ] || gold=""
            # option (c): verify byte-identical to the human-reviewed graded
            # candidate, then grade for band/critical-failures.
            python grading/grade_scientific.py --pack "$id" \
              --packs-dir ../../mira-bots/shared/drive_packs/packs \
              ${gold:+--gold "$gold"} --out "gate-$id" \
              || { echo "::error::pack $id is not promotable"; exit 1; }
          done
```

## Acceptance (when wired)

- A PR that adds a **sub-B / INCOMPLETE / critical-failure** pack to
  `packs/` is **blocked**.
- A PR that promotes a clean **A/B** pack (with the manual-evidence question
  resolved per above) **passes**.
- A PR touching only tooling/docs/gold **does not trigger** the gate.
