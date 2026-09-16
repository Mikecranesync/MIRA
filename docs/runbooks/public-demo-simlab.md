# Public demo — SimLab conveyor jam (local)

The FactoryLM public demo running against the deterministic SimLab juice-bottling
line: a healthy line, an injectable case-packer jam, live telemetry and alarms,
and the same conversation shell the product ships. Local only — nothing here is
deployed.

**Governing brief:** `docs/plans/2026-09-15-factorylm-public-demo-conveyor-archaeology-brief.md`
**Scope contract:** `PLAN.public-demo-simlab.md`

## Start it

```bash
# 1. the machine — CORS is opt-in and names the demo's origin explicitly
SIMLAB_CORS_ORIGINS="http://localhost:4173" python -m simlab --host 127.0.0.1 --port 8099

# 2. the demo host
cd apps/factorylm-ui-lab
bun install --frozen-lockfile
bun run build          # emits dist/index.html (lab) and dist/demo.html (demo)
PORT=4173 bun scripts/preview.ts
```

Open:

```
http://localhost:4173/demo.html?surface=public&demo=simlab
```

Add `&embed=1` to drop the lab's own dev chrome and see only the product surface.

### Configuration (query string only — nothing committed, no `.env`)

| Param | Default | What it is |
|---|---|---|
| `simlab` | `http://127.0.0.1:8099` | the running SimLab |
| `hub` | `http://127.0.0.1:3000` | where the shared chat route lives |
| `notebook` | *(unset)* | the Equipment Notebook whose approved sources ground the answers |

If another SimLab already holds 8099, start yours on 8098 — `demo.html`'s CSP
names both local ports.

## The visitor flow

1. The line opens healthy. The demo resets SimLab once on load, because SimLab is
   a stateful process and would otherwise open on whatever scenario was last
   loaded (`resetOnStart`, default on — turn it off when pointing at a SimLab
   someone else is driving, since the reset is global to that instance).
2. **Inject case-packer jam** loads `casepacker_jam_upstream_block` and advances
   past its onset. Case Packer 01 goes `FAULTED` with `CP001` and `CP-JAM`;
   Conveyor Zone 02 goes `BLOCKED` with `C2-BLOCKED`.
3. The belts keep turning while the cases stop. That is not a rendering
   compromise — the snapshot genuinely reports `blocked = true` and
   `speed_fpm ≈ 60` on zone 02, which is what an accumulation conveyor does.
4. Ask a question. It goes to `POST /api/equipment-notebooks/{id}/chat` — the one
   shared chat route — or it does not go. See below.
5. **Reset to healthy** returns SimLab, the machine view, and the visible
   conversation to the baseline.

After the reply lands the host scrolls the page to its foot. The shell sets
`min-block-size: 100dvh` — a minimum — so with the machine panel rendered the
PAGE scrolls and `.fl-conversation`'s own `overflow-y` never engages; without
that scroll the conversion buttons measured y≈1003 in a 915px mobile viewport,
i.e. below the fold on the one turn that asks the visitor to act.

## What the demo may read, and what it may not

SimLab is both the machine and the grader. The demo reads only:

```
/simlab/healthz  /simlab/snapshot  /simlab/alarms  /simlab/history
/simlab/assets/{id}/tags  /simlab/assets/{id}/docs  /simlab/docs/{id}/{file}
/simlab/lines/{id}/assets
/simlab/scenario/{id}/start  /simlab/scenario/reset  /simlab/scenario/tick
```

`/simlab/scenario/{id}/rubric` and `/simlab/evidence/{id}` carry ground truth and
are unreachable from the client by construction — `SimLabClient` cannot express a
request outside the frozen allowlist.

`tests/simlab/test_public_demo_trust_boundary.py` proves, for **every** scenario,
that no payload the demo may read contains the expected root cause, the expected
actions, the scenario id, or the scenario title — and positive-controls itself
against the rubric endpoint so a detector that stopped working fails loudly.

The scenario id travels **out** on the control the visitor presses and never comes
back in: it names the fault in plain English.

## Two tags are deliberately not rendered

`status.run_state` is `"Idle"` on every asset in every scenario (the engine assigns
`packml_default` at reset and never transitions it) and
`process.accumulation_percent` is `0.0` everywhere (nothing writes it). Showing
"Idle" beside a belt the same payload says is turning at 60 fpm would read as a
contradiction. `test_undriven_tags_stay_undriven` pins this and is the omission's
expiry date: if SimLab ever drives one, that test goes red and the tag should be
rendered rather than kept hidden.

## Chat: asking is what signing up unlocks

`POST /api/equipment-notebooks/{id}/chat` begins with `sessionOr401` and scopes
retrieval to `(tenant ∧ notebook ∧ not-rejected)`. **An anonymous visitor has no
session, so the real chat path cannot serve an anonymous turn.**

**Owner decision, 2026-09-15: that stays true. There is no anonymous chat.** The
visitor sees the line, injects the jam, watches Case Packer 01 fault — and asking
is what a workspace unlocks. A demo tenant or a public rate-limited route is
reconsidered only once the demo is live on the marketing site and visitors are
measurably reaching the ask.

So a declined turn is an **invitation, not an error**. `chatGate()` splits the
five failure reasons into two:

| Gate | Reasons | What the visitor sees |
|---|---|---|
| `account` | `unauthenticated`, `not_configured` | a `conversion_prompt` part: what MIRA would have needed, then **Create workspace** / **Sign in**. Lifecycle `completed`. |
| `fault` | `unreachable`, `http_error`, `malformed_stream` | an `error` part, lifecycle `failed`, retry if the host offers it. **Never** a sign-up prompt. |

That split is the honesty rule, and it runs both ways: a visitor without an
account must not be told the product is broken, and a broken hub must not be
dressed up as a sales opportunity — that would mislead them *and* hide the bug
from us. `FAILURE_GATE` is a total `Record<ChatFailureReason, ChatGate>`, so a new
reason is a compile error rather than a silent slide into the friendlier branch.

There is still no fallback answerer anywhere in the module, and a test asserts
that no failure path produces a text part.

To run the real answering path locally, start `mira-hub` with a signed-in session
and pass `&hub=…&notebook=<uuid>` for a notebook whose sources are the SimLab
documents.

## Gates

```bash
python -m pytest tests/simlab -q                    # 151 passed, 3 skipped
cd apps/factorylm-ui-lab && bun run verify          # 344 pass, tsc clean, budget, licences
python tools/ui_surface_lifecycle_guard.py --base origin/main --head HEAD
```

## Screenshots

`docs/promo-screenshots/2026-09-15_public-demo-simlab-{healthy,jam,asked,reset}_{desktop,mobile}.png`
— captured from this flow against a real SimLab, desktop 1440x900 and mobile
412x915.

## Stopping

Stop the preview server and SimLab. The demo leaves nothing running and writes
nothing outside `dist/`.
