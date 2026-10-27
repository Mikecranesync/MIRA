// Invitation sign-in — reuses the SAME transport primitives the password flow
// uses (mira-mobile/src/api/client.ts: CSRF, native cookie jar, /api/me as
// ground truth), rather than duplicating auth. See api/resources.ts::signIn
// for the pattern this mirrors.
import {
  ApiError,
  clearAllLocalState,
  invalidateLocalSessionRequests,
  request,
  withAuthEventsSuppressed,
} from "../../api/client";

export type InviteSignInFailureReason =
  | "could_not_start"
  | "invalid_token"
  | "network"
  | "server";

export type InviteSignInResult =
  | { ok: true }
  | {
      ok: false;
      reason: InviteSignInFailureReason;
      /** Set when the callback exchange itself succeeded (the token was
       *  consumed, a fresh cookie was set) but confirming /api/me then
       *  failed for ANY reason — network, server, HTTP 401, 403, or other
       *  4xx. A caller seeing this must retry via `confirmInviteSession()`,
       *  never by calling `signInWithMagicToken` again with the spent token.
       *  A callback 401 or error URL remains a hard failure without this
       *  flag (#4470 F1). */
      sessionEstablished?: boolean;
    };

function inviteSignInFailureReason(
  error: unknown,
  fallback: Extract<InviteSignInFailureReason, "could_not_start" | "invalid_token">,
): InviteSignInFailureReason {
  if (error instanceof ApiError && error.kind === "network") return "network";
  if (error instanceof ApiError && error.kind === "server") return "server";
  return fallback;
}

/**
 * NextAuth's `/api/auth/callback/:provider` endpoint, called with
 * `json: "true"`, may encode a rejected sign-in in a JSON body
 * `{ url: "<signin-page>?error=CredentialsSignin" }` — this is the same
 * signal `next-auth/react`'s own browser-side `signIn()` reads to decide
 * ok/error, and it is independent of cookies entirely. Detecting it here
 * means a rejected token is never ambiguous with "callback succeeded, some
 * other reason /api/me failed" — see the doc comment on
 * `signInWithMagicToken` for why that distinction is load-bearing.
 */
function callbackIndicatesRejection(data: unknown): boolean {
  if (typeof data !== "object" || data === null) return false;
  const url = (data as { url?: unknown }).url;
  if (typeof url !== "string" || url.length === 0) return false;
  try {
    return new URL(url, "https://placeholder.invalid").searchParams.has("error");
  } catch {
    return false;
  }
}

/**
 * Exchanges a workspace-invitation magic token for a session via NextAuth's
 * "magic-token" credentials provider, through the hub's standard CSRF +
 * callback + /api/me contract.
 *
 * An invitation attempt must never let a PRIOR session answer for it — a
 * rejected/expired/already-used token must not "appear signed in" just
 * because this device happened to carry someone else's leftover session.
 * Two different leftovers are possible, and each needs its own guard:
 *
 * 1. On native, the session lives in OUR Preferences-backed cookie jar
 *    (api/client.ts). `clearAllLocalState()` wipes exactly that, so if the
 *    callback doesn't set a fresh cookie, /api/me has nothing to answer with.
 * 2. In the dev-browser fallback, `rawRequest()` uses real `fetch(...,
 *    { credentials: "include" })` — an ACTUAL browser cookie, which
 *    `clearAllLocalState()` cannot touch (it only ever managed the native
 *    jar). A real leftover browser session would survive the wipe above and
 *    could make /api/me succeed even though the token was rejected.
 *
 * Case 2 is why this function does NOT simply trust "/api/me succeeded" the
 * way the native-only case would allow. NextAuth's callback endpoint,
 * called with `json: "true"`, can carry a rejected sign-in as
 * `{ url: "...?error=CredentialsSignin" }` (the exact signal
 * `next-auth/react`'s own `signIn()` reads) — `callbackIndicatesRejection`
 * reads that signal and returns failure immediately, BEFORE /api/me is ever
 * consulted, so a leftover session (native or browser) can never paper over
 * a definite rejection. Only when the callback does NOT indicate rejection
 * does /api/me run, as the final confirmation of a newly-established session.
 *
 * Exchange vs. confirmation (#4470 F1): once the callback is NOT a rejection,
 * a subsequent /api/me failure is purely a confirmation problem, not a
 * credential problem — the token is already consumed and a fresh cookie is
 * already sitting in the jar. That includes HTTP 401 `auth` and other 4xx
 * kinds, not only transient network/server errors. `checkSessionEstablished`
 * is the shared tail for both this function and `confirmInviteSession`
 * below, so a confirmation miss never has to be "fixed" by replaying the
 * spent token or clearing the new session.
 */
async function checkSessionEstablished(): Promise<InviteSignInResult> {
  try {
    await request("/api/me/");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: inviteSignInFailureReason(error, "invalid_token"),
      sessionEstablished: true,
    };
  }
}

export async function signInWithMagicToken(token: string): Promise<InviteSignInResult> {
  invalidateLocalSessionRequests();
  await clearAllLocalState();
  return withAuthEventsSuppressed(async () => {
    try {
      const csrfRes = await request("/api/auth/csrf/");
      const csrfToken = (csrfRes.data as { csrfToken?: string } | null)?.csrfToken;
      if (!csrfToken) return { ok: false, reason: "could_not_start" };

      let callbackData: unknown = null;
      try {
        const callbackRes = await request("/api/auth/callback/magic-token/", {
          method: "POST",
          form: { csrfToken, token, json: "true" },
        });
        callbackData = callbackRes.data;
      } catch (error) {
        // NextAuth v4 returns HTTP 401 for rejected credentials. A failed
        // callback must never borrow success from a previous browser session.
        return { ok: false, reason: inviteSignInFailureReason(error, "invalid_token") };
      }

      if (callbackIndicatesRejection(callbackData)) {
        return { ok: false, reason: "invalid_token" };
      }

      return await checkSessionEstablished();
    } catch (error) {
      return { ok: false, reason: inviteSignInFailureReason(error, "could_not_start") };
    }
  });
}

/**
 * Re-confirms a session a PRIOR call to `signInWithMagicToken` already
 * established (returned `sessionEstablished: true`) — without wiping local
 * state or resubmitting any token (#4470 F1). This is deliberately as
 * trustworthy as a single `/api/me` check always was within an already-
 * successful exchange: it introduces no new way to fake a sign-in, because
 * it never touches the token-exchange step that proved the session is real
 * in the first place. Callers must only invoke it after a genuine prior
 * `sessionEstablished: true` result from THIS sign-in attempt — it is a
 * retry of that attempt's confirmation step, not a general-purpose
 * "am I logged in" probe.
 */
export async function confirmInviteSession(): Promise<InviteSignInResult> {
  return withAuthEventsSuppressed(() => checkSessionEstablished());
}
