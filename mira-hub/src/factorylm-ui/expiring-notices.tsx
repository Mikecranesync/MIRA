"use client";
/**
 * Confirmations that clear themselves (#5488 follow-up).
 *
 * The notebook actions column floats over the conversation, so a line that
 * says "done" must not stay there: on staging a "now used" line covered the
 * next answer until the technician left the project. A notice lives for
 * NOTICE_MS, or until dismissed. What lasts is the screen's own state (the
 * line above the chat, the citation on the answer), never the notice.
 *
 * The rules are pure and take the clock as an argument; the hook only holds
 * the list and one timer for the next expiry.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";

export type Notice = { id: string; text: string; until: number };
export const NOTICE_MS = 8000;

export function addNotice(list: ReadonlyArray<Notice>, n: { id: string; text: string }, now: number): Notice[] {
  return [...list.filter((x) => x.id !== n.id), { id: n.id, text: n.text, until: now + NOTICE_MS }];
}
export function liveNotices(list: ReadonlyArray<Notice>, now: number): Notice[] {
  return list.filter((n) => n.until > now);
}
export function dropNotice(list: ReadonlyArray<Notice>, id: string): Notice[] {
  return list.filter((n) => n.id !== id);
}
/** When the earliest live notice ends; null when none is live. */
export function nextExpiry(list: ReadonlyArray<Notice>, now: number): number | null {
  const live = liveNotices(list, now);
  return live.length ? Math.min(...live.map((n) => n.until)) : null;
}

export function useExpiringNotices() {
  const [notices, setNotices] = useState<Notice[]>([]);
  useEffect(() => {
    const now = Date.now();
    const next = nextExpiry(notices, now);
    if (next === null) return;
    const timer = setTimeout(() => setNotices((list) => liveNotices(list, Date.now())), next - now);
    return () => clearTimeout(timer);
  }, [notices]);
  const add = useCallback((id: string, text: string) => setNotices((list) => addNotice(liveNotices(list, Date.now()), { id, text }, Date.now())), []);
  const drop = useCallback((id: string) => setNotices((list) => dropNotice(list, id)), []);
  return { notices, add, drop };
}

const dismiss = { marginLeft: 8, minHeight: 44, padding: "2px 10px", border: "1px solid var(--fl-line)", borderRadius: "var(--fl-radius)", background: "var(--fl-surface)", color: "var(--fl-accent)", cursor: "pointer" } as const;

export function NoticeLine({ children, onDismiss }: { children: ReactNode; onDismiss: () => void }) {
  return <p role="status" data-testid="notice" style={{ margin: "4px 0" }}>{children}<button type="button" style={dismiss} onClick={onDismiss}>Dismiss</button></p>;
}
