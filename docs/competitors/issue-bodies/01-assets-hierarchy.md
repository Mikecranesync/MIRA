## Why
Factory AI's Prevent models assets as a 4-level tree (site → area → asset → component) with unlimited sub-components and parent-child relationships. Their example: Motor Assembly → Motor (→ Stator, Rotor, Bearings) + Coupling + Base. We currently have a flat `cmms_equipment` table.

## Source
- `docs/competitors/factory-ai.md` → "Their data model" row `/assets`
- https://docs.f7i.ai/docs/prevent/user-guides/asset-registry

## Acceptance criteria
- [ ] Schema: `sites`, `areas`, `assets`, `components` tables (or `parent_id` self-ref) in NeonDB via migration
- [ ] `GET /api/assets` returns nested tree; `?flat=1` returns flat for list views
- [ ] `GET /api/assets/{id}/components` lists direct children
- [ ] Left-hand nav on `(hub)/assets` renders the tree; collapsible
- [ ] Asset detail page shows breadcrumb (site / area / asset / component)
- [ ] Seed data has at least one multi-level example (motor assembly with bearings)
- [ ] Playwright e2e: create parent asset → create child component → appears in tree

## Files
- Migration: `mira-hub/migrations/NNN_asset_hierarchy.sql`
- API: `mira-hub/src/app/api/assets/route.ts`, `.../assets/[id]/route.ts`, `.../assets/[id]/components/route.ts`
- UI: `mira-hub/src/app/(hub)/assets/page.tsx`, `.../assets/[id]/page.tsx`
