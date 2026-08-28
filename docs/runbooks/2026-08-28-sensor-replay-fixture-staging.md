# Sensor v0 — REPLAY fixture on staging (S4-fixture lane)

**Purpose.** Give the S5 Sensor acceptance a **real** fault window it can reach through the
Hub API, as a tenant it can log in as, without touching prod and without writing SQL.
Contract: `docs/prd/2026-08-28-sensor-v0-contract.md` §2.5 / §4.3 (Machine Memory owns
replay; no new event backend; ingest stays one-pipeline). Discovery: §7 fixture plan.

**Result (2026-08-28).** The CV-101 e-stop fixture
(`mira-crawler/tests/fixtures/machine_memory/cv101_estop.json`) is live on the always-on
staging stack under a throwaway tenant: `GET /api/assets/<id>/machine-memory/` returns
`latest_window.state = "estopped"` with an `anomaly_A3_ESTOP_WIRING` diff, a next-check, and
nine live tags carrying their own `last_seen_at` / freshness. Credentials live only in the
operator's scratchpad (`sensor-acceptance/stg-creds.json`), never in the repo.

## What the staging stack does and does not have (verified, not assumed)

| Piece | Staging (`docker-compose.staging-vps.yml`, compose project `mira-staging`) |
|---|---|
| Hub | `http://165.245.138.91:4101` (login page; NextAuth **credentials** login works; `stg.factorylm.com` does not resolve yet — Gap-5 in `docs/environments.md`) |
| Neon | staging branch `ep-polished-hall-…` — has `tag_events`, `approved_tags`, `live_signal_cache`, `machine_state_window`, `run_diff`, `equipment_notebook_turns.basis` (mig 084) |
| `mira-relay` (`POST /api/v1/tags/ingest`) | **not deployed** (compose header: "NO … relay") |
| `mira-historian-worker/beat` (the only `machine_state_window` writer) | **not deployed** |
| `mira-ingest` (needed by `/api/connectors/plc/import`, the only Hub door that can create `approved_tags`) | `INGEST_URL=disabled://staging` |
| `RELAY_API_KEY`, `MIRA_RUN_DIFF_ENABLED`, `MIRA_MACHINE_MEMORY_UNS_PATHS` in `factorylm/stg` | not set — and **nothing was added**: the flags below are set only in-process for one run |

Consequence: the HTTP ingest door does not exist on staging, so the fixture is pushed through
the **same function that route calls** — `mira-relay/tag_ingest.ingest_batch` +
`NeonTagStore` — and windows are derived by calling the historian's own Celery task
`tasks.historize_runs.historize_runs` in-process. No second copy of either; no SQL.

## Procedure (all repeatable; each step names the existing door it uses)

1. **Register + log in** (throwaway tenant): `POST /api/auth/register/` then NextAuth
   `GET /api/auth/csrf/` → `POST /api/auth/callback/credentials/`. Note the trailing slashes —
   the Hub 308s without them and `urllib` will not follow a 308 POST.
2. **Namespace** via the onboarding wizard: `POST /api/wizard/{company,site,line,tag-import,finish}/`
   with site **"Home Garage"** and line **"Conveyor Lab"** → kg `site`/`line` rows at
   `enterprise.home_garage` / `enterprise.home_garage.conveyor_lab`.
3. **Asset** `POST /api/assets/` with `tag: "CONVEYOR_1"` (slug → `conveyor_1`). The create-time
   kg bridge (#3382) picks the tenant's deepest line as parent, so the machine lands at
   **`enterprise.home_garage.conveyor_lab.conveyor_1`** — the exact `uns_path` the sanctioned
   allowlist seed pins. Then `POST /api/assets/<id>/notebook/` (#3373) for THE notebook.
   Requires a hub built from ≥ `2510d5547`; the stack was on `a1f2a3d6a` (2026-08-23) and had
   to be redeployed: `gh workflow run deploy-staging.yml --ref main -f services="mira-hub"`.
4. **Allowlist** (fail-closed precondition of `ingest_batch`): the repo's tenant-parameterised
   workflow, staging target, dry-run then apply —
   `gh workflow run apply-approved-tags.yml --ref main -f target=staging -f seed=approved_tags_conveyor -f tenant_id=<uuid> -f mode=apply`
   (64 rows, `source_system='ignition'`, all pointing at `…conveyor_1`).
5. **Ingest** the re-keyed fixture, paced like real relay traffic (one push per event, the
   fixture's own gaps, `event_timestamp ≈ ingested_at`):
   `doppler run --project factorylm --config stg -- python tools/qa/sensor_replay_fixture.py ingest --tenant <uuid> --stream --live-clocks`
   A one-shot batch is also valid but gives every row the same `ingested_at`; the historian
   clocks windows on receipt time, so the fault collapses into a zero-length window.
6. **Historize** (what `mira-historian-beat` would do every 30 s if it ran on staging):
   `doppler run --project factorylm --config stg -- python tools/qa/sensor_replay_fixture.py historize --tenant <uuid> --uns-path enterprise.home_garage.conveyor_lab.conveyor_1`
7. **Prove through the Hub**: `GET /api/assets/<id>/machine-memory/` (exists) and, once the
   S4 hub-history lane lands, `GET /api/assets/<id>/history/?pre=5&post=2` (404 today).

`tools/qa/sensor_replay_fixture.py rekey --tenant <uuid>` prints the canonical batch for
inspection; `tests/test_sensor_replay_fixture.py` pins the re-key contract.

## Honesty notes the acceptance must keep

- Rows carry **both clocks**. On the paced stream they differ by 1–8 s (real delivery
  latency); the earlier one-shot batch left 12 rows whose `event_timestamp` is ~21 min before
  `ingested_at` — a distinct replay signature (contract D2) that must be rendered, not hidden.
- Freshness ages naturally: minutes after the stream, tags read `stale` while the window is
  still the latest fault. No producer keeps posting on staging, so `ingested_at` does not
  advance; the dogfood negative test (frozen `event_timestamp`, advancing `ingested_at`) is
  produced by re-pushing a saved payload: `rekey --out p.json` once, then `ingest --payload p.json`
  repeatedly.
- The batch pass's zero-length `estopped`/`idle` windows at the ingest instant are real derived
  rows, not fabrications; the latest window (by `started_at`) is the streamed one.
- A first asset created before the redeploy (`CONVEYOR-1`, no bridge node, `uns_path` NULL) is
  left in place as the "asset without a machine" negative case; the notebook route refuses it.

## Gaps this lane surfaced (not fixed here)

- A stranger tenant has **no self-serve door to `approved_tags`** when `mira-ingest` is absent:
  the only Hub path is PLC import → `tag_mapping` suggestion → accept. The L3 "connected
  machine" onboarding therefore depends on a workflow dispatch today.
- Staging carries no relay and no historian, so REPLAY on staging is provable only via the
  in-process calls above. Adding both services to `docker-compose.staging-vps.yml` is an infra
  change for a separate lane.
- Mobile: `mira-mobile/src/api/client.ts:15` hardcodes `API_BASE = "https://app.factorylm.com"`
  and the shell uses `androidScheme: "https"` with no cleartext allowance, so a debug build
  pointed at `http://165.245.138.91:4101` also needs `android.allowMixedContent` and
  `usesCleartextTraffic` locally. Do not commit any of that.
