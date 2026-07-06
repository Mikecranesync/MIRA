# Runbook — Manual KB Ingest → Drive-Pack Candidate Bridge

The bridge that connects the **manual-discovery fleet** to the **trust-graded drive-pack path**. When a manual PDF is successfully ingested into the KB, it *optionally* creates a **review-only drive-pack update candidate** — never a trusted pack.

> **The bridge turns successful manual KB ingest into a reviewable drive-pack update candidate, but it cannot promote or replace a trusted pack.**

## Where it runs

- **Insertion point:** `mira-crawler/cron/kb_growth_cron.py::_process_entry`, the **success branch** (right after `entry["status"]="done"`). This is the only place with `manufacturer`/`model` and the downloaded PDF simultaneously in scope after a successful ingest.
- **Logic:** `mira-crawler/drive_pack_bridge.py` (`maybe_create_candidate`). The call site is a small `try/except` that **fails open** — a bridge error never fails the (already successful) KB ingest.

## Default OFF

The bridge does nothing unless enabled:

```bash
export MIRA_DRIVE_PACK_BRIDGE=1   # default "0" = disabled, bridge is a no-op
```

## What it does (per successfully-ingested manual)

1. **Honor `~/.mira/STOP_INGEST`** — if the kill switch is set (operator or guardrails), skip.
2. **Locate the PDF** — read-only, by mirroring the ingest pipeline's cache convention `MANUALS_ROOT/{mfr}/{model}/{basename}.pdf` (`full_ingest_pipeline.py` ~L574). Missing → **fail open** (`no_local_pdf`).
3. **Compute the PDF SHA-256.**
4. **Map `(manufacturer, model)` → a registry entry** in `tools/drive-pack-extract/registry/sources.json` (match on model, since discovery says "Allen-Bradley" while the registry says "Rockwell"). No match → **fail open** (`no_registry_match`, with a clear report).
5. **Classify** via the registry: `unchanged` (hash == approved) → **no-op**; `changed_by_hash` / `needs_initial_candidate` (known family, new/changed) → **create a candidate**.
6. **Write a review-only candidate record** (see below). It **never** runs the extractor/grader inline and **never** touches `mira-bots/shared/drive_packs/packs/`.

Throttle/guardrails are inherited: the bridge only fires on entries the hourly cron already selected (batch-capped by `KB_GROWTH_BATCH_SIZE`), and honors STOP_INGEST.

## Candidate record (shape + location)

- **Location (runtime, not the repo):** `~/.mira/drive-pack-candidates/<manual_id>/candidate-<sha12>.json` (override: `MIRA_DRIVE_PACK_CANDIDATE_DIR`). Never under `packs/` or the committed `candidates/` tree.
- **Provenance (complete):** `manufacturer`, `model`, `manual_id`, `vendor`, `product_family`, `publication`, `revision`, `source_url`, `pdf_sha256`, `previously_registered_sha256`, `ingest_timestamp`, `local_pdf_path`.
- **Trust markers (hard):** `trust_status: "candidate"`, `review_only: true`, `promoted: false`. It can never read as a trusted pack.
- **`next_step`:** the exact command to extract + grade it — `python tools/drive-pack-extract/registry/update_candidate.py --manual <path> --id <manual_id>`.

## What happens next (human-gated)

```
manual ingested → hash computed → registry checked
   → unchanged: no-op
   → changed/new: candidate record created (review-only)
        → operator runs update_candidate.py → extract + grade (schema/cite/domain/gold)
             → human reviews the grading report (runbook-drive-manual-update-acceptance.md)
                  → approve → promote  |  reject → discard
```

The bridge does the first two lines. **Everything after "candidate record created" is deliberate and human-approved.** No automated step promotes.

## Operator checklist to enable

1. Confirm the drive family is registered (`tools/drive-pack-extract/registry/sources.json`; `docs/drive-commander/workflow-register-a-manual-source.md`).
2. Set `MIRA_DRIVE_PACK_BRIDGE=1` in the cron's env (Doppler).
3. Watch `~/.mira/drive-pack-candidates/` and the cron log line `drive-pack candidate: <id> (<state>) → <path>`.
4. For each candidate, run its `next_step`, review, and accept/reject per the acceptance runbook.

## Why this cannot silently rewrite trusted diagnostic truth

- It only ever **writes a candidate record** — it does not run the extractor, does not write a pack, and structurally cannot target `packs/`.
- Trust requires the full grading gate + a recorded human approval (`report.py` caps automation at `beta`; `trusted` is a human sign-off).
- Default-off + STOP_INGEST-aware + fail-open: it can be disabled instantly, and it never blocks or corrupts KB ingest.
- The old trusted pack stays live until a human approves a replacement (`runbook-do-not-silently-trust-updated-manuals.md`).
