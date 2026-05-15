# PLAN — feat/demo-may21-finish (continuation of HANDOFF_2026-05-15.md)

**Status:** Active (2026-05-15 evening)
**Branch:** `feat/demo-may21-finish` (off `origin/main` HEAD `1c0c2413`)
**Worktree:** `.claude/worktrees/demo-may21-finish/`
**Master plan file:** `/Users/charlienode/.claude/plans/handoff-written-mira-handoff-2026-05-15-swirling-crayon.md`
**Source handoff:** `~/MIRA/HANDOFF_2026-05-15.md`

> The PLAN.md from `main` (UNS Message Resolver, 2026-05-13) is preserved on
> `main` and recoverable via `git show origin/main:PLAN.md`. This file is
> THIS branch's scope contract, per the autonomous-run skill.

---

## In-scope (this session)

1. **PR #1297** (psycopg v3 `add_notice_handler` for seed runner). Confirmed
   NOT superseded by #1311/#1312. Merge if lint/unit/security all green and
   the E2E smoke failure is pre-existing on `main`; otherwise comment.

2. **PR #1314** (`fix/uns-pair-coverage-multi-vendor`). MERGEABLE but
   `Lint & Format` step failing. Fix locally with ruff, push, merge.

3. **PR #1313** (`claude/romantic-wescoff-290da1`, OEM-manual seed for the
   garage RS-485 commissioning gap — closes part of #1308). CONFLICTING.
   Rebase, resolve, push `--force-with-lease`, merge.

4. **PR #1315** (`claude/crazy-ardinghelli-acc976`, adapter-agnostic
   conversation testing harness, 36 cases). CONFLICTING. Rebase, resolve,
   push, merge.

5. **(REVISED — Phase 7 dropped, see below.)** The demo backend plan
   (`docs/plans/2026-05-14-demo-backend-plan.md` line 94) **explicitly
   defers** real-time MQTT subscription for the May 21 demo: *"What this
   plan deliberately does NOT do: Real-time MQTT subscription (deferred —
   mock feed for demo)."* The 2026-05-15 addendum confirms Plan P5 (mock
   signal feed via `live_signal_cache` + `signal-recorder.ts`) and Plan P7
   (engine + intent wire-up via existing context-injection path) are
   already DONE in #1295 + #1298. Building an MQTT pipeline now would
   contradict the spec — STOP condition fired and re-planned. The handoff's
   "Phase 7" appears to have been an aspirational item not aligned with the
   plan's deliberate deferral.

6. **Demo P8 — tablet demo page.** Per
   `docs/plans/2026-05-14-demo-backend-plan.md` row P8: single page, 3
   panels — live signals (polling `GET /api/demo/signals/summary`),
   KG/component card (`GET /api/demo/customer` + `GET /api/components/[id]`),
   Slack-like chat embedded (`POST /api/mira/ask`). Path:
   `mira-hub/src/app/demo/conveyor/[tag]/page.tsx` (plan's `mira-web/`
   reference is a typo — all 11 endpoints live in `mira-hub`). Reuses Hub
   design tokens (shadcn/ui already present). Playwright snapshots at
   iPad sizes (1024×768 landscape + 820×1180 portrait, per plan's
   verification gate) committed to `docs/promo-screenshots/`.

7. **Open the session PR + write `HANDOFF_2026-05-15-evening.md`** —
   row-by-row done/skipped, deferred-to-operator list, exact resume command.

---

## Out-of-scope (DEFERRED to operator — Mike). Editing these = STOP.

| Item | Why deferred |
|---|---|
| VPS deploy of #1306 mira-hub middleware | SSH to VPS; `prod-guard.sh` blocks |
| VPS bring-up of `mira-mcp` (#1304) | Same |
| Verify migrations 014–018 on prod NeonDB (#1305) | VPS-side smoke required |
| VPS bot restart for GS10/Micro820 KB (#1308) | Same |
| Stripe test → live keys in Doppler `factorylm/prd` | Live billing; explicit Mike approval needed |
| Slack Messages Tab enable | Manual Slack admin UI click |
| Physical conveyor + Micro820 boot procedure on-site | Hardware, on-site |
| #1284 (Bravo Mac Docker daemon) | Different node |
| Triage of older P0s (#1284, #1201, #1200, #1158, etc.) | Not coding work |
| Closing the 25+ older conflicting PRs | Mike's explicit instruction: don't |

---

## Stop conditions (per `.claude/skills/autonomous-run/SKILL.md`)

- All 7 in-scope items complete → write evening HANDOFF, stop
- Token usage > 70%, or turn count > 200 → stop, HANDOFF
- Edit would touch an OUT-of-scope path → STOP
- Phase 7 reference plan reveals fundamentally different architecture → re-plan
- 5 consecutive turns failing the same test → stop
- Pre-merge reviewer-style issue surfaces → stop, fix, re-run gates

---

## Verification gates

| Step | Gate |
|---|---|
| 1–4 | `gh pr checks <num>` green; merge via `gh pr merge --squash` |
| 5 | Mosquitto + simulator + poller running locally; `wscat` against `/api/demo/ws` shows ticking values |
| 6 | `bun run test:e2e -- demo-conveyor-001` passes; both screenshots committed |
| 7 | `gh pr checks` green on session PR; HANDOFF committed |

`tools/hooks/stop-gate.sh` runs on Stop — don't bypass with `MIRA_SKIP_STOP_GATE=1`.

---

## Path corrections vs handoff

- `mira-hub/app/api/...` → **`mira-hub/src/app/api/...`**
- `mira-hub/migrations/` → **`mira-hub/db/migrations/`**
- `seeds/2026-05-1?_*.sql` → **`tools/seeds/{gs10-vfd-knowledge,gs11-field-guide-knowledge,demo-conveyor-001}.sql`**
- `docs/plans/2026-05-15-may-21-demo-8-phase-plan.md` → **`docs/plans/2026-05-14-demo-backend-plan.md`**
- `docs/runbooks/may-21-demo-physical-conveyor.md` → does NOT exist on `origin/main`

The 11 demo endpoints (all created in #1295 commit `94b6ca33`):
`demo/customer`, `demo/signals/{events,set,summary,toggle}`, `mira/ask`,
`assets/[id]/{context,signals}`, `components/[id]`,
`sessions/{confirm,[id]}`, `documents/{,upload}`.
