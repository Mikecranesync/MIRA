# RESUME 2026-07-04 — CV-101 live: gateway → cloud → machine memory PROVEN

## State: the loop that was broken since June is CLOSED and streaming

**Proven live 2026-07-03/04 (bench LAPTOP-0KA3C70H, Ignition 8.3.4, garage tenant `e88bd0e8-…`):**
- `MiraTagStream` timer registered (real 8.3 resource format — see
  `ignition/project-resources/FactoryLMCollector/ignition/timer/MiraTagStream/README.md`),
  fires every 2 s, streams 12 allowlisted `[default]MIRA_IOCheck` tags.
- Signed POSTs accepted by the relay: prod `tag_events` 29 → 15k+ in hours, all rows
  `uns_path=enterprise.home_garage.conveyor_lab.conveyor_1`, `source_connection_id=cv101-bench-gw`, `simulated=f`.
- `MIRA_RUN_DIFF_ENABLED=1` in Doppler prd; historian worker+beat redeployed.
- **`machine_state_window` deriving live** (idle/faulted/comm_down windows, PR #2421 fixed
  raw-vs-normalized tag-path mapping; db-inspect scoreboard now reports the 040 layer + uns coverage).

## The five bugs fixed (details: FactoryLM_Tag_Collector_Explainer.pdf in Downloads, or the PR bodies)
1. 8.1 `event-scripts/timer/` layout ignored by 8.3 → real format `ignition/timer/<Name>/handleTimerEvent.py` (#this PR: template).
2. `__file__` NameError in Jython script library (allowlist/collector) → guarded (#2419).
3. Local allowlist searched `data/projects/factorylm/`, file lives in `data/factorylm/` (#2419).
4. Jython `unicode` (from Java Properties) bypassed the `isinstance(str)` HMAC encode-guard → `_to_bytes()` (#this PR).
5. **h2c trap:** Java HttpClient sends `Upgrade: h2c` on plain http; uvicorn/httptools drops the body → every POST 401 `signature_mismatch` → pin `system.net.httpClient(version="HTTP_1_1")` (#this PR). Raw-socket A/B proven. EVERY customer gateway would hit this.

## NEXT (in order)
1. **Light up the MachineMemoryCard:** `/api/assets/[id]/machine-memory` resolves asset →
   `kg_entities` equipment row → uns_path. The garage tenant has **NO equipment kg_entities row**
   (verified via db-inspect scoreboard "equipment kg_entities" section) → card shows empty while
   windows exist. Fix = seed/create the bridge row (tenant `e88bd0e8-…`, entity_type `equipment`,
   `entity_id` = the CV-101 `cmms_equipment.id`, uns `enterprise.home_garage.conveyor_lab.conveyor_1`)
   via the proper path (namespace UI or a new seed in `tools/seeds/` + `apply-seeds.yml`; staging first).
   Then screenshot → `docs/promo-screenshots/` (desktop 1440x900 + mobile 412x915).
2. Demo money shot after the card lights: pull the e-stop (A3) or RS-485 at the GS10 (A1 critical).
3. Follow-ups: only ~5-7 of 12 streamed tags accepted cloud-side (reconcile prod `approved_tags`
   normalization/coverage); gateway ts format = Java `Date.toString()` (standardize ISO-8601 in the
   pack); relay-side h2c hardening (strip/tolerate Upgrade so unpinned clients can't silently fail);
   "Streamed N/M" success line is trace-level (invisible at default levels).
4. Resource pack build (`tools/build_ignition_collector_pack.py` + CI parity test) per
   `docs/plans/2026-07-03-ignition-collector-resource-pack.md` — the timer template is now in-repo.

## Gotchas for the next session
- Gateway does NOT rescan externally-written project files — restart the Ignition service.
- The gateway's project copies of collector/signing/allowlist/timer were hand-patched live on the
  bench and MATCH the repo sources as of this PR — keep them in sync (pack parity test is the
  permanent answer).
- Bench laptop may nap (`powercfg /change standby-timeout-ac 0` still pending, elevated).
- `feat/litmus-bench-proof` checkout holds unrelated WIP — never `git add -A` there.
