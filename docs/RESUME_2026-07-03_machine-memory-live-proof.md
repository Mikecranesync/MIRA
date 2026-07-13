# RESUME 2026-07-03 — Machine-memory live proof (CV-101 bench → cloud card)

## State: everything merged + armed; ONE human step pending (Designer timer save)

**Done today (11 PRs merged to main, all green):** #2403 db-inspect fix/scoreboard/KG-canonicalizer · #2404 machine-memory worker + migration 040 · #2406 Hub machine-memory card · #2407 bench runbook + sign_and_post + drift guards · #2408 relay RELAY_BIND_ADDR · #2409 integration audit (6 docs incl. master plan T1–T10) · #2412 historian env passthrough · #2413 T3 safety parity (16→52 phrases) · #2414 T2 memory→Ask-MIRA context (injection-hardened) · #2415 T4 anomaly→WO link (migration 060) · #2416 T5 tag-approval→allowlist bridge. VERSION ~3.58.2.

**Cloud fully proven:** prod migrations 038/040/054 applied+verified; 58 approved_tags seeded (garage tenant `e88bd0e8-8a84-4e30-9803-c0dc6efb07fe`, uns `enterprise.home_garage.conveyor_lab.conveyor_1`); relay live on tailnet `http://100.68.120.99:8765` (VPS=factorylm-prod); **signed smoke row ACCEPTED → tag_events row written** (via `mira-relay/tools/sign_and_post.py` + `doppler run` prd). Doppler prd set: RELAY_BIND_ADDR, MIRA_TENANT_ID→garage, MIRA_MACHINE_MEMORY_UNS_PATHS. `MIRA_RUN_DIFF_ENABLED` still 0 (flip after first gateway rows).

**Bench state (LAPTOP-0KA3C70H, remote via jarvis-node `http://100.72.2.99:8765` bearer `$JARVIS_TOKEN`, PowerShell, NON-elevated — elevation via Start-Process -Verb RunAs UAC pattern, Mike clicks Yes):** `factorylm.properties` APPLIED (tailnet URL + garage tenant; backup `.bak-20260703`); HMAC key on laptop == Doppler prd (SHA-256 verified); gateway restarted, project FactoryLMCollector running. **BLOCKER: the MiraTagStream timer was never a loaded resource** (June config-as-files folder is a format Ignition ignores; official runbook requires Designer creation). Mike has exact steps in `docs/plans/2026-07-03-ignition-collector-resource-pack.md` §YOUR STEPS (copy code.py → Designer → Gateway Events → Timer → 2000ms fixed-rate dedicated → save).

## On "timer saved" do, in order
1. Watch gateway log: `Select-String wrapper.log -Pattern "TagStream"` remotely → expect `Streamed N/M allowlisted tags`.
2. Verify first gateway rows: db-inspect prod (workflow has scoreboard step) → tag_events >29, source_connection_id=cv101-bench-gw, simulated=f.
3. **Capture the timer's on-disk resource format** from `data/projects/FactoryLMCollector/` → template for the resource pack (plan doc above).
4. Flip flag: `doppler secrets set MIRA_RUN_DIFF_ENABLED=1 --project factorylm --config prd` + `gh workflow run deploy-vps.yml -f services="mira-historian-worker mira-historian-beat"` → watch historian logs → 038/040 rows appear (idle window expected; A1/A3 on fault injection).
5. Card: app.factorylm.com asset page (garage tenant asset) MachineMemoryCard populated → screenshot to `docs/promo-screenshots/2026-07-03-cv101-first-tag-events-row.png` (Playwright MCP; login=Mike's creds needed, or sessionOrDemo).
6. Then: build the Ignition resource pack (plan §Build) + land this doc + plan doc (uncommitted on `feat/litmus-bench-proof` checkout — careful: that branch holds unrelated WIP incl. fault dictionary; never `git add -A`).

## Gotchas
- E2E smoke check flakes ~50% — rerun-once always passes. "no checks reported" ≠ green (guard total>5). VERSION bump required per PR (staggered; re-resolve per merge; other sessions also merging).
- Merge trains: scripts in scratchpad (`train3.sh` pattern). Worktrees: mira-t2..t5, mira-mm-pr*, mira-integration (clean, merged).
- Follow-ups filed in reviews: approved_tags key collision on generic symbols (PR #2416 comment), SAFETY_KEYWORDS_IMMEDIATE "arcing" not mirrored, laptop sleeps (powercfg fix in plan doc).
- Master plan T6–T10 remain: docs/discovery/factorylm-mira-integration-master-plan.md.
