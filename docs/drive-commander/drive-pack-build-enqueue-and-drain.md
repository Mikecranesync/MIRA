# Drive-pack candidate accept → build + grade (enqueue / drain)

**Issue:** #2544 (part of #2537, audit §6 gap #6). **Doctrine:** ADR-0025,
`.claude/rules/train-before-deploy.md`, `runbook-drive-manual-update-acceptance.md`.

## The gap

Accepting a `drive_pack_update` `ai_suggestions` row (mig 062) via
`/api/suggestions/[id]/decide` → `mira-hub/src/lib/suggestion-accept.ts` was **status-only**: it
flipped the row to `accepted` but never ran the extractor + grader. The real work is a Python CLI —
`tools/drive-pack-extract/registry/update_candidate.py` — which classifies the changed manual, runs
the family generator + grading harness, and stages a candidate + grading report.

## The shape (enqueue + drain, no synchronous shell-out)

The Hub is Next.js/TypeScript. It must **not** shell out to Python synchronously inside an HTTP
request. So the work is split:

1. **Enqueue (Hub, `suggestion-accept.ts`).** On accept of a `drive_pack_update` suggestion,
   `markDrivePackBuildRequested()` writes a durable marker onto the row's own `extracted_data`:
   `build_requested=true`, `build_requested_at=now()`, `build_status='requested'`. **The row IS the
   queue** — no new table, no migration. This is a data annotation, not a status transition, so it
   does not go through the ADR-0017 helper (which governs the `status` column). Reject enqueues
   nothing.

2. **Drain (Python worker, `tools/drive-pack-extract/registry/drain_build_requests.py`).** Reads
   rows where `suggestion_type='drive_pack_update' AND status='accepted' AND
   build_requested=true AND build_status='requested'`, and for each invokes `update_candidate.py`
   (`--manual <local_pdf_path> --id <registry_manual_id>`), which runs the generator + grader as
   subprocesses. It then flips `build_status` off `requested` (→ `built` / `failed`) so a marker is
   drained at most once. DB I/O is injected (`drain(load_requests, save_result, runner=…)`) so the
   policy core is unit-tested offline; `main()` wires psycopg2 to `NEON_DATABASE_URL` /
   `DATABASE_URL`.

```
accept (Hub)            drain (Python cron/ops)
──────────────          ─────────────────────────────────────────────
ai_suggestions row  ->  update_candidate.py  ->  candidates/<family>/
  build_requested=1       (generator+grader)       pack.json + grading_report.*
  build_status=          assert_not_live_packs      candidate_report.{json,md}
   'requested'           (guard)                    build_status -> built|failed
```

## The trust gate is preserved

`update_candidate.py` writes **only** into the staged `candidates/` tree and is guarded by
`assert_not_live_packs()` — it can never write into the live served
`mira-bots/shared/drive_packs/packs/` tree. The drain passes **no** `--out` override, so this holds.
**Auto-promotion candidate → live is forbidden.** Promotion to a trusted pack remains a separate,
human-gated step (the `candidate_report.md` reviewer checklist + a recorded sign-off).

## Running the drain

```bash
NEON_DATABASE_URL=… python tools/drive-pack-extract/registry/drain_build_requests.py [--limit N]
```

Intended as an ops/cron step (or a bench run). It is idempotent — already-built rows are not
re-selected. A request whose manual PDF is no longer cached (`local_pdf_path` empty) fails cleanly
with a reason rather than running.

## Tests

- Python: `tools/drive-pack-extract/registry/tests/test_drain_build_requests.py` — runner invoked
  with manual + id and **no** `--out` (→ never targets `packs/`), rc→status mapping, missing
  provenance fails without running, `drain` writes a result back for every request.
- Hub: `mira-hub/src/lib/__tests__/suggestion-accept.test.ts` — accept writes the durable
  build-requested marker (`build_status='requested'`, no entity); reject enqueues nothing.
