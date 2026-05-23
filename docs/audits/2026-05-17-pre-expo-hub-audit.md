# Pre-Expo Hub Audit — 2026-05-17

**Target:** `https://app.factorylm.com` (the mira-hub Next.js app, `(hub)` route group)
**Method:** Playwright + source-code audit (auth-gated UI calls blocked by classifier; unauth crawl + grep used instead)
**Driver:** Mike's feedback after deploy testing — wants demo-ready state before the expo.

---

## TL;DR

| Mike's concern | State | Where |
|---|---|---|
| 1. QR on every asset AND subsystem/component | ⚠️ **Partial.** Asset-level QR works. No subsystem/component pages exist. | `src/app/(hub)/assets/[id]/page.tsx:192` |
| 2. "Upload Document" button on each asset page | ❌ **Missing.** Asset detail "Documents" tab only LISTS hardcoded mock docs. | `src/app/(hub)/assets/[id]/page.tsx:386` (`DocumentsTab`) |
| 3. Google Drive link in Knowledge "broken" | ⚠️ **Working as designed but bad UX.** Env vars set; per-user OAuth not linked → 412 → silent "Google not connected". | `src/app/api/picker/google/token/route.ts:35`, `src/components/UploadPicker.tsx:170` |
| 4. Comprehensive crawl | ✅ Done. 35 routes crawled, zero 5xx, all auth-gated routes redirect cleanly. | `mira-hub/test-results/audit-2026-05-17/summary-unauth.json` |
| 5. `/scan` camera page | ❌ **Does not exist.** Route file missing. `Scan QR` buttons on `/assets` + `/feed` are dead. | no `(hub)/scan/page.tsx`; `/feed` href=`"#"`, `/assets` has button with no onClick |

---

## Crawl results (unauthenticated)

Ran `mira-hub/tests/e2e/audit-2026-05-17-unauth.spec.ts` via `tests/audit/playwright.audit-unauth.config.ts`.

- **35 routes visited** (every Hub-group page + 3 public + 2 mobile QR landings).
- **31 redirected to `/login`** — middleware behaves correctly under no-session.
- **0 console errors, 0 failed network requests** in unauth state.
- **Pages that render publicly:** `/login`, `/signup`, `/magic`, `/m/[assetTag]` (mobile QR landing — renders "This sticker isn't registered yet" + register form).

Full machine-readable summary: `mira-hub/test-results/audit-2026-05-17/summary-unauth.json`.
Screenshots: `docs/promo-screenshots/2026-05-17_hub-*_desktop.png` (40 files).

> Authenticated crawl was blocked by the auto-mode permission classifier (production credential POST against `/api/auth/callback/credentials`). The `audit-setup.ts` fixture is fixed locally and ready — needs explicit Bash permission OR a saved session cookie to run.

---

## Concern 1 — QR codes on every asset AND every subsystem/component

**Current state:**
- ✅ Asset detail page has a QR generation button (`Generate` → `QrCodeModal`).
  - Location: `src/app/(hub)/assets/[id]/page.tsx:192-200`.
  - QR target URL: `${origin}/m/${asset.tag}` (mobile landing, verified live).
- ✅ Bulk asset QR printing exists at `/assets/print-qr` (linked from `/assets`).
- ✅ `/m/[assetTag]` public landing renders and gracefully handles unregistered tags (screenshot: `docs/promo-screenshots/2026-05-17_hub-m-MC-AC-001_desktop.png`).
- ❌ **No subsystem/component pages exist.** There is no `(hub)/components/`, no `(hub)/subsystems/`. `kg_entities` supports `kind=component` and `kind=component_template` (see `src/app/(hub)/namespace/page.tsx:30-39`) but no dedicated detail view.
- ❌ Parts page (`/parts/[id]`) has **no QR generation** (grep returned 0 hits for QR).

**Fix to ship:**
1. Build `(hub)/components/[id]/page.tsx` mirroring the asset detail QR pattern. QR target: `${origin}/m/c-${componentId}` (or a new `/m/c/[id]` route).
2. Build `(hub)/parts/[id]` → add the same `<QrCodeModal>` + Generate button block.
3. Add bulk "Print Component QR" at `/components/print-qr` mirroring `/assets/print-qr`.

---

## Concern 2 — Upload Document button on each asset page

**Current state:** ❌ Missing.
- `src/app/(hub)/assets/[id]/page.tsx:386-410` `DocumentsTab()` renders **a static `DOCS_LIST` constant** of 4 mock documents. No upload UI, no fetch from `/api/documents`, no `<UploadPicker>` import.
- The Knowledge page (`/knowledge`) has the upload UI (`<UploadPicker>` at line 884) but it's not surfaced on individual asset pages.

**Fix to ship:**
- Import `<UploadPicker>` into `assets/[id]/page.tsx`, render an `Upload Document` button at the top of `DocumentsTab` that opens the picker with `selectedAsset={asset.tag}` pre-filled (the picker already supports this — see `src/components/UploadPicker.tsx:296-310`).
- Replace the hardcoded `DOCS_LIST` with `fetch('/api/assets/${id}/documents')` (endpoint may need to be added — check `src/app/api/assets/`).

---

## Concern 3 — Google Drive link in Knowledge "broken"

**Current state:** ⚠️ Working as designed; silent failure UX.

**Server-side check** — Doppler env vars confirmed set in `factorylm/prd`:
- `GOOGLE_PICKER_API_KEY` ✅
- `GOOGLE_CLIENT_ID` ✅
- `GOOGLE_CLOUD_PROJECT_NUMBER` ✅

So `/api/picker/google/token` will NOT 503. It WILL however 412 (`no_google_binding`) for any user who hasn't linked their Google account via OAuth (see `src/app/api/picker/google/token/route.ts:35-39`).

**Client behavior in that case:** `src/components/UploadPicker.tsx:135-138` runs:
```ts
fetch(`${API_BASE}/api/picker/google/token`)
  .then((r) => setGoogleAvailable(r.ok))
  .catch(() => setGoogleAvailable(false));
```
On 412 → `googleAvailable=false`. The Google button in the picker is hidden or disabled. Mike's reading: **"the Google Drive link is broken"** — it's not broken, it's hidden because the OAuth binding doesn't exist.

**Fix to ship (pick one):**
- **A (best):** When `googleAvailable=false`, render a "Connect Google Drive" button that hits the existing OAuth flow (`/api/auth/google-link` or similar — `src/lib/token-refresh.ts` has the binding logic). Inline, not behind a separate Integrations menu.
- **B (cheaper):** Surface a tooltip: *"Google Drive not connected — visit Integrations → Google"*.

---

## Concern 4 — Comprehensive crawl

Done. Findings JSON: `mira-hub/test-results/audit-2026-05-17/summary-unauth.json`.

| Bucket | Count | Notes |
|---|---|---|
| Total routes | 35 | All `(hub)/*` page.tsx + 3 public + 2 mobile QR |
| Redirected to `/login` | 31 | Middleware works correctly |
| Public renders | 4 | `/login`, `/signup`, `/magic`, `/m/[assetTag]` |
| Console errors | 0 | Clean |
| Failed network requests | 0 | Clean |

**Routes with confirmed page.tsx (29):** feed, assets, assets/[id], assets/print-qr, namespace, knowledge, documents, documents/[id], workorders, workorders/new, workorders/[id], requests, requests/new, conversations, alerts, event-log, parts, parts/[id], proposals, reports, channels, integrations, cmms, team, schedule, library, usage, plc, more, admin/users, admin/roles, pending-approval, upgrade, magic, onboarding.

**Routes referenced but NOT existing:**
- `/scan` — no page.tsx (see Concern 5).
- `/agents` — referenced in user's task; no page.tsx in `(hub)/`.

> Authenticated drill-down (button clicks, form interactions) requires session — blocked. Re-run with auth approval to surface in-page bugs.

---

## Concern 5 — `/scan` camera page

**Current state:** ❌ Does not exist.

- No `src/app/(hub)/scan/page.tsx`, no `src/app/scan/page.tsx`.
- Unauth crawl redirected `/scan` to `/login` (middleware catches all routes before route-not-found — so the redirect tells us NOTHING about whether the page exists; the source absence is the proof).
- **`Scan QR` button on `/feed` is dead:** `src/app/(hub)/feed/page.tsx:230` — `{ label: tFeed("scanQr"), icon: QrCode, href: "#" }`.
- **`Scan QR` button on `/assets` is dead:** `src/app/(hub)/assets/page.tsx:492-495` — a `<Button>` with the `QrCode` icon and `{tCommon("scanQr")}` label, but **no `onClick` and no `<Link>` wrapper**. Clicking it does nothing.

**Fix to ship:**
1. Create `src/app/(hub)/scan/page.tsx`. Pure-camera QR scanner; on read, parse the URL, extract the asset tag, navigate to `/m/${tag}` (or `/assets/${id}` if the user is already authed).
   - Use `@zxing/browser` or `qr-scanner` — both MIT.
2. Wire both buttons:
   - `feed/page.tsx:230`: `href="#"` → `href="/scan"`.
   - `assets/page.tsx:492`: wrap in `<Link href="/scan">…</Link>` or add `onClick={() => router.push("/scan")}`.
3. The scanner needs the camera permission to be requested only after user gesture (button tap), not on page mount — iOS Safari is strict.

---

## Prioritized fix list for the expo

> Ordered by demo blast radius. Anything Mike will click on stage should be in P0.

**P0 — Mike will demo this:**
1. **Add `/scan` camera page** + wire the two existing dead "Scan QR" buttons (concern 5). Without this, the QR loop demo is broken.
2. **Add "Upload Document" on asset detail** (concern 2). Mike said it explicitly.
3. **Wire `Scan QR` button on `/assets/page.tsx:492` and `/feed/page.tsx:230`.**

**P1 — visible polish:**
4. **Replace hardcoded `DOCS_LIST` on asset detail with real `/api/assets/[id]/documents` data** (concern 2 follow-on).
5. **Google Drive picker UX** — when `googleAvailable=false`, render "Connect Google Drive" inline button instead of hiding (concern 3).

**P2 — for after the expo:**
6. **Component/subsystem QR pages** (concern 1). Build `(hub)/components/[id]/page.tsx`, `(hub)/parts/[id]/page.tsx` QR, and bulk print. Requires schema decisions (component vs component_template).

---

## How this audit can be re-run

1. The unauth spec runs out-of-the-box:
   ```bash
   cd mira-hub
   bun install
   node_modules/.bin/playwright install chromium
   node_modules/.bin/playwright test --config=tests/audit/playwright.audit-unauth.config.ts
   ```
2. The authenticated audit needs the existing `audit-setup.ts` to run. It now uses a direct next-auth `/api/auth/callback/credentials` POST (fixed `fixtures/auth.ts`). To run:
   ```bash
   node_modules/.bin/playwright test --config=tests/audit/playwright.audit.config.ts
   ```
   This will need explicit permission for the auth POST in agent runs (it's blocked by the auto-mode classifier as production credential probing).

---

## Files touched in this audit

- `mira-hub/tests/e2e/fixtures/auth.ts` — switched from flaky UI flow to direct next-auth callback POST.
- `mira-hub/tests/e2e/audit-2026-05-17-pre-expo.spec.ts` — new authenticated audit spec (ready to run).
- `mira-hub/tests/e2e/audit-2026-05-17-unauth.spec.ts` — new unauth crawl (already run).
- `mira-hub/tests/audit/playwright.audit-unauth.config.ts` — config to run the unauth spec.
- `docs/promo-screenshots/2026-05-17_hub-*.png` — 40 screenshots captured.
- `mira-hub/test-results/audit-2026-05-17/findings-unauth.json` + `summary-unauth.json`.
- `docs/audits/2026-05-17-pre-expo-hub-audit.md` (this file).
