import type {
  ContextSnapshot,
  InteractionPart,
  InteractionTurn,
  Lifecycle,
  PlatformAdapter,
  ShellAction,
  ShellState,
  SourceReference,
} from "@factorylm/interaction";
import { useState, type Dispatch, type ReactNode } from "react";

/** Optional host hooks. When absent the shell stays fixture-only (reducer mock actions). */
export interface HostHooks {
  /** The host's real send path; the shell clears its draft after calling it. */
  readonly onSend?: (text: string) => void;
  /** Stop the in-flight answer; shown only while `busy`. */
  readonly onStop?: () => void;
  /**
   * Retry the host's failed send. Retry is OFFERED only when this is provided:
   * without a host to re-send, a Retry button would flip to "Retry requested"
   * and do nothing (product-honesty defect, Codex review of #3643).
   */
  readonly onRetry?: (turnId: string) => void;
  /** Open the host's own citation viewer instead of the built-in source viewer. */
  readonly onSource?: (source: SourceReference) => void;
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

/**
 * Whether a groundedness part renders, given the lifecycle of the turn it sits on.
 *
 * `PartRenderer` consulted `turn.lifecycle` in exactly one place — the Retry
 * button — so `source`, `evidence_basis` and `followups` rendered on any turn at
 * all. `toTurn` (mira-mobile/src/unified/to-interaction.ts) maps parts and
 * lifecycle independently, so a turn that FAILED still arrives carrying every
 * citation and basis pill it had accumulated: see the fixture at
 * `mira-mobile/src/unified/__tests__/to-interaction.test.ts:78`, an assistant
 * message with `lifecycle: "failed"` whose parts include `basis`, `source` and
 * `followups`. Rendered as-is, that is a full groundedness display attached to
 * an answer that does not exist.
 *
 * The two rules are deliberately different, because the two things mean
 * different things:
 *
 * - **Provenance** (`source`, `evidence_basis`) describes content that is on
 *   screen. It survives a stop — a turn the technician interrupted still shows
 *   the partial answer, and the citations are that text's provenance, so
 *   suppressing them would strip attribution from words still being read. Only
 *   `failed` leaves nothing for provenance to describe.
 * - **An invitation** (`followups`) belongs only to a turn that finished.
 *   "What next?" under an answer that stopped, failed, or is still streaming is
 *   offering to continue from a place the conversation never reached.
 *
 * Note this keys on the lifecycle and never on whether parts are absent. A
 * `completed` turn that legitimately has no sources must render normally; the
 * gate exists to suppress a claim the turn cannot support, not to demand one.
 */
export function showsGroundedness(
  part: "source" | "evidence_basis" | "followups",
  lifecycle: Lifecycle,
): boolean {
  if (part === "followups") return lifecycle === "completed";
  return lifecycle !== "failed";
}

export function machineName(state: ShellState, machineId: string | undefined): string | undefined {
  if (!machineId) return undefined;
  return state.machines.find((machine) => machine.id === machineId)?.name ?? machineId;
}

export function describeContext(state: ShellState, context: ContextSnapshot): string {
  const machine = machineName(state, context.machineId);
  if (!machine) return "No machine";
  const identity = context.machineIdentity.replace("_", " ");
  const evidence = context.evidenceAuthorization.replace(/_/g, " ");
  return `${machine} · identity ${identity} · evidence ${evidence}`;
}

const SOURCE_KIND_LABEL = {
  oem_documentation: "OEM",
  workspace_file: "FILE",
  machine_history: "HIST",
} as const;

const ATTACHMENT_KIND_LABEL = { photo: "IMG", pdf: "PDF", file: "FILE" } as const;

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

export function PartRenderer({ part, turn, state, dispatch, adapter, hooks }: PartRendererProps) {
  switch (part.type) {
    case "text":
      return <p className="fl-part fl-part--text" data-part-type="text">{part.text}</p>;

    case "attachment": {
      const { attachment } = part;
      return <div className="fl-part fl-attachment" data-part-type="attachment" data-attachment-status={attachment.status}>
        <span className="fl-attachment__kind">{ATTACHMENT_KIND_LABEL[attachment.kind]}</span>
        <span className="fl-attachment__name">{attachment.name}</span>
        <span className="fl-attachment__status">{attachment.status}</span>
      </div>;
    }

    case "source": {
      if (!showsGroundedness("source", turn.lifecycle)) return null;
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
        <span>{source.title}</span>
        <span className="fl-source__locator">{source.locator}</span>
      </button>;
    }

    case "evidence_basis": {
      if (!showsGroundedness("evidence_basis", turn.lifecycle)) return null;
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
      return <Card type="visual_observation" label="IMG · Photo observation" extra={{ "data-verified": String(observation.verified) }}>
        <dl className="fl-card__facts">
          <div><dt>File</dt><dd>{observation.fileId}</dd></div>
          <div><dt>Captured</dt><dd>{observation.capturedAt}</dd></div>
          <div><dt>Provenance</dt><dd>{observation.provenance.replace("_", " ")}</dd></div>
          <div><dt>Verified</dt><dd>{observation.verified ? "yes" : "no"}</dd></div>
        </dl>
      </Card>;
    }

    case "safety_notice": {
      const { notice } = part;
      return <div className="fl-part fl-safety" role="alert" data-part-type="safety_notice" data-severity={notice.severity}>
        <span className="fl-safety__glyph" aria-hidden="true">⚠</span>
        <div>
          <p className="fl-safety__title">{notice.severity === "stop" ? "Stop" : "Warning"}</p>
          <p>{notice.message}</p>
          {notice.trigger ? <p className="fl-card__meta">Trigger: {notice.trigger}</p> : null}
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
      return <p className="fl-part fl-context-change" data-part-type="context_change">
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
      if (!showsGroundedness("followups", turn.lifecycle)) return null;
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

    case "unknown":
      return <details className="fl-part fl-unknown" data-part-type="unknown">
        <summary>Unrecognized part (preserved for inspection)</summary>
        <pre>{JSON.stringify(part.raw, null, 2)}</pre>
      </details>;

    default:
      return assertNever(part);
  }
}
