# Discovery — Prod manual-ingest is broken (dead docling) + VPS memory over-subscription

**Date:** 2026-07-07
**Context:** enabling the DriveSense drive-pack bridge (`MIRA_DRIVE_PACK_BRIDGE=1`) on prod and
verifying it produces candidates. Investigation was **read-only** on `factorylm-prod` (except the
Doppler flag-set and one bridge one-shot, both noted below). Nothing was restarted or rebuilt.

## TL;DR

1. **The drive-pack bridge is correctly enabled on prod and proven to work** — but the *automatic*
   candidate flow is blocked by a pre-existing, unrelated prod bug.
2. **`kb_growth_cron` manual ingest has silently failed for ~3 weeks:** `mira-docling` was
   removed on 2026-06-06 (OOM) but `full_ingest_pipeline` still calls it at `:5001` →
   `Connection refused` on every PDF.
3. **The 8 GB VPS is over-subscribed** — a full **staging stack runs alongside prod**, plus two
   MinIO instances and JVM services; swap is 3.6 / 4.0 GiB. That's why there is no room to bring
   docling back, and it's the thing to fix before adding any memory-heavy service.

## Access note (for future sessions)

The prod VPS is reachable from the dev box as **`ssh factorylm-prod`** (SSH config alias →
`165.245.138.91` / Tailscale `factorylm-prod` 100.68.120.99, `User root`,
`IdentityFile ~/.ssh/id_factorylm`). Using the **raw IP** fails `publickey` because it does not
match the `Host factorylm-prod` block, so the key/user are never applied — use the alias.

## Finding 1 — the bridge is enabled + proven on prod

- `MIRA_DRIVE_PACK_BRIDGE=1` set in Doppler `factorylm/prd`. Verified the cron actually receives it:
  `cd /opt/mira && doppler run -- printenv MIRA_DRIVE_PACK_BRIDGE` → `1`. The hourly cron
  (`0 * * * * … doppler run -- python3 mira-crawler/cron/kb_growth_cron.py`) will run with it active.
- Proved candidate creation on the live box via a one-shot against the already-cached PDF
  `/opt/mira/manuals/Allen-Bradley/PowerFlex-525/520-qs001_-en-e.pdf` →
  `status=candidate_created`, `/root/.mira/drive-pack-candidates/rockwell_powerflex_525_520-um001/candidate-15e69e83f7c6.json`
  (`review_only:true`, `promoted:false`, `trust_status:candidate` — a legit test candidate; removable).
- **Rollback:** `doppler secrets delete MIRA_DRIVE_PACK_BRIDGE --project factorylm --config prd` (or set `0`).

## Finding 2 — manual ingest is broken (dead docling), so the *automatic* flow can't fire

Every hourly `kb_growth_cron` run logs `Docling failed: [Errno 111] Connection refused` and ends
`done=1 / failed_retryable=5`, queue stuck at `remaining=34` (identical at 02:00 / 03:00 / 04:00).

- `docker ps -a` shows **no `mira-docling` container** (absent, not crashed).
- `docker-compose.override.yml` comment: *"mira-docling override removed 2026-06-06"*;
  `docker-compose.saas.yml` references `failures-docling-oom.md` and a Tika/Tesseract OCR engine as
  the replacement extraction path.
- **The bug:** `mira-crawler/tasks/full_ingest_pipeline.py` still calls docling at `:5001`. It was
  never repointed to the Tika/OW path prod moved to. So all manual ingest Connection-refuses.
- **Direct consequence:** a real `Allen-Bradley PowerFlex-525` manual is in the queue and FAILS
  every hour purely because of this. Fix the extraction path and that manual ingests → the bridge
  fires automatically (no one-shot needed).

## Finding 3 — VPS memory over-subscription (why docling can't just come back)

`free -h`: **7.8 GiB total, ~400 MiB free, swap 3.6 / 4.0 GiB used.** Not one hog — too many stacks
co-resident:

| Consumer | Note |
|---|---|
| **Staging stack on the prod box** | `stg-atlas-api` 472 MiB, `stg-atlas-minio` 231 MiB, `stg-mira-hub` 82 MiB, `stg-mira-mcp` 86 MiB (~**870 MiB+** RSS) — staging should not be co-resident with prod on a memory-starved box |
| **Two MinIO instances** | `stg-atlas-minio` 231 MiB + `cmms_minio` 221 MiB + 2 host `minio` procs (237 + 216 MiB RSS) |
| **JVM services** | `java` 478 MiB RSS + a 2nd `java` 161 MiB; `java` is the #1 swap consumer (777 MiB swapped) |
| Swap-heaviest procs | java 777 · python3 589 · redis 450 · node 344 · celery 282 MiB swapped |

The box also runs prod mira-* (core/hub/ingest/pipeline/mcp/bots/historian), CMMS (Atlas), Flowise,
Redis, Mosquitto. It is genuinely over-committed.

## Recommendations (not actioned — user's call)

1. **Fix the ingest bug (highest value):** repoint `full_ingest_pipeline` off the removed docling
   onto the Tika/OW extraction path prod already uses. Unblocks ~3 weeks of broken manual ingest
   **and** makes the drive-pack bridge fire automatically. No OOM risk (Tika is already the engine).
2. **Reclaim memory:** move the **staging stack off the prod VPS** (~870 MiB+ RSS + swap). Staging
   co-resident with prod on an 8 GB box is the root of the memory pressure. Consolidate the two
   MinIO instances if feasible.
3. **Only then** consider whether docling is even wanted back (Tika path may be sufficient) — do not
   restore docling onto the box as-is; it will re-OOM.

## Cross-references

- `mira-crawler/tasks/full_ingest_pipeline.py` — the still-calls-docling code path (the bug).
- `mira-crawler/cron/kb_growth_cron.py` — the hourly cron + drive-pack bridge call site.
- `docker-compose.override.yml` / `docker-compose.saas.yml` — the 2026-06-06 docling removal + Tika path.
- `docs/runbooks/manual-kb-ingest-to-drive-pack-bridge.md` — the bridge runbook.
