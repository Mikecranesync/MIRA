# OEM-manual KB Seed — Garage Devices

Targeted KB seed for the garage RS-485 commissioning rig:
**Allen-Bradley Micro820 2080-LC20-20QBB** + **AutomationDirect GS10 DURApulse VFD** over Modbus RTU.

## Why this seed exists

The 2026-05-15 NeonDB audit (`tools/kb_audit.py` style) found:

| Audit finding | Count |
|--------------|------:|
| Total chunks in tenant KB | 83,542 |
| Rockwell PowerFlex coverage (broad) | ~12,000 ✓ |
| AutomationDirect (broad) | ~3,500 ✓ |
| GS10 / GS11 / Micro820 chunks **with NULL embedding** (RAG-invisible) | 28 |
| Specific content gaps mapped to the active commissioning blocker | 5 |

The 5 specific gaps were the **smoking gun** — they map 1:1 to Mike's RS-485 commissioning blocker logged in `plc/RESUME_VFD_COMMISSIONING.md`:

- GS10 fault `ocd` (deceleration over-current)
- Micro800 MSG `ErrorID 55` (timeout — the field-debug case for swapping D+/D-)
- Micro800 MSG `ErrorID 255` (MSG block never completed — the present blocker)
- CCW "embedded serial out of sync" message (the present blocker)
- CCW TCPIPObject download failure procedure (the present blocker)

## What it does

`apply_oem_seed.py` runs two phases:

1. **Backfill embeddings** on the 28 existing garage-device chunks that lack them. They were already authored (mostly by Mike) and verified — they just never got embedded, so vector-cosine retrieval can't reach them. After backfill, every existing garage chunk becomes RAG-visible.
2. **Insert 8 new chunks** from `chunks.jsonl`, each targeting one of the 5 gaps or shoring up the wire-level physical layer + commissioning decision tree. Embeddings are generated inline via Bravo's Ollama (`nomic-embed-text`, 768-dim).

Idempotent — re-runs skip already-embedded rows and dedupe new chunks by `metadata.chunk_key`.

## Running it

**Where:** must run from a node that can reach Bravo (LAN `192.168.1.11:11434`) — Charlie, Alpha, or any Tailnet member. **NOT** GitHub Actions ubuntu-latest runners (they can't reach the LAN Ollama).

```bash
# dry-run first
doppler run -p factorylm -c prd -- \
  python3 tools/seeds/oem-manuals/apply_oem_seed.py --dry-run

# real run
doppler run -p factorylm -c prd -- \
  python3 tools/seeds/oem-manuals/apply_oem_seed.py

# backfill only (skip new chunks)
doppler run -p factorylm -c prd -- \
  python3 tools/seeds/oem-manuals/apply_oem_seed.py --skip-new

# new chunks only (skip backfill)
doppler run -p factorylm -c prd -- \
  python3 tools/seeds/oem-manuals/apply_oem_seed.py --skip-backfill

# from a node without LAN access to Bravo (override Ollama URL):
doppler run -p factorylm -c prd -- \
  python3 tools/seeds/oem-manuals/apply_oem_seed.py \
    --ollama-url http://100.86.236.11:11434  # Bravo Tailscale IP
```

## File layout

- `chunks.jsonl` — one chunk per line. Source of truth for content.
- `apply_oem_seed.py` — applier (embed-then-insert, with backfill phase).
- `../oem-manuals-knowledge.sql` — companion SQL with the same chunks (NULL embeddings). Human-readable form for PR review and disaster-recovery use.
- `README.md` — this file.

## Adding more chunks

1. Append a JSONL line to `chunks.jsonl`. Required fields: `chunk_key`, `manufacturer`, `model_number`, `source_type`, `chunk_type`, `source_url`, `content`. Optional: `metadata` (any JSON object — `chunk_key` is auto-added).
2. Pick a `chunk_key` that starts with a distinguishing prefix (e.g., `gs10-`, `micro800-`, `garage-`) and ends with the date `YYYY-MM-DD` so re-seeds don't clash.
3. The first 200 chars of `content` should NOT match any existing chunk in NeonDB (`entry_exists` check in `tools/vendor_coverage_ingest.py` keys on `LEFT(content, 200)`). The new chunks here all start with `"MIRA garage reference —"` to guarantee uniqueness.
4. Run with `--dry-run` first to see what would change.
5. After running, verify with:
   ```sql
   SELECT metadata->>'chunk_key' AS k, manufacturer, model_number,
          (embedding IS NOT NULL) AS has_emb
   FROM knowledge_entries
   WHERE tenant_id = '78917b56-f85f-43bb-9a08-1bb98a6cd6c3'
     AND metadata->>'chunk_key' LIKE '%-2026-05-%'
   ORDER BY k;
   ```

## CI / GitHub Actions

`.github/workflows/seed-oem-manuals.yml` provides a manual `workflow_dispatch` trigger.

- It **validates** the JSONL/SQL on ubuntu-latest (parses chunks, lints SQL, dry-runs the applier without touching the DB).
- It does **NOT** execute the actual seed — GitHub-hosted runners can't reach Bravo's Ollama on the LAN. After PR merge, an operator (Mike or anyone on the Tailnet) runs the bash command above from Charlie/Alpha.

If/when MIRA gets a self-hosted runner with LAN access to Bravo, the workflow can be promoted to actually apply the seed by removing the `--dry-run` flag in the workflow step.

## Verifying outcome

After applying the seed, the garage device coverage should look like:

```sql
SELECT
  COALESCE(manufacturer,'(null)') AS mfr,
  COALESCE(model_number,'(null)') AS model,
  count(*) AS chunks,
  count(embedding) AS embedded
FROM knowledge_entries
WHERE tenant_id = '78917b56-f85f-43bb-9a08-1bb98a6cd6c3'
  AND (model_number IN ('GS10','GS11','Micro820','RTU','Garage-RS485')
       OR source_type IN ('oem_manual','troubleshooting_playbook','field_playbook','field_guide','protocol_spec'))
GROUP BY mfr, model
ORDER BY chunks DESC;
```

Expected before: GS10 = 7 chunks / 0 embedded, GS11 = 7 / 0, Micro820 = ~14 / 0.
Expected after: GS10 = 9+ / 9+, GS11 = 7 / 7, Micro820 = 16+ / 16+, plus new RTU/Garage-RS485 rows fully embedded.

Then a smoke test from any bot/CLI:
```
"What does ErrorID 255 mean on a Micro820 MSG_MODBUS instruction?"
"How do I clear CCW embedded serial out of sync?"
"GS10 keeps showing CE2 — what does that mean?"
```
All three should now retrieve grounded chunks via vector search.
