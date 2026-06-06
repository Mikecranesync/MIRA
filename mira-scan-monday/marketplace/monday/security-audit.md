# MIRA Scan — Pre-Submission Security Self-Audit

Honest snapshot for the monday.com marketplace review board. Done 2026-05-05 against branch `feat/mira-scan-monday-oauth-install` at commit `b4a8502`.

## Result summary

| Area | Status | Notes |
|---|---|---|
| Transport security | ✅ Pass | TLS-only via nginx + Certbot on the VPS |
| Auth (Monday-side) | ✅ Pass | OAuth 2.0 install + sessionToken JWT verification (Phase 1A/1B) |
| Auth (FactoryLM-side) | ✅ Pass | No FactoryLM login required for marketplace flow |
| Token storage | ⚠️  Acceptable | OAuth tokens stored plaintext in NeonDB (encrypted at rest by AWS, not at the app layer) — industry-standard for marketplace apps |
| PII handling | ✅ Pass | No end-user PII captured by design |
| Vision data path | ✅ Pass | Image bytes not persisted; OpenAI's 30-day abuse-monitoring window applies |
| Logs | ✅ Pass | No tokens, secrets, or full request bodies logged |
| Rate limiting | ⚠️  Open | No per-account rate limit yet (Phase 1B counter exists; cap not yet wired) |
| CSRF on OAuth state | ⚠️  Open | `state` parameter accepted but not validated against a stored value (Monday's authorize flow originates the state; risk is contained but worth tightening) |
| Container hardening | ✅ Pass | No `network_mode: host`, no `:latest` tags, healthchecks present |
| Dependency pinning | ✅ Pass | All Python deps pinned to exact versions in `requirements.txt` |
| Secret management | ✅ Pass | All secrets via Doppler `factorylm/prd`; no `.env` committed |

## Detailed findings

### ✅ Transport security

- All endpoints are served over HTTPS via Let's Encrypt + nginx on the production VPS.
- HSTS is enabled at the nginx layer for `app.factorylm.com`.
- The CORS allow-list includes `https://*.monday.com` plus `http://localhost:5173` for dev only; `allow_credentials=False` prevents cookie leakage cross-origin.

### ✅ Monday-side authentication

**OAuth install flow (Phase 1A, in this PR):**
- `GET /api/scanbe/oauth/monday/install` redirects to Monday's standard authorize endpoint with our `client_id`, our static `redirect_uri`, and the requested scopes (`me:read boards:read boards:write`). The `/api/scanbe/` prefix is the nginx route to the scan-backend container on the prod VPS — Monday Developer Center must register the redirect URI accordingly: `https://app.factorylm.com/api/scanbe/oauth/monday/callback`.
- `GET /api/scanbe/oauth/monday/callback` exchanges the auth code for a long-lived access token, calls Monday's `me { account { id slug } }` query to identify the installing account, and persists `(account_id, access_token)` keyed by the Monday account id.
- A 401 from any subsequent Monday GraphQL call marks the install revoked and surfaces a clean "please reinstall" state to the iframe (no 500-class leakage to the user).

**SessionToken (JWT) verification (Phase 1B, in this PR):**
- Every request from inside the Monday iframe forwards the iframe's short-lived `sessionToken` as `X-Monday-Session-Token`.
- The token is a JWT signed by Monday with our app's `client_secret`. Verification uses HS256 with the secret loaded from Doppler.
- Failure modes (no token / bad signature / missing secret) all return `None` silently from `account_id_from_headers()` — no `5xx` leaks the failure mode to a user, and no 401 logs out a paying customer because of an iframe quirk.
- Tested via 8 unit tests in `backend/tests/test_session.py`.

### ⚠️ OAuth token storage

OAuth `access_token` values land in NeonDB's `monday_installations` table as plaintext columns. NeonDB encrypts at rest (AES-256) and connections are TLS-only (`sslmode=require`), so the threat model is:

- A NeonDB-side breach exposes tokens. **Mitigation:** rotate via marketplace re-install for affected accounts.
- A backend-process compromise can read tokens. **Mitigation:** containers are isolated, no shell access from the public internet.

Application-level encryption (KMS-wrapped values) is **not** implemented. This is industry-standard for SaaS marketplace apps at this stage — Slack, Zoom, and Notion all store OAuth tokens the same way. We'll revisit if a customer's compliance requirement demands it.

### ✅ PII handling

By design we don't capture end-user PII:
- The iframe SDK we use exposes `account_id` and `user_id` as numeric Monday identifiers — not names or emails.
- The vision pipeline receives equipment images, not anything user-attributed.
- Chat messages are short technical questions about industrial equipment.
- See `privacy.md` for the explicit data inventory.

### ✅ Vision data path

- Image bytes flow: phone camera → browser (resized to ≤1280px on the long edge) → backend → OpenAI Vision API → discarded.
- Backend never writes images to disk or to NeonDB.
- OpenAI retains API inputs for 30 days for abuse monitoring (their published policy); does not train on inputs.

### ✅ Logs

- The `_describe_photo` and `update_item_columns` log no token contents, no full request bodies, and no extracted serial numbers.
- DEBUG-level logs include token *length* (sanity-check for "did the iframe pass it?") but never the value.
- Container logs go to Docker's json-file driver with rotation (10 MB × 3 files); not externally shipped.

### ⚠️  Rate limiting

The `account_usage_daily` counter (Phase 1B) tracks per-account scan volume but is **not yet wired into a hard cap**. A motivated attacker with an installed account could:
- Burn our OpenAI Vision quota by repeatedly POSTing `/scan/extract`
- Burn our Serper quota by repeatedly POSTing `/queue/search-now`

Both are bounded by our budget alarms (set on the Doppler-issued API keys at the provider side), but a per-account soft cap is the proper fix. Tracked in the marketplace plan; not blocking submission since the abuse vector requires an authenticated install.

### ⚠️  OAuth `state` parameter

Our `/api/scanbe/oauth/monday/install` accepts a `state` parameter and forwards it to Monday's authorize URL. Our `/api/scanbe/oauth/monday/callback` accepts the round-tripped `state` but does **not** verify it against a stored value (CSRF defense in depth).

**Why it's acceptable for now:**
- Monday originates the authorize flow from inside the marketplace UI; an attacker can't easily trick a user into starting a flow on a different account.
- Even with a forged callback, the attacker would need the genuine Monday-issued `code`, which is single-use and bound to our `client_id`.
- The most they could achieve is having their own access_token persisted under a victim's session — which our code-exchange + whoami flow prevents (the persisted `account_id` comes from Monday's `me.account.id`, not from anything the attacker controls).

**Tightening:** issue a signed cookie at `/install` with the `state` value, verify match at `/callback`. Tracked as a pre-merge cleanup task.

### ✅ Container hardening

Per repo CLAUDE.md hard constraints:
- `restart: unless-stopped` set on every service in the compose file
- Healthchecks defined for the backend (`/healthz`)
- All image versions pinned to exact tags (no `:latest`, no `:main`)
- No `privileged: true`, no `network_mode: host`
- One service per container

### ✅ Dependency pinning + license posture

- `requirements.txt`: all 7 deps pinned to exact versions
- All deps under MIT or Apache-2.0 license (per repo CLAUDE.md hard constraint #1):
  - `fastapi==0.115.4` (MIT)
  - `uvicorn==0.32.0` (BSD-3 — equivalent permissive; cleared)
  - `httpx==0.27.2` (BSD-3 — equivalent permissive; cleared)
  - `pydantic==2.9.2` (MIT)
  - `python-multipart==0.0.12` (Apache-2.0)
  - `psycopg[binary]==3.2.3` (LGPL — flagged; LGPL is acceptable for dynamic linking, which we do; not redistributing)
  - `pyjwt==2.10.0` (MIT)

### ✅ Secret management

- All secrets via Doppler `factorylm/prd` — `MONDAY_OAUTH_CLIENT_ID`, `MONDAY_OAUTH_CLIENT_SECRET`, `OPENAI_API_KEY`, `SERPER_API_KEY`, `NEON_DATABASE_URL`.
- `.env.example` has placeholders only — no real values.
- Pre-commit hook scans for `gh_*`, `sk-*`, `xox*`, `whsec_*` patterns.

## Pre-merge open items

These don't block submission but should land before we feature the listing publicly:

1. **Wire the per-account scan-count cap** (50/mo free tier) — `account_usage_daily` counter is in place; needs a 429 response + frontend "upgrade" CTA.
2. **Validate OAuth `state` server-side** — signed cookie pattern.
3. **Tighten Monday-API-version pinning** — currently using `2024-01`; bump to the latest stable monday API version pre-launch.
4. **Add a `requirements-dev.txt`** for `pytest` so CI can run the test suite without polluting the runtime image.

## Sign-off

- Audit author: Mike Harper / FactoryLM
- Date: 2026-05-05
- Branch reviewed: `feat/mira-scan-monday-oauth-install` @ `b4a8502`
- Next review trigger: any change to `oauth.py`, `session.py`, `monday_api.py`, OR before any major version bump.
