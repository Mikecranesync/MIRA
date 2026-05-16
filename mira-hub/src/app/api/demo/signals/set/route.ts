import { NextResponse } from "next/server";
import { sessionOrDemo, isDemoTenant } from "@/lib/demo-auth";
import { withTenantContext } from "@/lib/tenant-context";
import { recordSignalValue } from "@/lib/signal-recorder";

export const dynamic = "force-dynamic";

interface SetPayload {
  plc_tag?: string;
  component_id?: string;
  value_text?: string | null;
  value_numeric?: number | null;
  value_bool?: boolean | null;
  source?: string;
  notes?: string;
  properties?: Record<string, unknown>;
}

/**
 * POST /api/demo/signals/set
 *
 * Set an arbitrary signal value by plc_tag OR component_id. Unlike `toggle`,
 * this endpoint does not interpret `present`/`clear`/`auto` semantics — the
 * caller passes whichever value flavor matches the tag's type (text for
 * discrete states, numeric for analog, bool for 1-bit).
 *
 * Writes through `recordSignalValue`, which keeps live_signal_events and
 * live_signal_cache in sync and reports the edge classification
 * (rising | falling | changed | steady) the cache UPSERT detected.
 *
 * Demo-tenant only.
 */
export async function POST(req: Request) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOrDemo(req);
  if (ctx instanceof NextResponse) return ctx;
  if (!isDemoTenant(ctx.tenantId)) {
    return NextResponse.json(
      { error: "Signal simulator is demo-tenant only" },
      { status: 403 },
    );
  }

  let body: SetPayload;
  try {
    body = (await req.json()) as SetPayload;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body.plc_tag && !body.component_id) {
    return NextResponse.json(
      { error: "plc_tag_or_component_id_required" },
      { status: 400 },
    );
  }
  if (
    (body.value_text === undefined || body.value_text === null) &&
    (body.value_numeric === undefined || body.value_numeric === null) &&
    (body.value_bool === undefined || body.value_bool === null)
  ) {
    return NextResponse.json({ error: "no_value_supplied" }, { status: 400 });
  }

  const properties =
    body.properties ?? (body.notes ? { notes: body.notes } : undefined);

  try {
    const result = await withTenantContext(ctx.tenantId, (c) =>
      recordSignalValue(c, {
        tenantId: ctx.tenantId,
        plcTag: body.plc_tag ?? null,
        componentId: body.component_id ?? null,
        value: {
          text: body.value_text ?? null,
          numeric: body.value_numeric ?? null,
          bool: body.value_bool ?? null,
        },
        source: body.source ?? "demo_simulator",
        simulated: true,
        properties,
      }),
    );

    return NextResponse.json(
      {
        event_id: result.eventId,
        plc_tag: result.plcTag,
        component_id: result.componentId,
        edge: result.edge,
        last_changed_at: result.lastChangedAt,
        previous_value: result.previousValue,
      },
      { status: 201 },
    );
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    const msg = err instanceof Error ? err.message : "set_failed";
    if (status === 500) console.error("[api/demo/signals/set POST]", err);
    return NextResponse.json({ error: msg }, { status });
  }
}
