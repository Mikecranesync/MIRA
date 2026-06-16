# FactoryLM CMMS — rebrand Atlas + wire into post-payment flow

**Created:** 2026-04-10
**Status:** Draft, pending approval
**Target:** Ship with beta launch (GTM sprint window)

## Context

Atlas CMMS (upstream `Teptac/Atlas_CMMS`, GPL-3.0) runs on the VPS as 4 containers and is currently disconnected from the beta funnel. Beta users pay $97/mo via Stripe and land on `/activated` to upload their first manual — but they have no clear path to the CMMS, and if they did navigate there, it would be labeled "Atlas" and feel like a different product.

**Goal:** After Stripe payment, users get a one-click path to **FactoryLM CMMS** (their own hosted, branded Atlas instance) from the welcome email, from the post-payment page, and from the factorylm.com dashboard going forward.

**What already works:**
- `mira-web/src/lib/atlas.ts` — REST client with `signupUser`, `createWorkOrder`, `createAsset`, `listWorkOrders`
- `plg_tenants` NeonDB table already has `atlas_company_id` and `atlas_user_id` columns (unused, set to `0` currently)
- JWT claims schema already includes `atlasCompanyId` / `atlasUserId` fields
- Atlas `signupUser` endpoint creates a user + company in one call and returns `{ accessToken, companyId, userId }`
- VPS already has `cmms.factorylm.ai` → `atlas-frontend:3000` via nginx (per `wiki/nodes/vps.md`)
- mira-mcp already talks to Atlas via `mira-mcp/cmms/atlas.py` for Mira's diagnostic tools

**What's missing:**
- Webhook doesn't call `signupUser` on payment — tenants have no Atlas account
- No one-click SSO path from factorylm.com into their CMMS
- No branding rewrite — the UI still says "Atlas"
- Post-payment email doesn't link to CMMS
- factorylm.com dashboard (cmms.html active view) has no "Open CMMS" button

---

## Key design decisions

Four non-obvious calls that shape everything else:

### Decision 1 — Reuse Atlas's per-company isolation (no rewrite)

Atlas is **single-company-per-deployment upstream**, but `atlas.ts:signupUser` already creates a new company per signup. mira-web isolates tenants by creating a separate Atlas company for each beta user. This works today without any Atlas-side changes.

**Implication:** we do NOT need to fork the Atlas image or add multi-tenancy. The one shared Atlas instance hosts N companies (one per paying tenant). Isolation is enforced by Atlas's own company_id scoping on work orders and assets.

### Decision 2 — Deterministic passwords (no password storage)

Rather than generate + store a password per tenant (extra column, extra encryption key, key rotation problem), derive the Atlas password from the tenant UUID using HMAC:

```
atlas_password = base64( HMAC-SHA256( ATLAS_PASSWORD_DERIVATION_KEY, tenant_id ) )[:32]
```

**Benefits:**
- No new DB column
- No password-at-rest encryption
- Rotation = rotate `ATLAS_PASSWORD_DERIVATION_KEY` + batch-reset all Atlas passwords via admin API
- Deterministic: the same tenant always maps to the same password, so `/api/cmms/login` can regenerate and POST `/auth/signin` on demand

**Trade-off:** if the derivation key leaks, every Atlas tenant password is compromised. Mitigation: the key lives in Doppler `factorylm/prd` alongside `PLG_JWT_SECRET` — the same trust level we already accept.

### Decision 3 — Brand Atlas via nginx `sub_filter`, not a fork

Atlas frontend is a pre-built Docker image (`intelloop/atlas-cmms-frontend:v1.5.0`) with branding baked in. Options to change it:

| Option | Effort | GPL implications | Maintainability |
|---|---|---|---|
| Fork the image, rebuild | 2-4 days | **Must publish modified source** (GPL-3.0) | High ongoing burden |
| Nginx `sub_filter` HTML rewrites | 2-3 hours | No modification, no distribution obligation | Low — just nginx config |
| Iframe embed in a wrapper page | 30 min | None | Breaks deep links + feels janky |
| DNS rename only | 5 min | None | Useless — UI still says Atlas |

**Winner for beta: nginx sub_filter.** We add a new server block for `cmms.factorylm.com` that proxies to `atlas-frontend:3000` and rewrites the HTML on the fly: title, logos, "Atlas" strings, theme color. Optionally inject a small CSS override stylesheet. If beta validates, fork later as a Phase 7.

**Important:** nginx sub_filter is NOT modification of Atlas source code — it's a reverse-proxy content filter operating on the HTTP response. GPL-3.0 distribution obligations do not apply because we're not distributing Atlas, we're hosting it.

### Decision 4 — New subdomain `cmms.factorylm.com` (not `.ai`)

Current VPS config has `cmms.factorylm.ai`. The main brand is `factorylm.com`. We should keep all customer-facing URLs on the `.com` to reduce visual confusion and simplify cert management. New subdomain: **`cmms.factorylm.com`**.

Migration:
- Add DNS A record `cmms.factorylm.com → 165.245.138.91`
- Add nginx server block + Let's Encrypt cert via certbot
- Keep `cmms.factorylm.ai` as a 301 redirect to `cmms.factorylm.com` for any existing bookmarks
- All new emails, buttons, and docs use the `.com` URL

---

## Phase plan — 6 phases, shippable independently

Each phase is a single commit and can ship without the others. Phase 1 unlocks everything downstream; Phases 2-4 can ship in parallel after Phase 1 lands.

### Phase 1 — Webhook provisions a real Atlas user (2-3 hours)

**Scope:** On `checkout.session.completed`, call `signupUser` instead of hardcoding IDs to 0.

**Files to modify:**

1. **`mira-web/src/lib/crypto.ts`** (new, ~25 lines)
   ```ts
   import { createHmac } from "crypto";

   /**
    * Derive a deterministic 32-char Atlas password from tenant UUID.
    * Uses HMAC-SHA256 with ATLAS_PASSWORD_DERIVATION_KEY.
    */
   export function deriveAtlasPassword(tenantId: string): string {
     const key = process.env.ATLAS_PASSWORD_DERIVATION_KEY;
     if (!key) throw new Error("ATLAS_PASSWORD_DERIVATION_KEY not set");
     return createHmac("sha256", key)
       .update(tenantId)
       .digest("base64url")
       .slice(0, 32);
   }
   ```

2. **`mira-web/src/server.ts` — webhook handler** (~30 lines changed)
   - Before calling `sendActivatedEmail`, call:
     ```ts
     const password = deriveAtlasPassword(tenantId);
     const atlasResult = await signupUser({
       email: tenant.email,
       password,
       firstName: tenant.first_name ?? tenant.email.split("@")[0],
       lastName: "",  // Atlas requires a lastName; use empty or "Ops" as fallback
       companyName: tenant.company_name ?? `${tenant.email.split("@")[0]}'s Plant`,
     });
     await updateTenantAtlas(tenantId, atlasResult.companyId, atlasResult.userId);
     ```
   - JWT mint then uses `atlasCompanyId: atlasResult.companyId` (real value, not 0)
   - Wrap in try/catch — if Atlas signup fails, log the error, still mark tenant active, but flag `atlas_provisioning_failed` for manual retry. Don't block the user from paying.

3. **`mira-web/src/lib/quota.ts`** (~15 lines added)
   - New helper: `updateTenantAtlas(tenantId, companyId, userId)` → `UPDATE plg_tenants SET atlas_company_id = $1, atlas_user_id = $2 WHERE id = $3`
   - Add optional column `atlas_provisioning_status` (text, default `'pending'`, values: `pending` | `ok` | `failed`) — NeonDB migration, idempotent ALTER TABLE IF NOT EXISTS via startup check

4. **`mira-web/src/seed/demo-data.ts`** (~20 lines changed)
   - Parameterize `seedDemoData` to accept `{ tenantId, atlasCompanyId, atlasUserId }`
   - Seed assets + work orders as the tenant's Atlas user (not admin), scoped to their new company
   - Alternatively: keep using admin for now but POST with explicit `companyId` field

5. **Doppler `factorylm/prd`** (no code)
   - Add `ATLAS_PASSWORD_DERIVATION_KEY` — 48-byte random, base64-encoded:
     ```bash
     doppler secrets set ATLAS_PASSWORD_DERIVATION_KEY "$(openssl rand -base64 48)" --project factorylm --config prd
     ```

**Acceptance criteria:**
- A fresh signup → Stripe test payment → webhook fires → `plg_tenants` row has real (non-zero) `atlas_company_id` and `atlas_user_id`
- Atlas admin UI (or direct API) shows the new company with the tenant's email as the admin user
- JWT minted in the webhook carries the real IDs
- `atlas_provisioning_status = 'ok'`
- If Atlas is down, tenant still becomes active, status is `'failed'`, and an alert is logged

**Rollback:** revert the single commit. The derivation key stays in Doppler. Existing tenants with `atlas_company_id = 0` remain unchanged.

---

### Phase 2 — One-click CMMS login route (1-2 hours)

**Scope:** A new authenticated mira-web route that the user hits from anywhere (email, dashboard, navbar), that transparently logs them into Atlas and redirects to the CMMS.

**Files to modify:**

1. **`mira-web/src/server.ts`** — add route `GET /api/cmms/login` with `requireActive` middleware
   ```ts
   app.get("/api/cmms/login", requireActive, async (c) => {
     const tenant = await loadTenantFromJwt(c);
     const password = deriveAtlasPassword(tenant.id);
     const atlas = await signInUser({ email: tenant.email, password });
     // Redirect to the branded CMMS domain with token in URL fragment
     // (fragment so it never hits server logs)
     const target = new URL("https://cmms.factorylm.com/");
     target.hash = `accessToken=${encodeURIComponent(atlas.accessToken)}&companyId=${atlas.companyId}&userId=${atlas.userId}`;
     return c.redirect(target.toString(), 302);
   });
   ```

2. **`mira-web/src/lib/atlas.ts`** — add `signInUser` if it doesn't exist (atlas.ts already has a signIn pattern for the admin; refactor to reusable)

3. **Atlas frontend** — needs to read `#accessToken=...` from URL fragment on load and store it in localStorage. This is standard Atlas behavior if the frontend supports token-in-URL; if not, we need the nginx sub_filter (Phase 3) to inject a small JS shim that reads the fragment and sets the auth cookie / localStorage.

**Acceptance criteria:**
- Logged-in active tenant navigates to `factorylm.com/api/cmms/login` → 302 redirect → lands on `cmms.factorylm.com` already logged in, no password prompt
- Pending or churned tenants hitting the route → 401 from `requireActive`
- URL fragment is not in server logs (fragment is client-only by HTTP spec)

**Security notes:**
- Access tokens in URL fragments are lower-risk than query params because they're never sent to the server, but they're visible in browser history. Alternative: have the redirect target be a one-time ticket endpoint on cmms.factorylm.com that exchanges the ticket for an auth cookie. Overkill for beta; revisit in Phase 7.
- The `requireActive` middleware is the authorization gate. If a user can reach `/api/cmms/login`, they've already proven they're an active tenant via JWT.

---

### Phase 3 — Brand Atlas via nginx reverse-proxy (2-3 hours)

**Scope:** Stand up `cmms.factorylm.com` as a rebranded proxy in front of `atlas-frontend:3000`. No Atlas code changes.

**What needs to happen on the VPS:**

1. **DNS** — add `cmms.factorylm.com A 165.245.138.91` (5 min in Namecheap/Cloudflare/whatever)

2. **Certbot** — issue a cert:
   ```bash
   certbot --nginx -d cmms.factorylm.com
   ```

3. **Nginx server block** — new file `/etc/nginx/sites-available/cmms.factorylm.com`:
   ```nginx
   server {
     listen 443 ssl http2;
     server_name cmms.factorylm.com;

     ssl_certificate /etc/letsencrypt/live/cmms.factorylm.com/fullchain.pem;
     ssl_certificate_key /etc/letsencrypt/live/cmms.factorylm.com/privkey.pem;

     # Serve FactoryLM branding override stylesheet BEFORE proxying to Atlas
     location = /factorylm-brand.css {
       alias /opt/mira/mira-web/public/factorylm-cmms-brand.css;
       add_header Cache-Control "public, max-age=300";
     }
     location = /factorylm-logo.svg {
       alias /opt/mira/mira-web/public/icons/mira-512.png;
     }

     location / {
       proxy_pass http://127.0.0.1:3100;  # atlas-frontend port
       proxy_set_header Host $host;
       proxy_set_header X-Real-IP $remote_addr;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       proxy_set_header X-Forwarded-Proto https;

       # HTML rewriting
       proxy_set_header Accept-Encoding "";  # disable gzip so sub_filter can work
       sub_filter_types text/html text/css application/javascript;
       sub_filter_once off;
       sub_filter '<title>Atlas CMMS</title>' '<title>FactoryLM CMMS</title>';
       sub_filter '<title>Atlas</title>' '<title>FactoryLM CMMS</title>';
       sub_filter 'Atlas CMMS' 'FactoryLM CMMS';
       sub_filter '>Atlas<' '>FactoryLM<';
       sub_filter '</head>' '<link rel="stylesheet" href="/factorylm-brand.css"><link rel="icon" href="/factorylm-logo.svg"></head>';
     }
   }

   server {
     listen 80;
     server_name cmms.factorylm.com;
     return 301 https://$host$request_uri;
   }

   # Legacy redirect
   server {
     listen 443 ssl http2;
     server_name cmms.factorylm.ai;
     ssl_certificate /etc/letsencrypt/live/cmms.factorylm.ai/fullchain.pem;
     ssl_certificate_key /etc/letsencrypt/live/cmms.factorylm.ai/privkey.pem;
     return 301 https://cmms.factorylm.com$request_uri;
   }
   ```

4. **`mira-web/public/factorylm-cmms-brand.css`** (new file, ~60 lines) — override CSS:
   ```css
   /* FactoryLM branding override for Atlas CMMS frontend */
   :root {
     --primary-color: #f0a000 !important;
     --primary-dark: #c47e00 !important;
     --accent-color: #00d4aa !important;
   }
   /* Logo swap */
   .app-logo img,
   header img[alt*="logo" i],
   .navbar-brand img {
     content: url('/factorylm-logo.svg') !important;
     height: 32px !important;
   }
   /* Hide any leftover "Powered by Atlas" footers */
   .powered-by,
   .footer-atlas-link { display: none !important; }
   /* Amber primary buttons */
   .btn-primary,
   button[type="submit"] {
     background: linear-gradient(180deg, #f5c542 0%, #f0a000 50%, #c47e00 100%) !important;
     border-color: #c47e00 !important;
     color: #0b0c0f !important;
   }
   ```

5. **Apply nginx config:**
   ```bash
   ssh vps
   cat > /etc/nginx/sites-available/cmms.factorylm.com << 'EOF'
   [contents above]
   EOF
   ln -s /etc/nginx/sites-available/cmms.factorylm.com /etc/nginx/sites-enabled/
   nginx -t && systemctl reload nginx
   ```

**Acceptance criteria:**
- `curl -I https://cmms.factorylm.com/` returns 200, HTML body contains "FactoryLM CMMS" in `<title>`
- Visit in browser: Atlas UI loads, shows FactoryLM logo top-left, amber primary buttons, no visible "Atlas" strings
- `cmms.factorylm.ai` → 301 → `cmms.factorylm.com` (old bookmarks still work)
- Login flow works end-to-end through the new domain

**Known limitations of sub_filter rebrand:**
- Cannot change the favicon baked into the JS bundle without injecting JS
- Cannot change copyright strings inside JSON API responses
- Some "Atlas" strings may be in JavaScript literals that slip through because sub_filter only matches raw HTML (not runtime string construction)
- Solution for residual "Atlas" strings: iterate — grep the live page source, add sub_filter rules for what's found

---

### Phase 4 — Post-payment email + `/activated` page links to CMMS (1 hour)

**Scope:** The existing `beta-activated.html` email focuses on "upload your first manual". Add a second CTA: "Open your FactoryLM CMMS". Same for the `/activated` page UI.

**Files to modify:**

1. **`mira-web/emails/beta-activated.html`**
   - Add a second button below the "Upload your first manual" CTA:
     ```html
     <a href="{{CMMS_URL}}" class="btn-secondary">
       Open your FactoryLM CMMS &rarr;
     </a>
     ```
   - `{{CMMS_URL}}` = `https://factorylm.com/api/cmms/login` (goes through the SSO redirect)

2. **`mira-web/src/lib/mailer.ts`**
   - Add `CMMS_URL` to the template variable map in `sendActivatedEmail`

3. **`mira-web/public/activated.html`**
   - Below the existing upload card, add a "CMMS" card:
     ```html
     <div class="activated-card">
       <h3>Your CMMS is live</h3>
       <p>Your work orders, assets, and PM schedules are ready in FactoryLM CMMS. Open it anytime.</p>
       <a href="/api/cmms/login" class="btn-primary">Open FactoryLM CMMS &rarr;</a>
     </div>
     ```
   - Match the existing HMI aesthetic (corner registration marks, amber, IBM Plex Serif italic)

**Acceptance criteria:**
- New beta signup → payment → email arrives with TWO buttons (upload + CMMS)
- Clicking the CMMS button redirects through `/api/cmms/login` → lands on `cmms.factorylm.com` logged in
- `/activated` page shows both cards side-by-side (or stacked on mobile)

---

### Phase 5 — factorylm.com dashboard + navbar entry points (1 hour)

**Scope:** Active tenants should be able to reach their CMMS from anywhere on factorylm.com.

**Files to modify:**

1. **`mira-web/public/cmms.html`** — the dashboard section shown to active tenants
   - Above or next to the existing demo kanban, add a prominent "Open FactoryLM CMMS" button linking to `/api/cmms/login`
   - Make it clear the preview is just a preview; the real thing is one click away

2. **`mira-web/public/index.html`** — topbar nav (when applicable)
   - For logged-in active tenants, swap "Join the Beta" CTA in the nav for "Open CMMS"
   - This requires client-side detection of the JWT cookie. Simplest: a small inline script that reads `document.cookie.includes('plg_jwt')` and swaps the nav CTA href + label

3. **Feature pages** (`/feature/*`) — the topbar nav is rendered by `feature-renderer.ts`; apply the same swap

**Acceptance criteria:**
- Active tenant visits factorylm.com/ → topbar nav shows "Open CMMS" instead of "Join the Beta"
- Same on /cmms, /feature/*, /blog, /blog/*
- Clicking it → `/api/cmms/login` → `cmms.factorylm.com` logged in

---

### Phase 6 — Testing + verification (1 hour)

**Scope:** End-to-end validation.

**Tests:**

1. **Stripe CLI test flow:**
   ```bash
   stripe trigger checkout.session.completed --override checkout_session:metadata.tenant_id=<test-uuid>
   ```
   Verify: `plg_tenants` row updated, Atlas company exists, demo data seeded.

2. **Playwright audit:** re-run `tools/audit/crawl.py` with `/api/cmms/login` added to the seed URL list (as an auth-gated endpoint expected to 401 unauthenticated). Confirm:
   - 0 console errors on updated `/activated`
   - `<main>` landmark still present on all pages
   - "Open CMMS" button visible on `/activated` and `/cmms` dashboard
   - `cmms.factorylm.com` responds 200 with "FactoryLM CMMS" in title

3. **Manual smoke test:**
   - Fresh beta signup (dummy email)
   - Stripe test checkout
   - Verify email arrives with 2 buttons
   - Click CMMS button → log in to `cmms.factorylm.com` without password prompt
   - Verify the 2 demo assets and 3 demo work orders are visible in the tenant's company
   - Log out, hit `cmms.factorylm.com` directly → should show Atlas login page (branded)
   - Log in with the tenant email + derived password (for debug; prod users never see the password) → same experience

**Files:** `tools/audit/crawl.py` (add new seed URL), no others.

---

## Risks & mitigations

### R1 — Atlas upstream image breaks on update

We use `intelloop/atlas-cmms-frontend:v1.5.0` pinned. If we ever update, the HTML structure may change and nginx `sub_filter` rules may no longer match "Atlas" in the expected places.

**Mitigation:** lock the image version (already done). On update, re-grep the new HTML for "Atlas" strings and update sub_filter rules. Add a smoke test that curls the branded site and asserts "FactoryLM CMMS" in the title.

### R2 — sub_filter misses a hardcoded "Atlas" in JavaScript

String literals in the compiled JS bundle won't be caught by `sub_filter_types` if they're built into the bundle at compile time. If the Atlas frontend dynamically constructs the title from a JS constant like `const APP_NAME = "Atlas"`, `sub_filter` cannot rewrite that.

**Mitigation:** inject a small `<script>` into the HTML via sub_filter that runs `document.title = "FactoryLM CMMS"` on load and optionally MutationObserver-watches for "Atlas" text in the DOM and replaces it. Get as far as we can with sub_filter, then close the remaining gaps with a JS shim.

### R3 — GPL-3.0 compliance if we ever modify the image

Right now we don't modify Atlas — we only proxy it. If we ever fork `intelloop/atlas-cmms-frontend` to make deeper branding changes, we must publish the modified source under GPL-3.0.

**Mitigation:** stay on the reverse-proxy branding path as long as possible. If a fork becomes necessary (e.g., custom features), publish the fork under GPL-3.0 in a public FactoryLM GitHub repo.

### R4 — Password derivation key rotation is a manual batch job

If `ATLAS_PASSWORD_DERIVATION_KEY` is ever compromised, every tenant's Atlas password is compromised. Rotation requires iterating every active tenant and calling Atlas's password-change endpoint (does it have one?).

**Mitigation for beta:** treat the key like any other master secret — same trust level as `PLG_JWT_SECRET`. If compromised, write a one-time batch reset script that calls Atlas's `/api/users/{id}/change-password` (if it exists) or uses the admin account to reset each user. Accept that rotation is disruptive.

### R5 — Atlas signup failures break the payment flow

If Atlas is temporarily down when a payment comes in, `signupUser` throws, and the webhook either (a) returns 500 back to Stripe (which retries) or (b) continues without Atlas. Continuing without Atlas means the tenant is active in mira-web but has no CMMS — confusing UX.

**Mitigation:** Phase 1 code path catches the Atlas error, marks `atlas_provisioning_status = 'failed'`, still sets tier = active, returns 200 to Stripe, and logs to Langfuse. A background retry job (cron or on next login) retries the provisioning. User sees "Your CMMS is provisioning..." on `/activated` until it succeeds.

---

## Open questions for Mike

I need answers to these before executing. Default answers in parens — tell me if any are wrong.

1. **Subdomain — `cmms.factorylm.com` OK?**
   (Default: yes, replaces `cmms.factorylm.ai` with 301 redirect for legacy bookmarks.)

2. **`lastName` field — Atlas requires one; what should we use?**
   (Default: empty string `""`, or `"Ops"` as a placeholder. We can expose it later if we add a profile edit page.)

3. **`companyName` — currently we use the tenant's `company_name` field. What if it's empty at signup?**
   (Default fallback: `"<email_prefix>'s Plant"`. E.g., `"mike's Plant"`.)

4. **Demo data — seed 2 assets + 3 work orders per tenant on signup, or leave Atlas empty and let them start fresh?**
   (Default: seed. Gives them something to see immediately; empty CMMS is intimidating.)

5. **Password rotation strategy — ship without a rotation script, accept that if the key leaks we manually reset?**
   (Default: yes for beta; document the risk in a security note; build the rotation script only if we outgrow beta.)

6. **Order of phases — all 6 in one sprint, or ship Phase 1+4 first (minimum viable: provision Atlas on payment, link from email)?**
   (Default: all 6 but merge Phase 1+2+4 first as a single "minimum viable CMMS integration" PR. Phase 3 nginx rebrand can ship the same day. Phase 5 dashboard buttons a day later. Phase 6 is verification.)

---

## Total effort estimate

| Phase | Effort | Prereqs |
|---|---|---|
| 1. Webhook provisions Atlas | 2-3 hr | Doppler key added |
| 2. SSO login route | 1-2 hr | Phase 1 |
| 3. Nginx branding + new subdomain | 2-3 hr | DNS propagated |
| 4. Email + /activated CTAs | 1 hr | Phase 2 |
| 5. Dashboard + navbar buttons | 1 hr | Phase 2 |
| 6. End-to-end test + audit | 1 hr | All of above |
| **Total** | **8-11 hours** | |

Call it a one-day sprint if you're available for synchronous testing. Spread across 2-3 days if you want to batch screenshots + content work alongside.

---

## What ships out of this

- Every new paying beta tenant gets a real FactoryLM CMMS account provisioned at payment time
- They can reach it from the welcome email, from `/activated`, from the `/cmms` dashboard, and from the topbar of any factorylm.com page once logged in
- The CMMS lives at `cmms.factorylm.com` with FactoryLM branding (amber, logo, "FactoryLM CMMS" title) without forking the upstream image
- Legacy `cmms.factorylm.ai` bookmarks still work via 301
- Atlas admin can still hit `cmms.factorylm.com` directly to manage everything
- `mira-mcp` Mira-chat integration with Atlas continues to work unchanged (REST is stable)

## What explicitly does NOT ship

- Multi-org switching (one tenant = one Atlas company; no switcher UI)
- Deep branding (icons inside Atlas, email notifications from Atlas, PDF exports) — those would need a fork
- SSO via OAuth/SAML (staying on the password-derivation path for beta)
- Self-service password reset in Atlas (admin can do it via API; users don't see this)
- Tenant provisioning retry UI (failed provisioning = log + manual retry for now)
- Live production data migration (every tenant starts with the seeded demo data only)

---

## Verification end state

After all 6 phases ship, the following should all be green:

1. `curl -sI https://cmms.factorylm.com/` → 200, title contains "FactoryLM"
2. `curl -sI https://cmms.factorylm.ai/` → 301 → cmms.factorylm.com
3. Stripe test checkout → `plg_tenants.atlas_company_id > 0` for the new tenant
4. Atlas API `GET /companies/{id}` with admin token → returns the new tenant's company
5. `curl -I https://factorylm.com/api/cmms/login` with an active tenant JWT → 302 to cmms.factorylm.com
6. Same URL unauth'd → 401
7. Playwright crawl: 0 console errors, all `<main>` landmarks present, all 3 feature pages + all 14 blog pages + `/cmms` + `/activated` still 200
8. Manual: fresh signup → payment → email arrives with 2 CTAs → both buttons work
