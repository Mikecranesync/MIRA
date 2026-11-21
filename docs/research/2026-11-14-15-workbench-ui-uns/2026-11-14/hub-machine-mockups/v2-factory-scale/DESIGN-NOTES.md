# FactoryLM Hub hierarchy at factory scale — design revision

> Publication note (2026-11-15): archived research and observations from the date stated below, not a current release-status report or new authorization. See the [collection index](../../../README.md) and [private-evidence policy](../../../PRIVATE-EVIDENCE.md).

Date: 2026-11-14. Status: visual design proposal, not implemented product behavior.

## Product decision
Use the equipment hierarchy as a reliable address and navigation aid. Let a technician enter by search, a recent item, an existing work record or a known equipment link. Do not require a walk from enterprise to component for every question.

Default presentation: company (when needed) → site → area → line/cell → machine → optional assembly → component. This is a configurable product navigation model, not a claim that every factory uses identical ISA-95 levels. Skip levels absent in the customer's approved structure. Standalone assets and utilities remain under their real parent. A shared utility can serve many lines through relationships without duplicate equipment records.

For the bench retain its established Home Garage / Conveyor Lab / Conveyor 1 identity and integration path. The North Plant screenshots are separate synthetic examples; they are not a proposal to rename or migrate CV-101. ADR-0035 prohibits treating path cleanup as a cosmetic edit.

## Technician behavior
- Start at the last authorized site/area. Present recent equipment/conversations and scoped search. Never turn that remembered browse location into an implicit send target.
- Browse shallow branches. A line lists machines; a machine lists components. Optional assemblies narrow large machines. Child groups load only when expanded; long lists are paginated.
- Search within the explicitly displayed site, area or line. Offer a deliberate scope change; do not silently expand a failed narrow search to the whole company.
- Search canonical tags, aliases, machine names, physical locations and part/model numbers. Exact tag matching can rank first, but multiple matches require an instance choice. Fuzzy text helps discovery; it cannot identify equipment or validate a manual.
- Results show tag, machine, line and location. Site appears when results span sites. Repeated MLC or VFD1 tags are normal, not duplicate records to merge.
- Do not make the tech scroll an enterprise tree to find a component. Known equipment links and authorized scans should resolve directly to the canonical instance; platform camera/scan support is a separate capability check.
- Preserve query, filters, branch, page and scroll on return. Opening a PDF must return to the same equipment context.
- A line overview does not authorize answering as if all subordinate components share one model, manual, state or conversation history.
- Near the composer always show an unambiguous target. Keep the short machine/component path visible with the keyboard; site/area remain inspectable. On a context conflict, retain the draft and attachments, compare old/new targets, require explicit review and a fresh Send.

## Model boundaries
1. Canonical record IDs identify nodes. Display tags, aliases and path strings are not primary identity. Moving or renaming an asset must not destroy links/history or silently change answer ownership.
2. Containment is not control. Reuse ADR-0018: VFD and motor are peers under their assembly; drives, powered-by and wired-to relationships have their own evidence and approval. The screenshots' Connections tab is a proposed presentation, not proof that runtime graph defects are repaired.
3. Functional position and physical installed item are separate concepts. Replacement preserves the position's history, records installation/removal lineage and resets identity/applicability checks for the new item. Reuse existing asset/installed-instance records; do not introduce parallel stores.
4. Catalog model data may be shared only under approved applicability rules. Serial, measured condition, wiring, local faults, photos and technician notes remain instance-specific.
5. Cabinet, panel row and terminal are location information. They can be actual containers where the approved model says so, or a separate location view; do not impose them as mandatory nodes on every process hierarchy.
6. Shared utilities are one asset linked to consumers, not copied beneath each line. Unknown/unplaced assets remain searchable and labelled Location not set.
7. Projects remain collaboration and permission contexts. Equipment browsing must not combine otherwise inaccessible project histories or source collections.

## Scale gap in inspected checkout
CodeGraph inspection found:
- mira-hub/src/factorylm-ui/ScopePicker.tsx fetches /api/assets and filters the returned machines in the browser (ScopePicker, filterMachines).
- mira-hub/src/app/api/namespace/tree/route.ts fetches the tenant namespace entities and builds the complete tree (GET, buildTree).
These observations concern this checkout, not a benchmark of staging. They are sufficient to reject a claim that the mockup's pagination already exists.

For connected implementation, first inspect origin/main and current PRs for a bounded search/children capability. Extend the canonical API if needed; do not build a parallel asset/search service. Minimum behavior: tenant/permission-filtered search and direct-child queries, stable cursor pagination with bounded page size, canonical IDs plus display breadcrumb context, explicit loading/error/empty states, and truthful counts. Retain compatibility for old clients and links. Do not expose unauthorized records through names, counts, autocomplete or caches. Use exact known IDs to open records; breadcrumbs are display context.

Proposed default page size: 50. The mockups show 6–8 rows for review legibility, not a mandated production page size. Do not preload all notebooks, chats, sources or telemetry to render navigation. Navigation must not call an LLM.

This is a change to the earlier bench-only assumption that no API work would be needed. The scale design likely requires bounded API work, after reuse discovery. Database index/migration needs must be established from query plans and current schema, not inferred from mockups.

## FactoryLM style and AI-slop filter
Authority: .claude/rules/ui-style.md → docs/design/factorylm-style.md and docs/design/factorylm-tokens.css. Use the workspace indigo palette, not the older public-marketing orange register.
- Flat solid surfaces; thin dividers; no gradients, glow, bevel, glossy cards or decorative shadows.
- One indigo accent for selection and primary actions. State color is reserved for evidence-backed status and accompanied by text. Unknown does not mean stopped or healthy.
- Compact rows instead of one card per machine/component. Large touch targets, quiet headers and monospace tags. No giant greetings, hero panels or ornamental equipment cartoons.
- Plain copy: Equipment, Line 03, Check label, Open source page. Remove sparkles, promotional claims, magic language, confidence percentages and redundant buttons.
- The HTML gallery imports an unchanged copy of canonical tokens. Raster mockups approximate the visual system; they are not a token-exact CSS implementation. The generation corrections removed prominent badge fills and corrected generated labels. Any residual raster shading is not an approved gradient for implementation.
- A visible label check is meaningful; repeated boilerplate safety text on every row is not. Do not use successful catalog extraction as an identity badge.

## Verification loop
Visual walkthrough first: without coaching, find MLC on Line 03 / CV-301; reject same-tag alternatives on other lines; find CP-01 / Row 1; explain catalog vs installed information; open source; return to the same target.

Connected acceptance fixture (proposed, not run): 8 lines × 50 machines × 50 components = 20,000 components at one site, including 400 same-tag MLC instances; add a second site, same-model components, shared utility, unplaced equipment, optional levels, moved assets and replacement history.

Required cases:
- Find by exact tag, alias, location and model; constrain/expand scope explicitly; ambiguous matches never auto-send or auto-bind.
- Paging/filter changes cancel obsolete requests; late responses never replace a newer selection. Back restores context; deleted/inaccessible links fail clearly.
- Tenant/project isolation for rows, counts, search, recent items and history. Search failures differ from no results.
- No cross-instance evidence/history/telemetry leakage; no operational state inferred from hierarchy, commands, missing registers or count badges.
- Preserve draft/attachments through scope changes and poor connectivity; retained text is reviewed before sending under a new target.
- Bounded initial transfer and DOM: at most one page of records per list plus loaded breadcrumb/branch context; no full-plant tree response required to open a known component.
- Measure on the actual tablet with realistic latency and the fixture; initial proposed targets are cached interaction under 100 ms and search first page within 1 s p95 on the agreed staging network. They are test targets, not measured performance.
- Contrast, text zoom, keyboard-visible context, focus, screen reader labels and large touch controls. Raster previews do not establish WCAG conformance.
- Mike reviews first, then three unfamiliar technicians perform the same find/ask/source/return tasks. Record wrong-instance choices, assistance and completion time; zero wrong-instance submissions is the acceptance requirement.

No deployment, machine operation, data migration or production claims are authorized by this design artifact.

## Sources
- Local style authority: /Users/charlienode/.codex/worktrees/e116/MIRA/docs/design/factorylm-style.md
- Local containment decision: /Users/charlienode/.codex/worktrees/e116/MIRA/docs/adr/0018-component-hierarchy-siblings-with-control-edges.md
- Existing bench path contract: /Users/charlienode/.codex/worktrees/e116/MIRA/docs/adr/0035-cv101-canonical-uns-path.md
- OPC Foundation equipment-level definitions: https://reference.opcfoundation.org/specs/OPC-10030/7.4.1
- W3C contrast guidance: https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html

Generated with the built-in image_gen.imagegen tool. Prompts and edit prompts are in prompts.json. Original and final generated outputs remain intact; final hashes and copied-token provenance are in manifest.json.

## Artifact checks completed
Visually inspected all four final generated images. Verified their hashes, every local gallery reference, all eight saved generation/edit prompts, byte-identical canonical token copy, and absence of literal colors or gradients in the gallery's authored stylesheet. Browser automation could not inspect the rendered local gallery: the Browser Use URL policy blocked the file URL. No alternate access path was attempted. Therefore no browser-rendered gallery or interactive behavior check is claimed.
