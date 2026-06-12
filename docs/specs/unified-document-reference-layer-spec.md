# Unified Document & Reference Layer — Study + Build Sequence

**Status:** Draft (2026-06-12) · **Owner:** Mike · **Author of record:** grilled design session 2026-06-12
**Decision:** ADR-0023 (content-addressed Documents + Template/Instance knowledge)
**Builds on:** ADR-0019 (`mira-ingest-v2` — the chunk→node chain), ADR-0020 (superseded: *no sibling truth tables*), ADR-0018 (Template/Instance + control edges), ADR-0017 (proposal promotion gate), ADR-0013 (kg/cmms canonicalization)
**Extends:** `docs/specs/uns-node-centric-knowledge-spec.md`, `docs/specs/miradrop-ingest-v2-spec.md`
**Glossary:** `CONTEXT.md` § "Documents & references"

> **One-line thesis:** Upload a file once; a *reference* to it hangs in every place that needs it; the
> file is stored exactly once; and the *knowledge* it yields is shared at the model level so every
> customer's matching machine gets smarter. No copies, no hunting.

---

## 1. Problem (the as-is state)

A "document" in the Hub today has **three disjoint representations, written by two upload entry points,
listed by five surfaces, with no shared identity:**

| Representation | Table | Written by | Tenancy | Links to node via |
|---|---|---|---|---|
| Upload registry (main) | `hub_uploads` | `lib/uploads.ts` (`/api/uploads`; asset page, folder, MiraDrop) | `tenant_id` **TEXT** | `kg_entity_id`, `uns_path`, `asset_tag` |
| Upload registry (namespace) | `namespace_direct_uploads` | `/api/namespace/node/[id]/files` | `tenant_id` **UUID** | `node_id` → `kg_entities` |
| Retrieval chunks | `knowledge_entries` (`doc_id`) | ingest pipeline | `tenant_id` **UUID** | `equipment_entity_id` → `kg_entities` |

Concretely, verified against the code and the dev database (2026-06-12):

- **Two upload buttons, two cabinets.** The **Knowledge → Manuals** upload calls `/api/uploads` → writes
  `hub_uploads`. The **Namespace** tab's drop-on-node calls `/api/namespace/node/[id]/files` → writes
  `namespace_direct_uploads`. **Neither tab shows the other's files.** That *is* the hunting problem.
- **The intended address chain exists but only on one path.** ADR-0019 established
  `knowledge_entries.doc_id → hub_uploads.kg_entity_id → kg_entities.uns_path`. The namespace path
  bypasses it (writes `namespace_direct_uploads`, never `hub_uploads`).
- **The "table of contents" slots exist but are empty.** Migration 045 added `doc_id`, `section_path`,
  `page_start`, `page_end` to `knowledge_entries`. In dev, across **83,784 chunks: `section_path`=0,
  `page_start`=0, `doc_id`=0 populated** — only `equipment_entity_id` (which node) is filled (~59%).
  Section-level addressing is scaffolded but unwired.
- **Tenancy fault line.** `hub_uploads.tenant_id` is **TEXT**; `knowledge_entries`/`kg_entities` are
  **UUID** (see `project_dual_tenancy_id_space`). A unified query crosses it.
- **The glossary had no word for any of this** until 2026-06-12 (`CONTEXT.md` § "Documents & references").

**Net:** "upload once, link everywhere" is *structurally impossible* today. The fix is not five more
features — it is one shared source of truth that every surface projects.

---

## 2. The two ideas (the whole design)

Everything below collapses onto two sentences. If a future reader remembers only these, they can rebuild it.

### Idea 1 — The file is content-addressed, stored once, referenced by deep link

A **Document** is identified by the **hash of its bytes** and stored exactly once. Two identical uploads
are one Document with two access grants — never two blobs. "No copies hanging around" stops being a
discipline and becomes a *physical property of the storage*. Everything that appears elsewhere is a
**Section Link** — a deep link `document/{id}#page=N&section=…` — never a copy. (Git, Docker layers,
every CDN work this way.)

### Idea 2 — A Document's knowledge rides the Template/Instance pattern Components already use

The Hub already models a Component as a shared **Template** (`component_templates`, model-level, true for
every GS10) plus a tenant **Instance** (`installed_component_instances`). A Manual's *knowledge* is the
same shape:

- **Template layer (shared):** the ToC structure + extracted facts (fault codes, pinout) — true for the
  *model*, admin-curated, reused by every Instance, across every tenant. This is the network-effect asset.
- **Tenant layer (private):** the customer's actual file + any plant-specific corrections — never crosses
  tenants.

Reads flatten the stack with the **local (tenant) layer winning over the shared model** — the cascade /
overlay pattern (Figma component+overrides, Docker layers, CSS cascade).

> These two ideas turn every scary implication (privacy, precedence, promotion, cold-start, dedup) into a
> problem the codebase **already solved** — see §6.

---

## 3. Domain model

```
                         ┌──────────────────────────────────────────────┐
                         │  DOCUMENT  (the file, content-addressed)       │
                         │  one blob per content-hash, stored ONCE        │
                         │  registry row: hub_uploads (canonical)         │
                         │  shared (public OEM) | tenant-private          │
                         └───────────────┬──────────────────────────────┘
                                         │ doc_id (ADR-0019)
                         ┌───────────────▼──────────────────────────────┐
                         │  knowledge_entries (chunks)                    │
                         │  section_path, page_start/end, equipment_…id   │ ← the Section anchors
                         └───────────────┬──────────────────────────────┘
              Section Link (hot link)    │ equipment_entity_id → kg_entities
       deep link: document/{id}#page=N   │
                                         ▼
   TABLE OF CONTENTS  ───────►  kg_entities node  (uns_path ltree, GIST <@ for subtree)
   (derived list of a              │
    Document's Section Links)       │  entity_type=component → mirrors an Instance → Template
                                    ▼
                       KNOWLEDGE SPLIT
        Template layer (shared)  ◄── facts/ToC promoted via admin gate (ADR-0017)
        Tenant layer (private)   ◄── the file + corrections (is_private / RLS)
```

**Three nouns** (`CONTEXT.md` is authoritative):

- **Document** — the file. Content-addressed, stored once. `hub_uploads` row.
- **Section Link** ("hot link") — a reference: *(node | Template) → (Document, page range, section)*. A
  deep link, never a copy. Appears on every surface.
- **Table of Contents** — the ordered set of a Document's Section Links, shown at its home. Derived.

**The read-time file resolver (ladder):** a Section Link resolves its file as
`your own copy → the shared public OEM copy → "upload your manual to read this section."`
The last rung is the magic: a new customer sees a *populated, organized* machine with a real ToC and fault
codes before uploading a single page — because the **knowledge** came from the Template.

**The precedence rule ("local beats global"):** retrieval blends shared-model chunks + this tenant's
private chunks; on conflict the **tenant-private** fact wins for that plant. Citations must name the layer
("per the GS10 manual" vs "per your site drawing").

---

## 4. Every surface is a projection (not a copy)

One write model, many read views (CQRS / materialized-view thinking). All of these become **the same list
component + the same viewer**, with a different `WHERE`:

| Surface | What it shows | Query (conceptually) |
|---|---|---|
| Knowledge → Manuals | every Document for the tenant + its ToC | `documents WHERE tenant` |
| Namespace **file center** (the node panel) | Documents with a Section Link to this node **(+ subtree)** | `… JOIN kg_entities ON uns_path <@ node` |
| Asset page → Documents tab | Documents for this asset's node | `… WHERE kg_entity_id = asset.node` |
| Map node (`/knowledge/map`) click | the node's Documents + ToC | same subtree query |
| Chat **citation chip** | the cited Section Link → opens at the page | resolve `doc_id` + `page_start` |
| Work order | "attach manual" = a Section Link, not an upload | reference, never a new file |
| Quickstart / onboarding | the cold-start to-do list of missing manuals | Template sections with no tenant file |

**One viewer:** `/documents/[id]` opens the content-addressed file and honors `#page=N` (and `#section=…`).
"Open" does the same thing everywhere.

---

## 5. Customer-POV scenarios (acceptance walkthroughs)

1. **Upload once, see it everywhere.** Tech uploads the GS10 manual on the **asset page**. Without any
   further action it appears in the **namespace file center** under that machine, on the **Map node**, and
   as a **citation** when chat answers a GS10 question — all Section Links to the one stored file.
2. **Drop on a node.** Tech drags a wiring diagram onto a node in the **Namespace** tab. It lands in the
   *same* cabinet; it now shows in **Knowledge** and on the **asset page**. (Today it would vanish into
   `namespace_direct_uploads`.)
3. **Site-wide doc.** A safety SOP attached at the enterprise root: its Section Links surface on child
   nodes via the subtree query — no file copied down. A station opens it to the relevant section.
4. **Multi-machine manual.** A line manual's ToC routes "Station 2 conveyor" → station 2, "GS10 faults" →
   the VFD. Standing on the VFD and opening the manual lands on the drive-fault pages.
5. **Cold-start (network effect).** A brand-new customer with a GS10 they never documented opens a
   *populated* GS10: ToC, fault codes, pinout — from the shared **Template**. Hot links say "upload to
   read." Empty links are a to-do list of what to upload.
6. **Dedup / instant activation.** A customer uploads a file that fingerprints as the known public GS10
   manual → MIRA links to the shared copy instead of storing a private duplicate and immediately lights up
   every model-level Section Link.
7. **Local override.** The customer's redline says the E-stop moved to terminal 7; the model manual says
   terminal 5. A cited answer uses **terminal 7** and says "per your site drawing."

---

## 6. What we reuse vs. what's new

The point of the two-idea frame: **almost nothing is new machinery.**

| Concern | Rides existing machinery | New work |
|---|---|---|
| Chunk → node address | ADR-0019 chain `doc_id → hub_uploads.kg_entity_id → kg_entities.uns_path` | — |
| Subtree retrieval | `kg_entities` GIST `uns_path <@` index | — |
| Shared model knowledge | `component_templates` (already shared, not RLS) | attach ToC/facts to it |
| Tenant file privacy | `knowledge_entries.is_private` + RLS | access-grant model |
| Promotion gate | propose→verify (`ai_suggestions`, ADR-0017) | "model-truth vs tenant-truth" tag |
| Section→node mapping | the same AISuggestion queue we just fixed (#1890) | propose section anchors |
| "Same list everywhere" | — | one `DocumentList` component + one query |
| No copies | content-addressing | hash + dedup on `hub_uploads` |
| Local-beats-global | — | precedence in retrieval + layered citations |
| One registry | `hub_uploads` is already the richer one | fold in `namespace_direct_uploads`; TEXT→UUID |

---

## 7. Build sequence (each phase shippable + verifiable)

Every phase delivers a visible win and can stop there. Migrations go dev → staging → prod via
`apply-migrations.yml` (dry-run → apply), per `docs/environments.md`.

### Phase 0 — One cabinet (foundation)
- **Resolve the tenancy boundary FIRST — do not assume a clean cast.** `hub_uploads.tenant_id` is TEXT and
  in dev today holds **both** slug tenants (`"mike"`) **and** UUID-strings (verified 2026-06-12: 23 slug /
  16 UUID of 39 rows, 4 tenants). A naive `ALTER … TYPE uuid` would break on the slug rows — this is the
  migs-046/047 "Insert failed" landmine (`project_dual_tenancy_id_space`: equipment-keyed tables are
  deliberately TEXT). **Open decision (see §8):** either (a) map slugs → UUID via a tenant lookup and move
  `hub_uploads` to UUID, or (b) **keep `hub_uploads.tenant_id` TEXT** and resolve TEXT↔UUID at the join
  boundary in the unified query. Pick before writing the migration.
- Backfill `namespace_direct_uploads` rows into `hub_uploads` (carry `node_id` → `kg_entity_id`); point
  `/api/namespace/node/[id]/files` at `hub_uploads` + `runIngestPipeline`; **retire** the second registry
  (`CONTEXT.md` flagged ambiguity).
- **Verify:** a file uploaded in **Namespace** appears in **Knowledge** and vice-versa.

### Phase 1 — One list, one viewer, every surface
- A single `DocumentList` component + `GET /api/documents?node=…&subtree=1` (joins `hub_uploads` →
  `kg_entities` via the GIST subtree query). Render it in Knowledge, Namespace file center, asset
  Documents tab, Map node panel.
- One viewer `/documents/[id]` honoring `#page=N`.
- **Verify:** identical file list + opener across all four surfaces; opening from any surface hits the one
  stored file.

### Phase 2 — Section Links + Table of Contents (the hot links)
- Wire the chunker (`mira-ingest-v2` / Docling) to populate `section_path`, `page_start/end`, `doc_id` on
  `knowledge_entries` (columns already exist, mig 045).
- Derive the **ToC** from chunks grouped by section; render at the Document's home; `#page` jumps.
- Propose **section → node** (`equipment_entity_id`) mappings as AISuggestions; confirm in the Suggestions
  queue (the #1890 surface).
- **Verify:** a multi-section manual shows a ToC that jumps; a component node shows its own Section Link.

### Phase 3 — Content-addressing + dedup
- Add a content hash to `hub_uploads`; dedup on upload; fingerprint known **public OEM** manuals →
  link to the shared copy instead of storing a private duplicate.
- **Verify:** uploading the same file twice yields one blob; uploading a known OEM manual lights up
  model-level Section Links instantly.

### Phase 4 — Template/Instance knowledge split + resolution ladder
- Attach section knowledge + facts at the **Template** level; instance Section Links resolve the file at
  read time (own → shared public → "upload to read").
- Retrieval **blends shared + private** with tenant-private precedence; citations name the layer.
- Admin **promotion gate** for facts → Template (no auto-promote).
- **Verify:** a new customer with a GS10 (no upload) sees a populated ToC + "upload to read"; uploading
  lights up the files; a tenant correction overrides the model in a cited answer.

### Phase 5 — Network-effect surfaces & polish
- Cold-start scaffolding (the missing-manual to-do list), contributor signals, edition/version handling,
  storage-dedup reporting.

---

## 8. Risks & open questions

- **Model-binding is load-bearing.** Wrong instance→Template binding → wrong manual everywhere. Must be a
  *confirmed* proposal, not assumed.
- **Edition / version drift.** Manuals revise; `F004` can differ across editions. The Template layer needs
  edition-awareness and conflict handling (maps onto `proposed`/`verified`/`contradicted`).
- **Promotion poisoning.** One tenant's bad extraction must never reach the shared model — admin gate is
  non-negotiable.
- **Copyright line.** The shared layer holds **facts + pointers**, never copied verbatim pages. Verbatim
  prose lives only in the public-OEM shared copy or the tenant-private file.
- **Tenancy boundary (TEXT vs UUID) — unresolved, blocks Phase 0.** `hub_uploads.tenant_id` is TEXT and
  holds **both** slugs and UUID-strings today; the rest of the doc model is UUID. The memory
  `project_dual_tenancy_id_space` cautions that equipment-keyed tables (which `hub_uploads` resembles —
  it carries `asset_tag`/`kg_entity_id`) are deliberately TEXT, and that flipping migs 046/047 to UUID
  caused a 2026-06-10 "Insert failed". So the direction is a *real* open decision, not a clean cast:
  map-slugs-to-UUID-and-flip vs keep-TEXT-and-cast-at-the-join. Resolve before any Phase 0 migration; it
  touches the upload hot path.
- **Section→node mapping quality.** "Which pages are about station 2?" is an extraction + judgment call;
  start admin-curated, measure precision before trusting auto-proposals.

---

## 9. Non-goals

- Not unifying `kg_entities` ↔ `cmms_equipment` (full ADR-0013) — asset chat stays as-is.
- Not changing the manufacturer/model corpus-match retrieval the asset chat uses today.
- Not MQTT/live-tag grounding (fault-detective; separate).
- Not a new top-level `documents` table (deferred — promote `hub_uploads` instead).
- No control writes — read-only troubleshooting intelligence (`.claude/rules/train-before-deploy.md`).

---

## 10. Open decisions still to grill

1. **No-ToC inheritance default.** For files with no sections (a single wiring photo, a one-page
   datasheet): show only where dropped? roll **up** (a parent sees what's attached below)? roll down?
   *(Recommend: show at its node + roll up for visibility, never roll down.)*
2. **Who curates Template promotion** — MIRA admin only, or trusted tenant admins for their own contributed
   models?
3. **Edition handling** — one Template per model with multiple editions, or one per (model, edition)?
4. **Dedup fingerprint** — exact byte hash only, or also a fuzzy text fingerprint to catch the same manual
   re-exported/OCR'd differently?
5. **First-documenter incentive** — does the customer who documents a rare model get recognition, or does
   MIRA pre-seed popular models via `mira-crawler` so no one customer bears the cost?
