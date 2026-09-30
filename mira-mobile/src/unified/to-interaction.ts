/**
 * Mobile chat-adapter vocabulary → shared interaction contract.
 *
 * The mobile lane's `AdapterMessage`/`MessagePart` (src/chat-adapter/contract.ts,
 * ADR-0039) is the proven, persisted-vs-live parity-tested vocabulary. The
 * unified shell (`@factorylm/ui`) renders the shared `InteractionPart` union
 * (packages/factorylm-interaction). This module is the ONE mapping between
 * them, member by member, per the Task 8 salvage record. It never touches
 * transport, never invents evidence, and preserves unknown parts.
 */
import type {
  ContextSnapshot,
  EvidenceBasisKind,
  InteractionPart,
  InteractionThread,
  InteractionTurn,
  Lifecycle,
  Machine,
  Project,
  ShellFixture,
  SourceReference,
} from "@factorylm/interaction";
import type { AdapterMessage, MessagePart } from "../chat-adapter/contract";
import type { ChatCitation } from "../lib/sse";

export interface UnifiedNotebookMeta {
  readonly notebookId: string;
  readonly threadId?: string | null;
  readonly projectId?: string | null;
  readonly title: string;
  readonly tenantId?: string | null;
  /** The notebook's confirmed machine binding, when it has one. */
  readonly asset?: { readonly id: string; readonly name: string; readonly unsPath?: string | null } | null;
  /** The notebook's identity status is user_confirmed (server-owned; never inferred). */
  readonly identityConfirmed: boolean;
  /** ISO timestamp used as the context capture time; the caller passes one value per hydrate. */
  readonly capturedAt: string;
}

export function threadIdFor(meta: UnifiedNotebookMeta): string {
  return meta.threadId ?? `notebook-${meta.notebookId}:thread-legacy`;
}

export function projectIdFor(meta: UnifiedNotebookMeta): string {
  return meta.projectId ?? `project-${meta.notebookId}`;
}

export function contextFor(meta: UnifiedNotebookMeta, identityDisputed = false): ContextSnapshot {
  const asset = meta.asset ?? null;
  return {
    tenantId: meta.tenantId ?? "tenant",
    projectId: projectIdFor(meta),
    ...(asset ? { machineId: asset.id } : {}),
    machineIdentity: asset ? (identityDisputed || !meta.identityConfirmed ? "unconfirmed" : "confirmed") : "not_applicable",
    evidenceAuthorization: asset ? (identityDisputed || !meta.identityConfirmed ? "not_authorized" : "authorized") : "not_applicable",
    capturedAt: meta.capturedAt,
  };
}

export function machinesFor(meta: UnifiedNotebookMeta): readonly Machine[] {
  const asset = meta.asset ?? null;
  if (!asset) return [];
  return [{ id: asset.id, canonicalAssetId: asset.id, name: asset.name, unsPath: asset.unsPath ?? "", status: "unknown" }];
}

export function projectsFor(meta: UnifiedNotebookMeta): readonly Project[] {
  const asset = meta.asset ?? null;
  return [{
    id: projectIdFor(meta),
    name: meta.title,
    children: [
      ...(asset ? [{ kind: "machine-link" as const, id: `link-${asset.id}`, label: asset.name, machineId: asset.id }] : []),
      { kind: "thread" as const, id: threadIdFor(meta), label: meta.title },
    ],
  }];
}

/** The server's basis enum (mira-hub migration 084) mapped 1:1. Exact match
 *  only — plus a conservative space→underscore normalization so legacy
 *  spaced forms ("live machine evidence") keep resolving. */
const BASIS_BY_VALUE: Readonly<Record<string, EvidenceBasisKind>> = {
  live_machine_evidence: "live_machine_evidence",
  machine_history: "machine_history",
  oem_documentation: "oem_documentation",
  workspace_evidence: "workspace_evidence",
  identified_component: "identified_component",
  general_reasoning: "general_reasoning",
};

/** Map a server basis value to a client kind. An UNKNOWN value must never
 *  become a STRONGER evidence claim: the old keyword heuristic mapped any
 *  string containing "knowledge" (e.g. a hypothetical `general_knowledge`)
 *  to `oem_documentation` — a provenance upgrade invented client-side
 *  (PR #3791 research, two-lane assessment). Unknown → general_reasoning
 *  (never over-claim). */
export function basisKind(basis: string): EvidenceBasisKind {
  const normalized = basis.trim().toLowerCase().replace(/\s+/g, "_");
  return BASIS_BY_VALUE[normalized] ?? "general_reasoning";
}

export function sourceFor(citation: ChatCitation): SourceReference {
  const page = citation.page ?? null;
  const locator = page !== null ? `p. ${page}` : citation.quote ? citation.quote.slice(0, 80) : "cited passage";
  return {
    id: citation.citationId,
    title: citation.sourceTitle,
    kind: citation.fileId ? "workspace_file" : "oem_documentation",
    locator,
  };
}

function freshnessOf(value: unknown): "live" | "stale" | "simulated" | "unknown" {
  if (value === "live" || value === "stale" || value === "simulated") return value;
  if (value && typeof value === "object") {
    const summary = value as { status?: unknown; label?: unknown };
    const candidate = summary.status ?? summary.label;
    if (candidate === "live" || candidate === "stale" || candidate === "simulated") return candidate;
  }
  return "unknown";
}

const SAFETY_STOP_MESSAGE =
  "Stop. This request involves a hazard. Follow the site lockout/tagout and safety procedure before proceeding; MIRA will not guide the unsafe step.";
/** Byte-for-byte the message mira-hub's own adapter uses
 *  (`mira-hub/src/factorylm-ui/to-interaction.ts` ELECTRICAL_DIRECTIVE_MESSAGE).
 *  The two shells MUST say the same thing about the same turn; a paraphrase here
 *  would make the phone and the web disagree about what the directive means. */
const ELECTRICAL_DIRECTIVE_MESSAGE =
  "Energized electrical work: this answer is framed by the NFPA 70E directive. De-energize, lock out, and verify absence of voltage before any hands-on step.";

export function toInteractionPart(part: MessagePart): InteractionPart {
  switch (part.type) {
    case "text":
      return { type: "text", text: part.text };
    case "source":
      return { type: "source", source: sourceFor(part.citation) };
    case "machine_evidence": {
      const entry = part.entry;
      const freshness = freshnessOf(entry.freshness);
      return {
        type: "machine_evidence",
        evidence: {
          assetId: entry.assetId,
          anchorAt: entry.anchorAt,
          preSeconds: entry.pre,
          postSeconds: entry.post,
          rowCount: entry.rowCount,
          freshness,
          source: freshness === "live" ? "live" : "recorded",
          ...(entry.reason === "unavailable" ? { reason: "unavailable" as const } : {}),
        },
      };
    }
    case "observation":
      return {
        type: "visual_observation",
        // The mobile ObservationPart carries no verification signal; never claim one.
        observation: { fileId: part.entry.fileId, capturedAt: part.entry.capturedAt, provenance: "phone_photo", verified: false },
      };
    case "safety_notice": {
      // Two shapes share this part, split by `terminal` (contract.ts #3841/#3893):
      // a hard stop (the reply IS the isolation instruction) vs the energized-
      // electrical DIRECTIVE (the turn is answered, framed by NFPA 70E). Absent
      // `terminal` means an older projection -> terminal, the safe default.
      // Collapsing both to "stop" put "MIRA will not guide the unsafe step"
      // directly above an answer that guides the steps — observed on a Pixel 9a
      // against staging, 2026-09-23 (docs/proofs/2026-09-23-pixel9a-3917-*.md).
      const terminal = part.terminal !== false;
      return {
        type: "safety_notice",
        notice: {
          severity: terminal ? "stop" : "warning",
          message: terminal ? SAFETY_STOP_MESSAGE : ELECTRICAL_DIRECTIVE_MESSAGE,
          ...(part.trigger ? { trigger: part.trigger } : {}),
        },
      };
    }
    case "basis": {
      // `authorized` is server-owned truth. The mobile BasisPart carries only the
      // basis string and a caption, so it is never asserted here — the kind is a
      // display grouping from keywords and must not be read as authorization.
      const kind = basisKind(part.basis);
      return { type: "evidence_basis", basis: { kind, label: part.label ?? part.basis, authorized: false } };
    }
    case "error":
      return {
        type: "error",
        error: part.reason === "stopped"
          ? { code: "stopped", message: "Stopped before the answer completed.", retryable: false }
          : { code: "provider_failure", message: "The answer could not be completed.", retryable: true },
      };
    case "followups":
      return { type: "followups", suggestions: part.suggestions };
    case "identity_dispute":
      return { type: "identity_dispute" };
    case "unknown":
      return { type: "unknown", raw: part.raw };
  }
}

export function lifecycleOf(msg: AdapterMessage): Lifecycle {
  switch (msg.lifecycle) {
    case "running": return "running";
    case "stopped": return "stopped";
    case "failed": return "failed";
    case "completed": return "completed";
  }
}

export function toTurn(msg: AdapterMessage, meta: UnifiedNotebookMeta): InteractionTurn {
  const disputed = msg.parts.some((part) => part.type === "identity_dispute");
  return {
    id: msg.id,
    threadId: threadIdFor(meta),
    role: msg.role,
    parts: msg.parts.map(toInteractionPart),
    lifecycle: lifecycleOf(msg),
    context: contextFor(meta, disputed),
    createdAt: meta.capturedAt,
    updatedAt: meta.capturedAt,
  };
}

export function toThread(messages: readonly AdapterMessage[], meta: UnifiedNotebookMeta): InteractionThread {
  return {
    id: threadIdFor(meta),
    tenantId: meta.tenantId ?? "tenant",
    projectId: projectIdFor(meta),
    notebookId: meta.notebookId,
    ...(meta.asset ? { primaryAssetId: meta.asset.id } : {}),
    title: meta.title,
    mode: "ask",
    visibility: "workspace",
    turns: messages.map((msg) => toTurn(msg, meta)),
    createdAt: meta.capturedAt,
    updatedAt: meta.capturedAt,
  };
}

/** Citation lookup so the host's own viewer opens the real `ChatCitation` behind a shell `source`. */
export function citationIndex(messages: readonly AdapterMessage[]): ReadonlyMap<string, ChatCitation> {
  const index = new Map<string, ChatCitation>();
  for (const msg of messages) {
    for (const part of msg.parts) if (part.type === "source") index.set(part.citation.citationId, part.citation);
  }
  return index;
}

/** The initial shell state is created from a fixture-shaped snapshot of the live notebook. */
export function liveFixture(messages: readonly AdapterMessage[], meta: UnifiedNotebookMeta): ShellFixture {
  const thread = toThread(messages, meta);
  return {
    id: `live-${meta.notebookId}`,
    title: meta.title,
    review: { themes: ["light", "dark"], viewports: ["mobile"], surfaces: ["mobile"] },
    thread,
    projects: projectsFor(meta),
    machines: machinesFor(meta),
    activeContext: contextFor(meta),
    offline: { state: "online", pendingChanges: 0 },
  };
}
