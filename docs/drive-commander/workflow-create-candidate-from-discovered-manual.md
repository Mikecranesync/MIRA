# Workflow — Creating a Drive-Pack Update Candidate from a Discovered Manual

How a manual that the discovery fleet found (and ingested into the KB) becomes a **reviewable drive-pack update candidate** — and how a human turns that into a graded, approved pack. The automated part stops at "candidate"; trust is earned by the human steps.

## The two halves

| Half | Who | What |
|---|---|---|
| **Auto (default-off)** | `kb_growth_cron` + `drive_pack_bridge.py` | successful KB ingest → hash → registry check → **candidate record** (review-only) |
| **Human-gated** | operator | extract + grade the candidate → review → approve/reject → promote |

## A. Automatic candidate creation (the bridge)

Enabled with `MIRA_DRIVE_PACK_BRIDGE=1` (default off). On each successfully-ingested manual, the bridge writes `~/.mira/drive-pack-candidates/<manual_id>/candidate-<sha12>.json` **iff** the manual maps to a known drive family and its hash is new/changed. Full behavior: `docs/runbooks/manual-kb-ingest-to-drive-pack-bridge.md`.

A candidate record is **not** a pack — it's a provenance-complete trigger that says "this known manual changed; someone should extract + grade + review it." `trust_status: "candidate"`, `promoted: false`.

## B. Manual candidate creation (no cron needed)

You can create the same candidate by hand from any local PDF:

```bash
cd tools/drive-pack-extract
python registry/check.py --manual manuals/<file>.pdf --id <manual_id>          # new/unchanged/changed?
python registry/update_candidate.py --manual manuals/<file>.pdf --id <manual_id>  # extract + grade
```

`update_candidate.py` reuses the extractor + grader, writes `candidates/<pack>/{pack.json,PROVENANCE.md,grading_report.md,candidate_report.md}`, and **never promotes** (writes only under `candidates/`, `promoted:false`, ceiling `beta`).

## C. Grade + review + promote (human)

1. Read `candidate_report.md` (trust status, cite/domain results, pack-diff vs previous, reviewer checklist).
2. Run the reviewer checklist in `docs/drive-commander/runbook-drive-manual-update-acceptance.md`.
3. Approve → copy the reviewed `pack.json` into the live `mira-bots/shared/drive_packs/packs/<pack>/`, commit the `grading_report.md`, and update the registry's `pdf_sha256` + `pack_trust_status` + `approval`. Reject → discard the candidate.
4. The previous pack stays live until step 3 completes.

## Lifecycle

```
source discovered → manual fetched/ingested → PDF hash recorded → registry checked
   → unchanged: no-op
   → changed/new: CANDIDATE created (review-only)
        → extract + grade (schema · cite-integrity · domain · gold)
             → human review (acceptance runbook)
                  → approve → pack promoted   |   reject → superseded/discarded
```

## Guarantees

- A changed manual **creates a candidate, never replaces a trusted pack** (`runbook-do-not-silently-trust-updated-manuals.md`).
- No automated step promotes; `trusted` requires a recorded human sign-off.
- Bridge is default-off, STOP_INGEST-aware, and fail-open — it never affects KB ingest.
