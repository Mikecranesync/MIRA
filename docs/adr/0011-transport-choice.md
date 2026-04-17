# ADR-0011: Transport Choice for VPS→Bravo Migration

## Status
Abandoned — 2026-04-15

## Context

Issue #294 planned to retire the DigitalOcean VPS and serve traffic from Bravo Mac Mini
via a public tunnel. A 24h spike was designed to measure Tailscale Funnel vs Cloudflare
Tunnel against five pass/fail gates. The hello-world spike server was built and all six
unit tests pass, but the 24h measurement window was never started.

The VPS was restored before the spike ran. Migration is deferred indefinitely.

## Decision

No transport selected. Spike not run.

## Consequences

- Issue #294 closed. Spike server retained in `archives/spike-transport-294/` as a
  reference HTTPS server implementation.
- If migration resumes: re-run from Task 3 of the original plan
  (`docs/superpowers/plans/2026-04-15-transport-spike.md`).
- Sub-projects 2 and 3 from #294 are on hold.
