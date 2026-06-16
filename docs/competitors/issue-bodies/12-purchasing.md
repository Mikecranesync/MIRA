## Why
Factory AI's purchasing: PO lifecycle (Draft → Pending Approval → Approved → Ordered → Receiving → Closed), approval hierarchy by dollar threshold, vendor scoring. We don't have this yet.

## Source
- https://docs.f7i.ai/docs/prevent/user-guides/purchasing
- https://docs.f7i.ai/docs/api/part-orders

## Acceptance criteria
- [ ] Schema: `purchase_orders`, `po_line_items` (type: part/service/fee), `po_approvals` (approver_id, threshold_tier, decided_at, comment)
- [ ] Approval rules table: `{tier, min_usd, max_usd, approver_role}`
- [ ] State machine enforced server-side
- [ ] Receiving flow: partial ship, quality check, serial/warranty capture
- [ ] Vendor on-time-delivery score computed from receipt timestamps
- [ ] UI: `(hub)/parts/purchasing/page.tsx` — list + create + approve tabs

## Files
- `mira-hub/migrations/NNN_purchasing.sql`
- `mira-hub/src/app/api/purchase-orders/**/*.ts`
- `mira-hub/src/app/(hub)/parts/purchasing/page.tsx`
