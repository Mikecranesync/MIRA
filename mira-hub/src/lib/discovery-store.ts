// In-memory, latest-only store for the most recent uploaded fieldbus inventory,
// keyed by tenant. This is the deliberate v1 design (spec §3 defers NeonDB
// persistence to v1.5):
//
//   LIMITATIONS (by design, documented in PLAN.md + HANDOFF.md):
//   - Lost on process restart — there is no durability.
//   - NOT multi-instance safe — a horizontally-scaled deploy would see
//     per-instance state. The Hub currently runs a single `next start`
//     process, so this holds for today's deploy shape.
//   - Stores only the LATEST inventory per tenant; no scan history.
//
// When discovery graduates to persisted scans, replace this module with a
// NeonDB-backed table — the route handlers are the only callers.

import type { FieldbusInventory } from "@/lib/discovery";

const store = new Map<string, FieldbusInventory>();

export function getLatestInventory(tenantId: string): FieldbusInventory | null {
  return store.get(tenantId) ?? null;
}

export function setLatestInventory(tenantId: string, inventory: FieldbusInventory): void {
  store.set(tenantId, inventory);
}

// Test-only: clear state between cases so the module singleton doesn't leak.
export function __resetInventoryStore(): void {
  store.clear();
}
