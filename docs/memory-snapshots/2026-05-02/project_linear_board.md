---
name: Linear Board — Cranesync
description: Linear workspace structure, projects, labels, and conventions for MIRA/FactoryLM work
type: project
originSessionId: 36a07d89-95d7-487f-aef0-a08965ff479a
---
Linear workspace: **Cranesync** (linear.app/cranesync). Team key: CRA.

## Projects (3)
| Project | Issues | Target | Purpose |
|---|---|---|---|
| MVP Build | CRA-11 to CRA-17 (Units 2–8) | 2026-05-29 | All agent-executable build units |
| Sales & GTM | CRA-9, CRA-10, CRA-18 | 2026-07-19 | Landing page, case study, outbound push |
| Ops & Infra | CRA-5, CRA-6, CRA-7, CRA-8, CRA-19 | 2026-05-15 | Security hygiene, secrets, eval pipeline |

## Labels
- `user-action` (indigo #5E6AD2) — requires a human decision or manual step
- `agent-action` (teal #26B5CE) — can be executed autonomously by Claude/CI
- `customer-request` (yellow #F2C94C) — feature request from a paying/prospective customer
- `bug` (red #EB5757) — something broken in production (Linear default)

## Issue split convention
Every issue is labeled either `user-action` OR `agent-action`. Never both. This is the primary filter for knowing what to work on next vs what to hand to Mike.

## Pending manual setup (not possible via API)
Add 4 custom statuses in Linear Settings → Cranesync → Issue statuses:
- `Shaping` (between Backlog and Todo) — PM writing requirements before dev touches it
- `Reviewed` (between In Progress and In Review) — dev done, PM reviewed, not yet deploy-cleared
- `Ready to Deploy` — QA done, cleared to merge to main
- `Pending Deployed` — live in prod, customer notification still pending

**Why:** Modeled on ClarityFlow (video: youtu.be/ddFgXoNa9_0) — the Shaping→Ready to Deploy→Pending Deployed pipeline is how small SaaS teams track the full lifecycle including customer close-the-loop.

## How to apply
- Check Cranesync board at the start of any MIRA session to see what's in progress
- All issues must belong to a project (no orphans — ClarityFlow rule)
- When shipping a feature requested by a customer, link the help thread to the issue and mark Pending Deployed until customer is notified
