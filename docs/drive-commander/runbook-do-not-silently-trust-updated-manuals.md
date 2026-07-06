# Runbook — Do not silently trust updated manuals

**The rule:** a changed manual creates a **candidate**, not a trusted pack. An
automatic pipeline may *discover* and *generate*; only a human may *promote*.

## Why

A drive pack is MIRA's diagnostic truth for that drive — fault meanings,
parameter ranges, keypad steps a technician acts on. If a vendor silently
revises a PDF (or a scraper grabs the wrong edition), and that flowed straight
into the live pack, MIRA could confidently emit **wrong** guidance with no human
in the loop. The whole trust model (`drive-pack-trust-doctrine.md`) exists to
prevent exactly this: *a pack is trusted only when open, reproducible checks
prove the JSON matches the source PDF within declared limits* — and, for
`trusted`, a human has signed off.

## What this forbids

- ❌ Auto-overwriting a live/trusted pack because a manual's hash changed.
- ❌ Promoting a candidate to `trusted` from any automated job.
- ❌ Ingesting a "newer" manual straight into `mira-bots/shared/drive_packs/packs/`.
- ❌ Treating "the crawler found it" or "the extractor ran" as trust.

## What the pipeline does instead

1. `check.py` detects a hash change (`changed_by_hash`).
2. `update_candidate.py` generates + grades a candidate under `candidates/` — **never** `packs/`
   (enforced by `assert_not_live_packs`).
3. The candidate carries a trust status the automated grader caps at `beta`
   (`trusted` is impossible from automation — see `report.py::compute_trust_status`).
4. A human reviews (`runbook-drive-manual-update-acceptance.md`) and, only then, promotes and
   records the new `pdf_sha256` + `pack_trust_status` in the registry.
5. The **old pack stays live** until the replacement is approved.

## The discovery bridge is candidate-only too

The manual-discovery fleet is now wired to this path via `mira-crawler/drive_pack_bridge.py`
(default-off, `MIRA_DRIVE_PACK_BRIDGE=1`), fired from `kb_growth_cron` after a **successful** KB
ingest. It carries the same rule end-to-end: **a discovered/changed manual creates a review-only
candidate record, never a trusted pack.** The bridge does NOT run the extractor/grader inline and
structurally cannot write into `mira-bots/shared/drive_packs/packs/` — it only records
`{trust_status:"candidate", promoted:false, review_only:true}` under `~/.mira/drive-pack-candidates/`,
with the `next_step` command a human runs to extract + grade + review. Full runbook:
`docs/runbooks/manual-kb-ingest-to-drive-pack-bridge.md`.

So neither a crawler finding a PDF, nor the AB hunter downloading one, nor this bridge creating a
candidate, ever changes MIRA's diagnostic truth. Only extraction + grading + cite-integrity +
domain checks + **human approval** do.

## Enforcement

- `mira-crawler/drive_pack_bridge.py` — default-off, STOP_INGEST-aware, fail-open; writes only a
  review-only candidate record (`trust_status:"candidate"`, `promoted:false`) outside `packs/`.
- `registry/update_candidate.py::assert_not_live_packs` — refuses to write into the served tree.
- `registry/update_candidate.py::assemble_candidate_report` — hard-codes `promoted: false`.
- `grading/report.py` — automated ceiling is `beta`; `trusted` needs a recorded human sign-off.
- Tests: `mira-crawler/tests/test_drive_pack_bridge.py` (default-off, STOP_INGEST, fail-open,
  unchanged-no-op, changed/new→candidate, never-targets-packs, review-only, provenance) +
  `registry/tests/test_update_candidate.py` (no-auto-promote, no-live-packs, unchanged-noop).
