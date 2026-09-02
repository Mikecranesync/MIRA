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
 * is that projection; the parity tests pin it. Safety identity rides in the
 * persisted `evidence[]` as `{kind:"safety_notice"}` (ADR-0038 item 3), so a
 * reload cannot turn a hard stop into ordinary answer chrome.
 */
import {
  isTruncatedTurn,
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
    return (
      r.kind !== "machine_evidence" &&
      r.kind !== "visual_observation" &&
      r.kind !== "safety_notice"
    );
  });
}

/**
 * First persisted safety marker, or null when there is none.
 *
 * FAIL SAFE, NOT OPEN (FLEET-003a). `kind` is the identity; `trigger` is
 * observability only and is never rendered (see contract.ts). This previously
 * also required `typeof trigger === "string"` and returned null otherwise — so a
 * row that explicitly said `kind:"safety_notice"` was discarded over a cosmetic
 * field, and the turn reloaded as an ORDINARY ANSWER. That is the exact
 * invariant FLEET-003 exists to protect, failing in the wrong direction.
 *
 * It also made the two paths DISAGREE: the live parser is permissive
 * (`String(frame.trigger ?? "")` in lib/sse.ts), so the same malformed safety
 * frame showed the banner live and lost it on reload. A malformed trigger now
 * degrades to `""` on both paths — the same value the live parser produces —
 * so live and hydrated project identically and `comparableProjection` can pin it.
 */
export function safetyNoticeEntry(
  evidence: unknown[] | undefined,
): { kind: "safety_notice"; trigger: string } | null {
  if (!Array.isArray(evidence)) return null;
  for (const value of evidence) {
    if (typeof value !== "object" || value === null) continue;
    const row = value as Record<string, unknown>;
    if (row.kind === "safety_notice") {
      return {
        kind: "safety_notice",
        trigger: typeof row.trigger === "string" ? row.trigger : "",
      };
    }
  }
  return null;
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
  // SAFETY SUPPRESSION (FLEET-003, mirroring the hub's five guards in
  // NotebookChat.tsx). A hard stop is NOT a graded answer, so it must never
  // wear an answered turn's success chrome: no citation chips, no evidence
  // cards, no basis badge, no follow-ups. Gating HERE rather than in each
  // renderer means ChatV2 and the classic screen cannot drift apart, and the
  // live turn and its rehydrated row suppress identically — which is what
  // `comparableProjection` then pins.
  const safety = opts.safetyTrigger !== undefined;
  const citations = safety ? [] : opts.citations;
  if (safety) {
    parts.push({ type: "safety_notice", trigger: opts.safetyTrigger || null });
  }
  parts.push({
    type: "text",
    text: opts.text,
    knownCitationIds: citations.map((c) => c.citationId),
  });
  for (const citation of citations) parts.push({ type: "source", citation });
  if (!safety) {
    for (const entry of opts.visual) parts.push({ type: "observation", entry });
    for (const entry of opts.machine) parts.push({ type: "machine_evidence", entry });
    if (opts.basis) parts.push({ type: "basis", basis: opts.basis, label: opts.basisLabel ?? null });
    if (opts.followups?.length) parts.push({ type: "followups", suggestions: opts.followups });
  }
  // The terminal-error part is NOT suppressed: "Stopped" / "Incomplete" is
  // honest about what happened and never reads as a completed answer.
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
    const safetyNotice = safetyNoticeEntry(t.evidence);
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
            // HARDENING (FLEET-003). `isStoppedTurn` short-circuits BEFORE the
            // safety marker is read, so a stopped-and-persisted safety turn
            // would reload with no banner. NOT reachable under today's server
            // contract — a client-stopped turn persists `evidence=[]`, and a
            // provider failure persists `answerText=null` — so neither can
            // carry the marker here. Kept anyway: this is a safety invariant,
            // the cost is one field, and the live stopped path is already
            // sticky. Leaving the two inconsistent is how a contract change
            // later becomes a silent safety regression.
            safetyTrigger: safetyNotice?.trigger,
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
          safetyTrigger: safetyNotice?.trigger,
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
  if (isTruncatedTurn(a)) {
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
          // SAFETY IS STICKY (FLEET-003). If the `safety` frame was already on
          // the wire, the turn IS a hard stop — a later truncation cannot undo
          // that. Dropping the marker here would let a dropped connection
          // downgrade a LOTO refusal to a plain "Incomplete" answer, which is
          // exactly the misread this slice exists to prevent.
          safetyTrigger: a.safetyTrigger,
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
          // Same stickiness: stopping the stream after a safety frame keeps
          // the safety identity (partial text + "Stopped" + the banner).
          safetyTrigger: a.safetyTrigger,
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
      parts: [
        // "DURING the live response" is part of the invariant, not just after
        // it. The parser surfaces `safetyTrigger` the moment the frame lands
        // (lib/sse.ts `turn()`), and the wire order is content* → safety →
        // status — so there IS a window, however brief, where the refusal text
        // is on screen and the turn has not completed. It must not read as an
        // ordinary answer in that window either.
        ...(a.safetyTrigger !== undefined
          ? [{ type: "safety_notice" as const, trigger: a.safetyTrigger || null }]
          : []),
        { type: "text" as const, text: a.answer, knownCitationIds: [] },
      ],
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
 * unknown live frames are excluded because the server does not persist them.
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
  /** Safety identity is part of the parity contract, not decoration
   *  (FLEET-003). Without it the criterion-6 guard was blind to the exact
   *  regression it exists to catch: a hard stop that reloads as an ordinary
   *  answer projects identically on every OTHER field. Presence only — the
   *  trigger phrase is observability, never rendered. */
  safetyNotice: boolean;
} {
  const status = msg.lifecycle === "stopped" ? "error" : msg.status;
  return {
    role: msg.role,
    safetyNotice: msg.parts.some((p) => p.type === "safety_notice"),
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
