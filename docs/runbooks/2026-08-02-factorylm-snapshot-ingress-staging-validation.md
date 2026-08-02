# Staging validation — FactoryLM machine snapshot → relay ingest (PRD #3048, PR 3)

**Scope:** prove the `factorylm.machine-snapshot.v1` → `POST /api/v1/tags/ingest` path on
**staging** before anything downstream relies on it. Pairs with PR 3 of
`docs/prd/2026-08-01-mira-factorylm-machine-evidence-handoff.md`. PR 4 (the MIRA
live-context serving path) reads the state this lands — it is blocked on step 5 here.

Modeled on `docs/runbooks/2026-06-23-simlab-relay-ingest-staging-validation.md`, which is
the same shape for the SimLab producer. Read that one for the deeper failure-mode catalog
of the relay itself; this runbook covers only what is FactoryLM-specific.

**Environment law (`docs/environments.md`, root `CLAUDE.md` § Environments):**
- dev → **staging** → prod, in that order. **Never** psql prod; **never** seed prod first.
- Migrations via `apply-migrations.yml` (`dry-run` then `apply`). Seeds staging-first.
- Read-only schema inspection via `db-inspect.yml` or psql against `factorylm/stg`.
- `tools/hooks/prod-guard.sh` blocks the obvious prod blast-radius cases — it's a floor.

**Read-only.** Everything here observes. No PLC write, no control word, no actuator field
— a machine snapshot is observation data (PRD § contract rules; `.claude/rules/fieldbus-readonly.md`).

Export once:

```bash
export RELAY="https://relay.staging.factorylm.com"    # staging relay base URL
export HMAC="$(doppler secrets get MIRA_IGNITION_HMAC_KEY --project factorylm --config stg --plain)"
export TENANT="<the staging tenant UUID this rig belongs to>"
export STG="$(doppler secrets get NEON_DATABASE_URL --project factorylm --config stg --plain)"
```

---

## Confidence floor before any infra — the no-infra proofs already pass

Run these first; they gate whether staging validation is worth scheduling.
**All green as of PR 3.**

```bash
cd mira-relay && python3 -m pytest tests/ -q          # 219 passed
cd .. && python3 -m pytest tests/test_architecture.py -q   # 13 passed (Contract 5)
ruff check mira-relay/
```

In particular `mira-relay/tests/test_factorylm_snapshot.py` proves, with zero infra:

- the seeded path accepts **every** tag (`accepted == len(tags)`, `rejected == []`);
- the **un-seeded** path rejects every tag (`not_allowlisted`) — the failure mode this
  runbook's step 1 exists to prevent;
- the publisher's HMAC headers verify against the real `auth.verify_hmac`;
- UNS identity comes from the seeded `uns_path`, never the envelope's `proposed_uns_path`.

---

## Step 1 — seed `approved_tags` FIRST (this is the prerequisite, not a follow-up)

The allowlist is **fail-closed with no permissive mode**. Skip this step and a perfectly
valid snapshot is accepted with **`accepted=0`, every tag `rejected`, nothing stored** —
HTTP 200, no error in any log. The integration looks wired end-to-end and delivers
nothing, and every downstream check passes vacuously against an empty overlay. Seed
before you publish, and verify the count.

```bash
# 1a. Confirm the schema is present (read-only). approved_tags is migration 035;
#     landing also needs 020/033/036.
psql "$STG" -c "SELECT to_regclass('public.approved_tags'), to_regclass('public.tag_events'), to_regclass('public.live_signal_cache');"

# 1b. Apply the seed (staging), substituting the tenant placeholder.
sed "s/__TENANT_ID__/$TENANT/g" tools/seeds/approved_tags_factorylm_conv_simple.sql | psql "$STG"
#     …or via the gated workflow (preferred — dry-run first):
#     gh workflow run apply-approved-tags.yml -f target=staging \
#       -f seed=approved_tags_factorylm_conv_simple -f tenant_id="$TENANT" -f mode=dry-run
#     then re-run with -f mode=apply

# 1c. Verify the row count.
psql "$STG" -c "SELECT count(*) FROM approved_tags WHERE source_system='plc_bridge' AND tenant_id='$TENANT'::uuid AND enabled;"
```

**Expected:** 1a returns three non-null regclasses. 1b prints `INSERT 0 7` (first run) or
`INSERT 0 0` + `UPDATE 7` on re-run (idempotent). 1c returns **7**.

**Failure modes:**
- `relation "approved_tags" does not exist` → migration `035` not applied. Apply
  `020/033/035/036` via `apply-migrations.yml` (`dry-run` → `apply`), then retry.
- `type "ltree" does not exist` → migration 035 didn't run (it creates the extension).
- `permission denied for table approved_tags` → applying as `factorylm_app`; apply seeds
  as the migration role (seeding is a privileged op).
- count ≠ 7 → partial apply, or the tenant substitution didn't happen (check for a
  literal `__TENANT_ID__` row).

**Rollback/recovery:** the seed is additive + idempotent; re-apply is safe. To remove
(staging only): `DELETE FROM approved_tags WHERE source_system='plc_bridge' AND tenant_id='$TENANT'::uuid;`
No telemetry is affected — `approved_tags` is an allowlist, not data.

---

## Step 2 — publish one snapshot over the existing authorized ingress

There is no FactoryLM-specific endpoint, by law (`.claude/rules/one-pipeline-ingest.md`).
The publisher decodes the envelope and calls the canonical contract.

```bash
curl -fsS "$RELAY/health" ; echo    # 2a

# 2b. Publish the shared contract fixture through the real publisher.
MIRA_RELAY_URL="$RELAY" MIRA_HMAC_KEY="$HMAC" MIRA_TENANT="$TENANT" python3 - <<'PY'
import json, os, sys
sys.path.insert(0, "mira-relay")
from factorylm_snapshot import FactoryLMSnapshotPublisher

snapshot = json.load(open("contracts/machine_snapshot/snapshot_v1_valid.json"))
pub = FactoryLMSnapshotPublisher(
    os.environ["MIRA_RELAY_URL"],
    tenant_id=os.environ["MIRA_TENANT"],
    hmac_key=os.environ["MIRA_HMAC_KEY"],
)
print("published:", pub.publish(snapshot))
PY
```

**Expected:** 2a → `{"status":"ok","service":"mira-relay"}`. 2b prints `published: True`
and the relay log line shows
`tags_ingest tenant=<TENANT> source=plc_bridge accepted=7 rejected=0 cache_skipped=0 sim=False`.

> The fixture and the seed both carry the full **7**-tag `conv_simple.*` set as of
> #3058 — so `accepted` should equal 7 exactly, not "at least some". Anything less
> means a tag is missing from the seed.

**Failure modes:**
- `accepted=0 rejected=7 reason=not_allowlisted` → **step 1 was skipped, or seeded under a
  different tenant/source_system.** This is the headline failure mode; re-run step 1
  against the SAME tenant the publisher signs with.
- 401 `signature_mismatch` → `$HMAC` ≠ the relay's `MIRA_IGNITION_HMAC_KEY`. Confirm both
  read the same Doppler `factorylm/stg` value.
- 401 `bad_timestamp` → clock skew > 300 s; sync NTP.
- `invalid_source_system` → the envelope claims something other than `plc_bridge`
  (`VALID_SOURCE_SYSTEMS`). FactoryLM identity belongs in `provenance.producer`.
- `published: False` with `invalid snapshot` in the log → the envelope failed the
  contract check before any POST. Diff it against `contracts/machine_snapshot/`.

**Rollback/recovery:** none needed. See step 5 to clean landed rows if desired.

---

## Step 3 — the HMAC tenant is authoritative

A caller-supplied envelope `tenant_id` must never become the ingest tenant.

```bash
psql "$STG" -c "SELECT tenant_id, count(*) FROM tag_events WHERE source_system='plc_bridge' GROUP BY 1;"
```

**Expected:** only `$TENANT` appears. The publisher omits the body tenant entirely on the
HMAC path (`test_hmac_path_omits_the_body_tenant`), and `relay_server.tags_ingest` prefers
the HMAC tenant regardless (`tenant_id = hmac_tenant or payload.get("tenant_id")`).

**Failure modes:** a second tenant appears → another `plc_bridge` feed is running, or the
relay is in legacy-bearer mode (`RELAY_LEGACY_BEARER=1`) and trusting body tenants. Run
the relay **without** legacy bearer for this proof.

---

## Step 4 — normalization agrees with the authoritative implementation

The fail-closed invariant: a seeded `normalized_tag_path` that differs from what the relay
computes for live traffic means silent rejection.

```bash
python3 -m pytest mira-relay/tests/test_factorylm_snapshot.py::test_seed_covers_every_canonical_tag_in_the_fixture -q

psql "$STG" -c "
  SELECT count(*) AS mismatches FROM approved_tags
   WHERE source_system='plc_bridge' AND tenant_id='$TENANT'::uuid
     AND normalized_tag_path IS DISTINCT FROM
         regexp_replace(lower(source_tag_path), '[^a-z0-9]+', '_', 'g');"
```

**Expected:** the pytest passes (it calls the real `tag_ingest.normalize_tag_path`); the
SQL returns `mismatches = 0`. Trust the pytest over the SQL — the regex here doesn't trim
leading/trailing `_`, which the Python normalizer does.

---

## Step 5 — state lands where PR 4 will read it

```bash
psql "$STG" -c "
  SELECT count(*), count(DISTINCT tag_path), bool_and(simulated) AS all_sim
    FROM tag_events WHERE source_system='plc_bridge' AND tenant_id='$TENANT'::uuid;"

psql "$STG" -c "
  SELECT plc_tag, latest_quality, freshness_status, uns_path, updated_at
    FROM live_signal_cache WHERE tenant_id='$TENANT'::uuid AND source_system='plc_bridge'
   ORDER BY plc_tag;"
```

**Expected:** `tag_events` grows by 7 per published snapshot (append-only) with
`all_sim = false` — a `plc_bridge` batch is real telemetry, so it can never be clobbered
by a simulated cache row. `live_signal_cache` holds exactly 7 rows, one per tag, each with
`uns_path = enterprise.home_garage.conveyor_lab.conveyor_1` **resolved from the seed** —
not from the envelope's `proposed_uns_path`, which is provenance only.

Publishing the same snapshot twice is deterministic: `tag_events` doubles, cache row count
is unchanged (`test_duplicate_snapshot_is_deterministic`).

**This is the state PR 4 reads back at turn time.** `ingest_batch` persists; it never
hands a request-scoped snapshot to the engine, and the ingest POST and a technician's turn
are unrelated requests (PRD PR 4 amendment). Freshness for the overlay must come from the
stored `event_timestamp`, never `now()`.

**Rollback/recovery (staging only):**
```bash
psql "$STG" -c "DELETE FROM tag_events WHERE source_system='plc_bridge' AND tenant_id='$TENANT'::uuid;"
psql "$STG" -c "DELETE FROM live_signal_cache WHERE source_system='plc_bridge' AND tenant_id='$TENANT'::uuid;"
```

---

## Promotion to prod

Only after every step above is green on staging, and only via the gated workflow — never
psql against prod, never seed prod first:

```bash
gh workflow run apply-approved-tags.yml -f target=prod \
  -f seed=approved_tags_factorylm_conv_simple -f tenant_id="<prod tenant UUID>" -f mode=dry-run
# review the plan, then re-run with -f mode=apply
```

**As of PR 3 this seed has been applied to NO environment.** It ships as a file plus this
runbook; applying it is a deliberate, separately-authorized operator step.
