/**
 * Pure helpers for the Hub shell host (no React, no fetch) — what the host
 * decides is testable without a DOM: which notebook/thread opens first, what
 * the shell's context snapshot says about the machine, which sources a turn is
 * allowed to cite, and what history the canonical route receives.
 */
import type { ShellFixture } from "../../../packages/factorylm-interaction/src";
import type { EquipmentNotebook, NotebookSource } from "@/lib/equipment-notebooks";
import { buildChatBody, isAbortError, type ChatBody, type PersistedTurn, type StreamResult } from "@/components/equipment/notebook-chat-utils";
import { isSafetyNoticeEntry } from "@/lib/notebook-chat-types";
import { LEGACY_THREAD_ID, machineNameFor, notebookLabel, threadItemId, type HubNotebook } from "./notebook-tree";
import { contextFor, hasTerminalSafetyStop, threadFromPersisted, type HubNotebookMeta } from "./to-interaction";

export interface HubSelection {
  readonly notebookId: string;
  /** Server thread id, or `legacy` for the shared pre-THRD-0 conversation. */
  readonly threadId: string;
}

/** StreamResult before/after #3854 (which makes statusMessage explicit). */
export type CompatibleStreamResult = StreamResult & { statusMessage?: string | null };

/**
 * Sanitize a throwing stream abort into the only state a stopped shell turn
 * may retain: partial text plus an already-received authoritative Safety STOP.
 * Every evidence claim is reset explicitly.
 */
export function stoppedStreamResult(err: unknown): CompatibleStreamResult {
  const interrupted = err && typeof err === "object" ? err as Record<string, unknown> : {};
  return {
    content: typeof interrupted.partial === "string" ? interrupted.partial : "",
    citations: [],
    status: "error",
    statusMessage: null,
    basis: null,
    followups: [],
    machineEvidence: null,
    visualEvidence: null,
    safetyNotice: isSafetyNoticeEntry(interrupted.safetyNotice) ? interrupted.safetyNotice : null,
    // An interrupted stream keeps no evidence claim; the directive rides the
    // evidence frame, so it is not carried through a throwing abort (#3841).
    hazardNotice: null,
    sawStatus: false,
  };
}

/** Decide whether a throwing stream interruption contains state the live turn
 *  must retain. User aborts remain `stopped`; a network failure is retained
 *  only when it carries an authoritative safety warning and stays `failed`. */
export function retainedStreamInterruption(
  err: unknown,
): { result: CompatibleStreamResult; stopped: boolean } | null {
  const result = stoppedStreamResult(err);
  const stopped = isAbortError(err);
  return stopped || result.safetyNotice ? { result, stopped } : null;
}

/** First notebook, its most recently updated thread (or the legacy one). */
export function initialSelection(notebooks: readonly HubNotebook[]): HubSelection | null {
  const nb = notebooks[0];
  if (!nb) return null;
  const threads = [...(nb.threads ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { notebookId: nb.id, threadId: threads[0]?.id ?? LEGACY_THREAD_ID };
}

/**
 * Where a fresh mount lands: HOME — no notebook, composer enabled. The 2026-09-07
 * stranger walk recorded "cold launch drops into the last thread" as a failure;
 * the ChatGPT-first lock's L0 is a composer home that answers immediately.
 * `initialSelection` remains the deep-link / project-click entry.
 */
export function landingSelection(notebooks: readonly HubNotebook[]): HubSelection | null {
  void notebooks; // HOME regardless of how many projects exist
  return null;
}

export type HomeSendPlan =
  | { kind: "loading" }
  | { kind: "existing"; notebookId: string }
  | { kind: "create"; body: { displayName: string; identitySourceType: "user" } };

/** A notebook with no machine behind it: no canonical binding and no
 *  manufacturer/model identity. Only such a notebook may host a HOME question,
 *  because the canonical route's general-mode prompt still appends the
 *  notebook's machine context (equipment, asset path, loaded documents). */
export function isUnboundNotebook(nb: Pick<HubNotebook, "asset" | "manufacturer" | "model">): boolean {
  return !nb.asset && !(nb.manufacturer ?? "").trim() && !(nb.model ?? "").trim();
}

/**
 * A HOME send is a new thread in an UNBOUND notebook, so the answer is truly
 * general: the list is ordered by last opened, so `notebooks[0]` would be the
 * machine notebook the technician was just in, and its identity would ride the
 * turn as machine context (alpha-remote #3875 F1). With no unbound notebook it
 * creates one ("General") through the exact body the legacy New-notebook
 * button posts. Until the list has loaded it must NOT send (F2): the Composer's
 * throw-keeps-the-draft contract covers that case; a send before the list is
 * known would create a duplicate "General".
 */
export function homeSendPlan(notebooks: readonly HubNotebook[] | null): HomeSendPlan {
  if (!notebooks) return { kind: "loading" };
  const unbound = notebooks.filter(isUnboundNotebook);
  // A notebook's NAME is machine context too ("Conveyor 4" colours the answer),
  // so the one literally called General wins; any other unbound one is next.
  const general = unbound.find((nb) => nb.displayName.trim().toLowerCase() === "general") ?? unbound[0];
  if (general) return { kind: "existing", notebookId: general.id };
  return { kind: "create", body: { displayName: "General", identitySourceType: "user" } };
}

/**
 * Addressable conversations (#3922): `/v3?notebook=<id>&thread=<id>` names ONE
 * persisted thread, bound or unbound — the same server ids the classic notebook
 * and the mobile adapter use, so a link copied from either resolves here. The
 * query-string form keeps the route at `src/app/v3/page.tsx` untouched.
 */
export const NOTEBOOK_PARAM = "notebook";
export const THREAD_PARAM = "thread";
/** The server's thread-id grammar (`normalizeNotebookThreadId`) plus the legacy marker. */
const THREAD_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;

/**
 * The selection a URL names, or null for HOME. Unknown notebook → HOME (never a
 * guess at another project); a notebook without a thread → its most recent
 * thread (`initialSelection`); a malformed thread id → the same fallback. A
 * well-formed thread id that is not (yet) in the list is kept: a fresh "New
 * chat" has no server row until its first turn, and a reload must return to it.
 */
export function selectionFromSearch(search: string, notebooks: readonly HubNotebook[]): HubSelection | null {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const notebookId = (params.get(NOTEBOOK_PARAM) ?? "").trim();
  if (!notebookId) return null;
  const nb = notebooks.find((n) => n.id === notebookId);
  if (!nb) return null;
  const threadId = (params.get(THREAD_PARAM) ?? "").trim();
  if (!threadId || (threadId !== LEGACY_THREAD_ID && !THREAD_ID_RE.test(threadId))) return initialSelection([nb]);
  return { notebookId, threadId };
}

/** The query string for a selection; HOME is the bare route. */
export function searchForSelection(sel: HubSelection | null): string {
  if (!sel) return "";
  const params = new URLSearchParams();
  params.set(NOTEBOOK_PARAM, sel.notebookId);
  params.set(THREAD_PARAM, sel.threadId);
  return `?${params.toString()}`;
}

/** The shell's thread id for a selection — same grammar mobile uses. */
export function shellThreadId(sel: HubSelection): string {
  return threadItemId(sel.notebookId, sel.threadId);
}

/**
 * The notebook-detail query for a selection. ALWAYS names the thread — including
 * the legacy one as `?threadId=legacy` (Codex #3839 review): the GET route treats
 * an OMITTED threadId as "no thread predicate" and returns every thread's turns,
 * whereas an explicit `legacy` is what selects `thread_id IS NULL`. Omitting it
 * for the legacy selection hydrated the viewer's named-thread turns into the
 * legacy conversation and then forwarded that mixed history on the next send.
 */
export function detailQueryFor(sel: HubSelection): string {
  return `?threadId=${encodeURIComponent(sel.threadId)}`;
}

/** Server-owned identity → shell meta. `identityConfirmed` is true only when the
 *  notebook's identity is user-confirmed/verified AND the binding is confirmed. */
export function metaFor(nb: EquipmentNotebook, sel: HubSelection, tenantId: string | null, capturedAt: string): HubNotebookMeta {
  const asset = nb.asset
    ? { id: nb.asset.entityId, name: machineNameFor(nb), unsPath: null }
    : null;
  const confirmed = (nb.identityStatus === "user_confirmed" || nb.identityStatus === "verified") && !!nb.asset?.confirmedAt;
  return {
    notebookId: nb.id,
    threadId: shellThreadId(sel),
    title: notebookLabel(nb),
    tenantId,
    asset,
    identityConfirmed: confirmed,
    capturedAt,
  };
}

/** Which sources a turn may cite: enabled by default and not rejected — the
 *  classic notebook's rule, unchanged. */
export function enabledDocIds(sources: readonly Pick<NotebookSource, "docId" | "enabledByDefault" | "matchState">[]): string[] {
  return sources.filter((s) => s.enabledByDefault && s.matchState !== "rejected").map((s) => s.docId);
}

/** Multi-turn memory for the route: persisted rows first, then any completed
 *  live exchange. Stopped/errored answers never enter history (STRM-2), and
 *  neither does a TERMINAL safety refusal's text (Codex #3839 round 2 F2): the
 *  server persists a hard stop as answerStatus "answered" with the refusal
 *  sentence as its text, but that sentence was never an answer and must not
 *  steer retrieval or the model on the next turn. A directive-framed answer
 *  (energized-electrical) is a real answer and stays. The question is kept in
 *  both cases so the thread's shape is preserved. */
export function historyRows(rows: readonly PersistedTurn[]): { role: "user" | "assistant"; content: string; status?: "answered" | "insufficient_evidence" | "error"; stopped?: boolean }[] {
  const out: { role: "user" | "assistant"; content: string; status?: "answered" | "insufficient_evidence" | "error"; stopped?: boolean }[] = [];
  for (const row of rows) {
    const stopped = row.answerStatus === "error" && !!row.answerText;
    out.push({ role: "user", content: row.question });
    if (hasTerminalSafetyStop(row.evidence)) continue;
    if (row.answerText && !stopped && row.answerStatus !== "error") {
      out.push({ role: "assistant", content: row.answerText, status: row.answerStatus as "answered" | "insufficient_evidence" });
    }
  }
  return out;
}

/** The first-run line under the greeting: claims only what this notebook can do. */
export function groundingLineFor(nb: EquipmentNotebook | null, enabledCount: number): string | undefined {
  if (!nb) return "General question — answered from general knowledge, nothing cited. Pick a project to ask about its manuals.";
  const label = nb.asset ? machineNameFor(nb) : notebookLabel(nb);
  if (enabledCount === 0) return `${label} has no selected sources yet — general help only, nothing is cited.`;
  return `Answers cite ${enabledCount} selected source${enabledCount === 1 ? "" : "s"} for ${label}.`;
}

/** The Composer's contract: a hook that THROWS keeps the draft and shows this text. */
export const NO_PROJECT_ERROR = "Still loading your projects — try again in a moment.";

/**
 * The canonical route's request body for one send. With no enabled sources the
 * turn is sent in `mode: "general"` — the only mode in which the route serves a
 * zero-source question (PRD law 6: general help is always available; Codex
 * #3839 Spec P1). With sources it is the ordinary cited turn.
 */
export function chatBodyFor(
  question: string,
  docIds: readonly string[],
  history: ReturnType<typeof historyRows>,
  sel: HubSelection,
  rider?: { visualEvidence?: { fileId: string; capturedAt: string } },
): ChatBody & { threadId: string | null; mode?: "general"; visualEvidence?: { fileId: string; capturedAt: string } } {
  const base = buildChatBody(question, [...docIds], history);
  const visual = rider?.visualEvidence;
  return {
    ...base,
    threadId: sel.threadId === LEGACY_THREAD_ID ? null : sel.threadId,
    // #4019: a photo turn is served on its visual claim (like mobile), so it is
    // never forced into general mode, which would switch notebook retrieval off.
    ...(docIds.length === 0 && !visual ? { mode: "general" as const } : {}),
    ...(visual ? { visualEvidence: visual } : {}),
  };
}

/**
 * The route's error codes in plain language — every code the route can return
 * (`chat/route.ts`), never a bare status. Unknown codes get the generic line.
 */
export function errorMessageFor(code: string, status: number): string {
  switch (code) {
    case "no_sources_selected":
      return "This notebook has no selected sources yet. Add a manual to it, then ask.";
    case "approved_context":
      return "MIRA needs approved context for this machine before it will answer.";
    case "notebook_not_found":
      return "That notebook is gone. Pick another project.";
    case "message_too_long":
      return "That question is too long. Shorten it and ask again.";
    case "message_required":
      return "Type a question before sending.";
    case "invalid_thread_id":
      return "This conversation can't be reached. Start a new chat and ask again.";
    case "machine_evidence_invalid":
      return "The machine evidence attached to this question was not valid. Ask again without it.";
    case "invalid_json":
      return "The question could not be sent. Try again.";
    default:
      return status === 412
        ? "MIRA needs approved context for this machine before it will answer."
        : "MIRA couldn't answer that just now.";
  }
}

/** The initial shell fixture for a hydrated notebook. */
export function fixtureFor(
  nb: EquipmentNotebook,
  sel: HubSelection,
  rows: readonly (PersistedTurn & { createdAt?: string })[],
  meta: HubNotebookMeta,
  projects: ShellFixture["projects"],
  machines: ShellFixture["machines"],
): ShellFixture {
  return {
    id: `hub-${nb.id}`,
    title: notebookLabel(nb),
    review: { themes: ["light", "dark"], viewports: ["desktop", "tablet", "mobile"], surfaces: ["hub"] },
    thread: threadFromPersisted(rows, meta),
    projects,
    machines,
    activeContext: contextFor(meta),
    offline: { state: "online", pendingChanges: 0 },
  };
}

/**
 * Latest-request gate for an async load whose result must only be committed if
 * it still belongs to the CURRENT selection (Codex #3839 F3). Select A, select
 * B, B resolves, then A resolves late: without this, A's detail would land
 * under B's selection and a send could post B's thread with A's sources and
 * history. `begin()` mints a token for a new load; `invalidate()` retires every
 * outstanding token (on selection change / unmount); `isCurrent(token)` is the
 * commit check. Pure, so the race is testable without mounting the host.
 */
export interface LatestRequestGate {
  begin(): number;
  invalidate(): void;
  isCurrent(token: number): boolean;
}

export function latestRequestGate(): LatestRequestGate {
  let current = 0;
  return {
    begin: () => ++current,
    invalidate: () => { current++; },
    isCurrent: (token) => token === current,
  };
}

/** A fresh client-minted thread id for "New chat" (server accepts [A-Za-z0-9][A-Za-z0-9._:-]{0,119}). */
export function newThreadId(random: () => string = () => globalThis.crypto.randomUUID()): string {
  return random().replace(/[^A-Za-z0-9._:-]/g, "").slice(0, 120) || `t${Date.now()}`;
}
