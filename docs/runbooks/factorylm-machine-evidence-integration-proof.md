# FactoryLM Machine-Evidence Integration Proof (PRD #3048, PR 5)

**Status:** in-process proof EXECUTABLE and green (2026-08-02); supervised live probe NOT yet run.
**Scope:** the "controlled integration proof" slice — a verification runbook + harness, not an
implementation bundle. Implementation lives in PRs 1–4.
**Harness:** `tests/integration/test_machine_evidence_proof.py` (hermetic — no network, no DB).

## What this proves, and what it deliberately does not

The PRD requires seven proof points. Each has an **in-process half** (the real merged modules
chained end-to-end in one interpreter, against the shared cross-repo fixtures) and, for points
2 and 5, a **live half** (deployed relay + staging bot) that runs only as the supervised probe
below. Per the PRD: none of this may be called **"production proven"** — the live probe is a
staging exercise, supervised, one deployment-affecting change at a time.

## Dependency state (as of 2026-08-02)

| Piece | Where | State |
|---|---|---|
| PR 1 — contract adapter + `augment_with_live` | MIRA #3052 | ✅ merged (`fe281a67c`) |
| Shared fixtures, 7-tag sync | MIRA #3058 / factorylm #198 | ✅ merged, byte-identical |
| Contract boundary enforcement | MIRA #3060 | ✅ merged |
| PR 2 — FactoryLM canonical producer | factorylm #197 + #198 | ✅ merged (`74a5d52`, `4521224`) |
| PR 3 — ingress transport + seed file | MIRA #3059 | ✅ merged (`0c75c1ae9`) |
| PR 4 — serving path (`factorylm_live`, `MIRA_FACTORYLM_LIVE`) | MIRA #3061 | 🟡 OPEN |
| `approved_tags` seeded in staging | `apply-approved-tags.yml` | ❌ not applied (verify before live probe) |
| MIRA #3046 (WebDev incident) | — | ✅ resolved (v3.239.1) — PR 5 precondition met |

## Proof matrix

| # | PRD proof point | In-process (harness class) | Live half |
|---|---|---|---|
| 1 | FactoryLM simulated canonical snapshot | `TestStep1CanonicalSnapshot` — the shared fixture IS the producer corpus (byte-identical across repos); the seed file is pinned to the same 7-tag vocabulary | bench `ModbusTagSource.tick()` → `build_machine_snapshot_envelope` (factorylm, merged) |
| 2 | Existing authorized ingress accepts it | `TestStep2IngressAccepts` — `snapshot_to_ingest_batch` → `ingest_batch` over the REAL seed rows; `accepted == 7 AND rejected == []`, plus the unseeded-allowlist loud-failure pin and duplicate determinism | HMAC POST to staging `/api/v1/tags/ingest` (probe step 3) |
| 3 | MIRA builds `TechnicianContext.live` | `TestStep3OverlayBuilt` — PR 1 adapter over the fixture (6 live + 1 stale) | probe step 5 |
| 4 | Prompt projection and saved manifest agree | `TestStep4OneContextOneManifest` — ONE ctx re-validated, `manifest_of` deterministic, live family in the manifest equals the adapter overlay, hash changes only when context changes | `decision_traces` manifest vs rendered prompt (probe step 5) |
| 5 | A diagnostic answer uses the live evidence | `TestStep5ServedBackAtTurnTime` — ingested rows → `overlay_from_cache_rows` → same ctx/manifest (activates when #3061 merges; verified green against a scratch-merge of #3061) | probe step 5: a staging bot answer citing live values with timestamp/quality caveats |
| 6 | Malformed/unauthorized/stale fail safely | `TestStep6FailSafeControls` — contract refusal, observable tag rejections, base-ctx immunity, wrong-tenant allowlist denial, wrong `source_system` denial, HMAC fail-closed, stale never becomes live | probe step 6 |
| 7 | No PLC/CMMS/KG/control write | `TestStep7NoWrites` — source sweep + loaded-module sweep + observation-only envelope walk | probe runs read-only end to end |

Run it:

```bash
pytest tests/integration/test_machine_evidence_proof.py -q
# today (main):            20 passed, 3 skipped (PR-4-gated)
# with #3061 merged:       23 passed
```

The three skips are `importorskip("shared.factorylm_live")` — they turn on by themselves the
moment #3061 lands. Do not remove the skips; they are the dependency declaration.

## Supervised live probe (staging) — DO NOT run unattended

Preconditions: #3061 merged and deployed to staging; Mike supervising; one deploy-affecting
change at a time (no concurrent smoke).

**Two environment facts this probe design honors** (verified 2026-08-02):

- **Staging runs NO relay.** `docker-compose.staging-vps.yml` excludes mira-relay by design;
  the relay exists only in `docker-compose.saas.yml` (prod, tailnet-only + HMAC). So the probe
  runs the relay **locally on the PLC laptop**, pointed at the **staging Neon branch**
  (`doppler run -p factorylm -c stg -- uvicorn relay_server:app` from `mira-relay/`). Staging
  is the safe-to-break env; the prod relay is not touched.
- **The staging bot's tenant is the slug `"staging"` (`MIRA_TENANT_ID`), but every table in
  this path is UUID-keyed** (`approved_tags.tenant_id UUID NOT NULL`; `fetch_live_signal_cache`
  casts `:tid::uuid`). A slug tenant cannot be seeded and reads zero cache rows by
  construction. The probe therefore needs the staging bot redeployed with
  `MIRA_TENANT_ID=<staging UUID tenant>` (e.g. the quickstart tenant already present in
  Doppler stg) for the probe window — **Mike's call**, because staging KB scoping keyed to the
  slug may be affected. Revert after the probe if anything else on staging misbehaves.

1. **Seed staging allowlist** (gated dispatch): `apply-approved-tags.yml` with
   `target=staging`, `seed=approved_tags_factorylm_conv_simple`, `tenant_id=<staging UUID>`,
   `mode=dry-run` first, then `apply`. Verify via `db-inspect.yml` (read-only): 7 rows,
   `source_system='plc_bridge'`, normalized paths match `normalize_tag_path` output.
2. **Enable flags on the staging bot** (Doppler `factorylm/stg`): `MIRA_CONTEXT_CONTRACT=1`,
   `MIRA_FACTORYLM_LIVE=1`, and the UUID tenant per above. Redeploy staging bot via
   `deploy-staging` with `services=mira-bot-telegram`.
3. **Publish one real bench snapshot** from the PLC laptop (this machine — the only node with
   the Micro820 + GS10 bench). In the factorylm repo:
   `ModbusTagSource.tick()` → `build_machine_snapshot_envelope(...)` →
   `FactoryLMSnapshotPublisher(relay_url=http://127.0.0.1:<port>, tenant_id=<staging UUID>, hmac_key=<Doppler stg INBOUND_HMAC_SECRET>)`
   against the locally-run relay from the precondition note. Expect
   `accepted=7, rejected=[]`. `accepted=0` means the seed is missing (step 1 failed) — stop
   and fix, do not proceed.

   Note the two unsourced tags (`height_sensor_mm`, `sort_divert_active`) arrive
   `quality=uncertain` by design — the bench map has no such I/O and the producer refuses to
   claim `good` for values it never read (factorylm `19b44e2`).
4. **Verify persistence** (read-only `db-inspect.yml`): 7 `tag_events` rows + 7
   `live_signal_cache` rows under `enterprise.home_garage.conveyor_lab.conveyor_1`,
   `simulated=false`, `event_timestamp` = the snapshot's `captured_at` (never `now()`).
5. **Ask the staging bot** (`@Mira_stagong_bot`) an asset-specific question for the confirmed
   bench asset. Verify: the answer includes a `[LIVE MACHINE STATE (FactoryLM)]` block, cites
   values with timestamp/quality caveats, does NOT also render the legacy
   `[LIVE EQUIPMENT STATUS]` block, and the stored `decision_traces` manifest's `live` family
   matches the prompt's live block (same context object — G6).
6. **Control cases:** repeat step 3 with (a) a tampered `source_system` → relay rejects; (b) a
   wrong HMAC key → 401; (c) wait past the staleness bound and re-ask → tags render `stale`,
   answer still completes. A failed control is a stop-ship finding, not a footnote.
7. **Record results** in this file (date, commit SHAs, relay responses, manifest hash) and post
   the evidence on MIRA #3048. Then — and only then — the PRD's Phase-1 DoD line "integration
   proof documented, reproducible" is satisfied. Still not "production proven": prod flags stay
   off until Mike decides.

## Known deltas the proof must not paper over

- The merged PR 4 reader is **identity-strict**: every cache row must carry the persisted
  `metadata.factorylm_snapshot` (as `properties`) with one consistent snapshot identity, plus
  the source `tag_events.event_timestamp` — otherwise it fails open (`None`) rather than
  relabeling generic cache data as FactoryLM evidence. `machine_state`/`active_conditions` are
  served from that stored metadata (the earlier "served state is unknown" delta is closed);
  `observed_at` is the source observation timestamp, never the cache's server-receipt
  `last_seen_at`. The harness pins all of this in `TestStep5ServedBackAtTurnTime`.
- Freshness vocabularies differ by layer (ingest `{good,bad,stale,uncertain}` vs overlay
  `{live,stale,simulated,unknown}`); both mappings only ever downgrade. The harness pins the
  boundary cases (stale→STALE, unknown quality never `good`, metadata-less rows → no overlay).
