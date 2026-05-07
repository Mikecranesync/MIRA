/**
 * Internal KG API — single dispatch endpoint for the multi-hop traversal
 * surface. mira-mcp's FastMCP tools call this over HTTP so the DB writer
 * stays TS-side (Phase 5 of the multi-hop spec, §9).
 *
 * Auth: Bearer token via INTERNAL_KG_API_KEY. Service-to-service only —
 * never exposed publicly. Tenancy is passed in the request body (the
 * caller is trusted to pin the right tenant).
 *
 * Request shape:
 *   { "op": "<operation>", "tenantId": "<uuid>", "args": { ... } }
 *
 * Operations:
 *   maintenance_context  — args { equipmentEntityId, includeSimilar?, faultWindowDays?, maxWorkOrders? }
 *   impact_analysis      — args { entityId }   (kg_entities.id)
 *   root_cause_chain     — args { faultEntityId }
 *   traverse_chain       — args { startEntityId, relationshipChain[], maxDepth? }
 *   flag_pm_mismatches   — args { lookbackDays?, equipmentEntityId? }
 */

import { NextResponse, type NextRequest } from "next/server";
import {
  maintenanceContext,
  impactAnalysis,
  rootCauseChain,
  traverseChain,
} from "@/lib/knowledge-graph/traversal";
import { flagPmMismatches } from "@/lib/knowledge-graph/plan-vs-actual";

export const dynamic = "force-dynamic";

interface KgRequest {
  op: string;
  tenantId: string;
  args?: Record<string, unknown>;
}

function isUuid(s: unknown): s is string {
  return typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

export async function POST(req: NextRequest) {
  const expected = process.env.INTERNAL_KG_API_KEY;
  if (!expected) {
    return NextResponse.json({ error: "INTERNAL_KG_API_KEY not set" }, { status: 503 });
  }
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: KgRequest;
  try {
    body = (await req.json()) as KgRequest;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (!body || typeof body.op !== "string" || !isUuid(body.tenantId)) {
    return NextResponse.json({ error: "missing op or tenantId" }, { status: 400 });
  }
  const args = (body.args ?? {}) as Record<string, unknown>;

  try {
    switch (body.op) {
      case "maintenance_context": {
        const equipmentEntityId = args.equipmentEntityId;
        if (typeof equipmentEntityId !== "string") {
          return NextResponse.json({ error: "equipmentEntityId required" }, { status: 400 });
        }
        const result = await maintenanceContext(body.tenantId, equipmentEntityId, {
          includeSimilar: args.includeSimilar === true,
          faultWindowDays: typeof args.faultWindowDays === "number" ? args.faultWindowDays : undefined,
          maxWorkOrders: typeof args.maxWorkOrders === "number" ? args.maxWorkOrders : undefined,
        });
        return NextResponse.json({ ok: true, result });
      }
      case "impact_analysis": {
        const entityId = args.entityId;
        if (typeof entityId !== "string") {
          return NextResponse.json({ error: "entityId required" }, { status: 400 });
        }
        const result = await impactAnalysis(body.tenantId, entityId);
        return NextResponse.json({ ok: true, result });
      }
      case "root_cause_chain": {
        const faultEntityId = args.faultEntityId;
        if (typeof faultEntityId !== "string") {
          return NextResponse.json({ error: "faultEntityId required" }, { status: 400 });
        }
        const result = await rootCauseChain(body.tenantId, faultEntityId);
        return NextResponse.json({ ok: true, result });
      }
      case "traverse_chain": {
        const startEntityId = args.startEntityId;
        const chain = args.relationshipChain;
        if (typeof startEntityId !== "string" || !Array.isArray(chain)) {
          return NextResponse.json({ error: "startEntityId and relationshipChain required" }, { status: 400 });
        }
        const stringChain = chain.filter((c): c is string => typeof c === "string");
        const result = await traverseChain(
          body.tenantId,
          startEntityId,
          stringChain,
          typeof args.maxDepth === "number" ? args.maxDepth : undefined,
        );
        return NextResponse.json({ ok: true, result });
      }
      case "flag_pm_mismatches": {
        const result = await flagPmMismatches(body.tenantId, {
          lookbackDays: typeof args.lookbackDays === "number" ? args.lookbackDays : undefined,
          equipmentEntityId:
            typeof args.equipmentEntityId === "string" ? args.equipmentEntityId : undefined,
        });
        return NextResponse.json({ ok: true, result });
      }
      default:
        return NextResponse.json({ error: `unknown op: ${body.op}` }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "internal error" },
      { status: 500 },
    );
  }
}
