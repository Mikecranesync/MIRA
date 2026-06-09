# Hub Polish Sweep — 2026-06-06

> Close the 5 open findings from `docs/hardening/hub-hardening-backlog.md` against `app.factorylm.com/hub`. One PR per fix. Each fix is dispatched to a specialized subagent. Verification by the `web-review` skill after the last merge.

**Source audit:** commit `749aca0a` on branch `chore/hub-hardening-audit` (preflight task #0 lands it on `main`).
**In flight (do not redo):** PR #1765 — Command Center iframe → "Open Live View" handoff. `mira-hub/v1.10.0`.

---

## Subagent assignments

| # | Subagent | Issue | Goal | Tasks | Skills |
|---|---|---|---|---|---|
| 0 | `engineer` | preflight | Audit doc on `main`. | Cherry-pick `749aca0a` to a branch off `main`; PR `docs(hardening): hub audit backlog`. | `verification-before-completion` |
| 1 | `backend-developer` | **#1761** KB-chunks tile = 0 | `/usage` "KB Chunks" reflects real `knowledge_entries` (~83.5k). | Drop `WHERE tenant_id=$1` on `kbRows` SQL in `mira-hub/src/app/api/usage/route.ts:63-66` (mirror `mira-hub/src/app/api/knowledge/route.ts:9-18`). Patch bump + CHANGELOG. | `codegraph-usage`, `verification-before-completion` |
| 2 | `security-engineer` | **#1762** sec headers + `/scan` CSP | HSTS + `X-Frame-Options`/`frame-ancestors` set; `X-Powered-By` removed; `/scan` keeps `frame-ancestors *.monday.com`. | Re-verify nginx `add_header` block. In `mira-hub/src/middleware.ts:96-118` CSP builder, branch `frame-ancestors` on `pathname.startsWith("/scan")`. `poweredByHeader: false` in `next.config.ts` (or nginx `more_clear_headers`). Curl probe before merge. | `security-hardening`, `verification-before-completion` |
| 3 | `designer` | **#1763** `/scan` 412px overflow | `/scan` renders cleanly at 412×915 inside monday item-view iframe — no horizontal scroll. | Reproduce in Playwright mobile preset. Fix `mira-hub/src/app/(hub)/scan/page.tsx:117-144` — `max-w-md` → `w-full max-w-md` or `max-w-[min(28rem,100vw-2rem)]`. Capture before/after to `docs/promo-screenshots/` per Screenshot Rule (desktop + mobile). | `web-review`, `verification-before-completion` |
| 4 | `backend-developer` | **#1764** unauth `/api/*` → 401 JSON | `curl /api/usage` (unauth) returns `401 JSON`, not 308/HTML login. | In `mira-hub/src/middleware.ts:148-156`, branch on `pathname.startsWith("/api/")` → `NextResponse.json({error:"Unauthorized"}, {status:401})` with CSP attached. Match `mira-hub/src/lib/session.ts:85-91` `sessionOr401()` shape exactly. Regression test in `mira-hub/tests/e2e/`. | `codegraph-usage`, `verification-before-completion` |
| 5 | `security-engineer` | **#1756** Google OAuth | Google sign-in works in prod. | Confirm Doppler `factorylm/prd:NEXTAUTH_URL=https://app.factorylm.com`. Confirm boot log on VPS shows `https://app.factorylm.com/api/auth/callback/google` from `mira-hub/src/auth.ts:87-104`. Post the exact URI in the issue, tag `ready-for-human`, stop. Mike adds it in Google Console. Agent re-tests after. | `verification-before-completion` |
| 6 | `feature-dev:code-reviewer` | gate | Each PR stays surgical — no scope creep. | Review each PR diff before merge. Reject if it touches files outside its issue's "Fix location" row without explicit Mike approval. | `solid-code-review`, `verification-before-completion` |
| 7 | `claude` + `web-review` | final verify | All 4 code-side fixes hold on live prod. | Authed `web-review` against `https://app.factorylm.com/hub` (login recipe in the audit doc). Re-probe each fix. Report to `tools/web-review-runs/2026-06-06-hub-polish-verify/AUDIT.md` (NOT `wiki/reviews/` — canary clobbers it). | `web-review`, `verification-before-completion` |

---

## Sequencing

`#0` lands → `#1, #2, #3, #4, #5` run in parallel (PR cap: 2 concurrent). Each merge → `deploy-vps.yml -f services=mira-hub` → Playwright verify → screenshot → next PR (per `feedback_post_pr_verify_loop`). `#6` gates each merge. `#7` runs after the last code-side merge. `#5`'s vendor-admin step waits on Mike — no PR spam after the stop.

---

## Done when

- Audit doc on `main`. PR #1765 merged + deployed + verified.
- Issues **#1761, #1762, #1763, #1764** closed by their merged PRs.
- Issue **#1756** code-side checked; comment posts the exact `redirect_uri`; closed after Mike's Console click + re-test.
- `tools/web-review-runs/2026-06-06-hub-polish-verify/AUDIT.md` exists, pass/fail per issue, evidence quoted.
- `mira-hub/CHANGELOG.md` + `mira-hub/package.json` bumped per Versioning Discipline; namespaced tag `mira-hub/vX.Y.Z` pushed for each release.

---

## Hard constraints (inherited)

- One PR per fix; no bundling.
- `mira-hub` semver + `mira-hub/vMAJOR.MINOR.PATCH` tag at each merge.
- Screenshot Rule on any `/scan` change (1440×900 + 412×915 to `docs/promo-screenshots/`).
- Env doctrine: dev → staging → prod. No prod `psql`, no direct VPS `docker compose`, no Anthropic provider.
- Completion vocabulary: "PR open" / "in review" / "awaiting smoke" — never "shipped" / "done" until prod-verified.
- Web-review reports go to `tools/web-review-runs/<date>-<slug>/`, never `wiki/reviews/`.

---

## Out of scope

- Trailing-slash 308 (#1597) and `/hub/*` 301-strip (#1292/#1355/#1357) — already-tracked dups, need cross-service nginx work.
- `/admin/review` 500 (#1595) — needs its own verify task next sweep.
- `docs/plans/2026-05-28-hub-qa-fixes.md` (WS-A/B/C/D) — different surface (demo data + admin filters).
- Refactors / SOLID cleanups untraced to a specific audit row.
- mira-pipeline / mira-ask / kiosk — separate verticals.

---

## Verification probes (run after the last code-side merge)

```bash
BASE=https://app.factorylm.com; JAR=cookies.txt
CSRF=$(curl -sL -c $JAR -b $JAR "$BASE/api/auth/csrf" | sed -E 's/.*"csrfToken":"([^"]+)".*/\1/')
curl -sL -c $JAR -b $JAR -X POST "$BASE/api/auth/callback/credentials/" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode "csrfToken=$CSRF" \
  --data-urlencode "email=$USER_EMAIL" --data-urlencode "password=$USER_PW" \
  --data-urlencode "json=true"

curl -sL -b $JAR "$BASE/api/usage" | jq '.allTime.totalKbChunks'          # #1761 — ~83553
curl -sIL "$BASE/" | grep -iE '^(strict-transport-security|x-frame-options|content-security-policy|x-powered-by)'  # #1762
curl -sIL "$BASE/scan" | grep -i 'content-security-policy'                # #1762 — frame-ancestors *.monday.com
curl -sIL "$BASE/api/usage" | head -3                                     # #1764 — HTTP/2 401 + application/json
curl -s   "$BASE/api/usage"                                               # #1764 — {"error":"Unauthorized"}
# /scan 412px overflow — web-review mobile viewport screenshot
# Google sign-in — incognito click after Mike's Console URI add
```
