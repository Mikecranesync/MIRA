# PLAN — FactoryLM public SimLab conveyor demo

**Plan file:** `PLAN.public-demo-simlab.md` — root `PLAN.md` is a TRACKED file owned by the
#3760 baseline-defect run; overwriting it would delete that plan on merge, so this run keeps
its own branch-scoped plan at the branch root instead.
**Branch:** `feat/public-demo-simlab-conveyor`
**Worktree:** `.claude/worktrees/public-demo-simlab`
**Base:** `origin/feat/public-demo-surface` @ `6bb961f01` (PR #3812 head — OPEN, not merged)
**Draft PR target:** `feat/public-demo-surface` (stacked on #3812)
**Governing brief:** `docs/plans/2026-09-15-factorylm-public-demo-conveyor-archaeology-brief.md` (PR #3813)
**Approved plan:** https://github.com/Mikecranesync/MIRA/pull/3813#issuecomment-5682056402

## Owner-approved decisions (do not re-litigate)

1. SimLab juice-bottling line is V1 — not the physical garage conveyor.
2. Visual focus: `conveyorzone01`, `conveyorzone02`, `casepacker01`.
3. Flagship scenario: `casepacker_jam_upstream_block`.
4. Physical Micro820/GS10, Ignition, robotics, cameras = later phases.
5. Keep the shared V7 shell. No separate landing app / SCADA app / chatbot / asset model /
   evidence system / ingest contract.
6. MIRA diagnoses through the existing reasoning + citation path. No canned diagnoses,
   no fabricated citations.
7. Simulation ground truth must never enter MIRA evidence or chat context.
8. One implementation branch, one draft PR.
9. Trust-boundary test is the first commit; then the complete vertical slice.
10. No merge, no production change, no deployment.

## Baselines (captured before any edit, on `6bb961f01`)

| Gate | Result |
|---|---|
| `python -m pytest tests/simlab -q` | **123 passed, 3 skipped** in 27.97s |
| `bun run verify` (apps/factorylm-ui-lab) | **228 pass / 0 fail**, 20 files; tsc clean; gzip JS 207,537 B (budget 307,200 B); licence audit passed (110 manifests) |

## Scope (numbered — the contract)

### 1. Pin the trust boundary
Test every scenario in `simlab/scenarios.py`. Prove the payloads the public demo is allowed
to read exclude `expected_root_cause`, `expected_asset`, `expected_evidence_tags`,
`expected_actions`, `expected_citations`, scenario identifiers, scenario titles, and all
other rubric content. Positive-control the test against `/simlab/scenario/{id}/rubric` and
`/simlab/evidence/{id}` so a test that cannot detect a leak fails loudly.
Mutation-verify: introduce one deliberate leak, confirm red, restore.
Public/browser code must never request `/scenario/{id}/rubric`. A scenario ID may be used
only by the control that starts the scenario — never in `HydratePayload`, interaction turns,
chat requests, or evidence.
**Success:** new python test file green; each assertion proven by mutation; committed alone.

### 2. Typed SimLab bridge
Connect the existing API to the shared shell through current package boundaries:
`/simlab/healthz`, `/simlab/snapshot`, `/simlab/alarms`, `/simlab/history`,
`/simlab/assets/{id}/docs`, `/simlab/scenario/{id}/start`, `/simlab/scenario/reset`,
`/simlab/scenario/tick`. Map legitimate state, evidence, sources, freshness and inspector
fields into the existing interaction model and `HydratePayload`.
Reuse contracts; no duplicated ingest contract; no new runtime dependency; configurable base
URL; no committed secrets; clean timers/cancellation/teardown; no overlapping polling; honest
loading / stale / offline / retry / recovery; never render stale data as live; never invent
values, tags, units, alarms, setpoints, ranges or citations.
**Success:** parser/mapper unit tests incl. malformed responses; no timer leaks; tsc clean.

### 3. Public machine visualization
One compact responsive 2D/SVG machine view rendered only under `surface="public"`, showing
Conveyor Zone 01, Conveyor Zone 02, Case Packer 01, moving cases while healthy, visible
upstream accumulation/blocking during the jam, understandable asset states, simulation status
and data freshness, and only the real signals needed to explain the event.
Three-second test: running / blocked / stopped / stale / faulted readable at a glance.
Tokens for every colour, spacing, type, border, radius. No hardcoded hex. Flat and modern —
no gradients, glass, fake 3D or decorative motion. Colour communicates state only; no
blinking. Units + quality/freshness shown; actual/setpoint/range only where legitimately
available. No tag wall. Conversation visually dominates. Desktop and mobile. Keyboard access,
visible focus, repo-compliant touch targets. `prefers-reduced-motion` honoured. Animation
stops or degrades honestly when data is stale or offline.
**Success:** rendering tests; colour-discipline guard green; visually inspected screenshots.

### 4. Visitor flow
Known healthy initial state; Inject jam control; deterministic progression via existing tick
behaviour; SVG + signals + alarms + history updated from SimLab; normal questions through the
existing shell; questions sent only through the existing shared MIRA/Supervisor chat and
approved-evidence path; real answer parts, citations, evidence basis and safe first checks
rendered through existing shell components; existing source-viewer behaviour for SimLab
documents; Reset demo returning SimLab, machine state and the visible demo conversation to
healthy; persistent truthful sample-data notice; existing `onConvert` hook for
"Use FactoryLM with your equipment".
No public-only answer engine. If the real shared chat route cannot execute locally, implement
and contract-test its adapter, show an honest unavailable state, and record the exact external
requirement. Never substitute a canned AI answer.
"Surprise me" optional — jam flow is mandatory.
**Success:** flow tests healthy → jam → alarms/history → reset; chat adapter contract tests.

### 5. Prove and package
TDD throughout. Cover: trust boundary + mutation proof; SimLab parsing and malformed
responses; healthy → jam → alarm/history → reset; stale/offline/recovery; no public access to
the rubric endpoint; no ground truth in evidence or chat payloads; poll/timer cleanup;
public-only rendering without Hub inspector leakage; conversion hooks; accessibility and
reduced motion; desktop/mobile layout; real source selection.
Re-run both baselines; licence audit; UI/style guards; affected offline evals.
Then a real local browser proof at desktop and mobile widths, screenshots captured to
`docs/promo-screenshots/` **and visually inspected**. Stop local services before finishing.
**Success:** every gate at or above baseline; screenshots inspected; HANDOFF.md committed.

## OUT OF SCOPE (touching any of these is a STOP)

- Production, deployment, DNS, OVH, Neon, any VPS or container mutation
- Physical PLC, garage conveyor, GS10, Ignition, robotics, cameras, any hardware claim
- Branches `feat/conveyor-live-pipeline`, `feat/approved-tags-conveyor-seed`,
  `docs/conveyor-demo-mvp-plan-2026-05-13`
- `simlab/dashboard.html` as the public face
- A new simulator or scenario engine
- A second chatbot, backend, evidence system, asset model or ingest contract
- Hub-wide or mobile-wide shell adoption
- Database migrations
- Auth, billing, signup, account architecture
- New runtime dependencies
- Unrelated refactors
- Extra machines or a broader scenario library
- Weakening any test or guard

## Commit sequence

1. `test(simlab): prevent rubric leakage into evidence`
2. `feat(simlab): bridge demo evidence into shared shell`
3. `feat(ui): add public conveyor jam visualization`
4. `test(ui): prove public SimLab demo flow`
5. `docs: record verification and handoff`

## Stop conditions

Any autonomous-run stop condition; any OUT-of-scope path; the same important gate red after
one self-fix round; an architecture/security/dependency decision. On stop: one consolidated
`HANDOFF.md` with completed PLAN rows, remaining work, risks, exact reproduction commands, and
the single decision or external action required.
