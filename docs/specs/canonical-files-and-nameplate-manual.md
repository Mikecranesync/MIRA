---
last_updated: 2026-08-14
status: implemented (not deployed)
---

# Canonical Files + Component Nameplate → Manual

Two connected capabilities, one data model.

1. **Canonical Files.** Every uploaded file is a durable workspace object that can be
   attached to many assets, notebooks, namespace locations, or work orders — without
   duplicating its bytes, its parsed document, or its knowledge chunks.
2. **Component nameplate → manual.** Photograph a nameplate inside an Equipment
   Notebook, confirm the identity, and FactoryLM finds, validates, downloads, ingests,
   and (only when applicability is *proven*) enables the official OEM PDF.

## The problem this fixes

The pre-existing model assumed one destination per file:

| Layer | Single-destination assumption |
|---|---|
| `namespace_direct_uploads.node_id` | one node |
| `hub_uploads.kg_entity_id` | one ingest node |
| `knowledge_entries.metadata->>'node_id'` | chunks stamped to that node |
| `retrieveNodeChunks()` | filters chunks by the stamped node |
| `findDuplicateUpload()` | deduplicates only *within* one node |

So adding the same `docId` to a second notebook was **not enough**: the second notebook
would have source membership while retrieval still excluded the chunks, because they
remained stamped to the first node. The fix is **one canonical file/document + many
explicit links** — never a copied blob, never a re-run of ingestion.

## Data model (migration 075)

`namespace_direct_uploads` becomes the canonical file record. It is **not renamed** —
the product-facing name is simply *Files*. Three additive changes:

1. **`content_sha256`** + a **partial UNIQUE index** on `(tenant_id, content_sha256)`.
   This is exact-byte identity *and* the concurrency guard: two simultaneous identical
   uploads cannot both insert — the loser re-selects the winner. Legacy rows keep `NULL`
   and are never blocked. Deliberately **unique**, unlike 072's non-unique
   `hub_uploads` index, which exists because the old model re-ingested per node.
   Deduplication is **within one tenant only**, never across tenants.
2. **`workspace_file_links`** — the many-to-many table. Polymorphic
   `(target_type, target_id)` with a CHECK allowlist of four types
   (`equipment_notebook`, `cmms_asset`, `namespace_node`, `work_order`). All four target
   tables key by UUID, so `target_id` is UUID. There is intentionally **no FK on
   `target_id`**: each insert goes through a target-specific tenant-ownership validator
   in `src/lib/workspace-files.ts` (same posture as 073's `node_id`). `file_id` **is** a
   real FK with `ON DELETE RESTRICT` — a file cannot be deleted while any relationship
   remains. Constraints: unique `(tenant_id, file_id, target_type, target_id)`; a partial
   unique index enforcing **at most one primary filing location per file**; RLS +
   `GRANT … TO factorylm_app` per the 073 pattern.
3. **`equipment_notebook_sources.match_evidence` (JSONB)** — persisted manual
   applicability evidence: matched tokens, evidence pages, decision method,
   discovery/final URLs, confidence. Never secrets.

**Backfills** (idempotent): every parked file's `node_id` becomes a primary
`namespace_node` link; every notebook source whose `doc_id` resolves to a parked file
through `upload_id` becomes an `equipment_notebook` link. Legacy `hub_uploads` documents
whose original bytes were never retained are **not** invented as file records.

### Migration proof

075 was applied to an ephemeral PostgreSQL 16 over a minimal 027/059/073 schema and all
twelve invariants asserted: idempotent re-run (0 new rows), correct backfill shape, no
invented files, unfiled files stay unfiled, tenant isolation, relationship uniqueness,
one-primary enforcement, one file attached to two notebooks, FK RESTRICT on a linked
file, non-destructive detach (bytes + sibling link survive), SHA dedup within a tenant
but independent across tenants, NULL shas coexisting, and RLS visibility of 2/1/0 rows
for tenant A / tenant B / a stranger.

## Domain service

`mira-hub/src/lib/workspace-files.ts` is the **only** home for relationship SQL — routes
call it, they do not scatter link queries. It owns park-or-reuse, attach/detach/relocate/
delete, the target validators, and the capability model.

### Terminology (enforced in the UI)

| Action | Meaning |
|---|---|
| **Attach to…** | add another relationship — the normal, non-destructive default |
| **Detach from here** | remove *only* the selected relationship |
| **Move / Change filing location** | add the new destination and remove only explicitly selected old ones, atomically |
| **Delete file** | a separate destructive action from the Files detail screen |

A non-destructive attachment operation is never labelled "move". When the final
attachment is removed the file remains in the workspace as **Unfiled** — it is not
automatically deleted.

### Capability levels

| Level | Formats | Behavior |
|---|---|---|
| **Indexable** | PDF, text, Markdown, CSV, supported logs | parsed into `knowledge_entries`, citable in chat |
| **Viewable** | JPEG, PNG, GIF, WebP | rendered inline, not indexed |
| **Stored** | Office, PLC project/backup files, archives, unknown binary | parked bytes, download-only — "Stored file—not searchable in chat" |

SVG is deliberately **not** viewable (scriptable → stored). The strict inline-render
safelist is PDF, plain text, and the four rasters; everything else is served with
download disposition + `nosniff`. Uploaded content is never executed. Indexing failure
never loses the original, and a file cannot enter chat scope until it has materialized,
citable content.

## Retrieval boundary

`retrieveNodeChunks()` gains an **opt-in** `validatedDocScope` flag. When set, the
node-stamp predicate is swapped for the validated doc set — so a document ingested once
and linked to several notebooks stays retrievable in each of them, without its chunks
having to carry every consumer's `node_id`.

The flag is deliberately narrow:

- It is **ignored** unless an explicit doc set narrows the scope. The node filter is
  never globally removed.
- It is set **only after membership validation** — `validateChatSources()` for notebook
  chat (tenant + notebook membership, all-or-nothing, rejected sources excluded), or a
  file-link derivation for the node whose subtree is being asked about.
- Legacy node-stamped documents keep working unchanged.

Net effect: the same PDF attached to *Constellation Carousel* and *Stardust Racers* is
retrievable in both, and not in an unrelated third notebook.

## Nameplate workflow

1. **Capture and park.** The photo is parked as a canonical file and attached to the
   notebook *before* recognition runs, so the original survives a recognition failure.
2. **Confirm.** An editable form — "Read from the nameplate—edit anything that's wrong."
   Recognition produces a **candidate**, never an authoritative identity. This is a
   *component within* the ride: it must not overwrite the parent notebook's identity.
3. **Materialize.** The confirmed reading becomes deterministic text ingested through
   `ingestTextToNode()` and attached with `sourceRole: "photo"`,
   `matchState: "user_confirmed"`. Chat cites the confirmed text; **Open original**
   shows the actual photo.
4. **Discover.** Confirmed identifiers in priority order (catalog number → exact model →
   manufacturer), searched in order: already attached to this notebook → a canonical
   workspace file with persisted exact applicability evidence → tenant-wide content-SHA
   dedup after download → OEM discovery via the mira-ask router. Notebook chat is never
   widened to the global shared corpus.
5. **Download safely.** Only `validated`, direct-PDF, HTTPS results on approved OEM hosts
   for the confirmed manufacturer are imported automatically. Every URL is untrusted:
   embedded credentials rejected; localhost/private/link-local/CGNAT/metadata ranges
   rejected; redirects bounded and **revalidated at every hop**; connection and total
   timeouts; maximum size enforced *while streaming*; MIME and `%PDF-` magic validated;
   filenames sanitized. Credentials, query secrets, and document content are never
   logged. Anything unvalidated, third-party, or ambiguous is shown as a candidate and
   cannot be auto-imported or auto-enabled.
6. **Ingest and assess.** Bytes go through the canonical service (exact-byte dedup →
   parking → `ingestPdfToNode()` → one `docId` → private tenant chunks). The manual is
   attached first as `matchState: "candidate"`, `enabledByDefault: false`. Applicability
   is then judged **from the materialized chunks of that exact `docId`** — a search
   result's title and URL are never sufficient evidence:
   - exact normalized **catalog number** match → strongest, verifies;
   - otherwise exact normalized **model** plus manufacturer evidence or approved
     OEM-host evidence → verifies;
   - **family-prefix-only** matches stay candidates;
   - a scanned PDF with no extractable text stays stored and viewable but unavailable to
     chat until OCR exists.
   Proven → atomically `verified` + enabled. Plausible but unproven → stays disabled with
   its title, OEM host, matched identity, and reason shown, plus Confirm / Reject.

## Invariants

- One canonical ingestion pipeline; no second parser, chunker, embedder, or document table.
- One tenant-owned file, many explicit attachments.
- Original bytes and raw extraction are never discarded.
- Recognition produces a candidate, not an authority.
- A component nameplate never overwrites the parent notebook identity.
- No manual is silently accepted from a fuzzy model-family match.
- Candidate manuals stay disabled until verified or technician-confirmed.
- Notebook chat stays limited to explicitly selected, validated notebook sources.
- No cross-tenant access; a cross-tenant id is indistinguishable from a missing one.
- No fabricated URLs, documents, extracted text, or citations.
- Detaching never deletes bytes or other relationships.
- Reusing a file never reparses, rechunks, or re-embeds it.

## Cross-references

- `mira-hub/db/migrations/075_workspace_file_links.sql`
- `mira-hub/src/lib/workspace-files.ts` — the domain service
- `mira-hub/src/lib/manual-rag.ts` — `retrieveNodeChunks(..., validatedDocScope)`
- `mira-hub/src/lib/equipment-notebooks.ts` — `validateChatSources` (the chat boundary),
  `upsertNotebookSourceTx` (link + membership in one transaction)
- `mira-bots/ask_api/manual_discovery.py` + `mira-bots/shared/manual_search/`
- `.claude/rules/one-pipeline-ingest.md`, `.claude/rules/knowledge-entries-tenant-scoping.md`,
  `.claude/rules/mira-hub-migrations.md`, `.claude/rules/materialized-evidence.md`
