import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

const FAULT_ROLES = new Set(["fault", "alarm", "fault_code", "diagnostic"]);
const PARAM_ROLES = new Set(["parameter", "setpoint", "config", "limit", "threshold"]);

interface BatchHeadRow {
  id: string;
  project_id: string;
  project_name: string;
  ingest_route: string;
  bundle_sha256: string | null;
  review_status: string;
  created_at: string;
  updated_at: string;
}
interface SourceRow {
  id: string;
  source_type: string;
  file_name: string;
  status: string;
  source_sha256: string | null;
  created_at: string;
}
interface ExtractionRow {
  id: string;
  tag_name: string;
  roles: string[] | null;
  uns_path_proposed: string | null;
  i3x_element_id: string | null;
  confidence: string | null;
  status: string;
  evidence_json: unknown;
  source_file: string | null;
}

/**
 * GET /api/contextualization/batches/[batchId]
 *
 * Full review payload for one import batch, grouped under the shared HubV3
 * vocabulary: Sources, Evidence, Extracted Signals, Fault Catalog, Parameters,
 * UNS Map, Scorecard. Sections the staged schema does not populate come back
 * empty (the screen shows an honest empty-state) — never fabricated.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ batchId: string }> },
) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  const { batchId } = await params;
  if (!batchId || !/^[0-9a-f-]{36}$/i.test(batchId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  try {
    const payload = await withTenantContext(ctx.tenantId, async (c) => {
      const head = await c.query<BatchHeadRow>(
        `SELECT b.id, b.project_id, p.name AS project_name, b.ingest_route,
                b.bundle_sha256, b.review_status, b.created_at, b.updated_at
           FROM ctx_import_batches b
           JOIN contextualization_projects p ON p.id = b.project_id
          WHERE b.id = $1 AND b.tenant_id = $2::uuid`,
        [batchId, ctx.tenantId],
      );
      if (head.rows.length === 0) return null;

      const sources = await c
        .query<SourceRow>(
          `SELECT id, source_type, file_name, status, source_sha256, created_at
             FROM ctx_sources
            WHERE import_batch_id = $1 AND tenant_id = $2::uuid
            ORDER BY file_name`,
          [batchId, ctx.tenantId],
        )
        .then((r) => r.rows);

      const extractions = await c
        .query<ExtractionRow>(
          `SELECT e.id, e.tag_name, e.roles, e.uns_path_proposed, e.i3x_element_id,
                  e.confidence::text AS confidence, e.status, e.evidence_json,
                  s.file_name AS source_file
             FROM ctx_extractions e
             JOIN ctx_sources s ON s.id = e.source_id
            WHERE s.import_batch_id = $1 AND e.tenant_id = $2::uuid
            ORDER BY e.tag_name`,
          [batchId, ctx.tenantId],
        )
        .then((r) => r.rows);

      return { head: head.rows[0], sources, extractions };
    });

    if (!payload) {
      return NextResponse.json({ error: "batch not found" }, { status: 404 });
    }

    const { head, sources, extractions } = payload;

    const signals = extractions.map((e) => ({
      id: e.id,
      tagName: e.tag_name,
      roles: e.roles ?? [],
      unsPath: e.uns_path_proposed,
      i3xElementId: e.i3x_element_id,
      confidence: e.confidence != null ? Number(e.confidence) : null,
      status: e.status,
      sourceFile: e.source_file,
      evidenceCount: countEvidence(e.evidence_json),
    }));

    const hasRole = (e: typeof signals[number], set: Set<string>) =>
      e.roles.some((r) => set.has(String(r).toLowerCase()));

    const unsMap = signals
      .filter((s) => s.unsPath)
      .map((s) => ({ tagName: s.tagName, unsPath: s.unsPath, i3xElementId: s.i3xElementId }));

    const accepted = signals.filter((s) => s.status === "accepted").length;
    const confidences = signals.map((s) => s.confidence).filter((v): v is number => v != null);
    const avgConfidence =
      confidences.length > 0
        ? Number((confidences.reduce((a, b) => a + b, 0) / confidences.length).toFixed(3))
        : null;

    return NextResponse.json({
      batch: {
        id: head.id,
        projectId: head.project_id,
        projectName: head.project_name,
        ingestRoute: head.ingest_route,
        bundleSha256: head.bundle_sha256,
        reviewStatus: head.review_status,
        createdAt: head.created_at,
        updatedAt: head.updated_at,
      },
      sources: sources.map((s) => ({
        id: s.id,
        sourceType: s.source_type,
        fileName: s.file_name,
        status: s.status,
        sha256: s.source_sha256,
        createdAt: s.created_at,
      })),
      // Evidence is currently carried inline on each extraction; surface the
      // aggregate count until the offline bundle ships a dedicated evidence.json.
      evidence: signals
        .filter((s) => s.evidenceCount > 0)
        .map((s) => ({ tagName: s.tagName, evidenceCount: s.evidenceCount })),
      extractedSignals: signals,
      faultCatalog: signals.filter((s) => hasRole(s, FAULT_ROLES)),
      parameters: signals.filter((s) => hasRole(s, PARAM_ROLES)),
      unsMap,
      scorecard: {
        sources: sources.length,
        signals: signals.length,
        mappedUns: unsMap.length,
        accepted,
        avgConfidence,
      },
    });
  } catch (err) {
    console.error("[api/contextualization/batches/[batchId] GET]", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}

function countEvidence(ev: unknown): number {
  if (Array.isArray(ev)) return ev.length;
  if (ev && typeof ev === "object") return Object.keys(ev).length;
  return 0;
}
