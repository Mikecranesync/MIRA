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
 * is that projection; the parity tests pin it. Terminal safety identity rides
 * as `{kind:"safety_stop"}` beside display data `{kind:"safety_notice"}`;
 * a non-terminal directive carries only the notice.
 */
import {
  ENERGIZED_ELECTRICAL_HAZARD,
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
      r.kind !== "safety_notice" &&
      r.kind !== "safety_stop" &&
      r.kind !== "identity_dispute"
    );
  });
}

/** 086 §3: does the persisted row carry the server's identity-dispute marker?
 *  Presence-only, like `safetyNoticeEntry` — the asset ids are audit data. */
export function hasIdentityDispute(evidence: unknown[] | undefined): boolean {
  if (!Array.isArray(evidence)) return false;
  return evidence.some(
    (e) => typeof e === "object" && e !== null && (e as Record<string, unknown>).kind === "identity_dispute",
  );
}

/**
 * First persisted safety display entry, or null when there is none.
 *
 * The trigger is observability-only and never rendered (see contract.ts), so a
 * malformed trigger degrades to an empty string. Terminal classification is
 * deliberately separate in `terminalSafetyNotice`: a safety notice can also
 * describe the non-terminal energized-electrical directive.
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

function safetyStopTrigger(evidence: unknown[] | undefined): string | null | undefined {
  if (!Array.isArray(evidence)) return undefined;
  const marker = evidence.find(
    (value) =>
      typeof value === "object" &&
      value !== null &&
      (value as Record<string, unknown>).kind === "safety_stop",
  ) as Record<string, unknown> | undefined;
  if (!marker) return undefined;
  return typeof marker.trigger === "string" ? marker.trigger : null;
}

/** A terminal persisted stop, distinct from a non-terminal safety directive. */
export function terminalSafetyNotice(
  turn: Pick<NotebookServerTurn, "answerStatus" | "basis" | "evidence">,
): { kind: "safety_notice"; trigger: string } | null {
  const stopTrigger = safetyStopTrigger(turn.evidence);
  const notices = Array.isArray(turn.evidence)
    ? turn.evidence
        .filter(
          (value) =>
            typeof value === "object" &&
            value !== null &&
            (value as Record<string, unknown>).kind === "safety_notice",
        )
        .map((value) => {
          const row = value as Record<string, unknown>;
          return {
            kind: "safety_notice" as const,
            trigger: typeof row.trigger === "string" ? row.trigger : "",
          };
        })
    : [];
  const notice = stopTrigger !== undefined
    ? (notices.find((entry) => entry.trigger === stopTrigger) ?? notices.at(-1) ?? null)
    : (notices.at(-1) ?? null);
  if (!notice) return null;
  // Compatibility for hard stops written before `safety_stop` existed. An
  // ordinary electrical directive is answered with a non-null evidence basis.
  return stopTrigger !== undefined || (turn.answerStatus === "answered" && turn.basis == null)
    ? notice
    : null;
}

/** The NON-terminal energized-electrical directive persisted on the row, if any
 *  (#3893). Distinct from `terminalSafetyNotice`: the directive is an ANSWERED
 *  turn framed by an NFPA 70E warning, persisted as `{kind:"safety_notice",
 *  trigger:ENERGIZED_ELECTRICAL_HAZARD}` with NO `safety_stop` entry and a
 *  non-null basis — so `terminalSafetyNotice` returns null for it, and without
 *  this reader the directive was dropped on reload (the hydration half of the
 *  same gap #3893 fixes on the live wire). Gated on `terminalSafetyNotice`
 *  being null so a hard stop always wins the turn; returns the trigger (always
 *  ENERGIZED_ELECTRICAL_HAZARD) or null. */
export function directiveSafetyNotice(
  turn: Pick<NotebookServerTurn, "answerStatus" | "basis" | "evidence">,
): string | null {
  if (terminalSafetyNotice(turn) !== null) return null;
  return safetyNoticeEntry(turn.evidence)?.trigger === ENERGIZED_ELECTRICAL_HAZARD
    ? ENERGIZED_ELECTRICAL_HAZARD
    : null;
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
  safetyDirective?: string;
  identityDisputed?: boolean;
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
  //
  // The energized-electrical DIRECTIVE (#3841/#3893) is the ONE exception: it
  // is an ANSWERED turn framed by an NFPA 70E warning, so it emits a
  // NON-terminal safety_notice AND keeps every piece of success chrome. It is
  // deliberately NOT folded into `safety` — that gate stays terminal-only, so
  // the `!safety` chrome blocks below run unchanged for a directive turn.
  const safety = opts.safetyTrigger !== undefined;
  const directive = !safety && opts.safetyDirective !== undefined;
  const citations = safety ? [] : opts.citations;
  if (safety) {
    parts.push({ type: "safety_notice", trigger: opts.safetyTrigger || null, terminal: true });
  } else if (directive) {
    parts.push({ type: "safety_notice", trigger: opts.safetyDirective || null, terminal: false });
  }
  parts.push({
    type: "text",
    text: opts.text,
    knownCitationIds: citations.map((c) => c.citationId),
  });
  // NOT success chrome: the dispute explains a withheld attribution, so it is
  // shown on safety and stopped turns too — wherever the marker exists.
  if (opts.identityDisputed) parts.push({ type: "identity_dispute" });
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
  return rows.flatMap((t, index): AdapterMessage[] => {
    const user = userMessage(`${t.id}-q`, t.question);
    const safetyNotice = terminalSafetyNotice(t);
    // #3893: non-terminal energized directive persisted on the row — reloads as
    // a warning-with-answer, matching the live wire and the criterion-6 parity
    // contract (`comparableProjection.safetyNotice`).
    const safetyDirective = directiveSafetyNotice(t) ?? undefined;
    const visualEvidence = visualObservationEntries(t.evidence ?? []);
    // The saved basis omits the live caption. Reconstruct only what this
    // thread's durable photo entries establish; never upgrade its trust on reload.
    const basisLabel = t.basis !== "workspace_evidence"
      ? null
      : visualEvidence.length > 0
        ? "Grounded in the attached photo — an unconfirmed reading."
        : rows.slice(0, index).some((earlier) => visualObservationEntries(earlier.evidence ?? []).length > 0)
          ? "Grounded in a photo attached earlier in this conversation — an unconfirmed reading."
          : null;
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
            identityDisputed: hasIdentityDispute(t.evidence),
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
          text: answerBody(t.answerText, t.answerStatus, null, visualEvidence.length > 0),
          citations: normalizeCitations(t.evidence),
          machine: machineEvidenceEntries(t.evidence ?? []),
          visual: visualEvidence,
          basis: t.basis,
          basisLabel,
          safetyTrigger: safetyNotice?.trigger,
          safetyDirective,
          identityDisputed: hasIdentityDispute(t.evidence),
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
    const safetyTerminal = a.safetyTrigger !== undefined;
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
          identityDisputed: a.identityDisputed === true,
          ...(safetyTerminal ? {} : { error: "provider_failure" as const }),
        }),
        // Once the authoritative safety marker arrived, the warning itself is
        // terminal and non-retryable even if the transport tail was lost.
        lifecycle: safetyTerminal ? "completed" : "failed",
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
          identityDisputed: a.identityDisputed === true,
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
        text: answerBody(a.answer, a.status, a.statusMessage, (a.visualEvidence?.length ?? 0) > 0),
        citations: a.citations,
        machine: a.machineEvidence ?? [],
        visual: a.visualEvidence ?? [],
        basis: a.evidenceBasis || null,
        basisLabel: a.evidenceLabel || null,
        followups: a.status === "answered" ? a.followups : undefined,
        safetyTrigger: a.safetyTrigger,
        // #3893: the non-terminal energized directive rides the completed
        // (answered) live turn only — a truncated/stopped turn above is not an
        // answer, so its framing warning is moot and stays out of that branch.
        safetyDirective: a.safetyDirective,
        identityDisputed: a.identityDisputed === true,
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
        // (lib/sse.ts `turn()`), and a hard-stop safety marker now precedes its
        // first content byte. The warning must render in that pre-content window
        // too, never briefly as an ordinary answer.
        ...(a.safetyTrigger !== undefined
          ? [{ type: "safety_notice" as const, trigger: a.safetyTrigger || null, terminal: true }]
          : a.safetyDirective !== undefined
            ? // #3893: the directive frame lands late (after content, on the
              // evidence frame), so it usually surfaces just as the turn
              // completes — but render it non-terminally the moment it arrives,
              // never as a stop.
              [{ type: "safety_notice" as const, trigger: a.safetyDirective || null, terminal: false }]
            : []),
        { type: "text" as const, text: a.answer, knownCitationIds: [] },
        // 086 §3: the marker frame is the FIRST thing on a disputed wire, so
        // the in-flight turn can — and must — say it before any content.
        ...(a.identityDisputed ? [{ type: "identity_dispute" as const }] : []),
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
  /** 086 §3: a withheld attribution is part of the parity contract — a
   *  disputed turn that reloads as an ordinary general answer would otherwise
   *  project identically on every other field. Presence only. */
  identityDisputed: boolean;
} {
  const status = msg.lifecycle === "stopped" ? "error" : msg.status;
  return {
    role: msg.role,
    safetyNotice: msg.parts.some((p) => p.type === "safety_notice"),
    identityDisputed: msg.parts.some((p) => p.type === "identity_dispute"),
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
