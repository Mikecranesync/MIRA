#!/usr/bin/env bun
// Canary: verify Google sign-in works end-to-end against a running deployment,
// and fail loudly if Google returns `redirect_uri_mismatch`.
//
// Why this exists: there is no public API to read the redirect URIs registered
// on a Google OAuth 2.0 Client ID, so drift between what the app sends
// (NEXTAUTH_URL + NextAuth basePath → /callback/google) and what's registered
// in Google Cloud Console can only be detected by trying. This script does
// that, on a schedule, before the next end user does.
//
// It needs NO secret. client_id and redirect_uri are *public* values the app
// already puts in its Google authorize redirect, so we drive the real signin
// flow (GET csrf → POST signin/google) to obtain the exact authorize URL the
// app would send a user to, then follow it to Google. This tests the real flow
// rather than a reconstruction of it — and removes the dependency on the
// HUB_AUTH_GOOGLE_CLIENT_ID GitHub secret that previously made the canary
// exit 2 ("not set") without ever probing Google.
//
// Exit codes (each maps to a distinct CI annotation):
//   0  OK          — Google accepted the redirect_uri (consent / chooser).
//   1  MISMATCH    — Google rejected it (redirect_uri_mismatch). REAL incident:
//                    the redirect URI is not registered in Google Cloud Console.
//   2  CANT_RUN    — probe could not run (app unreachable, signin flow shape
//                    changed, no authorize redirect). NOT a Google rejection.
//   3  INCONCLUSIVE — unexpected response from Google; inspect manually.
//
// Run locally:  bun run scripts/verify-google-oauth-redirect.ts
//               HUB_URL=https://staging… bun run scripts/verify-google-oauth-redirect.ts
// Run in CI:    same, see .github/workflows/oauth-redirect-canary.yml

const EXIT_OK = 0;
const EXIT_MISMATCH = 1;
const EXIT_CANT_RUN = 2;
const EXIT_INCONCLUSIVE = 3;

const HUB = (process.env.HUB_URL ?? "https://app.factorylm.com").replace(/\/$/, "");
// The redirect_uri we EXPECT the app to send (drift check on the app side too).
const EXPECTED_REDIRECT_URI =
  process.env.OAUTH_REDIRECT_URI_TO_VERIFY ?? `${HUB}/api/auth/callback/google`;

/** Collapse a response's Set-Cookie headers into a single Cookie request header. */
function cookieHeaderFrom(res: Response): string {
  const jar = res.headers.getSetCookie?.() ?? [];
  return jar
    .map((c) => c.split(";", 1)[0]?.trim())
    .filter((c): c is string => Boolean(c))
    .join("; ");
}

/**
 * Drive the app's real Google signin to obtain the exact Google authorize URL
 * it would redirect a user to. Returns null if we cannot (→ EXIT_CANT_RUN).
 */
async function getLiveAuthorizeUrl(): Promise<string | null> {
  // 1. CSRF token + cookie. Trailing slash avoids nginx's 308 normalisation.
  const csrfRes = await fetch(`${HUB}/api/auth/csrf/`, { redirect: "manual" });
  if (!csrfRes.ok) {
    console.error(`[probe] GET /api/auth/csrf returned HTTP ${csrfRes.status}`);
    return null;
  }
  const csrfToken = ((await csrfRes.json().catch(() => ({}))) as { csrfToken?: string })
    .csrfToken;
  const cookie = cookieHeaderFrom(csrfRes);
  if (!csrfToken || !cookie) {
    console.error("[probe] could not obtain csrfToken / csrf cookie from the app");
    return null;
  }

  // 2. POST the Google signin. NextAuth replies with the Google authorize URL —
  //    as a 302 Location, or as JSON {url} when X-Auth-Return-Redirect is honoured.
  const body = new URLSearchParams({ csrfToken, callbackUrl: `${HUB}/feed` });
  const signinRes = await fetch(`${HUB}/api/auth/signin/google/`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "X-Auth-Return-Redirect": "1",
      cookie,
    },
    body: body.toString(),
  });

  const loc = signinRes.headers.get("location");
  if (loc && loc.includes("accounts.google.com")) return loc;

  const json = (await signinRes.json().catch(() => ({}))) as { url?: string };
  if (json.url && json.url.includes("accounts.google.com")) return json.url;

  console.error(
    `[probe] signin did not return a Google authorize URL ` +
      `(HTTP ${signinRes.status}, location=${loc ?? "none"})`,
  );
  return null;
}

async function main(): Promise<void> {
  const authorizeUrl = await getLiveAuthorizeUrl();
  if (!authorizeUrl) {
    console.log(
      "::error title=OAuth canary could not run::Could not obtain the Google " +
        `authorize URL from ${HUB}'s signin flow — the app may be unreachable or ` +
        "the NextAuth signin shape changed. This is NOT a Google rejection; " +
        "investigate the probe / deployment, not Google Cloud Console.",
    );
    console.error(`\nCANT_RUN: no authorize URL from ${HUB}. exit ${EXIT_CANT_RUN}`);
    process.exit(EXIT_CANT_RUN);
  }

  const parsed = new URL(authorizeUrl);
  const clientId = parsed.searchParams.get("client_id") ?? "(none)";
  const sentRedirectUri = parsed.searchParams.get("redirect_uri") ?? "(none)";
  console.log(`client_id (public)  = ${clientId}`);
  console.log(`redirect_uri (sent) = ${sentRedirectUri}`);
  console.log(`redirect_uri (want) = ${EXPECTED_REDIRECT_URI}`);
  if (sentRedirectUri !== EXPECTED_REDIRECT_URI) {
    // App-side drift: the deployment sends a redirect_uri other than the
    // documented one. Warn (not fatal) — we still test what it actually sends.
    console.log(
      "::warning title=App redirect_uri drift::The app is sending a redirect_uri " +
        `(${sentRedirectUri}) that differs from the documented value ` +
        `(${EXPECTED_REDIRECT_URI}). Check NEXTAUTH_URL / oauth-redirect-uris.md.`,
    );
  }

  // Follow the app's real authorize URL to Google (no redirect-follow).
  const res = await fetch(authorizeUrl, { redirect: "manual" });
  const loc = res.headers.get("location") ?? "";
  console.log(`Google: HTTP ${res.status} — Location: ${loc.slice(0, 120)}…`);

  if (res.status >= 300 && res.status < 400 && loc.includes("/signin/oauth/error")) {
    let decoded = "";
    try {
      const errParam = new URL(loc).searchParams.get("authError") ?? "";
      decoded = Buffer.from(errParam, "base64url").toString("utf8");
    } catch {
      decoded = "(could not decode authError)";
    }
    console.log(
      "::error title=Google OAuth redirect_uri_mismatch (REAL — sign-in is broken)::" +
        `Google rejected redirect_uri ${sentRedirectUri} for client ${clientId}. ` +
        "Add it under Google Cloud Console → APIs & Services → Credentials → that " +
        "OAuth 2.0 Client ID → Authorized redirect URIs. See " +
        "mira-hub/docs/auth/oauth-redirect-uris.md.",
    );
    console.error(
      `\nMISMATCH: Google rejected our redirect_uri.\n` +
        `  client_id    = ${clientId}\n` +
        `  redirect_uri = ${sentRedirectUri}\n` +
        `  decoded err  = ${decoded.replace(/[^\x20-\x7e]+/g, " ").trim()}\n` +
        `exit ${EXIT_MISMATCH}`,
    );
    process.exit(EXIT_MISMATCH);
  }

  if (
    res.status >= 300 &&
    res.status < 400 &&
    (loc.startsWith("https://accounts.google.com/") || loc.includes("/signin/oauth/"))
  ) {
    console.log(
      `OK: Google accepted redirect_uri ${sentRedirectUri} ` +
        "(consent / account chooser as expected).",
    );
    process.exit(EXIT_OK);
  }

  console.log(
    `::warning title=OAuth canary inconclusive::Unexpected response from Google ` +
      `(HTTP ${res.status}). Inspect manually.`,
  );
  console.error(`\nINCONCLUSIVE: HTTP ${res.status} from Google. exit ${EXIT_INCONCLUSIVE}`);
  process.exit(EXIT_INCONCLUSIVE);
}

void main().catch((e) => {
  console.log(
    "::error title=OAuth canary could not run::Probe threw before reaching a " +
      `verdict (${e instanceof Error ? e.message : String(e)}). NOT a Google rejection.`,
  );
  console.error(e);
  process.exit(EXIT_CANT_RUN);
});
