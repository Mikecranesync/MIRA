#!/usr/bin/env bun
// Canary: probe Google's OAuth authorize endpoint with our exact
// redirect_uri and fail loudly if Google returns redirect_uri_mismatch.
//
// Why this exists: there is no public API to read the redirect URIs
// registered on a Google OAuth 2.0 Client ID, so drift between what we
// send (NEXTAUTH_URL + NextAuth basePath) and what's registered in
// Google Cloud Console can only be detected by trying. This script does
// that, on a schedule, before the next end user does.
//
// Exits 0 if Google accepts the redirect_uri (302 → consent / chooser).
// Exits 1 with a human-readable explanation if Google rejects it.
//
// Run locally:  bun run scripts/verify-google-oauth-redirect.ts
// Run in CI:    same, see .github/workflows/oauth-redirect-canary.yml

async function main(): Promise<void> {
  const clientId = process.env.HUB_AUTH_GOOGLE_CLIENT_ID;
  const redirectUri =
    process.env.OAUTH_REDIRECT_URI_TO_VERIFY ??
    "https://app.factorylm.com/api/auth/callback/google";

  if (!clientId) {
    console.error(
      "FAIL: HUB_AUTH_GOOGLE_CLIENT_ID is not set. Run under Doppler:\n" +
        "  doppler run -p factorylm -c prd -- bun run scripts/verify-google-oauth-redirect.ts",
    );
    process.exit(2);
  }

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", "canary");
  // PKCE — Google validates `code_challenge` is base64url-encoded BEFORE
  // checking the redirect_uri, so we must send a real one or we get
  // `invalid_request: Code Challenge must be base64 encoded` and never
  // exercise the redirect-URI check. This is the base64url-SHA256 of the
  // string "canary-code-verifier" (any fixed value works for the probe).
  const codeVerifier = "canary-code-verifier-fixed-value-for-the-canary-probe";
  const challengeBytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(codeVerifier),
  );
  const codeChallenge = Buffer.from(challengeBytes)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");

  const res = await fetch(url.toString(), { redirect: "manual" });
  const loc = res.headers.get("location") ?? "";

  console.log(`HTTP ${res.status} — Location: ${loc.slice(0, 200)}`);

  if (res.status === 302 && loc.includes("/signin/oauth/error")) {
    const errParam = new URL(loc).searchParams.get("authError") ?? "";
    let decoded = "";
    try {
      decoded = Buffer.from(errParam, "base64url").toString("utf8");
    } catch {
      decoded = errParam;
    }
    console.error(
      `\nFAIL: Google rejected our redirect_uri.\n` +
        `  client_id    = ${clientId}\n` +
        `  redirect_uri = ${redirectUri}\n` +
        `  decoded err  = ${decoded}\n\n` +
        `Fix: add the redirect URI above to Google Cloud Console:\n` +
        `  APIs & Services → Credentials → OAuth 2.0 Client ID ${clientId.split("-")[0]}-… →\n` +
        `  Authorized redirect URIs → Save.\n` +
        `See mira-hub/docs/auth/oauth-redirect-uris.md.\n`,
    );
    process.exit(1);
  }

  if (
    res.status === 302 &&
    (loc.startsWith("https://accounts.google.com/") || loc.includes("/signin/oauth/"))
  ) {
    console.log(
      `OK: Google accepted our redirect_uri (${redirectUri}).\n` +
        `  Location starts with the consent / chooser flow as expected.`,
    );
    process.exit(0);
  }

  console.error(
    `INCONCLUSIVE: unexpected response (HTTP ${res.status}). Inspect manually.`,
  );
  process.exit(3);
}

void main();
