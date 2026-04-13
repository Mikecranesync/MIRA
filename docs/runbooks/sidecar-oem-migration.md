# Runbook: Migrate Sidecar OEM Docs → Open WebUI Knowledge Collection

**ADR:** ADR-0008 — Deprecate mira-sidecar  
**Phase:** 3 of 4 (requires production window, human oversight)  
**Estimated time:** 15–30 minutes (depends on Open WebUI embedding latency)  
**Risk:** Low — non-destructive. Sidecar data is read-only during migration.

---

## Pre-flight checklist

- [ ] Mike is watching (this moves production KB data)
- [ ] All users are off Open WebUI (check `docker logs mira-core-saas | grep active`)
- [ ] mira-sidecar is running and healthy: `curl -s https://app.factorylm.com/sidecar/status`
- [ ] mira-core-saas is healthy: `curl -s https://app.factorylm.com/health`
- [ ] Doppler is accessible: `doppler whoami --project factorylm --config prd`
- [ ] You have confirmed the Open WebUI embedding model:
  - Open WebUI UI → Settings → Documents → Embedding Model
  - Should be `nomic-embed-text` (Ollama) to match sidecar's model
  - If different: document the difference — Open WebUI will re-embed using its model,
    which is acceptable but means vectors won't be numerically identical

---

## Step 1 — Find the ChromaDB volume mount path on VPS

```bash
ssh factorylm-prod "docker inspect mira-sidecar --format '{{json .Mounts}}'" | \
  python3 -c "import sys,json; [print(m['Source']) for m in json.load(sys.stdin) if 'chroma' in m.get('Source','').lower()]"
```

Expected output: something like `/var/lib/docker/volumes/mira_mira-chroma/_data`

Set this in the script if it differs from the default:
```bash
export CHROMA_PATH=/var/lib/docker/volumes/mira_mira-chroma/_data
```

---

## Step 2 — Dry run (no writes)

```bash
ssh factorylm-prod "cd /opt/mira && \
  doppler run -p factorylm -c prd -- \
  python3 tools/migrate_sidecar_oem_to_owui.py --dry-run"
```

**Check the output:**
- Confirm it finds 398 chunks (or whatever the current count is)
- Confirm the list of source files looks right (OEM PDFs, not garbage)
- Confirm it identifies the target collection name correctly

---

## Step 3 — Install chromadb on VPS (if not present)

The migration script reads ChromaDB directly. Install the client on the VPS host:
```bash
ssh factorylm-prod "pip install 'chromadb>=0.5,<0.6' httpx"
```

If pip isn't available or the version conflicts, run inside the sidecar container instead:
```bash
ssh factorylm-prod "docker exec mira-sidecar python3 /opt/mira/tools/migrate_sidecar_oem_to_owui.py --dry-run"
```
(Volume path changes when running inside container: use `/data/chroma` instead.)

---

## Step 4 — Live migration

```bash
ssh factorylm-prod "cd /opt/mira && \
  CHROMA_PATH=/var/lib/docker/volumes/mira_mira-chroma/_data \
  doppler run -p factorylm -c prd -- \
  python3 tools/migrate_sidecar_oem_to_owui.py"
```

The script will:
1. Create a new Open WebUI knowledge collection: **"OEM Library — MIRA Shared"**
2. Upload all 398 chunks in batches of 50
3. Save progress to `/tmp/mira_migration_progress.json` (for resumability)
4. Log a summary when done

If the script is interrupted, re-run with `--resume`:
```bash
... python3 tools/migrate_sidecar_oem_to_owui.py --resume
```

---

## Step 5 — Verify in Open WebUI

1. Log into `https://app.factorylm.com`
2. Go to **Knowledge** → confirm "OEM Library — MIRA Shared" is present
3. Check the doc count (should be ~398 items, may consolidate per file)
4. Open a chat session, select the "OEM Library — MIRA Shared" collection
5. Ask a known question (e.g., "What does fault F7 mean on a PowerFlex 22B?")
6. Confirm the answer cites sources from the OEM manuals

---

## Step 6 — Stop the sidecar (DO NOT remove volume yet)

After verifying step 5:
```bash
ssh factorylm-prod "cd /opt/mira && docker compose -f docker-compose.saas.yml stop mira-sidecar"
```

Watch for 2 minutes: confirm mira-web still functions (its chat will 503 — that's
expected and acceptable since mira-web has no public route).

---

## Step 7 — Remove sidecar from compose (separate PR)

When the mira-web cutover is also complete (ADR-0008 Phase 4), open a new PR to:
1. Remove the `mira-sidecar` service from `docker-compose.saas.yml`
2. Remove the `nginx /sidecar/` location block (already done in this PR if Phase 2 landed)
3. Remove `mira-sidecar/` directory from the repo
4. Remove `mira-web/src/lib/mira-chat.ts` sidecar dependency

**Volume removal:** Only `docker volume rm mira_mira-chroma` AFTER:
- [ ] OEM docs confirmed in Open WebUI KB (step 5 above)
- [ ] Brain2 tenant docs (11 chunks) either migrated or confirmed disposable
- [ ] Mike explicitly signs off

---

## Rollback

The migration is non-destructive. The sidecar container and its ChromaDB data are
untouched until step 6. To roll back:

- Before step 6: simply delete the "OEM Library — MIRA Shared" collection from Open WebUI
- After step 6 (sidecar stopped): `docker compose -f docker-compose.saas.yml start mira-sidecar`
- The sidecar will resume serving from ChromaDB immediately

---

## Known gaps

1. **Brain2 tenant docs (11 chunks)** — `mira_docs` collection in ChromaDB. These are
   NOT migrated by this script (deliberately — they're per-tenant and may already be in
   Open WebUI KB). Check with Mike whether they duplicate existing Open WebUI collections.
2. **`/build_fsm` endpoint** — The sidecar's FSM builder has no equivalent in the new
   architecture. If Ignition integration ever uses it, extract it as a standalone script
   before removing the sidecar.
3. **mira-web chat** — Will break when sidecar is stopped. Address in mira-web cutover PR.
