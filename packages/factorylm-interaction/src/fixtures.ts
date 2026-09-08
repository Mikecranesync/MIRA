import type {
  ContextSnapshot,
  FixtureReviewDimensions,
  InteractionPart,
  InteractionRun,
  InteractionThread,
  Machine,
  Project,
  ShellFixture,
} from "./types";

export const FIXTURE_IDS = Object.freeze([
  "empty",
  "general-ask",
  "machine-ask",
  "project-tree",
  "attachments",
  "grounded-answer",
  "machine-evidence",
  "safety-stop",
  "work-run",
  "error-retry",
  "offline-sync",
  "enterprise-inspector",
  "long-history",
] as const);

export type FixtureId = (typeof FIXTURE_IDS)[number];

const REVIEW: FixtureReviewDimensions = {
  themes: ["light", "dark"],
  viewports: ["desktop", "tablet", "mobile"],
  surfaces: ["public", "web", "mobile", "hub"],
};

const GENERAL_CONTEXT: ContextSnapshot = {
  tenantId: "tenant-demo",
  machineIdentity: "not_applicable",
  evidenceAuthorization: "not_applicable",
  capturedAt: "2026-09-06T12:00:00.000Z",
};

const DRIVE_A_CONTEXT: ContextSnapshot = {
  tenantId: "tenant-demo",
  projectId: "project-launch-2",
  folderId: "folder-drive-system",
  machineId: "machine-drive-a",
  machineIdentity: "confirmed",
  evidenceAuthorization: "authorized",
  capturedAt: "2026-09-06T12:00:00.000Z",
};

const DRIVE_B_CONTEXT: ContextSnapshot = {
  ...DRIVE_A_CONTEXT,
  machineId: "machine-drive-b",
  capturedAt: "2026-09-06T12:05:00.000Z",
};

const MACHINES: readonly Machine[] = [
  {
    id: "machine-drive-a",
    canonicalAssetId: "asset-launch-2-drive-a",
    name: "Launch 2 Drive A",
    unsPath: "enterprise/launch-2/lsm/drive-a",
    status: "attention",
  },
  {
    id: "machine-drive-b",
    canonicalAssetId: "asset-launch-2-drive-b",
    name: "Launch 2 Drive B",
    unsPath: "enterprise/launch-2/lsm/drive-b",
    status: "normal",
  },
];

const PROJECTS: readonly Project[] = [
  {
    id: "project-launch-2",
    name: "Launch 2 Reliability",
    children: [
      {
        kind: "folder",
        id: "folder-drive-system",
        label: "LSM Drive System",
        children: [
          {
            kind: "machine-link",
            id: "link-launch-drive-a-system",
            label: "Launch 2 Drive A",
            machineId: "machine-drive-a",
          },
          {
            kind: "folder",
            id: "folder-drive-a",
            label: "Drive A",
            children: [
              {
                kind: "machine-link",
                id: "link-launch-drive-a",
                label: "Launch 2 Drive A",
                machineId: "machine-drive-a",
              },
              { kind: "thread", id: "thread-drive-a", label: "F30001 diagnosis" },
              { kind: "run", id: "run-drive-a-f30001", label: "F30001 investigation" },
            ],
          },
          {
            kind: "machine-link",
            id: "link-launch-drive-b",
            label: "Launch 2 Drive B",
            machineId: "machine-drive-b",
          },
        ],
      },
    ],
  },
  {
    id: "project-brake-system",
    name: "Brake System",
    children: [
      {
        kind: "folder",
        id: "folder-brake-history",
        label: "Recurring findings",
        children: [
          {
            kind: "machine-link",
            id: "link-brake-drive-a",
            label: "Launch 2 Drive A",
            machineId: "machine-drive-a",
          },
          { kind: "finding", id: "finding-brake-01", label: "Brake release timing" },
        ],
      },
    ],
  },
];

function canonicalAssetIdFor(context: ContextSnapshot): string | undefined {
  if (!context.machineId) return undefined;
  return MACHINES.find((machine) => machine.id === context.machineId)?.canonicalAssetId;
}

function thread(
  id: string,
  title: string,
  context: ContextSnapshot,
  turns: InteractionThread["turns"],
  mode: InteractionThread["mode"] = "ask",
): InteractionThread {
  return {
    id,
    tenantId: "tenant-demo",
    projectId: context.projectId,
    folderId: context.folderId,
    notebookId: "notebook-launch-2",
    primaryAssetId: canonicalAssetIdFor(context),
    title,
    mode,
    visibility: "demo",
    turns,
    createdAt: "2026-09-06T12:00:00.000Z",
    updatedAt: "2026-09-06T12:20:00.000Z",
  };
}

function turn(
  id: string,
  threadId: string,
  role: "user" | "assistant" | "system",
  context: ContextSnapshot,
  parts: readonly InteractionPart[],
  lifecycle: InteractionThread["turns"][number]["lifecycle"] = "completed",
  runId?: string,
): InteractionThread["turns"][number] {
  return {
    id,
    threadId,
    role,
    parts,
    lifecycle,
    context,
    createdAt: "2026-09-06T12:00:00.000Z",
    updatedAt: "2026-09-06T12:00:00.000Z",
    ...(runId ? { runId } : {}),
  };
}

const F30001_SOURCE = {
  id: "source-f30001-manual",
  title: "SINAMICS G120 Operating Instructions",
  kind: "oem_documentation" as const,
  locator: "Chapter 8, F30001",
};

const WORK_RUN: InteractionRun = {
  id: "run-drive-a-f30001",
  threadId: "thread-drive-a",
  kind: "diagnostic",
  status: "running",
  goal: "Determine whether Drive A's F30001 is caused by supply or braking conditions.",
  plan: [
    { id: "step-verify-nameplate", title: "Verify drive identity", status: "completed" },
    { id: "step-inspect-supply", title: "Inspect supply and braking conditions", status: "in_progress" },
  ],
  completionCriteria: ["Record observed conditions", "Review any candidate finding"],
  contextSnapshot: DRIVE_A_CONTEXT,
  startedAt: "2026-09-06T12:10:00.000Z",
};

const fixtureData: Record<FixtureId, ShellFixture> = {
  empty: {
    id: "empty",
    title: "New technician workspace",
    review: REVIEW,
    thread: thread("thread-empty", "New chat", GENERAL_CONTEXT, []),
    projects: [],
    machines: [],
    activeContext: GENERAL_CONTEXT,
    offline: { state: "online", pendingChanges: 0 },
  },
  "general-ask": {
    id: "general-ask",
    title: "General Ask",
    review: REVIEW,
    thread: thread("thread-general-ask", "Bearing preload", GENERAL_CONTEXT, [
      turn("turn-general-question", "thread-general-ask", "user", GENERAL_CONTEXT, [
        { type: "text", text: "What is bearing preload?" },
      ]),
      turn("turn-general-answer", "thread-general-ask", "assistant", GENERAL_CONTEXT, [
        { type: "evidence_basis", basis: { kind: "general_reasoning", label: "General industrial guidance", authorized: false } },
        { type: "text", text: "Bearing preload is a controlled axial load applied during assembly." },
        { type: "status", status: "completed" },
        { type: "usage", usage: { inputTokens: 42, outputTokens: 34 } },
        { type: "followups", suggestions: ["How is preload measured?"] },
      ]),
    ]),
    projects: [],
    machines: [],
    activeContext: GENERAL_CONTEXT,
    offline: { state: "online", pendingChanges: 0 },
  },
  "machine-ask": {
    id: "machine-ask",
    title: "Machine-bound Ask",
    review: REVIEW,
    thread: thread("thread-machine-ask", "Drive A fault question", DRIVE_A_CONTEXT, [
      turn("turn-machine-question", "thread-machine-ask", "user", DRIVE_A_CONTEXT, [
        { type: "text", text: "What should I check first for F30001 on this drive?" },
      ]),
      turn("turn-machine-answer", "thread-machine-ask", "assistant", DRIVE_A_CONTEXT, [
        { type: "evidence_basis", basis: { kind: "oem_documentation", label: "OEM documentation", authorized: true } },
        { type: "source", source: F30001_SOURCE },
        { type: "text", text: "Confirm the supply condition before changing any drive parameters." },
      ]),
    ]),
    projects: PROJECTS,
    machines: MACHINES,
    activeContext: DRIVE_A_CONTEXT,
    offline: { state: "online", pendingChanges: 0 },
  },
  "project-tree": {
    id: "project-tree",
    title: "Nested project machine links",
    review: REVIEW,
    thread: thread("thread-project-tree", "Project overview", DRIVE_A_CONTEXT, []),
    projects: PROJECTS,
    machines: MACHINES,
    activeContext: DRIVE_A_CONTEXT,
    offline: { state: "online", pendingChanges: 0 },
  },
  attachments: {
    id: "attachments",
    title: "Attachment states",
    review: REVIEW,
    thread: thread("thread-attachments", "Drive A attachments", DRIVE_A_CONTEXT, [
      turn("turn-attachments", "thread-attachments", "user", DRIVE_A_CONTEXT, [
        { type: "attachment", attachment: { id: "file-nameplate", name: "drive-a-nameplate.jpg", mediaType: "image/jpeg", kind: "photo", status: "ready" } },
        { type: "attachment", attachment: { id: "file-g120-manual", name: "g120-manual.pdf", mediaType: "application/pdf", kind: "pdf", status: "ready" } },
        { type: "attachment", attachment: { id: "file-readings", name: "supply-readings.csv", mediaType: "text/csv", kind: "file", status: "queued" } },
      ]),
    ]),
    projects: PROJECTS,
    machines: MACHINES,
    activeContext: DRIVE_A_CONTEXT,
    offline: { state: "syncing", pendingChanges: 1, detail: "One attachment is queued for sync." },
  },
  "grounded-answer": {
    id: "grounded-answer",
    title: "Grounded answer",
    review: REVIEW,
    thread: thread("thread-grounded", "F30001 source-grounded response", DRIVE_A_CONTEXT, [
      turn("turn-grounded-answer", "thread-grounded", "assistant", DRIVE_A_CONTEXT, [
        { type: "evidence_basis", basis: { kind: "oem_documentation", label: "OEM documentation", authorized: true } },
        { type: "source", source: F30001_SOURCE },
        { type: "text", text: "The cited manual directs the technician to inspect the listed supply and braking conditions." },
        { type: "status", status: "completed" },
      ]),
    ]),
    projects: PROJECTS,
    machines: MACHINES,
    activeContext: DRIVE_A_CONTEXT,
    offline: { state: "online", pendingChanges: 0 },
  },
  "machine-evidence": {
    id: "machine-evidence",
    title: "Live and recorded machine evidence",
    review: REVIEW,
    thread: thread("thread-machine-evidence", "Drive A evidence window", DRIVE_A_CONTEXT, [
      turn("turn-machine-evidence", "thread-machine-evidence", "assistant", DRIVE_A_CONTEXT, [
        { type: "evidence_basis", basis: { kind: "live_machine_evidence", label: "Authorized machine evidence", authorized: true } },
        { type: "machine_evidence", evidence: { assetId: "asset-launch-2-drive-a", anchorAt: "2026-09-06T11:58:00.000Z", preSeconds: 300, postSeconds: 300, rowCount: 6, freshness: "live", source: "live" } },
        { type: "machine_evidence", evidence: { assetId: "asset-launch-2-drive-a", anchorAt: "2026-09-06T11:45:00.000Z", preSeconds: 300, postSeconds: 300, rowCount: 4, freshness: "stale", source: "recorded" } },
        { type: "visual_observation", observation: { fileId: "file-nameplate", capturedAt: "2026-09-06T11:57:00.000Z", provenance: "phone_photo", verified: true } },
      ]),
    ]),
    projects: PROJECTS,
    machines: MACHINES,
    activeContext: DRIVE_A_CONTEXT,
    offline: { state: "online", pendingChanges: 0 },
  },
  "safety-stop": {
    id: "safety-stop",
    title: "Safety stop",
    review: REVIEW,
    thread: thread("thread-safety-stop", "Unsafe override request", DRIVE_A_CONTEXT, [
      turn("turn-safety-stop", "thread-safety-stop", "assistant", DRIVE_A_CONTEXT, [
        { type: "safety_notice", notice: { severity: "stop", message: "Stop: do not bypass protective circuits or work on energized equipment.", trigger: "bypass protective circuits" } },
        { type: "status", status: "stopped" },
      ], "stopped"),
    ]),
    projects: PROJECTS,
    machines: MACHINES,
    activeContext: DRIVE_A_CONTEXT,
    offline: { state: "online", pendingChanges: 0 },
  },
  "work-run": {
    id: "work-run",
    title: "Diagnostic Work run",
    review: REVIEW,
    thread: thread("thread-drive-a", "Drive A diagnostic", DRIVE_A_CONTEXT, [
      turn("turn-work-start", "thread-drive-a", "assistant", DRIVE_A_CONTEXT, [
        { type: "context_change", change: DRIVE_A_CONTEXT },
        { type: "approval_request", approval: { id: "approval-plan", title: "Approve diagnostic plan", rationale: "The run records an evidence-bound investigation.", status: "approved" } },
        { type: "plan", plan: { id: "plan-drive-a", title: "F30001 investigation", goal: WORK_RUN.goal, status: "in_progress" } },
        { type: "plan_step", step: { id: "step-verify-nameplate", title: "Verify drive identity", status: "completed" } },
        { type: "tool_call", tool: { id: "tool-inspect", name: "Inspect recorded evidence", lifecycle: "running", summary: "Reviewing the captured machine window." } },
        { type: "tool_result", tool: { id: "tool-inspect", name: "Inspect recorded evidence", lifecycle: "completed", summary: "Recorded evidence is available for review." } },
        { type: "observation", observation: { id: "observation-supply", text: "Technician recorded an intermittent supply condition.", recordedAt: "2026-09-06T12:15:00.000Z" } },
        { type: "hypothesis", hypothesis: { id: "hypothesis-supply", statement: "Supply condition may contribute to the fault.", status: "supported" } },
        { type: "finding", finding: { id: "finding-supply", statement: "Candidate finding: inspect supply and braking circuit before parameter changes.", status: "candidate" } },
        { type: "artifact", artifact: { id: "artifact-handoff", title: "Shift handoff", kind: "handoff" } },
      ], "running", "run-drive-a-f30001"),
    ], "work"),
    run: WORK_RUN,
    projects: PROJECTS,
    machines: MACHINES,
    activeContext: DRIVE_A_CONTEXT,
    offline: { state: "online", pendingChanges: 0 },
  },
  "error-retry": {
    id: "error-retry",
    title: "Error and retry",
    review: REVIEW,
    thread: thread("thread-error-retry", "Retry a failed response", GENERAL_CONTEXT, [
      turn("turn-error-retry", "thread-error-retry", "assistant", GENERAL_CONTEXT, [
        { type: "error", error: { code: "provider_failure", message: "The response could not be completed.", retryable: true } },
        { type: "status", status: "failed" },
      ], "failed"),
    ]),
    projects: [],
    machines: [],
    activeContext: GENERAL_CONTEXT,
    offline: { state: "error", pendingChanges: 0, detail: "Retry remains available in the lab." },
  },
  "offline-sync": {
    id: "offline-sync",
    title: "Offline sync",
    review: REVIEW,
    thread: thread("thread-offline-sync", "Queued field note", DRIVE_B_CONTEXT, [
      turn("turn-offline-sync", "thread-offline-sync", "user", DRIVE_B_CONTEXT, [
        { type: "text", text: "Record the observed drive condition for later sync." },
        { type: "status", status: "queued" },
      ], "queued"),
    ]),
    projects: PROJECTS,
    machines: MACHINES,
    activeContext: DRIVE_B_CONTEXT,
    offline: { state: "offline", pendingChanges: 1, detail: "The field note is retained locally for sync." },
  },
  "enterprise-inspector": {
    id: "enterprise-inspector",
    title: "Enterprise inspector",
    review: REVIEW,
    thread: thread("thread-enterprise", "Drive A source provenance", DRIVE_A_CONTEXT, [
      turn("turn-enterprise", "thread-enterprise", "assistant", DRIVE_A_CONTEXT, [
        { type: "evidence_basis", basis: { kind: "workspace_evidence", label: "Authorized workspace evidence", authorized: true } },
        { type: "source", source: { id: "source-project-instruction", title: "Launch 2 source policy", kind: "workspace_file", locator: "Project instructions" } },
        { type: "text", text: "The inspector exposes the selected evidence scope and provenance." },
      ]),
    ]),
    projects: PROJECTS,
    machines: MACHINES,
    activeContext: DRIVE_A_CONTEXT,
    offline: { state: "online", pendingChanges: 0 },
    inspector: [
      { label: "Asset binding", value: "asset-launch-2-drive-a" },
      { label: "Evidence authorization", value: "authorized" },
      { label: "Source provenance", value: "workspace_file" },
    ],
  },
  "long-history": {
    id: "long-history",
    title: "Long conversation and project history",
    review: REVIEW,
    thread: thread("thread-long-history", "Drive A recurring review", DRIVE_B_CONTEXT, [
      turn("turn-history-one", "thread-long-history", "user", DRIVE_A_CONTEXT, [
        { type: "text", text: "Capture the original Drive A context before selecting Drive B." },
      ]),
      turn("turn-history-two", "thread-long-history", "assistant", DRIVE_A_CONTEXT, [
        { type: "text", text: "This historical answer retains its captured Drive A context." },
        { type: "unknown", raw: { type: "future_part", version: 2 } },
      ]),
      turn("turn-history-three", "thread-long-history", "system", DRIVE_B_CONTEXT, [
        { type: "context_change", change: DRIVE_B_CONTEXT },
        { type: "text", text: "Future turns now use the separately selected Drive B context." },
      ]),
    ]),
    projects: PROJECTS,
    machines: MACHINES,
    activeContext: DRIVE_B_CONTEXT,
    offline: { state: "online", pendingChanges: 0 },
  },
};

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export const fixtures: Readonly<Record<FixtureId, ShellFixture>> = deepFreeze(fixtureData);

export function getFixture(id: FixtureId): ShellFixture {
  return fixtures[id];
}
