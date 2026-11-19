// Workflow version registry (durability framework criterion #2 — "Version").
//
// Every Hub-side durable workflow stamps a version onto its `workflow_runs` row
// so a run can be tied to the logic that produced it. BUMP the relevant entry
// whenever a workflow's behaviour changes (new step, reordered phases, changed
// extraction/chunking, contract change) — patch for fixes, minor for new steps.
//
// Mirrored on the Python side by per-surface WORKFLOW_VERSION constants.

export const WORKFLOW_VERSIONS = {
  /** Opt-in reference-only observation; file claims still own execution. */
  manual_upload: "1.0.1",
  /** Read-only projection of canonical manual/source/turn state. */
  manual_question: "1.0.1",
  /** Hub document/photo ingest pipeline (upload-pipeline.ts:runIngestPipeline). */
  document_ingest: "1.0.0",
} as const;

export type WorkflowName = keyof typeof WORKFLOW_VERSIONS;
