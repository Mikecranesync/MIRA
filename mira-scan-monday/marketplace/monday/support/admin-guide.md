# MIRA Scan — Admin Guide

For monday.com workspace admins configuring MIRA Scan across multiple boards.

## Per-board column mapping

MIRA Scan's vision model returns 8 standard fields:

| Field | Default column id | Type | Example |
|---|---|---|---|
| `make` | `make` | text | "Yaskawa" |
| `model` | `model` | text | "GA500" |
| `serial` | `serial` | text | "JK52A19045" |
| `voltage` | `voltage` | text | "480V" |
| `hp` | `hp` | text | "10 HP" |
| `rpm` | `rpm` | text | "1750" |
| `hz` | `hz` | text | "60 Hz" |
| `frame` | `frame` | text | "TEFC 215T" |

**If your board uses different column names** (common when boards are inherited from older templates), override per-deployment via env vars on the backend:

```
MONDAY_COL_MAKE=text_make
MONDAY_COL_MODEL=text_mfg_model
MONDAY_COL_SERIAL=text_sn
...
```

These are server-side environment variables — they cannot be edited per-customer from the UI in the current MVP. If you have boards with non-default column ids, email support@factorylm.com with the column id list and we'll provision a per-account override during beta.

**Roadmap:** in-app per-board column mapping UI (post-beta).

## Account-wide installation lifecycle

When a workspace admin installs MIRA Scan:
1. Monday redirects through our OAuth flow.
2. We persist a per-account access token (long-lived; revoked when uninstalled).
3. Every user in that account can use the panel — no per-user grant.

Uninstalling from the workspace marketplace revokes the token immediately. The next attempted scan in that workspace shows "please reinstall" in the panel.

## What MIRA stores per account

Stored in MIRA's NeonDB (Neon, AWS us-east-1):

- Your monday account id (numeric, public)
- The OAuth access token (long-lived, scoped to the permissions granted at install)
- Per-day scan_count for billing-tier metering
- Each scan that misses the knowledge base — make + model + your account id (so we know which install discovered the gap), so the OEM PDF gets found and ingested for everyone

What MIRA does **not** store:
- The nameplate image bytes (sent to the vision model, not persisted)
- Your monday board structure beyond what's needed for the in-flight column write
- Any user identity beyond the installer's user id (used for support diagnostics)

See `privacy.md` for the full data flow.

## Disabling for specific boards

Currently the panel appears on every board where it's added. To restrict per-board, hide the panel from the item view (monday.com's standard panel-management workflow) — the app respects board-level visibility.

## Health and uptime

- **Backend:** `https://app.factorylm.com/scan-api/healthz` — should return `200 OK` at all times
- **Status page:** TBD post-launch; for now, email support@factorylm.com if `/healthz` is non-200
