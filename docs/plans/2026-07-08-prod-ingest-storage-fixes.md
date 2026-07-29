# Prod ingest storage fixes — embedder (Bravo Ollama) + KG upsert `ON CONFLICT`

**Status:** Root Cause 1 **RESOLVED 2026-07-08** (see "Resolution" below); Root Cause 2 (KG upsert) still open.
**Original owner decision (embedder architecture) — settled:** keep Bravo, hardened via a rebind (not a resource fix).

## Resolution (2026-07-08) — Root Cause 1 was a BIND issue, not "down/starved"

The scan corrected the diagnosis: Bravo is healthy (16 GB RAM, 77% free, **0 swap**, up 10 days) and **Ollama was already running with `nomic-embed-text` pulled** — it was simply **bound to `127.0.0.1:11434`** (no `OLLAMA_HOST` set), so the prod VPS's `100.86.236.11:11434` request was refused. Fix: added `OLLAMA_HOST=100.86.236.11:11434` to the brew launchd plist (`~/Library/LaunchAgents/homebrew.mxcl.ollama.plist`, backed up first) + reloaded via `launchctl bootout/bootstrap`. Now `lsof` shows `TCP 100.86.236.11:11434 (LISTEN)` and the prod VPS reaches it (sees `nomic-embed-text:latest`).

**Re-ran the #2562 OCR proof e2e → PASS:** `OCR (Tika) 224 chars → KB ingest: 1 chunk stored → done`; `knowledge_entries` row `669f7a86-…` has a 768-dim embedding and is content-searchable (`MIRAOCRPROOF*` → 1 hit). Memory safe (VPS min-avail 2061 MB; embedding compute runs on Bravo). **OCR is now citable end-to-end on prod.**

**Caveats / hardening follow-ups (still worth doing):**
- **Boot-order:** binding to the specific Tailscale IP means if Bravo reboots before Tailscale is up, `ollama serve` can't bind that IP and fails to start. Add a login/health watchdog, or fall back to `0.0.0.0` if this bites.
- **`brew services restart` may regenerate the plist** and drop `OLLAMA_HOST` — re-apply if that happens (the pre-existing custom env vars suggest manual plist edits have persisted here so far).
- **Localhost on Bravo:** Ollama no longer answers on `127.0.0.1:11434` (bound to the tailnet IP only) — if any local Bravo process needs it, switch to `0.0.0.0`.
- **Add monitoring** so a silent Ollama death (or wrong bind after an update) is caught, rather than surfacing weeks later as empty KB growth.

---

_Original plan (diagnosis + options) preserved below for the record; Root Cause 1 sections describe the pre-fix state._

## Summary

The 2026-07-08 OCR activation proof (issue #2562 Phase 1) showed the OCR path
**works end-to-end** (a scanned PDF → Tika/Tesseract → 224 chars) but the chunk
was **never stored** and is **not citable**. Two independent storage-layer
defects, neither caused by the OCR work:

1. **PRIMARY — the prod embedder is down.** Prod ingest embeds via Bravo's
   home-lab Ollama, which is offline → 0 chunks stored for **every** manual
   (OCR *and* text-layer). This blocks all KB growth on prod, not just OCR.
2. **SECONDARY — KG `upsert_entity` `ON CONFLICT` errors** despite a matching
   unique index, aborting the KG-write transaction.

## Evidence (from the #2562 Phase-1 run, all read-only / reversible)

```
Download: cached (ocr_proof.pdf)
OCR (Tika) extracted 224 chars from ocr_proof.pdf      # OCR works
Chunked 1 blocks → 1 chunks
Embed attempt 1/3 failed: [Errno 111] Connection refused
Embed failed after 3 attempts: [Errno 111] Connection refused
KB ingest: 0 chunks stored                              # <-- storage blocked
upsert_entity equipment/ocrtest::proof failed: there is no unique or
  exclusion constraint matching the ON CONFLICT specification
```
`knowledge_entries` had **0 rows** for the test doc afterward. Memory stayed
safe throughout (MemAvailable 2853 → min 2354 MB; swap untouched).

## Root Cause 1 (PRIMARY): prod embeddings depend on Bravo's Ollama, which is down

- The crawler is **not** hardwired — `mira-crawler/tasks/full_ingest_pipeline.py:62`
  reads `OLLAMA_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")` and
  passes it to `embedder.embed_batch` (line 265). The SaaS containers do the same
  (`docker-compose.saas.yml`, `EMBED_TEXT_MODEL=nomic-embed-text`).
- In Doppler `factorylm/prd`, `OLLAMA_BASE_URL = http://100.86.236.11:11434` —
  that's **Bravo's Tailscale IP** (the home-lab "Compute (Ollama)" node in the
  Node Map).
- From the prod VPS: `curl http://100.86.236.11:11434/api/tags` →
  `curl: (7) Couldn't connect to server` (rc=7, 29 ms — route exists, **port
  closed**). Bravo's Ollama is offline.
- **Impact:** every prod ingest embeds to a dead endpoint → `0 chunks stored`.
  Prod KB growth has silently produced nothing storable for as long as Bravo's
  Ollama has been down. (The idle empty queue masked it until the #2562 proof
  fed a real PDF.)

### Hard constraint: 768-dim consistency
`knowledge_entries.embedding` is **`vector(768)`** (nomic-embed-text). Any
replacement embedder MUST emit 768-dim vectors from a nomic-embed-text-equivalent
model, or the entire existing corpus (~83k chunks) becomes un-comparable and
would need a full re-embed. This rules out naively swapping in a different-dim
cloud provider.

### Options
| Option | What | Pros | Cons |
|---|---|---|---|
| **A. Revive Bravo Ollama** (immediate) | Operator restarts Ollama on Bravo (100.86.236.11) | Zero code, restores today, 768-dim preserved | Fragile — prod SaaS depends on a home-lab node over Tailscale |
| **B. Prod-resident Ollama container** | Add `mira-ollama` to `docker-compose.saas.yml`, pull `nomic-embed-text`, point `OLLAMA_BASE_URL` at it | Self-contained prod; 768-dim preserved; no home-node dependency | Memory — VPS has ~2.9 GB available (swap-heavy) and Tika (1 GB) is now resident; nomic-embed-text needs ~0.5–1 GB. Tight without a droplet bump |
| **C. Cloud embedding provider** | Route embeds to a hosted nomic-embed-text-compatible 768-dim endpoint | No local memory; robust | Must find a 768-dim nomic-equivalent provider; new provider plumbing + key; free-tier limits |
| **D. Fallback chain** | Try configured Ollama → fall back to B or C | Resilient | Most code; only worth it after B/C exists |

### Recommendation
- **Immediate (operator, today):** **Option A** — restart Ollama on Bravo so prod
  KB growth resumes now. Verify from the VPS: `curl http://100.86.236.11:11434/api/tags`
  lists `nomic-embed-text`.
- **Durable (decide):** **Option B** if we bump the droplet (or after freeing
  memory), else **Option C**. Prod SaaS should not depend on a home node
  long-term. **This is the owner decision that gates the durable fix.**

## Root Cause 2 (SECONDARY): KG `upsert_entity` `ON CONFLICT` fails despite a matching index

- `mira-crawler/ingest/kg_writer.py:130` — `ON CONFLICT (tenant_id, entity_type, name) DO UPDATE`.
- Prod **has** a matching, **non-partial** unique index:
  `CREATE UNIQUE INDEX kg_entities_tenant_type_name_key ON public.kg_entities USING btree (tenant_id, entity_type, name)`.
  So inference *should* succeed — the error is anomalous.
- Candidate causes to check on a **staging** repro (do not guess-fix prod):
  1. Connection `search_path` / role: does the ingest connection resolve
     `kg_entities` to `public` (where the index lives)?
  2. Column type/collation mismatch between the index and the inserted values.
  3. The index was added after a cached prepared statement / stale plan.
- **Candidate fix (robust regardless of cause):** promote the unique index to a
  named constraint so inference is unambiguous —
  `ALTER TABLE kg_entities ADD CONSTRAINT kg_entities_tenant_type_name_uq UNIQUE USING INDEX kg_entities_tenant_type_name_key;`
  (via `apply-migrations.yml`, dev → staging → prod), then optionally switch the
  code to `ON CONFLICT ON CONSTRAINT kg_entities_tenant_type_name_uq`.
- **Priority: secondary** — this blocks the *knowledge-graph* write, not the
  citable `knowledge_entries` chunk (that's Root Cause 1). Fix after the embedder.

### RC2 deeper diagnosis (2026-07-08, read-only on prod) — CONFIRMED secondary, cause still anomalous
- **Confirmed independent of citability:** a clean ingest run stored the chunk
  (`KB ingest: 1 chunks stored`, entry `done`) **while** `upsert_entity` errored —
  so the KG failure does NOT roll back the KB chunk (`step_kb_ingest` and `step_kg`
  are separate calls / transactions). OCR→citable is unaffected.
- **Reproducible:** every ingest of the test doc logs
  `upsert_entity equipment/… failed: no unique or exclusion constraint matching the
  ON CONFLICT specification`, then the remaining 3 KG upserts hit
  `current transaction is aborted` (all 4 share one connection; the first aborts it).
- **Ruled out by inspection (so the cause is genuinely anomalous):**
  index `kg_entities_tenant_type_name_key` is `valid=true, ready=true, unique=true`,
  **non-partial**, on exactly `(tenant_id, entity_type, name)`; `kg_entities` is a
  plain table (`relkind=r`), **no** partitioning/view, **0** duplicate
  `(tenant_id,entity_type,name)` groups, **0** user triggers, **0** rewrite rules,
  **no** schema shadowing (single `public.kg_entities`; unqualified name resolves to
  it; `search_path="$user",public`); `kg_writer` shares `store`'s engine
  (`NEON_DATABASE_URL`) — the same DB where the chunk stored fine. By every static
  check `ON CONFLICT (tenant_id, entity_type, name)` should infer this index.
- **Next step (needs a live repro — do NOT guess-fix prod):** reproduce the exact
  `INSERT … ON CONFLICT` on **staging** (Neon `factorylm/stg`) with `SET ROLE` matching
  the app; capture the true failure. Likely candidates left: a collation/opclass subtlety
  on the text columns, or a client-side statement issue. **Robust fix regardless of cause:**
  promote the index to a named constraint (`ALTER TABLE … ADD CONSTRAINT … UNIQUE USING INDEX
  kg_entities_tenant_type_name_key`) via `apply-migrations.yml` and switch the code to
  `ON CONFLICT ON CONSTRAINT …` (named target sidesteps inference). Verify on staging before prod.

## Verification (re-run the #2562 Phase-1 proof once the embedder is back)
1. Restore the embedder (Option A now, B/C later).
2. Re-run the exact OCR proof (synthetic image-only PDF → queue one → `kb_growth`).
3. **Expect:** `Embedded 1/1 succeeded` → `KB ingest: 1 chunk stored` →
   `knowledge_entries` row present → searchable/citable by the token.
4. Re-check the KG upsert error is gone (Root Cause 2) or file it separately.

## Not doing here (scope)
- No prod code change or deploy in this PR — it's a plan.
- No sustained ingest / queue repopulation (issue #2562 Phase 4).
- The queue-reset-on-deploy item is de-prioritized: `kb_growth_cron.py:162`
  documents `manual_queue.json` as "not version-controlled", so that framing may
  already be resolved — verify separately.

## Related
- Issue #2562 (OCR proof + this follow-up), #2513 (prod ingest + VPS memory)
- `mira-crawler/ingest/embedder.py`, `mira-crawler/tasks/full_ingest_pipeline.py`,
  `mira-crawler/ingest/kg_writer.py`
- Node Map (Bravo = Ollama, 100.86.236.11) in root `CLAUDE.md`
