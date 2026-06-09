# UNS Node-Centric Knowledge & Subtree-Grounded Chat — Spec

**Status:** Draft — REFRAMED as a layer on ADR-0019 (2026-05-29) · **Created:** 2026-05-29 · **Owner:** Mike

> **Foundation = ADR-0019 `mira-ingest-v2`** (Accepted 2026-05-26; spec `docs/specs/miradrop-ingest-v2-spec.md`).
> The original pipeline gap this spec opened with — Hub/web uploads (`ingest_document_kb`) write only
> Open WebUI's KB, never `knowledge_entries`, while all retrieval reads only `knowledge_entries` — is
> **fixed by mira-ingest-v2**, which writes drop chunks into `knowledge_entries` (`doc_id`,
> `ingest_route`) and points `hub_uploads.kg_entity_id` at the UNS-confirmed `kg_entities` node.
> **This spec is no longer the foundation.** It is the **Hub-side front door + subtree retrieval**
> built on the v2 schema: clicking a folder node is itself the confirmed UNS context (no Slack
> dialogue needed), and "ask at a node" gathers the subtree.
**Schema:** chunk→node address is **`knowledge_entries.doc_id → hub_uploads.kg_entity_id →
kg_entities.uns_path`** (per ADR-0019). ADR-0020's link table is **superseded** — no sibling table.
**Extends:** `docs/specs/uns-kg-unification-spec.md`, `docs/specs/maintenance-namespace-builder-spec.md`
**Doctrine:** `.claude/skills/mira-uns-architecture`, `.claude/rules/uns-compliance.md`

---

## 1. Problem

The Hub today has three boxes that don't connect:

1. **Folder tree** `/namespace` → `kg_entities` (each node has a `uns_path` ltree). You can add/rename/
   drag folders, and "upload" a file to a node — but that file lands in `namespace_direct_uploads`:
   **stored, not indexed, not citable.** Nodes have no "Ask MIRA".
2. **Asset cards** `/assets` → `cmms_equipment`. These have a working **Ask MIRA** chat
   (`/api/assets/[id]/chat`: Groq→Cerebras→Gemini cascade, safety hard-stop, citation chips) and a
   Documents tab that surfaces manuals **matched by `manufacturer` + `model`**.
3. **Knowledge corpus** → `knowledge_entries` (BM25, tenant-scoped). Found by manufacturer/model label,
   never by folder.

**Consequence:** building the namespace tree contributes nothing to MIRA's grounded answer. The answer
is driven entirely by an asset card's make/model + a label-matched manual. For a founder "digital-
transformation" demo whose thesis is *"I built the namespace, and that's what makes MIRA grounded,"*
that thesis is currently **false** — unacceptable on an anti-hallucination brand.

## 2. Goal

Make the **folder node the unit of knowledge and conversation**:

- **Attach** a document to a namespace node → it runs through the real ingest pipeline and becomes
  **indexed and citable**, associated with that node.
- **Ask MIRA at a node** → the answer is grounded in the documents attached to that node **and every
  node beneath it** (subtree). Ask at `CV-101` → GS10 + motor + sensor knowledge; ask at `GS10` → just
  that node's subtree.
- Citations name the source document. Safety hard-stop preserved.

After this lands, the demo's thesis is literally true.

### Non-goals (explicit)
- **Not** unifying `kg_entities` ↔ `cmms_equipment` (the full ADR-0013 canonicalization). Asset cards and
  their existing chat remain as-is. This feature adds node-centric knowledge on the **kg/namespace** side.
- **Not** changing the manufacturer/model corpus-match retrieval that the asset chat uses today.
- **Not** MQTT/live-tag grounding (that's the fault-detective system; separate).
- **Not** PLC-tag (L4) or work-order (L5) linkage.

## 3. Model

```
/namespace (kg_entities, uns_path ltree)        knowledge_entries (BM25 corpus, tenant-scoped)
   FactoryLM
   └ Lake Wales Bench Lab                          chunk … chunk … chunk
     └ Demo Area                                        ▲
       └ Conveyor Demo Line                             │ knowledge_node_links
         └ Sorting Cell                                 │ (node_id ↔ knowledge_entry_id)   ← ADR-0020
           └ CV-101 ──── Ask MIRA (subtree) ───────────┘
             ├ GS10 VFD  ← attach GS10 manual → indexed → linked to this node
             ├ M101 Motor ← attach datasheet → linked
             └ PE-101 …
```

- **Attachment** = `knowledge_node_links(node_id, knowledge_entry_id)` rows created when a doc is
  attached to a node and indexed (ADR-0020 — link table, keyed on node_id so it survives drag-reparent).
- **Subtree gather** = resolve the node's `uns_path`, find descendant node_ids via the existing GIST
  index (`kg_entities WHERE uns_path <@ $nodePath`), then BM25 over their linked chunks.
- **Node selection = the UNS location-confirmation gate** (UNS-020): the user explicitly chose the node,
  so node-scoped chat is gate-compliant by construction. Safety keyword hard-stop still applies.

## 4. Architecture & reuse

| Concern | Reuse | New work |
|---|---|---|
| Subtree query | `kg_entities.uns_path` ltree + GIST `(tenant_id, uns_path)` (migrations 010/014) — already tuned for `uns_path <@ Y` | — |
| Ingest (OCR→chunk→embed→verify) | `lib/mira-ingest-client.ts` + `lib/upload-pipeline.ts` (what `/api/uploads` uses) | route node attachments through it; on completion, write `knowledge_node_links` |
| Retrieval | `lib/manual-rag.ts::retrieveManualChunks` (BM25, tenant-scoped) | add `retrieveNodeChunks(client, tenantId, query, nodeId)` scoping by linked chunks in the node's subtree |
| Chat (cascade + safety + citations) | `/api/assets/[id]/chat/route.ts` body | clone into `/api/namespace/node/[id]/chat`; swap asset-context+retrieval for node-subtree retrieval |
| Attach UI / chat UI | `/namespace` selected-node panel; `AssetChat` component | "Attach knowledge" + "Ask MIRA" on the node panel |
| Path construction | `mira-crawler/ingest/uns.py` builders, `uns.slug()` (UNS-001/002/003) | none hand-formatted |

## 5. Slices & acceptance criteria

### Slice 1 — Knowledge hangs on a node; node chat answers from that node
- Migration (ADR-0020): `knowledge_node_links` table + indexes (Hub `mira-hub/db/migrations/`).
- `/api/namespace/node/[id]/files`: route through the real ingest pipeline; on `parsed`, insert
  `knowledge_node_links` for each resulting `knowledge_entries` row. (Keep `namespace_direct_uploads`
  for non-indexable file types; indexable docs go to the corpus.)
- `/api/namespace/node/[id]/chat`: resolve node → its own linked chunks (no subtree yet) → cascade +
  safety + citations.
- UI: node panel gets **Attach knowledge** + **Ask MIRA**.
- **Accept:** attach GS10 manual to the `GS10` node → `knowledge_node_links` rows exist, chunks indexed
  (`chunkCount > 0`); Ask-MIRA at the `GS10` node returns an answer **citing the GS10 manual**; a safety-
  keyword question still hard-stops.

### Slice 2 — Subtree aggregation
- `retrieveNodeChunks` scopes to chunks linked to any node in `uns_path <@ $nodePath`.
- Node chat uses subtree retrieval.
- **Accept:** GS10 manual on `GS10`, motor datasheet on `M101`; Ask-MIRA at **`CV-101`** cites **both**;
  at `GS10` cites only the GS10 manual. Drag `GS10` to a new parent → asking at the new parent now
  includes it (link survived the reparent — node_id stable).

### Slice 3 — Presentable surface
- Node panel: node name/path, attached docs with chunk counts + indexing status, citation chips in chat.
- Readiness/L-level on `/feed` still reflects progress. Mock spare-parts / WO surfaces labeled "coming
  soon" so nothing fake is filmable.

## 6. Environment & verification (CLAUDE.md + UNS-031)
- The migration runs **dev → staging → prod** via `apply-migrations.yml` (`dry-run` then `apply`). Never prod first.
- Engine/retrieval change passes the staging gate (`smoke-test.yml` + relevant `tests/eval/`) before merge to `main`.
- `/mira-run-hallucination-audit` after the chat path lands (gate intact, no pre-confirmation troubleshooting).
- Per-slice accept checks run live on a **dev/staging tenant**.

## 7. Open questions (resolve at sign-off)
1. **Non-indexable attachments** (e.g., a CAD file): keep in `namespace_direct_uploads`, or skip? (Proposed: keep; only indexable types create links.)
2. **Blend OEM corpus into node chat?** Slice 1/2 use only node-attached docs. Later: optionally also pull manufacturer-matched corpus for the node's assets. (Proposed: defer; keep the "your docs on your node" story clean first.)
3. **Readiness scoring:** should node-attached+indexed docs advance the L0–L6 score the way asset-linked manuals do? (Proposed: yes, Slice 3 — count linked docs toward L3.)

## 8. The demo (downstream)
Once Slice 2 lands, the founder series' money shot is true: build the ISA-95 tree → hang each real
manual on its node → Ask MIRA at `CV-101` → cited, subtree-grounded answer. Camera-cue runbook is in the
plan file `~/.claude/plans/i-want-to-use-frolicking-meteor.md` (and this file's git history).
