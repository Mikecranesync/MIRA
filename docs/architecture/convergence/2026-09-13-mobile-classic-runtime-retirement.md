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
