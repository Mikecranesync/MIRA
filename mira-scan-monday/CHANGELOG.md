# Changelog — mira-scan-monday

## v0.2.0 — 2026-05-05

- **Webhook endpoint**: `POST /monday/webhook` handles app-lifecycle events (install / uninstall / app_subscription_*) with HMAC JWT verification. Falls back to `MONDAY_OAUTH_CLIENT_SECRET` when `MONDAY_WEBHOOK_SIGNING_SECRET` is unset.
- **Subscription status column** added to `monday_installations` (idempotent migration on startup).
- **429 quota upgrade CTA**: when `/scan/extract` returns `quota_exceeded`, the iframe now shows a distinct "Get more scans" CTA instead of a raw error string.
- **Hybrid marketplace setup driver** at `tools/monday-marketplace-setup/` walks the Developer Center Build-tab sections and pipes generated OAuth + webhook secrets straight into Doppler `factorylm/prd`.
- Compose adds explicit `environment:` block for the three new monday secrets so `doppler run -- docker compose up` reaches the container.

## v0.1.0 — 2026-05-04 and earlier

- OAuth install flow + per-account token storage (`monday_installations`).
- Per-account session-token JWT verification on `/scan/extract`, `/kb/lookup`, `/chat/message`, `/monday/update-item`.
- Per-account daily scan counter + free-tier quota gate (50 scans/month default).
- 401 → mark_revoked → reinstall_required UI flow.
- OAuth state CSRF protection.
- Live `kb_chunks` lookup, Serper-backed manual search with OEM-domain boost + SEO blocklist + HEAD validation.
- Scan queue (`mira_scan_queue`) with crawler-bridge handoff into existing `mira-crawler` ingest pipeline.
