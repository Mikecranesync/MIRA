// #5942: the "Email me a sign-in link" request's state, kept outside the
// component. Login unmounts the component on every mode switch; keeping the
// pending request and its outcome here means a switch neither drops them (which
// would allow a second email) nor has to be blocked (which would stop a
// technician who already holds a link from pasting it) — Codex rounds 1 and 2.
//
// Each outcome carries the address it was for, so a result is shown only while
// that address is still the one in the field. Nothing here logs the address.
import { requestSignInLink, type SignInLinkFailureReason } from "./sign-in-link";

export type SignInLinkOutcome =
  | { address: string; ok: true }
  | { address: string; ok: false; reason: SignInLinkFailureReason };

export type SignInLinkState = {
  /** The address of the request in flight, or null when none is. */
  pending: string | null;
  outcome: SignInLinkOutcome | null;
};

let current: SignInLinkState = { pending: null, outcome: null };
const listeners = new Set<() => void>();

function set(next: SignInLinkState) {
  current = next;
  for (const fn of listeners) fn();
}

export function subscribeSignInLink(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getSignInLinkState(): SignInLinkState {
  return current;
}

/** Sends at most one request at a time: a call while one is pending does nothing. */
export async function sendSignInLink(email: string): Promise<void> {
  if (current.pending !== null) return;
  const address = email.trim();
  set({ pending: address, outcome: null });
  // requestSignInLink reports failures as values; the catch only guarantees the
  // pending state can never stick if that ever changes.
  const r = await requestSignInLink(address).catch(() => ({
    ok: false as const,
    reason: "network" as const,
  }));
  set({
    pending: null,
    outcome: r.ok ? { address, ok: true } : { address, ok: false, reason: r.reason },
  });
}

export function __resetSignInLinkForTests(): void {
  set({ pending: null, outcome: null });
}
