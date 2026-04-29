/**
 * Asset Intelligence Agent (#feat/asset-intelligence)
 *
 * enrichAsset(tenantId, assetId) — pulls from 6 parallel sources:
 *   1. KB Vector Search  — pgvector similarity via Ollama, fallback to tsquery
 *   2. KG Traversal      — 2-hop entity/relationship graph
 *   3. CMMS Summary      — denormalized WO/downtime fields from cmms_equipment
 *   4. Web Search        — Exa if EXA_API_KEY present, else skipped
 *   5. OEM Advisories    — second KB pass for bulletin/notice/advisory content
 *   6. YouTube Corpus    — filesystem corpus by_equipment/{type}.json, top by views
 *
 * Result is upserted into asset_enrichment_reports.
 */

import path from "path";
import fs from "fs/promises";
import { withTenantContext } from "@/lib/tenant-context";

// ── Output types ─────────────────────────────────────────────────────────────

export interface KBHit {
  id: string;
  content: string;
  sourceUrl: string | null;
  score: number;
}

export interface KGEntityHit {
  id: string;
  entityType: string;
  entityId: string;
  name: string;
  properties: Record<string, unknown>;
}

export interface KGRelHit {
  sourceId: string;
  targetId: string;
  relationshipType: string;
  confidence: number;
}

export interface CMMSSummary {
  openWorkOrders: number;
  totalDowntimeHours: number;
  lastFault: string | null;
  lastMaintenance: string | null;
}

export interface WebResult {
  title: string;
  url: string;
  snippet: string;
}

export interface YouTubeHit {
  videoId: string;
  videoTitle: string;
  channel: string;
  videoUrl: string;
  topic: string;
  snippet: string;
  viewCount: number;
}

export interface EnrichmentSources {
  kb: KBHit[];
  kgEntities: KGEntityHit[];
  kgRelationships: KGRelHit[];
  cmms: CMMSSummary;
  web: WebResult[];
  oemAdvisories: KBHit[];
  youtube: YouTubeHit[];
}

export interface EnrichmentReport {
  assetId: string;
  tenantId: string;
  status: "complete" | "partial" | "failed";
  sources: EnrichmentSources;
  enrichedAt: string;
  durationMs: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function equipmentTypeToCorpus(type: string): string {
  const t = (type ?? "").toLowerCase();
  if (t.includes("vfd") || t.includes("drive") || t.includes("inverter") || t.includes("variable freq")) return "vfd";
  if (t.includes("motor")) return "motor";
  if (t.includes("plc") || t.includes("controller") || t.includes("logix") || t.includes("scada")) return "plc";
  if (t.includes("hmi") || t.includes("panel") || t.includes("display") || t.includes("touch")) return "hmi";
  if (t.includes("contactor")) return "contactor";
  if (t.includes("breaker") || t.includes("circuit")) return "circuit_breaker";
  if (t.includes("conveyor") || t.includes("belt")) return "conveyor";
  if (t.includes("starter")) return "starter";
  if (t.includes("overload") || t.includes("relay")) return "overload";
  if (t.includes("sensor") || t.includes("transmitter") || t.includes("instrument")) return "instrument";
  return "unknown";
}

async function getOllamaEmbedding(text: string): Promise<number[] | null> {
  const base = process.env.OLLAMA_BASE_URL ?? "http://192.168.1.11:11434";
  try {
    const resp = await fetch(`${base}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "nomic-embed-text", prompt: text }),
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return null;
    const data = await resp.json() as { embedding?: number[] };
    return data.embedding ?? null;
  } catch {
    return null;
  }
}

// ── Source 1: KB Vector Search ────────────────────────────────────────────────

async function searchKB(
  tenantId: string,
  query: string,
  excludeKeywords?: string[],
): Promise<KBHit[]> {
  const embedding = await getOllamaEmbedding(query);

  return withTenantContext(tenantId, async (client) => {
    if (embedding) {
      const vectorStr = `[${embedding.join(",")}]`;
      try {
        const res = await client.query<{
          id: string; content: string; source_url: string | null; score: number;
        }>(
          `SELECT id::text, content, source_url,
                  1 - (embedding <=> $2::vector) AS score
           FROM knowledge_entries
           WHERE tenant_id = $1
             AND embedding IS NOT NULL
           ORDER BY embedding <=> $2::vector
           LIMIT 5`,
          [tenantId, vectorStr],
        );
        return res.rows.map((r) => ({ id: r.id, content: r.content, sourceUrl: r.source_url, score: r.score }));
      } catch {
        // dimension mismatch or pgvector error — fall through to text search
      }
    }

    // Full-text fallback
    const terms = query.split(/\s+/).filter(Boolean).join(" & ");
    const res = await client.query<{
      id: string; content: string; source_url: string | null;
    }>(
      `SELECT id::text, content, source_url
       FROM knowledge_entries
       WHERE tenant_id = $1
         AND to_tsvector('english', content) @@ plainto_tsquery('english', $2)
         ${excludeKeywords?.length ? `AND NOT (content ILIKE ANY($3))` : ""}
       LIMIT 5`,
      excludeKeywords?.length
        ? [tenantId, terms, excludeKeywords.map((k) => `%${k}%`)]
        : [tenantId, terms],
    );
    return res.rows.map((r) => ({ id: r.id, content: r.content, sourceUrl: r.source_url, score: 0.5 }));
  });
}

// ── Source 2: KG Traversal ────────────────────────────────────────────────────

async function traverseKG(
  tenantId: string,
  manufacturer: string | null,
  model: string | null,
): Promise<{ entities: KGEntityHit[]; relationships: KGRelHit[] }> {
  if (!manufacturer && !model) return { entities: [], relationships: [] };

  return withTenantContext(tenantId, async (client) => {
    const filters: string[] = [];
    const params: unknown[] = [tenantId];

    if (manufacturer) {
      params.push(`%${manufacturer.toLowerCase()}%`);
      filters.push(`(LOWER(entity_id) LIKE $${params.length} OR LOWER(name) LIKE $${params.length})`);
    }
    if (model) {
      params.push(`%${model.toLowerCase()}%`);
      filters.push(`(LOWER(entity_id) LIKE $${params.length} OR LOWER(name) LIKE $${params.length})`);
    }

    const entityRes = await client.query<{
      id: string; entity_type: string; entity_id: string; name: string; properties: Record<string, unknown>;
    }>(
      `SELECT id::text, entity_type, entity_id, name, properties
       FROM kg_entities
       WHERE tenant_id = $1 AND (${filters.join(" OR ")})
       LIMIT 10`,
      params,
    );

    const entities = entityRes.rows.map((r) => ({
      id: r.id, entityType: r.entity_type, entityId: r.entity_id,
      name: r.name, properties: r.properties ?? {},
    }));

    if (entities.length === 0) return { entities, relationships: [] };

    const entityIds = entities.map((e) => e.id);
    const relRes = await client.query<{
      source_id: string; target_id: string; relationship_type: string; confidence: number;
    }>(
      `SELECT source_id::text, target_id::text, relationship_type, confidence
       FROM kg_relationships
       WHERE tenant_id = $1
         AND (source_id = ANY($2::uuid[]) OR target_id = ANY($2::uuid[]))
       LIMIT 20`,
      [tenantId, entityIds],
    );

    const relationships = relRes.rows.map((r) => ({
      sourceId: r.source_id, targetId: r.target_id,
      relationshipType: r.relationship_type, confidence: r.confidence,
    }));

    return { entities, relationships };
  });
}

// ── Source 3: CMMS Summary ────────────────────────────────────────────────────

async function fetchCMMSSummary(tenantId: string, assetId: string): Promise<CMMSSummary> {
  return withTenantContext(tenantId, async (client) => {
    const res = await client.query<{
      work_order_count: number; total_downtime_hours: number;
      last_reported_fault: string | null; last_maintenance_date: string | null;
    }>(
      `SELECT work_order_count, total_downtime_hours, last_reported_fault, last_maintenance_date
       FROM cmms_equipment WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      [assetId, tenantId],
    );
    const r = res.rows[0];
    if (!r) return { openWorkOrders: 0, totalDowntimeHours: 0, lastFault: null, lastMaintenance: null };
    return {
      openWorkOrders: Number(r.work_order_count ?? 0),
      totalDowntimeHours: Number(r.total_downtime_hours ?? 0),
      lastFault: r.last_reported_fault ?? null,
      lastMaintenance: r.last_maintenance_date ?? null,
    };
  });
}

// ── Source 4: Web Search (Exa) ────────────────────────────────────────────────

async function searchWeb(manufacturer: string | null, model: string | null): Promise<WebResult[]> {
  const key = process.env.EXA_API_KEY;
  if (!key || (!manufacturer && !model)) return [];

  const q = [manufacturer, model, "maintenance troubleshooting field notice"].filter(Boolean).join(" ");
  try {
    const resp = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: { "x-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        query: q,
        num_results: 3,
        type: "neural",
        contents: { text: { max_characters: 400 } },
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) return [];
    const data = await resp.json() as { results?: Array<{ title: string; url: string; text?: string }> };
    return (data.results ?? []).map((r) => ({
      title: r.title ?? "",
      url: r.url ?? "",
      snippet: (r.text ?? "").slice(0, 300),
    }));
  } catch {
    return [];
  }
}

// ── Source 5: OEM Advisories (KB advisory pass) ────────────────────────────────

async function searchOEMAdvisories(
  tenantId: string,
  manufacturer: string | null,
  model: string | null,
): Promise<KBHit[]> {
  if (!manufacturer && !model) return [];
  const advisoryQuery = [manufacturer, model, "bulletin notice advisory field notice update"].filter(Boolean).join(" ");
  return searchKB(tenantId, advisoryQuery);
}

// ── Source 6: YouTube Corpus ──────────────────────────────────────────────────

interface RawYoutubeEntry {
  video_id: string;
  video_title: string;
  channel: string;
  video_url: string;
  topic: string;
  chunk_text: string;
  view_count: number;
  equipment_type: string;
  manufacturer: string;
}

async function searchYouTubeCorpus(
  equipmentType: string | null,
  manufacturer: string | null,
): Promise<YouTubeHit[]> {
  const corpusType = equipmentTypeToCorpus(equipmentType ?? "");
  const corpusDir = path.join(process.cwd(), "..", "mira-bots", "benchmarks", "corpus", "youtube", "by_equipment");
  const corpusFile = path.join(corpusDir, `${corpusType}.json`);

  let entries: RawYoutubeEntry[] = [];
  try {
    const raw = await fs.readFile(corpusFile, "utf8");
    entries = JSON.parse(raw) as RawYoutubeEntry[];
  } catch {
    // corpus file not found — try unknown.json as fallback
    try {
      const raw = await fs.readFile(path.join(corpusDir, "unknown.json"), "utf8");
      entries = JSON.parse(raw) as RawYoutubeEntry[];
    } catch {
      return [];
    }
  }

  // Filter by manufacturer if we have one, de-duplicate by video_id, sort by views
  const mfr = (manufacturer ?? "").toLowerCase();
  const filtered = mfr
    ? entries.filter((e) => !e.manufacturer || e.manufacturer.toLowerCase().includes(mfr) || mfr.includes(e.manufacturer.toLowerCase()))
    : entries;

  const seen = new Set<string>();
  const deduped = filtered.filter((e) => {
    if (seen.has(e.video_id)) return false;
    seen.add(e.video_id);
    return true;
  });

  return deduped
    .sort((a, b) => (b.view_count ?? 0) - (a.view_count ?? 0))
    .slice(0, 4)
    .map((e) => ({
      videoId: e.video_id,
      videoTitle: e.video_title,
      channel: e.channel,
      videoUrl: e.video_url,
      topic: e.topic ?? "",
      snippet: (e.chunk_text ?? "").slice(0, 300),
      viewCount: e.view_count ?? 0,
    }));
}

// ── Persist report ────────────────────────────────────────────────────────────

async function persistReport(tenantId: string, assetId: string, report: EnrichmentReport): Promise<void> {
  const { sources, status, enrichedAt } = report;
  await withTenantContext(tenantId, (client) =>
    client.query(
      `INSERT INTO asset_enrichment_reports
         (tenant_id, asset_id, status, kb_hits, kg_entities, kg_relationships,
          cmms_summary, web_results, oem_advisories, youtube_hits, started_at, completed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, NOW(), $11)
       ON CONFLICT (tenant_id, asset_id)
       DO UPDATE SET
         status          = EXCLUDED.status,
         kb_hits         = EXCLUDED.kb_hits,
         kg_entities     = EXCLUDED.kg_entities,
         kg_relationships = EXCLUDED.kg_relationships,
         cmms_summary    = EXCLUDED.cmms_summary,
         web_results     = EXCLUDED.web_results,
         oem_advisories  = EXCLUDED.oem_advisories,
         youtube_hits    = EXCLUDED.youtube_hits,
         started_at      = NOW(),
         completed_at    = EXCLUDED.completed_at,
         error           = NULL`,
      [
        tenantId, assetId, status,
        JSON.stringify(sources.kb),
        JSON.stringify(sources.kgEntities),
        JSON.stringify(sources.kgRelationships),
        JSON.stringify(sources.cmms),
        JSON.stringify(sources.web),
        JSON.stringify(sources.oemAdvisories),
        JSON.stringify(sources.youtube),
        enrichedAt,
      ],
    ),
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function enrichAsset(tenantId: string, assetId: string): Promise<EnrichmentReport> {
  const start = Date.now();

  // Fetch asset metadata for query construction
  let manufacturer: string | null = null;
  let model: string | null = null;
  let equipmentType: string | null = null;

  await withTenantContext(tenantId, async (client) => {
    const res = await client.query<{
      manufacturer: string | null; model_number: string | null; equipment_type: string | null;
    }>(
      `SELECT manufacturer, model_number, equipment_type FROM cmms_equipment WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      [assetId, tenantId],
    );
    const r = res.rows[0];
    if (r) {
      manufacturer = r.manufacturer;
      model = r.model_number;
      equipmentType = r.equipment_type;
    }
  });

  const kbQuery = [manufacturer, model, equipmentType].filter(Boolean).join(" ");

  const [kbResult, kgResult, cmmsResult, webResult, oemResult, ytResult] = await Promise.allSettled([
    kbQuery ? searchKB(tenantId, kbQuery) : Promise.resolve([] as KBHit[]),
    traverseKG(tenantId, manufacturer, model),
    fetchCMMSSummary(tenantId, assetId),
    searchWeb(manufacturer, model),
    searchOEMAdvisories(tenantId, manufacturer, model),
    searchYouTubeCorpus(equipmentType, manufacturer),
  ]);

  const sources: EnrichmentSources = {
    kb:               kbResult.status === "fulfilled" ? kbResult.value : [],
    kgEntities:       kgResult.status === "fulfilled" ? kgResult.value.entities : [],
    kgRelationships:  kgResult.status === "fulfilled" ? kgResult.value.relationships : [],
    cmms:             cmmsResult.status === "fulfilled" ? cmmsResult.value : { openWorkOrders: 0, totalDowntimeHours: 0, lastFault: null, lastMaintenance: null },
    web:              webResult.status === "fulfilled" ? webResult.value : [],
    oemAdvisories:    oemResult.status === "fulfilled" ? oemResult.value : [],
    youtube:          ytResult.status === "fulfilled" ? ytResult.value : [],
  };

  const anyData = sources.kb.length + sources.kgEntities.length + sources.youtube.length > 0;
  const status = anyData ? "complete" : "partial";

  const report: EnrichmentReport = {
    assetId,
    tenantId,
    status,
    sources,
    enrichedAt: new Date().toISOString(),
    durationMs: Date.now() - start,
  };

  await persistReport(tenantId, assetId, report);
  return report;
}

export async function getEnrichmentReport(tenantId: string, assetId: string): Promise<EnrichmentReport | null> {
  return withTenantContext(tenantId, async (client) => {
    const res = await client.query<{
      asset_id: string; tenant_id: string; status: string;
      kb_hits: KBHit[]; kg_entities: KGEntityHit[]; kg_relationships: KGRelHit[];
      cmms_summary: CMMSSummary; web_results: WebResult[];
      oem_advisories: KBHit[]; youtube_hits: YouTubeHit[];
      completed_at: string | null;
    }>(
      `SELECT asset_id::text, tenant_id::text, status,
              kb_hits, kg_entities, kg_relationships, cmms_summary,
              web_results, oem_advisories, youtube_hits, completed_at
       FROM asset_enrichment_reports
       WHERE tenant_id = $1 AND asset_id = $2
       LIMIT 1`,
      [tenantId, assetId],
    );
    const r = res.rows[0];
    if (!r) return null;
    return {
      assetId: r.asset_id,
      tenantId: r.tenant_id,
      status: r.status as "complete" | "partial" | "failed",
      sources: {
        kb: r.kb_hits ?? [],
        kgEntities: r.kg_entities ?? [],
        kgRelationships: r.kg_relationships ?? [],
        cmms: r.cmms_summary ?? { openWorkOrders: 0, totalDowntimeHours: 0, lastFault: null, lastMaintenance: null },
        web: r.web_results ?? [],
        oemAdvisories: r.oem_advisories ?? [],
        youtube: r.youtube_hits ?? [],
      },
      enrichedAt: r.completed_at ?? new Date().toISOString(),
      durationMs: 0,
    };
  });
}
