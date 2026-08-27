# approved_context_retrieval — production runtime proof (2026-08-27)

Closes the `production_no_evidence` acknowledgement on `approved_context_retrieval`
(#3328). PR #3416 plumbed `MIRA_ENFORCE_APPROVED_RETRIEVAL` into every consumer;
this file records the post-deploy observation the registry demanded.

**Deploy:** #3416 merged as `dd65c57eb` (tag `v3.297.5`, `rollback/2026-08-27-v3.297.5`);
`deploy-vps.yml` run on that SHA → success. Consumers restarted 09:35–09:36Z.

## 1. The variable reaches every consumer (`docker inspect`, read-only, VPS)

| container | state | started (UTC) | `MIRA_ENFORCE_APPROVED_RETRIEVAL` |
|---|---|---|---|
| mira-bot-telegram | running | 2026-08-27T09:36:08Z | `true` |
| mira-bot-slack | running | 2026-08-27T09:36:08Z | `true` |
| mira-ask-saas | running | 2026-08-27T09:35:09Z | `true` |
| mira-pipeline-saas | running | 2026-08-27T09:35:09Z | `true` |
| mira-hub | running | 2026-08-27T09:35:09Z | `true` |

## 2. The process reads it (in-process, `docker exec … python -c`)

```
mira-ask-saas:      gate_enabled= True filter= ' AND verified = true'
mira-pipeline-saas: gate_enabled= True filter= ' AND verified = true'
mira-bot-telegram:  gate_enabled= True filter= ' AND verified = true'
```
(`shared.neon_recall.approval_gate_enabled()` / `_approval_filter_sql()`, the live read at
`neon_recall.py:133-142`.)

## 3. Unverified chunks are refused (the app's own `recall_knowledge`, prod DB)

Probe run inside `mira-ask-saas` through `shared.neon_recall.recall_knowledge(None, tenant, 10,
query_text=q)` (BM25 path, no raw SQL), 8 queries × 2 tenants (system `78917b56…`, garage
`e88bd0e8…`), toggling the flag in-process (it is read live, not at import):

| gate | rows returned | rows with `verified = false` |
|---|---|---|
| `false` | 162 | **28** |
| `true` | 162 | **0** |

Queries that surfaced unverified rows with the gate off (all refused with it on):
`GS10 CE10 communication error` → 8 · `bearing replacement torque spec` → 3 ·
`pump seal leak maintenance procedure` → 2 · `VFD parameter setting acceleration` → 1.

Row counts are identical in both modes because the OEM corpus is backfilled `verified=true`
(`tools/seeds/backfill_verified_corpus.sql`) — the gate removes unapproved rows without
starving retrieval, the designed direction (#3416 direction check).

## Not proven here
- `mira-hub` reads the same flag in TypeScript (`manual-rag.ts:81`, `approved-context.ts:23`);
  only its container env was observed (§1), not an in-process call.
- Owner for the capability is still unrecorded (product decision).
