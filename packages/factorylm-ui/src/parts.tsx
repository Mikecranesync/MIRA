import type {
  Attachment,
  ConfirmIdentityResult,
  ConversionIntent,
  ProjectNode,
  ContextSnapshot,
  IdentityProposal,
  InteractionPart,
  InteractionTurn,
  Lifecycle,
  PlatformAdapter,
  ShellAction,
  ShellState,
  SourceReference,
} from "@factorylm/interaction";
import { IdentityAlreadyConfirmedError } from "@factorylm/interaction";
import { useEffect, useState, type Dispatch, type ReactNode } from "react";
import { openableUrl } from "./links";
import { PhotoThumb } from "./PhotoViewer";

/** Optional host hooks. When absent the shell stays fixture-only (reducer mock actions). */
export interface HostHooks {
  /**
   * The host's real send path; the shell clears its draft after calling it.
   *
   * `attachments` carries whatever the composer is holding for this thread, in
   * capture order, and is empty when there is none. It is REQUIRED rather than
   * optional so a host cannot silently drop a technician's evidence by writing
   * a one-argument handler and never noticing.
   */
  readonly onSend?: (text: string, attachments: readonly Attachment[]) => void;
  /** Stop the in-flight answer; shown only while `busy`. */
  readonly onStop?: () => void;
  /**
   * Retry the host's failed send. Retry is OFFERED only when this is provided:
   * without a host to re-send, a Retry button would flip to "Retry requested"
   * and do nothing (product-honesty defect, Codex review of #3643).
   */
  readonly onRetry?: (turnId: string) => void;
  /**
   * Convert a visitor who reached for a capability the public demo does not
   * carry (attachments, scans, saved Projects). Offered ONLY when the host
   * provides it -- same discipline as onNewChat/onCreateProject: without a host
   * to convert to, the shell states the limit plainly rather than rendering a
   * button that goes nowhere.
   *
   * Read only on a `publicDemo` profile; other surfaces own these capabilities
   * outright and never need the conversion path.
   */
  readonly onConvert?: (intent: ConversionIntent) => void;
  /** Open the host's own citation viewer instead of the built-in source viewer. */
  readonly onSource?: (source: SourceReference) => void;
  /**
   * Start a host-owned thread. The action is enabled only when the host
   * provides this; without it (the disconnected lab) the control is honestly disabled with a
   * visible reason — never a dead button (#3649 scope 4).
   */
  readonly onNewChat?: () => void;
  /**
   * Create a new project. The action is enabled only when the host provides this;
   * without it the control is honestly disabled with a visible reason.
   */
  readonly onCreateProject?: () => void;
  /**
   * Copy the answer. The host implements the copy sink; the shell renders the
   * control only when this is provided. Copy text carries sources and page numbers.
   */
  readonly onCopy?: (turnId: string) => void;
  /**
   * Regenerate the answer. The host re-sends the original question; the shell renders
   * the control only when this is provided.
   */
  readonly onRegenerate?: (turnId: string) => void;
  /**
   * Feedback on the answer. The host records a thumbs-up or thumbs-down; the shell
   * renders the control only when this is provided.
   */
  readonly onFeedback?: (turnId: string, direction: "up" | "down") => void;
  /**
   * Read the answer aloud (hands-busy technicians). The host owns the speech
   * engine and passes this only where the platform can speak; a second press on
   * the same answer stops it. See `answer-actions.ts`.
   */
  readonly onReadAloud?: (turnId: string) => void;
  /**
   * Record what fixed the machine, filed under the question this answer
   * replied to. The host collects the fix and persists it; the next answer on
   * this machine is grounded on it. Rendered only when provided.
   */
  readonly onRecordFix?: (turnId: string) => void;
  /**
   * Whether this answer can be recorded against. The server files a fix under
   * the machine the answer was served for, so an answer with no saved server
   * turn yet offers no button. Absent means every answered turn qualifies.
   */
  readonly canRecordFix?: (turnId: string) => boolean;
  /**
   * Open the host's real machine scanner. This keeps the shell's Scan affordance
   * routed through the existing native scanner instead of a reducer-only mock.
   */
  readonly onScanMachine?: () => Promise<string | null> | string | null;
  /**
   * The one line under the first-run greeting saying what this conversation can
   * answer from. The shell's default claims only what any notebook can do; a host
   * that knows its scope (machine bound, sources loaded) should say so truthfully.
   */
  readonly groundingLine?: () => string | undefined;
  /**
   * Suggest initial questions for first-run. The host provides up to three
   * suggested questions that send on tap; absent = no suggestions rendered.
   */
  readonly suggestChips?: () => readonly { id: string; text: string }[] | undefined;
  /**
   * Render a turn's text part. The package renders plain text; a host whose
   * text carries markdown and inline citation marks (mobile AnswerMarkdown)
   * supplies its own renderer here so the same text reads the same on every
   * surface. Absent = plain paragraph.
   */
  readonly renderText?: (text: string, turn: InteractionTurn) => ReactNode;
  /**
   * Confirm a machine MIRA proposed from free text (#4120/#4175): "Use its
   * manuals". The host PATCHes the notebook's identity server-side and
   * resolves with the server's outcome — never a client-side guess. Rendered
   * only when provided; without a host to confirm against, the button is
   * honestly disabled (same discipline as `onNewChat`/`onCreateProject`).
   */
  readonly onConfirmIdentity?: (proposal: IdentityProposal) => Promise<ConfirmIdentityResult>;
  /**
   * Reject a proposed identity: "Not this". Purely a local dismissal — the
   * contract is "no identity write" (T2 acceptance #2), so this is OPTIONAL
   * telemetry for the host, never a precondition for the button: "Not this"
   * always works, even without a host.
   */
  readonly onRejectIdentity?: (proposal: IdentityProposal) => void;
  readonly busy?: boolean;
}

export interface PartRendererProps {
  readonly part: InteractionPart;
  readonly turn: InteractionTurn;
  readonly state: ShellState;
  readonly dispatch: Dispatch<ShellAction>;
  readonly adapter: PlatformAdapter;
  readonly hooks?: HostHooks;
}

export function assertNever(value: never): never {
  throw new Error(`Unhandled interaction part: ${JSON.stringify(value)}`);
}

/**
 * Human labels for every lifecycle.
 *
 * This was `lifecycle.charAt(0).toUpperCase() + lifecycle.slice(1)`, which is
 * fine for single-word members and produces **"Safety_stop"** for the one that
 * matters most — a raw identifier shown to a technician at the exact moment
 * MIRA has declined to answer on safety grounds.
 *
 * An explicit map instead, so every member gets a deliberate word rather than
 * a mechanical transformation that happens to work for nine of ten. The
 * `Record<Lifecycle, string>` type makes the map exhaustive at COMPILE time:
 * adding a union member without a label here is a build error, not a string
 * with an underscore in it.
 */
const LIFECYCLE_LABEL: Record<Lifecycle, string> = {
  accepted: "Accepted",
  queued: "Queued",
  running: "Running",
  waiting: "Waiting",
  stopping: "Stopping",
  completed: "Completed",
  stopped: "Stopped",
  failed: "Failed",
  cancelled: "Cancelled",
  // Not "Stopped". A person stopping an answer and MIRA refusing to give one
  // are different events, and the technician needs to know which happened.
  safety_stop: "Safety stop",
};

export function lifecycleLabel(lifecycle: Lifecycle): string {
  return LIFECYCLE_LABEL[lifecycle];
}

export function machineName(state: ShellState, machineId: string | undefined): string | undefined {
  if (!machineId) return undefined;
  return state.machines.find((machine) => machine.id === machineId)?.name ?? machineId;
}

/** A turn or run carries its own context line only when it differs from the current context
 *  (machine, identity, evidence authorization, project or folder) — the chip at the top already
 *  says where we are. Authorization is a scope change too: an answer recorded while evidence was
 *  authorized must keep saying so after authorization is revoked (Codex P1, #3651). */
export function contextDiffers(state: ShellState, snapshot: ContextSnapshot): boolean {
  const now = state.activeContext;
  return snapshot.machineId !== now.machineId
    || snapshot.machineIdentity !== now.machineIdentity
    || snapshot.evidenceAuthorization !== now.evidenceAuthorization
    || (snapshot.projectId ?? undefined) !== (now.projectId ?? undefined)
    || (snapshot.folderId ?? undefined) !== (now.folderId ?? undefined);
}

/** Mono only for the code-like token in a locator ("Chapter 8, F30001" → the F30001). */
function locatorWithCode(locator: string) {
  const parts = locator.split(/(\b[A-Z]{1,3}\d{3,}\b)/);
  return parts.map((piece, index) => (index % 2 === 1 ? <code key={index}>{piece}</code> : piece));
}

function folderLabel(nodes: readonly ProjectNode[], folderId: string): string | undefined {
  for (const node of nodes) {
    if (node.kind !== "folder") continue;
    if (node.id === folderId) return node.label;
    const nested = folderLabel(node.children, folderId);
    if (nested) return nested;
  }
  return undefined;
}

/**
 * The visible text of a recorded context. Names every field that differs from the CURRENT
 * context (machine, identity, evidence, project, folder) so a history line says what
 * differs, and handles a machine-less scope: "No machine · evidence … · project …".
 */
export function describeContext(state: ShellState, context: ContextSnapshot): string {
  const now = state.activeContext;
  const machine = machineName(state, context.machineId);
  const parts: string[] = [];
  if (machine) {
    parts.push(machine, `identity ${context.machineIdentity.replace("_", " ")}`);
  } else {
    parts.push("No machine");
  }
  parts.push(`evidence ${context.evidenceAuthorization.replace(/_/g, " ")}`);
  const project = context.projectId ? state.projects.find((candidate) => candidate.id === context.projectId) : undefined;
  if (context.projectId && context.projectId !== now.projectId) parts.push(`project ${project?.name ?? context.projectId}`);
  if (context.folderId && context.folderId !== now.folderId) {
    parts.push(`folder ${(project ? folderLabel(project.children, context.folderId) : undefined) ?? context.folderId}`);
  }
  return parts.join(" · ");
}

const SOURCE_KIND_LABEL = {
  oem_documentation: "OEM",
  workspace_file: "FILE",
  machine_history: "HIST",
} as const;

export const ATTACHMENT_KIND_LABEL = { photo: "IMG", pdf: "PDF", file: "FILE" } as const;

function Card({ type, label, title, children, className, extra }: {
  readonly type: InteractionPart["type"];
  readonly label: string;
  readonly title?: string;
  readonly children?: ReactNode;
  readonly className?: string;
  readonly extra?: Record<string, string | undefined>;
}) {
  return <div className={`fl-part fl-card${className ? ` ${className}` : ""}`} data-part-type={type} {...extra}>
    <p className="fl-card__label">{label}</p>
    {title ? <p className="fl-card__title">{title}</p> : null}
    {children}
  </div>;
}

function ArtifactPart({ part, adapter }: { readonly part: Extract<InteractionPart, { type: "artifact" }>; readonly adapter: PlatformAdapter }) {
  const [outcome, setOutcome] = useState<"shared" | "cancelled" | "failed" | null>(null);
  const [busy, setBusy] = useState(false);
  const { artifact } = part;
  const share = () => {
    if (busy) return;
    setBusy(true);
    setOutcome(null);
    adapter.shareArtifact(artifact.id)
      .then((result) => setOutcome(result), () => setOutcome("failed"))
      .finally(() => setBusy(false));
  };
  return <Card type="artifact" label={`Artifact · ${artifact.kind.replace("_", " ")}`} title={artifact.title}>
    <div className="fl-card__actions">
      <button type="button" aria-label={`Share ${artifact.title}`} aria-busy={busy} disabled={busy} onClick={share}>
        Share
      </button>
      {outcome === "failed"
        ? <span role="alert" className="fl-card__meta">Share failed. Try again.</span>
        : outcome
          ? <span role="status" className="fl-card__meta">{outcome === "shared" ? "Shared" : "Share cancelled"}</span>
          : null}
    </div>
  </Card>;
}

/**
 * "Is this an {manufacturer} {model}?" — the confirm card for a machine MIRA
 * proposed from free text (#4120/#4175). Two buttons:
 *  - "Use its manuals" calls `hooks.onConfirmIdentity`, which sets the
 *    notebook's identity server-side; migration 104 promotes a matching
 *    candidate manual ONLY if its applicability was already verified. The
 *    card then shows the server's own outcome — never a guess.
 *  - "Not this" is a pure local dismissal (no identity write, ever); it
 *    always works, with or without a host, and only optionally tells the
 *    host via `onRejectIdentity` (telemetry, not a precondition).
 * Buttons are plain `<button>` inside `.fl-card__actions`, so the shell's
 * `.fl-shell button` rule (min 44px) applies without bespoke CSS.
 *
 * Light-review fix (PR #4195, "a stale proposal can overwrite a later
 * confirmed identity"): a persisted turn keeps the SAME proposal forever
 * (`to-interaction.ts`'s own `persistedMeta` header), so a card from BEFORE a
 * later, different confirm would otherwise still offer a live "Use its
 * manuals" — clicking it would silently rewrite the notebook back to the
 * earlier machine. Two independent layers close this:
 *  - `part.priorOutcome` (adapter-computed from the notebook's CURRENT
 *    confirmed identity, never the renderer's own guess) seeds `outcome`
 *    terminal on mount, so a stale/settled card never shows live buttons in
 *    the first place.
 *  - Even if a live confirm somehow fires anyway (a race the adapter missed),
 *    the server's own 409 `identity_already_confirmed` surfaces here as
 *    `IdentityAlreadyConfirmedError` — a distinct TERMINAL outcome
 *    ("superseded"), never the generic retryable "Could not confirm."
 */
function IdentityProposalPart({
  part,
  hooks,
}: {
  readonly part: Extract<InteractionPart, { type: "identity_proposal" }>;
  readonly hooks?: HostHooks;
}) {
  const [outcome, setOutcome] = useState<"confirmed" | "rejected" | "failed" | "superseded" | null>(
    part.priorOutcome === "confirmed" ? "confirmed" : part.priorOutcome === "superseded" ? "superseded" : null,
  );
  // The card can stay mounted while the notebook's identity changes (another
  // card in the same thread was confirmed). The seed above runs only on
  // mount, so follow a later adapter flag too; never overwrite an outcome
  // this card already reached itself.
  useEffect(() => {
    if (part.priorOutcome !== "confirmed" && part.priorOutcome !== "superseded") return;
    const next = part.priorOutcome;
    setOutcome((current) => (current === "confirmed" || current === "rejected" || current === "superseded" ? current : next));
  }, [part.priorOutcome]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ConfirmIdentityResult | null>(null);
  // Set only on a LIVE 409 refusal (see header); the adapter-seeded
  // "superseded" case above has no server message and falls back below.
  const [refusal, setRefusal] = useState<string | null>(null);
  const proposal: IdentityProposal = {
    manufacturer: part.manufacturer,
    model: part.model,
    ...(part.catalogNumber ? { catalogNumber: part.catalogNumber } : {}),
  };
  const name = `${part.manufacturer} ${part.model}`;
  // "confirmed"/"rejected"/"superseded" are terminal — the card has already
  // told the truth and stays that way. "failed" is NOT terminal (Codex F2,
  // MEDIUM): a transient network error must leave both actions in place so
  // the technician can retry (or dismiss) instead of being stuck on a dead
  // card.
  const settled = outcome === "confirmed" || outcome === "rejected" || outcome === "superseded";
  const confirm = () => {
    if (busy || settled || !hooks?.onConfirmIdentity) return;
    setBusy(true);
    hooks
      .onConfirmIdentity(proposal)
      .then((r) => { setResult(r); setOutcome("confirmed"); })
      .catch((err) => {
        if (err instanceof IdentityAlreadyConfirmedError) {
          setRefusal(err.message);
          setOutcome("superseded");
        } else {
          setOutcome("failed");
        }
      })
      .finally(() => setBusy(false));
  };
  const reject = () => {
    if (busy || settled) return;
    hooks?.onRejectIdentity?.(proposal);
    setOutcome("rejected");
  };
  return <Card type="identity_proposal" label="Machine identity" title={`Is this a ${name}?`}>
    {!settled ? <>
      {outcome === "failed" ? <p role="alert" className="fl-card__meta">Could not confirm. Try again.</p> : null}
      <div className="fl-card__actions">
        <button
          type="button"
          aria-busy={busy}
          disabled={busy || !hooks?.onConfirmIdentity}
          title={hooks?.onConfirmIdentity ? undefined : "Confirming isn't available on this surface yet"}
          onClick={confirm}
        >
          Use its manuals
        </button>
        <button type="button" disabled={busy} onClick={reject}>Not this</button>
      </div>
    </> : outcome === "confirmed" ? <p role="status" className="fl-card__meta">
      {result?.message ?? (result?.manualReady ? "Confirmed — its manual is ready to answer from." : "Confirmed.")}
    </p> : outcome === "superseded" ? <p role="status" className="fl-card__meta">
      {refusal ?? "A different machine is now confirmed for this notebook."}
    </p> : <p className="fl-card__meta">Not this machine.</p>}
  </Card>;
}

function ManualSearchStatusPart({ part }: { readonly part: Extract<InteractionPart, { type: "manual_search_status" }> }) {
  return <p className="fl-part fl-status" role="status" data-part-type="manual_search_status">
    {part.running
      ? `Searching ${part.manufacturer}'s documentation for ${part.model}…`
      : part.message ?? `Finished searching for the ${part.manufacturer} ${part.model} manual.`}
  </p>;
}

export function PartRenderer({ part, turn, state, dispatch, adapter, hooks }: PartRendererProps) {
  switch (part.type) {
    case "text":
      return <div className="fl-part fl-part--text" data-part-type="text">
        {hooks?.renderText ? hooks.renderText(part.text, turn) : part.text}
      </div>;

    case "attachment": {
      const { attachment } = part;
      const preview = openableUrl(attachment.previewUrl);
      // A picture the host can show (the user's own photo): the thumbnail is
      // the attachment, as in any chat app. Otherwise the original name row.
      if (preview) return <div className="fl-part fl-attachment fl-attachment--photo" data-part-type="attachment" data-attachment-status={attachment.status}>
        <PhotoThumb className="fl-photo" src={preview} alt={attachment.name} />
      </div>;
      return <div className="fl-part fl-attachment" data-part-type="attachment" data-attachment-status={attachment.status}>
        <span className="fl-attachment__kind">{ATTACHMENT_KIND_LABEL[attachment.kind]}</span>
        <span className="fl-attachment__name">{attachment.name}</span>
        <span className="fl-attachment__status">{attachment.status}</span>
      </div>;
    }

    case "source": {
      const { source } = part;
      return <button
        type="button"
        className="fl-part fl-source"
        data-part-type="source"
        data-source-id={source.id}
        aria-pressed={state.selectedSource?.id === source.id}
        onClick={() => (hooks?.onSource ? hooks.onSource(source) : dispatch({ type: "select-source", sourceId: source.id }))}
      >
        <span className="fl-source__kind">{SOURCE_KIND_LABEL[source.kind]}</span>
        <span className="fl-source__title">{source.title}</span>
        <span className="fl-source__locator">{locatorWithCode(source.locator)}</span>
      </button>;
    }

    case "evidence_basis": {
      const { basis } = part;
      return <span
        className={`fl-part fl-pill${basis.authorized ? " fl-pill--primary" : ""}`}
        data-part-type="evidence_basis"
        data-basis-kind={basis.kind}
        data-authorized={basis.authorized}
      >
        ● {basis.label}{basis.authorized ? " · authorized" : ""}
      </span>;
    }

    case "machine_evidence": {
      const { evidence } = part;
      const label = evidence.source === "live" ? "LIVE" : "RECORDED";
      return <Card
        type="machine_evidence"
        label={`${label} machine evidence`}
        extra={{ "data-evidence-source": evidence.source, "data-freshness": evidence.freshness }}
      >
        <dl className="fl-card__facts">
          <div><dt>Asset</dt><dd>{evidence.assetId}</dd></div>
          <div><dt>Window</dt><dd>−{evidence.preSeconds} s / +{evidence.postSeconds} s around {evidence.anchorAt}</dd></div>
          <div><dt>Rows</dt><dd>{evidence.rowCount}</dd></div>
          <div><dt>Freshness</dt><dd>{evidence.freshness}</dd></div>
          {evidence.reason ? <div><dt>Reason</dt><dd>{evidence.reason}</dd></div> : null}
        </dl>
      </Card>;
    }

    case "visual_observation": {
      const { observation } = part;
      // The photo itself, when the host says where it lives: a thumbnail that
      // opens the full-size image in an in-app (native <dialog>) viewer. The raw file id
      // is only printed when there is no picture to show instead.
      const preview = openableUrl(observation.previewUrl);
      return <Card type="visual_observation" label="IMG · Photo observation" extra={{ "data-verified": String(observation.verified), "data-file-id": observation.fileId }}>
        {preview ? <PhotoThumb className="fl-photo" src={preview} alt={`Photo captured ${observation.capturedAt}`} /> : null}
        <dl className="fl-card__facts">
          {preview ? null : <div><dt>File</dt><dd>{observation.fileId}</dd></div>}
          <div><dt>Captured</dt><dd>{observation.capturedAt}</dd></div>
          <div><dt>Provenance</dt><dd>{observation.provenance.replace("_", " ")}</dd></div>
          <div><dt>Verified</dt><dd>{observation.verified ? "yes" : "no"}</dd></div>
        </dl>
      </Card>;
    }

    case "safety_notice": {
      const { notice } = part;
      return <div className="fl-part fl-safety" role={notice.severity === "stop" ? "alert" : "note"} data-part-type="safety_notice" data-severity={notice.severity}>
        <span className="fl-safety__glyph" aria-hidden="true">⚠</span>
        <div>
          <p className="fl-safety__title">{notice.severity === "stop" ? "Stop" : "Warning"}</p>
          <p>{notice.message}</p>
        </div>
      </div>;
    }

    case "tool_call":
    case "tool_result": {
      const { tool } = part;
      return <Card
        type={part.type}
        label={part.type === "tool_call" ? "Tool call" : "Tool result"}
        title={tool.name}
        extra={{ "data-lifecycle": tool.lifecycle }}
      >
        <p className="fl-card__meta">{lifecycleLabel(tool.lifecycle)}</p>
        <p>{tool.summary}</p>
      </Card>;
    }

    case "approval_request": {
      const { approval } = part;
      return <Card type="approval_request" label="Approval" title={approval.title} extra={{ "data-approval-status": approval.status }}>
        <p>{approval.rationale}</p>
        <p className="fl-card__meta">{approval.status}</p>
      </Card>;
    }

    case "plan": {
      const { plan } = part;
      return <Card type="plan" label="Diagnostic plan" title={plan.title} extra={{ "data-plan-status": plan.status }}>
        <p>{plan.goal}</p>
        <p className="fl-card__meta">{plan.status.replace("_", " ")}</p>
      </Card>;
    }

    case "plan_step": {
      const { step } = part;
      return <div className="fl-part fl-step" data-part-type="plan_step" data-step-status={step.status}>
        <span className="fl-step__check" aria-hidden="true">{step.status === "completed" ? "✓" : ""}</span>
        <span><b>{step.title}</b> <span className="fl-card__meta">{step.status.replace("_", " ")}</span></span>
      </div>;
    }

    case "observation": {
      const { observation } = part;
      return <Card type="observation" label="Observation">
        <p>{observation.text}</p>
        <p className="fl-card__meta">{observation.recordedAt}</p>
      </Card>;
    }

    case "hypothesis": {
      const { hypothesis } = part;
      return <Card type="hypothesis" label="Hypothesis" extra={{ "data-hypothesis-status": hypothesis.status }}>
        <p>{hypothesis.statement}</p>
        <p className="fl-card__meta">{hypothesis.status}</p>
      </Card>;
    }

    case "finding": {
      const { finding } = part;
      const label = finding.status === "verified"
        ? "Verified finding"
        : finding.status === "rejected" ? "Rejected finding" : "Candidate finding";
      return <Card type="finding" label={label} extra={{ "data-finding-status": finding.status }}>
        <p>{finding.statement}</p>
      </Card>;
    }

    case "artifact":
      return <ArtifactPart part={part} adapter={adapter} />;

    case "context_change":
      // Same predicate as the turn/run lines: a change that equals the current
      // context is not news — the chip already says it.
      if (!contextDiffers(state, part.change)) return null;
      return <p className="fl-part fl-context-change" data-part-type="context_change" data-context-line="part">
        Context: {describeContext(state, part.change)}
      </p>;

    case "status":
      return <p className="fl-part fl-status" role="status" data-part-type="status" data-lifecycle={part.status}>
        {lifecycleLabel(part.status)}
      </p>;

    case "usage":
      return <p className="fl-part fl-usage" data-part-type="usage">
        {part.usage.inputTokens} in · {part.usage.outputTokens} out tokens
      </p>;

    case "error": {
      const { error } = part;
      const onRetry = hooks?.onRetry;
      return <div className="fl-part fl-error" role="alert" data-part-type="error" data-error-code={error.code}>
        <p>{error.message}</p>
        {error.retryable && turn.lifecycle === "failed" && typeof onRetry === "function" ? <button
          type="button"
          disabled={Boolean(hooks?.busy)}
          onClick={() => onRetry(turn.id)}
        >
          Retry
        </button> : null}
      </div>;
    }

    case "followups":
      return <ul className="fl-part fl-followups" data-part-type="followups" aria-label="Suggested follow-ups">
        {part.suggestions.map((suggestion) => <li key={suggestion}>
          <button type="button" onClick={() => dispatch({ type: "set-draft", draft: suggestion })}>{suggestion}</button>
        </li>)}
      </ul>;

    case "identity_dispute":
      return <p className="fl-part fl-identity-dispute" role="status" data-part-type="identity_dispute">
        Machine identity not confirmed for this turn: the asset claimed did not match the notebook's confirmed
        binding, so no machine history was used and nothing here is stated as machine-specific fact.
      </p>;

    case "identity_proposal":
      return <IdentityProposalPart part={part} hooks={hooks} />;

    case "manual_search_status":
      return <ManualSearchStatusPart part={part} />;

    case "unknown": {
      // NotebookTraceFrame is transport metadata, preserved on the part for
      // support. It is not an answer or a technician-facing disclosure.
      const raw = part.raw;
      if (typeof raw === "object" && raw !== null && "kind" in raw && raw.kind === "trace"
        && "turnId" in raw && typeof raw.turnId === "string"
        && "traceId" in raw && (raw.traceId === null || typeof raw.traceId === "string")) return null;
      return <details className="fl-part fl-unknown" data-part-type="unknown">
        <summary>Unrecognized part (preserved for inspection)</summary>
        <pre>{JSON.stringify(part.raw, null, 2)}</pre>
      </details>;
    }

    default:
      return assertNever(part);
  }
}
