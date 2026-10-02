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
  ManualSearchStatus,
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
      return unknownInteractionPart(part.raw);
  }
}

/** A raw string field, or null — never coerced from a non-string. */
function rawString(raw: Record<string, unknown>, key: string): string | null {
  const v = raw[key];
  return typeof v === "string" ? v : null;
}

/**
 * `{type:"unknown", raw}` is the mobile chat-adapter's generic passthrough for
 * any server frame kind this contract version doesn't model — the ONE place
 * (per `src/lib/sse.ts`'s "one canonical parser" rule) that already carries an
 * `identity_proposal` or `manual_search_status` frame's full JSON all the way
 * from the wire to the shell, un-reshaped. Recognizing a known `raw.kind` HERE
 * — in the canonical, unguarded adapter — turns it into the shared part
 * `PartRenderer` knows how to confirm/show, without touching `sse.ts` or
 * `turns-to-parts.ts` (both guarded legacy presentation, #FACTORYLM-UNIFIED-
 * UI-CUTOVER-001). Anything else still falls back to `unknown` verbatim —
 * never a crash, never a guess (PRD §9.2).
 */
function unknownInteractionPart(raw: unknown): InteractionPart {
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    const r = raw as Record<string, unknown>;
    if (r.kind === "identity_proposal") {
      const manufacturer = rawString(r, "manufacturer");
      const model = rawString(r, "model");
      if (manufacturer && model) {
        const catalogNumber = rawString(r, "catalogNumber");
        return { type: "identity_proposal", manufacturer, model, ...(catalogNumber ? { catalogNumber } : {}) };
      }
    } else if (r.kind === "manual_search_status") {
      const manufacturer = rawString(r, "manufacturer");
      const model = rawString(r, "model");
      if (manufacturer && model && typeof r.running === "boolean") {
        const message = rawString(r, "message");
        // Codex round 5 F15 (#4195): `startedAt` is the search's own
        // GENERATION (the chat route's `manualSearchStatusFrame` now stamps
        // it on every live frame) — the shared follower's
        // `observeLiveManualSearchFrame` needs it to tell a genuinely NEW
        // search apart from a replay of an old one. Dropping it here would
        // silently reintroduce the F15 bug on mobile.
        const startedAt = rawString(r, "startedAt");
        return {
          type: "manual_search_status",
          manufacturer,
          model,
          running: r.running,
          ...(message ? { message } : {}),
          ...(startedAt ? { startedAt } : {}),
        };
      }
    }
  }
  return { type: "unknown", raw };
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

/**
 * Codex F4 (#4189) — the most recent `manual_search_status` part across the
 * thread (persisted or live), or null. Read straight off the already-mapped
 * `InteractionTurn[]`, the same part the live SSE passthrough already
 * produces (`toInteractionPart`'s `unknownInteractionPart`); this is just the
 * lookup `UnifiedChat`'s bounded re-check needs to know what to resolve.
 */
export function latestManualSearchStatus(
  turns: readonly InteractionTurn[],
): Extract<InteractionPart, { type: "manual_search_status" }> | null {
  let latest: Extract<InteractionPart, { type: "manual_search_status" }> | null = null;
  for (const t of turns) {
    for (const p of t.parts) if (p.type === "manual_search_status") latest = p;
  }
  return latest;
}

/**
 * Codex F4 round 2 (#4189/#4195) — render the CURRENT manual-search status,
 * whether or not a live frame ever carried one. The server never persists
 * `manual_search_status` (deliberately transient — chat/route.ts's own
 * comment), so after a reload, or for a hydration-time GET check, there is
 * NO existing part to replace — the realistic case, not the exception. If a
 * matching part already exists — a live frame arrived this session — it is
 * replaced in place; otherwise the status is APPENDED to the last assistant
 * turn (unless `options.allowAppend` is `false` — see
 * `withManualSearchOverrides` below), mirroring the Hub's own
 * `withManualSearchStatus`. Thread identity (ids, lifecycle, other parts) is
 * untouched either way.
 *
 * Codex round 6 F17 (#4195): matching is keyed on GENERATION (`startedAt`)
 * first, whenever BOTH the candidate part and the override carry one — two
 * DIFFERENT searches for the identical manufacturer/model (a retry) must
 * never be conflated into the same rendered card. Falls back to
 * manufacturer+model identity only when either side lacks a generation (an
 * older server, or the optimistic pre-first-read override right after a
 * confirm) — unchanged from before F17.
 */
export function withManualSearchOverride(
  thread: InteractionThread,
  override: ManualSearchStatus | null,
  options: { readonly allowAppend?: boolean } = {},
): InteractionThread {
  if (!override) return thread;
  const allowAppend = options.allowAppend ?? true;
  const part: InteractionPart = {
    type: "manual_search_status",
    manufacturer: override.manufacturer,
    model: override.model,
    running: override.running,
    ...(override.message ? { message: override.message } : {}),
    // Codex round 5 F15 (#4195): carry the override's own generation through
    // to the rendered part, same as every other field — `override` already
    // has it (it comes from a GET/confirm read or the follower's own
    // status), this just stops silently dropping it on the way to render.
    ...(override.startedAt ? { startedAt: override.startedAt } : {}),
  };
  const matches = (p: InteractionPart) => {
    if (p.type !== "manual_search_status") return false;
    if (override.startedAt && p.startedAt) return p.startedAt === override.startedAt;
    return p.manufacturer === override.manufacturer && p.model === override.model;
  };
  let replaced = false;
  const replacedTurns = thread.turns.map((t) => {
    if (!t.parts.some(matches)) return t;
    replaced = true;
    return { ...t, parts: t.parts.map((p) => (matches(p) ? part : p)) };
  });
  if (replaced) return { ...thread, turns: replacedTurns };
  if (!allowAppend) return thread;
  let lastAssistantIndex = -1;
  for (let i = 0; i < replacedTurns.length; i++) if (replacedTurns[i]!.role === "assistant") lastAssistantIndex = i;
  if (lastAssistantIndex === -1) return thread;
  return {
    ...thread,
    turns: replacedTurns.map((t, i) => (i === lastAssistantIndex ? { ...t, parts: [...t.parts, part] } : t)),
  };
}

/**
 * Codex round 6 F17 (#4195): apply EVERY known outcome onto the thread, not
 * just the single most-recently-active search. Before this, `UnifiedChat`
 * held exactly ONE `follow` state; the moment a SECOND, different search
 * (SMC resolves, then a different Rockwell search starts and resolves) took
 * over that single slot, the first search's turn had nothing left overlaying
 * it and reverted to whatever raw (possibly still `running: true`) frame is
 * baked into `baseThread`, indefinitely — the search had genuinely settled,
 * but its outcome was only ever remembered in the one slot that a later
 * search then overwrote.
 *
 * `historical` is every OTHER generation's settled/unresolved outcome
 * (`UnifiedChat`'s `settledManualSearches` map, keyed by generation) — each
 * may only REPLACE a matching part, never append (`allowAppend: false`): an
 * append targets "the last assistant turn" in the CURRENT thread, which
 * after a notebook switch or a newer turn is a turn that has nothing to do
 * with that historical search; appending it there would render one
 * notebook's old status under an unrelated turn.
 *
 * `active` is the CURRENTLY-followed generation's status (or `null`) and is
 * applied LAST, with the normal match-or-append behavior — so it always
 * wins for its own generation even if a stale `historical` entry for the
 * SAME key is still present (e.g. `reseedManualSearchFollow` reopening an
 * already-settled generation to `following` on a fresh authoritative read).
 */
export function withManualSearchOverrides(
  thread: InteractionThread,
  historical: readonly ManualSearchStatus[],
  active: ManualSearchStatus | null,
): InteractionThread {
  const afterHistorical = historical.reduce(
    (acc, status) => withManualSearchOverride(acc, status, { allowAppend: false }),
    thread,
  );
  return withManualSearchOverride(afterHistorical, active);
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
