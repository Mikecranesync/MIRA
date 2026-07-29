import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

const UNS_NAMESPACE_URI = "urn:mira:plc-parser:uns";
const ISA95_LEVELS = ["enterprise", "site", "area", "line", "asset"] as const;

interface ExtractionRow {
  id: string;
  tag_name: string;
  roles: string[];
  uns_path_proposed: string | null;
  i3x_element_id: string | null;
  confidence: string | null;
  evidence_json: Record<string, unknown>;
}

interface ProjectRow {
  name: string;
}

/**
 * GET /api/contextualization/[id]/export
 *
 * Query params:
 *   format=uns  → accepted extractions as UNS JSON (path list + metadata)
 *   format=i3x  → CESMII i3X objectInstances (replicates mira_plc_parser/i3x.py logic in TS)
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  const { id: projectId } = await params;
  if (!projectId || !/^[0-9a-f-]{36}$/i.test(projectId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const url = new URL(req.url);
  const format = (url.searchParams.get("format") ?? "uns").toLowerCase();
  if (format !== "uns" && format !== "i3x") {
    return NextResponse.json({ error: "format must be 'uns' or 'i3x'" }, { status: 400 });
  }

  try {
    const [project, extractions] = await Promise.all([
      withTenantContext(ctx.tenantId, (c) =>
        c
          .query<ProjectRow>(
            `SELECT name FROM contextualization_projects
              WHERE id = $1 AND tenant_id = $2::uuid`,
            [projectId, ctx.tenantId],
          )
          .then((r) => r.rows[0] ?? null),
      ),
      withTenantContext(ctx.tenantId, (c) =>
        c
          .query<ExtractionRow>(
            `SELECT id, tag_name, roles, uns_path_proposed, i3x_element_id,
                    confidence::text, evidence_json
               FROM ctx_extractions
              WHERE project_id = $1
                AND tenant_id = $2::uuid
                AND status = 'accepted'
              ORDER BY tag_name`,
            [projectId, ctx.tenantId],
          )
          .then((r) => r.rows),
      ),
    ]);

    if (!project) {
      return NextResponse.json({ error: "project not found" }, { status: 404 });
    }

    if (format === "uns") {
      return NextResponse.json(buildUnsExport(project.name, projectId, extractions));
    } else {
      return NextResponse.json(buildI3xExport(project.name, extractions));
    }
  } catch (err) {
    console.error("[api/contextualization/[id]/export GET]", err);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}

// ── UNS export ────────────────────────────────────────────────────────────────

function buildUnsExport(
  projectName: string,
  projectId: string,
  rows: ExtractionRow[],
): object {
  const entries = rows
    .filter((r) => r.uns_path_proposed)
    .map((r) => ({
      tag: r.tag_name,
      unsPath: r.uns_path_proposed,
      roles: r.roles ?? [],
      confidence: r.confidence ? parseFloat(r.confidence) : null,
      evidenceFormat: (r.evidence_json as Record<string, unknown>)?.source_format ?? null,
    }));

  return {
    schema: "mira-contextualization/uns-export@1",
    projectId,
    projectName,
    exportedAt: new Date().toISOString(),
    totalAccepted: rows.length,
    totalWithUnsPath: entries.length,
    entries,
  };
}

// ── i3X export ────────────────────────────────────────────────────────────────
// Reconstructs CESMII objectInstances from stored UNS paths.
// Mirrors mira_plc_parser/i3x.py to_i3x() logic in TypeScript.

function _typeForLevel(level: string): string {
  return `urn:mira:type:${level}`;
}

function _objectTypes(): object[] {
  return [
    ...ISA95_LEVELS.map((l) => ({
      elementId: _typeForLevel(l),
      displayName: l.charAt(0).toUpperCase() + l.slice(1),
      namespaceUri: UNS_NAMESPACE_URI,
      schema: { type: "object", title: l, properties: { displayName: { type: "string" } } },
      version: "1",
    })),
    {
      elementId: "urn:mira:type:signal",
      displayName: "Signal",
      namespaceUri: UNS_NAMESPACE_URI,
      schema: { type: "object", title: "Signal", properties: { displayName: { type: "string" } } },
      version: "1",
    },
  ];
}

function buildI3xExport(projectName: string, rows: ExtractionRow[]): object {
  const instances: object[] = [];
  const seen = new Set<string>();

  function ensureContainer(pathParts: string[], level: string, display: string): string {
    const elementId = pathParts.join("/");
    if (seen.has(elementId)) return elementId;
    seen.add(elementId);
    const parentId = pathParts.length > 1 ? pathParts.slice(0, -1).join("/") : null;
    instances.push({
      elementId,
      displayName: display,
      typeElementId: _typeForLevel(level),
      parentId,
      isComposition: true,
      metadata: { level, unsPath: elementId },
    });
    return elementId;
  }

  for (const row of rows) {
    const path = row.uns_path_proposed;
    if (!path) continue;

    const parts = path.split("/").filter(Boolean);
    // Parts: enterprise/site/area/line[/asset]/signal
    // Container chain = all parts except the last (signal leaf)
    const containerParts = parts.slice(0, -1);
    const signalPart = parts[parts.length - 1];

    // Ensure each container level exists
    const chain: string[] = [];
    for (let i = 0; i < containerParts.length; i++) {
      const seg = containerParts[i];
      chain.push(seg);
      const level = ISA95_LEVELS[i] ?? "asset";
      ensureContainer([...chain], level, seg);
    }

    const parentId = chain.length > 0 ? chain.join("/") : null;

    instances.push({
      elementId: path,
      displayName: row.tag_name,
      typeElementId: _typeForLevel("signal"),
      parentId,
      isComposition: false,
      metadata: {
        plcTag: row.tag_name,
        signal: signalPart ?? "",
        unsPath: path,
        confidence: row.confidence ? parseFloat(row.confidence) : null,
        roles: row.roles ?? [],
      },
    });
  }

  return {
    namespace: { uri: UNS_NAMESPACE_URI, displayName: projectName },
    objectTypes: _objectTypes(),
    objectInstances: instances,
  };
}
