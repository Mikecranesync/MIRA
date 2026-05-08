import { NextResponse, type NextRequest } from "next/server";
import { sessionOr401 } from "@/lib/session";
import pool from "@/lib/db";
import { inferEquipmentType } from "@/lib/equipment-type";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

// Returns documents for a manufacturer, organized as a UNS tree:
//   knowledge_base > {manufacturer} > {equipment_type} > {model} > {docs}
//
// Manufacturer name is matched case-insensitively to handle case variants
// in legacy data ('siemens' vs 'Siemens', 'Yaskawa' vs 'Yaskawa Electric Corporation').
// 'Uncategorized' matches NULL or empty manufacturer rows.
//
// Equipment type comes from the column when populated, otherwise we infer
// from model_number / title / source_url (see lib/equipment-type.ts).
//
// No tenant filter — KB is universal (see /api/knowledge/route.ts comment).
// Auth still enforced via sessionOr401 so anonymous callers cannot reach data.
export async function GET(req: NextRequest) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  const name = req.nextUrl.searchParams.get("name");
  if (!name) {
    return NextResponse.json({ error: "name parameter required" }, { status: 400 });
  }

  try {
    const isUncategorized = name.toLowerCase() === "uncategorized";
    const mfrFilter = isUncategorized
      ? "(manufacturer IS NULL OR TRIM(manufacturer) = '')"
      : "LOWER(TRIM(COALESCE(manufacturer, ''))) = LOWER($1)";

    const params: string[] = isUncategorized ? [] : [name];

    const { rows } = await pool.query(
      `SELECT
         source_url,
         MAX(model_number) AS model_number,
         MAX(source_type) AS source_type,
         MAX(equipment_type) AS equipment_type,
         COUNT(*)::bigint AS chunk_count,
         MAX(created_at) AS last_indexed,
         MAX(metadata->>'title') AS title
       FROM knowledge_entries
       WHERE ${mfrFilter}
       GROUP BY source_url
       ORDER BY chunk_count DESC
       LIMIT 500`,
      params,
    );

    type Doc = {
      sourceUrl: string;
      title: string;
      modelNumber: string | null;
      sourceType: string | null;
      equipmentType: string;
      equipmentTypeRaw: string | null;
      chunkCount: number;
      lastIndexed: unknown;
    };

    const docs: Doc[] = rows.map((r: Record<string, unknown>) => {
      const url = (r.source_url as string | null) ?? "";
      const filename = url.split("/").pop() || url || (r.title as string) || "Untitled";
      const equipmentTypeRaw = (r.equipment_type as string | null) ?? null;
      const equipmentType = inferEquipmentType({
        equipmentType: equipmentTypeRaw,
        modelNumber: r.model_number as string | null,
        title: r.title as string | null,
        sourceUrl: url,
        manufacturer: name,
      });
      return {
        sourceUrl: url,
        title: (r.title as string | null) ?? filename,
        modelNumber: (r.model_number as string | null) ?? null,
        sourceType: (r.source_type as string | null) ?? null,
        equipmentType,
        equipmentTypeRaw,
        chunkCount: Number(r.chunk_count),
        lastIndexed: r.last_indexed,
      };
    });

    // Group: equipment_type → model_number → docs.
    const typeBuckets = new Map<
      string,
      Map<string, { modelNumber: string; docs: Doc[]; chunkCount: number }>
    >();

    for (const doc of docs) {
      const type = doc.equipmentType;
      const model = (doc.modelNumber ?? "").trim() || "Unspecified";
      if (!typeBuckets.has(type)) typeBuckets.set(type, new Map());
      const modelMap = typeBuckets.get(type)!;
      if (!modelMap.has(model)) {
        modelMap.set(model, { modelNumber: model, docs: [], chunkCount: 0 });
      }
      const bucket = modelMap.get(model)!;
      bucket.docs.push(doc);
      bucket.chunkCount += doc.chunkCount;
    }

    const groups = Array.from(typeBuckets.entries())
      .map(([equipmentType, modelMap]) => {
        const models = Array.from(modelMap.values())
          .map((m) => ({
            modelNumber: m.modelNumber,
            chunkCount: m.chunkCount,
            docCount: m.docs.length,
            docs: m.docs,
            unsPath: `knowledge_base > ${name} > ${equipmentType} > ${m.modelNumber}`,
          }))
          .sort((a, b) =>
            a.modelNumber.localeCompare(b.modelNumber, undefined, {
              numeric: true,
              sensitivity: "base",
            }),
          );
        const chunkCount = models.reduce((s, m) => s + m.chunkCount, 0);
        const docCount = models.reduce((s, m) => s + m.docCount, 0);
        return {
          equipmentType,
          chunkCount,
          docCount,
          modelCount: models.length,
          models,
          unsPath: `knowledge_base > ${name} > ${equipmentType}`,
        };
      })
      .sort((a, b) => {
        // Push "Other" to the end; sort the rest A→Z.
        if (a.equipmentType === "Other") return 1;
        if (b.equipmentType === "Other") return -1;
        return a.equipmentType.localeCompare(b.equipmentType);
      });

    return NextResponse.json(
      {
        manufacturer: name,
        unsPath: `knowledge_base > ${name}`,
        groups,
        // Backward-compatible flat docs list (current UI still renders this).
        docs,
        fetchedAt: new Date().toISOString(),
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
          Pragma: "no-cache",
        },
      },
    );
  } catch (err) {
    console.error("[api/knowledge/manufacturer]", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}
