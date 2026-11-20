import type { TurnRecovery } from "@/capabilities/turn-recovery/contract";

export type RecoveryPointer = { notebookId: string; threadId: string; requestId: string; question: string };
export const recoveryPointerKey = (userId: string, notebookId: string, threadId: string) =>
  `factorylm:pending-turn:${encodeURIComponent(userId)}:${encodeURIComponent(notebookId)}:${encodeURIComponent(threadId)}`;

/** Only a pointer and the unsent/recovering question live here. The server owns
 * the original body, photos, target, execution lease and terminal answer. */
export function readRecoveryPointer(storage: Pick<Storage, "getItem">, key: string): RecoveryPointer | null {
  try {
    const p = JSON.parse(storage.getItem(key) ?? "null");
    return p && ["notebookId", "threadId", "requestId", "question"].every(k => typeof p[k] === "string")
      && p.question.length <= 4000 ? p : null;
  } catch { return null; }
}

export function draftAfterSendFailed(origin: "composer" | "retry", draft: string, question: string): string | null {
  return origin === "composer" && (draft === "" || draft.trim() === question.trim()) ? question : null;
}

export function recoveryMatchesTarget(value: TurnRecovery, equipment: string | null | undefined, component: string | null | undefined): boolean {
  return value.canRetry && value.target.kind === "known" && value.target.equipmentEntityId === equipment
    && component !== undefined && (value.component?.componentId ?? value.componentSelection?.componentId ?? null) === component;
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
