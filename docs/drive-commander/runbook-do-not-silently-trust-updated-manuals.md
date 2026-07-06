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

## Enforcement

- `registry/update_candidate.py::assert_not_live_packs` — refuses to write into the served tree.
- `registry/update_candidate.py::assemble_candidate_report` — hard-codes `promoted: false`.
- `grading/report.py` — automated ceiling is `beta`; `trusted` needs a recorded human sign-off.
- Tests: `registry/tests/test_update_candidate.py` (no-auto-promote, no-live-packs, unchanged-noop).
