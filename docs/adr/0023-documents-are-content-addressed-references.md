# ADR-0023: Documents are content-addressed, stored once, and referenced — knowledge rides Template/Instance

**Status:** Proposed (2026-06-12)
**Relates to:** ADR-0019 (mira-ingest-v2 — the `doc_id → hub_uploads.kg_entity_id → kg_entities.uns_path` chain), ADR-0020 (superseded link-table — *no sibling truth tables*), ADR-0013 (kg/cmms canonicalization), ADR-0017 (proposal state machine — the promotion gate)
**Spec:** `docs/specs/unified-document-reference-layer-spec.md`
**Glossary:** `CONTEXT.md` § "Documents & references"

## Decision

A **Document** (any uploaded file) is **content-addressed** — identified by the hash of its bytes and
stored **exactly once**. Everything that appears anywhere else in the Hub is a **Section Link** (a deep-link
reference into that one file at a section/page range), **never a copy**. A Document's *knowledge* (its
section structure + extracted facts) attaches at the **Template** level (`component_templates`, shared across
all tenants, admin-curated) and is reused by every Instance of that model; the Document *file* and any tenant
corrections stay **tenant-scoped**. A file is shared (a public OEM doc, one global copy) or tenant-private by
**access grant**, never by duplication — proprietary files never cross tenants.

## Why (the trade-off)

The Hub today has three disjoint representations of "a document" (`hub_uploads`, `namespace_direct_uploads`,
`knowledge_entries.doc_id`), written by two upload paths, listed by five surfaces — so "upload once, appears
everywhere" is structurally impossible and customers hunt for docs. We rejected the obvious "attach a file to
each node" model because it duplicates files, scatters copies, and can't share knowledge across tenants. The
content-addressed-reference model makes "stored once" a *property of the storage* (you can't make a duplicate)
and folds the cross-tenant network effect onto rails the product already has — the **Template/Instance** split
that Components already use (ADR-0018), the propose→verify promotion gate (ADR-0017), `is_private`/RLS for the
file boundary, and the ADR-0019 chunk→node chain + `kg_entities` GIST subtree index. It is *less* machinery
than the status quo, not more.

## Considered options

- **Attach/copy files to each node** — rejected: duplicates files, no cross-tenant sharing, contradicts the
  customer's explicit "one place only" requirement.
- **A new top-level `documents` table with the registries as satellites** — cleaner on paper but a larger
  migration and leaves two tables underneath; deferred in favor of promoting `hub_uploads`.
- **A unifying SQL VIEW over both registries** — rejected as a band-aid: the TEXT/UUID tenancy split and
  dual-write persist as permanent debt.
- **A `knowledge_node_links` sibling table** — already rejected by ADR-0020 (dual-truth). We ride the existing
  `doc_id → hub_uploads.kg_entity_id → kg_entities.uns_path` chain instead.

## Consequences

- `hub_uploads` becomes the canonical Document registry; `namespace_direct_uploads` is folded in and retired
  (`CONTEXT.md` flagged ambiguity, 2026-06-12).
- The unified query crosses a **TEXT/UUID tenancy boundary**: `hub_uploads.tenant_id` is TEXT and holds
  *both* slug tenants (`"mike"`) and UUID-strings (verified dev 2026-06-12), while
  `knowledge_entries`/`kg_entities` are UUID. Resolving this is a real open decision — map-slugs-to-UUID-
  and-flip vs keep-TEXT-and-cast-at-the-join — **not** a clean `ALTER TYPE`. The memory
  `project_dual_tenancy_id_space` warns the opposite direction (equipment-keyed tables stay TEXT) and that
  a prior UUID flip (migs 046/047) caused an "Insert failed". Decide before Phase 0; do not assume the cast.
- Retrieval must blend **shared model** + **tenant-private** chunks, with **tenant-private winning conflicts**
  ("local beats global"), and citations must name which layer they came from.
- Promotion of facts to the shared Template stays **admin-gated** — one tenant's bad extraction must never
  poison every tenant's model. The instance→Template binding becomes load-bearing (wrong binding → wrong
  manual everywhere), so it must be confirmed, not assumed.
