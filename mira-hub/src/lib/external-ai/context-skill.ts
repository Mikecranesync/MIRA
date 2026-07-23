import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { withTenantContext } from "@/lib/tenant-context";
import type { DbClient } from "@/lib/i3x/data-access";
import { relationshipsForElement, loadEntitiesByIds } from "@/lib/i3x/data-access";
import { kgEntityToObjectInstance, relatedFromEdge, toCurrentValueResult } from "@/lib/i3x";

export const FACTORYLM_CONTEXT_TOOLS = [
  "find_asset",
  "get_asset_context",
  "search_approved_evidence",
  "get_tag_context",
  "list_related_assets",
  "get_diagnostic_context",
  "get_live_value",
  "search_simlab_scenarios",
] as const;

export type FactoryLmContextTool = (typeof FACTORYLM_CONTEXT_TOOLS)[number];
export type ApprovalState = "verified" | "approved" | "draft" | "internal" | "not_found" | "unknown";
export type ConfidenceBand = "verified" | "high" | "medium" | "low" | "none";

export interface FactoryLmToolContext {
  tenantId: string;
}

export interface FactoryLmToolCall {
  tool: string;
  input?: Record<string, unknown>;
  context: FactoryLmToolContext;
}

export interface FactoryLmEvidenceRef {
  sourceType: "kg_entity" | "kg_relationship" | "knowledge_entry" | "approved_tag" | "live_signal_cache" | "simlab_scenario";
  sourceId: string;
  title?: string | null;
  url?: string | null;
  page?: number | null;
  approvalState: ApprovalState;
  citation?: string | null;
}

export interface FactoryLmToolResponse<T = unknown> {
  ok: boolean;
  found: boolean;
  tool: string;
  data: T | null;
  evidence: FactoryLmEvidenceRef[];
  confidence: ConfidenceBand;
  approvalState: ApprovalState;
  notFoundReason?: string;
  refusedReason?: string;
}

interface AssetRow {
  id: string;
  entity_id: string | null;
  entity_type: string;
  name: string;
  approval_state: string | null;
  uns_path: string | null;
  properties: Record<string, unknown> | null;
}

interface ComponentRow {
  id: string;
  entity_id: string | null;
  entity_type: string;
  name: string;
  approval_state: string | null;
  uns_path: string | null;
  properties: Record<string, unknown> | null;
  relationship_type?: string | null;
}

interface ApprovedTagRow {
  id?: string | null;
  uns_path: string | null;
  source_system: string | null;
  source_tag_path: string | null;
  normalized_tag_path: string | null;
  enabled: boolean;
}

interface LiveValueRow {
  uns_path: string | null;
  last_value_text: string | null;
  last_value_numeric: number | null;
  last_value_bool: boolean | null;
  latest_quality: string | null;
  freshness_status: string | null;
  last_seen_at: string | Date;
}

interface EvidenceRow {
  id: string | null;
  content: string;
  source_url: string | null;
  source_page: number | null;
  page_start: number | null;
  title: string | null;
  filename: string | null;
  verified: boolean;
  rank: number | null;
}

interface SkillDeps {
  runWithTenant?: <T>(tenantId: string, fn: (client: DbClient) => Promise<T>) => Promise<T>;
  simlabScenarioDir?: string;
  readDir?: typeof readdir;
  readTextFile?: typeof readFile;
}

const DEFAULT_SIMLAB_SCENARIO_DIR = path.resolve(process.cwd(), "../tests/simlab/scenarios");

function ok<T>(
  tool: string,
  data: T,
  evidence: FactoryLmEvidenceRef[],
  confidence: ConfidenceBand,
  approvalState: ApprovalState,
): FactoryLmToolResponse<T> {
  return { ok: true, found: true, tool, data, evidence, confidence, approvalState };
}

function notFound(tool: string, reason: string): FactoryLmToolResponse<null> {
  return {
    ok: true,
    found: false,
    tool,
    data: null,
    evidence: [],
    confidence: "none",
    approvalState: "not_found",
    notFoundReason: reason,
  };
}

function refused(tool: string, reason: string): FactoryLmToolResponse<null> {
  return {
    ok: false,
    found: false,
    tool,
    data: null,
    evidence: [],
    confidence: "none",
    approvalState: "unknown",
    refusedReason: reason,
  };
}

function asString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  return typeof value === "string" ? value.trim() : "";
}

function asLimit(input: Record<string, unknown>, fallback = 5, max = 20): number {
  const raw = input.limit;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(max, Math.trunc(n)));
}

function sqlLike(s: string): string {
  return `%${s.replace(/[\\%_]/g, "\\$&")}%`;
}

function assetEvidence(row: Pick<AssetRow, "id" | "approval_state">): FactoryLmEvidenceRef {
  return {
    sourceType: "kg_entity",
    sourceId: row.id,
    approvalState: row.approval_state === "verified" ? "verified" : "draft",
  };
}

function projectAsset(row: AssetRow) {
  const props = row.properties ?? {};
  return {
    assetId: row.id,
    entityId: row.entity_id,
    name: row.name,
    entityType: row.entity_type,
    unsPath: row.uns_path,
    manufacturer: props.manufacturer ?? props.manufacturer_name ?? null,
    model: props.model ?? props.model_number ?? null,
    approvalState: row.approval_state ?? "unknown",
  };
}

function projectComponent(row: ComponentRow) {
  return {
    assetId: row.id,
    entityId: row.entity_id,
    name: row.name,
    entityType: row.entity_type,
    unsPath: row.uns_path,
    relationshipType: row.relationship_type ?? null,
    approvalState: row.approval_state ?? "unknown",
  };
}

function normalizeLiveValue(row: LiveValueRow) {
  if (row.last_value_bool !== null) {
    return {
      value: row.last_value_bool,
      valueType: "bool" as const,
      quality: row.latest_quality ?? "uncertain",
      freshness: row.freshness_status ?? "live",
      timestamp: row.last_seen_at,
    };
  }
  if (row.last_value_numeric !== null) {
    return {
      value: row.last_value_numeric,
      valueType: Number.isInteger(row.last_value_numeric) ? "int" as const : "float" as const,
      quality: row.latest_quality ?? "uncertain",
      freshness: row.freshness_status ?? "live",
      timestamp: row.last_seen_at,
    };
  }
  return {
    value: row.last_value_text,
    valueType: "string" as const,
    quality: row.latest_quality ?? "uncertain",
    freshness: row.freshness_status ?? "live",
    timestamp: row.last_seen_at,
  };
}

async function resolveVerifiedAsset(client: DbClient, assetId: string): Promise<AssetRow | null> {
  const { rows } = await client.query<AssetRow>(
    `SELECT id, entity_id, entity_type, name, approval_state, uns_path::text AS uns_path, properties
       FROM kg_entities
      WHERE (id::text = $1 OR entity_id = $1 OR uns_path::text = $1)
        AND entity_type IN ('equipment', 'asset', 'component')
        AND approval_state = 'verified'
      LIMIT 1`,
    [assetId],
  );
  return rows[0] ?? null;
}

async function findAsset(client: DbClient, input: Record<string, unknown>) {
  const query = asString(input, "query");
  if (!query) return notFound("find_asset", "query is required");
  const limit = asLimit(input);

  const { rows } = await client.query<AssetRow>(
    `SELECT id, entity_id, entity_type, name, approval_state, uns_path::text AS uns_path, properties
       FROM kg_entities
      WHERE approval_state = 'verified'
        AND entity_type IN ('equipment', 'asset', 'component')
        AND (
          name ILIKE $1 ESCAPE '\\'
          OR entity_id ILIKE $1 ESCAPE '\\'
          OR uns_path::text ILIKE $1 ESCAPE '\\'
          OR properties::text ILIKE $1 ESCAPE '\\'
        )
      ORDER BY
        CASE
          WHEN entity_id = $2 THEN 0
          WHEN uns_path::text = $2 THEN 1
          WHEN name ILIKE $1 ESCAPE '\\' THEN 2
          ELSE 3
        END,
        name
      LIMIT $3`,
    [sqlLike(query), query, limit],
  );

  if (rows.length === 0) return notFound("find_asset", `no verified asset matched "${query}"`);
  return ok(
    "find_asset",
    { query, results: rows.map(projectAsset) },
    rows.map(assetEvidence),
    rows.length === 1 ? "high" : "medium",
    "verified",
  );
}

async function getAssetContext(client: DbClient, input: Record<string, unknown>) {
  const assetId = asString(input, "asset_id") || asString(input, "assetId") || asString(input, "uns_path");
  if (!assetId) return notFound("get_asset_context", "asset_id or uns_path is required");

  const asset = await resolveVerifiedAsset(client, assetId);
  if (!asset) return notFound("get_asset_context", "verified asset not found");

  const [components, tags] = await Promise.all([
    client.query<ComponentRow>(
      `SELECT e.id, e.entity_id, e.entity_type, e.name, e.approval_state,
              e.uns_path::text AS uns_path, e.properties, r.relationship_type
         FROM kg_relationships r
         JOIN kg_entities e ON e.id = r.target_id
        WHERE r.source_id = $1
          AND r.approval_state = 'verified'
          AND e.approval_state = 'verified'
          AND r.relationship_type IN ('has_component', 'controlled_by', 'monitors', 'drives')
        ORDER BY e.name
        LIMIT 50`,
      [asset.id],
    ),
    client.query<ApprovedTagRow>(
      `SELECT uns_path::text AS uns_path, source_system, source_tag_path,
              normalized_tag_path, enabled
         FROM approved_tags
        WHERE enabled = true
          AND ($1::ltree IS NULL OR uns_path <@ $1::ltree)
        ORDER BY uns_path::text
        LIMIT 100`,
      [asset.uns_path],
    ),
  ]);

  return ok(
    "get_asset_context",
    {
      asset: projectAsset(asset),
      components: components.rows.map(projectComponent),
      approvedTags: tags.rows.map((tag) => ({
        unsPath: tag.uns_path,
        sourceSystem: tag.source_system,
        sourceTagPath: tag.source_tag_path,
        normalizedTagPath: tag.normalized_tag_path,
        approvalState: "approved",
      })),
    },
    [
      assetEvidence(asset),
      ...components.rows.map(assetEvidence),
      ...tags.rows.map((tag) => ({
        sourceType: "approved_tag" as const,
        sourceId: tag.uns_path ?? tag.normalized_tag_path ?? "approved_tag",
        approvalState: "approved" as const,
      })),
    ],
    "verified",
    "verified",
  );
}

async function searchApprovedEvidence(client: DbClient, input: Record<string, unknown>) {
  const assetId = asString(input, "asset_id") || asString(input, "assetId");
  const query = asString(input, "query");
  const includeDraft = input.includeDraft === true;
  if (!assetId || !query) {
    return notFound("search_approved_evidence", "asset_id and query are required");
  }

  const asset = await resolveVerifiedAsset(client, assetId);
  if (!asset) return notFound("search_approved_evidence", "verified asset not found");
  const limit = asLimit(input, 6, 12);

  const { rows } = await client.query<EvidenceRow>(
    `WITH scoped_nodes AS (
       SELECT id::text AS id
         FROM kg_entities
        WHERE ($1::ltree IS NULL AND id = $2)
           OR ($1::ltree IS NOT NULL AND uns_path <@ $1::ltree)
     )
     SELECT id::text AS id, content, source_url, source_page, page_start,
            metadata->>'title' AS title, metadata->>'filename' AS filename,
            verified, ts_rank_cd(content_tsv, plainto_tsquery('english', $3)) AS rank
       FROM knowledge_entries
      WHERE tenant_id = $4
        AND (metadata->>'node_id') = ANY(SELECT id FROM scoped_nodes)
        AND ($5::boolean = true OR verified = true)
        AND content_tsv @@ plainto_tsquery('english', $3)
      ORDER BY verified DESC, rank DESC
      LIMIT $6`,
    [asset.uns_path, asset.id, query, input.tenantId, includeDraft, limit],
  );

  if (rows.length === 0) {
    return notFound("search_approved_evidence", "no approved evidence matched this asset/query");
  }

  return ok(
    "search_approved_evidence",
    {
      asset: projectAsset(asset),
      query,
      results: rows.map((row) => ({
        content: row.content,
        title: row.title ?? row.filename ?? row.source_url ?? "FactoryLM evidence",
        url: row.source_url,
        page: row.page_start ?? row.source_page,
        approvalState: row.verified ? "verified" : "draft",
      })),
    },
    rows.map((row, index) => ({
      sourceType: "knowledge_entry",
      sourceId: row.id ?? `knowledge_entry:${index}`,
      title: row.title ?? row.filename ?? null,
      url: row.source_url,
      page: row.page_start ?? row.source_page,
      approvalState: row.verified ? "verified" : "draft",
    })),
    "high",
    rows.every((r) => r.verified) ? "verified" : "draft",
  );
}

async function getTagContext(client: DbClient, input: Record<string, unknown>) {
  const tag = asString(input, "tag_or_uns_path") || asString(input, "tagOrUnsPath") || asString(input, "tag");
  if (!tag) return notFound("get_tag_context", "tag_or_uns_path is required");

  const { rows } = await client.query<ApprovedTagRow & { entity_id: string | null; entity_name: string | null }>(
    `SELECT t.uns_path::text AS uns_path, t.source_system, t.source_tag_path,
            t.normalized_tag_path, t.enabled, e.id::text AS entity_id, e.name AS entity_name
       FROM approved_tags t
       LEFT JOIN kg_entities e ON e.uns_path = t.uns_path AND e.approval_state = 'verified'
      WHERE t.enabled = true
        AND (
          t.uns_path::text = $1
          OR t.normalized_tag_path = $1
          OR t.source_tag_path = $1
        )
      LIMIT 1`,
    [tag],
  );
  const row = rows[0];
  if (!row) return notFound("get_tag_context", "tag is not on the approved read allowlist");

  return ok(
    "get_tag_context",
    {
      unsPath: row.uns_path,
      sourceSystem: row.source_system,
      sourceTagPath: row.source_tag_path,
      normalizedTagPath: row.normalized_tag_path,
      linkedEntity: row.entity_id ? { assetId: row.entity_id, name: row.entity_name } : null,
      approvalState: "approved",
    },
    [{
      sourceType: "approved_tag",
      sourceId: row.uns_path ?? tag,
      approvalState: "approved",
    }],
    "verified",
    "approved",
  );
}

async function getLiveValue(client: DbClient, input: Record<string, unknown>) {
  const tag = asString(input, "tag_or_uns_path") || asString(input, "tagOrUnsPath") || asString(input, "tag");
  if (!tag) return notFound("get_live_value", "tag_or_uns_path is required");

  const allowed = await client.query<ApprovedTagRow>(
    `SELECT uns_path::text AS uns_path, source_system, source_tag_path,
            normalized_tag_path, enabled
       FROM approved_tags
      WHERE enabled = true
        AND (
          uns_path::text = $1
          OR normalized_tag_path = $1
          OR source_tag_path = $1
        )
      LIMIT 1`,
    [tag],
  );
  const approved = allowed.rows[0];
  if (!approved?.uns_path) return notFound("get_live_value", "no approved live-read tag matched");

  const live = await client.query<LiveValueRow>(
    `SELECT uns_path::text AS uns_path, last_value_text, last_value_numeric,
            last_value_bool, latest_quality, freshness_status, last_seen_at
       FROM live_signal_cache
      WHERE uns_path = $1::ltree
      LIMIT 1`,
    [approved.uns_path],
  );
  const row = live.rows[0];
  if (!row) return notFound("get_live_value", "approved tag has no cached live value");

  const reading = normalizeLiveValue(row);
  return ok(
    "get_live_value",
    {
      unsPath: approved.uns_path,
      sourceSystem: approved.source_system,
      sourceTagPath: approved.source_tag_path,
      currentValue: toCurrentValueResult(reading),
      approvalState: "approved",
    },
    [
      { sourceType: "approved_tag", sourceId: approved.uns_path, approvalState: "approved" },
      { sourceType: "live_signal_cache", sourceId: approved.uns_path, approvalState: "approved" },
    ],
    "verified",
    "approved",
  );
}

async function listRelatedAssets(client: DbClient, input: Record<string, unknown>) {
  const assetId = asString(input, "asset_id") || asString(input, "assetId");
  if (!assetId) return notFound("list_related_assets", "asset_id is required");

  const asset = await resolveVerifiedAsset(client, assetId);
  if (!asset) return notFound("list_related_assets", "verified asset not found");

  const edges = await relationshipsForElement(client, asset.id);
  const otherIds = edges.map((e) => (e.source_id === asset.id ? e.target_id : e.source_id));
  const others = await loadEntitiesByIds(client, otherIds);
  const byId = new Map(others.map((o) => [o.id, kgEntityToObjectInstance(o)]));
  const related = edges.map((e) => relatedFromEdge(e, asset.id, byId)).filter((r) => r !== null);

  if (related.length === 0) return notFound("list_related_assets", "no verified related assets found");
  return ok(
    "list_related_assets",
    {
      asset: projectAsset(asset),
      related: related.map((r) => ({
        relationship: r.sourceRelationship,
        assetId: r.object.elementId,
        name: r.object.displayName,
        typeElementId: r.object.typeElementId,
        unsPath: r.object.metadata?.system?.uns_path ?? null,
        approvalState: "verified",
      })),
    },
    [
      assetEvidence(asset),
      ...edges.map((edge) => ({
        sourceType: "kg_relationship" as const,
        sourceId: `${edge.source_id}:${edge.relationship_type}:${edge.target_id}`,
        approvalState: "verified" as const,
      })),
    ],
    "verified",
    "verified",
  );
}

async function getDiagnosticContext(client: DbClient, input: Record<string, unknown>) {
  const assetId = asString(input, "asset_id") || asString(input, "assetId");
  const faultCode = asString(input, "fault_code") || asString(input, "faultCode");
  if (!assetId && !faultCode) {
    return notFound("get_diagnostic_context", "asset_id or fault_code is required");
  }

  const { rows } = await client.query<{
    id: string;
    entity_id: string | null;
    entity_type: string;
    name: string;
    approval_state: string | null;
    uns_path: string | null;
    properties: Record<string, unknown> | null;
    relationship_type: string | null;
  }>(
    `SELECT e.id, e.entity_id, e.entity_type, e.name, e.approval_state,
            e.uns_path::text AS uns_path, e.properties, r.relationship_type
       FROM kg_entities e
       LEFT JOIN kg_relationships r
         ON r.target_id = e.id
        AND r.approval_state = 'verified'
      WHERE e.approval_state = 'verified'
        AND (
          ($1::text <> '' AND (e.id::text = $1 OR r.source_id::text = $1))
          OR ($2::text <> '' AND (e.entity_id ILIKE $2 OR e.name ILIKE $2 OR e.properties::text ILIKE $2))
        )
        AND e.entity_type IN ('fault', 'fault_code', 'diagnostic', 'manual', 'work_order', 'component')
      ORDER BY e.entity_type, e.name
      LIMIT 30`,
    [assetId, faultCode ? sqlLike(faultCode) : ""],
  );

  if (rows.length === 0) return notFound("get_diagnostic_context", "no verified diagnostic context found");
  return ok(
    "get_diagnostic_context",
    {
      assetId: assetId || null,
      faultCode: faultCode || null,
      results: rows.map((row) => ({
        id: row.id,
        entityId: row.entity_id,
        entityType: row.entity_type,
        name: row.name,
        unsPath: row.uns_path,
        relationshipType: row.relationship_type,
        properties: row.properties ?? {},
        approvalState: row.approval_state ?? "unknown",
      })),
    },
    rows.map((row) => ({
      sourceType: "kg_entity",
      sourceId: row.id,
      approvalState: row.approval_state === "verified" ? "verified" : "draft",
    })),
    "high",
    "verified",
  );
}

function yamlString(body: string, key: string): string | null {
  const m = body.match(new RegExp(`^${key}:\\s*["']?([^"'\\n]+)["']?\\s*$`, "m"));
  return m ? m[1].trim() : null;
}

function yamlList(body: string, key: string): string[] {
  const oneLine = body.match(new RegExp(`^${key}:\\s*\\[([^\\]]*)\\]\\s*$`, "m"));
  if (oneLine) {
    return oneLine[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
  }
  const block = body.match(new RegExp(`^${key}:\\s*\\n((?:\\s+-\\s+[^\\n]+\\n?)+)`, "m"));
  if (!block) return [];
  return block[1].split("\n").map((line) => line.replace(/^\s+-\s+/, "").trim()).filter(Boolean);
}

function scenarioEvidence(file: string, id: string): FactoryLmEvidenceRef {
  return {
    sourceType: "simlab_scenario",
    sourceId: id,
    title: file,
    approvalState: "internal",
    citation: file,
  };
}

async function searchSimlabScenarios(input: Record<string, unknown>, deps: SkillDeps) {
  const query = asString(input, "query");
  if (!query) return notFound("search_simlab_scenarios", "query is required");
  const dir = deps.simlabScenarioDir ?? DEFAULT_SIMLAB_SCENARIO_DIR;
  const readDir = deps.readDir ?? readdir;
  const readTextFile = deps.readTextFile ?? readFile;
  const limit = asLimit(input, 5, 20);

  const files = (await readDir(dir)).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  const q = query.toLowerCase();
  const matches = [];
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const body = await readTextFile(fullPath, "utf8");
    const haystack = body.toLowerCase();
    if (!haystack.includes(q) && !q.split(/\s+/).some((term) => term.length > 2 && haystack.includes(term))) {
      continue;
    }
    const id = yamlString(body, "id") ?? file.replace(/\.ya?ml$/, "");
    matches.push({
      scenarioId: id,
      name: yamlString(body, "name"),
      machineType: yamlString(body, "machine_type"),
      simlabScenarioId: yamlString(body, "simlab_scenario_id"),
      simlabAssetId: yamlString(body, "simlab_asset_id"),
      unsPath: yamlString(body, "\\s+uns_path"),
      rootCause: yamlString(body, "\\s+root_cause"),
      rootCauseComponent: yamlString(body, "\\s+root_cause_component"),
      tags: yamlList(body, "tags"),
      citation: file,
    });
    if (matches.length >= limit) break;
  }

  if (matches.length === 0) return notFound("search_simlab_scenarios", "no SimLab scenario matched query");
  return ok(
    "search_simlab_scenarios",
    { query, results: matches },
    matches.map((m) => scenarioEvidence(m.citation, m.scenarioId)),
    "medium",
    "internal",
  );
}

export function createFactoryLmContextSkill(deps: SkillDeps = {}) {
  const runWithTenant = deps.runWithTenant ?? withTenantContext;

  return {
    async call(call: FactoryLmToolCall): Promise<FactoryLmToolResponse> {
      if (!call.context?.tenantId) {
        return refused(call.tool, "tenantId is required");
      }
      if (!FACTORYLM_CONTEXT_TOOLS.includes(call.tool as FactoryLmContextTool)) {
        return refused(call.tool, "unsupported or unsafe tool; FactoryLM external AI skill is read-only");
      }

      const input = { ...(call.input ?? {}), tenantId: call.context.tenantId };
      if (call.tool === "search_simlab_scenarios") {
        return searchSimlabScenarios(input, deps);
      }

      return runWithTenant(call.context.tenantId, async (client) => {
        switch (call.tool) {
          case "find_asset":
            return findAsset(client, input);
          case "get_asset_context":
            return getAssetContext(client, input);
          case "search_approved_evidence":
            return searchApprovedEvidence(client, input);
          case "get_tag_context":
            return getTagContext(client, input);
          case "list_related_assets":
            return listRelatedAssets(client, input);
          case "get_diagnostic_context":
            return getDiagnosticContext(client, input);
          case "get_live_value":
            return getLiveValue(client, input);
          default:
            return refused(call.tool, "unsupported tool");
        }
      });
    },
  };
}

export const factoryLmContextSkill = createFactoryLmContextSkill();
