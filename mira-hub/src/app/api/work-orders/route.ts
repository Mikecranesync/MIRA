import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { sessionOr401 } from "@/lib/session";
import { requireCapability } from "@/lib/capabilities";
import { withTenantContext } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

const PRIORITY_VALUES = new Set(["low", "medium", "high", "critical"]);

function woNumber(): string {
  return `WO-${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

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
    atlas_id: r.atlas_id ? String(r.atlas_id) : null,
    cmms_synced_at: r.cmms_synced_at ? new Date(String(r.cmms_synced_at)).toISOString() : null,
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
          tenant_id, created_at, updated_at,
          atlas_id, cmms_synced_at
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

export async function POST(req: NextRequest) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }

  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  const denied = requireCapability(ctx, "work_orders.create");
  if (denied) return denied;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const equipmentId = typeof body.equipment_id === "string" ? body.equipment_id.trim() : "";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const faultDescription =
    typeof body.fault_description === "string" ? body.fault_description.trim() : description;
  const priorityRaw =
    typeof body.priority === "string" ? body.priority.trim().toLowerCase() : "medium";
  const priority = PRIORITY_VALUES.has(priorityRaw) ? priorityRaw : "medium";

  if (!equipmentId) {
    return NextResponse.json({ error: "equipment_id is required" }, { status: 400 });
  }
  if (!description) {
    return NextResponse.json({ error: "description is required" }, { status: 400 });
  }

  try {
    const row = await withTenantContext(ctx.tenantId, async (c) => {
      const eq = await c.query<{
        id: string;
        manufacturer: string | null;
        model_number: string | null;
      }>(
        `SELECT id, manufacturer, model_number
         FROM cmms_equipment
         WHERE id = $1 AND tenant_id = $2
         LIMIT 1`,
        [equipmentId, ctx.tenantId],
      );
      const equipment = eq.rows[0];
      if (!equipment) return null;

      const finalTitle =
        title ||
        `Issue: ${[equipment.manufacturer, equipment.model_number].filter(Boolean).join(" ") || "asset"}`;

      const result = await c.query(
        `INSERT INTO work_orders (
            id, work_order_number, source, created_by_agent,
            manufacturer, model_number, equipment_id,
            title, description, fault_description,
            suggested_actions, safety_warnings,
            status, priority, route_taken,
            tenant_id, user_id, created_at, updated_at
          ) VALUES (
            gen_random_uuid(), $1, 'hub_ui', NULL,
            $2, $3, $4,
            $5, $6, $7,
            ARRAY[]::TEXT[], ARRAY[]::TEXT[],
            'open'::workorderstatus, $8::prioritylevel, NULL,
            $9, $10, NOW(), NOW()
          )
          RETURNING id, work_order_number, source, created_by_agent,
            manufacturer, model_number, equipment_id,
            title, description, suggested_actions, safety_warnings,
            status, priority, route_taken, tenant_id, created_at, updated_at,
            atlas_id, cmms_synced_at`,
        [
          woNumber(),
          equipment.manufacturer,
          equipment.model_number,
          equipment.id,
          finalTitle,
          description,
          faultDescription,
          priority,
          ctx.tenantId,
          ctx.userId,
        ],
      );
      return result.rows[0] ?? null;
    });

    if (!row) {
      return NextResponse.json({ error: "Asset not found for this tenant" }, { status: 404 });
    }

    return NextResponse.json({ work_order: rowToWO(row) }, { status: 201 });
  } catch (err) {
    console.error("[api/work-orders POST]", err);
    return NextResponse.json({ error: "Failed to create work order" }, { status: 500 });
  }
}
