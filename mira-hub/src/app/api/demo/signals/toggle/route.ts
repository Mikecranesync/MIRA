import { NextResponse } from "next/server";
import { sessionOrDemo, isDemoTenant } from "@/lib/demo-auth";
import { withTenantContext } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

interface TogglePayload {
  component_id: string;
  state?: "present" | "clear" | "auto";    // discrete sensor states
  value_text?: string;
  value_numeric?: number;
  value_bool?: boolean;
  source?: string;
  notes?: string;
}

/**
 * POST /api/demo/signals/toggle
 *
 * Push a synthetic signal sample into live_signal_events. The tablet uses
 * this to drive the demo (e.g. simulate a tote interrupting PE-001) without
 * needing a real MQTT broker on the expo floor.
 *
 * If `state` is supplied (preferred for discrete sensors), it maps:
 *   - "present" → value_text='item_present', value_bool=true
 *   - "clear"   → value_text='idle_clear',   value_bool=false
 *   - "auto"    → invert the most recent reading for this component
 *
 * Otherwise you can pass value_text / value_numeric / value_bool directly.
 *
 * Demo-only: tenant must be the demo tenant. Returns the created event.
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

  let body: TogglePayload;
  try {
    body = (await req.json()) as TogglePayload;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body.component_id) {
    return NextResponse.json({ error: "component_id_required" }, { status: 400 });
  }

  try {
    const row = await withTenantContext<Record<string, unknown>>(ctx.tenantId, async (c) => {
      const cmp = await c
        .query(
          `SELECT id, plc_tag FROM installed_component_instances
            WHERE tenant_id = $1 AND id = $2
            LIMIT 1`,
          [ctx.tenantId, body.component_id],
        )
        .then((r: { rows: Record<string, unknown>[] }) => r.rows[0] ?? null);
      if (!cmp) {
        throw Object.assign(new Error("component_not_found"), { status: 404 });
      }

      let valueText = body.value_text ?? null;
      let valueNumeric = body.value_numeric ?? null;
      let valueBool = body.value_bool ?? null;

      if (body.state) {
        if (body.state === "present") {
          valueText = "item_present"; valueBool = true;
        } else if (body.state === "clear") {
          valueText = "idle_clear"; valueBool = false;
        } else if (body.state === "auto") {
          const last = await c
            .query(
              `SELECT value_bool, value_text FROM live_signal_events
                WHERE tenant_id = $1 AND component_id = $2
                ORDER BY created_at DESC LIMIT 1`,
              [ctx.tenantId, body.component_id],
            )
            .then((r: { rows: Record<string, unknown>[] }) => r.rows[0] ?? null);
          const wasPresent = last?.value_bool === true || last?.value_text === "item_present";
          valueText = wasPresent ? "idle_clear" : "item_present";
          valueBool = !wasPresent;
        }
      }

      if (valueText === null && valueNumeric === null && valueBool === null) {
        throw Object.assign(new Error("no_value_supplied"), { status: 400 });
      }

      const inserted = await c
        .query(
          `INSERT INTO live_signal_events
             (tenant_id, component_id, plc_tag, value_text, value_numeric, value_bool,
              simulated, source, properties)
           VALUES ($1, $2, $3, $4, $5, $6, true, $7, $8::jsonb)
           RETURNING id, component_id, plc_tag, value_text, value_numeric, value_bool,
                     simulated, source, properties, created_at`,
          [
            ctx.tenantId,
            body.component_id,
            cmp.plc_tag,
            valueText,
            valueNumeric,
            valueBool,
            body.source ?? "demo_simulator",
            JSON.stringify(body.notes ? { notes: body.notes } : {}),
          ],
        )
        .then((r: { rows: Record<string, unknown>[] }) => r.rows[0]);

      return inserted;
    });

    return NextResponse.json({ event: row }, { status: 201 });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    const msg = err instanceof Error ? err.message : "toggle_failed";
    if (status === 500) console.error("[api/demo/signals/toggle POST]", err);
    return NextResponse.json({ error: msg }, { status });
  }
}
