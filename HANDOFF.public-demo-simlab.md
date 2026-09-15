# HANDOFF — FactoryLM public SimLab conveyor demo

**Handoff file:** `HANDOFF.public-demo-simlab.md` — root `HANDOFF.md`, like root
`PLAN.md`, is a TRACKED file owned by the #3760 baseline-defect run. Overwriting
either would have deleted that run's handoff on merge, so this run keeps its own
branch-scoped pair at the branch root.
**Branch:** `feat/public-demo-simlab-conveyor`
**Worktree:** `.claude/worktrees/public-demo-simlab`
**Base:** `origin/feat/public-demo-surface` @ `6bb961f01` (PR #3812 — **open, not merged**)
**Draft PR target:** `feat/public-demo-surface` — this work is **stacked on #3812**
**Scope contract:** `PLAN.public-demo-simlab.md`
**Runbook:** `docs/runbooks/public-demo-simlab.md`

Nothing was merged, deployed, or pointed at production. No DNS, OVH, Neon, VPS,
container, migration, or physical hardware was touched. No new dependency was
added — the licence audit reports the same 110 manifests as the baseline.

---

## PLAN row by row

| # | Scope | Status | Evidence |
|---|---|---|---|
| 1 | Pin the trust boundary | **DONE** | `tests/simlab/test_public_demo_trust_boundary.py` — 28 tests, every scenario; 6 mutations caught |
| 2 | Typed SimLab bridge | **DONE** | `packages/factorylm-interaction/src/simlab.ts` + 28 tests; 7 mutations caught |
| 3 | Public machine visualization | **DONE** | `packages/factorylm-ui/src/MachineView.tsx` + 23 tests; 8 mutations caught |
| 4 | Visitor flow | **DONE, with one external requirement** | `useSimLabDemo.ts`, `notebook-chat.ts`, `apps/factorylm-ui-lab/src/PublicDemo.tsx`; 10 mutations caught. The real chat route cannot serve an anonymous turn — see **Decision needed**. |
| 5 | Prove and package | **DONE** | Gates below; 8 screenshots captured against a real SimLab and visually inspected |

## Gates

| Gate | Baseline (`6bb961f01`) | Now |
|---|---|---|
| `python -m pytest tests/simlab -q` | 123 passed, 3 skipped | **151 passed, 3 skipped** |
| `bun run verify` (tests) | 228 pass / 0 fail | **318 pass / 0 fail** |
| `tsc --noEmit` | clean | clean |
| build budget | 207,537 B gzip (budget 307,200) | **214,657 B** |
| licence audit | 110 manifests, MIT/Apache-2.0 | **110 manifests — unchanged** |
| `ui_surface_lifecycle_guard.py` | — | **No guarded legacy or control-plane paths touched** (no exception label required) |

Browser proof: desktop 1440x900 and mobile 412x915, **0 console errors** on both,
against SimLab running for real. Screenshots inspected, not just captured — two
layout defects were found by looking at them (below).

## What a reviewer should look at first

1. **`tests/simlab/test_public_demo_trust_boundary.py`** — the claim the whole demo
   rests on. Note the positive control: the rubric endpoint is asserted to contain
   ground truth, so a leak detector that silently stopped working fails loudly
   instead of passing vacuously.
2. **`packages/factorylm-interaction/src/simlab.ts`** — the frozen endpoint
   allowlist. `/rubric` and `/evidence` are unreachable by construction.
3. **`packages/factorylm-interaction/src/notebook-chat.ts`** — there is no fallback
   answerer, and a test asserts no failure path produces a text part.

## Findings worth keeping

**Two SimLab facts that shaped the UI.** `status.run_state` is `"Idle"` for every
asset in every scenario and `process.accumulation_percent` is `0.0` everywhere —
the engine never drives either. Rendering them would contradict the numbers beside
them. `test_undriven_tags_stay_undriven` pins the fact and expires the omission: if
SimLab ever drives one, it goes red and the tag should be rendered.

**`assemble_evidence` names the faulted asset.** It returns
`asset_id = scenario.asset_id`, and every scenario sets
`expected_asset = asset_id`. Legitimate for the grading harness; disqualifying for
the public demo. That is why `/simlab/evidence/{id}` is not a public endpoint, and
a test pins the reason so it cannot be lost.

**Defects the work found in its own code, all caught by tests or the browser:**

1. The polling loop aborted its own requests — the default `now` closure was a new
   identity each render and an effect dependency.
2. Every successful poll took the failure path — the cycle returned
   `State | {error}` and `SimLabDemoState` declares an `error` field, so the
   discriminant was true for good readings too. Now a tagged union.
3. A StrictMode remount resurrected a stale cycle: liveness was a shared `useRef`,
   so a torn-down cycle saw the remounted `true` and started a second loop holding
   an aborted controller. Browser-only; no unit test had remounted fast enough.
   Regression test added.
4. `CP001` was read and never rendered — found only by looking at the screenshot.
5. The shell's main grid gave its flexible row to the demo notice, leaving a blank
   band above the machine — found only by looking at the screenshot.

**Four mutations were GREEN on first run and each exposed a weak test, not a sound
one** — an unmount test that never reached the mid-cycle case, a control-window
test whose reads outlasted the window, a concurrency metric counting requests when
one cycle legitimately issues two, and a fake that ignored `AbortSignal`. All four
tests were strengthened until the mutation went red.

## Decision needed (one)

**How may an anonymous visitor's question reach the shared chat route?**

`POST /api/equipment-notebooks/{id}/chat` begins with `sessionOr401` and scopes
retrieval to `(tenant ∧ notebook ∧ not-rejected)`. An anonymous visitor has no
session and no tenant, so the real path cannot serve them today. This is an
authorization decision, not a wiring gap, and it is above an autonomous run's
authority — so the adapter is implemented and contract-tested, the preview states
the limit in plain language, and nothing canned fills the space.

Plausible shapes, for the owner to choose between:

- a demo tenant + a service session scoped to one read-only notebook;
- a public, rate-limited route that reuses the same retrieval and citation
  gate behind a demo-tenant identity;
- keep it signed-in-only, and let the public demo convert
  ("Create workspace") at the moment the visitor asks.

Until that lands, the demo's honest unavailable state IS the behaviour; the
browser proof shows exactly what a visitor sees.

## Follow-ups (not blockers, not started)

1. **Shell drawer mismatch, wider than this demo.** `navigationIsLayer` keys on
   `profile.kind === "mobile"` while `shell.css` turns the sidebar into a fixed
   overlay below 48rem for *every* surface. A narrow `public`/`web`/`hub` surface
   therefore gets a drawer with no scrim and no Escape-to-close, open by default.
   `PublicDemo` closes it at mount on narrow viewports — a host-level workaround.
   The shell-level fix belongs to the shell owner.
2. **The built bundle ships React's development build.** `bun run build` produces a
   bundle that logs "Download the React DevTools…" and double-invokes effects under
   StrictMode, i.e. `process.env.NODE_ENV` is not pinned to `production`. It made
   finding defect 3 easier, and it is wrong for anything shipped. Out of scope here.
3. **Mounting the demo on the real marketing surface.** It runs in the lab host
   because that is the only host consuming the shared shell today (#3806). The
   `mira-web` / `mira-hub` mount is a later PR, after #3812 and #3808 land.
4. **`simlab/dashboard.html` is untouched** and remains the engineer-facing
   self-scoring oracle — deliberately not the public face.

## Reproduce

```bash
git worktree add .claude/worktrees/public-demo-simlab feat/public-demo-simlab-conveyor
cd .claude/worktrees/public-demo-simlab
python -m pytest tests/simlab -q
bun install --frozen-lockfile && (cd apps/factorylm-ui-lab && bun run verify)

# browser proof — see docs/runbooks/public-demo-simlab.md
SIMLAB_CORS_ORIGINS="http://localhost:4173" python -m simlab --host 127.0.0.1 --port 8099
(cd apps/factorylm-ui-lab && bun run build && PORT=4173 bun scripts/preview.ts)
# http://localhost:4173/demo.html?surface=public&demo=simlab&embed=1
```

## Local services

Both were stopped before this handoff was written. A SimLab belonging to another
session was found already listening on 8099; it was left alone and this run used
8098.
