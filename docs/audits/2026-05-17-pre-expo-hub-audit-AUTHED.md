# Pre-Expo Hub Audit — Authenticated Pass — 2026-05-17

**Target:** `https://app.factorylm.com` (the mira-hub Next.js app, `(hub)` route group)
**Method:** Playwright authenticated crawl as `playwright@factorylm.com` (admin) + per-route console + network capture.
**Driver:** Re-run after the unauth pass; Mike approved auth for the test account.
**Companion:** see `docs/audits/2026-05-17-pre-expo-hub-audit.md` for source-truth + unauth findings.

---

## TL;DR — production bugs found on origin/main

> Every route returned HTTP 200, but **several backend endpoints 500 / 503**, leaving pages empty. These are the things Mike will hit on stage if not fixed.

| # | Severity | Route | Failure | Endpoint |
|---|---|---|---|---|
| 1 | 🔴 P0 | `/namespace` | tree empty (broken) | `GET /api/namespace/tree/` → **500** |
| 2 | 🔴 P0 | `/proposals` | list empty (broken) | `GET /api/proposals/?status=proposed` → **500** |
| 3 | 🟠 P1 | `/usage` | data empty | `GET /api/usage/` → **500** |
| 4 | 🟠 P1 | `/feed` | readiness widget broken | `GET /api/readiness/` → **500** |
| 5 | 🟡 P2 | `/documents`, `/knowledge`, `/library` | uploads list empty | `GET /api/uploads/` → **503** (all 3 routes) |
| 6 | 🟡 P2 | `/plc` | embedded ladder-logic iframe blocked | CSP `frame-src` missing `mikecranesync.github.io` |
| 7 | 🟡 P2 | `/assets/[id]` | label shows literal `ASSETS.LOCATION` | i18n key `assets.location` missing for `en` |

Plus the prior structural gaps Mike asked about (asset-page Upload Document missing, dead Scan QR buttons, etc.) — see the companion audit.

---

## Updated findings on Mike's 5 concerns

| Concern | Updated state |
|---|---|
| **1. QR on every asset + subsystem/component** | Asset QR confirmed working (`qrButtonCount=1` on `/assets/<uuid>`). Subsystem/component pages still don't exist. Parts/[id] still has no QR. |
| **2. Upload Document button on asset page** | ❌ **Confirmed missing** — authed crawl: `uploadDocumentButtonCount=0` on `/assets/<uuid>`. Asset detail screenshot shows only the "Generate" QR button top-right and 6 metadata cards; no upload control on any tab. |
| **3. Google Drive "broken" in Knowledge** | `/knowledge` returns 200 and **renders fully** with real data (84K chunks, 304 manufacturers, growth chart, top-manufacturers chart). "Upload" button is present at top right. The actual broken piece is `/api/uploads/` returning **503** — the upload pipeline status panel can't read existing uploads. Google picker itself wasn't reached because the test couldn't wait long enough for the picker modal to mount (page polling holds networkidle). Source-truth: picker still hides Google button when user hasn't OAuth-linked. |
| **4. Comprehensive crawl** | Done. 24 main routes + 1 dynamic asset detail crawled with auth. Per-route findings in `mira-hub/test-results/audit-2026-05-17/finding-*.json`. |
| **5. `/scan` camera page** | ✅ **Page EXISTS on origin/main** (`mira-hub/src/app/(hub)/scan/page.tsx` at blob `8824b094…`). Production renders **"Scan an asset · Point your camera at a MIRA QR label"** with camera capture + manual tag-entry fallback. (Headless Chromium correctly shows "Couldn't start the camera — Not supported", so the camera path is reachable, just not testable in CI.) My worktree is on a stale branch that doesn't have it — original "missing" finding was a branch artifact, not reality. Note: a `fix/hub-qr-scan-button` branch exists locally with "wire /scan camera flow + repoint broken QR buttons" — likely already in flight. |

---

## Routes that rendered clean (no console errors, no failed requests)

`/feed` (modulo /api/readiness 500), `/assets`, `/workorders`, `/conversations`, `/alerts`, `/event-log`, `/parts`, `/reports`, `/channels`, `/integrations`, `/cmms`, `/team`, `/schedule`, `/requests`, `/more`, `/scan`.

So most of the surface is fine. The breaks cluster in: **namespace, proposals, usage, /feed readiness widget, uploads endpoint, plc CSP**.

---

## Other observations

- **Onboarding tour modal ("Chat with MIRA 1/5") fires on every route visit** in a fresh session. It's blocking the screenshot of every page. Suggest: only fire on first authenticated login per user, persisted server-side (looks like it's client-only right now).
- **Asset detail i18n bug:** the `assets.location` translation key is missing in the `en` namespace; the page renders the literal label `ASSETS.LOCATION`. Visible in screenshot `docs/promo-screenshots/2026-05-17_hub-asset-1c7161b2_desktop.png`. Console emits `p: MISSING_MESSAGE: assets.location (en)`.
- **Sidebar:** crawl confirms the sidebar nav links are wired correctly to all routes (no 404s on link previews).

---

## Updated P0 list for the expo

> Re-ordered now that we know what's actually broken in production.

1. **Fix `GET /api/namespace/tree/` 500** — `/namespace` is the demo centerpiece per Phase 1/2 plans. It's empty for users today.
2. **Fix `GET /api/proposals/` 500** — Mike will want to demo the proposal-promotion flow.
3. **Add "Upload Document" button on asset detail** — concern 2, structurally absent.
4. **Fix `GET /api/uploads/` 503** — three pages (documents, knowledge, library) all silently broken. Likely the upload worker container isn't running.
5. **Fix `GET /api/readiness/` 500 on /feed** — the dashboard "readiness" panel is broken for the landing page.
6. **Fix `assets.location` missing i18n key** — visible on every asset detail page.
7. **Fix `GET /api/usage/` 500** — billing/quota page broken.

Lower priority but worth fixing before the expo:
- Make the "Chat with MIRA 1/5" onboarding tour not pop on every page visit.
- Add `mikecranesync.github.io` to CSP `frame-src` for `/plc` ladder-logic embed.
- Confirm `fix/hub-qr-scan-button` is merged so the Scan QR buttons on /feed + /assets actually go to /scan.

---

## Artifacts

- Authenticated screenshots: `docs/promo-screenshots/2026-05-17_hub-*_desktop.png` (25 files, re-captured authed).
- Per-route findings: `mira-hub/test-results/audit-2026-05-17/finding-*.json` (25 files).
- Fixed audit fixture: `mira-hub/tests/e2e/fixtures/auth.ts` (UI-flow login with hydration wait — works in headless mode).
- Spec files: `mira-hub/tests/e2e/audit-2026-05-17-pre-expo.spec.ts`, `audit-2026-05-17-unauth.spec.ts`.

To re-run:
```bash
cd mira-hub
node_modules/.bin/playwright test --config=tests/audit/playwright.audit.config.ts --project=audit-setup
node_modules/.bin/playwright test --config=tests/audit/playwright.audit.config.ts --project=audit-desktop --grep=audit-2026-05-17-pre-expo
```
