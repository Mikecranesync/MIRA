# OAuth Redirect URIs — canonical list

> Source of truth for every redirect URI that **must** be registered in an
> external OAuth provider console (Google, Microsoft, Slack, Dropbox,
> Atlassian) for mira-hub sign-in or workspace-integration flows to work.

If a URI listed here is missing from the corresponding provider console,
end users hit a `redirect_uri_mismatch` (or equivalent) error on sign-in.
The CI canary `.github/workflows/oauth-redirect-canary.yml` runs hourly and
on every push to `main`; if the canonical URI in this doc is no longer
authorized at Google, the workflow fails and opens (or comments on) a
deduplicated `oauth-incident` tracking issue — so a real sign-in break is
caught within ~1h and reaches a human, not just the Actions tab.

---

## Google — sign-in (NextAuth Google provider)

**OAuth client ID:** `246891599587-usbnoa7g6agveginmbb62rvi2p3rmb83.apps.googleusercontent.com`
**Where to edit:** Google Cloud Console → APIs & Services → Credentials →
that OAuth 2.0 Client ID → *Authorized redirect URIs*.
**Doppler env:** `factorylm/prd` — `HUB_AUTH_GOOGLE_CLIENT_ID`, `HUB_AUTH_GOOGLE_CLIENT_SECRET`.

| URI | Purpose | Remove? |
|---|---|---|
| `https://app.factorylm.com/api/auth/callback/google` | Current production (Phase 2, root basePath). | **Required** — do not remove. |
| `https://app.factorylm.com/hub/api/auth/callback/google` | Legacy (Phase 1, `/hub` basePath). nginx 301s `/hub/...` → `/...` so this is harmless. | Safe to remove once verified no active sessions reference it. |
| `http://localhost:3100/api/auth/callback/google` | Local dev. | Required for any developer running `bun run dev` locally on port 3100. |

The redirect URI sent is always `${NEXTAUTH_URL}/callback/google` (NextAuth
v4 appends `/callback/<provider>` directly to `NEXTAUTH_URL` when that
value already ends with the auth basePath — see compose comment).

## Google — Drive / Gmail workspace integration

**OAuth client ID:** see Doppler `GOOGLE_CLIENT_ID`.
**Callback route:** `mira-hub/src/app/api/auth/google/callback/route.ts`.

| URI | Purpose |
|---|---|
| `https://app.factorylm.com/api/auth/google/callback` | Production. |
| `http://localhost:3100/api/auth/google/callback` | Local dev. |

## Slack, Microsoft, Dropbox, Atlassian

Workspace OAuth callbacks follow the same pattern:
`https://app.factorylm.com/api/auth/<provider>/callback`. See the
matching route files under `mira-hub/src/app/api/auth/<provider>/callback/`.

---

## Procedure: when you change `NEXTAUTH_URL` or add a new env

1. Edit this doc — add the new URI to the table above.
2. Open Google Cloud Console → Credentials → the relevant OAuth client →
   add the URI under *Authorized redirect URIs* → Save.
3. Wait ~30s for Google to propagate.
4. Run `bun run scripts/verify-google-oauth-redirect.ts` from `mira-hub/`
   — should exit 0.
5. Push the doc update; CI canary will confirm continuously after merge.

## Procedure: what to do when the canary alerts

The CI canary fires when our canonical redirect URI is no longer accepted
by Google (URI removed, OAuth client deleted, project disabled, etc.).
Investigate in this order:

1. Has someone manually edited Google Cloud Console? Re-add the URI.
2. Has the OAuth client been deleted? Re-create it; rotate
   `HUB_AUTH_GOOGLE_CLIENT_*` in Doppler.
3. Is the GCP project disabled / billing lapsed? Re-enable.
4. Is `NEXTAUTH_URL` in `docker-compose.saas.yml` or Doppler different
   from what this doc claims? Realign; bump this doc.

---

## Long-term: should we move off Google Cloud Console redirect URIs?

The chronic problem is that "which URIs are registered" lives only in
Google's UI — there is no public API to read or write the list of
redirect URIs on an OAuth 2.0 Client ID. So every time NEXTAUTH_URL
changes, someone has to manually click through the Console. This doc +
the canary make drift loud, but they don't eliminate it.

Three providers handle the OAuth-client registration on their side, so
you give them a callback once and forget Google Cloud Console exists:

| Provider | Free tier | Migration cost | Notes |
|---|---|---|---|
| **Clerk** | 10k MAU | ~2 days (NextAuth → `@clerk/nextjs`) | Strong React/Next.js DX. Pre-built `<SignIn />` component covers Google, Microsoft, SAML. Handles the OAuth client registration; you only configure callback URLs once in Clerk dashboard. |
| **WorkOS** | 1M MAU on SSO | ~3 days (NextAuth → WorkOS Node SDK) | B2B-first. SAML / SCIM included for free; useful when CMMS customers ask for SSO. |
| **Supabase Auth** | 50k MAU | ~3 days, plus user-table migration to Supabase | If we already used Supabase for DB this would be the cheap option; we use NeonDB, so the migration cost is higher than Clerk. |

**Recommended path:** Clerk, but **not yet** — defer until either (a)
this category of bug fires a third time, or (b) MIRA needs SAML/SSO for
an enterprise CMMS customer. The native lock (this doc + the canary)
keeps the chronic pain low enough that the Clerk migration cost is not
yet justified.

Track the migration decision in issue #858 (or whatever supersedes it).
