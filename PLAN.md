# PLAN — feat/hub-discovery-scan

**Status:** Active (2026-05-29)
**Branch:** `feat/hub-discovery-scan` (off `origin/main` @ 16c4d3b4)
**Worktree:** `.claude/worktrees/hub-discovery/`
**Operator:** Mike · **Token budget:** default · **Max turns before compact:** 200

> This file is THIS branch's scope contract. (Previous PLAN.md was the stale May-20
> hub-overhaul brief, already shipped on another branch — overwritten.)

---

## Goal (one sentence)

A "Discovery" page in the MIRA Hub that displays the output of `plc/discover.py`
(`fieldbus-inventory/1` payloads) in the browser — device table with tier color-coding,
drag-drop upload, mobile-responsive — proven by a passing local Playwright e2e + screenshots.

## In scope — numbered, ordered, **complete this list and STOP**

1. **Types + validation** — `mira-hub/src/lib/discovery.ts`: TS types for
   `FieldbusInventory` / `FieldbusDevice` / `FieldbusUnknown` + `validateInventory()`
   guard (schema must equal `fieldbus-inventory/1`). Unit test `src/lib/discovery.test.ts`.
2. **Store** — `mira-hub/src/lib/discovery-store.ts`: in-memory `Map<tenantId, FieldbusInventory>`
   module singleton, latest-only. Documented limit: lost on restart, not multi-instance-safe.
3. **API route** — `mira-hub/src/app/api/discovery/route.ts`: `sessionOr401` on GET + POST.
   GET → stored payload for tenant (or `{inventory:null}`). POST → validate schema → store.
   `force-dynamic`. Unit test `src/app/api/discovery/route.test.ts` (POST→GET roundtrip, bad schema → 400).
4. **Presentational component** — `mira-hub/src/components/discovery/device-table.tsx`:
   device cards (address, transport, protocol, tier, profile|"—", identity, uns_hint,
   next_actions, evidence), tier color (device_identified=green, protocol_confirmed=yellow,
   port_open=dim), `unknowns` muted section, empty state.
5. **Page** — `mira-hub/src/app/(hub)/discovery/page.tsx`: client component; GET on mount;
   drag-drop + file-input upload that POSTs inventory.json; renders DeviceTable. Mobile-readable at 412px.
6. **Nav** — add `discovery` item to `NAV_ITEMS` in `src/providers/access-control.ts`;
   add icon + `navLabel` entry in `src/components/layout/sidebar.tsx`.
7. **e2e proof** — `mira-hub/playwright.discovery.config.ts` (local `next build && next start`,
   `NEXT_PUBLIC_BASE_PATH=""`, fixed `AUTH_SECRET`) + `tests/e2e/discovery.spec.ts`
   (mint next-auth JWT cookie via `encode()`, POST fixture through the REAL route, load
   `/discovery`, assert micro820 row renders green with its `uns_hint`). Fixture
   `tests/e2e/fixtures/inventory.sample.json` (micro820 device_identified + port_open Modbus row + 1 unknown).
8. **Screenshots** — `docs/promo-screenshots/2026-05-29_hub-discovery-scan_desktop.png`
   (1440x900) + `_mobile.png` (412x915), real fixture data.

## Explicitly OUT of scope (do not touch)

- `mira-hub/src/app/(hub)/scan/page.tsx` — existing QR camera scanner. Separate surface.
- Live scan from browser (env boundary — cloud can't reach plant LAN).
- v1.5 `uns_hint` → `ai_suggestions` / KG auto-onboarding (spec §8/§12). Display the hint only.
- NeonDB persistence / scan history (v1 = latest-only in-memory).
- Service-token CLI→Hub push route (deferred; v1 = browser drag-drop only).
- `bottom-tabs.tsx` curated 3-item mobile bar (deliberately not expanded).
- `plc/discover.py`, `device-profiles/` (read for schema only).
- **No prod NeonDB, no VPS docker, no prod bot. Prod blocked by hooks.**

## Success criteria — per task

| # | Task | How "done" is measured |
|---|------|------------------------|
| 1 | Types+validation | `bunx vitest run src/lib/discovery.test.ts` passes |
| 2 | Store | covered by route test |
| 3 | API route | `bunx vitest run src/app/api/discovery/route.test.ts` passes (POST→GET, bad schema 400) |
| 4-6 | Page/component/nav | `npm run build` exits 0; `bun run lint` clean |
| 7 | e2e | `npx playwright test -c playwright.discovery.config.ts` passes |
| 8 | Screenshots | both PNGs exist in `docs/promo-screenshots/` |

## Stop conditions (any one → stop and write HANDOFF.md)

- All 8 tasks complete (then STOP — no scope expansion).
- Stop-gate (`npm run build`) blocks the same gate twice in a row.
- Any modification would touch an OUT-of-scope file.
- > 5 consecutive turns on the same failing test.
- Token > 70% or turns > 200.

## Commit / branch policy

- Conventional commits. Push to `feat/hub-discovery-scan` only. Never main/develop/dev.
- Commit every 20–30 turns of useful work.

## Handoff protocol

- Write `HANDOFF.md` (template `docs/templates/overnight-HANDOFF.md`) before stopping for any reason.
