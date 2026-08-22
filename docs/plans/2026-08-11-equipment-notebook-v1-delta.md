# Equipment Notebook V1 — Implementation Delta

**Date:** 2026-08-11 · **Branch:** `feat/equipment-notebook-v1` off `feat/arpk-doc-scoped-chat` @ `b316cdbb5` (PR #3185 head — doc-scoped chat is NOT on main; per PRD §0 we branch from the dependency's exact head and do not touch #3185/#3187).

## What is REUSED (verified against the audited tree, not assumed)

| Capability | Where it lives | How the notebook uses it |
|---|---|---|
| Doc-scoped retrieval | `mira-hub/src/lib/manual-rag.ts` `retrieveNodeChunks(..., docId?)` (#3185) | Generalized minimally: `docId?: string` → `docIds?: string[]`, SQL `AND doc_id = ANY($::uuid[])` on both tsquery passes. No new retrieval architecture. |
| v2 ingest + chunking + `is_private=true` law | `node-knowledge-ingest.ts`, `namespace/node/[id]/files` route | Notebook sources upload through the SAME door. A notebook wraps a `kg_entities` node; chunks carry `node_id` + `doc_id` already. |
| Content-SHA dedup | #3185 migration 072 + `findDuplicateUpload()` | Used as-is on notebook uploads. |
| Byte serving for the viewer | `GET /api/namespace/files/[id]` (`namespace_direct_uploads.content` BYTEA, inline mime) | Source viewer renders this in an `<iframe src=…#page=N>` — browser-native PDF page anchors. No pdfjs stack in V1 (honest page-level citation per PRD §4.7/§14). |
| SSE chat streaming + grounding prompt + injection hardening | `namespace/node/[id]/chat/route.ts`, `buildDocScopedSystemPrompt`, `neutralizeReferenceText` | Notebook chat route reuses provider streaming; sources frame extended with `docId` per source (typed, shared). |
| Auth/tenant | `sessionOr401` + `withTenantContext` (kg family) / raw pool (`hub_uploads`) | Every notebook route. |
| Node creation w/ `approval_state='verified'` pin | `api/namespace/node/route.ts` + `inbox-node.ts` precedent (#3185) | Notebook creation creates its backing node with the pin (audit trap #6). |
| UI kit | shadcn primitives, `--brand-*`/`--surface-*` CSS vars, `mobile-drawer`/bottom-sheet patterns, `next-intl` | New pages imitate `documents/page.tsx` + `NodeChat.tsx` patterns. NOTE: hub uses `--brand-*` vars, not `--fl-*` tokens — following the surrounding code, divergence flagged per audit. |
| Tests | `doc-scope.test.ts` (route contract w/ SQL-regex pool mock), `AssetChat.test.tsx` (renderToStaticMarkup) | Same shapes for notebook route + component tests. |

## What is NEW (smallest additive set)

1. **Migration `073_equipment_notebooks.sql`** (next free integer; 072 is #3185's): `equipment_notebooks` (UUID-tenant family — every field from PRD §8.1; `node_id UUID` referencing `kg_entities.id`, no hard FK to match `hub_uploads.kg_entity_id` precedent), `equipment_notebook_sources` (PK `(notebook_id, doc_id)`, `enabled_by_default`, `match_state`, `source_role`), `equipment_notebook_turns` (per-turn source snapshot + evidence JSONB — PRD §8.3; server-side so old answers stay interpretable). RLS in-type (UUID family), `GRANT … TO factorylm_app`, idempotent, single transaction, rollback note.
2. **Routes** `/api/equipment-notebooks{,/[id],/[id]/sources,/[id]/sources/[docId],/[id]/chat}` (`/[id]` serves GET/PATCH/**DELETE** — deletion contract + what it deliberately preserves: `docs/runbooks/equipment-notebook-deletion.md`) + `/api/equipment-notebooks/recognize-nameplate`. Chat validates every requested docId ∈ (tenant ∧ notebook ∧ enabled) BEFORE retrieval (PRD §12 hard reqs 1–5); per-turn snapshot inserted with the answer; zero-evidence → structured `insufficient_evidence` without a provider call (Gate G).
3. **Typed SSE frame contract** `src/lib/notebook-chat-types.ts` — shared by route + client (closes audit gap #3): `sources` frame objects carry `docId`, `page`, `title`, `citationId`.
4. **UI**: `(hub)/equipment/page.tsx` (list, Scan CTA, New notebook, empty state per §27), `(hub)/equipment/[id]/page.tsx` (mobile-first chat: compact identity header, "Sources · N of M" sheet, clickable `[n]` citations), `(hub)/equipment/[id]/source/[docId]/page.tsx` (iframe viewer + evidence card + back-to-chat), scan flow page w/ confirmation-edit step (identity is a candidate until confirmed — §4.4).
5. **NameplateRecognizer adapter** (`src/lib/nameplate/`): interface + `GroqVisionRecognizer` (uses server `GROQ_API_KEY` if present; llama-4 vision) + `FixtureRecognizer` for tests. No custom OCR. If the key is absent in the hub env, scan shows the honest "recognition unavailable" path and fixture tests still prove the contract (§34).

## Explicitly NOT built (per PRD §3.2)
ARPK format, portable packages, new parser/OCR, vector work, manual web-discovery (Tier-3), audio/flashcards, dashboards, model selectors. `/documents` Labs mock untouched.

## Known tensions recorded
- `hub_uploads.tenant_id` TEXT vs notebook UUID family: notebook tables stay UUID (only UUID tenants reach hub routes); joins to `hub_uploads` compare `tenant_id::text` on the TEXT side, stated in the migration header.
- Citation granularity is **page-level** in V1 (chunks carry `source_page`; no text selectors in ingest). Types include an optional `selector` field for later richness without API change (§14).
- Screenshots depend on local dev + auth cookie mint; if minting proves heavy, static-render screenshots of the components are the fallback and the limitation is reported.
