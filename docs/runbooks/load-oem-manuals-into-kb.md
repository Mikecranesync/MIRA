# Runbook — Load OEM manuals into the shared KB corpus

**What this does:** loads OEM manual content into `knowledge_entries` as **shared corpus**
(`is_private = false`, system tenant `78917b56-…`) so it is citable by **every** tenant on the
asset-chat / quickstart / Hub RAG surfaces. This is the path that fixes the secret-shopper
"correct refusal — vendor/model not in corpus" gaps. A per-tenant Hub upload (`is_private = true`)
does **not** fix those — wrong corpus.

Proven working 2026-06-21 (staging): 8 garage-device chunks loaded + verified retrievable.
See `.claude/rules/knowledge-entries-tenant-scoping.md` for the corpus law.

---

## The hard constraints that shape this procedure

1. **Embeddings need Ollama `nomic-embed-text` (768-dim).** GitHub CI runners cannot reach it, so
   the load **cannot run in CI** — it runs off-CI from a Tailnet node. (`seed-oem-manuals.yml`
   validates the seed only; it never applies it.)
2. **Bravo Ollama (`192.168.1.11:11434` / `100.86.236.11:11434`) is NOT reachable** — it binds
   localhost on Bravo. Verified `http=000` from Charlie 2026-06-21.
3. **Charlie runs its own Ollama on `127.0.0.1:11434`** with `nomic-embed-text` (dim 768) — this is
   the embedding engine. Charlie is on Bravo's LAN subnet and has the repo + `httpx`/`sqlalchemy`.
4. **`doppler` is not on Charlie's non-interactive SSH PATH** (macOS keychain gotcha). Inject the
   DB URL from the Windows dev box's Doppler over SSH stdin instead.
5. **Windows dev box cannot do the load itself:** NeonDB `channel_binding` fails from Windows, and
   it has no PDF libs. Windows is the *orchestrator*; Charlie is the *worker*.
6. **Staging first, then prod.** KB seeds reach prod only after BM25 retrieval is verified on
   staging (`docs/environments.md`; lesson from #1385).

## Node roles

| Node | Role | Why |
|---|---|---|
| Windows dev box | orchestrator | has Doppler auth (`stg`/`prd` configs) + the repo |
| Charlie (`100.70.49.126`) | worker | localhost Ollama 768-dim + repo + httpx/sqlalchemy + on Bravo LAN |

---

## A. Targeted small-batch load (`apply_oem_seed.py`) — the proven path

Use for hand-curated gap-fill chunks in `tools/seeds/oem-manuals/chunks.jsonl`
(`is_private=false, verified=true`, system tenant, deduped by `metadata.chunk_key`).

### 1. Make sure Charlie has the current seed files
```bash
ssh charlienode@100.70.49.126 'cd ~/MIRA && git fetch origin --quiet && \
  git checkout origin/main -- tools/seeds/oem-manuals/'
```

### 2. Dry-run against STAGING (no writes, no embed calls — proves DB wiring)
```bash
doppler secrets get NEON_DATABASE_URL -c stg --plain --project factorylm | \
  ssh charlienode@100.70.49.126 'bash -lc "read -r NEON; cd ~/MIRA && \
    NEON_DATABASE_URL=\"\$NEON\" python3 tools/seeds/oem-manuals/apply_oem_seed.py \
      --dry-run --skip-backfill --ollama-url http://127.0.0.1:11434"'
```
Piping the URL over stdin + `read -r NEON` keeps the secret out of `argv`/process list.

### 3. Real load against STAGING
Drop `--dry-run`. Embeds via Charlie localhost Ollama, inserts shared corpus.

### 4. Verify on STAGING (gate — do NOT promote to prod until this passes)
```bash
scp tools/seeds/oem-manuals/verify_seed.py charlienode@100.70.49.126:~/MIRA/tools/seeds/oem-manuals/
doppler secrets get NEON_DATABASE_URL -c stg --plain --project factorylm | \
  ssh charlienode@100.70.49.126 'bash -lc "read -r NEON; cd ~/MIRA && \
    NEON_DATABASE_URL=\"\$NEON\" python3 tools/seeds/oem-manuals/verify_seed.py \"GS10 fault code modbus comm\""'
```
Expect: `8/8 seed chunks present` (`is_private=False`, `emb=True`) and `RESULT: PASS` (BM25 returns
the seeded chunk).

### 5. Promote to PROD (only after step 4 PASS, and with explicit human OK)
Same as steps 3–4 with `-c prd`. Idempotent (dedupes by `chunk_key`); additive.
> Prod KB write is an outward-facing change — get explicit approval before running it.

---

## B. Full-PDF ingest — STAGING-TESTED, NOT PROD-READY (do not load raw to prod)

For complete OEM manuals (e.g. on-disk `gs10 drive.pdf`, `Micro820_user_manual.pdf`).
`ingest_local_pdf.py` (this dir) extracts (pdfplumber) → chunks (mira-crawler chunker, ≤2000 tok)
→ embeds → inserts shared corpus. It works mechanically, but **raw pdfplumber full-PDF output is
not good enough for the shared prod corpus** — proven on staging 2026-06-21:

- **Extraction noise:** TOC dot-leaders extract as `� � �`; bold headers triple
  (`CCChhhaaapppttteeerrr`). pdfplumber is the *fallback* extractor for a reason — the sanctioned
  `mira-core/scripts/ingest_manuals.py` uses **docling primary** for layout-aware extraction.
- **Retrievability:** the 22 GS10 full-manual chunks did NOT surface for the natural query
  "GS10 overload fault trip parameter setting" — the curated chunk did. Raw full-PDF chunking is
  entangled with the **deferred page-picking work** (the 3 big retrieval problems), so a quick load
  adds noise without adding answers.

The 22 GS10 + 105 Micro820 staging chunks loaded during this test were **deleted** from the staging
shared corpus (they'd skew beta-gate / secret-shopper evals). **Nothing was loaded to prod.**

**To do full-PDF properly (own effort, not a quick load):** use the docling pipeline
(`ingest_manuals.py` / `docling_adapter.py`) for clean extraction, then validate retrieval on
staging against real queries before any prod load — i.e. it rides on the deferred page-picking fix.

- **Throttle.** The bulk Celery/Trigger.dev crawler twice took down the 8 GB VPS (PRs #1318/#1336);
  `scripts/ab_manual_hunter/` is the sanctioned capped replacement (≤3 PDFs/run). Don't resurrect
  the bulk crawler on the VPS.
- Don't chase all 272 `to_find` rows in `manual_scrape_targets.csv` — most are genuinely
  unfindable (no nameplate / OCR noise). Load what real queries actually hit.

---

## Why a manual isn't being cited — diagnose before loading

Per `.claude/skills/retrieval-diagnostics`: bucket the manual first.
1. **genuinely absent** → load it (this runbook).
2. **present but not retrieved** → page-picking problem, loading more won't help.
3. **correct refusal** (vendor/model doesn't exist; e.g. GS20 is AutomationDirect, not Yaskawa) →
   not a bug.
Confirm absence read-only on staging before loading; never `psql` prod.
