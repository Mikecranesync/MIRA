# Staging validation — SimLab → UNS HTTP relay ingest (L1+L2 / PR #2280)

**Scope:** prove the SimLab→relay HTTP ingest path end-to-end on **staging** before
relying on it. Pairs with PR #2280 (`feat/simlab-relay-ingest-emit`) and the roadmap
`docs/plans/2026-06-22-simlab-uns-ingest-roadmap.md` (Lanes 1–2, Gaps A/B/C).

**Environment law (`docs/environments.md`, root `CLAUDE.md` § Environments):**
- dev → **staging** → prod, in that order. **Never** psql prod; **never** seed prod first.
- Migrations via `apply-migrations.yml` (`dry-run` then `apply`). Seeds staging-first.
- Read-only schema inspection via `db-inspect.yml` or psql against `factorylm/stg`.
- `tools/hooks/prod-guard.sh` blocks the obvious prod blast-radius cases — it's a floor.

**Reserved tenant:** `SIMLAB_TENANT_ID = 00000000-0000-0000-0000-000000515ab1`
(`simlab/__init__.py`). No provisioning — the SimLab self-feed does **not** use the
`proveit` tenant.

**Prereqs for the live steps:** a staging `mira-relay` reachable at `$RELAY`, with
`NEON_DATABASE_URL` → staging Neon branch and `MIRA_IGNITION_HMAC_KEY=$HMAC` set;
SimLab run from the repo (`python -m simlab`). Export once:

```bash
export RELAY="https://relay.staging.factorylm.com"     # staging relay base URL
export HMAC="<staging MIRA_IGNITION_HMAC_KEY from Doppler factorylm/stg>"
export TENANT="00000000-0000-0000-0000-000000515ab1"
export STG="$(doppler secrets get NEON_DATABASE_URL --project factorylm --config stg --plain)"
```

---

## Confidence floor before any infra — the no-infra proofs already pass

Run these first; they gate whether staging validation is even worth scheduling.
**All green as of this PR.**

```bash
python -m pytest tests/simlab/ -q
python -m ruff check simlab/ tools/seeds/gen_approved_tags_simulator.py tests/simlab/
```
Expected: `81 passed, 3 skipped`; ruff `All checks passed!`. In particular:
- `tests/simlab/test_relay_ingest_e2e.py` — emit→land seam through the **real relay
  ASGI app + `ingest_batch`**, HMAC-signed, in-memory store (proves steps 2/4/5/6/7/8
  with zero infra; staging steps below confirm against real NeonDB).
- `tests/simlab/test_approved_tags_seed.py` — generator normalizer == authoritative
  `mira-relay/tag_ingest.normalize_tag_path` (step 4) + seed drift guard.

---

## Step 1 — `approved_tags_simulator.sql` applies successfully

The seed hardcodes `SIMLAB_TENANT_ID` (no `__TENANT_ID__` placeholder), so it applies
as-is. Confirm prerequisite migrations exist in staging FIRST (`approved_tags` is
migration `035`; landing also needs `020/033/036`).

```bash
# 1a. Confirm the schema is present (read-only).
gh workflow run db-inspect.yml -f env=staging \
  -f query="SELECT to_regclass('public.approved_tags'), to_regclass('public.tag_events'), to_regclass('public.live_signal_cache');"
# (or, against staging directly:)
psql "$STG" -c "SELECT to_regclass('public.approved_tags'), to_regclass('public.tag_events'), to_regclass('public.live_signal_cache');"

# 1b. Regenerate + apply the seed (staging).
python tools/seeds/gen_approved_tags_simulator.py     # rewrites the .sql deterministically
psql "$STG" -f tools/seeds/approved_tags_simulator.sql

# 1c. Verify row count for the reserved tenant.
psql "$STG" -c "SELECT count(*) FROM approved_tags WHERE source_system='simulator' AND tenant_id='$TENANT'::uuid;"
```

**Expected:** 1a returns three non-null regclasses. 1b prints `INSERT 0 89` (first run)
or `INSERT 0 0` + `UPDATE` on re-run (idempotent). 1c returns **89**.

**Failure modes:**
- `relation "approved_tags" does not exist` → migration `035` not applied. Apply
  `020/033/035/036` via `apply-migrations.yml` (`dry-run` → `apply`), then retry.
- `type "ltree" does not exist` → `CREATE EXTENSION ltree` missing on the branch (mig
  035 creates it; means 035 didn't run).
- `permission denied for table approved_tags` → applying as `factorylm_app` without a
  grant; apply seeds as the migration role (the seed is a privileged op).
- count ≠ 89 → a partial apply or a stale `.sql`. Re-run 1b after `gen_…py`.

**Rollback/recovery:** the seed is additive + idempotent; re-apply is safe. To remove:
`DELETE FROM approved_tags WHERE source_system='simulator' AND tenant_id='$TENANT'::uuid;`
(staging only). No data loss elsewhere — `approved_tags` is an allowlist, not telemetry.

---

## Step 2 — mira-relay accepts SimLab HMAC-signed traffic

```bash
# 2a. Relay health.
curl -fsS "$RELAY/health" ; echo

# 2b. One signed batch from SimLab against staging relay.
SIMLAB_RELAY_URL="$RELAY" SIMLAB_RELAY_HMAC_KEY="$HMAC" SIMLAB_RELAY_TENANT_ID="$TENANT" \
  python -m simlab &           # serves :8099 with the relay publisher attached
SIM_PID=$!
sleep 2
curl -fsS -X POST localhost:8099/simlab/advance -d '{"ticks":1}' -H 'content-type: application/json' ; echo
```

**Expected:** 2a → `{"status":"ok","service":"mira-relay"}`. The relay log line shows
`tags_ingest tenant=00000000-…-515ab1 source=simulator accepted=89 rejected=0
cache_skipped=0 sim=True`.

**Failure modes:**
- relay 401 `auth_failed` `signature_mismatch` → `$HMAC` on SimLab ≠ relay's
  `MIRA_IGNITION_HMAC_KEY`. Confirm both read the same Doppler `factorylm/stg` value.
- 401 `bad_timestamp` → clock skew > 300 s between the SimLab host and the relay; sync NTP.
- 401 `replay_detected` → re-posting an identical signed body; each `advance()` mints a
  fresh nonce, so this only appears if a proxy duplicated the request — ignore one-offs.
- `accepted=0 rejected=89 reason=not_allowlisted` → step 1 seed missing/under wrong
  tenant; re-run step 1 against the SAME tenant the publisher signs with.

**Rollback/recovery:** `kill $SIM_PID`. No relay state to undo (reads + appends only;
see steps 5/6 to clean landed rows if desired).

---

## Step 3 — tenant routing behaves correctly

The HMAC `X-MIRA-Tenant` header is authoritative; a body `tenant_id` must never override it.

```bash
# 3a. Confirm landed rows are owned by the reserved tenant ONLY.
psql "$STG" -c "SELECT tenant_id, count(*) FROM tag_events WHERE source_system='simulator' GROUP BY 1;"

# 3b. Negative: a forged body tenant under a valid HMAC tenant does not win.
#     (HMAC header tenant = $TENANT; body tenant = a bogus uuid.)
BODY='{"source_system":"simulator","tenant_id":"deadbeef-0000-0000-0000-000000000000","tags":[]}'
# Sign with the REAL tenant via the publisher contract — easiest is to assert in code:
python - <<'PY'
import os, sys; sys.path.insert(0, "mira-relay")
from auth import verify_hmac
import hashlib, hmac, time, json, uuid
key=os.environ["HMAC"]; tenant=os.environ["TENANT"]
body=b'{"source_system":"simulator","tenant_id":"deadbeef-0000-0000-0000-000000000000","tags":[]}'
nonce=uuid.uuid4().hex; ts=str(int(time.time()))
sig=hmac.new(key.encode(), f"{tenant}\n{nonce}\n{ts}\n{hashlib.sha256(body).hexdigest()}".encode(), hashlib.sha256).hexdigest()
print("verify returns tenant:", verify_hmac({"x-mira-tenant":tenant,"x-mira-nonce":nonce,"x-mira-timestamp":ts,"x-mira-signature":sig}, body, key))
PY
```

**Expected:** 3a → only `00000000-…-515ab1` appears (no other tenant). 3b → prints the
**reserved** tenant, proving `verify_hmac` returns the header tenant and the relay uses
that (`relay_server.tags_ingest`: `tenant_id = hmac_tenant or payload.get("tenant_id")`),
so the forged body tenant is ignored.

**Failure modes:**
- 3a shows a second tenant → a non-SimLab simulator feed is also running, OR the relay
  is in legacy-bearer mode (`RELAY_LEGACY_BEARER=1`) and trusting body tenants. For the
  staging proof, run the relay **without** legacy bearer so HMAC is mandatory.
- 3b prints the bogus tenant → HMAC verification is bypassed (key empty / header path
  not taken). Check `MIRA_IGNITION_HMAC_KEY` is set on the relay.

**Rollback/recovery:** none needed (read-only + a verification assertion).

---

## Step 4 — tag normalization matches the authoritative implementation

This is the fail-closed invariant: a seeded `normalized_tag_path` that differs from what
the relay computes for live traffic means silent rejection.

```bash
python -m pytest tests/simlab/test_approved_tags_seed.py::test_generator_normalizer_matches_the_real_relay_function -q
# Cross-check at the DB level: every seeded normalized path must equal normalize(source_tag_path).
psql "$STG" -c "
  SELECT count(*) AS mismatches FROM approved_tags
   WHERE source_system='simulator' AND tenant_id='$TENANT'::uuid
     AND normalized_tag_path IS DISTINCT FROM
         regexp_replace(lower(source_tag_path), '[^a-z0-9]+', '_', 'g');"
```

**Expected:** the pytest passes (89/89 tags equal `mira-relay/tag_ingest.normalize_tag_path`).
The SQL returns `mismatches = 0`. (Note: the SQL regex does not trim leading/trailing `_`;
SimLab paths never start/end with a separator, so it matches the Python `.strip('_')`. If a
future tag could, trust the pytest — it calls the real function.)

**Failure modes:**
- pytest fails → the generator's local normalizer drifted from the relay's. Fix
  `gen_approved_tags_simulator.py::normalize_tag_path` to match `tag_ingest.normalize_tag_path`,
  regenerate, re-seed (step 1).
- SQL `mismatches > 0` → a hand-edited seed. Never edit the `.sql` by hand; regenerate.

**Rollback/recovery:** regenerate + re-seed (idempotent). No telemetry affected.

---

## Step 5 — events land in `tag_events`

```bash
psql "$STG" -c "
  SELECT count(*), count(DISTINCT tag_path), bool_and(simulated) AS all_sim
    FROM tag_events
   WHERE source_system='simulator' AND tenant_id='$TENANT'::uuid;"
# advance a few more ticks and confirm append-only growth:
curl -fsS -X POST localhost:8099/simlab/advance -d '{"ticks":2}' -H 'content-type: application/json'
psql "$STG" -c "SELECT count(*) FROM tag_events WHERE source_system='simulator' AND tenant_id='$TENANT'::uuid;"
```

**Expected:** after 1 advance, `count = 89`, `count(distinct tag_path) = 89`,
`all_sim = t`. After 2 more advances, count grows by ~178 (append-only; one row per
reading per tick). `uns_path` is populated on these rows.

**Failure modes:**
- count = 0 → nothing accepted; revisit step 2 (auth) / step 1 (allowlist).
- count grows but `uns_path` NULL → the allowlist row's `uns_path` column is NULL.
  The generated seed always sets it; a NULL means a hand-edited or partial seed.
- count grows by far more/less than 89/tick → a second feed is active, or `advance`
  isn't streaming a full snapshot (check `SimEngine.advance` publisher attach).

**Rollback/recovery (staging cleanup only):**
`DELETE FROM tag_events WHERE source_system='simulator' AND tenant_id='$TENANT'::uuid;`
`tag_events` is append-only telemetry; deleting simulator rows on staging is safe and
does not touch real data (provenance is isolated by `simulated`/`source_system`).

---

## Step 6 — values land in `live_signal_cache` (UNS-mapped latest value)

```bash
psql "$STG" -c "
  SELECT count(*), count(uns_path) AS with_uns, bool_and(simulated) AS all_sim
    FROM live_signal_cache
   WHERE source_system='simulator' AND tenant_id='$TENANT'::uuid;"
# subtree read (the shape Command Center / /api/mira/ask use):
psql "$STG" -c "
  SELECT tag_path, value, uns_path, freshness_status
    FROM live_signal_cache
   WHERE tenant_id='$TENANT'::uuid
     AND uns_path <@ 'enterprise.florida_natural_demo.plant1.juice_bottling.line01'::ltree
   LIMIT 5;"
```

**Expected:** `count = 89` (one row per tag — latest value, not append), `with_uns = 89`,
`all_sim = t`. The subtree query returns SimLab line tags with resolved `uns_path` and a
`freshness_status` (from migration `036`). Re-advancing updates values in place (count
stays 89).

**Failure modes:**
- count = 89 in `tag_events` but 0 in `live_signal_cache` → the cache upsert half of the
  transaction failed; check relay logs for the `persist_batch` error (events + cache are
  one transaction, so this should be all-or-nothing — a split means a schema mismatch on
  `live_signal_cache`, e.g. mig `036` columns absent).
- `cache_skipped > 0` in the relay log → a **real** (`simulated=false`) row already exists
  for that tag; the sim correctly does NOT overwrite real data. Expected if real telemetry
  shares the tenant; for a clean SimLab-only staging tenant it should be 0.

**Rollback/recovery:**
`DELETE FROM live_signal_cache WHERE source_system='simulator' AND tenant_id='$TENANT'::uuid;`
(staging only). Safe — sim rows never clobbered real ones, so no real value is lost.

---

## Step 7 — relay outages remain non-blocking to SimLab execution

```bash
# 7a. Local proof (no infra):
python -m pytest "tests/simlab/test_relay_ingest_e2e.py::test_relay_outage_does_not_stop_the_sim" -q
python -m pytest "tests/simlab/test_publishers.py::test_relay_publish_is_best_effort_on_error" -q

# 7b. Staging proof: point SimLab at a dead relay and confirm it keeps ticking.
SIMLAB_RELAY_URL="http://127.0.0.1:0" SIMLAB_RELAY_HMAC_KEY="$HMAC" SIMLAB_RELAY_TENANT_ID="$TENANT" \
  python -m simlab &
SIM_PID=$!; sleep 2
curl -fsS localhost:8099/simlab/healthz ; echo          # must still respond
curl -fsS -X POST localhost:8099/simlab/advance -d '{"ticks":5}' -H 'content-type: application/json' ; echo
kill $SIM_PID
```

**Expected:** 7a both pass. 7b → `/simlab/healthz` returns `{"status":"ok","tick":…}`,
`advance` succeeds and `tick` increments to 5 despite every publish failing (logged as
`RelayIngestPublisher.publish failed: …`, never raised).

**Failure modes:**
- `advance` 500s or the process exits → a publisher error escaped `publish()`. That is a
  regression in the best-effort `try/except` in `RelayIngestPublisher.publish`
  (`simlab/publishers.py`) or `SimEngine.publish_snapshot` (which isolates per-publisher).
  Block the merge.

**Rollback/recovery:** `kill $SIM_PID`. No persisted state.

---

## Step 8 — tampered payloads fail authentication as expected

```bash
# 8a. Local proof against the authoritative verifier:
python -m pytest \
  "tests/simlab/test_publishers.py::test_relay_hmac_signature_is_over_the_exact_bytes_sent" \
  "tests/simlab/test_relay_ingest_e2e.py::test_unsigned_traffic_is_rejected_when_hmac_required" -q

# 8b. Staging proof: replay a captured signed body with one byte changed.
python - <<'PY'
import os, hashlib, hmac, time, uuid, httpx
key=os.environ["HMAC"]; tenant=os.environ["TENANT"]; relay=os.environ["RELAY"]
body=b'{"source_system":"simulator","tags":[]}'
nonce=uuid.uuid4().hex; ts=str(int(time.time()))
sig=hmac.new(key.encode(), f"{tenant}\n{nonce}\n{ts}\n{hashlib.sha256(body).hexdigest()}".encode(), hashlib.sha256).hexdigest()
hdr={"X-MIRA-Tenant":tenant,"X-MIRA-Nonce":nonce,"X-MIRA-Timestamp":ts,"X-MIRA-Signature":sig,"Content-Type":"application/json"}
r=httpx.post(f"{relay}/api/v1/tags/ingest", content=body+b' ', headers=hdr, timeout=10)  # body tampered (+space)
print("tampered  ->", r.status_code, r.json())
r2=httpx.post(f"{relay}/api/v1/tags/ingest", content=body, headers=hdr, timeout=10)        # untampered
print("clean     ->", r2.status_code, r2.json())
PY
```

**Expected:** 8a passes. 8b → tampered request returns **401** `{"error":"auth_failed",
"detail":"signature_mismatch"}`; the clean request returns 200. (Re-running the clean one
a second time returns 401 `replay_detected` — also correct: same nonce.)

**Failure modes:**
- tampered request returns 200 → HMAC not enforced (relay started with no
  `MIRA_IGNITION_HMAC_KEY`, or `RELAY_LEGACY_BEARER=1` letting it through). Mandate HMAC
  on the staging relay; block reliance on the path until fixed.

**Rollback/recovery:** none (read-only auth probe). If the empty-`tags` clean request
landed a 0-row batch, nothing persisted.

---

## Sign-off matrix

| # | Proof | No-infra evidence (this PR) | Staging command | Pass = |
|---|---|---|---|---|
| 1 | seed applies | drift guard test | `psql -f …simulator.sql` | `INSERT 0 89` + count 89 |
| 2 | relay accepts HMAC | e2e seam test | `python -m simlab` + advance | `accepted=89 rejected=0` |
| 3 | tenant routing | e2e asserts tenant carried | step 3 SQL + verify | only reserved tenant |
| 4 | normalize matches | normalizer-pin test | step 4 SQL | `mismatches=0` |
| 5 | tag_events lands | e2e (in-mem events) | step 5 SQL | count = 89·ticks |
| 6 | live_signal_cache lands | e2e (in-mem state) | step 6 SQL | count 89, with_uns 89 |
| 7 | outage non-blocking | 2 outage tests | dead-relay advance | tick increments |
| 8 | tamper rejected | tamper + unsigned tests | step 8 tamper probe | 401 signature_mismatch |

**Recommendation gate:** steps 1–8 must be green on staging before the SimLab→UNS HTTP
path is declared production-trustworthy. The no-infra column is already green (CI); the
staging column is **pending infra** (relay + Neon staging branch). See the readiness
recommendation in the session report / PR #2280.
