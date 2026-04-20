# Bravonode Agent Prompt — Implement QR Channel Chooser (Phase 1)

**Target environment:** bravonode (Mac Mini M4, `FactoryLM-Bravo`, Tailscale IP 100.86.236.11, LAN 192.168.1.11). User: `bravonode`. macOS with Docker Desktop, Tailscale, Doppler CLI, git, bun, and Python 3.12 + uv available.

**Branch to work on:** `feat/qr-channel-chooser` (already pushed to origin; tagged `qr-chooser-plan-2026-04-19`).

**Spec to follow:** `docs/superpowers/plans/2026-04-19-qr-channel-chooser-plan.md` — implement **Phase 1 ONLY**. Phases 2–5 are out of scope for this run.

**Parent branch reference:** `feat/qr-asset-tagging` contains PR #412 (the base QR scan route you'll be modifying). It merges cleanly onto main once #412 lands; do not block on that merge.

---

## Copy-paste prompt for the bravonode agent

```
You are Claude Code running on bravonode (Mac Mini, macOS). You have a checkout
of github.com/Mikecranesync/MIRA. Your job is to implement Phase 1 of the QR
channel chooser feature. The full spec is at:

  docs/superpowers/plans/2026-04-19-qr-channel-chooser-plan.md

Phase 1 scope (do NOT go beyond this):

  1. New NeonDB table: tenant_channel_config
  2. New NeonDB table: guest_reports
  3. Modify mira-web/src/routes/m.ts to read the tenant's channel config
     and route unauthed scans to a chooser page (or guest form if only
     guest is enabled, or authed 302 path if session cookie present).
     PRESERVE the constant-time resolution property (spec §12.6).
  4. Create mira-web/src/routes/m-chooser.ts — renders chooser page
     honoring the tenant's enabled_channels order.
  5. Create mira-web/src/routes/m-report.ts — guest fault-report form
     (GET renders form, POST writes to guest_reports + emails admin).
  6. Extend mira-web/src/lib/cookie-session.ts — add buildChannelPrefCookie
     and readChannelPref helpers. Signed cookie, HttpOnly, SameSite=Lax,
     30-day TTL, Domain=.factorylm.com (match existing mira_session
     envelope).
  7. Create mira-web/src/routes/admin/channels.ts — GET settings page,
     POST save. Gated by requireAdmin.
  8. Create mira-web/emails/guest-report-notify.html — template following
     the beta-welcome.html style (DM Sans, amber CTA, {{PLACEHOLDER}}
     substitution).
  9. Optional if time permits: mira-web/src/routes/admin/setup-wizard.ts
     — first-run wizard for new tenants. Not required for Phase 1 exit.

Operating rules (non-negotiable):

  A. Branch: work on feat/qr-channel-chooser. Do NOT switch branches.
     Verify with `git branch --show-current` at start and before every
     commit. If you find yourself on another branch, stop and report.

  B. TDD: write the failing test first, then the implementation, then
     confirm green. Use the existing test conventions:
       - mira-web: bun test, src/lib/__tests__ or src/routes/__tests__
       - Python: pytest under doppler --config dev wrapper
     Template to follow: see qr-tracker.test.ts and m.test.ts for
     test hygiene (PLG_JWT_SECRET ??= fallback, TEST_TENANT UUID
     cleanup in beforeAll/afterEach).

  C. House conventions:
       - NeonDB reads (single SELECT): use neon() tagged templates
         (see mira-web/src/lib/qr-tracker.ts for pattern)
       - NeonDB writes with transactions: use new Client() + BEGIN/COMMIT
         (see mira-web/src/routes/admin/qr-print.ts for pattern)
       - UUID columns need ::uuid or CAST(::uuid) when using tagged
         templates (mira-web/src/lib/qr-tracker.ts demonstrates)
       - License check: any new npm/pip dep MUST be MIT or Apache-2.0.
         Verify before installing.
       - No new chat UI. No embedded chat. Do not touch mira-pipeline.
       - No Google OAuth, no WebAuthn, no SAML. Phase 1 uses no auth
         beyond existing requireAdmin for the /admin/channels route.

  D. Dev environment on macOS:
       - Use `doppler run --project factorylm --config dev --` to inject
         NEON_DATABASE_URL and other secrets for tests and migrations.
       - Doppler token is configured in file storage (not keychain):
         `doppler configure set token-storage file` has already been run.
       - Run tests via:
         doppler run --project factorylm --config dev -- bash -c \
           "cd mira-web && bun test src/lib/__tests__/ src/routes/"
       - Apply NeonDB migrations via:
         doppler run --project factorylm --config dev -- \
           psql "$NEON_DATABASE_URL" -f \
           mira-core/mira-ingest/db/migrations/NNN_foo.sql

  E. Migrations:
       - Number sequentially after existing 003_asset_qr_tags.sql:
           004_tenant_channel_config.sql
           005_guest_reports.sql
       - Idempotent: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS
       - Include BEGIN/COMMIT wrappers
       - Default enabled_channels = ARRAY['openwebui','guest'] for any
         existing tenant rows; backfill via a single UPDATE statement at
         the end of 004_tenant_channel_config.sql.

  F. Security properties to preserve (spec §12.6 + Phase 1 verification):
       - /m/:asset_tag MUST remain constant-time for tenant resolution:
         always issue the same SELECT, branch only on result, never on
         auth state or cookie presence.
       - Not-found HTML MUST remain byte-identical for cross-tenant
         misses and nonexistent tags. The chooser page path is only
         reachable when tag EXISTS for the user's tenant OR we're
         rendering guest-only. Miss paths preserve the existing
         byte-identical 200 HTML.
       - Validate asset_tag against ASSET_TAG_RE before ANY DB read
         (reuse from mira-web/src/lib/qr-tracker.ts).
       - Guest form submissions MUST NOT auto-create Atlas work orders.
         Write only to guest_reports table. Admin review required.
       - Channel-pref cookie is HMAC-signed with PLG_JWT_SECRET to prevent
         tampering. Minimal payload: just the channel name + timestamp.

  G. Verification (MANDATORY before reporting done):
       - Run full mira-web test suite under Doppler dev. Expect existing
         38 tests + your new ~12 to pass. Read the bottom "N pass, M fail"
         line — do NOT report success based on absence of errors.
       - Live smoke test:
          * Start mira-web on a free port: bun run mira-web/src/server.ts
            (with PLG_JWT_SECRET injected; COOKIE_DOMAIN=localhost).
          * Seed a tenant config row with enabled_channels =
            ['telegram','openwebui','guest'] via psql.
          * curl http://localhost:PORT/m/TEST-VFD-01 (no cookie) →
            confirm 200 HTML with all 3 channel buttons in that order.
          * curl /m/TEST-VFD-01 with COOKIE: mira_channel_pref=<signed
            telegram cookie> → confirm 302 redirect to t.me/... (or to
            the chooser if you haven't built Phase 2 yet — in that case
            302 to a graceful "telegram not yet wired" page is
            acceptable).
          * curl -X POST /api/m/report with valid payload → confirm
            200 + row in guest_reports table.
          * Cross-tenant miss md5 still matches nonexistent-tag md5.
       - Kill the server when done. Do not leave it running.

  H. Commits:
       - One commit per logical unit. Suggested shape:
           feat(qr-chooser): tenant_channel_config migration
           feat(qr-chooser): guest_reports migration
           feat(qr-chooser): channel-pref cookie helpers
           feat(qr-chooser): m.ts routing by channel config
           feat(qr-chooser): chooser page + admin settings
           feat(qr-chooser): guest fault-report form + admin email
       - Conventional commit format: feat/fix/docs/refactor/test/chore.
       - Include `Co-Authored-By: Claude Opus 4.7 (1M context)
         <noreply@anthropic.com>` trailer.
       - Push after each logical chunk so the human can follow progress.

  I. When done:
       - Open a draft PR from feat/qr-channel-chooser → main (NOT against
         feat/qr-asset-tagging — we want independent merge timing).
         Use `gh pr create --draft`. Title prefix: "feat(qr-chooser):".
         In the PR body, list each acceptance criterion with [x] or [ ]
         and the full verification output ("N pass, M fail" lines).
       - Add the PR to the KANBAN project board:
         gh project item-add 4 --owner Mikecranesync --url <PR_URL>
       - Do NOT mark ready-for-review. Human will promote after reading
         the diff.

  J. If blocked:
       - If a test fails and you can't resolve it in 3 attempts, STOP.
         Write your diagnosis to docs/superpowers/plans/blockers/
         2026-04-19-qr-chooser-phase1-blocker.md and commit + push.
         Tag the PR with the "blocked" label.
       - Do not delete work or force-push. Do not skip tests with
         .only / pytest.skip to make CI green.
       - Do not merge the PR yourself under any circumstances. Human
         reviews.

  K. Things NOT to touch:
       - mira-pipeline/ (Python chat service — unchanged in Phase 1)
       - mira-bots/ (Telegram / Slack adapters — Phase 2+)
       - Any file outside mira-web/, mira-core/mira-ingest/db/migrations/,
         docs/superpowers/plans/, or your own tests
       - The existing beta-welcome / beta-activated / beta-payment email
         templates (add new files, do not edit these)
       - PLG_JWT_SECRET value — use existing; do not rotate

Start by reading the plan spec in full:
  docs/superpowers/plans/2026-04-19-qr-channel-chooser-plan.md

Then read these reference files to understand conventions:
  mira-web/src/routes/m.ts                       (current scan route)
  mira-web/src/lib/qr-tracker.ts                 (neon() tagged templates + ::uuid)
  mira-web/src/routes/admin/qr-print.ts          (new Client() + transaction)
  mira-web/src/routes/admin/qr-analytics.ts      (admin settings HTML pattern)
  mira-web/src/lib/cookie-session.ts             (cookie envelope to extend)
  mira-web/src/routes/__tests__/m.test.ts        (integration test pattern + env fallback)
  mira-web/emails/beta-welcome.html              (email template style)
  mira-web/src/lib/mailer.ts                     (sendEmail + template render)

Then implement, test, commit, open draft PR. Total estimated effort:
6-10 hours. Ship today or early tomorrow.
```

---

## How to deliver this prompt to bravonode

If you run Claude Code on bravonode (via SSH + `claude` CLI or a local terminal):

1. SSH in: `ssh bravonode@100.86.236.11`
2. Change to the repo: `cd ~/Documents/MIRA` (or wherever bravonode's checkout lives — confirm with `git remote -v`)
3. Update the branch: `git fetch origin && git checkout feat/qr-channel-chooser && git pull`
4. Start Claude Code and paste the triple-backtick block above (everything between the ``` fences).

If you run via `claude-agent-sdk` programmatically on bravonode, paste the block as the initial user message to the agent.

**Monitoring during the run:**
- `gh pr list --repo Mikecranesync/MIRA --state open` on any machine shows when the draft PR opens
- `gh run watch` on bravonode shows CI progress once the agent pushes
- Agent should self-report with a final summary including commit SHAs, test counts, and PR URL

**Rollback if needed:**
- `git reset --hard qr-chooser-plan-2026-04-19` on feat/qr-channel-chooser returns to the pre-implementation state (just the plan committed).
