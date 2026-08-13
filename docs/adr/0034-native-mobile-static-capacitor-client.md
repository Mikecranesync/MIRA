# ADR-0034 — Native mobile app: dedicated static Capacitor client consuming Hub APIs

- **Status:** Proposed (supersedes the "PWA is the strategy" line in `docs/specs/hub-mobile-spec.md:18`
  and the PWA-over-native stance in `docs/competitors/factory-ai-leapfrog-plan.md` item 7)
- **Date:** 2026-08-13
- **Deciders:** Mike (product), this session (engineering)
- **Phase-0 evidence:** three-agent reconnaissance over docs, the Hub auth/API surface, prod nginx
  routing, and local tooling. Key file:line citations inline below.

## Context

FactoryLM needs a commercially distributable iOS + Android app. Constraints discovered in Phase 0:

1. **The Hub cannot be packaged.** `mira-hub` is Next.js **standalone-server** output with
   middleware, API routes, cookie auth, and `dynamic = "force-dynamic"` on the whole `(hub)`
   layout (`mira-hub/src/app/(hub)/layout.tsx:13`). Capacitor packages a static asset bundle;
   there is nothing static to package.
2. **Production is three applications behind one hostname** (`deployment/nginx-app-factorylm.conf`):
   `/m/*` and a long carve-out list → mira-web (separate PLG JWT auth), `/scan/*` → mira-scan-monday
   (separate Vite/FastAPI app with monday.com OAuth), everything else → the Hub (NextAuth). A
   remote-URL wrapper would place all three, plus arbitrary redirects, inside the native plugin
   trust boundary.
3. **Every mobile-tab surface is already a JSON or SSE API** — work orders, PM schedules, chat
   (SSE over POST), assets (incl. `GET /api/assets/by-tag/[tag]` for QR resolution), team/usage/me.
   No tab depends on server rendering. The middleware already returns **401 JSON** (not a redirect)
   for unauthenticated `/api/*` (`mira-hub/src/middleware.ts:172-201`).
4. **Auth is native-compatible today.** NextAuth v4, `strategy: "jwt"`, self-contained JWE session
   cookie; the `csrf → callback` dance works from any HTTP client with a cookie jar for both the
   `credentials` and `magic-token` providers (`mira-hub/src/auth.ts:41-90`). Google OAuth has no
   mobile/PKCE handling today — a system-browser (Custom Tabs / `ASWebAuthenticationSession`) flow
   against the Hub with an app-link return is the path (Phase 4/5).
5. **There is no CORS.** No route except `/api/auth/register` sets ACAO, and that one allowlists
   only the two prod web origins (`auth/register/route.ts:10,26-38`). Browser `fetch` from a
   `capacitor://localhost`/`https://localhost` WebView origin is therefore blocked on every tab
   API, and the SameSite=Lax session cookie would not attach cross-site anyway.
6. **No prior native attempt exists** (the `wip/expo-*` branch is the Florida *Expo* demo, not
   React Native). One reusable artifact was rescued from it: `qr-scanner-view.tsx`, a library-based
   scanner that works on iOS Safari where `BarcodeDetector` does not.

## Options considered

### A — Remote Hub WebView wrapper (`server.url` → production + broad `allowNavigation`)
Rejected. It inherits constraint 2 wholesale (three apps, two foreign auth domains, and arbitrary
redirects inside the native bridge), cannot do offline (constraint 1: every page is
server-rendered per-request), embeds OAuth in a WebView (Google disallows), and is the classic
"website in a shell" App Review rejection shape. The audit's P0 stands on repo evidence.

### B — Dedicated static client (Vite + React + TS + Tailwind) in a Capacitor 8 shell — **CHOSEN**
A new `mira-mobile/` app: static bundle compiled into the shell, **native HTTP transport**
(`CapacitorHttp`) so constraint 5 is bypassed entirely (native requests have no CORS and use the
app-private native cookie jar, which the NextAuth dance populates), the existing Hub APIs consumed
unchanged, and native capabilities (camera, secure storage, app links) exposed only to packaged
code — no `server.url`, no `allowNavigation`.

### C — React Native / Expo client
Viable but strictly slower here: zero reuse of the repo's proven React-web stack (Tailwind +
`factorylm-tokens.css` per the UI law, existing component patterns, bun/vite toolchain), a second
build toolchain (Metro/EAS) nobody on the project has exercised, and no offsetting capability we
need — offline (SQLite/IndexedDB), camera, deep links, secure storage are equivalent under
Capacitor 8 plugins. RN's advantage (fully native widgets) does not outweigh the reuse loss for a
B2B technician tool whose UI language is already defined in web tokens.

## Decision

**Option B.** `mira-mobile/` (repo sibling of `mira-web`, own `package.json`) — Vite + React + TS +
Tailwind with the shared FactoryLM tokens, packaged by **Capacitor 8** for iOS + Android,
consuming `https://app.factorylm.com/api/*` (env-switchable) over `CapacitorHttp` with the native
cookie jar carrying the NextAuth session. The web Hub continues to build and deploy independently
and is not modified by the client (server-side additions — bearer shim, deletion flow, deep-link
assetlinks — land as separate, individually reviewable Hub changes when their phase arrives).

### Architecture rules bound by this ADR
1. **Trust boundary:** only the packaged bundle runs in the WebView. No `server.url`, no
   `allowNavigation` entries. External content (OAuth, `/m` web fallback, pricing, arbitrary
   links) opens in the system browser (`@capacitor/browser`), never in the app WebView.
2. **Auth:** phase 2 = credentials + magic-token via the existing NextAuth csrf/callback dance,
   session JWE held in the app-private native cookie jar (persisted by the OS, app-sandboxed);
   sign-out clears it. Google (and Drive/Slack/Microsoft/Dropbox/Confluence connectors) = system
   browser + App Links return; server-side session exchange added only if the cookie handoff
   proves insufficient. No OAuth inside the WebView, ever.
3. **Authorization:** the client renders from `GET /api/me`'s `capabilities[]` and **fails closed**
   (no capability data → least privilege). It never reproduces the web client's `role ?? "owner"`
   default (`src/providers/access-control.ts:47` — a P0 the web should also fix). The server
   remains the security authority.
4. **Navigation:** the frozen 5-tab contract from `docs/specs/hub-mobile-spec.md` — Workorders,
   Schedule, Chat, Assets, More — capability-filtered from `/api/me`, shared as a single canonical
   nav model inside `mira-mobile` (and offered back to the Hub as the drift fix for its current
   Event-Log/Assets/Team/More divergence).
5. **Deep links:** `https://app.factorylm.com/m/<TAG>` via verified App/Universal Links (+
   `factorylm://` custom scheme fallback), parsed with the Hub's `extractAssetTag` semantics
   (`src/lib/scan-target.ts`), resolved via `GET /api/assets/by-tag/[tag]`. Native users never
   land in mira-web's `/m` renderer.
6. **Offline (Phase 4):** local cache (SQLite via `@capacitor-community/sqlite` or IndexedDB) for
   assets/faults/doc context; work-order mutation queue keyed by **client-generated idempotency
   ids** — which requires adding idempotency support to `POST /api/work-orders` (today a retried
   POST duplicates; server generates all ids, `work-orders/route.ts:11-13,221`). Tenant-keyed
   storage, purged on logout and tenant switch.
7. **Distribution (Phase 5 decision, documented not assumed):** default posture is the
   **enterprise/B2B companion model** — organizational accounts purchased outside the app, no IAP,
   no in-app subscription CTA, sign-in-only app (which also avoids the Sign-in-with-Apple
   requirement that attaches to third-party-login *account-creation* apps). The $499 CTA and
   public signup stay on the web. Full store-rule analysis is a Phase 5 deliverable before
   submission.

## Consequences

- Two client codebases (Hub web + mobile) share APIs and design tokens but not page code; the
  canonical-nav model and any shared UI primitives live where both can import them without
  coupling the mobile bundle to Next.js.
- Server work this unlocks, in later phases: idempotent work-order writes, a Hub account-deletion
  flow (Apple requirement; today deletion exists only in mira-web's PLG tables and its worker
  orphans external data — `mira-web/src/lib/account-deletion.ts:132-168`), `assetlinks.json` /
  `apple-app-site-association` served by nginx, and optionally the ~20-line bearer fallback in
  `requireSession()` if cookie handling ever binds.
- iOS builds require macOS; on this Windows host the iOS project is generated and configured but
  the archive/signing step is documented as the single external step.

## Cross-references
- `docs/prd/2026-08-13-native-mobile-app-prd.md` — the phased implementation PRD
- `docs/specs/hub-mobile-spec.md` — the frozen 5-tab UX contract (line 18 superseded by this ADR)
- `docs/auth/oauth-redirect-uris.md` — canonical OAuth redirect URIs + CI canary
- `.claude/rules/ui-style.md` — token law (mobile bundles `factorylm-tokens.css`)
- Phase-0 recon evidence: agent reports 2026-08-13 (docs/auth-API/routing-tooling)
