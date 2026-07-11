# Discovery Record — Manual Ingest Deep Dive

Discovery-Recorder log for the 2026-07-06 deep-dive (quad-code prompt): separate code reality from runtime reality, verify the KB-vs-drive-pack dataflow, and design the bridge. Against `origin/main` @ 3.79.x + branch `docs/drivesense-manual-ingest-discovery`.

## Question asked
What manual/bulletin discovery machinery is built, what actually runs, what only exists as code/docs, and what bridge connects manual discovery to trust-graded drive-pack candidates?

## Files inspected
- Schedulers: `mira-crawler/trigger/{trigger.config.ts,src/tasks/*.ts}`, `mira-crawler/celeryconfig.py`, `scripts/install_crons.sh`, `scripts/ab_manual_hunter/launchd/*.plist`, `wiki/references/routines.md`, `.github/workflows/seed-oem-manuals.yml`.
- Crawlers/ingest: `mira-crawler/tasks/{discover,sitemaps,rss,gdrive,manualslib_scraper,playwright_crawler,freshness,patents,full_ingest_pipeline}.py`, `mira-crawler/cron/kb_growth_cron.py`, `mira-crawler/ingest/{store,kg_writer}.py`, `scripts/ab_manual_hunter/run.py`, `scripts/ingest_guardrails.py`, `mira-crawler/bridge.py`, `mira-crawler/tasks/_shared.py`.
- Runtime artifacts: `mira-crawler/cron/manual_queue.json`, `~/.mira/{ab-hunter/run-*.json,guardrails-state.json,STOP_INGEST}`.
- Target: `tools/drive-pack-extract/registry/{registry,check,update_candidate}.py`.

## Commands run
- `grep -rn 'drive-pack-extract|registry.check|update_candidate'` (excluding the tool dir) → 31 hits, all docs/CI/PROVENANCE, **zero call sites**.
- `python mira-crawler/fleet_status.py` against the committed queue → `built_but_needs_runtime_proof` (newest `done_at` = 2026-04-29).
- `pytest mira-crawler/tests/test_fleet_status.py -q` → 19 passed.

## Observed results
- **Scheduler:** Trigger.dev Cloud (`proj_mira-ingest`) → FastAPI bridge `:8003` → Celery. 14 tasks, 11 manual/KB-related. Celery beat runs only intent scanners. kb_growth_cron hourly (system cron). AB hunter launchd every 6 h (Charlie), **dry-run**.
- **Dataflow:** all 9 discovery paths → `knowledge_entries` (directly via `ingest/store.py::insert_chunk`, or via Hub node-ingest for the AB-hunter path). None reach `tools/drive-pack-extract/`.
- **Metadata:** discovery captures `manufacturer`/`model`/`source_type` + free-text `manual_type`; **no** `product_family`/`publication`/`revision`, and **no PDF hash** anywhere on the KB path.
- **Runtime evidence:** locally inspectable = queue file, hunter run reports, guardrails state, STOP_INGEST. Off-box = Redis `seen_*` (90-day TTL), NeonDB freshness, Trigger.dev Cloud runs (external dashboard only — no repo artifact).

## Conclusion
**TRUE: manual discovery feeds the KB, not the trust-graded drive-pack path.** The two lanes are unconnected; the live packs were hand-produced. Bridge insertion point = `kb_growth_cron.py::_process_entry` success branch, fail-open, behind a default-off flag; it must compute a PDF sha256 and map `(mfr,model)→manual_id`, then call the PR #2507 registry/`update_candidate` (never promote).

## Reusable deterministic workflow created
`mira-crawler/fleet_status.py` — read-only fleet-status aggregator: parses the local artifacts, judges each component with the honest vocabulary (`built_and_firing` only with a runtime artifact), and prints the exact off-box operator commands. `--json` / `--commands` modes.

## Tests added
`mira-crawler/tests/test_fleet_status.py` — 19 offline tests: queue parse (incl. malformed/missing soft-fail), STOP_INGEST auto-vs-operator, hunter dry-run/live, run-report selection, freshness judged on queue activity timestamps (not mtime), report render smoke, operator-commands coverage. Wired into the `drive-pack-extract-tests` CI job.

## Docs created
`docs/runbooks/{manual-discovery-fleet-inventory,proving-crawler-last-run-evidence,ab-manual-hunter,trigger-dev-ingest-scheduler}.md` + `docs/drive-commander/bridge-manual-discovery-to-drive-pack-grading.md` + this record. (Drive-manual-update-candidate workflow + do-not-silently-trust runbook already exist from PR #2507.)
