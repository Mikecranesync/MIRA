/** Read-only, tenant/owner-scoped facts for WF-01. No getNotebook (which updates recency). */
import pool from "@/lib/db";
import { withTenantContext } from "@/lib/tenant-context";
import { findDuplicateUpload, getUpload } from "@/lib/uploads";
import { parseWorkflowObservation, type WorkflowObservation } from "@/lib/workflow-contract";
import { projectManualQuestion, type ManualWorkflowFacts } from "./manual-question-workflow";

export async function inspectManualQuestion(input: { tenantId: string; userId: string; notebookId: string; fileId: string; clientRequestId?: string; threadId?: string }) {
  const { tenantId, notebookId, fileId } = input;
  const row = await withTenantContext(tenantId, async (c) => {
    const { rows } = await c.query(
      `SELECT f.id::text AS file_id, f.content_sha256, f.upload_id::text,
              n.node_id::text, now() AS observed_at,
              CASE WHEN f.ingest_claim_token IS NULL THEN 'none'
                   WHEN f.ingest_claimed_at >= now() - interval '10 minutes' THEN 'live'
                   ELSE 'stale' END AS claim,
              s.doc_id::text AS source_doc_id, s.enabled_by_default, s.match_state, s.superseded_at
         FROM equipment_notebooks n
         JOIN namespace_direct_uploads f ON f.tenant_id = n.tenant_id AND f.id = $3::uuid
         LEFT JOIN equipment_notebook_sources s ON s.tenant_id = n.tenant_id
              AND s.notebook_id = n.id AND s.doc_id = f.upload_id
        WHERE n.tenant_id = $1::uuid AND n.id = $2::uuid
          AND (f.node_id = n.node_id OR EXISTS (
            SELECT 1 FROM workspace_file_links l WHERE l.tenant_id = n.tenant_id AND l.file_id = f.id
              AND l.target_type = 'namespace_node' AND l.target_id = n.node_id))`,
      [tenantId, notebookId, fileId],
    );
    return rows[0];
  });
  if (!row) return null;
  const visibilityGaps: string[] = [];
  let uploadObservation: WorkflowObservation | null = null;
  try {
    const result = await pool.query(
      `SELECT COALESCE(output, input)->'workflow' AS observation FROM workflow_runs
        WHERE tenant_id = $1 AND workflow_name = 'manual_upload'
          AND input->'workflow'->'identity'->>'operationId' = $2
        ORDER BY started_at DESC, run_id DESC LIMIT 1`, [tenantId, fileId],
    );
    if (result.rows[0]?.observation) {
      const value = parseWorkflowObservation(result.rows[0].observation);
      if (value.identity.tenantId !== tenantId || value.identity.operationId !== fileId) throw new Error("observation_scope_mismatch");
      uploadObservation = value;
    }
  } catch { visibilityGaps.push("upload_observation_unavailable"); }
  let documentId: string | null = row.upload_id ?? null;
  if (!documentId && row.content_sha256) {
    // Reuse #5319's exact tenant/node/hash/status read law; GET never repairs the link.
    documentId = (await findDuplicateUpload(tenantId, row.content_sha256, row.node_id))?.id ?? null;
  }
  const upload = documentId ? await getUpload(documentId, tenantId) : null;
  const counts = documentId ? await withTenantContext(tenantId, async (c) => {
    const { rows } = await c.query(
      `SELECT count(*)::int AS total, count(*) FILTER (WHERE COALESCE(page_start, source_page) > 0)::int AS anchored
         FROM knowledge_entries WHERE tenant_id = $1::uuid AND doc_id = $2::uuid AND is_private = true`,
      [tenantId, documentId],
    ); return rows[0];
  }) : { total: 0, anchored: 0 };
  let turn: ManualWorkflowFacts["turn"] = null;
  if (input.clientRequestId && documentId) {
    const t = await withTenantContext(tenantId, async (c) => {
      const { rows } = await c.query(
        `SELECT id::text, answer_status, client_request_state,
                client_request_started_at < now() - interval '10 minutes' AS stale,
                enabled_source_doc_ids ? $6 AS completed_scope,
                client_request_payload->'sourceDocIds' ? $6 AS pending_scope,
                answer_text IS NOT NULL AND length(answer_text) > 0 AS answer_present,
                evidence
           FROM equipment_notebook_turns
          WHERE tenant_id = $1::uuid AND notebook_id = $2::uuid AND owner_user_id = $3
            AND client_request_id = $4::uuid AND COALESCE(thread_id, 'legacy') = $5`,
        [tenantId, notebookId, input.userId, input.clientRequestId, input.threadId ?? "legacy", documentId],
      ); return rows[0];
    });
    if (t) {
      const evidence: Record<string, unknown>[] = Array.isArray(t.evidence) ? t.evidence : [];
      let cancelled = false;
      try {
        // Join only through the already owner-authorized turn, never a guessed request key.
        const { rows } = await withTenantContext(tenantId, (c) => c.query(
          `SELECT outcome FROM decision_traces WHERE tenant_id = $1 AND notebook_id = $2::uuid
             AND turn_id = $3::uuid AND lifecycle = 'closed' ORDER BY finished_at DESC LIMIT 1`,
          [tenantId, notebookId, t.id],
        ));
        cancelled = rows[0]?.outcome === "cancelled";
      } catch { visibilityGaps.push("turn_outcome_unavailable"); }
      turn = { id: t.id, state: t.client_request_state, status: t.answer_status, stale: Boolean(t.stale),
        usesDocument: Boolean(t.client_request_state === "pending" ? t.pending_scope : t.completed_scope),
        answerPresent: t.answer_present, safetyStopped: evidence.some((e) => e.kind === "safety_stop"), cancelled,
        citations: evidence.filter((e) => e.docId === documentId).slice(0, 32).map((e) => ({ docId: documentId!, page: Number.isInteger(e.page) && Number(e.page) >= 0 ? Number(e.page) : null })),
      };
    }
  }
  return projectManualQuestion({ tenantId, notebookId, fileId, sha256: row.content_sha256 ?? null,
    linkedDocId: row.upload_id ?? null, documentId, uploadStatus: upload?.status ?? null, claim: row.claim,
    chunkCount: Number(counts.total), anchoredChunkCount: Number(counts.anchored),
    source: row.source_doc_id ? { enabled: row.enabled_by_default, matchState: row.match_state, superseded: row.superseded_at !== null } : null,
    turn, observedAt: new Date(row.observed_at).toISOString(), uploadObservation, visibilityGaps });
}
