import { NextResponse } from "next/server";
import { sessionOrDemo } from "@/lib/demo-auth";
import { withTenantContext } from "@/lib/tenant-context";
import { summarizeHubSignals, type SignalRow } from "@/lib/hub/status";

export const dynamic = "force-dynamic";

type SignalCacheRow = {
  plc_tag: string;
  value?: string | number | boolean | null;
  last_value_text?: string | null;
  last_value_numeric?: number | null;
  last_value_bool?: boolean | null;
  last_changed_at: string | null;
};

function rowValue(row: SignalCacheRow) {
  if ("value" in row) return row.value ?? null;
  return row.last_value_bool ?? row.last_value_numeric ?? row.last_value_text ?? null;
}

function toSignalRow(row: SignalCacheRow): SignalRow {
  return {
    plc_tag: row.plc_tag,
    value: rowValue(row),
    last_changed_at: row.last_changed_at,
  };
}

export async function GET(req: Request) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }

  const ctx = await sessionOrDemo(req);
  if (ctx instanceof NextResponse) return ctx;

  try {
    const rows = await withTenantContext<SignalCacheRow[]>(ctx.tenantId, (client) =>
      client
        .query(
          `SELECT plc_tag,
                  last_value_text,
                  last_value_numeric,
                  last_value_bool,
                  last_changed_at
             FROM live_signal_cache
            WHERE tenant_id = $1::uuid
              AND (
                plc_tag LIKE 'conv_simple.%'
                OR plc_tag LIKE 'stardust.%'
              )
            ORDER BY plc_tag ASC`,
          [ctx.tenantId],
        )
        .then((result: { rows: SignalCacheRow[] }) => result.rows),
    );

    const asOf = new Date();

    return NextResponse.json(
      {
        zones: summarizeHubSignals(rows.map(toSignalRow), asOf),
        as_of: asOf.toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    console.error("[api/hub/status GET]", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}
