/**
 * Turn → canonical-part translation (pure; ADR-0039 mobile adapter).
 *
 * REUSES the shipped semantics instead of re-implementing them:
 * - wire parsing:   `createChatSseParser` (src/lib/sse.ts) — the ONE parser;
 *                   this module never touches raw SSE.
 * - hydration:      `normalizeCitations` + `machineEvidenceEntries` +
 *                   `visualObservationEntries` + `isStoppedTurn` +
 *                   `answerBody` — the exact readers the legacy screen uses.
 *
 * INVARIANT (PRD §10.8 / spike criterion 6): a live turn and its rehydrated
 * persisted row must project to the same semantic parts. `comparableProjection`
 * is that projection; the parity tests pin it. Known, deliberate asymmetry:
 * a SAFETY turn is live-only — the server persists a safety stop as an
 * ordinary answered turn (ADR-0038 item 3, server-side gap), so hydration
 * cannot produce a `safety_notice` part until the server carries it.
 */
import {
  normalizeCitations,
  type ChatCitation,
  type ChatTurn,
} from "../lib/sse";
import { machineEvidenceEntries } from "../lib/replay";
import { visualObservationEntries } from "../lib/sensor";
import { answerBody } from "../lib/chat-copy";
import { isStoppedTurn, type NotebookServerTurn } from "../api/resources";
import type { AdapterMessage, MessagePart } from "./contract";

/** Evidence-array entries that are neither citations nor known evidence
 *  kinds — preserved as inspectable unknown parts (PRD §9.2). */
export function unknownEvidenceEntries(evidence: unknown[] | undefined): unknown[] {
  if (!Array.isArray(evidence)) return [];
  return evidence.filter((e) => {
    if (typeof e !== "object" || e === null) return false;
    const r = e as Record<string, unknown>;
    if ("citationId" in r) return false;
    return r.kind !== "machine_evidence" && r.kind !== "visual_observation";
  });
}

function userMessage(id: string, text: string): AdapterMessage {
  return {
    id,
    role: "user",
    parts: [{ type: "text", text, knownCitationIds: [] }],
    lifecycle: "completed",
    status: null,
  };
}

function assistantParts(opts: {
  text: string;
  citations: ChatCitation[];
  machine: ReturnType<typeof machineEvidenceEntries>;
  visual: ReturnType<typeof visualObservationEntries>;
  basis?: string | null;
  basisLabel?: string | null;
  followups?: string[];
  safetyTrigger?: string;
  unknown?: unknown[];
  error?: "stopped" | "provider_failure";
}): MessagePart[] {
  const parts: MessagePart[] = [];
  if (opts.safetyTrigger !== undefined) {
    parts.push({ type: "safety_notice", trigger: opts.safetyTrigger || null });
  }
  parts.push({
    type: "text",
    text: opts.text,
    knownCitationIds: opts.citations.map((c) => c.citationId),
  });
  for (const citation of opts.citations) parts.push({ type: "source", citation });
  for (const entry of opts.visual) parts.push({ type: "observation", entry });
  for (const entry of opts.machine) parts.push({ type: "machine_evidence", entry });
  if (opts.basis) parts.push({ type: "basis", basis: opts.basis, label: opts.basisLabel ?? null });
  if (opts.followups?.length) parts.push({ type: "followups", suggestions: opts.followups });
  if (opts.error) parts.push({ type: "error", reason: opts.error });
  for (const raw of opts.unknown ?? []) parts.push({ type: "unknown", raw });
  return parts;
}

/** Persisted rows → canonical messages (spike criterion 1). Same rules the
 *  legacy render applies: STRM-2 stopped turns keep the partial and drop
 *  citations/basis/cards; `answerBody` humanizes status-only turns. */
export function hydrateMessages(rows: NotebookServerTurn[]): AdapterMessage[] {
  return rows.flatMap((t): AdapterMessage[] => {
    const user = userMessage(`${t.id}-q`, t.question);
    if (isStoppedTurn(t)) {
      return [
        user,
        {
          id: `${t.id}-a`,
          role: "assistant",
          parts: assistantParts({
            text: t.answerText ?? "",
            citations: [],
            machine: [],
            visual: [],
            error: "stopped",
          }),
          lifecycle: "stopped",
          status: t.answerStatus,
        },
      ];
    }
    const failed = t.answerStatus === "error";
    return [
      user,
      {
        id: `${t.id}-a`,
        role: "assistant",
        parts: assistantParts({
          text: answerBody(t.answerText, t.answerStatus),
          citations: normalizeCitations(t.evidence),
          machine: machineEvidenceEntries(t.evidence ?? []),
          visual: visualObservationEntries(t.evidence ?? []),
          basis: t.basis,
          unknown: unknownEvidenceEntries(t.evidence),
          ...(failed ? { error: "provider_failure" as const } : {}),
        }),
        lifecycle: failed ? "failed" : "completed",
        status: t.answerStatus,
      },
    ];
  });
}

/** One completed live turn → canonical messages. `idx` keys the session-only
 *  live list the same way the legacy render does. */
export function liveTurnMessages(q: string, a: ChatTurn, idx: number): AdapterMessage[] {
  const user = userMessage(`live-${idx}-q`, q);
  // TRUNCATION HONESTY: the stream ended without the authoritative `status`
  // frame (server crash, proxy timeout, dropped connection). Folding that as
  // an answer manufactures a completion the server never sent — and because
  // `sources` arrives BEFORE `status`, it would ship citation chips on a turn
  // that never finished. Treated exactly like a stopped turn: partial text,
  // no citations, no basis, no follow-ups (PRD §10.9 / §7.6).
  if (a.sawStatus === false && a.status !== "stopped") {
    return [
      user,
      {
        id: `live-${idx}-a`,
        role: "assistant",
        parts: assistantParts({
          text: a.answer,
          citations: [],
          machine: [],
          visual: [],
          error: "provider_failure",
        }),
        lifecycle: "failed",
        status: a.status || null,
      },
    ];
  }
  if (a.status === "stopped") {
    return [
      user,
      {
        id: `live-${idx}-a`,
        role: "assistant",
        parts: assistantParts({
          text: a.answer,
          citations: [],
          machine: [],
          visual: [],
          error: "stopped",
        }),
        lifecycle: "stopped",
        status: "error",
      },
    ];
  }
  const failed = a.status === "error" || a.status.startsWith("http ");
  return [
    user,
    {
      id: `live-${idx}-a`,
      role: "assistant",
      parts: assistantParts({
        text: answerBody(a.answer, a.status),
        citations: a.citations,
        machine: a.machineEvidence ?? [],
        visual: a.visualEvidence ?? [],
        basis: a.evidenceBasis || null,
        basisLabel: a.evidenceLabel || null,
        followups: a.status === "answered" ? a.followups : undefined,
        safetyTrigger: a.safetyTrigger,
        unknown: a.unknownFrames,
        ...(failed ? { error: "provider_failure" as const } : {}),
      }),
      lifecycle: failed ? "failed" : "completed",
      status: a.status,
    },
  ];
}

/** The in-flight turn (STRM-1): question posts immediately; the answer part
 *  grows per content frame. No citations until the turn is final — the
 *  `sources` frame arrives AFTER content on the wire. */
export function pendingMessages(q: string, a: ChatTurn): AdapterMessage[] {
  return [
    userMessage("pending-q", q),
    {
      id: "pending-a",
      role: "assistant",
      parts: [{ type: "text", text: a.answer, knownCitationIds: [] }],
      lifecycle: "running",
      status: null,
    },
  ];
}

/** Whole-thread assembly: persisted rows, then session live turns, then the
 *  in-flight turn — the exact order the legacy screen renders. */
export function threadMessages(
  rows: NotebookServerTurn[],
  live: { q: string; a: ChatTurn }[],
  pending: { q: string; a: ChatTurn } | null,
): AdapterMessage[] {
  return [
    ...hydrateMessages(rows),
    ...live.flatMap((t, i) => liveTurnMessages(t.q, t.a, i)),
    ...(pending ? pendingMessages(pending.q, pending.a) : []),
  ];
}

/**
 * Criterion-6 projection: the fields that MUST match between a live turn and
 * the same turn rehydrated. Raw `status` is normalized ("stopped" is a
 * client-side token; the server persists `error`) so the comparison is
 * semantic, not cosmetic. Live-only ephemera (followups, basis label,
 * safety trigger, unknown frames) are excluded because the server does not
 * persist them — those gaps are ADR-0038's to close, not this projection's
 * to hide.
 */
export function comparableProjection(msg: AdapterMessage): {
  role: string;
  text: string;
  lifecycle: string;
  status: string | null;
  citations: ChatCitation[];
  machineEvidence: unknown[];
  visualEvidence: unknown[];
  basis: string | null;
} {
  const status = msg.lifecycle === "stopped" ? "error" : msg.status;
  return {
    role: msg.role,
    text: msg.parts
      .filter((p) => p.type === "text")
      .map((p) => (p as { text: string }).text)
      .join(""),
    lifecycle: msg.lifecycle,
    status,
    citations: msg.parts
      .filter((p): p is Extract<MessagePart, { type: "source" }> => p.type === "source")
      .map((p) => p.citation),
    machineEvidence: msg.parts
      .filter((p) => p.type === "machine_evidence")
      .map((p) => (p as { entry: unknown }).entry),
    visualEvidence: msg.parts
      .filter((p) => p.type === "observation")
      .map((p) => (p as { entry: unknown }).entry),
    basis: (msg.parts.find((p) => p.type === "basis") as { basis?: string } | undefined)?.basis ?? null,
  };
}
