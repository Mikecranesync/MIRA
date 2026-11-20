import type { TurnRecovery } from "@/capabilities/turn-recovery/contract";
import { sameNotebookIdentity } from "@/capabilities/turn-recovery/accepted-context";
import type { EquipmentNotebook } from "@/lib/equipment-notebooks";

export type RecoveryPointer = { notebookId: string; threadId: string; requestId: string; question: string };
export const recoveryPointerKey = (userId: string, notebookId: string, threadId: string, requestId?: string) =>
  `factorylm:pending-turn:${encodeURIComponent(userId)}:${encodeURIComponent(notebookId)}:${encodeURIComponent(threadId)}${requestId ? `:${encodeURIComponent(requestId)}` : ""}`;

/** Only a pointer and the unsent/recovering question live here. The server owns
 * the original body, photos, target, execution lease and terminal answer. */
export function readRecoveryPointer(storage: Pick<Storage, "getItem">, key: string): RecoveryPointer | null {
  try {
    const p = JSON.parse(storage.getItem(key) ?? "null");
    return p && ["notebookId", "threadId", "requestId", "question"].every(k => typeof p[k] === "string")
      && p.question.length <= 4000 ? p : null;
  } catch { return null; }
}

/** Keep the legacy singleton until its request-keyed replacement is verified.
 * A later question never overwrites any other unresolved request. */
export function readRecoveryPointers(storage: Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">, actor: string, notebookId: string, threadId: string): RecoveryPointer[] {
  const legacyKey = recoveryPointerKey(actor, notebookId, threadId);
  const pointers = new Map<string, RecoveryPointer>();
  const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i));
  for (const key of keys) {
    if (!key || (key !== legacyKey && !key.startsWith(`${legacyKey}:`))) continue;
    const pointer = readRecoveryPointer(storage, key);
    if (!pointer || pointer.notebookId !== notebookId || pointer.threadId !== threadId || !pointer.requestId) continue;
    const canonical = recoveryPointerKey(actor, notebookId, threadId, pointer.requestId);
    if (key !== legacyKey && key !== canonical) continue;
    pointers.set(pointer.requestId, pointer);
    if (key === legacyKey) try {
      storage.setItem(canonical, JSON.stringify(pointer));
      if (readRecoveryPointer(storage, canonical)?.requestId === pointer.requestId) storage.removeItem(legacyKey);
    } catch { /* the legacy copy remains discoverable */ }
  }
  return [...pointers.values()];
}

export function removeRecoveryPointer(storage: Pick<Storage, "getItem" | "removeItem">, actor: string, pointer: RecoveryPointer) {
  for (const key of [recoveryPointerKey(actor, pointer.notebookId, pointer.threadId, pointer.requestId), recoveryPointerKey(actor, pointer.notebookId, pointer.threadId)]) {
    if (readRecoveryPointer(storage, key)?.requestId === pointer.requestId) storage.removeItem(key);
  }
}

export function draftAfterSendFailed(origin: "composer" | "retry", draft: string, question: string): string | null {
  return origin === "composer" && (draft === "" || draft.trim() === question.trim()) ? question : null;
}

export function recoveryMatchesTarget(value: TurnRecovery, equipment: string | null | undefined, component: string | null | undefined, notebook?: Partial<EquipmentNotebook>): boolean {
  return value.canRetry && value.target.kind === "known" && value.target.equipmentEntityId === equipment
    && component !== undefined && (value.component?.componentId ?? value.componentSelection?.componentId ?? null) === component
    && sameNotebookIdentity(value.originalNotebookIdentity, notebook);
}

export type RecoveryObservation = { pointer: RecoveryPointer; value: TurnRecovery | null; unavailable?: boolean };
/** Round-robin GETs, one in flight across the conversation. Settling B removes
 * only B; A remains observed until its own terminal row or explicit retry. */
export function followTurnRecoveries(pointers: readonly RecoveryPointer[], deps: {
  read: (pointer: RecoveryPointer, signal: AbortSignal) => Promise<TurnRecovery | null>;
  observe: (observation: RecoveryObservation) => void;
  terminal: (pointer: RecoveryPointer, value: TurnRecovery, signal: AbortSignal) => Promise<boolean | void>;
  delayMs?: number; maxWaitMs?: number;
}): () => void {
  const controller = new AbortController(), pending = [...pointers];
  const deadline = Date.now() + (deps.maxWaitMs ?? 10 * 60 * 1000);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tick = async () => {
    const pointer = pending.shift();
    if (!pointer || controller.signal.aborted) return;
    let keep = true, value: TurnRecovery | null = null;
    try {
      value = await deps.read(pointer, controller.signal);
      if (controller.signal.aborted) return;
      deps.observe({ pointer, value });
      if (value?.state === "complete" && await deps.terminal(pointer, value, controller.signal) !== false) keep = false;
      if (value?.state === "interrupted") keep = false;
    } catch { if (controller.signal.aborted) return; }
    if (controller.signal.aborted) return;
    if (keep && Date.now() >= deadline) deps.observe({ pointer, value, unavailable: true });
    else if (keep) pending.push(pointer);
    if (pending.length) timer = setTimeout(() => void tick(), deps.delayMs ?? 2000);
  };
  void tick();
  return () => { controller.abort(); if (timer !== undefined) clearTimeout(timer); };
}

/** One read at a time. A replacement or navigation aborts both the timer and
 * current HTTP request; a late response cannot update another conversation. */
export function followTurnRecovery(
  pointer: RecoveryPointer,
  deps: {
    read: (pointer: RecoveryPointer, signal: AbortSignal) => Promise<TurnRecovery | null>;
    observe: (value: TurnRecovery | null) => void;
    terminal: (value: TurnRecovery) => Promise<boolean | void>;
    unavailable?: () => void;
    delayMs?: number;
    maxWaitMs?: number;
  },
): () => void {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = Date.now() + (deps.maxWaitMs ?? 10 * 60 * 1000);
  const tick = async () => {
    try {
      const value = await deps.read(pointer, controller.signal);
      if (controller.signal.aborted) return;
      deps.observe(value);
      if (value?.state === "complete" && await deps.terminal(value) !== false) return;
      // Interrupted remains visible for an explicit Retry. It never submits.
      if (value?.state === "interrupted") return;
    } catch { if (controller.signal.aborted) return; }
    if (Date.now() >= deadline) { if (!controller.signal.aborted) deps.unavailable?.(); return; }
    if (!controller.signal.aborted) timer = setTimeout(() => void tick(), deps.delayMs ?? 2000);
  };
  void tick();
  return () => { controller.abort(); if (timer !== undefined) clearTimeout(timer); };
}
