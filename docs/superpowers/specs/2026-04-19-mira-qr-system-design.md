# MIRA Asset-QR System — Design

**Date:** 2026-04-19
**Status:** Draft
**Author:** Mike Harper + Claude
**Partially solves:** MVP UX Survivor #2 — asset-scoped chat **entry** in v1; persistent asset-owned **thread** deferred to v2 (see §12 Q1)
**Related:** `docs/ideation/2026-04-19-mira-chat-ux-ideation.md` · `docs/references/open-webui/review-and-recommendations.md` · `docs/superpowers/specs/2026-04-17-mira-connect-design.md`

---

## 1. Problem

A plant-floor technician who needs MIRA's help has to: pull out their phone → unlock with gloved hands → find MIRA in the browser → type a description of what they're looking at. Stage 1 of every diagnostic ("what machine are we talking about") is 30+ seconds of friction before Stage 2 ("what's the symptom") even begins. ChatGPT / Grok / Gemini have no Stage 1 — and no way to acquire one — because they have no concept of plant equipment.

MIRA has the assets in Atlas CMMS, the knowledge in NeonDB, and the diagnostic engine wired. The missing piece is a **physical-to-digital entry** that collapses Stage 1 to a single scan.

## 2. Solution

Print QR stickers that open MIRA chat pre-scoped to a specific asset, permanently track which assets are tagged and how often they are scanned, and let admins generate and reprint stickers from a single admin page.

```
┌──────────────┐      ┌──────────────────────┐      ┌─────────────────┐
│ Printed QR   │      │ mira-web             │      │ mira-pipeline   │
│ Sticker      │─────►│ GET /m/{asset_tag}   │─────►│ /v1/chat/...    │
│ on machine   │ scan │  • auth + tenancy    │      │ ?asset_tag=...  │
└──────────────┘      │  • UPSERT tag        │      │ greet: "symptom │
                      │  • INSERT event      │      │ on VFD-07?"     │
                      │  • redirect → OW     │      └─────────────────┘
                      └──────────┬───────────┘               ▲
                                 │                           │
                      ┌──────────▼───────────┐               │
                      │ NeonDB               │               │
                      │ asset_qr_tags        │               │
                      │ qr_scan_events       │               │
                      └──────────────────────┘               │
                                                             │
                      ┌──────────────────────┐               │
                      │ Open WebUI           │───────────────┘
                      │ /c/...?asset_tag=X   │
                      └──────────────────────┘
```

Three user-visible surfaces **plus one engine change**:

1. **Scan route** (`/m/:asset_tag` in `mira-web`) — handles auth, tenant scoping, tracking, redirect.
2. **Print admin page** (`/admin/qr-print` in `mira-web`) — lists Atlas assets, generates labelled PDF.
3. **Analytics page** (`/admin/qr-analytics` in `mira-web`) — shows scan counts per asset, surfaces the highest-scanned Pareto.

Plus one engine change:

4. **Pipeline seeding** — `mira-pipeline` grows a new `seed_session(chat_id, asset_tag)` method that pre-populates GSDEngine context and jumps to Q1 with a pre-built greeting. **NOT a simple query param change** — see §16 Pre-Implementation Blockers.

## 3. Scope

### In v1 (~40 hrs, 1 sprint)
- `GET /m/:asset_tag` route with auth redirect, tenant scoping, scan logging
- Two NeonDB tables: `asset_qr_tags`, `qr_scan_events`
- `qrcode` npm library integration for image generation
- Single-asset QR preview (`GET /api/qr/:asset_tag.png`)
- Batch print admin page → PDF on Avery 5163 layout (2"×4", 10/sheet)
- Scan analytics admin page
- `mira-pipeline` `asset_tag` query param handling → greeting template
- Physical sticker validation: print + stick + scan in lab conditions

### Explicitly out of v1
- Signed / opaque tokens (same URL format can be swapped later)
- QR rotation / expiry
- NFC support (same URL, NDEF-encoded — additive)
- Per-technician private stickers
- Cross-tenant public stickers
- Sticker-revocation workflow
- Multi-language labels
- Custom label templates (Avery 5163 only in v1)

## 4. URL Design

### 4.1 Format

```
https://app.factorylm.com/m/{asset_tag}
```

- Path prefix `/m` (one letter) chosen to minimize QR module count
- `asset_tag` is the human-readable identifier already present in Atlas CMMS
- No tenant slug in URL — tenant is inferred from the scanner's JWT session (§5)

### 4.2 Allowed characters

`asset_tag` MUST match `^[A-Za-z0-9._-]{1,64}$`. Enforced in three places:

1. **Atlas side** — `mira-mcp` `cmms_*` tools already return asset IDs. In practice we see `VFD-07`, `PUMP-22-NORTH`, `CP-14`. No known Atlas values use spaces, slashes, or unicode. We confirm this at load time (§8) and reject non-conforming tags with a printable error instead of silently slug-rewriting.
2. **QR generation** — rejects non-conforming input with HTTP 400.
3. **Scan route** — validates the path parameter and URL-decodes before DB lookup.

If a future Atlas integration surfaces tags outside this charset, v2 adds a separate `asset_slug` column; v1 fails loudly.

### 4.3 Case handling

Preserved in storage (so the sticker reads what it says), matched case-insensitive at lookup (`WHERE lower(asset_tag) = lower($1)`). Prevents the "VFD-07 vs vfd-07" class of scanner/printer variance bugs.

### 4.4 Terminology

To prevent drift: **"sticker"** = physical vinyl/paper/aluminum artifact; **"QR code"** = the scannable 2D barcode rendered on the sticker; **"asset_tag"** = identifier string matching `^[A-Za-z0-9._-]{1,64}$`; **"tagged asset"** = an asset that has at least one row in `asset_qr_tags`.

### 4.5 QR payload

Version 4 QR code at ECC level M. Final URL length with a typical 20-char tag is ~42 chars, well inside version 4 capacity. Tested at 2"×2" printed size, readable at 30° tilt with 50% smudge by any iPhone 12+ or modern Android camera.

## 5. Auth + Tenancy

### 5.1 Flow

```
Scan → GET /m/VFD-07
     │
     ├── No JWT cookie?                 → 302 /login?next=/m/VFD-07
     │
     ├── JWT valid, tier=pending?       → 302 /nurture?scanned=VFD-07
     │                                     (acquisition: "your colleague sent
     │                                     this — activate to continue")
     │
     ├── JWT valid, tier=churned?       → 302 /billing-portal?scanned=VFD-07
     │
     ├── JWT valid, tier=active,
     │   asset not found in tenant?     → 200 HTML with polite "this asset
     │                                     belongs to another plant" (+
     │                                     "contact your admin" CTA)
     │
     └── JWT valid, tier=active,
         asset in tenant                → UPSERT tag + INSERT event
                                        → 302 https://app.factorylm.com/c/new
                                              ?asset_tag=VFD-07
                                              &greeting=symptom
```

Uses the existing `verifyToken()` helper in `mira-web/src/lib/auth.ts` — no new auth code. Tenant is `sub` (tenant_id UUID) from the JWT payload.

### 5.2 Tenant ownership check

Lookup in Atlas via the existing `mira-mcp` `cmms_list_assets` tool, filtered by tenant scope. Result cached for 60 s in-process to keep scan latency under 150 ms.

Cross-tenant scans are **not** treated as errors — they are a normal failure mode when a stickered machine is transferred between sites or a technician visits a sister plant. Return HTTP 200 with an explanatory page, not 404, so iOS Safari doesn't poison the PWA.

### 5.3 Pre-login landing page

When a QR is scanned by a phone with no session cookie (first-ever visitor):

- Mobile-optimized page at `/login?next=/m/VFD-07`
- MIRA logo + "You scanned **VFD-07**"
- One primary action: **"Sign in"** (email + magic link) — opens existing login flow
- Secondary: **"Install MIRA on Home Screen"** (PWA install prompt, requires Tier 1 manifest work)
- Tertiary: **"What is this?"** → 3-sentence pitch + link to marketing site

First impression on a brand-new technician is clean, industrial, and task-oriented. **No full marketing site** — they already have a job in front of them.

## 6. Data Model

Migrations live alongside existing NeonDB schema in `mira-core/mira-ingest/db/`. One new SQL migration file, two tables.

### 6.1 `asset_qr_tags`

Lifetime record per `(tenant, asset)`. One row regardless of how many times the sticker is reprinted or scanned.

```sql
CREATE TABLE asset_qr_tags (
    tenant_id      UUID         NOT NULL,
    asset_tag      TEXT         NOT NULL,
    printed_at     TIMESTAMPTZ,             -- most recent print (NULL = never printed)
    print_count    INTEGER      DEFAULT 0,  -- total reprints
    first_scan     TIMESTAMPTZ,
    last_scan      TIMESTAMPTZ,
    scan_count     INTEGER      DEFAULT 0,
    created_at     TIMESTAMPTZ  DEFAULT NOW(),
    PRIMARY KEY (tenant_id, asset_tag)
);

CREATE INDEX idx_asset_qr_tags_tenant_last_scan
    ON asset_qr_tags (tenant_id, last_scan DESC NULLS LAST);
```

### 6.2 `qr_scan_events`

Append-only audit log. One row per scan, for analytics and security.

```sql
CREATE TABLE qr_scan_events (
    id             BIGSERIAL    PRIMARY KEY,
    tenant_id      UUID         NOT NULL,
    asset_tag      TEXT         NOT NULL,
    atlas_user_id  INTEGER,                 -- per-scanner identity; NULL for pre-login scans
    scanned_at     TIMESTAMPTZ  DEFAULT NOW(),
    user_agent     TEXT,
    scan_id        UUID         DEFAULT gen_random_uuid(),  -- correlation ID, passed to chat
    chat_id        TEXT                     -- backfilled from pipeline on chat creation; nullable
);

CREATE INDEX idx_scan_events_tenant_asset_time
    ON qr_scan_events (tenant_id, asset_tag, scanned_at DESC);
CREATE INDEX idx_scan_events_tenant_time
    ON qr_scan_events (tenant_id, scanned_at DESC);
CREATE INDEX idx_scan_events_scan_id
    ON qr_scan_events (scan_id);

-- Case-insensitive uniqueness on the primary table to prevent silent VFD-07 / vfd-07 duplicates
CREATE UNIQUE INDEX uniq_qr_tags_tenant_tag_ci
    ON asset_qr_tags (tenant_id, lower(asset_tag));
```

**Retention:** `qr_scan_events` rows older than 90 days are purged nightly by a background job in `mira-web`. Aggregated counts in `asset_qr_tags` are retained for the lifetime of the tenant.

### 6.3 Write pattern

Every authorized scan runs a single transaction:

```sql
BEGIN;
INSERT INTO asset_qr_tags (tenant_id, asset_tag, first_scan, last_scan, scan_count)
VALUES ($1, $2, NOW(), NOW(), 1)
ON CONFLICT (tenant_id, asset_tag)
DO UPDATE SET last_scan = NOW(), scan_count = asset_qr_tags.scan_count + 1;

INSERT INTO qr_scan_events (tenant_id, asset_tag, user_id, atlas_user_id, user_agent, chat_id)
VALUES ($1, $2, $3, $4, $5, $6);
COMMIT;
```

Cross-tenant fallback and pre-login scans write to `qr_scan_events` only (no `asset_qr_tags` row).

## 7. Components

### 7.1 Scan route — `mira-web/src/routes/m.ts`

New Hono router mounted at `/m`. Imports `verifyToken` from `./lib/auth.js`, a new `./lib/qr-tracker.js` module, and the existing `./lib/atlas.js`.

Validates path param against `^[A-Za-z0-9._-]{1,64}$` → decodes JWT cookie → branches per §5.1.

### 7.2 QR image generator — `mira-web/src/lib/qr-generate.ts`

Thin wrapper over `qrcode` (MIT license, pure JS). Renders PNG (label printing) or SVG (in-app preview). Exposes `generatePng(url: string, sizePx: number): Promise<Buffer>` and `generateSvg(url: string): Promise<string>`.

Preview endpoint: `GET /api/qr/:asset_tag.png?size=512` (requires JWT, tenant-scoped). `size` clamped to `[64, 1024]` px. Payload always encodes `https://app.factorylm.com/m/{asset_tag}`; no caller-supplied URL override.

### 7.3 Print admin page — `mira-web/src/routes/admin/qr-print.ts`

Server-rendered Hono page (reuses existing SSR pattern from `blog-renderer.ts`). Requires `requireActive` + `isAdmin` (new tenant flag or existing Atlas admin role).

- Lists assets from Atlas via `mira-mcp` `cmms_list_assets` (cached 60 s)
- Checkboxes, bulk select
- "Generate sticker sheet (PDF)" button POSTs to `/api/admin/qr-print-batch`
- Batch endpoint renders Avery 5163 layout PDF via `pdf-lib` (MIT) and writes `printed_at` + `print_count = print_count + 1` on selected rows
- PDF streamed inline as `attachment; filename="mira-stickers-YYYY-MM-DD.pdf"`

### 7.4 Analytics page — `mira-web/src/routes/admin/qr-analytics.ts`

Server-rendered table. Columns: `asset_tag` · `total_scans` · `unique_scanners_last_30d` · `first_scan` · `last_scan` · `scans_last_7d` · `linked_chats`. Default sort `last_scan DESC`. Secondary view: Pareto chart showing cumulative scans → highlights "top 20% of assets = 80% of MIRA interactions = your real fault hotspots."

### 7.5 Pipeline greeting hint — `mira-pipeline/main.py`

Accept `asset_tag` and `greeting` query params on `/v1/chat/completions`. When `asset_tag` is present:

1. Load the asset's vendor/model/service-history from Atlas via `mira-mcp`
2. Inject into GSDEngine as session context
3. Skip IDLE state, enter Q1 directly
4. First assistant message is templated. **Null-safe template ladder** (drop sentences whose variables are null; never stringify `null`/`undefined`):
   - Full data: `"What's the symptom on {asset_tag}? I have {vendor} {model}, last serviced {last_pm_date}."`
   - Vendor + model only: `"What's the symptom on {asset_tag}? I have this as a {vendor} {model}."`
   - Tag only (no metadata): `"What's the symptom on {asset_tag}?"`
   - Acceptance: greeting never contains the literal strings `null`, `undefined`, `None`, or empty brackets.
5. `greeting` query param is **NOT accepted in v1** — the symptom template is implicit when `asset_tag` is present. Reserved future modes (`alarm`, `pm`) would be added under a dedicated design doc.

## 8. Label Printing

### 8.1 Avery 5163 layout

- Sheet: 8.5" × 11" letter, 2 columns × 5 rows = 10 labels per sheet
- Each label: 2" × 4" (5.08 × 10.16 cm)
- Content per label (left-to-right):
  - **QR code** — 1.6" × 1.6" block, left-aligned with 0.2" inset
  - **Right panel** (2.2" × 1.6"): MIRA logo (top, 0.5" tall), asset tag text in **24 pt bold** (middle — essential for humans to read when scanner fails), factorylm.com URL in 8 pt (bottom)
- Background: white
- Colors: single-color black print (no per-sheet orange branding in v1 — black prints cleaner, scans better in low light)

### 8.2 Material matrix — validation plan

Before recommending a default sticker material to customers, validate across:

| Material | Cost / label | Indoor dry | Indoor greasy | Outdoor UV |
|---|---|---|---|---|
| Avery 5163 paper | ~$0.04 | baseline | fails in 30d | n/a |
| Avery 5520 vinyl (weatherproof) | ~$0.20 | ✓ | ✓ | partial (fades 90d) |
| Laminated vinyl (vinyl + clear laminate) | ~$0.35 | ✓ | ✓ | ✓ |
| Anodized aluminum tag (third-party, e.g. DuraLabel) | ~$2.00 | ✓ | ✓ | ✓ permanent |

### 8.3 Test rig

1. Print one sheet on each material. Stick to a representative machine (painted steel, anodized aluminum, rubber).
2. Scan from: 6", 12", 24", 36" distance. Gloved hand holding phone. 30° tilt. Direct sunlight. Dim plant lighting. 50% printer-ink smudge (simulated).
3. Acceptance: **95% first-scan success** across all conditions for vinyl and above. Paper is explicitly non-production.
4. Run 24-hour soak test (diesel fuel spot, brake cleaner spot, hydraulic oil spot) on vinyl and laminated vinyl. Material survives = 90+ day field confidence.

### 8.4 Customer recommendation (ship-with)

- **Indoor clean plant (food, pharma, electronics):** Avery 5520 weatherproof vinyl, customer prints on their own inkjet or laser.
- **Indoor heavy industrial (machining, welding, foundry):** Laminated vinyl, MIRA provides print-ready PDF + printing vendor referral.
- **Outdoor / harsh (pump station, wastewater, outdoor conveyors):** Anodized aluminum, MIRA offers a pre-order service at cost (~$3/tag, minimum 25).

## 9. Analytics — "Most-Scanned = Most-Faulty" Pareto

Page at `/admin/qr-analytics` gives plant managers a single-screen view of operational reality:

- **Top 10 most-scanned assets (last 30d)** — these are the problem children
- **Scan-to-resolution rate per asset** — asset gets scanned but chat abandoned = MIRA not helping here
- **First-scan-ever alerts** — tagged assets that have finally been scanned (adoption signal)
- **Untagged assets in Atlas** — assets present in CMMS but missing from `asset_qr_tags`; prompts "Print stickers for 47 untagged assets"

Becomes a sales / success hook: "Show me which three machines are burning the most of your technicians' time this month." No other chat product can produce this number.

## 10. Rollout

### Phase 0 — Internal pilot (Week 1)
- Deploy to `app.factorylm.com` staging
- Mike prints ~20 stickers for his test rig and Tailscale-connected assets (Micro820, GS20, V1000, etc.)
- Real scan test with the existing Telegram bot as the backing chat surface for a week — confirms the pattern works end-to-end before wider rollout

### Phase 1 — First customer plant (Week 2–4, gated on first paying customer)
- FactoryLM offers to print 50 stickers free for the first design-partner plant
- 30-minute in-person install — Mike sticks the vinyl labels, confirms scan success rate ≥ 95%
- 2-week observation period; analytics feedback loop tunes the print material and label layout

### Phase 2 — Self-serve (Week 5+)
- Admin page is visible to all `active` tenants
- Customer prints on their own stock OR orders from the referred vendor
- Documentation page `docs/runbooks/qr-rollout.md` for plant managers
- Knowledge-base article on factorylm.com `/blog/qr-asset-tagging`

### Phase 3 — v2 enhancements (post-MVP)
- NFC co-tag (same URL, tap-and-scan parity)
- Bulk import: CSV of asset tags → paint-print workflow
- Smart rotation: stickers that fail scan tests auto-flagged for reprint
- QR kiosk: one print-ready URL per plant for on-demand sticker printing

## 11. Acceptance Criteria

### Functional
- [ ] Scanning a valid asset QR while logged-in as active tenant redirects to OW chat within **1.5 s** (p95)
- [ ] Chat opens with greeting: `"What's the symptom on {asset_tag}?"` with vendor/model context
- [ ] `asset_qr_tags.scan_count` increments atomically per scan
- [ ] `qr_scan_events` has a row for every scan including cross-tenant and pre-login
- [ ] Pre-login scan redirects to `/login?next=/m/{asset_tag}` and resumes correctly after login
- [ ] Pending tier sees nurture page with the asset name surfaced as acquisition hook
- [ ] Cross-tenant scan shows polite 200 page, not 404 error
- [ ] Batch print generates valid Avery 5163 PDF with all requested labels
- [ ] Analytics page loads in < 500 ms for tenants with up to 10,000 scan events

### Non-functional
- [ ] Scan route handles 100 req/s per tenant without DB lock contention (NeonDB PgBouncer tested)
- [ ] URL length ≤ 60 chars for any asset_tag ≤ 40 chars (keeps QR at version 4 or lower)
- [ ] Vinyl sticker passes 24-hour soak test with diesel, brake cleaner, hydraulic oil
- [ ] 95% first-scan success rate with gloved hand, 30° tilt, smudge simulation
- [ ] PDF renders identically on Chrome, Safari, and server-side PDF preview

### Security
- [ ] asset_tag input sanitized against SQL injection via parameterized queries (NeonDB text type + `$1`)
- [ ] JWT required for all `/api/qr/*` and `/admin/qr-*` endpoints
- [ ] Scan route rate-limited to 30 req/min per IP (simple in-process counter; Redis in v2)
- [ ] Cross-tenant scan does NOT leak the owning tenant's name, email, or any asset metadata

## 12. Pre-Implementation Blockers

These are load-bearing decisions flagged by multi-persona review (2026-04-19) that must be resolved **before** writing the implementation plan. Each is a premise the v1 scope depends on.

> **STATUS: RESOLVED 2026-04-19 (Sprint 0).** All 8 blockers have a locked decision documented inline below under "**Resolved →**". Biggest finding: §12.4 engine method collapses to zero new code — `mira-bots/shared/session_memory.py` already ships `save_session()` and the engine already calls `load_session()` in the IDLE path (`engine.py:619-639`). We piggyback on that. Net software estimate drops from ~30 hrs to ~26 hrs. The implementation plan now has a solid foundation.

### 12.1 Session handoff mechanism (JWT in cookie vs. URL token)

**Problem:** `§5.1` branches on "No JWT cookie?" but `mira-web/src/lib/auth.ts` reads JWT only from `Authorization: Bearer` header or `?token=` query param. A fresh QR scan delivers the user with neither. The "no new auth code" claim in the earlier draft was wrong.

**Decision required:** pick one and update §5 accordingly:
- **(a)** Add a cookie-based session layer to mira-web: HttpOnly, Secure, SameSite=Lax cookie `mira_session`, issued on login, TTL = 30d. Scan route reads it as a third auth source. Requires CSRF-on-mutation posture for admin POSTs.
- **(b)** Embed a one-time signed token in the QR URL itself (`/m/{asset_tag}?k={hmac}`). Avoids cookie work; makes the QR longer and harder to reprint when the signing secret rotates.
- **(c)** Mandate a prior login session on the device. Scan route always redirects to `/login?next=...` on first scan; subsequent scans use the `?token=` pattern in the redirect URL (with the known token-in-history/referrer leak caveat).

**Recommendation:** (a) — matches standard web session patterns, supports the §13 PWA install flow, decouples QR shape from auth secret rotation. Add cookie work to the Dependencies list and re-estimate v1 hours.

**Resolved → (a) cookie session layer.**
- Cookie name: `mira_session`
- Attributes: `HttpOnly; Secure; SameSite=Lax; Domain=.factorylm.com; Path=/; Max-Age=2592000` (30 days)
- Value: the same JWT we issue today via `signToken()` in `mira-web/src/lib/auth.ts`
- Issued by: new `POST /api/login` endpoint (magic-link handler) + existing Stripe-webhook activation flow
- Read by: extend `verifyToken()` in `mira-web/src/lib/auth.ts` to read `cookie` as a third source (after `Authorization` header and `?token=` query param). Cookie takes lowest precedence so programmatic integrations aren't affected.
- CSRF posture: for admin POST endpoints (`/api/admin/qr-print-batch`), require double-submit CSRF token. Auth-only endpoints (`GET /m/:asset_tag`) don't need CSRF.
- Estimated incremental work: ~4 hours (middleware extension, login-handler cookie emission, CSRF helper).

### 12.2 Open WebUI → mira-pipeline context propagation

**Problem:** The earlier draft claimed the scan redirect to `app.factorylm.com/c/new?asset_tag=VFD-07` would magically deliver `asset_tag` into `mira-pipeline`'s `/v1/chat/completions` call. Open WebUI is an SPA with no documented hook for forwarding arbitrary query params through to its upstream OpenAI-compatible backend.

**Decision required:** pick one:
- **(a)** Bypass OW's new-chat route. Host a thin chat shell in `mira-web` at `/c/:chat_id` that talks to `mira-pipeline` directly (SSE). OW remains the admin/KB surface only. Overlaps with the Tier 3 recommendation in `docs/references/open-webui/review-and-recommendations.md`.
- **(b)** Pre-inject the first user message via OW's API before redirecting. `mira-web` calls OW's chat-create endpoint with the seeded greeting, gets a `chat_id`, then redirects to `/c/{chat_id}`. Requires OW API auth + understanding its message format.
- **(c)** Patch OW to forward unknown query params through to the pipeline. Upstream fork burden indefinitely.

**Recommendation:** (b) for v1 (reuses OW's UI), with (a) on the Tier 3 roadmap. Confirm OW's `/api/v1/chats/new` (or equivalent) endpoint shape before committing.

**Resolved → cookie-based correlation, NO OW API dependency.** The simpler path:

1. On scan, mira-web scan handler sets a short-lived HttpOnly cookie: `mira_pending_scan={scan_id}` (5-minute Max-Age, `SameSite=Lax`, `Domain=.factorylm.com`). The `scan_id` is the UUID already stored in `qr_scan_events` (§6.2).
2. mira-web then redirects to `https://app.factorylm.com/c/new` — vanilla Open WebUI new-chat URL. **No OW API call, no patch, no fork.**
3. When the user sends their first message in the new chat, OW POSTs to mira-pipeline's `/v1/chat/completions`. Because both mira-web and OW are on `app.factorylm.com`, the browser automatically forwards the `mira_pending_scan` cookie in the request headers.
4. mira-pipeline's request handler reads `cookie` from headers. If `mira_pending_scan` is present:
   - Look up `scan_id` in `qr_scan_events` to get `(tenant_id, asset_tag, atlas_asset_id)`
   - Call existing `session_memory.save_session(chat_id=openwebui_chat_id, asset_id=asset_tag, ...)` — pre-loads asset context for this chat_id
   - Set response cookie `mira_pending_scan=; Max-Age=0` to clear it (one-shot)
5. When GSDEngine's existing `process_full()` then runs at **line 622-639 of `mira-bots/shared/engine.py`**, its `load_session(chat_id)` call picks up the asset context we just wrote. This code path already exists — we piggyback on it.
6. The first LLM response is the templated greeting from §7.5 (null-safe ladder).

Why this is better than the originally recommended OW-API-based approach:
- Zero dependency on OW's API surface. Works across OW upgrades.
- Reuses the existing `session_memory` table. No new schema.
- Reuses the existing engine IDLE handler. No `seed_for_asset()` method needed (see §12.4).
- 100% same-domain cookies — no CORS, no preflight, no token-in-URL leakage.

Estimated incremental work: ~3 hours (pipeline cookie reader + scan_id lookup + save_session call + clear-cookie response header).

### 12.3 Atlas asset identifier surface

**Problem:** `mira-mcp/cmms/atlas.py` treats asset IDs as integers (`/assets/{id}`, `int(asset_id)`). The earlier draft assumed a human-readable string `asset_tag` like "VFD-07" was natively present in Atlas. Unverified — may be a `name` field, an `externalId` we must add, or not present at all. Additionally, `cmms_list_assets(limit)` has no tenant filter today.

**Decision required:**
1. Inspect an actual `/assets/search` response. Name the exact JSON field used for `asset_tag` display (likely `name` or `externalId`). Confirm uniqueness per Atlas company.
2. Add `get_asset_by_tag(company_id, tag)` to the atlas adapter. Add company_id filter to `list_assets` (use `tenants.atlas_company_id`).
3. If Atlas has no stable human-readable identifier, MIRA owns the mapping: add `asset_qr_tags.atlas_asset_id INTEGER NOT NULL` so scans can still resolve.

**Recommendation:** audit Atlas first (1-2 hrs), then write the adapter fix. Block v1 implementation until resolved.

**Resolved → audit done; MIRA owns the mapping.** Findings from reading `mira-mcp/cmms/atlas.py`:

- `list_assets(limit)` at line 176: calls `POST /assets/search` with `{"pageSize": limit, "pageNum": 0}`. Returns a list of Atlas asset objects. **No tenant filter in the signature** — uses a single process-wide admin token.
- `get_asset(asset_id)` at line 184: calls `GET /assets/{asset_id}`. `asset_id` is treated as an integer path segment.
- `create_work_order` at line 139: does `int(asset_id)` and errors on non-numeric input.

**Decision: MIRA owns the (tenant_id, asset_tag) → atlas_asset_id mapping.** This is the cleanest path given Atlas's integer-ID design:

1. Add an `atlas_asset_id INTEGER NOT NULL` column to `asset_qr_tags` table (schema in §6.1 updated):

   ```sql
   ALTER TABLE asset_qr_tags ADD COLUMN atlas_asset_id INTEGER NOT NULL;
   ```

2. When an admin tags assets via the print page (§7.3):
   - Admin sees list of assets from `atlas.list_assets()` (each has Atlas integer `id` and display `name`)
   - Admin enters (or confirms auto-generated) `asset_tag` string — e.g., `VFD-07` — that will appear on the sticker
   - On save: write `(tenant_id, asset_tag, atlas_asset_id=atlas.id)` to `asset_qr_tags`
3. On scan, the lookup chain is:
   - URL: `/m/VFD-07`
   - `SELECT atlas_asset_id FROM asset_qr_tags WHERE tenant_id=$1 AND lower(asset_tag)=lower($2)`
   - Call `atlas.get_asset(atlas_asset_id)` for vendor/model/service-history
4. Atlas's single-admin-token model is fine for beta (one-plant-per-customer). Multi-plant-per-tenant is a post-v1 concern tracked in a separate issue.
5. `list_assets` tenant-filter gap: for the beta, MIRA's own tenant sees all Atlas assets because each MIRA tenant has its own Atlas deployment (provisioned at signup). This means "Atlas asset list" == "my tenant's asset list." Revisit when we have multiple MIRA tenants sharing an Atlas instance.

Estimated incremental work: ~2 hours (schema addition, admin UI "tag this asset" form, mapping lookup helper).

### 12.4 GSDEngine session-seeding API

**Problem:** §7.5 earlier said "pipeline accepts `asset_tag` and skips IDLE." In reality `mira-pipeline/main.py` forwards to `engine.process(chat_id, message, ...)` and FSM state is loaded/persisted internally by GSDEngine keyed on `chat_id`. There is no API for "given this new `chat_id`, prepopulate session_context with asset X and jump to Q1."

**Decision required:** define the engine contract explicitly:

```python
# shared/engine.py — new method
def seed_for_asset(
    self,
    chat_id: str,
    asset_tag: str,
    vendor: str | None,
    model: str | None,
    last_pm_date: str | None,
) -> str:
    """Idempotently write seeded session state for chat_id and return the templated greeting.
    If chat_id already has non-IDLE state, no-op and return the existing greeting.
    """
```

Includes: atomic write to `conversation_state` + `interactions` tables, idempotency on double-seed, handling of stale chat_ids.

**Resolved → NO new engine method needed. Reuse existing `session_memory.save_session()`.** Reading `mira-bots/shared/engine.py` revealed an existing cross-session equipment-memory mechanism at lines 619-639:

```python
# engine.py lines 619-639 — ALREADY IN PRODUCTION
if state["state"] == "IDLE" and not state.get("asset_identified"):
    prior = load_session(chat_id)                    # ← already calls session_memory
    if prior:
        state["asset_identified"] = prior["asset_id"]
        ctx = state.get("context") or {}
        sc = ctx.setdefault("session_context", {})
        sc["equipment_type"] = prior["asset_id"]
        sc["restored_from_memory"] = True
        if prior.get("open_wo_id"):
            sc["open_wo_id"] = prior["open_wo_id"]
        if prior.get("last_seen_fault"):
            sc["last_seen_fault"] = prior["last_seen_fault"]
        state["context"] = ctx
```

The pipeline's v1 work is simply: **write to `user_asset_sessions` via `save_session()` before OW creates the chat** (keyed by the openwebui-generated chat_id, triggered by §12.2's cookie-read flow). The engine's existing IDLE-path pickup handles the rest.

Contract remains the existing `session_memory` functions at `mira-bots/shared/session_memory.py`:

```python
save_session(
    chat_id: str,
    asset_id: str,
    open_wo_id: str | None = None,
    last_seen_fault: str | None = None,
) -> bool
```

Idempotency is handled via `INSERT ... ON CONFLICT (chat_id) DO UPDATE` (session_memory.py line 95). 72-hour TTL is enforced on load (line 156).

Estimated incremental work: **0 engine hours** — this is purely a mira-pipeline change (already counted in §12.2), not an engine change. Sprint 0 saved us ~8 hours by finding this.

### 12.5 Admin authorization model

**Problem:** §7.3 requires `isAdmin` gating but the mechanism was previously deferred to "implementation time." JWTs today have no `admin` claim.

**Decision required:** pick one:
- **(a)** Derive at login: call Atlas `/users/me` during `signinUser`, check role == `ADMIN`, embed as `atlasRole` claim in the JWT.
- **(b)** New column `tenants.admin_user_id` (the signup user is the admin).
- **(c)** Hardcode allowlist in v1 (unacceptable beyond Phase 0).

**Recommendation:** (a) — reuses Atlas as source of truth for role, zero schema migration, no drift risk.

**Resolved → (a) Atlas role claim in JWT.** Changes required:

1. In `mira-web/src/lib/atlas.ts`, add a `getAtlasUserRole(userId: number): Promise<"ADMIN" | "USER">` helper that calls `GET /users/me` on the Atlas API.
2. In the login flow (`signinUser` in atlas.ts + magic-link handler): after obtaining the Atlas user ID, call `getAtlasUserRole()` and embed the result as `atlasRole` in the JWT payload.
3. Add `atlasRole` to `MiraTokenPayload` interface in `auth.ts`.
4. New middleware `requireAdmin()` that calls `requireActive()` first, then checks `payload.atlasRole === "ADMIN"`. Returns 403 otherwise.
5. `/admin/qr-print` and `/admin/qr-analytics` routes gated by `requireAdmin()`.

Caveat: role changes in Atlas don't propagate to an already-issued JWT for up to 30 days (TTL). Acceptable for v1; v2 could add a "refresh role" endpoint.

Estimated incremental work: ~2 hours.

### 12.6 Cross-tenant response = byte-identical to "asset does not exist"

**Problem:** §5.2 returns a "polite 200 — this asset belongs to another plant" page on cross-tenant scans. That's a cross-tenant enumeration oracle: a valid JWT holder can distinguish "in my tenant" vs "in another tenant" vs "nowhere" by response content.

**Decision required:** make the cross-tenant 200 and the not-found 404 **byte-identical** (same HTML, same status, same timing). Alternative: choose "discreet" wording that does not confirm other tenants exist (e.g., "This asset is not associated with your plant").

**Recommendation:** discreet wording + identical response surface. Add as an acceptance criterion (§11 Security).

**Resolved → identical response, discreet wording.** Behavior for BOTH "asset not in this tenant" AND "asset does not exist anywhere":

- HTTP status: `200`
- Response body: fixed HTML page titled "Asset not found in your plant"
- Body text: "This asset tag is not associated with your plant. If you believe this is an error, contact your admin."
- Response time: use constant-time lookup path that always does the full `asset_qr_tags` SELECT + an empty-result branch (never short-circuits on non-existence)
- Headers: no `X-Asset-Exists` / `X-Tenant-Match` / debug info leaked

Both branches still write to `qr_scan_events` (for audit — unauthorized scans are useful security signal) but do NOT touch `asset_qr_tags` (no tag row is created for foreign scans).

Acceptance test: a valid JWT holder who scans `/m/FAKE_TAG_THAT_DOES_NOT_EXIST_ANYWHERE` and `/m/VFD_FROM_ANOTHER_TENANT` gets byte-identical HTML and headers.

Estimated incremental work: ~1 hour (HTML template, constant-time branch, test).

### 12.7 Scope cut: analytics Pareto in v1 vs. v1.5

**Problem:** Scope-guardian flagged the full analytics page (Pareto, scan-to-resolution, unique-scanners-30d, linked_chats) as over-scoped for a v1 whose goal is collapsing Stage 1. The `chat_id` correlation column has no defined correlation path.

**Decision required:** pick one:
- **(a)** Keep analytics minimal in v1: a single table of `asset_tag / total_scans / last_scan`, sorted by `last_scan DESC`. Pareto, linked_chats, scan-to-resolution deferred.
- **(b)** Ship the full analytics page and budget the extra 8-12 hours.

**Recommendation:** (a) — qr_scan_events keeps full fidelity; the dashboard can catch up after real scan data exists.

**Resolved → (a) minimal table, v1.5 adds Pareto.** v1 analytics page shows ONE table:

| Column | Source | Sort |
|---|---|---|
| `asset_tag` | `asset_qr_tags.asset_tag` | — |
| Total scans | `asset_qr_tags.scan_count` | secondary |
| Last scan | `asset_qr_tags.last_scan` | primary DESC |
| Printed | `asset_qr_tags.printed_at IS NOT NULL` | — |

That's the whole v1 page. No Pareto chart, no unique scanners, no linked chats, no scan-to-resolution rate. One SELECT, ~15 lines of HTML.

Deferred to v1.5 (once ≥10 tagged assets per tenant have ≥20 scans):
- Pareto chart (top 20% = 80% hypothesis)
- Unique-scanner-count per asset per 30d
- Linked chat threads
- Scan-to-resolution rate

`chat_id` column in `qr_scan_events` (§6.2) stays in the schema for v1.5 backfill, but is nullable and unwritten in v1.

Estimated incremental work: ~2 hours (vs. ~10 hours for full Pareto version).

### 12.8 40-hour scope includes a separate physical-validation track

**Problem:** The previous "~40 hrs / 1 sprint" estimate bundled software, PDF layout, Avery 5163 label geometry validation, material matrix (4 materials × 3 environments), 24-hour chemical soak tests, and Phase 0 in-plant pilot. Those don't parallelize.

**Decision required:** split into two parallel tracks with separate budgets:
- **Software track** (~30 hrs engineering): routes, DB, QR generator, minimal analytics, pipeline seeding
- **Physical validation track** (~1-2 calendar weeks, part-time): material test rig, soak tests, Phase 0 sticker deployment

The software track can ship and be dogfooded internally with paper labels while the physical track runs.

**Resolved → split.**

**Software track** (blocking, ~26 hours revised estimate — down from 30 because §12.4 engine work vanished):

| Work item | Hours | Source |
|---|---|---|
| Cookie session layer (§12.1) | 4 | new |
| Scan route + scan_id cookie (§12.2) | 3 | updated |
| Pipeline cookie reader + save_session call (§12.2 + §12.4) | 3 | updated |
| NeonDB migration: `asset_qr_tags` (with `atlas_asset_id`) + `qr_scan_events` (§6 + §12.3) | 3 | updated |
| QR PNG generator (§7.2) | 2 | unchanged |
| Admin print page — list + checkbox + PDF (§7.3) | 6 | unchanged |
| Cross-tenant identical-response page (§12.6) | 1 | new |
| Atlas role claim in JWT (§12.5) + `requireAdmin` (§7.3) | 2 | new |
| Minimal analytics page (§12.7) | 2 | simplified |
| **Total software** | **26** | |

**Physical track** (parallel, 1-2 calendar weeks async):
- Day 1: buy Avery 5520 vinyl sample pack at Staples
- Day 2: print test sheet, tag 17 items on Mike's own conveyor
- Day 3-5: scan validation (gloves, sunlight, 30° tilt, grease), report results
- Day 7: soak test (diesel, brake cleaner, hydraulic oil)
- Parallel: reach out to 2-3 vinyl sticker vendors for production-quality sourcing quote

**Order of operations for the software track:**
1. Day 1-2: §12.1 cookie layer + §6 schema migration (foundation)
2. Day 3-4: scan route, pipeline cookie reader, QR generator
3. Day 5: admin print page + minimal analytics + cross-tenant page
4. Day 6-7: end-to-end on Mike's conveyor with real stickers, fix surprises
5. Write product docs from actual experience (`docs/product/qr-system.md` — already stubbed)

---

## 13. Open Questions / Decisions Deferred

| # | Question | Default for v1 |
|---|---|---|
| 1 | Should chat threads be tied to the asset permanently (Survivor #2's "asset owns the thread") or per-session? | Per-session in v1. "Asset owns the thread" requires a separate thread-persistence change — flagged as v2 work. |
| 2 | How does Ignition HMI launch compare to QR scan from the same tech's phone? | Out of scope; MIRA Connect P1 owns this. |
| 3 | Single QR per asset vs. per-technician-per-asset? | Single per asset. Per-tech is Survivor-adjacent; YAGNI. |
| 4 | Admin UI for editing asset metadata before printing (e.g., overriding vendor/model display)? | Read-only from Atlas in v1; edits happen in Atlas, not mira-web. |
| 5 | Support QR codes embedded in existing equipment nameplates (not on stickers)? | v2+; needs camera-vision pathway (Survivor #1 territory). |
| 6 | OW skin for the post-scan chat — should it look different from a regular chat session? | Same UI. Only difference is the greeting message and asset_tag passed to the pipeline. |

## 14. Dependencies

- ✅ `mira-web` Hono/Bun with JWT auth — running on prod
- ✅ NeonDB connection via `@neondatabase/serverless` — confirmed
- ⚠️ `mira-mcp` `cmms_list_assets` tool — exists but **no tenant filter today**; see §12.3
- ⚠️ `verifyToken`/`requireAuth`/`requireActive` middleware — **reads from `Authorization` header / `?token=` query, not cookies**; see §12.1
- ⬜ Cookie-based session layer in mira-web — **new work**, see §12.1
- ⬜ Atlas adapter `get_asset_by_tag(company_id, tag)` + tenant-filtered list — **new work**, see §12.3
- ⬜ GSDEngine `seed_for_asset()` method — **new work**, see §12.4
- ⬜ OW chat-seed endpoint integration (pre-inject first message) — **new work**, see §12.2
- ⬜ `qrcode` npm package — new dependency, MIT license (approved per CLAUDE.md)
- ⬜ `pdf-lib` npm package — new dependency, MIT license
- ⬜ Admin role resolution via Atlas role claim in JWT — see §12.5
- ⬜ Avery 5520 vinyl sheets — office supply, physical validation requirement

## 15. Risks

| Risk | Probability | Mitigation |
|---|---|---|
| Atlas `asset_id` includes unsupported chars (spaces, `/`) | Medium | Validate at load; fail loudly and file issue rather than silent slug-mangle |
| Vinyl sticker survives <90 days in foundry/machining env | Medium | Laminated vinyl fallback material in §8.4; ship with recommendation per environment |
| Scan latency > 1.5 s degrades perceived quality | Low | Atlas call cached 60 s in-process; NeonDB scan write is a single transaction |
| QR becomes unreadable after ink smudge / UV fade | Medium | ECC level M + min 2" print + material guide in §8.4 |
| Tenant prints thousands of stickers then doesn't scan any — "dead shrinkage" | Low | Analytics page surfaces "0 scans in 30d" assets so the adoption gap is visible |
| Cross-plant sticker reuse (customer #1 sticker scanned at customer #2 plant) | Low | Cross-tenant scan handled gracefully (§5.2); sticker content includes `app.factorylm.com` so human reads the domain too |
| PDF renders wrong on one browser / printer driver | Medium | Generate server-side with `pdf-lib` (deterministic PDF/A-ish output), not a browser print dialog |

## 16. Success Metrics

**v1 launch (first 30 days post-Phase 1):**
- 50 stickers physically deployed at pilot plant
- ≥ 40 unique assets scanned at least once
- Median scans/day per active asset ≥ 2
- Median time from scan → first user message < 15 s (vs. baseline ~45 s typing stage)
- Pilot plant manager rates the feature ≥ 4/5 on usefulness

**v1 → v2 trigger:**
- ≥ 200 unique tagged assets across pilot + first two customer tenants
- Data proves Pareto (top 20% of assets → > 50% of scans) — validates the analytics premise
- At least one customer explicitly asks for v2 features (NFC, per-tech, asset-owned threads)
