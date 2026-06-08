# Upload → Retrieval Gap, and the Minimal Path to the Beta Gate

**Date:** 2026-06-07 · **Author:** autonomous session (`feat/path-to-beta`)
**Question:** Why can't a stranger upload their own manual and get a cited answer? What's the
exact gap, is PR #1592 the right fix, and what's the minimal path to close it?

> **Confidence key:** ✅ confirmed in code this session · 📝 from prior session memory
> (`project_upload_retrieval_gap`, `project_hub_uploads_no_rls`, `project_miradrop_ingest_v2`).

> **⚑ POST-MERGE UPDATE (2026-06-08):** PR #1592 is **MERGED** (`6758e7e6`). It closed the gap
> **on the Hub NodeChat surface** (steps 1–3 of §4 below are done; the node-attach door
> `/api/namespace/node/[id]/files` → `node-knowledge-ingest.ts` → `knowledge_entries` ↔
> `retrieveNodeChunks` ↔ NodeChat are all wired + UI-reachable). **Step 4 — wiring the *blind*
> `/api/uploads*` doors — is NOT done and is filed as a separate follow-up (not a beta blocker;
> the node-attach door is the beta surface).** The beta GATE is still RED until run green on a
> provisioned dev/staging tenant. The gate harness was updated this session to speak NodeChat's
> `messages`+SSE contract (`tests/beta/_gate.py`). Sections below describe the pre-merge state.

---

## 1. The traced path (origin/main `4b9778c8`)

### 1a. Upload doors (Hub)
`mira-hub/src/app/api/` exposes several upload routes:

| Route | What it does | Storage target |
|---|---|---|
| `documents/upload/route.ts` | ✅ **Demo shim** — registers the file as a **single chunk** in `knowledge_entries` so it shows on a library card. Its own header says: *"This is NOT the full ingest pipeline… production uploads still go through /api/uploads which kicks off OCR + chunk + embed + verify."* | `knowledge_entries` (1 chunk, no real chunking/embedding) |
| `uploads/route.ts`, `uploads/folder/route.ts`, `uploads/local/route.ts` | ✅ **Production path** — hand the file to the *"downstream pipeline (mira-ingest → KB)"* (the folder route is what the MiraDrop desktop watcher calls). | 📝 Open WebUI KB (the `document-kb` collection) |

### 1b. Ingest — VERIFIED this session ✅
The Hub document-upload client (`mira-hub/src/lib/mira-ingest-client.ts:94`) POSTs to
**mira-ingest `/ingest/document-kb`** (`mira-core/mira-ingest/main.py:818`). That handler uploads
the file to **Open WebUI** (`POST {OPENWEBUI_URL}/api/v1/files/` at main.py:963, then
`/api/v1/knowledge/{collection}/file/add` at main.py:991). It does **NOT** call
`insert_knowledge_entries_batch` — so a **manual/document upload writes the Open WebUI KB, never
`knowledge_entries`.** ✅

Important nuance: `insert_knowledge_entries_batch` (`mira-core/mira-ingest/db/neon.py:411` →
`INSERT INTO knowledge_entries`) **does** exist and **does** write `knowledge_entries` — but it's
the **photo / nameplate** path (`/ingest/photo`, main.py:492), not the document-kb path. So
"uploads write OW KB only" is precisely true for **document/manual** uploads (the beta-relevant
case); the photo path is a separate pipeline that already reaches `knowledge_entries`.

There are effectively **two knowledge stores**: the Open WebUI KB (where Hub *document* uploads
land) and the NeonDB **`knowledge_entries`** table (where the bot engine retrieves). ✅

### 1c. Retrieval + citation
- Bot/engine chat retrieval is `mira-bots/shared/neon_recall.py :: recall_knowledge` ✅ — verified
  this session that **every stage (vector, BM25, fault, product) reads `FROM knowledge_entries`**
  (locked by `tests/beta/test_upload_retrieval_citation.py::test_retrieval_reads_only_knowledge_entries`).
- `mira-core/mira-ingest/db/neon.py :: recall_knowledge` also reads `knowledge_entries` (pgvector). ✅
- Citations are built from the retrieved chunks' `source_url` / `source_page` / `metadata`. ✅
  No retrieved chunk → no citation.

---

## 2. The exact gap

> **A production Hub/web document upload lands in the Open WebUI KB. Every chat retrieval path
> reads only `knowledge_entries`. The two stores are not bridged. So an uploaded manual is never
> retrieved and never cited — on any chat surface.** ✅ (retrieval side) / 📝 (upload side)

The `documents/upload` demo shim *does* write `knowledge_entries`, but as a **single unchunked,
unembedded row** — not retrievable in any useful way (no BM25 tsvector content, no embedding,
no page anchors). It exists to populate a library card, not to make the manual citable.

**Net:** "upload → ask → cited answer" works today only for **pre-seeded** assets (e.g. the garage
conveyor seeds in `tools/seeds/`), which is why the internal demo passes but the beta gate does not.
The beta gate requires this for an **unseen** manual with **no manual fix** — that's the gap.

---

## 3. Is PR #1592 the right fix?

**PR #1592 `feat/hub-folder-brain` — "folder = brain: UNS node-centric knowledge + subtree-grounded chat".**

**Yes — it is the right shape.** ✅ Its changeset closes exactly this gap:

- `mira-hub/src/lib/node-knowledge-ingest.ts` (**new** — absent on main ✅) — ingests an uploaded
  file into **`knowledge_entries`** keyed to a UNS node (real chunk anchors).
- `mira-hub/db/migrations/030_knowledge_entries_chunk_anchors.sql` — chunk-anchor columns so
  citations can point at a page/section.
- `mira-hub/src/lib/manual-rag.ts` + `api/namespace/node/[id]/chat/route.ts` + `NodeChat.tsx` —
  retrieval + chat grounded in a node's subtree of `knowledge_entries`.
- `mira-hub/scripts/verify-node-subtree-retrieval.ts` + an e2e proof spec — a built-in gate.
- Spec `docs/specs/uns-node-centric-knowledge-spec.md` + `docs/adr/0020-knowledge-node-addressing.md`.

This is consistent with the doctrine (UNS-addressed knowledge, ADR-0020) and with the master plan's
Phase 2 (uploads write `knowledge_entries`, not OW KB).

### Caveats / what to check before merging
- **State:** DRAFT, 18 files, +2037/−30, base `main`, last updated **2026-06-04**. `main` has
  advanced (head `4b9778c8`, 2026-06-07) → **almost certainly needs a rebase**; `mergeable` reports
  UNKNOWN. ✅
- **Scope coupling:** it threads a *Hub-side* RAG path (`manual-rag.ts`) that is **parallel to** the
  bot engine's `neon_recall`. Confirm the beta flow you demo (Hub NodeChat vs Telegram/Slack/pipeline)
  reads the table #1592 writes. If the beta surface is the **bot/pipeline**, the win only lands if
  the engine's `recall_knowledge` sees the same `knowledge_entries` rows #1592 writes (it should —
  same table — but verify tenant scoping + `equipment_entity_id`/UNS filtering line up).
- **Overlap:** `mira-ingest-v2` / MiraDrop ADR-0019 (`project_miradrop_ingest_v2`) targets the same
  gap from the watcher side. Don't ship two divergent ingest writers into `knowledge_entries`.
- **Prod migration 030:** must go dev → staging → prod via `apply-migrations.yml` (`dry-run` first).
  Note: a *different* migration 030 already exists in the engine lineage history — confirm no
  number collision on the Hub `mira-hub/db/migrations/` lineage before applying.

---

## 4. Minimal path to close the gap (beta-gate green)

1. **Rebase PR #1592 on `main`**; resolve conflicts (esp. `mira-hub/db/migrations/` numbering and
   `uploads.ts`).
2. **Pick the beta demo surface** and make it the one the gate test points at
   (`BETA_GATE_CHAT_URL`). Recommended: the Hub **NodeChat** path #1592 ships, since it's the
   surface #1592 actually grounds. (If the bot/pipeline must also cite uploads, that's a second,
   larger step — engine retrieval already reads `knowledge_entries`, so it mostly needs the *upload
   write* path wired, not a retrieval change.)
3. **Apply migration 030** dev → staging (verify chunk-anchor citations) → prod.
4. **Wire production `/api/uploads*`** (or at least the beta onboarding upload) to
   `node-knowledge-ingest` so a real upload writes chunked+anchored `knowledge_entries` — not just
   the OW KB and not just the single-chunk demo shim.
5. **Run the gate:** point `tests/beta/beta_ready_upload_retrieval_citation.py` at staging
   (`BETA_GATE_*` env) with the GS10 fixture. It must go green (and then strict-xfail flips → remove
   the marker).

**Smallest viable slice for an internal "fresh upload" video:** steps 1–4 against **dev/staging**
with the demo tenant, NodeChat surface. That alone clears "internal demo on a fresh upload" — the
Week-1 deliverable in `docs/plans/2026-06-07-path-to-beta.md`.

---

## 5. What this session shipped vs. left open

- ✅ Failing/xfail gate tests under `tests/beta/` (Lane 2 + Lane 6) + GS10 PDF fixture.
- ✅ Runnable anchor test proving retrieval reads `knowledge_entries`.
- ❌ The gap itself is **NOT closed** here (out of scope — that's PR #1592's job; engine/ingest
  rewrites were explicitly out of scope for this session).
- ✅ Resolved (was an open item earlier in this doc): the production document-upload path
  (`mira-ingest-client.ts:94` → `/ingest/document-kb` → `main.py:963/991`) writes the **Open WebUI
  KB**, not `knowledge_entries`. The `insert_knowledge_entries_batch` writer is the **photo/nameplate**
  path only. So the gap is confirmed for manual uploads; `#1592` (writing chunked `knowledge_entries`
  for uploaded manuals) is the right fix.
