/**
 * Bench components on the tablet — the pure half (BenchComponents.tsx is the view).
 *
 * The technician picks which component a conversation is about, confirms what
 * its label says, and answers MIRA's Return / Switch / Stay / Confirm offers.
 * Every one of those is a call to the components routes that changes validated
 * server state. None of them writes words into the next question: the chat body
 * only says which component the header showed and the selection version it read
 * (`componentSelection`), and the server checks both.
 */
import type { BenchState } from "@/capabilities/bench-components/http";
import type { ComponentAction, ComponentTurnFrame } from "@/capabilities/bench-components/chat-turn";
import type { ComponentRevision } from "@/capabilities/bench-components/selection";
import type { ComponentView } from "@/capabilities/bench-components/view";
import type { QuestionTarget } from "@factorylm/interaction";
import type { HubSelection } from "./hub-host-logic";
import { LEGACY_THREAD_ID } from "./notebook-tree";

export type { BenchState, ComponentTurnFrame, ComponentAction, ComponentView };

export const WHOLE_MACHINE = "Whole machine — no component selected";

/** The component this conversation is asking about, or null for the whole machine. */
export function selectedComponent(state: BenchState | null): ComponentView | null {
  if (!state?.selection) return null;
  return state.components.find((c) => c.id === state.selection!.componentId) ?? null;
}

/** "Asking about VFD1 · AutomationDirect GS11N-20P2", always shown. */
export function askingAbout(state: BenchState | null): string {
  const c = selectedComponent(state);
  return c ? `Asking about ${c.label}` : WHOLE_MACHINE;
}

/**
 * When the newest answer in this conversation was asked about something other than
 * what the header now says (the picker moved, here or on another screen), say which
 * component that answer was about, so it is never read as guidance for the new one.
 * Null when they agree or nothing was asked yet.
 */
export function lastAnswerNotice(state: BenchState | null): string | null {
  const last = state?.lastTurn;
  if (!state || !last) return null;
  const sel = state.selection;
  if (sel ? last.componentId === sel.componentId && last.revision === sel.revision : last.componentId === null) return null;
  const about = last.componentId ? state.components.find((c) => c.id === last.componentId)?.label ?? "another component" : "the whole machine";
  const sameComponent = sel && last.componentId === sel.componentId;
  return sameComponent
    ? `The last answer above was for ${about} before its identity was corrected.`
    : `The last answer above was about ${about}, not ${sel ? selectedComponent(state)?.label ?? "this component" : "the whole machine"}.`;
}

/**
 * What one chat turn carries: the component the header showed — or the whole machine
 * (componentId null) — and the selection version read with it (null: never selected).
 * #5504 post-cap F9/F10: a whole-machine question says so explicitly, so the server can
 * refuse it when a component is saved instead of answering it as the whole machine.
 */
export type ComponentRider = { notebookId: string; threadId: string; componentId: string | null; selectionVersion: number | null };

export function riderFor(state: BenchState | null, sel: HubSelection | null): ComponentRider | null {
  if (!sel || !state) return null;
  if (!state.selection) return { notebookId: sel.notebookId, threadId: sel.threadId, componentId: null, selectionVersion: state.selectionVersion };
  return { notebookId: sel.notebookId, threadId: sel.threadId, componentId: state.selection.componentId, selectionVersion: state.selection.version };
}

/** The chat body's scope field: the conversation it was read for, and what the header showed. */
export type ScopeField = { threadId: string | null; componentId: string | null; selectionVersion: number | null };

/** One conversation's key, the same one the host's gate and the panel's `key` use. */
export const conversationKey = (sel: HubSelection) => `${sel.notebookId}|${sel.threadId}`;

/**
 * What each conversation's panel last read, by conversation (#5504 post-cap F10): a read
 * that answers after its conversation was left writes only its own entry, so it can never
 * become another conversation's scope. "unavailable" = the checklist answered 404/503.
 */
export type BenchScopes = Map<string, ComponentRider | "unavailable">;

export function recordBenchScope(scopes: BenchScopes, sel: HubSelection, state: BenchState | null): void {
  scopes.set(conversationKey(sel), state ? riderFor(state, sel)! : "unavailable");
}

/**
 * The chat body with this conversation's scope on it, or why it cannot be sent. A body
 * that already carries a scope (a retry of a question that never got an answer) keeps the
 * one it was asked under. A component scopes the turn to its documents, so that turn is
 * never sent in general mode; a whole-machine scope keeps the body's mode.
 */
export function scopedChatBody<B extends object>(
  body: B,
  sel: HubSelection,
  scopes: ReadonlyMap<string, ComponentRider | "unavailable">,
): { ok: true; body: B } | { ok: false; message: string } {
  if ((body as { componentSelection?: ScopeField }).componentSelection) return { ok: true, body };
  const entry = scopes.get(conversationKey(sel));
  if (!entry) return { ok: false, message: SEND_LOADING_MESSAGE };
  if (entry === "unavailable") return { ok: true, body };
  if (entry.notebookId !== sel.notebookId || entry.threadId !== sel.threadId) return { ok: false, message: SEND_LOADING_MESSAGE };
  const componentSelection: ScopeField = {
    threadId: sel.threadId === LEGACY_THREAD_ID ? null : sel.threadId,
    componentId: entry.componentId,
    selectionVersion: entry.selectionVersion,
  };
  if (entry.componentId === null) return { ok: true, body: { ...body, componentSelection } };
  const { mode: _mode, ...rest } = body as B & { mode?: "general" };
  return { ok: true, body: { ...rest, componentSelection } as B };
}

/**
 * Whether this send's answer must name a component before its text is shown: only a scope
 * that names one. An explicit whole-machine scope (`componentId: null`) gets no component
 * frame from the server, so its text streams as it arrives (#5504 F11, #5533).
 */
export function expectsComponentFrame(body: object): boolean {
  const scope = (body as { componentSelection?: ScopeField }).componentSelection;
  return scope !== undefined && scope.componentId !== null;
}

/** The chat route's refusals that mean the scope the send carried is no longer the saved one. */
export function isScopeRefusalCode(code: string | null | undefined): boolean {
  return code === "selection_changed" || code === "component_selection_thread_mismatch";
}

/** The body without its scope, to be scoped again from what the header shows now. */
export function withoutScope<B extends object>(body: B): Omit<B, "componentSelection"> {
  const { componentSelection: _scope, ...rest } = body as B & { componentSelection?: ScopeField };
  return rest;
}

/**
 * A question the server refused because its target was no longer the saved one (another
 * screen moved or cleared the selection). Its retry is re-scoped from what the header shows
 * now — so when that is a different target (another component, or the whole machine), the
 * retry must not go out on its own: the question stays in the box with its attachments, both
 * targets are named, and only a fresh Send asks it about the new one. Same target (only the
 * version moved): retry as before. The server still validates the version on every send.
 */
export type TargetReview = { from: string; to: string };

export function retryTargetCheck(
  refused: ScopeField | undefined,
  current: BenchState | null | undefined,
): { kind: "retry" } | { kind: "loading" } | { kind: "review"; review: TargetReview } {
  if (!refused) return { kind: "retry" };
  if (current === undefined) return { kind: "loading" };
  const now = current?.selection?.componentId ?? null;
  if (now === refused.componentId) return { kind: "retry" };
  const name = (id: string | null) =>
    id === null ? "the whole machine" : current?.components.find((c) => c.id === id)?.label ?? "the component it was asked about";
  return { kind: "review", review: { from: name(refused.componentId), to: name(now) } };
}

/**
 * The held question a fresh Send asks after the review: the refused body (its scope removed,
 * its attachment rider kept), but only when the box still holds that question and no new
 * attachment was added. Anything else is a new question and goes the ordinary way.
 */
export function heldQuestionForSend<B extends object>(
  failed: { body: B; question: string; refusedScope?: ScopeField } | null,
  check: ReturnType<typeof retryTargetCheck> | null,
  text: string,
  newFiles: number,
): B | null {
  if (!failed?.refusedScope || check?.kind !== "review" || newFiles > 0) return null;
  return text.trim() === failed.question.trim() ? failed.body : null;
}

/** Describe which action owns the kept photo, using the composer's send decision. */
export function heldEvidenceNote(
  failed: { body: object; question: string; refusedScope?: ScopeField } | null,
  check: ReturnType<typeof retryTargetCheck> | null,
  composerWillSendRecovery: boolean,
): string | null {
  if (!failed?.refusedScope || check?.kind !== "review") return null;
  if (!("visualEvidence" in failed.body) || !failed.body.visualEvidence) return null;
  return composerWillSendRecovery
    ? `Your photo is kept with this question and goes with the next Send to ${check.review.to}, unless you change the question or attach something new.`
    : "Your photo is kept with the saved question below. Send the saved question to include it.";
}

export function targetReviewMessage(r: TargetReview): string {
  return `This question was asked about ${r.from}. The question target is now ${r.to}. Check the target, then press Send to ask about ${r.to}.`;
}

/**
 * Everything the host's send() decides before it opens the chat request, in order: a
 * change still saving or an unresolved write refuses; an unread conversation refuses;
 * otherwise the body carries this conversation's scope. `forThisGate` is false only for
 * a project just made from home, which has no saved component (the server checks anyway).
 */
export function prepareChatSend<B extends object>(opts: {
  gate: BenchSendGate;
  forThisGate: boolean;
  sel: HubSelection;
  scopes: ReadonlyMap<string, ComponentRider | "unavailable">;
  body: B;
}): { ok: true; body: B } | { ok: false; message: string } {
  if (!opts.forThisGate) return { ok: true, body: opts.body };
  const refused = benchSendRefusal(opts.gate);
  if (refused) return { ok: false, message: refused };
  return scopedChatBody(opts.body, opts.sel, opts.scopes);
}

/** The words on one action button. */
export function actionLabel(a: ComponentAction): string {
  switch (a.action) {
    case "return":
      return `Return to ${a.label}`;
    case "switch":
      return `Ask about ${a.label} instead`;
    case "stay":
      return `Stay on ${a.label}`;
    case "confirm":
      return `Confirm ${a.label}`;
  }
}

/** The selection change an action makes; `confirm` opens the card instead. */
export function selectionChangeFor(a: ComponentAction): { componentId: string; via: "return" | "clarify" } | null {
  if (a.action === "return") return { componentId: a.componentId, via: "return" };
  if (a.action === "switch" || a.action === "stay") return { componentId: a.componentId, via: "clarify" };
  return null;
}

/** Status chip colour: green confirmed, amber needs the technician, grey nothing yet / removed. */
export function statusTone(status: ComponentView["status"]): "ok" | "warn" | "muted" {
  if (status === "confirmed") return "ok";
  if (status === "not_confirmed" || status === "confirmed_no_model") return "warn";
  return "muted";
}

// --- the confirmation card ---

export const CARD_FIELDS = [
  ["manufacturer", "Manufacturer"],
  ["family", "Family / series"],
  ["catalogNumber", "Full catalog number"],
  ["serialNumber", "Serial number"],
  ["hardwareRevision", "Revision"],
  ["localTag", "Local tag"],
] as const;
export type CardField = (typeof CARD_FIELDS)[number][0];

export type Card = {
  componentId: string;
  /** The revision the card was opened on (0 = none). A save against an older one is refused. */
  expectedRevision: number;
  rawLabel: string;
  values: Record<CardField, string>;
  notSure: Record<CardField, boolean>;
};

export function cardFor(c: Pick<ComponentView, "id" | "current">): Card {
  const r: ComponentRevision | null = c.current;
  const values = Object.fromEntries(CARD_FIELDS.map(([f]) => [f, (r?.[f] as string | null) ?? ""])) as Record<CardField, string>;
  const notSure = Object.fromEntries(CARD_FIELDS.map(([f]) => [f, Boolean(r?.unresolved.includes(f))])) as Record<CardField, boolean>;
  return { componentId: c.id, expectedRevision: r?.revision ?? 0, rawLabel: r?.rawLabel ?? "", values, notSure };
}

/** "Retake": back to what the label says, nothing filled in from memory. */
export function retakeCard(card: Card): Card {
  const values = Object.fromEntries(CARD_FIELDS.map(([f]) => [f, ""])) as Record<CardField, string>;
  const notSure = Object.fromEntries(CARD_FIELDS.map(([f]) => [f, false])) as Record<CardField, boolean>;
  return { ...card, rawLabel: "", values, notSure };
}

/** The revisions route body for this card. "Not sure" fields are sent empty and listed. */
export function revisionBodyFor(card: Card, confirm: boolean, threadId: string, clientRequestId: string): Record<string, unknown> {
  const fields = Object.fromEntries(CARD_FIELDS.map(([f]) => [f, card.notSure[f] ? null : card.values[f].trim() || null]));
  return {
    clientRequestId,
    expectedRevision: card.expectedRevision,
    confirm,
    // Sent exactly as typed (the server keeps it verbatim); only an all-blank label is none.
    rawLabel: card.rawLabel.trim() ? card.rawLabel : null,
    inputKind: "typed",
    ...fields,
    unresolved: CARD_FIELDS.map(([f]) => f).filter((f) => card.notSure[f]),
    threadId,
  };
}

/**
 * The request id an Add sends. While the draft is unchanged a second tap sends the
 * same id, so a retry after a lost reply finds the component the first one made
 * instead of adding another; a changed draft gets a new id.
 */
export type AddRequest = { draft: string; id: string };
export function addRequestFor(prev: AddRequest | null, draft: string, newId: () => string): AddRequest {
  return prev && prev.draft === draft ? prev : { draft, id: newId() };
}

/** A save that never reached the server (no reply at all). */
export const CONNECTION_MESSAGE = "That didn't reach the server. Check the connection, then try again.";

/**
 * A save the server answered as committed, followed by a checklist re-read that failed (#5661 A2).
 * The save is reported as what it was; only the list is said to be out of date.
 */
export const savedNotRefreshedMessage = (confirm: boolean): string =>
  `${confirm ? "Confirmed." : "Saved — not confirmed yet."} The component list couldn't be refreshed just now.`;

/** True when nothing on the card says what the component is. */
export const cardIsEmpty = (card: Card) =>
  !card.rawLabel.trim() && CARD_FIELDS.every(([f]) => !card.values[f].trim());

// --- the chat stream's component frame ---

function isComponentFrame(v: unknown): v is ComponentTurnFrame {
  const f = v as Partial<ComponentTurnFrame> | null;
  return Boolean(f && f.kind === "component" && typeof f.componentId === "string" && Array.isArray(f.actions) && Number.isInteger(f.selectionVersion));
}

/** Read the `component` frames out of a tee'd chat stream. Advisory: never throws. */
export async function parseComponentFrames(stream: ReadableStream<Uint8Array>, onFrame: (frame: ComponentTurnFrame) => void): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const handle = (raw: string) => {
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const json = t.slice(5).trim();
      if (!json || json === "[DONE]") continue;
      try {
        const v: unknown = JSON.parse(json);
        if (isComponentFrame(v)) onFrame(v);
      } catch {
        /* not JSON — not ours */
      }
    }
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        handle(buffer.slice(0, idx));
        buffer = buffer.slice(idx + 2);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) handle(buffer);
  } catch {
    /* advisory */
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* already released */
    }
  }
}

/** The plain words for the components routes' refusals. */
export function componentErrorMessage(code: string): string {
  switch (code) {
    case "selection_changed":
      return "The component for this chat was changed on another screen. Check the header and try again.";
    case "component_changed":
      return "This component was changed on another screen. Here is what it says now — check it and save again.";
    case "stale_revision":
      return "This component's record was changed on another screen. Nothing was changed; here is what it says now — check it and ask again.";
    case "component_retired":
      return "That component was removed from the checklist.";
    case "component_not_found":
      return "That component is no longer on this project.";
    case "confirmation_required":
      return "Tap Confirm to confirm what the label says.";
    default:
      return "That couldn't be saved just now. Try again.";
  }
}

/** How many times one change is sent before it is left pending (the first send included). */
export const CHANGE_ATTEMPTS = 3;

export const SEND_BLOCKED_MESSAGE = "Saving the component choice — send again in a moment.";
export const CHANGE_BLOCKED_MESSAGE = "Wait for the answer to finish, then change the component.";
export const SEND_LOADING_MESSAGE = "Reading the component list — send again in a moment.";

/**
 * Sending and changing the component can never overlap (#5504 Codex r2): a question
 * sent while a selection change is still saving would carry the version the header
 * read before it, and a change made while an answer streams would move the header
 * under that answer. One gate per conversation, enforced in the send path and in
 * every component change itself, not only by greying out buttons.
 *
 * A change ends only after the panel has re-read the checklist, so the next send
 * carries the new selection version. Single JS thread: check-and-set is atomic.
 */
export type BenchSendGate = {
  /** A change may start: false while a send is in flight. */
  tryBeginChange(): boolean;
  endChange(): void;
  /** A send may start: false while a change is saving. */
  tryBeginSend(): boolean;
  endSend(): void;
  readonly changing: boolean;
  readonly sending: boolean;
  /**
   * The conversation's component selection has been read, or the checklist is known to
   * be unavailable (#5504 Codex r3 F6). Until then a send would go out as whole-machine
   * even when a component is saved, so it is refused. A failed read leaves this false.
   */
  readonly known: boolean;
  /**
   * #5504 post-cap F9: a component change (selection or identity revision) may have
   * committed even when its reply was lost, so it forgets what was known and bumps the
   * epoch. `readBench` applies and marks known only a read that began under the current epoch.
   */
  invalidate(): void;
  readonly epoch: number;
  markKnown(): void;
  /**
   * #5504 post-cap F9: a selection write whose reply never arrived. Its outcome is unknown
   * (it may still commit), so no checklist read can stand in for it: a GET that answers
   * before the write commits shows the old selection. Until the SAME request (same request
   * id) is sent again and answered, Send stays refused and nothing is marked known.
   */
  readonly pending: (() => Promise<Response>) | null;
  setPending(replay: (() => Promise<Response>) | null): void;
};

export function createBenchSendGate(onStatusChanged?: () => void): BenchSendGate {
  let changes = 0;
  let sends = 0;
  let known = false;
  let epoch = 0;
  let pending: (() => Promise<Response>) | null = null;
  return {
    tryBeginChange() {
      if (sends > 0) return false;
      changes++;
      onStatusChanged?.();
      return true;
    },
    endChange() {
      if (changes === 0) return;
      changes--;
      onStatusChanged?.();
    },
    tryBeginSend() {
      if (changes > 0) return false;
      sends++;
      return true;
    },
    endSend() {
      if (sends > 0) sends--;
    },
    get changing() {
      return changes > 0;
    },
    get sending() {
      return sends > 0;
    },
    get known() {
      return known;
    },
    invalidate() {
      known = false;
      epoch++;
      onStatusChanged?.();
    },
    get epoch() {
      return epoch;
    },
    markKnown() {
      if (known) return;
      known = true;
      onStatusChanged?.();
    },
    get pending() {
      return pending;
    },
    setPending(replay) {
      if (pending === replay) return;
      pending = replay;
      onStatusChanged?.();
    },
  };
}

/** A component change whose reply was lost is being confirmed with the server. */
export const SEND_UNRESOLVED_MESSAGE = "Checking the last component change with the server — send again in a moment.";

/**
 * Send the unresolved write again, exactly as first sent (the same request id, so the
 * server replays its outcome, or applies it once). Only the app's own answer resolves it —
 * saved, replayed, or refused; a lost reply or a gateway/server error leaves it pending.
 */
export async function resolvePendingWrite(gate: BenchSendGate): Promise<boolean> {
  const replay = gate.pending;
  if (!replay) return true;
  let res: Response;
  try {
    res = await replay();
  } catch {
    return false;
  }
  if (!isSettlingResponse(res)) return false;
  if (gate.pending === replay) gate.setPending(null);
  return true;
}

/**
 * Whether a response to a selection write is the app's own answer: saved (2xx) or a definite
 * refusal (4xx, other than timeout / rate limit). A 5xx — a gateway timeout, a proxy error,
 * a server error — says nothing about whether the transaction committed, so the write stays
 * pending (#5504 F13, #5535).
 */
export function isSettlingResponse(res: Response): boolean {
  if (res.ok) return true;
  return res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429;
}

/** Why a send in this gate's conversation cannot start now, or null when it can. */
export function benchSendRefusal(gate: BenchSendGate): string | null {
  if (gate.changing) return SEND_BLOCKED_MESSAGE;
  if (gate.pending) return SEND_UNRESOLVED_MESSAGE;
  if (!gate.known) return SEND_LOADING_MESSAGE;
  return null;
}

/**
 * One checklist read, exactly as the panel runs it. A read that answers hands its state
 * to `apply` (the host builds the next turn's rider from it) and only then marks the
 * selection known; so does 404/503 (the checklist is not available, so no turn carries a
 * component). A failed read marks nothing: the next send is refused, never sent as
 * whole-machine. A read that began before a change (an older epoch) applies nothing and
 * marks nothing: it may predate the change's commit.
 */
export async function readBench(opts: {
  gate: BenchSendGate;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  url: string;
  apply: (state: BenchState | null) => void;
}): Promise<{ kind: "loaded"; state: BenchState } | { kind: "unavailable" } | { kind: "failed" } | { kind: "stale" }> {
  // An unresolved write first (#5504 post-cap F9): this read must not begin before it is settled.
  if (opts.gate.pending && !(await resolvePendingWrite(opts.gate))) return { kind: "failed" };
  const epoch = opts.gate.epoch;
  try {
    const res = await opts.fetch(opts.url, { cache: "no-store" });
    if (opts.gate.epoch !== epoch) return { kind: "stale" };
    if (res.status === 404 || res.status === 503) {
      opts.apply(null);
      opts.gate.markKnown();
      return { kind: "unavailable" };
    }
    if (!res.ok) return { kind: "failed" };
    const state = (await res.json()) as BenchState;
    if (opts.gate.epoch !== epoch) return { kind: "stale" };
    opts.apply(state);
    opts.gate.markKnown();
    return { kind: "loaded", state };
  } catch {
    return { kind: "failed" };
  }
}

/**
 * After a component change settles — answered, refused or lost on the network — forget
 * what was known (the change may have committed) and re-read. True only when that read
 * succeeded; otherwise Send stays refused until a later read does (#5504 post-cap F9).
 */
export async function reconcileBench(gate: BenchSendGate, load: () => Promise<unknown>): Promise<boolean> {
  gate.invalidate();
  try {
    await load();
  } catch {
    /* the gate stays unknown */
  }
  return gate.known;
}

/**
 * One selection change (picker, Return, Switch, Stay, clarify, confirm), exactly as the
 * panel runs it: refused while a send is in flight, and the gate is released only after
 * the checklist has been re-read (`load`), so the next send carries the new version. A
 * lost reply or a failed re-read is reported as a failure and leaves Send refused.
 */
export async function changeSelection(opts: {
  gate: BenchSendGate;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  url: string;
  body: { threadId: string; componentId: string | null; via: string; expectedVersion: number | null; expectedRevision?: number; clientRequestId: string };
  load: () => Promise<unknown>;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!opts.gate.tryBeginChange()) return { ok: false, message: CHANGE_BLOCKED_MESSAGE };
  try {
    // An earlier change whose reply was lost is settled first: this one must not race it.
    if (opts.gate.pending && !(await resolvePendingWrite(opts.gate))) return { ok: false, message: CONNECTION_MESSAGE };
    let refused: string | null = null;
    const init: RequestInit = {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts.body),
    };
    const send = () => opts.fetch(opts.url, init);
    let res: Response | null = null;
    // #5504 post-cap F9: a lost reply is answered only by the same request (same request id):
    // the server returns what that request did. A checklist read cannot tell "not committed
    // yet" from "never will", so it never settles the write.
    // A 5xx (gateway timeout, proxy error) is not that answer either (#5504 F13): send again.
    for (let attempt = 0; attempt < CHANGE_ATTEMPTS && !res; attempt++) {
      try {
        const answer = await send();
        res = isSettlingResponse(answer) ? answer : null;
      } catch {
        res = null;
      }
    }
    if (!res) {
      opts.gate.invalidate();
      opts.gate.setPending(send);
      return { ok: false, message: CONNECTION_MESSAGE };
    }
    if (!res.ok) {
      let code = "";
      try {
        code = String(((await res.json()) as { error?: unknown }).error ?? "");
      } catch {
        /* no JSON body */
      }
      refused = componentErrorMessage(code);
    }
    const read = await reconcileBench(opts.gate, opts.load);
    if (refused) return { ok: false, message: refused };
    if (!read) return { ok: false, message: CONNECTION_MESSAGE };
    return { ok: true };
  } finally {
    opts.gate.endChange();
  }
}

/**
 * What the checklist does with a component the equipment navigator found (hub-host
 * `pickRouteFor`). It is shown once: the checklist opens on it and the technician selects it
 * there. Nothing is written here. A read that failed, a missing checklist or a component not
 * (or no longer) in it ends the hand-off with a reason, so it is never applied later.
 *
 * The server has just resolved the component, so a checklist read earlier may simply predate it
 * (#5625 r3 F13), and a read that failed earlier may have been transient (r4 F16): each hand-off
 * gets one fresh read ("refresh") before it is reported missing or failed. An open label editor
 * is never closed for it (r4 F14): the hand-off waits until the technician saves or cancels.
 */
export function focusStep(
  focus: { componentId: string; token: number } | null,
  consumed: ReadonlySet<number>,
  state: { bench: BenchState | null; available: boolean; readFailed: boolean; reread: boolean; editing: boolean },
): "none" | "wait" | "unavailable" | "failed" | "refresh" | "missing" | "show" {
  if (!focus || consumed.has(focus.token)) return "none";
  if (!state.available) return "unavailable";
  if (state.editing) return "wait";
  if (state.readFailed) return state.reread ? "failed" : "refresh";
  if (!state.bench) return "wait";
  const c = state.bench.components.find((x) => x.id === focus.componentId);
  if (c && c.status !== "retired") return "show";
  return state.reread ? "missing" : "refresh";
}

// ---------------------------------------------------------------------------
// The repeated-serial warning (#5649). A confirmed save's reply may say the same serial
// number is already on other components of this tenant. Warning only: the save is committed
// before the check runs, nothing is blocked, changed or merged, and the serial number itself
// is never read, kept or shown here.
// ---------------------------------------------------------------------------

/** One other component that carries the serial number just confirmed. */
export type SameSerialMatch = {
  componentId: string;
  notebookId: string;
  notebookName: string;
  label: string;
  /** Removed from its checklist: named, but there is no row to show. */
  retired: boolean;
  /** In the checklist that is open (the notebook of the component just saved). */
  here: boolean;
};

export type SameSerialNotice = (
  | { kind: "matches"; componentId: string; matches: SameSerialMatch[]; more: boolean }
  /** The check failed or its result could not be read: not the same as "no match". */
  | { kind: "not_run"; componentId: string }
) & {
  /** The revision the save made, when its reply says so. The notice is about that revision only (#5656). */
  revision?: number;
};

/** As many as the server lists (same-serial.ts SAME_SERIAL_LIMIT; a test pins the two equal). */
export const SAME_SERIAL_SHOWN = 10;
/** How long a save waits for its own reply body before it is reported without the check's result. */
export const SAME_SERIAL_READ_MS = 3000;

const SERIAL_MATCH_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const plainObject = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/**
 * What to tell the technician about the `sameSerial` field of a save reply (revisions route).
 * Null = say nothing: not a confirmed save, no usable serial, no match, or a server that does
 * not send the field. Only the named fields are carried; anything else in the reply is dropped.
 * An entry that is not a readable match is never shown as given: it counts toward "more".
 */
export function sameSerialNotice(reply: unknown, saved: { notebookId: string; componentId: string }): SameSerialNotice | null {
  const advisory = plainObject(plainObject(reply)?.sameSerial);
  if (!advisory) return null;
  const made = plainObject(plainObject(reply)?.current)?.revision;
  const revision = typeof made === "number" && Number.isInteger(made) && made > 0 ? { revision: made } : {};
  const notRun: SameSerialNotice = { kind: "not_run", componentId: saved.componentId, ...revision };
  if (advisory.status === "not_checked") return advisory.reason === "lookup_failed" ? notRun : null;
  if (advisory.status !== "checked") return null;
  if (!Array.isArray(advisory.candidates)) return notRun;

  const matches: SameSerialMatch[] = [];
  const seen = new Set([saved.componentId.toLowerCase()]);
  let unreadable = 0;
  for (const entry of advisory.candidates) {
    const c = plainObject(entry);
    if (
      !c || typeof c.componentId !== "string" || !SERIAL_MATCH_ID.test(c.componentId)
      || typeof c.notebookId !== "string" || !SERIAL_MATCH_ID.test(c.notebookId)
      || typeof c.label !== "string" || typeof c.notebookName !== "string" || typeof c.retired !== "boolean"
    ) {
      unreadable += 1;
      continue;
    }
    const id = c.componentId.toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    matches.push({
      componentId: c.componentId,
      notebookId: c.notebookId,
      notebookName: c.notebookName.trim() || "another machine",
      label: c.label.trim() || "A component",
      retired: c.retired,
      here: c.notebookId.toLowerCase() === saved.notebookId.toLowerCase(),
    });
  }
  if (matches.length === 0) return unreadable > 0 ? notRun : null;
  return {
    kind: "matches",
    componentId: saved.componentId,
    matches: matches.slice(0, SAME_SERIAL_SHOWN),
    more: advisory.truncated === true || unreadable > 0 || matches.length > SAME_SERIAL_SHOWN,
    ...revision,
  };
}

/**
 * False once the checklist holds a later revision of the saved component than the one the notice was
 * made for (#5656): it was corrected again, here or on another screen, so the label the checklist now
 * shows is not the one whose serial number was checked. A checklist that is older, has no such row,
 * or a notice whose reply named no revision leaves the notice standing.
 */
export function sameSerialNoticeCurrent(notice: SameSerialNotice, bench: BenchState | null): boolean {
  if (notice.revision === undefined) return true;
  const now = bench?.components.find((c) => c.id === notice.componentId)?.current?.revision;
  return typeof now !== "number" || now <= notice.revision;
}

/**
 * Reads a save reply for `sameSerialNotice`. It never throws and never waits past `timeoutMs`:
 * the save is already committed, so a body that is missing, malformed or slow can only cost
 * the warning, never the save's own result.
 */
export async function readSameSerialNotice(
  res: { json: () => Promise<unknown> },
  saved: { notebookId: string; componentId: string },
  timeoutMs: number = SAME_SERIAL_READ_MS,
): Promise<SameSerialNotice | null> {
  const notRun: SameSerialNotice = { kind: "not_run", componentId: saved.componentId };
  const gaveUp = Symbol("gave up");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const body = Promise.resolve().then(() => res.json());
    body.catch(() => undefined); // a body that fails after the wait is over is not an unhandled error
    const reply = await Promise.race([
      body,
      new Promise<typeof gaveUp>((resolve) => {
        timer = setTimeout(() => resolve(gaveUp), timeoutMs);
      }),
    ]);
    return reply === gaveUp ? notRun : sameSerialNotice(reply, saved);
  } catch {
    return notRun;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

const NOT_READ_YET = Symbol("not read yet");

/**
 * Hands a save's notice to `show`: at once when its reply has already been read, otherwise when it
 * has been. Either way this returns without waiting for a reply still on its way, so the save's own
 * result and the send gate are never held back by the check.
 */
export async function reportSameSerial(
  notice: Promise<SameSerialNotice | null>,
  show: (notice: SameSerialNotice | null) => void,
): Promise<void> {
  let first: SameSerialNotice | null | typeof NOT_READ_YET;
  try {
    // A promise that has already settled wins this race; one that has not loses it to the marker.
    first = await Promise.race([notice, Promise.resolve(NOT_READ_YET)]);
  } catch {
    return; // readSameSerialNotice never rejects; a notice that does is one there is nothing to show for
  }
  if (first === NOT_READ_YET) void notice.then(show, () => undefined);
  else show(first);
}

const matchButtonWords = (m: SameSerialMatch): string =>
  m.here ? `Show in checklist: ${m.label}` : `Open ${m.notebookName} in a new chat: ${m.label}`;

/**
 * The spoken name of a match's button. Matches that would be named alike (the same label in the same
 * machine, which is what one unit entered twice looks like) also get their place among them, so a
 * screen reader can tell their buttons apart. A removed component has no button and is not counted.
 */
export function sameSerialButtonName(matches: readonly SameSerialMatch[], match: SameSerialMatch): string {
  const place = sameSerialPlace(matches, match);
  return place ? `${matchButtonWords(match)} (${place})` : matchButtonWords(match);
}

/**
 * "1 of 2" for a match that reads like another one in the list, null for one that reads like no other.
 * The row shows it and the button's name carries it, so the eye and a screen reader tell them apart
 * the same way (#5661 A1).
 */
export function sameSerialPlace(matches: readonly SameSerialMatch[], match: SameSerialMatch): string | null {
  if (match.retired) return null;
  const name = matchButtonWords(match);
  const alike = matches.filter((m) => !m.retired && matchButtonWords(m) === name);
  return alike.length > 1 ? `${alike.indexOf(match) + 1} of ${alike.length}` : null;
}

/**
 * A match as the equipment navigator's question target (#5625), so opening one goes through the
 * same hand-off as Find equipment (hub-host `pickRouteFor` / `openOffer`). The machine is its notebook.
 */
export function sameSerialTarget(match: SameSerialMatch): QuestionTarget {
  return { machineId: match.notebookId, machineLabel: match.notebookName, componentId: match.componentId, componentLabel: match.label, location: "" };
}
