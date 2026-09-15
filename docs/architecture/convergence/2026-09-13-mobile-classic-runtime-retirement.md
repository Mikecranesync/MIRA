# Mobile classic runtime retirement map (2026-09-13)

Scope: `mira-mobile` runtime only. This records the controlled cutover that made the
unified FactoryLM shell the ONLY authenticated mobile experience, per the owner goal of
2026-09-13 ("No more Classic/V7 switching") and charter mission
FACTORYLM-UNIFIED-UI-CUTOVER-001.

This is a RUNTIME retirement, not a Gate 8 deletion. Every classic source file remains
frozen on disk under the Legacy UI Lifecycle Guard exactly as the charter requires; the
charter's Gate 8 (owner-approved deletion PR with zero-dependency proof) has NOT been
performed and is out of scope here. Rollback is by versioned release (git tag plus the
prior APK), never an in-app switch.

## What the runtime retired

| Surface | File (frozen, still on disk) | Runtime status after cutover |
|---|---|---|
| Five-tab shell + tab bar | `src/App.tsx` (classic branch) | Removed; App mounts `UnifiedRoot` unconditionally |
| Work orders tab | `src/screens/Workorders.tsx` | Unreachable; tree-shaken out of the bundle |
| Schedule tab | `src/screens/Schedule.tsx` | Unreachable; tree-shaken out of the bundle |
| Notebooks tab (classic chat host) | `src/screens/NotebooksTab.tsx` | Unreachable; tree-shaken out of the bundle |
| Assets tab + tag landing | `src/screens/AssetsTab.tsx` | Unreachable; deep links resolve inside the unified shell instead |
| More tab (incl. the Chat style selector) | `src/screens/More.tsx` | Unreachable; the classic/unified selector no longer exists anywhere |
| Classic chat surface | `src/screens/ChatV2.tsx` | Still imported by `UnifiedChat.tsx` as a type/util dependency only; no classic render path |
| Chat-ui preference | `src/lib/chat-ui-pref.ts` | No boot-path readers remain. `flm.chatui.v1` is inert regardless of stored value ("legacy", "v2", or "unified") and is purged on sign-out (`PURGE_PREFIXES`). Returning users enter the unified shell unconditionally |

Bundle evidence (vite production build at the cutover commit): grep of
`dist/assets/index-*.js` finds 0 occurrences of "Use classic app", "New work order",
"Chat style", "tabbar", "Schedule"; unified markers ("unified-root", "New project",
"About and updates") present.

## Capabilities ported or preserved (nothing user-essential lost)

- Sign out (with the full work-order-queue drain race protections): unified footer.
  The race law tests were re-pointed at the queue seam and the unified footer
  (`src/__tests__/sign-out-work-order-race.test.tsx`), all passing.
- About and updates (OTA status, version): `src/unified/UnifiedAboutUpdates.tsx`.
- Project creation: `src/unified/UnifiedCreateProject.tsx` (PR 3767), now also offered
  from the empty-workspace state.
- Deep links (QR sticker `factorylm://m/TAG` and app links `https://.../m/TAG`):
  resolve via the same pure `resolveScan` decision (`src/lib/scan-landing.ts`) the
  scanner uses; tag opens that machine's notebook in the unified shell. Failures show
  a dismissible notice, never a dead screen and never a classic route.
- Machine scan, attachments, citations, sensors, evidence: already owned by
  `NotebookScreen` under the unified shell (unchanged).
- Backend capabilities (work-order APIs, assets, notebooks, auth): untouched. Only
  presentation was retired; `api/resources.ts` consumers remain.

Known non-ported presentation (deliberate, tracked): the classic Work orders and
Schedule LIST screens have no unified equivalent yet. Their backend capabilities and
offline queue remain intact and sign-out still drains the queue; a unified work-order
surface is future scope under the charter, not a blocker for conversation-first use.

## Resurrection safety

- Cold launch, relaunch: `App.tsx` has no classic branch to select; no preference read.
- Deep links: routed into the unified shell only (`UnifiedDeepLink`).
- Stored preferences: `flm.chatui.v1` has zero readers in the boot path (tested:
  `src/__tests__/app-unified-only.test.tsx` renders unified with stored "legacy"/"v2").
- OTA/updates: a LiveUpdate rollback returns to a prior versioned bundle (operational
  rollback path, allowed); no bundle contains an in-app classic switch after this cut.
- Device side-installs: the `com.factorylm.mira.v6` / `.v7` dogfood packages (superseded
  PRs 3750/3751 lane) are slated for removal from the test device; the canonical package
  `com.factorylm.mira` carries the single experience.

## Rollback

- Git tag `archive/mobile-classic-runtime-preretirement` marks the last main commit
  whose runtime could still mount the classic shell.
- Operational rollback: install the prior versioned APK (versionCode 10, versionName
  1.1.0) or OTA-roll back to the prior bundle. The frozen classic sources on disk make a
  code-level revert a single-commit operation if ever owner-directed.

## Recorded bundle-grep output (review-requested evidence)

Run at the cutover branch head on the release-lab machine (BRAVO), production build
via bun run build (tsc plus vite):

    Use classic app: 0
    New work order: 0
    Chat style: 0
    tabbar: 0
    Schedule: 0
    unified-root: 1
    New project: 2
    About & updates: 1

Counts are occurrences in dist/assets/index-*.js. Zero classic markers; unified
markers present. Reproduce with: grep -c "MARKER" dist/assets/index-*.js

## Capability disposition (goal §3 — preserve/port before retiring presentation)

The owner goal requires porting *essential* legacy-only capability before retiring a
surface, and preserving backend capabilities. The classic Workorders / Schedule / Assets
tabs were CMMS **management** surfaces, so their retirement needs an explicit disposition —
not just "the tab is gone."

| Capability (classic tab) | V7 runtime status | Where it lives in V7 |
|---|---|---|
| Work-order **list / status+priority mutation / standalone create** (`Workorders.tsx`) | **Retired from runtime** | No dedicated management affordance in the unified shell |
| PM-schedule **list / complete / create** (`Schedule.tsx`) | **Retired from runtime** | No affordance in the unified shell |
| Asset-registry **browse** (`AssetsTab.tsx`) | **Retired from runtime** | No management affordance |
| Work-order **list (read)** | **Reachable** | `AttachFileSheet` → `listWorkOrders()` (attach a file to a work order) — mounted from `NotebookScreen` |
| Asset **list (read)** | **Reachable** | `AttachFileSheet` → `listAssets()` (attach picker) — mounted from `NotebookScreen` |
| Work-order / asset **query** (history, "is WO on line 3 done?") | **Reachable** | Chat → engine CMMS tools (`check_equipment_history`; covered by the `cmms-context-followup` staging-gate eval) |
| Asset **scan → notebook** | **Reachable** | `resolveScan` → `getAssetByTag` / `openAssetNotebook` |
| API adapter — `listWorkOrders` / `getWorkOrder` / `createWorkOrder` / `updateWorkOrder` / `listPmSchedules` / `completePmSchedule` / `listAssets` | **Preserved** | `src/api/resources.ts` (frozen; the offline-queue drain in `App.tsx` still runs — the only *producer*, classic `Workorders.tsx`, is retired, so no new creates are enqueued) |

**What survives:** all CMMS *reads* a technician needs from the conversational shell — asset
and work-order lists (as attach targets), work-order history via chat, asset scan→notebook —
plus the full API adapter (nothing deleted).

**What is retired from the mobile runtime:** the dedicated CMMS **management** UI — changing a
work order's status/priority, creating a work order from a standalone form, and listing /
completing / creating PM schedules from the phone.

**Open decision for the owner (product scope, not a code gap):** this aligns with the
train-before-deploy doctrine (the Hub Command Center + Atlas CMMS web own management; mobile is
the technician's conversational/troubleshooting surface). If that is the intended V7 scope,
this table *is* the record and the retirement is complete. If mobile work-order status changes
or PM completion are considered essential on the phone, they are a capability to **re-home into
the V7 shell** (e.g. a work-order action from a chat/asset context) — the API adapter is already
present, so this is a presentation task, not a backend rebuild. Flagged to the owner rather than
decided here.
