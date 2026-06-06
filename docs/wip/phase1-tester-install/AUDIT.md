# Phase 1 Tester-Install Audit — mira-scan-monday

**Date:** 2026-05-26
**Goal lock:** 2026-07-19 — first non-Mike Monday account installs `mira-scan-monday` end-to-end without Mike touching anything.
**Plan:** `~/.claude/plans/dev-api-key-for-optimized-badger.md` Phase 1.

This audit walks the 8-step tester-install flow described in the goal,
checks each step against (a) code present on `main`, (b) deployed on
VPS, (c) actually exercised in prod logs. Gaps are linked to the
PR(s) opened to close them.

## Service map (verified 2026-05-26)

| Surface                                                     | Container          | Listens   |
|-------------------------------------------------------------|--------------------|-----------|
| `https://app.factorylm.com/scan/`                           | mira-scan-frontend | :5180→:80 |
| `https://app.factorylm.com/api/scanbe/*`                    | mira-scan-backend  | :8090→:8000 |
| `mira-scan-backend` healthcheck (`/healthz`)                | mira-scan-backend  | passing   |

Both containers report **healthy** on the VPS (`docker ps`).

## Flow walk

| # | Step                                                     | Code | Deployed | Exercised in prod | Gap → fix PR |
|---|-----------------------------------------------------------|------|----------|-------------------|--------------|
| 1 | Install from Dev Center sandbox                          | n/a  | n/a      | n/a               | Mike action — task #11 |
| 2 | OAuth consent → callback → token persisted by account_id | ✅ `backend/oauth.py`, `backend/main.py:85-210` | ⚠️ container running, **but** `/api/scanbe/oauth/monday/install` returns `503 OAuth is not configured (MONDAY_OAUTH_CLIENT_ID/SECRET missing)` | ❌ never reached | **PR #1557** — alias legacy Doppler names into compose env block |
| 3 | iframe sessionToken → account_id verified                | ✅ `backend/session.py` (8 unit tests) | ⚠️ `MONDAY_SIGNING_SECRET` not plumbed through compose env block; falls through to also-missing `MONDAY_OAUTH_CLIENT_SECRET` → always returns `None` (treated as standalone) | ❌ never reached | **PR #1557** (same — plumbs `MONDAY_SIGNING_SECRET`) |
| 4 | Scan a nameplate → AssetCard populated → KB lookup scoped | ✅ `backend/vision.py`, `backend/mira_rag.py`, `backend/main.py:213-287` | ⚠️ `OPENAI_API_KEY` not plumbed through compose env block; vision extract 502s | ❌ never reached | **PR #1557** (same — plumbs `OPENAI_API_KEY`, `MIRA_KB_*`) |
| 5 | MiraChat → ask question → sourced answer                 | ✅ `backend/main.py:328-378`, `backend/mira_rag.py`, `backend/vendor_rag.py` | ⚠️ same env-plumbing gap blocks vendor RAG cascade | ❌ never reached | **PR #1557** (same) |
| 6 | Save-to-item → Monday GraphQL writes tester's token      | ✅ `backend/monday_api.py:_resolve_token` selects per-account OAuth token, falls back to `MONDAY_API_TOKEN` for standalone | ⚠️ `MONDAY_API_TOKEN` legacy-named in Doppler (`MONDAY_API_KEY`), not plumbed | ❌ never reached | **PR #1557** (same — aliases `MONDAY_API_TOKEN` to `MONDAY_API_KEY`) |
| 7 | `/chat/message` rate-limit + monthly-cap fire per account | ✅ `backend/rate_limit.py` (sliding window, CRA-159), `backend/usage.py` (`FREE_TIER_MONTHLY_CHAT_CAP=200`) | ✅ in-memory + Neon; tables created idempotently at startup | ⚠️ exercised only as Mike's standalone path today (no `account_id`); auth path blocked by gap #3 | unblocked by **PR #1557** |
| 8 | Uninstall path → token revoked → next call shows reinstall CTA | ⚠️ Backend marks `revoked_at` + returns `{ok:false, error:"reinstall_required:..."}` ✅; **frontend never calls `redirectToInstall()`** — `AssetCard.handleSave` just displays the error text. | n/a (backend deployed, frontend deployed) | ❌ no install ever exists to revoke | **PR #1558** — frontend reinstall CTA |

## Findings (root causes)

### 🔴 P0 — Doppler/compose env-plumbing mismatch (blocks steps 2-6)

The Phase 1A code (merged 2026-05-05) reads env vars by their new
`MONDAY_OAUTH_*` / `MONDAY_API_TOKEN` names. Doppler `factorylm/prd`
still holds those secrets under the older names
`MONDAY_CLIENT_ID / MONDAY_CLIENT_SECRETS / MONDAY_API_KEY`. Per
[`feedback_compose_env_plumbing.md`](https://github.com/Mikecranesync/MIRA/blob/main/CLAUDE.md)
a secret only reaches a container if it is listed in the compose env
block, so the container started with all OAuth values empty.

**Verification before fix:**

```
$ curl -sI https://app.factorylm.com/api/scanbe/oauth/monday/install
HTTP/1.1 503 Service Unavailable
{"detail":"OAuth is not configured (MONDAY_OAUTH_CLIENT_ID/SECRET missing)"}
```

**Fix:** **PR #1557** aliases the new names to the legacy names inside
the compose env block — no Doppler write required.

### 🟡 P1 — Bare `/oauth/monday/install` lands on Hub login (deferred)

`https://app.factorylm.com/oauth/monday/install` (bare) 307-redirects
to `app.factorylm.com/login/?callbackUrl=...` (the Next.js Hub auth
gate). Reachable paths are only at `/api/scanbe/...`. This only
matters if marketplace listing copy or external links point at the
bare path; `marketplace/monday/security-audit.md:33` documents the
bare path. **Action:** Mike confirms Monday Dev Center has the
`/api/scanbe/...` URL registered (task #11). If listing copy needs
updating, that's a follow-up PR.

### 🟡 P1 — Frontend reinstall CTA not wired (step 8)

`monday.js:redirectToInstall()` was added but no caller used it.
**Fix:** **PR #1558** wires it inside `AssetCard.handleSave`.

### 🟢 OK — Backend code is complete

OAuth callback, install URL builder, per-account token lookup,
401-on-Monday → `mark_revoked()`, sessionToken JWT verify,
webhook signature verify, install/uninstall/subscription event
dispatch — all present on `main` with unit tests
(`backend/tests/test_oauth.py`, `test_session.py`, `test_webhooks.py`,
`test_usage.py`, `test_rate_limit.py`).

## Mike-blocking actions (cannot be agent-completed)

| # | Action | Why |
|---|--------|-----|
| 1 | Approve PR #1557 with one-word OK in chat | Per repo PR discipline; sweep cannot proceed without redeploy + env values present |
| 2 | After PR #1557 deploys, confirm `MONDAY_OAUTH_REDIRECT_URI` (in Doppler) matches the redirect URI registered in Monday Developer Center | Read-only verification — `redirect_uri=` param shows up non-secret in the install 302 `Location` header |
| 3 | After PRs #1557 + #1558 are live, share Monday Dev Center sandbox install URL | Tester install walkthrough cannot start without the install URL |
| 4 | Approve PR #1558 with one-word OK | Closes step-8 reinstall UX gap |

## Tester-install walkthrough (post-PR-1557 merge)

When the keystone PR lands and Mike confirms redirect URIs match, the
walkthrough captures these receipts under
`tools/web-review-runs/2026-05-26-tester-install/`:

| Step | Receipt |
|------|---------|
| OAuth callback | `oauth-callback.har` (browser DevTools export) |
| `monday_installations` row diff | `db-row-before.txt` + `db-row-after.txt` |
| `/monday/update-item` response | `monday-update-response.json` |
| Backend logs scoped to tester `account_id` | `mira-scan-backend.log` |
| Final screenshot — item view with extracted columns | `assetcard-saved.png` |

## Out of scope (deferred per goal)

- UpKeep / Phase 2
- Stripe / paywall / Monday billing
- Listing artifacts polish (Phase 1 C)
- Submit click (Phase 1 D)
- Linear hygiene

## Done-when

- [x] AUDIT.md on main
- [ ] PR #1557 merged + scan-backend redeployed
- [ ] `/api/scanbe/oauth/monday/install` returns 302 to `auth.monday.com/oauth2/authorize?...`
- [ ] PR #1558 merged + scan-frontend redeployed
- [ ] Receipts captured under `tools/web-review-runs/2026-05-26-tester-install/`
- [ ] One paragraph report: which steps worked, which broke, what unblocked
