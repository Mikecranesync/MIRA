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

## Chat: the external requirement

`POST /api/equipment-notebooks/{id}/chat` begins with `sessionOr401` and scopes
retrieval to `(tenant ∧ notebook ∧ not-rejected)`. **An anonymous visitor has no
session, so the real chat path cannot serve an anonymous turn today.** That is an
authorization decision, not a wiring gap.

Until it is made, the demo states the limit:

- no `notebook` configured → "This preview has no notebook configured, so there is
  nothing for MIRA to ground an answer in."
- 401/403 → "This preview is not signed in… Create a workspace to ask about your
  own equipment."
- hub unreachable → "MIRA is unreachable from this preview right now. Nothing was
  answered."

There is no fallback answerer anywhere in the module, and a test asserts that no
failure path produces a text part.

To run the real path locally, start `mira-hub` with a signed-in session and pass
`&hub=…&notebook=<uuid>` for a notebook whose sources are the SimLab documents.

## Gates

```bash
python -m pytest tests/simlab -q                    # 151 passed, 3 skipped
cd apps/factorylm-ui-lab && bun run verify          # 318 pass, tsc clean, budget, licences
python tools/ui_surface_lifecycle_guard.py --base origin/main --head HEAD
```

## Screenshots

`docs/promo-screenshots/2026-09-15_public-demo-simlab-{healthy,jam,asked,reset}_{desktop,mobile}.png`
— captured from this flow against a real SimLab, desktop 1440x900 and mobile
412x915.

## Stopping

Stop the preview server and SimLab. The demo leaves nothing running and writes
nothing outside `dist/`.
