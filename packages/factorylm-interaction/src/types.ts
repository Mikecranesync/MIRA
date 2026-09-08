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

/**
 * The lifecycle of a turn, a tool call, or a run.
 *
 * `safety_stop` is a FIRST-CLASS member, not a flavour of `stopped`.
 *
 * The Hub's enum (ADR-0040) has carried a safety-stop state since it shipped;
 * this union did not, so a safety turn arriving from a Hub surface had no
 * representation here at all and had to be squeezed into a neighbouring
 * lifecycle by whichever adapter met it first. That is the one substitution
 * that must never be made silently: `stopped` means a person interrupted the
 * answer, `failed` means it broke, and `safety_stop` means MIRA REFUSED on
 * safety grounds. A renderer that cannot tell them apart will eventually show
 * a technician "Stopped" where the truthful word was "Safety stop", and the
 * difference is whether they understand that the machine, not the network, is
 * the reason there is no answer.
 *
 * Adding the member is deliberately its own contract change rather than a
 * clause inside a feature PR: a safety state must be defined where the type
 * lives, with exhaustive parsing and rendering, and never inferred at a render
 * gate from an adjacent lifecycle.
 */
export type Lifecycle =
  | "accepted"
  | "queued"
  | "running"
  | "waiting"
  | "stopping"
  | "completed"
  | "stopped"
  | "failed"
  | "cancelled"
  | "safety_stop";

/**
 * Every member, in one array, as the SINGLE source of truth for parsing.
 *
 * `satisfies readonly Lifecycle[]` proves every ELEMENT is a `Lifecycle`. It
 * does NOT prove every `Lifecycle` is present — dropping a member leaves the
 * array still satisfying the constraint. That distinction matters here more
 * than almost anywhere: a member in the union but missing from this array
 * makes `parseLifecycle` return `null` for a LEGITIMATE state, which is this
 * file's own thesis turned against it — `safety_stop` again, a real lifecycle
 * the boundary cannot represent.
 *
 * The exhaustiveness check below is what actually closes that. See it for why
 * a `Record<Lifecycle, …>` in a consuming package is not a substitute.
 */
export const LIFECYCLES = [
  "accepted",
  "queued",
  "running",
  "waiting",
  "stopping",
  "completed",
  "stopped",
  "failed",
  "cancelled",
  "safety_stop",
] as const satisfies readonly Lifecycle[];

/**
 * Compile-time exhaustiveness: every `Lifecycle` must appear in `LIFECYCLES`.
 *
 * `satisfies` above covers one direction (elements are lifecycles); this
 * covers the other (lifecycles are elements). Both are needed, and only this
 * one fails in the package that OWNS the union.
 *
 * Peer review of 746b0c3ab found the original claim was false. Adding
 * `| "paused"` to the union without adding it to `LIFECYCLES` produced exactly
 * ONE tsc error — at `packages/factorylm-ui/src/parts.tsx`, the
 * `Record<Lifecycle, string>` introduced by this same PR — and none from this
 * file. So the contract was being defended by a different mechanism in a
 * different package, which means (a) anything consuming
 * `factorylm-interaction` WITHOUT `factorylm-ui` got nothing, and (b) it was
 * one refactor away from gone: `lifecycleLabel` was a `charAt(0).toUpperCase()`
 * expression until this PR, and restoring that shape would have let
 * `LIFECYCLES` drift in silence.
 *
 * The tuple wrapper is deliberate. A bare `Exclude<…> extends never` is a
 * distributive conditional, which evaluates to `never` for an empty union and
 * makes the check unreliable; `[X] extends [never]` is the non-distributive
 * form and is the one that actually holds.
 */
const _LIFECYCLES_ARE_EXHAUSTIVE: [Exclude<Lifecycle, (typeof LIFECYCLES)[number]>] extends [never]
  ? true
  : never = true;
void _LIFECYCLES_ARE_EXHAUSTIVE;

/** Fail-closed boundary parse. Unknown input is NOT coerced to a neighbour. */
export function isLifecycle(value: unknown): value is Lifecycle {
  return typeof value === "string" && (LIFECYCLES as readonly string[]).includes(value);
}

/**
 * Parse a lifecycle from untrusted input.
 *
 * Returns `null` rather than a fallback. A fallback here would be exactly the
 * defect this contract exists to prevent: an unrecognised safety state
 * quietly becoming `completed` or `stopped`, which reads to a technician as
 * "there is an answer" or "you stopped it".
 */
export function parseLifecycle(value: unknown): Lifecycle | null {
  return isLifecycle(value) ? value : null;
}

/**
 * Whether a lifecycle means MIRA declined on safety grounds.
 *
 * A predicate rather than an equality check at each call site, so that if a
 * second safety-bearing state is ever added, every consumer picks it up.
 */
export function isSafetyStop(lifecycle: Lifecycle): boolean {
  return lifecycle === "safety_stop";
}

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
  /** The server withheld the bound machine for this turn: the client's asset claim did not
   *  match the confirmed binding, so no machine history was used. Presence-only; ids stay
   *  server-side. Mirrors the mobile chat-adapter's `identity_dispute`. */
  | { readonly type: "identity_dispute" }
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
