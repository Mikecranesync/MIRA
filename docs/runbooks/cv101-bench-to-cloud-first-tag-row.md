# CV-101 Bench-to-Cloud: First Physical Tag Row

**Goal:** get one real (non-simulated) CV-101 tag reading from the bench
Ignition gateway into MIRA Cloud's `tag_events` + `live_signal_cache`, with a
signed smoke test you can run before touching real hardware.

**Scope:** the Home Garage Conveyor (CV-101) rig — UNS
`enterprise.home_garage.conveyor_lab.conveyor_1`. Every claim below is cited
to the file that backs it; this is not aspirational.

**Correction to earlier drafts:** the seeding step uses
`.github/workflows/apply-approved-tags.yml`, **not** `apply-seeds.yml`.
`apply-seeds.yml` is `knowledge_entries`-only (TEXT tenant slug, KB pre-flight
shape) — see its own `inputs.seeds` description. `apply-approved-tags.yml` is
the dedicated workflow for the UUID-tenant `approved_tags` allowlist this
runbook needs (its header says so explicitly). Verified by reading both
workflow files before writing this doc (`.claude/rules/debugging-conventions.md`
§2 — verify schema/API paths from the codebase before guessing).

---

## 0. Prerequisites checklist

| # | Item | Evidence |
|---|---|---|
| 1 | Migrations 033/035/036 applied to the target env | `mira-hub/db/migrations/033_tag_events.sql`, `035_approved_tags.sql`, `036_current_tag_state_freshness.sql` |
| 2 | Doppler `factorylm/prd` (or `/stg`) has `MIRA_IGNITION_HMAC_KEY` set | `docker-compose.saas.yml:474` reads `${MIRA_IGNITION_HMAC_KEY:-}` for the `mira-relay` service |
| 3 | `NEON_DATABASE_URL` set for the relay | `docker-compose.saas.yml:478`; `mira-relay/tag_ingest.py` `NeonTagStore` |
| 4 | Relay redeployed with the above env | `mira-relay/relay_server.py:27` reads `MIRA_IGNITION_HMAC_KEY` at import time — a running container with a stale env needs a redeploy, not a config reload |
| 5 | Relay health check passes | `mira-relay/relay_server.py:222-223` (`GET /health` → `{"status":"ok"}`) |

### [CLOUD] Step 1 — apply migrations (staging first, then prod)

```bash
# staging dry-run
gh workflow run apply-migrations.yml \
  -f target=staging -f migrations=033,035,036 -f mode=dry-run

# staging apply
gh workflow run apply-migrations.yml \
  -f target=staging -f migrations=033,035,036 -f mode=apply

# prod, only after staging is verified
gh workflow run apply-migrations.yml \
  -f target=prod -f migrations=033,035,036 -f mode=apply
```

`apply-migrations.yml` records each applied file in `schema_migrations` by
filename and is idempotent (`IF NOT EXISTS` throughout) — re-running is safe.

### [CLOUD] Step 2 — set the HMAC key + redeploy the relay

```bash
doppler secrets set MIRA_IGNITION_HMAC_KEY --project factorylm --config prd
# (prompts for the value; never paste it into a shell history file)

# Confirm NEON_DATABASE_URL is already set (it backs several services):
doppler secrets get NEON_DATABASE_URL --project factorylm --config prd --plain | head -c 20; echo

# Redeploy — per root CLAUDE.md, NEVER `docker compose` the VPS directly.
gh workflow run deploy-vps.yml -f services=mira-relay
```

### [CLOUD] Step 3 — health check

```bash
curl -sS https://api.factorylm.com/health
# expect: {"status":"ok","service":"mira-relay"}
```

If this 404s or times out, the relay isn't the container answering that host —
check the reverse-proxy routing before going further (out of scope here).

---

## [CLOUD] Step 4 — seed `approved_tags` for CV-101

Source of truth: `tools/seeds/approved_tags_conveyor.sql` (58 rows, all bound
to `enterprise.home_garage.conveyor_lab.conveyor_1`). Guarded by
`tests/test_approved_tags_conveyor_seed.py` (normalization + UNS-subtree
pins) and `tests/test_conveyor_allowlist_parity.py` (parity with the
gateway-side `ignition/project/approved_tags.json`).

**Tenant:** `e88bd0e8-8a84-4e30-9803-c0dc6efb07fe` — Mike's own primary
tenant, confirmed on prod (`docs/runbooks/secret-shopper-testing-setup.md:24`).
Use a different UUID if seeding under a different tenant.

```bash
# staging dry-run — shows the resolved SQL + a pre-flight row count first
gh workflow run apply-approved-tags.yml \
  -f target=staging \
  -f seed=approved_tags_conveyor \
  -f tenant_id=e88bd0e8-8a84-4e30-9803-c0dc6efb07fe \
  -f mode=dry-run

# staging apply
gh workflow run apply-approved-tags.yml \
  -f target=staging \
  -f seed=approved_tags_conveyor \
  -f tenant_id=e88bd0e8-8a84-4e30-9803-c0dc6efb07fe \
  -f mode=apply

# prod, only after staging is verified
gh workflow run apply-approved-tags.yml \
  -f target=prod \
  -f seed=approved_tags_conveyor \
  -f tenant_id=e88bd0e8-8a84-4e30-9803-c0dc6efb07fe \
  -f mode=apply
```

The workflow's own post-apply step already prints row counts
(`.github/workflows/apply-approved-tags.yml` "Post-apply row counts (proof)"
step). For a manual check:

```sql
-- run via db-inspect.yml (read-only) or psql against staging/dev directly —
-- NEVER psql prod ad hoc (root CLAUDE.md Environments hard rule #1)
SELECT count(*) AS total, count(*) FILTER (WHERE enabled = true) AS enabled_rows
  FROM approved_tags
 WHERE tenant_id = 'e88bd0e8-8a84-4e30-9803-c0dc6efb07fe'::uuid
   AND source_system = 'ignition';
-- expect: total=58, enabled_rows=58
```

**Known gap (documented, not fixed here):** the gateway JSON allowlist
(`ignition/project/approved_tags.json`, 65 entries) has 7 tags not yet in
this SQL seed — `[default]MIRA/Config/conveyor/map` (a config lookup, not a
telemetry value) and 6 newer VFD-analyzer tags
(`vfd_warn_code`/`vfd_freq_cmd`/`vfd_torque`/`vfd_motor_rpm`/`vfd_power`/
`vfd_last_fault`). `tests/test_conveyor_allowlist_parity.py` pins this exact
delta so it can't silently grow. If the VFD-analyzer tags need to reach the
cloud, add them to `tools/seeds/approved_tags_conveyor.sql` and re-apply —
that's a follow-up, not a blocker for the first tag row (`VFD_Hz` and
`Motor_Current_A` are both already seeded).

---

## [SMOKE] Step 5 — signed smoke test (no gateway required)

Proves the whole cloud side — HMAC verification, allowlist match, UNS
resolution, `tag_events`/`live_signal_cache` writes — works before touching
the physical PLC/gateway.

```bash
cd mira-relay
MIRA_IGNITION_HMAC_KEY='<the value you set in Doppler above>' \
  python -m tools.sign_and_post \
    --url https://api.factorylm.com/api/v1/tags/ingest \
    --tenant e88bd0e8-8a84-4e30-9803-c0dc6efb07fe \
    --key-env MIRA_IGNITION_HMAC_KEY \
    --tag "[default]Conveyor/VFD_Hz" --value 60.0 --value-type float \
    --source-system ignition
```

Expected output:

```
HTTP 200
{
  "status": "ok",
  "source_system": "ignition",
  "simulated": false,
  "accepted": 1,
  "events_written": 1,
  "state_upserts": 1,
  "cache_skipped": 0,
  "rejected": []
}
```

`accepted=1`, `rejected=[]`, `simulated=false` — that is the signal the CV-101
allowlist row for `VFD_Hz` matched and the write landed. Run with `--dry-run`
first (prints body + headers, key masked, no network) if you want to inspect
the exact bytes before sending — see `mira-relay/tests/test_sign_and_post.py`
for the offline sign→verify proof this tool is built on.

Try a second reading against `Motor_Current_A` the same way, and one against
a tag that is NOT allowlisted (e.g. `[default]Conveyor/Nonexistent_Tag`) to
see `rejected: [{"tag_path": "...", "reason": "not_allowlisted"}]` — this is
the fail-closed behavior `tests/test_cv101_ingest_e2e.py` pins offline.

---

## [BENCH — MANUAL] Step 6 — install the tag-stream Gateway Timer

**WebDev module is NOT required for this step.** The tag-stream collector is
a **Gateway Timer Script** (`ignition/gateway-scripts/tag-stream.py`), not a
WebDev HTTP endpoint. The bench gateway's known WebDev-module-not-installed
gap (`docs/RESUME_2026-06-14_maintenance-intelligence-module.md`) only
affects the in-gateway Ask-MIRA chat/diagnose HTTP surface
(`ignition/webdev/FactoryLM/api/diagnose/`) — it does **not** block tag
streaming.

Full detail: `docs/integrations/ignition-tag-collector.md`. Condensed here:

1. **Deploy the pure logic modules** to the project script library so the
   timer can `from factorylm import collector`
   (`ignition/gateway-scripts/tag-stream.py:50-61`):
   ```
   <project>/ignition/script-python/factorylm/
     ├── __init__.py
     ├── collector.py   (from ignition/webdev/FactoryLM/api/tags/collector.py)
     ├── signing.py     (from ignition/webdev/FactoryLM/api/chat/signing.py)
     └── allowlist.py   (from ignition/webdev/FactoryLM/api/tags/allowlist.py)
   ```

2. **Place `approved_tags.json`** at one of the paths
   `allowlist.resolve_allowlist_path()` searches, or set
   `MIRA_ALLOWLIST_PATH` (`docs/integrations/ignition-tag-collector.md`
   Install step 2).

3. **Write `factorylm.properties`**
   (`ignition/gateway-scripts/tag-stream.py:24-38`, `getMiraConfig`):
   ```properties
   INGEST_URL=https://api.factorylm.com/api/v1/tags/ingest
   TENANT_ID=e88bd0e8-8a84-4e30-9803-c0dc6efb07fe
   MIRA_HMAC_KEY=<same value as Doppler MIRA_IGNITION_HMAC_KEY>
   STREAM_TAG_FOLDER=[default]
   STREAM_SOURCE_CONNECTION_ID=cv101-bench-gateway
   STREAM_MAX_RETRIES=3
   ```
   **Note on `STREAM_TAG_FOLDER`:** the timer browses ONE root folder per run
   (`_browse_leaf_tags`, `ignition/gateway-scripts/tag-stream.py:99-112`).
   The CV-101 seed spans both `[default]Conveyor/*` and
   `[default]Mira_Monitored/conveyor_demo/*` (`tools/seeds/approved_tags_conveyor.sql`)
   plus `[default]MIRA_IOCheck/*`, so point it at the provider root
   (`[default]`) to cover all three trees in one timer — the fail-closed
   allowlist filters everything not seeded, so browsing broader than the
   allowlist is safe. If the gateway has a large unrelated tag count and
   browsing `[default]` is too slow, run one timer per folder instead
   (duplicate the Gateway Event Script with a different `STREAM_TAG_FOLDER`
   per timer — `factorylm.properties` only holds one value per key).
   Standard properties-file search paths (`getMiraConfig`,
   `ignition/gateway-scripts/tag-stream.py:73-77`):
   `C:/Program Files/Inductive Automation/Ignition/data/factorylm/factorylm.properties`
   (Windows) or `/usr/local/bin/ignition/data/factorylm/factorylm.properties` /
   `/var/lib/ignition/data/factorylm/factorylm.properties` (Linux).

4. **Create the Gateway Timer Script** (Config → Gateway Events → Timer):
   paste/reference `tag-stream.py`, **Fixed Rate, 2000 ms**
   (`ignition/gateway-scripts/tag-stream.py:2`).

5. **Watch the gateway logger `FactoryLM.Mira.TagStream`**
   (`ignition/gateway-scripts/tag-stream.py:43`):
   - `Streamed N/M allowlisted tags (attempts=1)` → working.
   - `MIRA tag-stream not configured (TENANT_ID / MIRA_HMAC_KEY missing)` →
     `factorylm.properties` incomplete.
   - `Tag ingest failed status=401` → HMAC key mismatch vs. the relay's
     `MIRA_IGNITION_HMAC_KEY` — see Troubleshooting below.
   - `No allowlisted tags to stream (browsed N)` → `STREAM_TAG_FOLDER` /
     `approved_tags.json` mismatch, or the allowlist file wasn't found.

**Read-only guarantee:** only `system.tag.browseTags` +
`system.tag.readBlocking` are used — no `system.tag.write*`, ever
(`ignition/gateway-scripts/tag-stream.py:19-22`, `.claude/rules/fieldbus-readonly.md`).

---

## [VERIFY] Step 7 — confirm the row landed

Read-only SQL via `db-inspect.yml` (never psql prod ad hoc):

```bash
gh workflow run db-inspect.yml -f target=staging   # or prod, once verified on staging
```

Add (or run directly against staging via psql) these checks — schema per
`mira-hub/db/migrations/033_tag_events.sql` / `036_current_tag_state_freshness.sql`:

```sql
-- tag_events: count + newest row for this tenant/source
SELECT count(*) AS n, max(event_timestamp) AS newest
  FROM tag_events
 WHERE tenant_id = 'e88bd0e8-8a84-4e30-9803-c0dc6efb07fe'::uuid
   AND source_system = 'ignition';

-- provenance: EVERY row from this source must be real, never simulated
SELECT bool_and(NOT simulated) AS all_real
  FROM tag_events
 WHERE tenant_id = 'e88bd0e8-8a84-4e30-9803-c0dc6efb07fe'::uuid
   AND source_system = 'ignition';
-- expect: all_real = true

-- live_signal_cache freshness (036: freshness_status live|stale|unknown|simulated)
SELECT plc_tag, uns_path::text, last_value_numeric, last_seen_at,
       simulated, source_system, freshness_status
  FROM live_signal_cache
 WHERE tenant_id = 'e88bd0e8-8a84-4e30-9803-c0dc6efb07fe'::uuid
   AND plc_tag IN ('[default]Conveyor/VFD_Hz',
                    '[default]Mira_Monitored/conveyor_demo/Motor_Current_A')
 ORDER BY last_seen_at DESC;
-- expect: freshness_status='live', simulated=false, last_seen_at recent
```

**Screenshot** (per root `CLAUDE.md` Screenshot Rule — desktop + mobile,
saved to `docs/promo-screenshots/`, never deleted):

```
docs/promo-screenshots/2026-07-03_cv101-first-tag-events-row_desktop.png
docs/promo-screenshots/2026-07-03_cv101-first-tag-events-row_mobile.png
```

Capture the Command Center tile (or a `psql`/db-inspect result panel) showing
the first real CV-101 row with a fresh `last_seen_at` and `simulated=false`.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `401 {"detail":"signature_mismatch"}` | Gateway's `MIRA_HMAC_KEY` (or `sign_and_post --key-env` value) doesn't match the relay's `MIRA_IGNITION_HMAC_KEY` | Confirm both sides read the exact same Doppler secret; redeploy the relay after any Doppler change (env is read at process start — `mira-relay/relay_server.py:27`) |
| `401 {"detail":"bad_timestamp"}` | Gateway/bench clock is >300s off from the relay's clock | Fix NTP sync on the source; `auth.py` (`TIMESTAMP_SKEW_SECONDS = 300`) has no override |
| `401 {"detail":"replay_detected"}` | Same `(tenant, nonce)` sent twice within 600s | Each `sign_and_post` invocation and each `tag-stream.py` attempt mints a fresh nonce automatically — this only fires on manual replays of captured bytes |
| Gateway log: `No allowlisted tags to stream (browsed N)` | `STREAM_TAG_FOLDER` doesn't match the folder `approved_tags.json` lists, or the allowlist file wasn't found at a searched path | Check `allowlist.resolve_allowlist_path()` search paths; confirm `STREAM_TAG_FOLDER` covers the tags you expect (e.g. `[default]Conveyor`, not `[default]Mira_Monitored`, if you want the `Conveyor/*` tags) |
| `200` response but `"rejected": [{"reason": "not_allowlisted"}]` | Normalizer drift between the seed's `normalized_tag_path` and what `mira-relay/ingest_contract.normalize_tag_path` produces for the same raw path today, OR the tag genuinely isn't seeded yet | `tests/test_approved_tags_conveyor_seed.py` guards drift — if it's green, the tag is simply not in the seed (see the Known gap note in Step 4) — add it and re-apply |
| `400 {"error":"tenant_required"}` | No `X-MIRA-Tenant` header and no body `tenant_id` | `sign_and_post.py` always sets `X-MIRA-Tenant`; a hand-rolled request forgot it |
| Cloud shows the row but `simulated=true` | `source_system` in the batch was `"simulator"`, not `"ignition"` | Check `--source-system` on `sign_and_post` / the gateway's `collector.SOURCE_SYSTEM` constant (`ignition/webdev/FactoryLM/api/tags/collector.py:42`, always `"ignition"`) |

---

## What this runbook does NOT cover

- Writing to the PLC or the VFD — this whole path is read-only by
  construction (`.claude/rules/fieldbus-readonly.md`).
- Deploying an "Ask MIRA" HMI panel for CV-101 — that requires the asset
  agent to be validated per `.claude/rules/train-before-deploy.md`; tag
  streaming and Ask-MIRA deployment are independent gates.
- The WebDev-based in-gateway diagnose endpoint — separate surface, separate
  known gap, not blocking here (see Step 6 opening note).

## Automated tests backing this runbook

| Test | Proves |
|---|---|
| `tests/test_approved_tags_conveyor_seed.py` | Seed normalization matches the real relay normalizer; every row is bound to the CV-101 UNS subtree |
| `tests/test_conveyor_allowlist_parity.py` | Gateway JSON vs. relay SQL allowlist delta is the documented one, not silent drift |
| `tests/test_cv101_ingest_e2e.py` | Real CV-101 tag paths pass through `ingest_batch` and land correctly (accepted, UNS-resolved, `simulated=false`); an unapproved tag is rejected and never stored |
| `tests/test_cv101_relay_ingest_e2e.py` | A `sign_and_post`-signed CV-101 batch is accepted by the real Starlette relay app end-to-end; a tampered body or wrong key is rejected 401 |
| `mira-relay/tests/test_sign_and_post.py` | `sign_and_post.build_signed_request` output is accepted by `auth.verify_hmac` (sign↔verify agreement), tampering/wrong-key are rejected, and `--dry-run` never prints the key |
