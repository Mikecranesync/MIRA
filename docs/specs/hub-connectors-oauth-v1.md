# MIRA Hub — Integration Connectors v1 (Google Workspace)

**Status:** In progress (branch `feat/hub-google-connector`)
**Author:** auto-generated spec
**Date:** 2026-04-23

---

## Why

Industrial maintenance teams store equipment manuals in Google Drive, take equipment photos on company phones (synced to Drive), and write procedures in Word/Docs. Before this feature, getting those files into MIRA's knowledge base required manual downloads and re-uploads. The result: stale KB, fragmented workflows, and technicians who give up and search Google instead.

**Hub connectors close that gap.** Once a Google Workspace connection is authorized, any technician with an active MIRA account can browse their Drive files and import them into MIRA's KB in two clicks.

---

## What It Builds

### `/hub` Integration Marketplace Page

- Auth-gated (active tenant required — redirects to `/cmms` otherwise)
- Shows a card grid with 3 connectors:
  - **Google Workspace** — live (v1)
  - **Microsoft 365** — coming soon
  - **Slack** — coming soon
- Each card: logo, name, subtitle, description, status badge (Connected / Not Connected / Coming soon), action buttons

### Google Workspace Integration

After connecting, the Google card gains:
- **Connected email** shown on card
- **Browse Drive** button → opens Drive file browser panel
- **Disconnect** button → revokes OAuth token

### Drive File Browser

- Lists PDFs, images (JPG/PNG/etc.), and Word documents (.docx) from the user's Drive
- Sort: most recently modified first
- Each file: icon, filename, size, last-modified date, Import button
- Import status badge: idle → Importing… → Indexed ✓ / Failed

---

## Architecture

```
Browser (/hub)
    │
    ├── GET /api/connectors         → list connected providers
    ├── GET /api/oauth/google/authorize → start PKCE flow (requireActive)
    │       │
    │       └── redirect → accounts.google.com (user consents)
    │                │
    │                └── redirect → GET /api/oauth/google/callback
    │                                   │
    │                                   ├── verify state JWT
    │                                   ├── exchange code (PKCE)
    │                                   ├── fetch userinfo
    │                                   ├── UPSERT connector_tokens
    │                                   └── redirect → /hub?connected=google
    │
    ├── GET /api/google/drive/files → list Drive files (drive.readonly scope)
    │
    └── POST /api/google/drive/import → download from Drive, send to mira-ingest
            │
            ├── PDF/image  → Drive download → mira-ingest /ingest/document-kb or /ingest/photo
            └── DOCX       → Drive Export API (→ PDF) → mira-ingest /ingest/document-kb
```

---

## OAuth 2.0 + PKCE Flow

Google OAuth uses PKCE (RFC 7636) — the code verifier is stored in a signed 10-minute JWT passed as the `state` parameter, eliminating the need for server-side session storage.

### 1. Authorization Request

```
GET /api/oauth/google/authorize   (requireActive — reads JWT from ?token= or cookie)

Server actions:
  codeVerifier  = generateCodeVerifier()  // 32 random bytes, base64url
  codeChallenge = SHA-256(codeVerifier), base64url
  stateJwt      = signJWT({ codeVerifier, nonce, tenantId, provider: 'google' }, 10min)

Redirect to:
  https://accounts.google.com/o/oauth2/v2/auth
    ?client_id=GOOGLE_CLIENT_ID
    &redirect_uri=https://app.factorylm.com/api/oauth/google/callback
    &response_type=code
    &scope=openid email profile https://www.googleapis.com/auth/drive.readonly
    &access_type=offline
    &prompt=consent
    &code_challenge={codeChallenge}
    &code_challenge_method=S256
    &state={stateJwt}
```

### 2. Callback

```
GET /api/oauth/google/callback?code={authCode}&state={stateJwt}

Server actions:
  1. jwtVerify(stateJwt)   → extract { codeVerifier, tenantId }
  2. POST https://oauth2.googleapis.com/token
       { code, code_verifier, client_id, client_secret, redirect_uri, grant_type }
     → { access_token, refresh_token, id_token, expires_in }
  3. GET https://www.googleapis.com/oauth2/v3/userinfo
     → { email, name, picture }
  4. UPSERT connector_tokens
  5. Redirect → /hub?connected=google
```

---

## redirect_uri_mismatch Fix

The `Error 400: redirect_uri_mismatch` error occurs when the URI in the authorization request does not match any URI registered in Google Cloud Console.

**Action required:**
1. Go to [Google Cloud Console](https://console.cloud.google.com) → APIs & Services → Credentials
2. Select the OAuth 2.0 client (`GOOGLE_CLIENT_ID`)
3. Under **Authorized redirect URIs**, add:
   ```
   https://app.factorylm.com/api/oauth/google/callback
   http://localhost:3200/api/oauth/google/callback
   ```
4. Save — changes propagate in ~5 minutes

The app derives the redirect URI dynamically from `PUBLIC_URL` env var:
```typescript
`${process.env.PUBLIC_URL ?? 'http://localhost:3200'}/api/oauth/google/callback`
```

---

## File Import Routing

| Source MIME Type | Drive action | mira-ingest endpoint |
|------------------|-------------|---------------------|
| `application/pdf` | Direct download | `/ingest/document-kb` |
| `image/*` (JPG, PNG, etc.) | Direct download | `/ingest/photo` |
| `application/vnd.openxmlformats-officedocument.wordprocessingml.document` (DOCX) | Export as PDF via Drive API | `/ingest/document-kb` |

**DOCX → PDF conversion is handled by Google's Drive Export API** — zero dependencies on the MIRA side.

---

## API Reference

### `GET /api/connectors`
Requires active tenant JWT.

Response:
```json
{
  "connectors": [
    {
      "provider": "google",
      "connected": true,
      "email": "mike@factorylm.com",
      "display_name": "Mike Harper",
      "avatar_url": "https://...",
      "scope": "openid email profile https://www.googleapis.com/auth/drive.readonly",
      "expires_at": "2026-05-23T10:00:00Z",
      "connected_at": "2026-04-23T12:00:00Z"
    }
  ]
}
```

### `GET /api/oauth/google/authorize`
Requires active tenant JWT (`?token=` or `Authorization: Bearer`). Redirects to Google.

### `GET /api/oauth/google/callback`
No auth header (state JWT provides identity). Handles OAuth callback, stores tokens, redirects to `/hub`.

Error redirects: `/hub?error=access_denied|invalid_state|token_exchange|userinfo|db`

### `DELETE /api/connectors/google`
Requires active tenant JWT. Revokes token with Google (best-effort) and deletes from DB.

Response: `{ "ok": true }`

### `GET /api/google/drive/files`
Requires active tenant JWT + connected Google account.

Response: `{ "files": [{ "id", "name", "mimeType", "size", "modifiedTime" }] }`

Error 401 if token expired: `{ "error": "Google token expired. Please reconnect." }`

### `POST /api/google/drive/import`
Requires active tenant JWT + connected Google account.

Body: `{ "fileId": "1abc...", "mimeType": "application/pdf", "fileName": "motor-manual.pdf" }`

Response: forwarded from mira-ingest (200 on success, 4xx/5xx on error)

### `POST /api/ingest/photo`
Requires active tenant JWT. Multipart: `file` (image/*), optional `asset_tag`, `location`, `notes`.

---

## Database Schema

```sql
CREATE TABLE connector_tokens (
  id            SERIAL PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES plg_tenants(id) ON DELETE CASCADE,
  provider      TEXT NOT NULL CHECK (provider IN ('google', 'microsoft', 'slack')),
  access_token  TEXT NOT NULL,
  refresh_token TEXT,
  token_type    TEXT NOT NULL DEFAULT 'Bearer',
  scope         TEXT,
  expires_at    TIMESTAMPTZ,
  metadata_json TEXT,  -- JSON: {email, display_name, avatar_url}
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, provider)
);

CREATE INDEX idx_connector_tokens_tenant ON connector_tokens (tenant_id);
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GOOGLE_CLIENT_ID` | ✓ | OAuth 2.0 client ID from Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | ✓ | OAuth 2.0 client secret |
| `PUBLIC_URL` | recommended | Base URL for redirect URI construction (default: `http://localhost:3200`) |

**Already in Doppler `factorylm/prd`:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`

### Playwright test credentials (add before E2E run)

| Variable | Description |
|----------|-------------|
| `PLAYWRIGHT_TEST_TENANT_TOKEN` | Active tenant JWT for hub page auth |
| `PLAYWRIGHT_GOOGLE_USER` | Google test account email |
| `PLAYWRIGHT_GOOGLE_PASS` | Google test account password |

---

## Google Cloud Console Setup

1. [console.cloud.google.com](https://console.cloud.google.com) → Select project
2. **APIs & Services → Library** → Enable:
   - Google Drive API
   - Gmail API (for future Gmail scopes)
3. **APIs & Services → Credentials → OAuth 2.0 Client ID**
4. Add to **Authorized redirect URIs**:
   ```
   https://app.factorylm.com/api/oauth/google/callback
   http://localhost:3200/api/oauth/google/callback
   ```
5. **OAuth consent screen** → Scopes → Add:
   - `openid`
   - `email`
   - `profile`
   - `https://www.googleapis.com/auth/drive.readonly`
6. If app is in Testing mode, add test user emails under "Test users"

---

## Security Considerations

| Concern | Mitigation |
|---------|-----------|
| CSRF on callback | State JWT signed with `PLG_JWT_SECRET` (HS256, 10-min expiry) |
| Authorization code interception | PKCE S256 — code useless without verifier in state JWT |
| Refresh token persistence | Stored server-side in `connector_tokens` only; never sent to browser |
| Cross-tenant token access | All queries filter by `tenant_id` from verified JWT payload |
| Expired tokens | `expires_at` stored; future work: auto-refresh via `/token` endpoint with `refresh_token` |

---

## Playwright E2E Test Plan

Location: `mira-web/tests/hub.e2e.ts`

| # | Scenario | Pass condition |
|---|----------|---------------|
| 1 | Hub page loads | 3 connector cards visible |
| 2 | Unauthenticated redirect | `/hub` without token → `/cmms` |
| 3 | Connect Google end-to-end | Real OAuth flow → Connected badge + email shown |
| 4 | Drive panel opens | Browse Drive button → file list renders |
| 5 | Import PDF | `sample-labels.pdf` → "Indexed ✓" |
| 6 | Import photo | `nameplate_gs10.jpg` → "Indexed ✓" |
| 7 | Import DOCX | `MIRA-Projects-PRD-v1.docx` → "Indexed ✓" (converted via Drive export) |
| 8 | Disconnect | Disconnect button → Not Connected badge |

Pre-upload test fixtures to your Google test account Drive:
```bash
# From repo root — copy the 3 proof-of-work files to Google Drive manually or via gdrive CLI
tests/fixtures/nameplate_gs10.jpg
tools/sample-labels.pdf
docs/proposals/MIRA-Projects-PRD-v1.docx
```

Run: `doppler run -p factorylm -c prd -- bun run test:e2e`

---

## Future Work (v2)

- **Token refresh** — use `refresh_token` to obtain new `access_token` before expiry
- **Microsoft 365** — same PKCE flow, `MicrosoftEntraId` tenant=`common`
- **Slack** — standard OAuth 2.0 (state-only CSRF), workspace-level channels
- **Gmail scope** — `gmail.send` for maintenance alert emails
- **Calendar scope** — `calendar.readonly` for PM schedule imports
- **Webhook sync** — Drive change notifications → auto-reimport on file update
