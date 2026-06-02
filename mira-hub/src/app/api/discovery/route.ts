import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { validateInventory } from "@/lib/discovery";
import { getLatestInventory, setLatestInventory } from "@/lib/discovery-store";

export const dynamic = "force-dynamic";

/**
 * Fieldbus discovery inventory — the Hub display surface for `plc/discover.py`.
 *
 * Spec: docs/specs/fieldbus-discovery-spec.md §8 (inventory.json contract).
 *
 * GET  → the latest uploaded `fieldbus-inventory/1` payload for the tenant
 *        (`{ inventory: null }` when nothing has been uploaded yet).
 * POST → validate an uploaded payload and store it as the tenant's latest.
 *
 * STORE: in-memory, latest-only, per-tenant (see lib/discovery-store.ts). This
 * is the v1 design — lost on restart, not multi-instance-safe. NeonDB-backed
 * scan history is deferred (spec §3/§12). The CLI cannot POST here directly
 * (no session cookie); v1 is browser drag-drop only — a service-token push
 * route is a deferred follow-up (cf. api/uploads/folder).
 */

export async function GET() {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  return NextResponse.json({ inventory: getLatestInventory(ctx.tenantId) });
}

export async function POST(req: Request) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const result = validateInventory(body);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  setLatestInventory(ctx.tenantId, result.inventory);
  return NextResponse.json({
    inventory: result.inventory,
    deviceCount: result.inventory.devices.length,
    unknownCount: result.inventory.unknowns.length,
  });
}
