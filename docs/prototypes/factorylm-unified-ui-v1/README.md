# FactoryLM Unified UI V1 — FLM-UI-4000

This directory contains the approved, disconnected V1 design reference for a single FactoryLM interface across public web, signed-in web, mobile, and enterprise Hub.

## Open the preview

Open `index.html` directly in a browser. It is a single-file mocked prototype, includes Web/Mobile/Hub and Ask/Work switches, and makes no network requests.

## Files

- `index.html` — interactive, single-file V1 preview.
- `../../prd/2026-09-06-factorylm-unified-interaction-v1.md` — product requirements index and links to the complete five-part PRD.
- `../../initiatives/FLM-UI-4000.md` — agent entrypoint, implementation order, boundaries, acceptance gates, and first implementation prompt.

## Approved direction

FactoryLM has one UI, not separate product interfaces. The same shell, project tree, conversation surface, composer, machine context, evidence, safety states, files, Diagnostic Runs, and inspector adapt to device width and permission level.

- Public web: same shell in demo/marketing mode.
- Signed-in web: everyday MIRA workspace.
- Mobile: same shell collapsed, with native camera, QR, voice, offline, share, and notifications.
- Hub: same shell with enterprise inspectors and administration.

## Safety boundary

This prototype is design input only. It is not connected to authentication, production APIs, databases, providers, files, work orders, machines, or OT systems. Existing production interfaces remain unchanged until the shared V2 shell is approved, connected incrementally, and proven behind rollback flags.
