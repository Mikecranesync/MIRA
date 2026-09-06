export type SurfaceKind = "public" | "web" | "mobile" | "hub";
export type ThemeName = "light" | "dark";
export type ViewportKind = "desktop" | "tablet" | "mobile";

export interface SurfaceProfile {
  readonly kind: SurfaceKind;
  readonly publicDemo: boolean;
  readonly nativeDevice: boolean;
  readonly enterpriseInspector: boolean;
  readonly adminCapabilities: readonly string[];
  readonly offlineCapabilities: readonly string[];
}

export const PROFILES: Readonly<Record<SurfaceKind, SurfaceProfile>> = Object.freeze({
  public: Object.freeze({
    kind: "public",
    publicDemo: true,
    nativeDevice: false,
    enterpriseInspector: false,
    adminCapabilities: Object.freeze([]),
    offlineCapabilities: Object.freeze([]),
  }),
  web: Object.freeze({
    kind: "web",
    publicDemo: false,
    nativeDevice: false,
    enterpriseInspector: false,
    adminCapabilities: Object.freeze([]),
    offlineCapabilities: Object.freeze([]),
  }),
  mobile: Object.freeze({
    kind: "mobile",
    publicDemo: false,
    nativeDevice: true,
    enterpriseInspector: false,
    adminCapabilities: Object.freeze([]),
    offlineCapabilities: Object.freeze(["drafts", "attachment-queue"]),
  }),
  hub: Object.freeze({
    kind: "hub",
    publicDemo: false,
    nativeDevice: false,
    enterpriseInspector: true,
    adminCapabilities: Object.freeze(["audit", "source-provenance"]),
    offlineCapabilities: Object.freeze([]),
  }),
});

export type Lifecycle =
  | "accepted"
  | "queued"
  | "running"
  | "waiting"
  | "stopping"
  | "completed"
  | "stopped"
  | "failed"
  | "cancelled";

export interface Attachment {
  readonly id: string;
  readonly name: string;
  readonly mediaType: string;
  readonly kind: "photo" | "pdf" | "file";
  readonly status: "ready" | "queued" | "failed";
}

export interface SourceReference {
  readonly id: string;
  readonly title: string;
  readonly kind: "oem_documentation" | "workspace_file" | "machine_history";
  readonly locator: string;
}

export type EvidenceBasisKind =
  | "general_reasoning"
  | "identified_component"
  | "oem_documentation"
  | "workspace_evidence"
  | "machine_history"
  | "live_machine_evidence";

export interface EvidenceBasis {
  readonly kind: EvidenceBasisKind;
  readonly label: string;
  readonly authorized: boolean;
}

export interface MachineEvidence {
  readonly assetId: string;
  readonly anchorAt: string;
  readonly preSeconds: number;
  readonly postSeconds: number;
  readonly rowCount: number;
  readonly freshness: "live" | "stale" | "simulated" | "unknown";
  readonly source: "live" | "recorded";
  readonly reason?: "unavailable";
}

export interface VisualObservation {
  readonly fileId: string;
  readonly capturedAt: string;
  readonly provenance: "phone_photo";
  readonly verified: boolean;
}

export interface SafetyNotice {
  readonly severity: "stop" | "warning";
  readonly message: string;
  readonly trigger?: string;
}

export interface ToolState {
  readonly id: string;
  readonly name: string;
  readonly lifecycle: Lifecycle;
  readonly summary: string;
}

export interface ApprovalRequest {
  readonly id: string;
  readonly title: string;
  readonly rationale: string;
  readonly status: "requested" | "approved" | "rejected";
}

export interface DiagnosticPlan {
  readonly id: string;
  readonly title: string;
  readonly goal: string;
  readonly status: "proposed" | "approved" | "in_progress" | "completed";
}

export interface PlanStep {
  readonly id: string;
  readonly title: string;
  readonly status: "pending" | "in_progress" | "completed" | "blocked";
}

export interface RunObservation {
  readonly id: string;
  readonly text: string;
  readonly recordedAt: string;
}

export interface Hypothesis {
  readonly id: string;
  readonly statement: string;
  readonly status: "open" | "supported" | "rejected";
}

export interface Finding {
  readonly id: string;
  readonly statement: string;
  readonly status: "candidate" | "verified" | "rejected";
}

export interface Artifact {
  readonly id: string;
  readonly title: string;
  readonly kind: "handoff" | "report" | "work_order";
}

export interface ContextSnapshot {
  readonly tenantId: string;
  readonly projectId?: string;
  readonly folderId?: string;
  readonly machineId?: string;
  readonly machineIdentity: "confirmed" | "unconfirmed" | "not_applicable";
  readonly evidenceAuthorization: "authorized" | "not_authorized" | "not_applicable";
  readonly capturedAt: string;
}

export interface Usage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface InteractionError {
  readonly code: "provider_failure" | "offline" | "stopped";
  readonly message: string;
  readonly retryable: boolean;
}

export type InteractionPart =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "attachment"; readonly attachment: Attachment }
  | { readonly type: "source"; readonly source: SourceReference }
  | { readonly type: "evidence_basis"; readonly basis: EvidenceBasis }
  | { readonly type: "machine_evidence"; readonly evidence: MachineEvidence }
  | { readonly type: "visual_observation"; readonly observation: VisualObservation }
  | { readonly type: "safety_notice"; readonly notice: SafetyNotice }
  | { readonly type: "tool_call"; readonly tool: ToolState }
  | { readonly type: "tool_result"; readonly tool: ToolState }
  | { readonly type: "approval_request"; readonly approval: ApprovalRequest }
  | { readonly type: "plan"; readonly plan: DiagnosticPlan }
  | { readonly type: "plan_step"; readonly step: PlanStep }
  | { readonly type: "observation"; readonly observation: RunObservation }
  | { readonly type: "hypothesis"; readonly hypothesis: Hypothesis }
  | { readonly type: "finding"; readonly finding: Finding }
  | { readonly type: "artifact"; readonly artifact: Artifact }
  | { readonly type: "context_change"; readonly change: ContextSnapshot }
  | { readonly type: "status"; readonly status: Lifecycle }
  | { readonly type: "usage"; readonly usage: Usage }
  | { readonly type: "error"; readonly error: InteractionError }
  | { readonly type: "followups"; readonly suggestions: readonly string[] }
  | { readonly type: "unknown"; readonly raw: unknown };

export interface InteractionTurn {
  readonly id: string;
  readonly threadId: string;
  readonly runId?: string;
  readonly role: "user" | "assistant" | "system";
  readonly parts: readonly InteractionPart[];
  readonly lifecycle: Lifecycle;
  readonly context: ContextSnapshot;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface InteractionThread {
  readonly id: string;
  readonly tenantId: string;
  readonly projectId?: string;
  readonly folderId?: string;
  readonly notebookId: string;
  readonly primaryAssetId?: string;
  readonly title: string;
  readonly mode: "ask" | "work";
  readonly ownerUserId?: string;
  readonly visibility: "private" | "workspace" | "demo";
  readonly turns: readonly InteractionTurn[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface InteractionRun {
  readonly id: string;
  readonly threadId: string;
  readonly kind: "diagnostic" | "inspection" | "commissioning" | "handoff" | "report";
  readonly status: Lifecycle;
  readonly goal: string;
  readonly plan: readonly PlanStep[];
  readonly completionCriteria: readonly string[];
  readonly contextSnapshot: ContextSnapshot;
  readonly startedAt?: string;
  readonly completedAt?: string;
}

export type ProjectNode = ProjectFolder | MachineLink | ProjectItem;

export interface ProjectFolder {
  readonly kind: "folder";
  readonly id: string;
  readonly label: string;
  readonly children: readonly ProjectNode[];
}

export interface MachineLink {
  readonly kind: "machine-link";
  readonly id: string;
  readonly label: string;
  readonly machineId: string;
}

export interface ProjectItem {
  readonly kind: "thread" | "run" | "file" | "finding";
  readonly id: string;
  readonly label: string;
}

export interface Project {
  readonly id: string;
  readonly name: string;
  readonly children: readonly ProjectNode[];
}

export interface Machine {
  readonly id: string;
  readonly canonicalAssetId: string;
  readonly name: string;
  readonly unsPath: string;
  readonly status: "normal" | "attention" | "unknown";
}

export interface FixtureReviewDimensions {
  readonly themes: readonly ThemeName[];
  readonly viewports: readonly ViewportKind[];
  readonly surfaces: readonly SurfaceKind[];
}

export interface OfflineState {
  readonly state: "online" | "offline" | "syncing" | "error";
  readonly pendingChanges: number;
  readonly detail?: string;
}

export interface InspectorField {
  readonly label: string;
  readonly value: string;
}

export interface ShellFixture {
  readonly id: string;
  readonly title: string;
  readonly review: FixtureReviewDimensions;
  readonly thread: InteractionThread;
  readonly run?: InteractionRun;
  readonly projects: readonly Project[];
  readonly machines: readonly Machine[];
  readonly activeContext: ContextSnapshot;
  readonly offline: OfflineState;
  readonly inspector?: readonly InspectorField[];
}
