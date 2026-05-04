## Why
Factory AI inventory does ABC (value-based) / XYZ (demand-variability) analysis, fast/slow/dead-stock identification, and intelligent reorder with vendor-specific lead times, package quantities, minimum order quantities. We currently have a shell `(hub)/parts` page.

## Source
- https://docs.f7i.ai/docs/prevent/user-guides/inventory-management
- https://docs.f7i.ai/docs/api/parts + /inventory

## Acceptance criteria
- [ ] Schema: `parts`, `vendors`, `part_vendors` (part↔vendor with lead_time_days, pkg_qty, min_order_qty, unit_cost), `stock_levels` (part_id, location, on_hand, reserved, on_order, min_level, max_level)
- [ ] ABC classifier: nightly job computes A/B/C class per part from YTD consumption × unit cost
- [ ] XYZ classifier: coefficient of variation on monthly demand
- [ ] Dead-stock detector: flags parts with 0 consumption > 12 months
- [ ] Auto-reorder trigger: when on_hand < min_level, enqueue PO draft
- [ ] UI: `(hub)/parts/page.tsx` with ABC/XYZ filter, stock health indicators, barcode scan field

## Files
- `mira-hub/migrations/NNN_inventory.sql`
- `mira-hub/src/app/api/parts/**/*.ts`
- `mira-hub/src/app/api/inventory/**/*.ts`
- `mira-hub/src/app/(hub)/parts/page.tsx`
