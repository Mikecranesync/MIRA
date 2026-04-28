import { NextRequest, NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

function rowToWO(r: Record<string, unknown>) {
  const source = String(r.source ?? "");
  const isAutoPM = source === "auto_pm";

  // Parse suggested_actions (stored as text[] in postgres, arrives as array)
  const suggested: string[] = Array.isArray(r.suggested_actions)
    ? (r.suggested_actions as string[])
    : [];

  const safety: string[] = Array.isArray(r.safety_warnings)
    ? (r.safety_warnings as string[])
    : [];

  // Parse manual citation and parts from description (for auto_pm WOs)
  const desc = String(r.description ?? "");
  const citationMatch = desc.match(/Manual reference: (.+)/);
  const sourceCitation = citationMatch ? citationMatch[1].trim() : null;

  const partsMatch = desc.match(/Parts needed:\n((?:  •[^\n]+\n?)+)/);
  const partsNeeded = partsMatch
    ? partsMatch[1].split("\n").map(l => l.replace(/^\s*•\s*/, "").trim()).filter(Boolean)
    : [];

  const toolsMatch = desc.match(/Tools needed:\n((?:  •[^\n]+\n?)+)/);
  const toolsNeeded = toolsMatch
    ? toolsMatch[1].split("\n").map(l => l.replace(/^\s*•\s*/, "").trim()).filter(Boolean)
    : [];

  const createdAt = r.created_at ? new Date(String(r.created_at)) : new Date();
  const due = r.updated_at
    ? new Date(String(r.updated_at)).toISOString().slice(0, 10)
    : createdAt.toISOString().slice(0, 10);

  return {
    id: String(r.id),
    work_order_number: String(r.work_order_number ?? ""),
    title: String(r.title ?? r.description ?? "Work Order"),
    description: desc,
    asset: [r.manufacturer, r.model_number].filter(Boolean).join(" ") || "Unknown Asset",
    manufacturer: r.manufacturer ?? null,
    model_number: r.model_number ?? null,
    equipment_id: r.equipment_id ? String(r.equipment_id) : null,
    status: String(r.status ?? "open"),
    priority: String(r.priority ?? "medium"),
    source,
    source_label: isAutoPM ? "Auto-PM" : source === "telegram_text" ? "Telegram" : source,
    is_auto_pm: isAutoPM,
    created_by_agent: r.created_by_agent ? String(r.created_by_agent) : null,
    suggested_actions: suggested,
    safety_warnings: safety,
    parts_needed: partsNeeded,
    tools_needed: toolsNeeded,
    source_citation: sourceCitation,
    due,
    created_at: createdAt.toISOString(),
    tenant_id: r.tenant_id ? String(r.tenant_id) : null,
  };
}

export async function GET(req: NextRequest) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }

  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  const { searchParams } = req.nextUrl;
  const source = searchParams.get("source") ?? "";
  const statusFilter = searchParams.get("status") ?? "";

  const params: unknown[] = [ctx.tenantId];
  const filters: string[] = ["tenant_id = $1"];

  if (source) {
    params.push(source);
    filters.push(`source::text = $${params.length}`);
  }
  if (statusFilter) {
    params.push(statusFilter);
    filters.push(`status::text = $${params.length}`);
  }

  const where = filters.join(" AND ");

  try {
    const rows = await withTenantContext(ctx.tenantId, (c) =>
      c.query(
        `SELECT
          id, work_order_number, source, created_by_agent,
          manufacturer, model_number, equipment_id,
          title, description,
          suggested_actions, safety_warnings,
          status, priority, route_taken,
          tenant_id, created_at, updated_at
        FROM work_orders
        WHERE ${where}
        ORDER BY
          CASE status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END,
          CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
          created_at DESC
        LIMIT 200`,
        params,
      ).then((r) => r.rows),
    );

    return NextResponse.json({
      count: rows.length,
      work_orders: rows.map(rowToWO),
    });
  } catch (err) {
    const msg = String(err);
    if (msg.includes("work_orders") && msg.includes("does not exist")) {
      return NextResponse.json({ count: 0, work_orders: [] });
    }
    console.error("[api/work-orders GET]", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}
