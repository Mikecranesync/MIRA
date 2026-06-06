/**
 * Reasoning-trace capture: turn the `grounding` an answer consulted into a
 * persisted subgraph the /graph page can highlight. extractTrace is pure
 * (unit-tested); recordQueryTrace is the thin idempotent-free insert. Capture
 * is best-effort at the call site — it must never block an answer.
 */
import type { PoolClient } from "pg";

export interface TraceGroundingLike {
  components?: Array<{ id?: unknown }>;
  edges?: Array<{ s_name?: unknown; t_name?: unknown; relationship_type?: unknown; confidence?: unknown }>;
}

export interface TraceEdge {
  sName: string;
  tName: string;
  type: string;
  confidence: number;
}

export interface ExtractedTrace {
  entityIds: string[];
  edges: TraceEdge[];
}

/** Anchor root first, then each component id, deduped; edges coerced to strings/number. */
export function extractTrace(grounding: TraceGroundingLike, rootId: string | null): ExtractedTrace {
  const entityIds: string[] = [];
  const seen = new Set<string>();
  const push = (v: unknown) => {
    if (typeof v === "string" && v.length > 0 && !seen.has(v)) {
      seen.add(v);
      entityIds.push(v);
    }
  };
  push(rootId);
  for (const c of grounding.components ?? []) push(c?.id);
  const edges: TraceEdge[] = (grounding.edges ?? []).map((e) => ({
    sName: String(e?.s_name ?? ""),
    tName: String(e?.t_name ?? ""),
    type: String(e?.relationship_type ?? ""),
    confidence: typeof e?.confidence === "number" ? e.confidence : Number(e?.confidence ?? 0) || 0,
  }));
  return { entityIds, edges };
}

export interface RecordTraceInput {
  sessionId: string;
  questionTurnIndex: number;
  rootId: string | null;
  question: string;
  provider: string | null;
  extracted: ExtractedTrace;
}

export async function recordQueryTrace(
  client: PoolClient,
  tenantId: string,
  t: RecordTraceInput,
): Promise<void> {
  await client.query(
    `INSERT INTO kg_query_traces
       (tenant_id, session_id, question_turn_index, root_id, question, answer_provider, entity_ids, edges)
     VALUES ($1,$2,$3,$4,$5,$6,$7::uuid[],$8::jsonb)`,
    [
      tenantId,
      t.sessionId,
      t.questionTurnIndex,
      t.rootId,
      t.question,
      t.provider,
      t.extracted.entityIds,
      JSON.stringify(t.extracted.edges),
    ],
  );
}
