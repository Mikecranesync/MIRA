import { NextResponse } from "next/server";
import { sessionOrDemo } from "@/lib/demo-auth";
import { withTenantContext } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

interface ConfirmPayload {
  session_id?: string;
  asset_id: string;
  component_id?: string;
  channel?: "tablet" | "slack" | "telegram" | "web" | "other";
  metadata?: Record<string, unknown>;
}

/**
 * POST /api/sessions/confirm
 *
 * The UNS Confirmation Gate — flips a session to status='confirmed' once the
 * technician has acknowledged the asset/component context. Without a row in
 * `confirmed` status, /api/mira/ask refuses to invoke the LLM.
 *
 * If session_id is supplied, the existing row is updated. Otherwise a new
 * session is created. The endpoint validates that asset_id points at a real
 * kg_entities row in the same tenant before flipping the gate.
 */
export async function POST(req: Request) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOrDemo(req);
  if (ctx instanceof NextResponse) return ctx;

  let body: ConfirmPayload;
  try {
    body = (await req.json()) as ConfirmPayload;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body.asset_id) {
    return NextResponse.json(
      { error: "asset_id_required", reason: "Namespace gate requires a confirmed asset." },
      { status: 400 },
    );
  }

  const channel = body.channel ?? "tablet";

  try {
    const row = await withTenantContext<Record<string, unknown>>(ctx.tenantId, async (c) => {
      const asset = await c
        .query(
          `SELECT id FROM kg_entities
            WHERE tenant_id = $1 AND id = $2 AND entity_type = 'equipment'
            LIMIT 1`,
          [ctx.tenantId, body.asset_id],
        )
        .then((r: { rows: Record<string, unknown>[] }) => r.rows[0] ?? null);

      if (!asset) {
        throw Object.assign(new Error("asset_not_found"), { status: 404 });
      }

      if (body.component_id) {
        const cmp = await c
          .query(
            `SELECT id FROM installed_component_instances
              WHERE tenant_id = $1 AND id = $2 AND asset_id = $3
              LIMIT 1`,
            [ctx.tenantId, body.component_id, body.asset_id],
          )
          .then((r: { rows: Record<string, unknown>[] }) => r.rows[0] ?? null);
        if (!cmp) {
          throw Object.assign(new Error("component_not_on_asset"), { status: 400 });
        }
      }

      if (body.session_id) {
        const updated = await c
          .query(
            `UPDATE troubleshooting_sessions
                SET asset_id = $3,
                    component_id = $4,
                    channel = $5,
                    metadata = COALESCE($6::jsonb, metadata),
                    status = 'confirmed',
                    confirmed_at = COALESCE(confirmed_at, now()),
                    updated_at = now()
              WHERE tenant_id = $1 AND id = $2
              RETURNING *`,
            [
              ctx.tenantId,
              body.session_id,
              body.asset_id,
              body.component_id ?? null,
              channel,
              body.metadata ? JSON.stringify(body.metadata) : null,
            ],
          )
          .then((r: { rows: Record<string, unknown>[] }) => r.rows[0] ?? null);
        if (!updated) {
          throw Object.assign(new Error("session_not_found"), { status: 404 });
        }
        return updated;
      }

      const created = await c
        .query(
          `INSERT INTO troubleshooting_sessions
             (tenant_id, asset_id, component_id, technician_user_id,
              channel, status, confirmed_at, metadata)
           VALUES ($1, $2, $3, $4, $5, 'confirmed', now(), COALESCE($6::jsonb, '{}'::jsonb))
           RETURNING *`,
          [
            ctx.tenantId,
            body.asset_id,
            body.component_id ?? null,
            ctx.userId,
            channel,
            body.metadata ? JSON.stringify(body.metadata) : null,
          ],
        )
        .then((r: { rows: Record<string, unknown>[] }) => r.rows[0]);

      return created;
    });

    return NextResponse.json(
      {
        session: {
          id: row.id,
          status: row.status,
          asset_id: row.asset_id,
          component_id: row.component_id,
          channel: row.channel,
          confirmed_at: row.confirmed_at,
          created_at: row.created_at,
        },
      },
      { status: 201 },
    );
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    const msg = err instanceof Error ? err.message : "confirm_failed";
    if (status === 500) console.error("[api/sessions/confirm POST]", err);
    return NextResponse.json({ error: msg }, { status });
  }
}
