/**
 * Pure helpers for the Hub shell host (no React, no fetch) — what the host
 * decides is testable without a DOM: which notebook/thread opens first, what
 * the shell's context snapshot says about the machine, which sources a turn is
 * allowed to cite, and what history the canonical route receives.
 */
import type { ShellFixture } from "../../../packages/factorylm-interaction/src";
import type { EquipmentNotebook, NotebookSource } from "@/lib/equipment-notebooks";
import type { PersistedTurn } from "@/components/equipment/notebook-chat-utils";
import { LEGACY_THREAD_ID, machineNameFor, notebookLabel, threadItemId, type HubNotebook } from "./notebook-tree";
import { contextFor, threadFromPersisted, type HubNotebookMeta } from "./to-interaction";

export interface HubSelection {
  readonly notebookId: string;
  /** Server thread id, or `legacy` for the shared pre-THRD-0 conversation. */
  readonly threadId: string;
}

/** First notebook, its most recently updated thread (or the legacy one). */
export function initialSelection(notebooks: readonly HubNotebook[]): HubSelection | null {
  const nb = notebooks[0];
  if (!nb) return null;
  const threads = [...(nb.threads ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { notebookId: nb.id, threadId: threads[0]?.id ?? LEGACY_THREAD_ID };
}

/** The shell's thread id for a selection — same grammar mobile uses. */
export function shellThreadId(sel: HubSelection): string {
  return threadItemId(sel.notebookId, sel.threadId);
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
 *  live exchange. Stopped/errored answers never enter history (STRM-2). */
export function historyRows(rows: readonly PersistedTurn[]): { role: "user" | "assistant"; content: string; status?: "answered" | "insufficient_evidence" | "error"; stopped?: boolean }[] {
  const out: { role: "user" | "assistant"; content: string; status?: "answered" | "insufficient_evidence" | "error"; stopped?: boolean }[] = [];
  for (const row of rows) {
    const stopped = row.answerStatus === "error" && !!row.answerText;
    out.push({ role: "user", content: row.question });
    if (row.answerText && !stopped && row.answerStatus !== "error") {
      out.push({ role: "assistant", content: row.answerText, status: row.answerStatus as "answered" | "insufficient_evidence" });
    }
  }
  return out;
}

/** The first-run line under the greeting: claims only what this notebook can do. */
export function groundingLineFor(nb: EquipmentNotebook | null, enabledCount: number): string | undefined {
  if (!nb) return "Pick a project to ask about its manuals.";
  const label = nb.asset ? machineNameFor(nb) : notebookLabel(nb);
  if (enabledCount === 0) return `${label} has no selected sources yet — answers will abstain rather than guess.`;
  return `Answers cite ${enabledCount} selected source${enabledCount === 1 ? "" : "s"} for ${label}.`;
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
