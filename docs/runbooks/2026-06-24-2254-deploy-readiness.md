# #2254 deploy-readiness — SimLab→UNS ingest lane

**Status:** release package for PR #2254 (`feat/cappy-hour-import-engine` → main, VERSION `3.40.0`).
**Key property:** the ingest lane is **runtime-inert by default** and ships **no schema migration**.
Deploying #2254 changes the relay's *code* (a behavior-identical `ingest_contract` refactor + an
**opt-in** SimLab publisher + tests/docs) but **not its default behavior**. Turning the SimLab→relay
HTTP feed *on* is a deliberate env-flag action.

---

## 7. Deploy / runtime requirements

### 7a. Required env vars

**Relay landing side** (`mira-relay`, the receiver — unchanged endpoint `POST /api/v1/tags/ingest`):

| Var | Required? | Purpose | Default |
|---|---|---|---|
| `NEON_DATABASE_URL` | **yes** | NeonDB the relay writes `tag_events` + `live_signal_cache` to | — (already set in saas) |
| `MIRA_IGNITION_HMAC_KEY` | **yes for HMAC** | the key the relay verifies inbound `X-MIRA-Signature` against | `""` (empty ⇒ HMAC disabled) |
| `RELAY_LEGACY_BEARER` | no | `=1` to also accept legacy `Authorization: Bearer` (migration-only) | `0` (off) |
| `RELAY_API_KEY` | no | the bearer value, only when `RELAY_LEGACY_BEARER=1` | `""` |
| `RELAY_PORT` | no | listen port | `8765` |

**SimLab emit side** (`python -m simlab`, the producer — **the master switch is `SIMLAB_RELAY_URL`**):

| Var | Required? | Purpose | Default |
|---|---|---|---|
| `SIMLAB_RELAY_URL` | **off by default** | **enable flag** — set to the relay base URL to stream every `advance()` to `/api/v1/tags/ingest`. **Unset ⇒ no publisher attached ⇒ byte-for-byte prior behavior.** | `""` (disabled) |
| `SIMLAB_RELAY_HMAC_KEY` | for HMAC mode | must **equal** the relay's `MIRA_IGNITION_HMAC_KEY` | `""` |
| `SIMLAB_RELAY_API_KEY` | for bench bearer | bearer value (needs relay `RELAY_LEGACY_BEARER=1`) | `""` |
| `SIMLAB_RELAY_TENANT_ID` | no | override the tenant; defaults to the reserved `SIMLAB_TENANT_ID` | `00000000-0000-0000-0000-000000515ab1` |
| `SIMLAB_MQTT_HOST` / `_PORT` | no | **separate** MQTT emit path (not the HTTP relay path); unrelated to this lane | `""` / `1883` |

### 7b. HMAC key config
- HMAC is the production-shaped auth: SimLab signs the four `X-MIRA-*` headers over the exact body
  bytes; the relay verifies with `MIRA_IGNITION_HMAC_KEY`. **The two keys must match.**
- **Gap to close before a real staging relay:** `factorylm/stg` has **no `MIRA_IGNITION_HMAC_KEY`**
  (prod does). Set it in `factorylm/stg` and use the same value as `SIMLAB_RELAY_HMAC_KEY`. (The 8/8
  validation proved the HMAC *contract* with a self-chosen test key on both sides; production uses
  the Doppler-managed key.)
- Bench fallback: `RELAY_LEGACY_BEARER=1` + matching `RELAY_API_KEY`/`SIMLAB_RELAY_API_KEY`; the
  tenant then rides in the request body. HMAC is the durable path.

### 7c. Relay enable flags
- **`SIMLAB_RELAY_URL` is the single enable flag for this lane.** Unset = the SimLab→relay HTTP feed
  is OFF and SimLab behaves exactly as before (the publisher is never attached in `build_app`).
- The relay's `/api/v1/tags/ingest` endpoint itself is **unchanged** by #2254 — it already existed;
  #2254 only refactored the normalizer into `ingest_contract` (behavior-identical, identity-tested).

### 7d. Tenant behavior
- **HMAC mode:** the `X-MIRA-Tenant` header is **authoritative** — a caller-supplied body `tenant_id`
  can never override it (`relay_server.tags_ingest`).
- **Bench bearer mode:** the relay falls back to `payload["tenant_id"]` (only when no HMAC header).
- **SimLab default:** the reserved `SIMLAB_TENANT_ID` unless `SIMLAB_RELAY_TENANT_ID` overrides it.
- **Fail-closed allowlist:** a tag whose normalized path is not in `approved_tags` for
  `(tenant, source_system)` is **rejected, never stored**. SimLab's allowlist seed is
  `tools/seeds/approved_tags_simulator.sql` (apply per-tenant; not auto-applied at deploy).

### 7e. Failure behavior if the relay is down
- **`RelayIngestPublisher.publish` is best-effort** — any error (connection refused, 5xx, timeout) is
  **logged and swallowed, never raised**. The sim keeps advancing; no tick is blocked. (Proven by
  staging validation step 7: dead relay → `advance(5)` still ticks to 5.)
- **Atomic landing:** `tag_events` + `live_signal_cache` are written in one transaction; if the cache
  write fails, the events are not committed either → no partial rows on retry.
- **Provenance safety:** a `simulated` reading never overwrites a real cache row (the event is still
  recorded; the cache update is skipped).

---

## 8. Rollback plan

### 8a. Disable SimLab relay emit (instant, no redeploy)
**Unset `SIMLAB_RELAY_URL`** (or stop passing it) on the SimLab side. The publisher is not attached →
SimLab reverts to byte-for-byte prior behavior. No relay change, no DB change. This is the kill-switch.

### 8b. Revert the deploy
- **#2254 ships no migration and is runtime-inert by default**, so a revert is low-risk:
  `git revert -m 1 <merge-commit>` (or redeploy the previous image tag) and redeploy the affected
  services. The relay change is a behavior-identical `ingest_contract` refactor — reverting it simply
  restores the inline normalizer; the endpoint behavior is unchanged either way.
- Affected services if redeployed: `mira-relay` (gains `ingest_contract.py` via the Dockerfile COPY).
  No other prod service's runtime behavior changes.

### 8c. Database changes involved
- **NONE from the #2254 deploy.** #2254 contains **no `mira-hub` migration** (migration 057 was
  *closed*; the seed is not auto-applied). Prod `tag_events`/`approved_tags` are **already canonical**
  and were **not touched** this session.
- The **staging R1 reconciliation** (drop+recreate the two empty, orphaned staging tables from
  canonical 033/035) was a **separate, staging-only** operation — *not* part of the #2254 deploy and
  *not* applied to prod. Its rollback (if ever needed) is trivial (empty tables; schema snapshot in
  the transcript) and is documented in `docs/plans/2026-06-24-ingest-schema-reconciliation-plan.md`.
- So: **deploying or reverting #2254 requires no schema migration and no data migration.**

---

## Pre-deploy checklist
- [ ] (only when standing up a real staging relay) set `MIRA_IGNITION_HMAC_KEY` in `factorylm/stg`.
- [ ] Apply `tools/seeds/approved_tags_simulator.sql` per target tenant **before** turning on
      `SIMLAB_RELAY_URL` (else fail-closed rejects every tag).
- [ ] Confirm relay `NEON_DATABASE_URL` points at the intended env (never feature-branch → prod).
- [ ] Leave `SIMLAB_RELAY_URL` **unset** in any environment that should not stream sim data.

## Cross-references
- `docs/plans/2026-06-22-simlab-uns-ingest-roadmap.md` — the lane roadmap.
- `docs/runbooks/2026-06-23-simlab-relay-ingest-staging-validation.md` — the 8-step validation.
- `docs/plans/2026-06-24-ingest-schema-reconciliation-plan.md` — staging drift fix + 8/8 result.
- `.claude/rules/one-pipeline-ingest.md` — the conformance law (Contract 5 guard).
- `simlab/api.py` (`build_app` env-gating), `simlab/publishers.py` (`RelayIngestPublisher`),
  `mira-relay/relay_server.py` + `tag_ingest.py` + `ingest_contract.py` (landing).
