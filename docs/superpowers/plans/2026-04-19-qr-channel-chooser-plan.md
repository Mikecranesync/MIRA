# Close the QR-scan customer loop — channel chooser + multi-entrypoint funnel

## Context

The QR scan route (`/m/:asset_tag` in mira-web, shipped via PR #412) hits a wall for any phone without a prior `mira_session` cookie. The live smoke test on 2026-04-19 confirmed the failure: scan → `{"error":"Unauthorized"}` JSON, no recovery path. The initial plan proposed an embedded chat UI in mira-web, which would have created a THIRD chat surface (alongside Open WebUI and Telegram). That was wrong — Mike has invested in Open WebUI + Telegram as the customer-facing chat channels, and the goal is to FEED those channels, not replace them.

**Corrected framing**: the scan is a DISCOVERY moment, not a destination. It funnels the scanner into whichever existing channel the tenant has configured as their primary.

Industry research (UpKeep, Limble, MaintainX, Fiix, eMaint, Samsara, Fracttal, Maximo) confirms the universal pattern: two lanes — operator fault-report portal (no auth, captures problem at the moment of failure), and authenticated technician lane (full chat/WO access). Mike's ecosystem already has the authenticated lane (Open WebUI + Telegram), just not wired to the scan path. And the operator lane is missing entirely.

**Design constraint**: Mike chose Option 3 — **admin decides per-tenant at setup**. No opinionated default. Plus: "plenty of entrypoints" — respect that humans approach software through many doors (phone, desktop, Telegram, Slack, email forward, shared workbench tablet, verbal dictation from a colleague over the phone). Plan must not funnel everyone through one path.

**Intended outcome**: every scan ends in a real interaction — either an existing channel (Open WebUI / Telegram / Slack / etc.), a guest fault report (for non-customer operators), or a graceful "channel not yet set up" setup prompt (for admins who haven't configured). No dead-ends. No replacement of existing channels. No new chat UI.

## The multi-entrypoint model

A tenant's **channel configuration** is the single source of truth for how their scans route. Stored in a new `tenant_channel_config` table:

```
tenant_id (UUID, PK)
enabled_channels (TEXT[]) — ordered by admin preference, e.g. ['telegram', 'openwebui', 'guest']
telegram_bot_username (TEXT, nullable)
slack_workspace_id (TEXT, nullable)
openwebui_url (TEXT, nullable; defaults to 'https://app.factorylm.com')
allow_guest_reports (BOOLEAN, default true)
allow_tech_self_signup (BOOLEAN, default false)
remember_chooser_choice (BOOLEAN, default true)
```

At scan time, `/m/:asset_tag` routes as follows:

1. **Already authed in Open WebUI** (has `mira_session` cookie) → current 302 to chat path (unchanged)
2. **Already chose a channel on this device** (has `mira_channel_pref` cookie, 30-day) → skip chooser, route to that channel
3. **Unauthed, no prior choice** → render a **chooser page** showing only the channels the tenant has enabled, in admin-preferred order
4. **Tenant has NO channels configured** → graceful "plant owner hasn't finished setup" page with the admin's contact (from `tenants.email`) + guest-report fallback

The chooser page is a respectful question, not a gate. Big, thumb-friendly buttons. Remembers the choice for next time.

## Entry points the system will support (progressive rollout)

**Day 1 (Phase 1):**
- **Open WebUI** — existing web chat, existing 302 flow for authed users, `/login` page for unauthed (Phase 3 of this plan)
- **Telegram bot** — deep link via `t.me/{bot}?start=<scan_id>`. Works on any phone with Telegram installed. Zero login friction (Telegram handles identity). Bot handler in mira-bots/telegram needs a small patch (Phase 2 of this plan).
- **Guest fault-report form** — for non-customer operators. Scan → form → email to tenant admin. No account, no app.

**Phase 4:**
- **Slack bot** — parity with Telegram via Slack deep links (`slack://channel?team=...&id=...`). Mirror of Phase 2.

**Phase 5 (deferred, optional):**
- **Shared workbench tablet mode** — per-device long-lived session with NFC badge / 4-digit PIN user-switch. For plants with wall-mounted iPads at each station.
- **Email ingress** — forward `report@factorylm.com` with "VFD-07 is making noise" → routed to tenant by sender domain → creates a guest_report. Useful for "I'm at my desk, I'll email it in."
- **SMS shortcode** — "Text VFD-07 to 555" → creates guest_report. Useful when reception blocks data but SMS works.
- **Open WebUI SSO** — if the Open WebUI channel grows enough volume to justify the integration cost.

Each entry point is an independent addition — none depend on the others. Admin can enable any subset.

## Recommended approach — five phases, channel-first

### Phase 1 (this week): Channel config + chooser page + guest form

Admin configures which channels their tenant uses. Scan route honors that config. Unauthed scans get a chooser (or a fallback guest form if nothing's configured).

Files to create/modify:
- Create `mira-core/mira-ingest/db/migrations/004_tenant_channel_config.sql` — the config table above. Default every existing tenant to `enabled_channels = ['openwebui', 'guest']` to match today's expectation.
- Create `mira-core/mira-ingest/db/migrations/005_guest_reports.sql` — `guest_reports` table: `id`, `tenant_id`, `asset_tag`, `reporter_name`, `reporter_contact`, `description`, `photo_url`, `scan_id REFERENCES qr_scan_events(scan_id)`, `created_at`, `acknowledged_at`.
- Modify `mira-web/src/routes/m.ts` — read `mira_channel_pref` cookie, read `tenant_channel_config`, branch to chooser / direct-route / guest-form. Preserve existing authed path unchanged. Preserve constant-time resolution property.
- Create `mira-web/src/routes/m-chooser.ts` — `GET /m/:asset_tag/choose` renders the chooser page. Honors tenant's `enabled_channels` order.
- Create `mira-web/src/routes/m-report.ts` — `GET /m/:asset_tag/report` + `POST /api/m/report` for the guest form.
- Create `mira-web/src/lib/cookie-session.ts` extensions — `buildChannelPrefCookie(channel)` + `readChannelPref()`.
- Create `mira-web/src/routes/admin/channels.ts` — `GET /admin/channels` settings page + `POST /api/admin/channels` save. Uses existing `requireAdmin` middleware.
- Create `mira-web/emails/guest-report-notify.html` — template for admin notification.
- Tests: `m-chooser.test.ts`, `m-report.test.ts`, `admin-channels.test.ts`. Roughly 12 new tests total.

Reuse:
- `ASSET_TAG_RE`, `resolveAssetForScan`, `recordScan` from `mira-web/src/lib/qr-tracker.ts`
- `buildPendingScanCookie`, `parseCookies` from `mira-web/src/lib/cookie-session.ts`
- `sendEmail` and existing template pattern from `mira-web/src/lib/mailer.ts`
- `requireAdmin` from `mira-web/src/lib/auth.ts` (atlasRole check)
- Design tokens from `mira-web/public/activated.html:15-37` for the chooser UI

**What this closes:**
- First-scan dead-end (operator path → guest form OR tech picks a channel)
- Admin gets control (Option 3 fulfilled)
- Preserves all existing flows (authed users bypass chooser)

### Phase 2 (next sprint): Teach Telegram bot to handle scan context

The existing Telegram bot already knows how to chat. It already has user identity (Telegram handles it). Adding scan-context awareness is a ~30 LOC patch.

Files:
- Modify `mira-bots/telegram/<entry>.py` — register a `/start <payload>` handler (Telegram deep-link convention). Payload is a scan_id or `tenant__asset_tag` string.
- Modify `mira-bots/shared/` — new helper `process_telegram_deep_link(payload, telegram_user)` that resolves scan → tenant + asset, calls `session_memory.save_session(telegram_user_id, asset_tag)`, returns a greeting.
- Modify `mira-web/src/routes/admin/qr-print.ts` — when tenant's `enabled_channels` includes `'telegram'`, generated QRs use `https://t.me/{bot}?start={encoded}` format instead of (or in addition to) the `/m/` URL.
- Tests: `test_telegram_deep_link.py`.

Reuse:
- `session_memory.save_session` from `mira-bots/shared/session_memory.py` (already merged via #401)
- `resolveAssetForScan` logic ported to Python (or call mira-web REST)
- Existing Telegram bot scaffolding

**What this closes:**
- Gives Telegram-first tenants a zero-login scan experience
- Telegram handles identity; no new auth plumbing
- This is the BIGGEST win for pilot customers who haven't already adopted Open WebUI

### Phase 3 (only for Open WebUI tenants): Email-OTP login + tenant invites

Only matters if a tenant's chosen channel is `'openwebui'` and a tech scans without a cookie. Adds a `/login` page with 6-digit email codes (Resend, already deployed). Adds tenant-invite flow so the single-admin model breaks cleanly.

Files:
- Create `mira-web/src/routes/login.ts` — OTP request + verify routes.
- Create `mira-core/mira-ingest/db/migrations/006_tenant_users.sql` — breaks single-user model.
- Create `mira-core/mira-ingest/db/migrations/007_login_otps.sql` — 10-min TTL, single-use, bcrypt-hashed codes.
- Create `mira-web/src/routes/admin/invite.ts` — admin invites tech, emails magic link for first-login.
- Modify chooser page: "Open in Web Chat" button → `/login?return=/m/VFD-07` when unauthed.
- Tests: `login.test.ts`, `invite.test.ts`.

Reuse:
- `signToken`, `buildSessionCookie` from existing auth layer
- `sendEmail` + template pattern
- `requireAdmin`

**What this closes:**
- Open WebUI tenants with unauthed techs can now actually get in
- Plants can invite their teams (not just single-admin)
- Scan-context survives login detour via 15-min `mira_pending_scan` TTL extension

### Phase 4 (if Slack bot exists): Slack scan parity

Mirror Phase 2 for Slack. Likely a slash-command or deep link into the bot DM. Enables Slack-first tenants to get the same frictionless scan-to-chat as Telegram.

### Phase 5 (deferred, demand-driven):

- **Shared workbench tablet mode** — for plants with wall-mounted iPads. Device has a long-lived session; techs identify via NFC badge or PIN. Microsoft Entra QR+PIN pattern from industry research.
- **Email ingress** — SMTP hook for "email the problem in."
- **SMS shortcode** — Twilio integration for "text VFD-07 to 555."
- **Open WebUI SSO** — solve the auth-bridge problem if enough tenants pick Open WebUI as their primary and hit the friction.

## Admin setup wizard (Phase 1 UX)

When a tenant first lands on the admin area (post-activation), show a one-time wizard:

```
Welcome to MIRA. How should your team interact with the assistant?

[ ] Web browser (Open WebUI)
    Your team logs into https://app.factorylm.com/chat.
    Best for: desktop workflows, admins, manual uploads.

[ ] Telegram
    Your team messages a Telegram bot from their phone.
    Best for: mobile-first techs, zero login friction.
    Setup: we'll create a bot named @YourPlantName_MIRA.

[ ] Both
    Each scan offers a choice. Recommended for mixed teams.

[ ] Just reports for now
    Operators submit fault reports via a form. Upgrade anytime.

[ Confirm → proceed to print stickers ]
```

Choice persists in `tenant_channel_config`. Defaults: both + guest reports enabled.

## Human factors the design respects

| Human situation | How the plan handles it |
|---|---|
| Greasy hands, thick gloves | Chooser buttons are large, thumb-sized; Telegram deep-link avoids typing entirely |
| Noisy plant floor, can't take a call | QR → chat (any channel) works silently |
| Phone has poor data reception | Guest form + (Phase 5) SMS shortcode survive low bandwidth |
| Shared workbench tablet | (Phase 5) NFC badge + PIN identifies the active tech per scan |
| New hire on day one | Admin invite (Phase 3) sends a welcome card; alternatively, QR on their workbench routes to Telegram with zero setup |
| Contractor visiting for a day | Guest form captures their report without requiring an account |
| Tech prefers Telegram over browsers | Tenant can make Telegram primary — no forced Open WebUI UX |
| Office-only admin at desktop | Open WebUI remains the default; their workflow is unchanged |
| Language-other-than-English | (Phase 5) i18n framework; for now, single-language English |
| Sticker gets scratched/faded | QR error correction level M tolerates 15% damage (already in our generator) |
| Phone battery dead | (Phase 5) SMS shortcode / email-in as fallbacks |
| Tech switches plants (has multiple tenants) | Chooser page resolves tenant from asset_tag; per-device cookie honors the last scan's tenant |

## Files to touch

| Phase | File | Action |
|-------|------|--------|
| 1 | `mira-core/mira-ingest/db/migrations/004_tenant_channel_config.sql` | Create |
| 1 | `mira-core/mira-ingest/db/migrations/005_guest_reports.sql` | Create |
| 1 | `mira-web/src/routes/m.ts` | Modify: route via channel config + cookie |
| 1 | `mira-web/src/routes/m-chooser.ts` | Create |
| 1 | `mira-web/src/routes/m-report.ts` | Create |
| 1 | `mira-web/src/lib/cookie-session.ts` | Extend: channel-pref cookie |
| 1 | `mira-web/src/routes/admin/channels.ts` | Create |
| 1 | `mira-web/src/routes/admin/setup-wizard.ts` | Create (optional first-run wizard) |
| 1 | `mira-web/emails/guest-report-notify.html` | Create |
| 1 | `mira-web/src/routes/__tests__/` (×3) | Create tests |
| 2 | `mira-bots/telegram/` entry handler | Modify: /start handler |
| 2 | `mira-bots/shared/qr_deep_link.py` | Create helper |
| 2 | `mira-web/src/lib/qr-generate.ts` | Extend: accept `channel` param → build t.me/… or /m/… URL |
| 2 | `mira-web/src/routes/admin/qr-print.ts` | Modify: use tenant's channel config when generating QR URLs |
| 2 | `mira-bots/tests/test_telegram_deep_link.py` | Create |
| 3 | `mira-web/src/routes/login.ts` | Create (OTP) |
| 3 | `mira-core/mira-ingest/db/migrations/006_tenant_users.sql` | Create |
| 3 | `mira-core/mira-ingest/db/migrations/007_login_otps.sql` | Create |
| 3 | `mira-web/src/routes/admin/invite.ts` | Create |
| 3 | `mira-web/src/routes/m-chooser.ts` | Modify: "Sign in" CTA → /login |
| 4 | `mira-bots/slack/` handler | Mirror of Phase 2 |

## Security properties to preserve

- Constant-time tenant resolution in `/m/:asset_tag` (branch on result, not on auth state or channel)
- Byte-identical not-found HTML for cross-tenant + nonexistent (spec §12.6)
- `mira_channel_pref` cookie: signed + HttpOnly + SameSite=Lax + 30-day TTL + Domain=.factorylm.com (same envelope as `mira_session`)
- Open-redirect prevention in `/login?return=...` via strict internal-path allowlist (OWASP Auth Cheat Sheet)
- OTP storage: bcrypt-hashed, 10-min TTL, single-use, rate-limited per email (prevent brute-force)
- Guest-report submissions flagged `source='guest'`, require admin review before any auto-work-order creation
- Telegram deep-link payload: signed/validated before reading (prevent forgery of scan_id)

## Verification

### Phase 1
- `tenant_channel_config` exists; default row for existing tenants
- `bun test mira-web/src/routes/__tests__/` → +12 new tests green
- Live smoke: unauthed scan with tenant set to `['telegram', 'openwebui', 'guest']` → chooser shows 3 buttons in that order
- Live smoke: unauthed scan with tenant set to `['guest']` only → lands directly on guest form
- Live smoke: authed scan (with mira_session cookie) → existing 302 path unchanged
- Open-redirect test: attempt to set `return=https://evil.com` — rejected

### Phase 2
- Telegram bot /start VFD-07 greets with "Looking at VFD-07…" and has context seeded in session_memory
- QR generator for Telegram-channel tenant produces `t.me/...?start=...` URLs
- Admin print page renders Telegram QRs for Telegram-channel tenants

### Phase 3
- `/login` OTP round-trip works
- Invite flow: admin invites tech email → tech clicks → lands in correct tenant with USER role
- `mira_pending_scan` cookie survives login detour (extended to 15 min)

### Phase 4
- Slack parity with Telegram

### Phase 5 (when triggered)
- Shared-device + PIN flow
- SMS ingress routing
- Email ingress routing

## What I WON'T do (lessons from the first draft)

- Will NOT build a new embedded chat UI in mira-web
- Will NOT replace Open WebUI or Telegram as chat surfaces
- Will NOT require Google OAuth for Phase 1
- Will NOT gate operator fault-reporting behind login
- Will NOT require admins to use all three channels; Option 3 means they pick
- Will NOT force a chooser on users who already picked (cookie remembers)
