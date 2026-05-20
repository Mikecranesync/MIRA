# PLAN — claude/upbeat-banach-4bb1d5 (hub-overhaul)

**Status:** Active (2026-05-20)
**Branch:** `claude/upbeat-banach-4bb1d5` (off `origin/main` after rebase to `09786be3`)
**Worktree:** `.claude/worktrees/upbeat-banach-4bb1d5/`
**Task source:** Mike's hub-overhaul brief, 2026-05-20

> Previous PLAN.md (May-21 demo branch) is overwritten — that scope shipped on
> a different branch. This file is THIS branch's scope contract.

---

## In-scope (this session)

### Phase 1 — File GitHub issues (no code yet)

1. **Create `hub-overhaul` label** on the repo.
2. **File 12 issues** under that label, in priority order P0 → P1 → P2:
   - P0: ADR-0014 product-led decision · remove mira-sidecar from saas.yml ·
     hide mock Hub pages behind Labs flag · reorder Hub sidebar · build
     `/quickstart` page.
   - P1: extend onboarding wizard step 5 · self-serve signup CTA on
     marketing homepage · fix pricing inconsistency · remove /plc GitHub
     Pages iframe.
   - P2: evaluate sunsetting mira-core · split engine.py god-class ·
     evaluate replacing mira-bridge with FlowFuse.

### Phase 2 — Implement P0 items A–E on this branch

A. **ADR-0014** — `docs/adr/0014-product-led-wedge.md` (status: accepted).
B. **Remove `mira-sidecar` service block** from `docker-compose.saas.yml`
   (the block at line 56 + the `SIDECAR_URL=…` env reference at line 175).
C. **Sidebar reorder** — rewrite `NAV_ITEMS` in
   `mira-hub/src/providers/access-control.ts`:
   - Primary: Feed, Namespace, Channels, Knowledge, Proposals
   - Secondary (collapsed): Assets, CMMS (Work Orders), Scan, Settings, Admin
   - Labs-gated: Conversations, Alerts, Requests, Parts, Reports, Team,
     Documents
   - Sidebar reads `NEXT_PUBLIC_LABS_ENABLED` to include Labs items.
D. **Hide mock pages** — wrap the route components (or layout) for
   `/conversations`, `/alerts`, `/requests`, `/parts`, `/reports`, `/team`,
   `/documents` so that when `NEXT_PUBLIC_LABS_ENABLED !== "true"` they
   show a "Coming soon — turn on Labs to preview" stub (do NOT delete).
E. **`/quickstart` public page** — `mira-hub/src/app/quickstart/page.tsx`
   (NOT inside `(hub)`, no auth):
   - Manufacturer dropdown sourced from a new `GET /api/quickstart/manufacturers`
     route that queries distinct manufacturers from `kg_entities` /
     `knowledge_entries`.
   - Symptom / fault-code text input.
   - "Ask MIRA" button → `POST /api/quickstart/ask` → forwards to the
     existing pipeline answer endpoint (re-use mira-pipeline if reachable;
     otherwise stub with a clear "wire me up" comment).
   - Renders the answer with citation chips.
   - "Sign up to save" CTA → `/signup`.
   - Mobile-friendly. Uses existing Hub design tokens.

### Phase 3 — Playwright verification (local `bun run dev`; no VPS deploy)

Playwright spec under `mira-hub/tests/e2e/audit-hub-overhaul.spec.ts`:
- Sidebar order matches the spec (primary vs secondary).
- Mock pages redirect / show "Coming soon" when Labs flag off; render real
  page when Labs flag on.
- `/quickstart` loads without auth.
- `/quickstart` submits a query and renders an answer block.

Screenshots into `docs/promo-screenshots/2026-05-20_hub-overhaul_*.png`.

### Phase 4 — Push branch, open ONE PR

Title: `feat(hub): hub-overhaul P0 (ADR-0014 + saas.yml + sidebar + Labs gate + /quickstart)`.

### Phase 5 — HANDOFF + stop

Write `HANDOFF_2026-05-20.md` row-by-row, then stop. P1/P2 are filed as
issues only — implementation NOT in this session.

---

## Out-of-scope (HANDOFF to operator — Mike). Editing these = STOP.

| Item | Why deferred |
|---|---|
| VPS staging deploy / stg-mira-hub rebuild | SSH to VPS; prod-guard blocks. Mike's brief asked for staging verification; verify LOCALLY, hand off the VPS deploy. |
| P1 items (#6–#9) | Filed as issues only |
| P2 items (#10–#12) | Same |
| Any change to `mira-bots/`, `mira-mcp/`, `engine.py` | Not in this scope |
| Any prod NeonDB or prod docker compose | Always |

---

## Stop conditions

- All 5 phases complete → write HANDOFF, stop.
- Token usage > 70% / turn count > 200 → stop, HANDOFF.
- Edit would touch OUT-of-scope path → STOP.
- Pipeline / `/api/ask` doesn't exist → stub with TODO + a passing
  Playwright assertion on the form path, then continue. Don't spend > 5
  turns wiring the pipeline.
- `bun run build` fails and isn't fixed in 5 turns → STOP, HANDOFF.

---

## Verification gates

| Step | Gate |
|---|---|
| A | `docs/adr/0014-product-led-wedge.md` exists, references 0008 |
| B | `grep -c mira-sidecar docker-compose.saas.yml` returns 0 |
| C | `bun run build` in `mira-hub` passes; sidebar tests pass |
| D | Labs-off render shows "Coming soon"; Labs-on renders real page |
| E | `/quickstart` loads (200) without auth; submit returns an answer block |
| All | Playwright `audit-hub-overhaul.spec.ts` green; screenshots committed |

`tools/hooks/stop-gate.sh` will fire — don't bypass.
