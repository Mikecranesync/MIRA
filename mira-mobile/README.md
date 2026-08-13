# mira-mobile — FactoryLM native app (ADR-0034)

Static Vite + React + TS client in a **Capacitor 8** shell, consuming the existing Hub APIs at
`https://app.factorylm.com` over **native HTTP** (`CapacitorHttp` — no CORS, explicit cookie jar
carrying the NextAuth session). No `server.url`, no `allowNavigation`: the packaged bundle is the
entire WebView trust boundary; external content opens in the system browser.

Docs: `docs/adr/0034-native-mobile-static-capacitor-client.md` ·
`docs/prd/2026-08-13-native-mobile-app-prd.md` · UX contract `docs/specs/hub-mobile-spec.md`.

## Walking skeleton (Phase 2)
Login (NextAuth credentials dance, prod-proven) → `/api/me` (fail-closed capabilities) → assets
list → asset detail → equipment-notebook chat (SSE parsed full-body) → sign out (server signout +
local purge) → deep links `factorylm://m/<TAG>` and `https://app.factorylm.com/m/<TAG>` →
`GET /api/assets/by-tag/<TAG>`.

## Phase 4 (current state)
- **Offline WO queue** (`src/lib/offline-queue.ts`, unit-tested): a create that fails on
  transport is persisted tenant-keyed (Preferences) with its retained `client_key`, so the
  later drain through the same `createWorkOrder` is a safe replay (server contract PR #3223;
  older servers ignore the key). Drains on Workorders mount, app-resume, and "Sync now";
  visible "Waiting to sync (N)" state; definitive 4xx rejections are dropped and surfaced.
  Sign-out tries a final drain, warns before destroying unsynced items, then purges every
  queue on the device.
- **QR scan** (`src/screens/ScanView.tsx`): ported from the rescued Hub
  `qr-scanner-view.tsx` (gesture-gated start, teardown on unmount/error, permission states)
  on the `qr-scanner` lib (MIT) via WebView `getUserMedia` — no native plugin. Scan →
  `extractAssetTag` trust filter → the same tag-landing route deep links use. CAMERA
  permission (Android, not-required feature) + `NSCameraUsageDescription` (iOS) declared.
- **Well-known files**: `deployment/well-known/` (assetlinks.json + AASA + deploy/verify
  runbook); nginx locations staged in `deployment/nginx-app-factorylm.conf` (prod deploy is
  the gated server task).
- Still open in Phase 4: camera/photo capture → WO close photos + notebook uploads,
  Keystore/Keychain secure storage (session still in Preferences), offline read cache,
  streamed SSE.

## Build & run (Android, this repo's Windows dev box)
```bash
cd mira-mobile
npm install
npm run build                 # tsc --noEmit + vite build → dist/
npx cap sync android
# local.properties: sdk.dir=C:\Users\<you>\AppData\Local\Android\Sdk
cd android && JAVA_HOME="C:/Program Files/Android/Android Studio/jbr" ./gradlew assembleDebug
# emulator: %LOCALAPPDATA%/Android/Sdk/emulator/emulator.exe -avd Medium_Phone_API_36.1
adb install -r app/build/outputs/apk/debug/app-debug.apk
# deep-link smoke:
adb shell am start -a android.intent.action.VIEW -d "factorylm://m/<TAG>"
```

## iOS
`ios/` is generated and configured (`npx cap add ios`). Building/signing requires macOS + Xcode —
the single external step: open `ios/App` in Xcode, set the signing team, archive. Universal Links
additionally need `apple-app-site-association` served on the prod origin (Phase-4 server task,
paired with Android `assetlinks.json`).

## Hard rules carried from the repo
- Every color comes from `src/tokens.css` (copy of `docs/design/factorylm-tokens.css` — keep in sync).
- Authorization renders from `/api/me.capabilities[]` and fails **closed**; the server is the
  security authority. Never reproduce the web client's `role ?? "owner"` default.
- Session storage: native cookie-jar values persisted via Preferences for the skeleton — Phase 4
  moves this to Keystore/Keychain-backed secure storage before any store submission.
- The Hub canonicalizes to trailing-slash API paths; slashless calls 308.
