# MIRA Scan Specification
**Version:** 1.0
**Last Updated:** 2026-05-05
**Owner:** Mike Harper / FactoryLM

## Purpose
Field-tech entry point that turns a **physical asset tag (QR / barcode / nameplate photo)** into a fast diagnostic conversation. Two delivery surfaces share the same backend:

1. **Standalone web scanner** — `app.factorylm.com/sample`, `/activated`, `/scan` flows in `mira-web` (already routed via nginx).
2. **monday.com app** — embedded scanner that pushes a scan event to a monday.com board column and back to MIRA so a tech can scan from inside their workflow.

Both surfaces resolve the scan to an asset, hand off to `mira-pipeline` chat, and write a record to NeonDB so the asset's history accrues per the flywheel.

## Scope
**IN scope**
- Asset-scan landing pages in `mira-web` (`/scan`, `/sample`, `/activated`, `/cmms`, `src/views/scan-not-found.html`)
- monday.com embedded scanner (manifest + view + auth)
- Asset resolution against NeonDB (`assets` table) and Atlas via `mira-mcp`
- "Open CMMS" button on every asset-scan page (CRA-20 — landed 2026-05-04)
- QR onboarding skill (`qr-onboarding`) used at deployment time to print + assign tags

**OUT of scope**
- Building NFC / Bluetooth tag readers
- Computer-vision nameplate OCR (planned; reuses `mira-ingest` photo pipeline)

## Architecture
```
Tech scans QR
   ├── Web: app.factorylm.com/scan?asset=<tag>
   │     └── Hono route → resolve asset → embed Mira chat
   └── monday.com app
         └── frame inside monday item → POST to mira-web /api/scan/events
               └── upsert asset_event in NeonDB → optional Atlas WO seed
                     └── tech taps "Open chat" → mira-pipeline /v1/chat/completions
```

- **Layer:** Presentation (web), Integration (monday.com)
- **Containers:** Hosted by `mira-web`; no dedicated container
- **External services:** monday.com app framework, factorylm.com nginx (routes `/scan` → mira-web)

## API Contract
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/scan?asset=<tag>` | none | Resolve `asset` → asset page or `scan-not-found.html` |
| GET | `/sample` | none | Demo asset experience |
| GET | `/activated` | JWT | Post-Stripe activation landing |
| POST | `/api/scan/events` | HMAC (monday.com) | Record a scan event |
| GET | `/api/asset/{tag}` | optional JWT | Asset summary including last 5 events |

### Asset resolution rules
1. Lookup `assets.tag = ?` in NeonDB scoped to the resolving tenant.
2. Fall back to `mira-mcp /api/cmms/assets` if not found locally.
3. If still not found, render `scan-not-found.html` with a "Create asset" CTA that opens the Hub asset wizard.

### "Open CMMS" button (CRA-20)
Every asset-scan page must render a primary action that deep-links to:
- Atlas asset page (`ATLAS_PUBLIC_FRONT_URL` + `/assets/{id}`) for active tenants, or
- `/cmms` marketing landing for unauthenticated visitors.

## Configuration
| Var | Required | Purpose |
|---|---|---|
| `INBOX_DOMAIN` | yes | URL builder defaults |
| `ATLAS_PUBLIC_FRONT_URL` | yes | "Open CMMS" deep-link target |
| `MIRA_PIPELINE_URL` / `MIRA_PIPELINE_API_KEY` | yes | Embedded chat |
| `MONDAY_APP_SIGNING_SECRET` | yes (monday) | Verify HMAC on `/api/scan/events` |

## Quality Standards
| Metric | Current | Target |
|---|---|---|
| Scan-not-found UX | exists | A/B against "create asset" CTA |
| Time to first message after scan | unmeasured | ≤ 1 s on 4G |
| Mobile Lighthouse perf (scan page) | unmeasured | ≥ 80 |
| Tests | none | smoke that scans → asset page → chat opens |

## Acceptance Criteria
1. **Open CMMS button (CRA-20):** Every asset-scan page renders the "Open CMMS" primary action; verified across `/scan`, `/sample`, `/activated`, `/cmms`.
2. **Unknown asset:** A scan with an unknown `asset` query renders `scan-not-found.html` with the create-asset CTA.
3. **monday.com event:** A monday-side scan posts to `/api/scan/events` with a valid HMAC; HTTP 200 and a row appears in `asset_events`.
4. **HMAC required:** Posting to `/api/scan/events` without a valid HMAC returns HTTP 401.
5. **Chat handoff:** The asset page opens an embedded chat that calls `mira-pipeline` with the tenant id and `asset` in the user message context.
6. **Magic-link path:** A magic-link recipient who scans the same QR lands directly in chat (no second login).

## Known Issues
- monday.com app distribution flow not yet documented in this repo (lives with the monday.com developer account).
- Nameplate-photo OCR fallback is planned but not built; today an unknown QR results in `scan-not-found`.

## Change Log
- 2026-05-04 — "Open CMMS" button added to all asset-scan pages (CRA-20).
- 2026-04-26 — `/sample` and `/activated` routed via nginx to `mira-web` on `app.factorylm.com`.
