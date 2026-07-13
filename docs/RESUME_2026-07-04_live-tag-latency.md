# RESUME 2026-07-04 — Live-tag latency: real bottleneck found (relay), fix MERGED to main

## TL;DR
The Hub live-tag lag (~5 s+) was chased through three layers. Two were red herrings
(browser poll, collector timer). **The real bottleneck is the relay: `ingest_batch` opens
3 fresh NeonDB connections per push (~2 s).** ✅ **The fix is MERGED to `main` — PR #2474,
squash commit `0c95c353`, VERSION 3.60.3.** All 3 required checks green (staging-gate,
Version Bump, Hub E2E); 191 relay tests + Contract 5 green, ruff clean. (`Eval Offline`
is red on the PR but it is **pre-existing red on main** — last 10 main runs all fail — and
non-required; unrelated to this relay-only change.) ✅ **DEPLOYED + VERIFIED LIVE on prod
(2026-07-04 22:08Z, run 28721173911, `services="mira-relay"`).** `mira-relay` is NOT in the
deploy-vps defaults, so the merge auto-deploy did **not** rebuild it — an explicit dispatch was
required (staging-gate skipped w/ reason; audit issue #2475). Container rebuilt → `Up (healthy)`;
`GET /health` → 200. **Measured improvement (cadence probe #2473): push gaps ~2.47 s → ~1.41 s
(~43% faster; relay exec ~1.97 s → ~0.91 s), 12 tags/batch, 20 consecutive batches.** The 2 s
relay floor is broken. Everything else (browser poll, SSE push, collector timer, fast scan
class) sat on top of this floor and is already live — sub-second end-to-end display is now
reachable.

---

## THE #1 RECOMMENDATION — build the relay ingest optimization (the real fix)

> ✅ **DONE (2026-07-04, `fc95d971`).** All three fixes below are implemented in
> `mira-relay/tag_ingest.py`: module-level engine cache keyed by `neon_url`,
> `pool_pre_ping` dropped, and a `NeonTagStore.session(tenant_id)` context manager so
> `ingest_batch` runs all three ops in ONE transaction/connection (via `_BoundNeonTagStore`).
> One-transaction guarantee, canonical cache SQL, and RLS bind preserved; backward-compatible
> with the in-memory test store via `nullcontext`. 191 relay tests pass (+2 new one-session
> regressions), Contract 5 green, ruff clean. **Remaining: PR → staging gate → merge → deploy
> `mira-relay` → re-measure with the cadence probe (#2473).**

**File:** `mira-relay/tag_ingest.py`, class `NeonTagStore`.

**Root cause (measured + code-confirmed):**
- `NeonTagStore._engine()` calls `create_engine(..., poolclass=NullPool, pool_pre_ping=True)`
  **fresh on every method call** — and `pool_pre_ping=True` adds a `SELECT 1` round-trip per
  connection.
- `ingest_batch()` makes **3 separate store calls per push**, each creating its own engine +
  connection: `load_allowlist` (line ~182), `current_state_simulated` (line ~243),
  `persist_batch` (line ~259).
- ⇒ **3 cold Neon connections + 3 pre-pings per 12-tag push ≈ ~2 s.**

**The fix:**
1. **Cache the engine once** (module-level or on the store instance) instead of `create_engine`
   per call.
2. **Do all three ops in ONE connection** per `ingest_batch` (open one conn, `SET LOCAL` once,
   run allowlist + current-state + persist in it) instead of three separate `engine.connect()`.
3. **Drop `pool_pre_ping=True`** — pure overhead with NullPool + Neon's PgBouncer.

**Constraints (do NOT break):**
- Preserve `persist_batch`'s "**ONE transaction**" guarantee (events + cache upsert commit/roll
  back together — a 5xx + collector retry must never duplicate append-only rows).
- Honor the **one-pipeline-ingest law** (`.claude/rules/one-pipeline-ingest.md`) — Contract 5
  in `tests/test_architecture.py` must stay green. The normalizer/allowlist/persist stay in
  `ingest_contract.py` / `tag_ingest.py`; this is an internal perf refactor, not a new inlet.
- Keep RLS tenant binding (`SET LOCAL app.current_tenant_id`).

**Expected result:** ingest ~2 s → ~0.6 s. Then deploy: `deploy-vps.yml services="mira-relay"`
(mira-relay lives in `docker-compose.saas.yml`). Re-measure with the cadence probe. With the
timer + SSE already live, **sub-second end-to-end becomes reachable.**

---

## How to measure (the cadence probe — USE THIS to verify any fix)
- **PR #2473** (open) adds two read-only queries to `db-inspect.yml`: **collector push cadence**
  (distinct `ingested_at` batch gaps over 60 s = real push interval) and **per-tag freshness**.
  Merge it, or run it from branch `chore/db-inspect-latency-probe`:
  `gh workflow run db-inspect.yml --ref chore/db-inspect-latency-probe -f target=prod`
- Latest measurement (2026-07-04 ~20:38Z): **push gaps ~2.47 s**, 12 tags/batch, rejected=0.
  (Was 2.0 s under the old Fixed-Rate timer; Fixed-Delay 500 + ~2 s exec = 2.47 s.)

## What's already shipped (all correct, all on top of the 2 s relay floor)
| Part | PR | State |
|---|---|---|
| Browser display poll 2000→750 ms | #2460 | merged + deployed |
| Collector timer 2000→500 ms **Fixed-Delay** (`MiraTagStream/resource.json`) | #2462 | merged **+ applied to live gateway** (elevated write + service restart) |
| Hub **SSE push** (`/api/assets/[id]/machine-memory/stream`) + card `EventSource` w/ poll fallback | #2463 | merged + deployed + verified (401 auth-guard live) |
| Cadence + freshness probe | #2473 | **open — merge it** |
| `docs/perf/live-latency-budget.md` (the benchmark + fix ladder) | (in #2460) | shipped |

The gateway now runs the 250 ms fast scan class (Mike set it on 3 tags) + Fixed-Delay 500 timer.
Fixed-Delay also **killed the intermittent overlapping-POST errors** (13:54/16:02) — leave it;
the timer's `delay` becomes worth lowering only AFTER the relay is fast.

---

## Other open threads (secondary)
1. **#2459 — stale `Conveyor/VFD_Hz` ghost row** ("vfd hz 18h ago" on the card). It's the retired
   old-collector tag generation. **Fix (awaiting go):** drop `Conveyor/*` + `Mira_Monitored/*` from
   `tools/seeds/approved_tags_conveyor.sql`, delete those `approved_tags` rows, purge their
   `live_signal_cache` rows (staging→prod, sanctioned workflows).
2. **#2428 — WO save fixed on prod (migration 060 applied)** but issue stays OPEN until one live WO
   save on prod (bench tenant `e88bd0e8-…`) confirms 201.
3. **Collector intermittent POST error** — `java.io.IOException: Unable to POST http://100.68.120.99:8765/...`
   from `_post` (tag-stream.py line ~154). Jython `except Exception` in `post_with_retry` may not
   catch a Java `IOException`, so it propagates and kills that timer cycle (one dropped push,
   self-recovers). Low-priority hardening: catch Java exceptions in the collector + guard the
   unguarded `getMiraConfig`/`load_allowlist_set` file reads.
4. **Fast scan class** — Mike moved 3 tags to 250 ms; could extend to all 12 `MIRA_IOCheck/*`.
5. **Tier-3 "truly instant" ceiling** — cloud RTT floors at ~150–300 ms; for HMI-grade instant use a
   **local Ignition Perspective panel** reading tags directly (no cloud hop).

---

## Infra facts to carry forward (saved pain)
- **Ignition gateway is LOCAL on this dev machine**: `C:\Program Files\Inductive Automation\Ignition`,
  Windows service name **`Ignition`**, gateway http **8088**. Writing project files needs
  **elevation (UAC)** — Mike is present to approve. Active 8.3 timer resource path:
  `data/projects/FactoryLMCollector/ignition/timer/MiraTagStream/resource.json` (the
  `event-scripts/timer/…` copy is the 8.1 layout 8.3 IGNORES). Config-as-files is **not
  hot-reloaded** — restart the service to load. Backup of the original 2000ms/Fixed-Rate resource:
  `…/scratchpad/MiraTagStream-resource.json.bak-20260704`.
- **Collector ingest endpoint:** `INGEST_URL = http://100.68.120.99:8765/api/v1/tags/ingest`
  (VPS relay over Tailscale). The public `api.factorylm.com/api/v1/tags/ingest` is NOT exposed for
  ingest. Tailscale first-packet cold-start (~1.8 s) exists but is **not** the bottleneck (keepalive
  test proved cadence unchanged).
- **CI/merge gotchas this session:** any NEW hub route MUST be registered in
  `mira-hub/docs/sitemap.snapshot.json` via `bun run sitemap` (else `sitemap-drift.test` fails Hub
  Unit Tests). A **docs-only** follow-up commit gets `paths-ignore`d by `ci.yml` and won't re-run CI
  (touch a non-ignored file — e.g. resolve a VERSION conflict — to force it). `deploy-vps` requires a
  passing Staging Gate on the **PR head SHA**; for a VERSION/CHANGELOG-only re-sync over gate-green
  code use `skip_staging_gate=true` + a reason (auto-opens an audit issue). Main is churning fast via
  concurrent sessions (VERSION raced 3.59.5→3.60.0→3.60.1→3.60.2) — use worktrees, `git branch
  --show-current` before committing, never `git add -A`, admin-merge for the phantom
  `Hub E2E` required check.

---

## Resume prompt (paste this to pick up)

> Resume from `docs/RESUME_2026-07-04_live-tag-latency.md`. The live-tag latency root cause is
> FOUND and code-confirmed: `mira-relay/tag_ingest.py` `NeonTagStore` opens **3 fresh NeonDB
> connections per push** (`_engine()` recreates the engine each call with `pool_pre_ping=True`;
> `ingest_batch` calls `load_allowlist` + `current_state_simulated` + `persist_batch` separately)
> ≈ **~2 s per push** — the floor under everything. **PRIMARY TASK: build the relay ingest
> optimization** — cache the engine once, do all 3 ops in ONE connection per `ingest_batch`, drop
> `pool_pre_ping`; preserve `persist_batch`'s one-transaction guarantee + the one-pipeline-ingest
> law (Contract 5 tests green); then `deploy-vps.yml services="mira-relay"` and re-measure with the
> cadence probe (merge PR #2473 first, or run it from `chore/db-inspect-latency-probe`). Target push
> ~2.47 s → ~0.6–0.8 s; with the SSE push (#2463) + 750 ms poll (#2460) + 500 ms Fixed-Delay timer
> (#2462, already applied to the live gateway) + Mike's 250 ms scan class, sub-second end-to-end.
> Do NOT re-chase the timer or Tailscale — both measured out (Fixed-Delay 500 made it slightly
> worse; a keepalive warming the Tailscale path left cadence unchanged). Secondary: merge #2473;
> #2459 ghost-tag cleanup (awaiting Mike's go); one live WO save to close #2428; optional collector
> Java-exception hardening. The Ignition gateway is LOCAL (service `Ignition`, port 8088, writes
> need UAC) — Mike is present for elevation. Full context + infra gotchas in the resume doc.
