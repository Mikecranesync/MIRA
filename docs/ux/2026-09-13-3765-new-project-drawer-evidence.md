# #3765 New Project Affordance in Conversation Drawer — Visual Evidence

## Summary

Added a "New project" button parallel to "New chat" in the unified conversation drawer, with the same optional-hook pattern: enabled when host provides `onCreateProject`, disabled with aria-describedby hint when absent.

## Implementation SHA

- **Implementation commit:** `4c5817a601355eb3b1845128d9fcad9aa8b9cca6`
- **Base:** `99257d85e516bdba314ca16e45611ee9506d1e27`

## Test Evidence (RED → GREEN)

### Before Implementation (RED)
```
../../packages/factorylm-ui/src/__tests__/shell.test.tsx:
(fail) shared FactoryLM shell > renders and gates the New project button when hook is present [3.05ms]
(fail) shared FactoryLM shell > disables New project button with aria-describedby hint when hook is absent [2.88ms]

 10 pass
 2 fail
```

### After Implementation (GREEN)
```
../../packages/factorylm-ui/src/__tests__/shell.test.tsx:

 12 pass
 0 fail
 60 expect() calls
```

**Full test suite:** 212 tests across packages/factorylm-ui + mira-mobile, all passing.


## Canonical create surface (restructure, commit `baafdb76d`)

The first cut mounted the frozen classic `NotebooksTab` `CreateNotebook` screen
(one-word `export` diff) — the **Legacy UI Lifecycle Guard correctly failed** on
that guarded-path touch. Restructured per the cutover charter: the create-project
presentation now lives in the canonical unified tree
(`mira-mobile/src/unified/UnifiedCreateProject.tsx` + `unified.css`), reusing the
`createNotebook` capability as an adapter input. `NotebooksTab.tsx` is reverted
to base (guard-clean). Back returns to the conversation; success opens the new
project's first thread. Post-restructure suites: shared-UI 212/212 via lab
`bun run verify`, mobile vitest 663/663, `tsc --noEmit` 0 errors.

## Visual evidence (REAL implementation frames)

Captured per `docs/ux/VISUAL_EVIDENCE_POLICY.md` from the real running app —
the mobile host (vite dev :5199, prod-backed session, `flm.chatui.v1=unified`,
account mike@cranesync.com) and the lab shell (`bun dev` :3000, embed=1, fake
adapter). No mockups. Frames live in `docs/promo-screenshots/` (append-only).

| # | File | Surface / build | Viewport | Captured at | State demonstrated |
|---|------|-----------------|----------|-------------|--------------------|
| 1 | `2026-09-13_new-project-drawer-open_mobile.png` | mobile host, vite :5199, prod-backed | 412×915 | `4adf79470` (drawer code identical through HEAD) | Drawer open: **New chat + New project both enabled**, real Projects/Recent data |
| 2 | `2026-09-13_new-project-create-flow_mobile.png` | mobile host, vite :5199 | 412×915 | `baafdb76d` | Tap New project → canonical **UnifiedCreateProject** route: ← Back header, Name/Manufacturer/Model/Type/Serial, Create project disabled until named, hint line |
| 3 | `2026-09-13_new-project-sidebar_desktop.png` | mobile host, vite :5199 | 1440×900 | `4adf79470` | Sidebar rendering with both actions at desktop width |
| 4 | `2026-09-13_new-project-lab-disabled-hint_desktop.png` | lab shell :3000 embed=1 (no host hook) | 1440×900 | `4adf79470` | **Disabled + aria-describedby hint** state for both buttons ("Not available in this workspace yet.") |
| 5 | `2026-09-13_new-project-lab-disabled-hint_mobile.png` | lab shell :3000 embed=1 | 412×915 | `4adf79470` | Same disabled/hint state, mobile drawer |

Interaction verified live on frames 1→2: drawer → New project (drawer closes) →
form renders → **Back returns to the conversation** (re-verified in the same
session). The create submit was deliberately **not** exercised against the
prod-backed session (no synthetic project pollution on a real tenant);
`onCreated → open(nb.id)` is covered by types + the wiring in `UnifiedRoot.tsx`,
and on-device wf-06 PASS remains the recorded follow-up gap.

### Reproduction
1. `cd mira-mobile && npx vite --port 5199` (session cookie re-scoped per the
   established recipe; `CapacitorStorage.flm.chatui.v1=unified`).
2. Playwright at 412×915 / 1440×900 → open drawer → New project.
3. Lab: `cd apps/factorylm-ui-lab && bun dev` →
   `http://localhost:3000/?embed=1&surface=mobile&scenario=grounded-answer`.
