# Provenance Investigation — nameplate duplicate sources & citation-opens-txt

**Governing PRD:** `docs/prd/2026-08-26-commodity-first-mobile-prd.md` §17 (investigation) /
§18 (required fix)
**Companion audit:** `docs/architecture/mobile-commodity-convergence.md` §3.4 / §4
**Status:** Read-only investigation, complete. Evidence-based; no code changed.
**Device evidence:** Pixel 9a, 2026-08-26, Harrington notebook (#3427 comment, PR #3413
`2026-08-26_p2b-*.png`). All line refs at main `0579c874b`.

---

## TL;DR

Both device-observed defects come from one design decision: **the derived nameplate text
document's identity is a hash of its bytes, and those bytes embed volatile inputs** (the
technician-edited identity fields and the vision model's raw output). Every edit-and-resubmit
or fresh recognition of the same photo produces new bytes → a new canonical file → a new doc
→ a new `equipment_notebook_sources` row with the **same filename** — the duplicate rows.
Meanwhile citations always carry the **txt sidecar's** file id (origin is never resolved
server-side), so any citation that lands on a row with `origin_file_id IS NULL` — every
pre-#3421 row, plus any older duplicate — opens the .txt instead of the photograph.

The photograph itself is fine: it is ONE canonical file (sha-deduped, never re-uploaded),
embedded by id in every duplicate's filename. The duplicates are N derived readings over one
original — exactly the state PRD §5 forbids surfacing to the technician.

## The write path (confirm route)

`POST /api/equipment-notebooks/[id]/nameplate/confirm`
(`mira-hub/src/app/api/equipment-notebooks/[id]/nameplate/confirm/route.ts`):

1. `buildNameplateText` (route.ts:100-135) builds the txt bytes from: notebook display name
   (:109), the photo's file id (:111), confidence (:112-114), the **technician-corrected
   identity** (:117-122), and the **vision provider + up to 60 lines of raw vision output**
   (:124-132).
2. Filename is stable per photo: `nameplate-${fileId}.txt` (route.ts:217).
3. `parkOrReuseFile` dedups on **content SHA-256 only** (`lib/workspace-files.ts:214-226`,
   `ON CONFLICT (tenant_id, content_sha256)` :232). No key involves the photo id.
4. New bytes ⇒ new canonical file ⇒ `ingestTextToNode` creates a **new doc** + chunks
   (route.ts:240-262).
5. `attachSource(..., { originFileId: fileId })` (route.ts:282-291) upserts
   `equipment_notebook_sources` on PK `(notebook_id, doc_id)`
   (`db/migrations/073_equipment_notebooks.sql:81`;
   `lib/equipment-notebooks.ts:589-667`) with
   `origin_file_id = COALESCE(EXCLUDED.origin_file_id, existing)` (:650-653). A new doc id
   always misses the conflict target ⇒ plain INSERT ⇒ **an additional user-visible row**.

route.ts:282-291 is the **only** writer of `origin_file_id` in the repo (grep: two files —
the migration and `equipment-notebooks.ts`).

## §17 answers

**1. Why repeated confirmations create duplicates.** The dedup key (content sha) varies per
confirm because the bytes embed the edited identity + fresh nondeterministic vision output;
the source-row key `(notebook_id, doc_id)` then never collides. Ordinary UI paths that
trigger it: "Not this one — edit the details" → edit → resubmit
(`ComponentNameplateFlow.tsx:302`, reducer keeps the same fileId,
`nameplate-flow.ts:261-270`); error-retry (:342, reducer :276-284); and re-running the flow
on the same photo (recognition re-runs on every mount, `ComponentNameplateFlow.tsx:63-91`,
and vision `rawText` is not reproducible). Only a byte-identical resubmit is idempotent —
not the field workflow.

**2. Do duplicates share a canonical original?** Yes. The photo parks through the same
sha-dedup (`nameplate/recognize/route.ts:91-100`), so one photo = one
`namespace_direct_uploads` row; its id appears in every duplicate's filename and text body.
Duplicates are N derived text docs over ONE photo. The photo is never duplicated.

**3/4. Which rows have origin provenance.** Only rows written by the confirm route **after
commit `2674e64e8` (2026-08-26, #3421)** — migration 084 and the `originFileId` write landed
in the same commit. All earlier nameplate source rows have `origin_file_id IS NULL`. Other
`upsertNotebookSourceTx` callers legitimately omit origin (ordinary uploads ARE their own
original): `workspace-files.ts:483`, `:763`, `sources/route.ts:42-46`.

**5. How citation generation selects the doc.** Non-deterministically among duplicates.
Every dedup key in the retrieval/citation path includes a per-doc discriminator
(`node-knowledge-ingest.ts:364` per-doc source_url; `manual-rag.ts:560` pool key includes
doc_id; `manual-rag.ts:221`; `chat/route.ts:176`), all duplicates are in chat scope
(`user_confirmed` + `enabled_by_default`, `equipment-notebooks.ts:659`), and identical chunk
text ties on `ts_rank_cd` with **no stable tiebreak** (`manual-rag.ts:511` `ORDER BY rank
DESC`). Citation [1] can be any duplicate and can differ between identical questions.

**6. How "Open original" resolves.** The server never resolves origin. Chat citations get
`fileId` = the file **whose upload_id IS the cited doc** — i.e. always the .txt sidecar
(`chat/route.ts:192-201`); `EvidenceCitation` has no origin field
(`notebook-chat-types.ts:11-22`). The mobile client re-derives origin with a client-side
join: `sources.find(s => s.docId === citation.docId)?.originFileId`
(`NotebookScreen.tsx:219-221`). When that is null, the sheet's "Open original" button uses
`viewCitation.fileId` unconditionally (`NotebookScreen.tsx:670-683`) — the txt.

**7. Why the Harrington citation opens .txt.** The cited doc row's source has
`origin_file_id IS NULL` — either a pre-#3421 row or an older duplicate — so
`citedOriginFileId` is null and the fallback renders the sidecar. Diagnostic: the top-level
"Open original at cited page 1" button itself proves origin was null (it only renders in the
no-origin branch).

**8. Generality.** Universal: every notebook, every tenant. Every nameplate source created
before 2026-08-26 is a NULL-origin row; every edit-and-resubmit since creates duplicates. Hub
web is worse, not better — it has NO originFileId consumer at all (`NotebookChat.tsx`,
equipment page), so web shows txt for ALL nameplate citations including post-084. Duplicates
also pollute the model prompt: `chat/route.ts:603` lists the same filename N times in
MACHINE CONTEXT.

## Healing is illusory today

Migration 084 (`db/migrations/084_notebook_turn_basis_and_source_origin.sql`) is purely
additive — no DML, no backfill anywhere in the repo. The claimed "replay heals pre-084 rows"
is the upsert COALESCE (`equipment-notebooks.ts:650-653`), which fires **only when a confirm
regenerates byte-identical text** — requiring exact reproduction of earlier nondeterministic
vision output. In the field it cannot fire; the same code path instead mints another
duplicate. **The heal mechanism and the duplicate mechanism are the same code path,
differing only on whether the bytes matched.**

Also: the confirm route receives an idempotency key and drops it — mobile sends `clientKey`
(`resources.ts:911-914`), the route never reads it (route.ts:182-206), and client-side the
key only marks the request retry-safe (`client.ts:333`). It is not sent as a header and keys
nothing.

## Required contract fixes (PRD §18 mapping; not implemented here)

1. **[§18 A/D] One derived doc per (notebook, photo).** Make the derived-doc identity a
   function of the photo, not of the reading: exclude volatile identity/rawText from the
   sha'd bytes (store them as evidence metadata instead), or key the source row on the photo.
2. **[§18 D] Honor the idempotency key** the client already sends: keying the derived doc on
   `(notebook_id, photo file_id)` (or the clientKey) turns re-confirm into an UPDATE — which
   is exactly what makes the existing COALESCE heal fire.
3. **[§18 B] Supersede, don't accumulate**: a re-confirm replaces the derived doc's
   text/chunks (or retires prior `sourceRole='photo'` rows sharing the same
   `origin_file_id`). Nothing today ever removes a superseded nameplate doc.
4. **[§18 C] Resolve origin server-side**: `buildCitations` joins
   `equipment_notebook_sources.origin_file_id` and emits `originFileId` on
   `EvidenceCitation`. Kills the client-side join drift AND gives hub web the photo for
   free.
5. **[§18 C] Fix the sheet fallback**: "Open original" targets `originFileId ?? fileId`
   (mirroring the Sources sheet at `NotebookScreen.tsx:722`) so the button's label and
   target always agree.
6. **[§18 E] Explicit one-shot backfill** for pre-084 rows (`source_role='photo' AND
   origin_file_id IS NULL`): the photo id is recoverable deterministically from the doc's
   filename `nameplate-<photo-file-id>.txt` and from the text's "Canonical nameplate photo
   (file id):" line. Inspect → dry-run → apply via `apply-migrations.yml`; never hand-edit
   prod (environments doctrine).
7. **Deterministic retrieval tiebreak**: add `, doc_id, source_page` after `ORDER BY rank
   DESC` (`manual-rag.ts:511`) so citation selection is reproducible even while duplicates
   still exist.

**Leverage order:** (1)+(2) stop new duplicates; (4)+(5) make every citation reach the photo
even before backfill; (6) repairs existing data; (3) and (7) close the tail. Acceptance =
PRD §19 Tests A/B/F + §20 regression list.
