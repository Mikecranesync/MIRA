## Why
Factory AI auto-generates a QR code per asset for mobile access — creates WOs, views history, uploads photos from scan.

## Source
https://docs.f7i.ai/docs/prevent/user-guides/asset-registry — "automatically generates a QR code for mobile access"

## Acceptance criteria
- [ ] `GET /api/assets/{id}/qr` returns a PNG (server-generated with the `qrcode` npm pkg)
- [ ] QR encodes `https://{tenant}.factorylm.com/hub/assets/{id}?from=qr`
- [ ] Asset detail page shows the QR with "Print label" and "Download" buttons
- [ ] Landing with `?from=qr` surfaces mobile-first actions: Create WO, Report Issue, Add Photo, View History
- [ ] Bulk QR export: `/api/assets/qr.pdf?assetIds=...` returns a PDF sheet of labels

## Files
- `mira-hub/src/app/api/assets/[id]/qr/route.ts`
- `mira-hub/src/app/(hub)/assets/[id]/page.tsx` (add QR card)
- New dep: `qrcode` (MIT)
