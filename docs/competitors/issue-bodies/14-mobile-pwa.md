## Why
Factory AI has a native mobile app with offline WO sync. We ship a **PWA** and skip app-store friction.

## Source
- https://docs.f7i.ai/docs/prevent/user-guides/work-orders (Mobile App section)
- `docs/competitors/factory-ai-leapfrog-plan.md` #7

## Acceptance criteria
- [ ] `manifest.webmanifest` + service worker via Next.js PWA (e.g., `@ducanh2912/next-pwa` or hand-rolled)
- [ ] Install prompt on mobile Chrome/Safari
- [ ] Offline: work orders assigned to current user downloaded + editable, synced on reconnect
- [ ] IndexedDB cache of assigned WOs + local mutation queue
- [ ] Camera capture for "before/after" photos (required for WO close)
- [ ] QR scanner using `@zxing/browser` → opens asset page
- [ ] Responsive layout for all `(hub)` routes tested at 375px width

## Files
- `mira-hub/public/manifest.webmanifest`
- `mira-hub/src/app/sw.ts` or next-pwa config
- `mira-hub/src/lib/offline-queue.ts`
