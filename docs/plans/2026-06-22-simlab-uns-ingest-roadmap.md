# SimLab → real UNS ingest roadmap / runbook

**Status:** reference doc (2026-06-22; **updated 2026-06-23** — Lanes 1 & 2 landed). **Scope:** the full
*emit → land → UNS-map → consume* pipeline that turns SimLab's deterministic factory into live,
UNS-addressed data in NeonDB — what is **done**, what is **needed**, who owns which **work-tree lane**,
and the **infra/ops** steps to stand it up.

> **Update 2026-06-23 — the HTTP relay path is now turnkey (Gaps A/B/C closed, no infra).**
> Lane 1 (`fc5790f7`): `RelayIngestPublisher` is wired into `build_app` (env-gate `SIMLAB_RELAY_URL`)
> and now carries a tenant + HMAC auth (production-shaped, tenant authoritative) or bench bearer.
> Lane 2 (`03971bbc`): `tools/seeds/gen_approved_tags_simulator.py` emits the 89-row `simulator`
> allowlist against the reserved `SIMLAB_TENANT_ID`, cross-checked against the real relay normalizer.
> **Remaining is infra** (apply the seed + run the relay/NeonDB; §6) and the strategic MQTT subscriber
> (Lane 3). To land SimLab data now: apply `tools/seeds/approved_tags_simulator.sql` (staging), run
> `mira-relay`, then `SIMLAB_RELAY_URL=$RELAY SIMLAB_RELAY_HMAC_KEY=… python -m simlab` + advance.

**Companions:** `docs/plans/2026-06-22-proveit-factory-import-implementation-plan.md` (the Phase 0–6
spine this maps to), `docs/plans/2026-06-22-proveit-2027-demo-runbook.md`, `docs/RESUME_2026-06-22_proveit-buildout.md`,
`docs/simlab/README.md`. This doc is **documentation only** — the gaps it names are other agents' bricks.

---

## TL;DR — the thesis

There are **two landing paths** from SimLab to a UNS-mapped store, and they **share one landing table**
(`live_signal_cache`, a.k.a. `current_tag_state`):

1. **HTTP relay path — ~90% built, one wire missing.** `SimEngine.advance()` →
   `RelayIngestPublisher` → `POST /api/v1/tags/ingest` → allowlist-gated normalize → `tag_events`
   (raw stream) + `live_signal_cache` (latest, UNS-mapped). Everything exists **except** the publisher
   is never attached in `build_app`, its auth/tenant handling is incomplete, and the `simulator`
   allowlist isn't seeded. **This is the shortest path to "SimLab data landed against a UNS."**
2. **MQTT pub/sub path — emit-only.** `MqttPublisher` (env-gated, built) streams every tick to a
   broker, but **no subscriber lands it back**. This is also the **foreign-feed shape** — how a real
   factory's Ignition/Sparkplug UNS would arrive. The subscriber is the strategic, not-yet-built piece.

Live values **already reach a cited diagnosis** on the Hub `/api/mira/ask` surface (it reads
`live_signal_cache` today), and the **engine's live-tag contract is built and exercised** — both
`simlab/observe/harness.py` (`LiveAnswerer`) and `tests/simlab/runner.py` preseed a direct-connection
`uns_context` + `tag_state` and call `process_full`. The remaining read-side gaps are the Command
Center **numeric value panel** and the **production bridge** that fills that engine state from
`live_signal_cache` (instead of a scenario preseed).

**SimLab owns a reserved tenant** — `SIMLAB_TENANT_ID = 00000000-0000-0000-0000-000000515ab1`
(`simlab/__init__.py`). Its docs are already seeded under it (`tools/seeds/seed-simlab-docs.py`) and the
scenario runner binds the Supervisor to it, so the **SimLab self-feed does NOT need the proveit tenant** —
point the `simulator` allowlist + ingest at `SIMLAB_TENANT_ID`. (The proveit tenant is the Cappy-Hour
*import* corpus — a separate concern.)

```
                         SimEngine.advance(ticks)            simlab/engine.py:139-173  ✅
                                  │ publish_snapshot()       simlab/engine.py:175-211  ✅
                 ┌────────────────┴─────────────────┐
                 ▼                                  ▼
        MqttPublisher                       RelayIngestPublisher
   simlab/publishers.py:139-203  ✅    simlab/publishers.py:209-242  🟡 class built, NOT attached
   env SIMLAB_MQTT_HOST (api.py:74)         (no env-gate in build_app; bearer auth, no tenant)
                 │ plain MQTT + JSON                │ POST /api/v1/tags/ingest
                 ▼                                  ▼
        broker (Mosquitto/Flexware)        mira-relay  relay_server.py:385 → tag_ingest.py:172  ✅
                 │                            ├─ auth (HMAC / legacy bearer)   auth.py  ✅ / 🟡
        ❌ NO SUBSCRIBER                      ├─ approved_tags allowlist + normalize_tag_path  ✅ / ❌ no sim seed
        (mira-relay/mqtt_ingest               ├─ tag_events append   mig 033  ✅
         / mira-connect = spec-only)          └─ live_signal_cache upsert (+cache-protection)  mig 020/036  ✅
                 │                                  │
                 └──────────────►  (would land here too) ──┐
                                                            ▼
                                              live_signal_cache  (UNS-mapped latest value)
                                                            │
              ┌──────────────────────────────┬─────────────┴───────────────┬───────────────────────┐
              ▼                               ▼                             ▼                       ▼
   Command Center tree freshness   Hub /api/mira/ask cited answer   Command Center value panel   mira-pipeline
   tree/route.ts:141-158  ✅       mira/ask route.ts:218-344  ✅      page.tsx:556-631  ❌ Phase4   Supervisor live_tags ❌ P3-4
```

---

## 1. Done-vs-Needed matrix (the centerpiece)

Legend: ✅ built · 🟡 partial/needs-wiring · ❌ not built (TODO).

| Hop | Component | Status | Citation |
|---|---|---|---|
| emit | `SimEngine.advance()` pushes a snapshot to attached publishers | ✅ | `simlab/engine.py:139-173` |
| emit | `snapshot()` → `list[Reading]` (carries `uns_path`, ts, quality) | ✅ | `simlab/engine.py:180-211`, `simlab/models.py:164-190` |
| emit | `MqttPublisher` (async aiomqtt, best-effort) | ✅ | `simlab/publishers.py:139-203` |
| emit | MQTT opt-in via `SIMLAB_MQTT_HOST`/`SIMLAB_MQTT_PORT` | ✅ | `simlab/api.py:74-84` |
| emit | `RelayIngestPublisher` (POST to relay, `source_system="simulator"`) | ✅ wired into `build_app` (`SIMLAB_RELAY_URL`) | `simlab/publishers.py`, `simlab/api.py` (`fc5790f7`) |
| emit | `Reading.to_ingest_tag()` → `{tag_path=uns_path, value, value_type, quality, ts}` | ✅ | `simlab/models.py:182-190` |
| land | relay route `POST /api/v1/tags/ingest` | ✅ | `mira-relay/relay_server.py:385`, `mira-relay/tag_ingest.py:172-271` |
| land | HMAC auth (`X-MIRA-Signature`, tenant authoritative) | ✅ | `mira-relay/auth.py` |
| land | SimLab→relay auth/tenant | ✅ HMAC (tenant authoritative) or bench bearer + body tenant | `simlab/publishers.py` (`fc5790f7`) |
| land | `approved_tags` allowlist table + `normalize_tag_path()` | ✅ table / ✅ `simulator` seed generated (89 rows) | `tools/seeds/gen_approved_tags_simulator.py`, `…/approved_tags_simulator.sql` (`03971bbc`) |
| land | UNS resolved from allowlist row's `uns_path` (fail-closed) | ✅ | `mira-relay/tag_ingest.py:193-210` |
| land | `tag_events` append (raw stream) | ✅ | `mira-relay/tag_ingest.py:393-413`, mig `033` |
| land | `live_signal_cache` upsert + sim-never-overwrites-real | ✅ | `mira-relay/tag_ingest.py:251-265,418-460`, mig `020`+`036` |
| land | MQTT **subscriber** (topic→UNS→`persist_batch`) for the foreign feed | ❌ spec-only | `docs/mira-ignition-secure-architecture.md §D11`; `mira-relay/mqtt_ingest/` / `mira-connect` absent |
| read | Command Center tree freshness (dots + rollup) | ✅ | `mira-hub/src/app/api/command-center/tree/route.ts:141-158`, `src/lib/command-center-freshness.ts` |
| read | Hub `/api/mira/ask` injects cited "Current signal state" from cache | ✅ | `mira-hub/src/app/api/mira/ask/route.ts:218-344` |
| read | i3x typed current-value / history read layer | ✅ | `mira-hub/src/lib/i3x/value.ts`, `src/lib/i3x/data-access.ts` |
| read | Command Center **numeric value panel + sparkline** | ❌ Phase 4 (right pane is a handoff link) | `mira-hub/src/app/(hub)/command-center/page.tsx:556-631` |
| read | Engine **consumes live tags** via direct-connection preseed (`uns_context.source="direct_connection"` + `tag_state` in `session_context` → `process_full`) | ✅ contract built + tested | `simlab/observe/harness.py` (`LiveAnswerer`), `tests/simlab/runner.py` |
| read | **Production bridge**: `live_signal_cache` → that same engine state (vs a scenario preseed) | 🟡 only the prod feed is missing | `mira-pipeline/`, `.claude/rules/direct-connection-uns-certified.md` |

---

## 2. The UNS mapping rules (how a tag becomes a real UNS path)

- **SimLab's canonical UNS is dot-ltree:**
  `enterprise.florida_natural_demo.plant1.juice_bottling.line01.<asset>.<category>.<tag>`
  (lowercase, slugged) — `simlab/uns.py:59-72`. Example:
  `enterprise.florida_natural_demo.plant1.juice_bottling.line01.filler01.process.fill_level_oz`.
- **MQTT projection** PascalCases the structural segments, keeps `<category>/<tag>` verbatim
  (`simlab/uns.py:82-97`): →
  `FactoryLM/FloridaNaturalDemo/Plant1/JuiceBottling/Line01/Filler01/process/fill_level_oz`,
  payload `{"value":…,"ts":…,"source":"simulator"}` (**plain MQTT + JSON, not Sparkplug B**).
- **Landing resolves the UNS from the allowlist, NOT from the reading's own `uns_path`.** The relay
  `normalize_tag_path(tag_path)` (lowercase, non-alnum→`_`) → matches `approved_tags.normalized_tag_path`
  → takes **that row's `uns_path`** (`tag_ingest.py:193-210`). **Fail-closed:** an unlisted tag is
  rejected and never stored. So mapping SimLab to a real UNS = **seed `approved_tags` for
  `source_system='simulator'`**, one row per SimLab tag.
- **Provenance guarantee:** `simulated` is derived **once per batch** from `source_system=='simulator'`
  (never per-row), and a simulated reading **never overwrites a real** cache row — the event is still
  recorded, the cache update is skipped (`tag_ingest.py:251-265`). This is what lets SimLab and real
  data coexist safely against the same tenant.

**Worked allowlist row** (model on `tools/seeds/approved_tags_conveyor.sql`):

```sql
INSERT INTO approved_tags
  (tenant_id, source_system, source_tag_path, normalized_tag_path, uns_path, enabled, notes)
VALUES
  ('00000000-0000-0000-0000-000000515ab1'::uuid, 'simulator',  -- SIMLAB_TENANT_ID (reserved)
   'enterprise.florida_natural_demo.plant1.juice_bottling.line01.filler01.process.fill_level_oz',
   'enterprise_florida_natural_demo_plant1_juice_bottling_line01_filler01_process_fill_level_oz',
   'enterprise.florida_natural_demo.plant1.juice_bottling.line01.filler01.process.fill_level_oz'::ltree,
   true, 'SimLab juice line — filler fill level');
```

> Generate the seed programmatically from `SimEngine.snapshot()` (every `Reading.uns_path` →
> `normalize_tag_path` → same path as `uns_path`) so all ~N line tags land. Keep it tenant-substituted.

---

## 3. The three concrete gaps — ✅ ALL CLOSED (2026-06-23)

- **Gap A — `RelayIngestPublisher` not wired → CLOSED (`fc5790f7`).** `build_app` now attaches it
  env-gated on `SIMLAB_RELAY_URL` (parallel to the MQTT feed), so setting the env streams every
  `advance()` snapshot to the relay. Additive: unset ⇒ no publisher ⇒ prior behavior.
- **Gap B — auth/tenant mismatch → CLOSED (`fc5790f7`).** The publisher now requires a `tenant_id` and
  implements resolution **(i)** — HMAC-signs the four `X-MIRA-*` headers over the exact body bytes
  (posted via httpx `content=`, so the body hash matches), and the relay treats `X-MIRA-Tenant` as
  authoritative. Resolution **(ii)** bench bearer (`RELAY_LEGACY_BEARER=1` + tenant in body) is also
  supported via `SIMLAB_RELAY_API_KEY`. Proven by a real round-trip against `mira-relay/auth.py`.
- **Gap C — no `simulator` allowlist seed → CLOSED (`03971bbc`).** `tools/seeds/gen_approved_tags_simulator.py`
  generates the 89-row seed against the reserved `SIMLAB_TENANT_ID`; `uns_path` mirrors the SimLab path
  (repoint it to remap onto another target subtree). A test pins the generator's normalizer to the
  authoritative `mira-relay/tag_ingest.normalize_tag_path` so the fail-closed match can't silently drift.

---

## 4. ProveIt phase alignment

Maps to `2026-06-22-proveit-factory-import-implementation-plan.md:34-117`:

| Phase | Title | This pipeline's slice |
|---|---|---|
| **0** | Foundation | For the **SimLab self-feed**, the tenant already exists (`SIMLAB_TENANT_ID`); only ensure migrations are applied in the target env. (The `proveit` tenant is for the separate Cappy-Hour *import* corpus.) |
| **3** | CONNECT (live read-only MQTT) | MQTT subscriber (`mira-relay/mqtt_ingest/` or `mira-connect`); topic→UNS normalizer; `live_signal_cache` landing; `approved_tags_flexware`/`_simulator` seed; direct-connection engine bridge (contract already built in `observe/harness.py` + `runner.py`); **no publish** safety audit. |
| **4** | VISUALIZE | Command Center live-value panel + sparkline (`page.tsx` right pane); SimEngine→cache bridge for the demo. |
| **5** | PROVE | Real Supervisor self-scored on the SimLab dashboard (`/simlab/dashboard`, `/simlab/eval/scorecard`); the `_ANSWERERS` registry holds `oracle`+`evidence_only`, the real Supervisor is injected as `answer_fn` from `tests/simlab/supervisor_answerer.py` (staging, not in-package). |

**Open inputs from Mike** (`docs/RESUME_2026-06-22_proveit-buildout.md:71-82`): provision the `proveit`
tenant + run migrations dev→staging→prod; stand up staging Mosquitto/Flexware + point `SIMLAB_MQTT_HOST`;
(optional) a real manual PDF; sponsorship decision.

---

## 5. Parallel-agent work-tree lanes (non-overlapping ownership)

Each lane is a **distinct directory set** so agents can run concurrently without contaminating each
other's tree (per `.claude/rules/session-discipline.md` §3 — scoped commits).

| Lane | Owns (dirs) | Work | Needs infra? | Phase |
|---|---|---|---|---|
| **L1 — SimLab emit** | `simlab/` | ✅ **DONE (`fc5790f7`)** — `RelayIngestPublisher` env-gated into `build_app` (`SIMLAB_RELAY_URL`) + HMAC/bearer + carries tenant; 16 tests incl. real `auth.py` round-trip. Closed Gap A/B. | No | 3 |
| **L2 — seed + schema** | `tools/seeds/`, `mira-hub/db/` | ✅ **DONE (`03971bbc`)** — `gen_approved_tags_simulator.py` → 89-row `approved_tags_simulator.sql`, tenant `SIMLAB_TENANT_ID`; normalizer pinned to the relay's, drift-guarded. Still infra: confirm migs `020/033/035/036` applied + apply the seed (§6). Closed Gap C. | Reserved tenant — no provisioning | 0/3 |
| **L3 — MQTT subscriber** | `mira-relay/mqtt_ingest/` (new) | Read-only aiomqtt subscriber + topic→UNS normalizer (reuse `from_mqtt_topic` semantics) + reuse `NeonTagStore.persist_batch`. The **foreign-feed / Sparkplug** path. **No publish** (`.claude/rules/fieldbus-readonly.md`). | Broker | 3 |
| **L4 — Command Center viz** | `mira-hub/src/app/(hub)/command-center/`, `src/lib/i3x/` | Numeric value panel + sparkline from `live_signal_cache` (reuse `i3x/value.ts`); ISA-101 muted-normal / color-for-abnormal. | Reads landed data | 4 |
| **L5 — engine bridge** | `mira-bots/shared/`, `mira-pipeline/` | Bridge `live_signal_cache` → Supervisor `live_tags` (direct-connection UNS, read-only). Note `/api/mira/ask` already does a Hub-side version — port the contract. | Reads landed data | 3-4 |
| **L6 — infra** | (ops, not code) | Provision tenant; migrations; broker. See §6. | — | 0/3 |

**Interdependencies:** L4/L5 depend on L2 (seed) + `SIMLAB_TENANT_ID` having *some* landed rows
(run L1+relay, or the demo signal routes). L3 unblocks the real foreign feed (independent of L1). L1
is the single highest-leverage no-infra brick — it makes the HTTP path turnkey.

> **Measurement is not a gap — it's already built.** SimLab is the platform ground-truth **oracle**
> (#2218/#2236): a CI grader gate, an eval service, a self-scoring dashboard, a 5-pillar observability
> layer (`simlab/observe/` → re-exports `mira-bots/shared/observe`: `AnswerTrace`, `checks`,
> `approval_registry`), and a deterministic scenario **mutation** engine (`simlab/mutation.py`, P4) that
> measures MIRA's robustness *difficulty curve* with ground truth held invariant. None of the lanes
> above need to build measurement — they feed the oracle that already scores them.

---

## 6. Infra / ops runbook (Mike's hands-on checklist)

> Order matters. Each step lists the action, the env, and a **verify** line. Honor env boundaries
> (`docs/environments.md`): dev → staging → prod; never psql prod; migrations via `apply-migrations.yml`.

1. **Provision the `proveit` tenant** (UUID `tenants` row) in the Hub.
   *Verify:* the tenant authenticates (UUID session) — `mira-hub/src/lib/session.ts` 401s non-UUID.
2. **Apply migrations** `020, 033, 035, 036` to the target env via `apply-migrations.yml` (`dry-run` → `apply`).
   *Verify:* `db-inspect.yml` shows `approved_tags`, `tag_events`, `live_signal_cache` (with `uns_path`,
   `freshness_status` cols from `036`).
3. **Seed `approved_tags`** for `source_system='simulator'` (Lane 2 file), tenant-substituted, staging first.
   *Verify:* `SELECT count(*) FROM approved_tags WHERE source_system='simulator' AND tenant_id=…` = N tags.
4. **Stand up one broker** (only for the MQTT/foreign path):
   `docker run -d --name mosq -p 1883:1883 eclipse-mosquitto:2` (or the MIT Flexware EMQX sim);
   set `SIMLAB_MQTT_HOST=<host>`.
   *Verify:* `SIMLAB_MQTT_HOST=localhost python -m simlab` + `mosquitto_sub -t 'FactoryLM/#' -v` shows ticks.
5. **Run `mira-relay`** (saas compose) with `NEON_DATABASE_URL` + `MIRA_IGNITION_HMAC_KEY`
   (bench: `RELAY_LEGACY_BEARER=1`).
   *Verify:* `curl $RELAY/health` → ok; a signed `POST /api/v1/tags/ingest` returns `accepted>0`.
6. **Run SimLab against the relay** (after Lane 1 ships):
   `SIMLAB_RELAY_URL=$RELAY SIMLAB_RELAY_API_KEY=… python -m simlab` then advance a scenario.
   *Verify:* `SELECT count(*) FROM live_signal_cache WHERE source_system='simulator'` climbs;
   `uns_path` is populated.

---

## 7. End-to-end verification

- **HTTP path (no broker):** seed the `simulator` allowlist → attach `RelayIngestPublisher` →
  `advance(10)` → assert rows in `tag_events` + `live_signal_cache` with a resolved `uns_path`. Reuse
  the `mira-relay/tests/test_tag_ingest.py` patterns (ephemeral `postgres:16`, `SET ROLE factorylm_app`,
  the `NeonTagStore` contract). This proves SimLab→UNS landing without any broker.
- **MQTT emit:** `SIMLAB_MQTT_HOST=localhost python -m simlab` + `mosquitto_sub -t 'FactoryLM/#' -v` →
  observe `{"value":…,"ts":…,"source":"simulator"}` on the projected topics.
- **Read side:** query `live_signal_cache` by subtree (`uns_path <@ 'enterprise.florida_natural_demo…'`);
  load `/command-center` → freshness dots reflect the landed tags; ask the Hub a question on the asset →
  `/api/mira/ask` should cite `[Source: live_signal_cache]` (`route.ts:341`).

---

## 8. Pointers / cross-links

- Emit: `simlab/engine.py`, `simlab/publishers.py`, `simlab/models.py`, `simlab/uns.py`, `simlab/api.py`.
- Land: `mira-relay/tag_ingest.py`, `mira-relay/auth.py`, `mira-relay/relay_server.py`, `docker-compose.saas.yml`.
- Schema: `mira-hub/db/migrations/020_signal_cache_and_trends.sql`, `033_tag_events.sql`,
  `035_approved_tags.sql`, `036_current_tag_state_freshness.sql`; seed template
  `tools/seeds/approved_tags_conveyor.sql`.
- Read: `mira-hub/src/app/api/command-center/tree/route.ts`, `src/lib/command-center-freshness.ts`,
  `src/app/api/mira/ask/route.ts`, `src/lib/i3x/value.ts`, `src/app/(hub)/command-center/page.tsx`.
- Rules: `.claude/rules/direct-connection-uns-certified.md`, `.claude/rules/fieldbus-readonly.md`,
  `.claude/rules/uns-compliance.md`, `.claude/rules/knowledge-entries-tenant-scoping.md`.
- Plans: `docs/plans/2026-06-22-proveit-factory-import-implementation-plan.md`,
  `docs/RESUME_2026-06-22_proveit-buildout.md`, `docs/simlab/README.md`.
