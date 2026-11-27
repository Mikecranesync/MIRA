// #5942: asks the Hub to email a single-use sign-in link to a technician who has
// no password (verified onboarding creates passwordless accounts). It reuses the
// Hub's existing login magic link: POST /api/auth/magic-link (capabilities/
// auth-link.ts), the same route the web login form posts. The emailed link is
// then pasted into invite mode, which already redeems it.
//
// The Hub answers the same way whether or not an account exists, so success here
// means only "the request was accepted". This file never logs the email.
import { ApiError, request } from "../../api/client";

export type SignInLinkFailureReason =
  | "invalid_email"
  | "rate_limited"
  | "unavailable"
  | "network"
  | "server";

export type SignInLinkResult = { ok: true } | { ok: false; reason: SignInLinkFailureReason };

function reasonFor(error: unknown): SignInLinkFailureReason {
  if (!(error instanceof ApiError)) return "network";
  if (error.kind === "network") return "network";
  if (error.status === 400) return "invalid_email";
  if (error.status === 429) return "rate_limited";
  if (error.status === 503) return "unavailable";
  return "server";
}

export async function requestSignInLink(email: string): Promise<SignInLinkResult> {
  const address = email.trim();
  if (!address) return { ok: false, reason: "invalid_email" };
  try {
    // A POST with no idempotency key: the client never resends it, so one tap
    // sends at most one email. The trailing slash matches the Hub's
    // trailingSlash routing; the client does not follow redirects.
    await request("/api/auth/magic-link/", { method: "POST", json: { email: address } });
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: reasonFor(error) };
  }
}
