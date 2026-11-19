/** Reference-only observation contract. Domain stores, never this envelope, own execution. */
export const WORKFLOW_CONTRACT = "mira.workflow.v1" as const;
export const WORKFLOW_STATES = ["running", "waiting", "succeeded", "partial", "failed", "cancelled", "interrupted", "refused"] as const;
export type WorkflowState = typeof WORKFLOW_STATES[number];
const OWNERS = ["workspace_files", "equipment_notebook_sources", "equipment_notebook_turns"] as const;
const ACTIONS = ["none", "wait", "upload_again", "attach_source", "repeat_question", "review_source"] as const;
const FAILURES = ["operation_failed", "index_failed", "claim_expired", "source_unavailable", "source_rejected", "answer_failed", "answer_not_grounded", "request_source_mismatch"] as const;
export type WorkflowEvidence = { kind: "file" | "document" | "notebook" | "turn" | "chunk" | "run"; id: string; sha256?: string; page?: number; version?: number };
export interface WorkflowObservation {
  contract: typeof WORKFLOW_CONTRACT;
  definition: { name: string; version: string };
  identity: { tenantId: string; operationId: string; attemptId: string };
  owner: { system: typeof OWNERS[number]; id: string };
  stage: string;
  state: WorkflowState;
  evidence: WorkflowEvidence[];
  failure: { code: typeof FAILURES[number]; retryable: boolean } | null;
  retry: { eligible: boolean; afterMs: number | null };
  recovery: { authority: typeof OWNERS[number]; action: typeof ACTIONS[number] };
  cancellation: { requested: boolean; scope: "client_wait" | "execution"; acknowledged: boolean };
  observedAt: string;
}

export const WORKFLOW_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAME = /^[a-z][a-z0-9_]{0,63}$/;
function requireValue(ok: unknown): asserts ok { if (!ok) throw new Error("invalid_workflow_observation"); }
function object(value: unknown, keys: string[], optional: string[] = []): Record<string, unknown> {
  requireValue(value && typeof value === "object" && !Array.isArray(value));
  const row = value as Record<string, unknown>;
  requireValue(keys.every((key) => Object.hasOwn(row, key)) && Object.keys(row).every((key) => keys.includes(key) || optional.includes(key)));
  return row;
}
const uuid = (v: unknown) => typeof v === "string" && WORKFLOW_UUID.test(v);
const member = (values: readonly string[], v: unknown) => typeof v === "string" && values.includes(v);

/** Validate every nesting level; never accept arbitrary metadata/exception/content fields. */
export function parseWorkflowObservation(value: unknown): WorkflowObservation {
  const row = object(value, ["contract", "definition", "identity", "owner", "stage", "state", "evidence", "failure", "retry", "recovery", "cancellation", "observedAt"]);
  requireValue(row.contract === WORKFLOW_CONTRACT);
  const def = object(row.definition, ["name", "version"]);
  requireValue(typeof def.name === "string" && NAME.test(def.name) && typeof def.version === "string" && /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(def.version));
  const ids = object(row.identity, ["tenantId", "operationId", "attemptId"]);
  requireValue(Object.values(ids).every(uuid));
  const owner = object(row.owner, ["system", "id"]);
  requireValue(member(OWNERS, owner.system) && uuid(owner.id));
  requireValue(typeof row.stage === "string" && NAME.test(row.stage) && member(WORKFLOW_STATES, row.state));
  requireValue(Array.isArray(row.evidence) && row.evidence.length <= 64);
  for (const item of row.evidence) {
    const ref = object(item, ["kind", "id"], ["sha256", "page", "version"]);
    requireValue(member(["file", "document", "notebook", "turn", "chunk", "run"], ref.kind) && uuid(ref.id));
    if (ref.sha256 !== undefined) requireValue(typeof ref.sha256 === "string" && /^[0-9a-f]{64}$/.test(ref.sha256));
    for (const field of ["page", "version"]) if (ref[field] !== undefined) requireValue(Number.isInteger(ref[field]) && Number(ref[field]) >= 0);
  }
  if (row.failure !== null) {
    const failure = object(row.failure, ["code", "retryable"]);
    requireValue(member(FAILURES, failure.code) && typeof failure.retryable === "boolean");
  }
  const retry = object(row.retry, ["eligible", "afterMs"]);
  requireValue(typeof retry.eligible === "boolean" && (retry.afterMs === null || (Number.isInteger(retry.afterMs) && Number(retry.afterMs) >= 0 && Number(retry.afterMs) <= 3_600_000)));
  const recovery = object(row.recovery, ["authority", "action"]);
  requireValue(member(OWNERS, recovery.authority) && member(ACTIONS, recovery.action));
  requireValue(!["failed", "interrupted"].includes(String(row.state)) || row.failure !== null);
  requireValue(row.state !== "succeeded" || (row.failure === null && retry.eligible === false && recovery.action === "none"));
  const cancel = object(row.cancellation, ["requested", "scope", "acknowledged"]);
  requireValue(typeof cancel.requested === "boolean" && typeof cancel.acknowledged === "boolean" && member(["client_wait", "execution"], cancel.scope));
  requireValue(!cancel.acknowledged || (cancel.requested && cancel.scope === "execution"));
  requireValue(row.state !== "cancelled" || cancel.acknowledged === true);
  requireValue(typeof row.observedAt === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(row.observedAt) && Number.isFinite(Date.parse(row.observedAt)) && new Date(row.observedAt).toISOString() === row.observedAt);
  // Clone so a caller cannot mutate an already validated in-flight checkpoint.
  return structuredClone(value) as WorkflowObservation;
}

/** Compatibility projection into migration 044; the rich outcome remains in JSON. */
export function workflowRunStatus(state: WorkflowState): "running" | "ok" | "degraded" | "failed" {
  if (state === "running" || state === "waiting") return "running";
  if (state === "succeeded") return "ok";
  if (state === "failed" || state === "interrupted") return "failed";
  return "degraded";
}
