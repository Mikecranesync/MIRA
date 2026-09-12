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
  return `notebook-${meta.notebookId}`;
}

export function contextFor(meta: UnifiedNotebookMeta, identityDisputed = false): ContextSnapshot {
  const asset = meta.asset ?? null;
  return {
    tenantId: meta.tenantId ?? "tenant",
    projectId: `project-${meta.notebookId}`,
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
    id: `project-${meta.notebookId}`,
    name: asset?.name || meta.title || "Untitled chat",
    children: [
      ...(asset ? [{ kind: "machine-link" as const, id: `link-${asset.id}`, label: asset.name, machineId: asset.id }] : []),
      { kind: "thread" as const, id: threadIdFor(meta), label: meta.title || "Untitled chat" },
    ],
  }];
}

const BASIS_KINDS: readonly { readonly match: RegExp; readonly kind: EvidenceBasisKind }[] = [
  { match: /live/i, kind: "live_machine_evidence" },
  { match: /machine|history|replay|sensor/i, kind: "machine_history" },
  { match: /oem|manual|document|source|cited|kb|knowledge/i, kind: "oem_documentation" },
  { match: /workspace|file|upload|notebook/i, kind: "workspace_evidence" },
  { match: /component|nameplate|identified/i, kind: "identified_component" },
];

/** Server basis strings are free text; map by keyword, fall back to general reasoning (never over-claim). */
export function basisKind(basis: string): EvidenceBasisKind {
  for (const entry of BASIS_KINDS) if (entry.match.test(basis)) return entry.kind;
  return "general_reasoning";
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
    case "safety_notice":
      return {
        type: "safety_notice",
        notice: { severity: "stop", message: SAFETY_STOP_MESSAGE, ...(part.trigger ? { trigger: part.trigger } : {}) },
      };
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
    projectId: `project-${meta.notebookId}`,
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
