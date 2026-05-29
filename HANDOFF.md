# HANDOFF — feat/hub-discovery-scan

**Date:** 2026-05-29 · **Branch:** `feat/hub-discovery-scan` (off `origin/main` @ 16c4d3b4)
**Worktree:** `.claude/worktrees/hub-discovery/` · **Status:** ✅ complete, all 8 PLAN tasks done.

## What was done — vs PLAN, row by row

| # | Task | Status | Evidence |
|---|------|--------|----------|
| 1 | Types + `validateInventory()` | ✅ | `src/lib/discovery.ts` + `discovery.test.ts` (7 tests pass) |
| 2 | In-memory per-tenant store | ✅ | `src/lib/discovery-store.ts` (covered by route test) |
| 3 | API route (GET/POST, sessionOr401) | ✅ | `src/app/api/discovery/route.ts` + `route.test.ts` (6 tests: POST→GET roundtrip, bad-schema 400, tenant isolation) |
| 4 | Device table component | ✅ | `src/components/discovery/device-table.tsx` (tier colors, unknowns, empty state) |
| 5 | `/discovery` page | ✅ | `src/app/(hub)/discovery/page.tsx` (GET on mount, drag-drop + file upload, refresh) |
| 6 | Nav entry | ✅ | `NAV_ITEMS` in `access-control.ts` + icon/label in `sidebar.tsx` (Radar icon, secondary group) |
| 7 | Local Playwright e2e | ✅ | `playwright.discovery.config.ts` + `tests/e2e/discovery.spec.ts` — **1 passed** |
| 8 | Screenshots | ✅ | `docs/promo-screenshots/2026-05-29_hub-discovery-scan_{desktop,mobile}.png` (real fixture data) |

## How to verify

```bash
cd mira-hub
bunx vitest run src/lib/discovery.test.ts src/app/api/discovery/route.test.ts   # 13 pass
bun run lint                                                                      # discovery files clean
NEXT_PUBLIC_BASE_PATH="" NEXT_PUBLIC_API_BASE="" npm run build                    # exit 0
npx playwright install chromium && npx playwright test -c playwright.discovery.config.ts  # 1 pass
```

## Design decisions (so review is fast)

- **Separate `/discovery` route** — `(hub)/scan` is the QR camera scanner; left untouched (per goal).
- **In-memory, latest-only store** (`discovery-store.ts`). Deliberate v1 (spec §3 defers NeonDB to v1.5).
  **Limitations (documented in the route + store):** lost on process restart; NOT multi-instance-safe.
  Holds for today's single `next start` deploy. Replace with a NeonDB table when scan history is needed.
- **Browser drag-drop upload only.** The CLI (`discover.py`) can't POST directly — no session cookie.
  A service-token push route (cf. `api/uploads/folder`) is a deferred follow-up.
- **uns_hint is displayed read-only.** Wiring it to `ai_suggestions`/KG is v1.5 (spec §8/§12) — out of scope.
- **Mobile bottom-tab bar (`bottom-tabs.tsx`) deliberately NOT expanded** — it's a curated 3-item set.
  `/discovery` is reachable via the desktop sidebar; the page itself is mobile-responsive (412px verified).

## Risks / things to know

- **e2e config caveat:** `next.config.ts` uses `output: "standalone"`, so `next start` prints a warning
  (`"next start" does not work with "output: standalone"`). It served correctly here and the test passed,
  but if wired into CI later, switch the webServer command to `node .next/standalone/server.js` (needs
  static-asset copy) for full fidelity. This config is **not** auto-run by CI today — it's a manual proof.
- The local e2e webServer logs unrelated `api/me`/postgres `ECONNREFUSED` noise (no DB locally). The page
  tolerates it (sidebar `/api/me` failure is caught); discovery rendering is unaffected.
- No Python/engine/RAG/FSM code touched → offline eval baseline (`tests/eval/`) is unaffected; not re-run.

## Decisions needed from operator

- None to ship v1. Follow-ups (file as issues if desired): (a) CLI→Hub service-token push route,
  (b) v1.5 uns_hint → ai_suggestions, (c) NeonDB-backed scan history.

## Commits on this branch

- `feat(hub): fieldbus-discovery scan display in /discovery` (data + API + UI + nav)
- `test(hub): local e2e + promo screenshots for /discovery`
- (+ this HANDOFF.md and the PLAN.md scope contract)
