# M001 observation state — RED / GREEN evidence

Method: each mutation was applied to the working-tree file by an exact, single-match string replacement, the affected test files were run, the output was recorded, and the original bytes were restored. The driver verified the sha256 of every mutated file after restore (`restored=True` for all 40 mutations, `DONE restored_all=True`). Final tree = intended diff only (`git diff --stat`: 2 tracked files; new files untracked, nothing staged, nothing committed).

Counts are `failed / passed`. "unit" = default vitest config (parse, project, route, chat). "int" = the integration config, which runs `observations.integration.test.ts` and `dispatcher.integration.test.ts` together against the disposable DB, so int counts cover both files. Raw log: `scratchpad/m001/mut/results.jsonl`.

## Named tests

| Test name | Mutation (what was broken) | RED counts | GREEN counts |
|---|---|---|---|
| parse: seal leak 09:10 → seal_leak / present / ISO | M03 time-of-day parser always null | unit 5F/22P (5 tests across files) | unit 27/27 |
| parse: "no leak seen" → absent | M01 negation vocabulary disabled | unit 1F/26P | 27/27 |
| parse: "replaced the seal" → repaired | M02 repair vocabulary disabled | unit 1F/26P | 27/27 |
| parse: no time → needs observed_at | M08 no-time text gets a fake 00:00 | unit 1F/26P | 27/27 |
| parse: gibberish → needs fact_key | M05 unrecognised text defaults to seal_leak | unit 1F/26P | 27/27 |
| parse: never emits root cause/health/safe | M06 parser emits a rootCause field | unit 1F/26P | 27/27 |
| parse (extra): 9:10pm = 21:10 | M07 pm hour not added | unit 1F/26P | 27/27 |
| parse (extra): DST-change day uses the offset at that time | M04 offset taken at a fixed June instant | unit 1F/26P | 27/27 |
| project: newer_observed_wins_over_late_arriving_old_report | M09 ordered by recorded time first | unit 1F/26P | 27/27 |
| project: negated_old_report_kept_in_history | M12 history drops absent reports | unit 3F/24P (3 projection tests) | 27/27 |
| project: correction_excludes_superseded_but_keeps_history | M10 superseded rows not excluded (test sharpened: original observed later than its correction) | unit 1F/26P | 27/27 |
| project: opposite_current_reports_are_contested | M11 contest window set to 0 | unit 1F/26P (+M12) | 27/27 |
| project: repair_reported_never_sets_health_root_cause_or_safe | M13 health set to "ok" | unit 1F/26P | 27/27 |
| project: state_version_changes_only_with_contributing_rows | M14 version hashes every history row | unit 1F/26P | 27/27 |
| store: retry_same_request_id_creates_one_observation_and_one_event | M15 idempotency off (no replay lookup, conflict on id) | int 2F/46P | int 48/48 |
| store: reused_request_id_with_different_content_conflicts | M16 reused id always replays as existing | int 1F/47P | int 48/48 |
| store: unconfirmed_binding_cannot_record | M17 binding check drops confirmed_at | int 1F/47P | int 48/48 |
| store: asset_mismatch_cannot_record | M18 binding check drops the machine match | int 1F/47P | int 48/48 |
| store: other_tenant_cannot_read_or_write | M40 app read predicate AND RLS policy both removed | int 1F/47P | int 48/48 |
| store: other_tenant (single layer) | M19 RLS policy alone = USING (true) | int 0F/48P (NOT caught: app predicate still isolates; see note) | int 48/48 |
| store: event_failure_rolls_back_observation | M20 crash seam removed (no throw) | int 1F/47P | int 48/48 |
| store: readback_from_second_notebook_same_asset_returns_fact_without_thread | M21 readback row carries notebookId | int 1F/47P (see note on a transient 2nd failure) | int 48/48 |
| store: control_asset_state_unchanged | M22 readback ignores the machine | int 1F/47P | int 48/48 |
| store: event_row_is_uns_scoped_and_typed (UNS path) | M23 event asset_uns_path written NULL | int 1F/47P | int 48/48 |
| store: event_row_is_uns_scoped_and_typed (no raw text) | M24 event payload carries raw_report | int 1F/47P | int 48/48 |
| regression: observation_then_fix_on_same_notebook_still_dispatches | M25 aggregate sequence fixed at 1 (in enqueue.ts) | int 5F/43P (includes 4 existing dispatcher tests AC10, F4, F5, F9c) | int 48/48 |
| schema: event_type CHECK widened (store path) | M26 CHECK not widened to observation_recorded | int 8F/40P | int 48/48 |
| routes: flag off ⇒ 404 observations_disabled | M27 flag always on | unit 2F/25P (route + chat flag-off tests) | 27/27 |
| routes: flag on + 42P01 ⇒ 503 observations_unavailable | M28 42P01 not mapped | unit 1F/26P | 27/27 |
| routes: preview never writes | M29 preview calls insertObservation | unit 1F/26P | 27/27 |
| routes: missing confirmed → 400 confirmation_required | M30 confirmed not required | unit 1F/26P | 27/27 |
| routes: future observed time → 400 | M31 future check removed | unit 1F/26P | 27/27 |
| routes (extra): client machine ≠ binding → 409 asset_mismatch | M32 mismatch check removed | unit 1F/26P | 27/27 |
| routes (extra): unconfirmed binding → 409 on preview | M33 unconfirmed accepted | unit 1F/26P | 27/27 |
| routes (extra): valid body → 201 | M34 create returns 200 | unit 1F/26P | 27/27 |
| chat: bound Pump 07 → section with author, times, verification | M36 observed section not appended | unit 1F/26P | 27/27 |
| chat: evidence frame carries observation id + state_version | M38 observedState not attached | unit 1F/26P | 27/27 |
| chat: notebook bound to asset B gets no section | M37 observed state read for a fixed asset | unit 1F/26P | 27/27 |
| chat: flag off → byte-identical prompt, store untouched | M35 flag check removed in chat | unit 1F/26P (+M27) | 27/27 |
| chat: table missing → still answers | M39 observed-state failure rethrown | unit 1F/26P | 27/27 |

## Notes

- **M19 (RLS alone) was not caught.** The `asset_observations` policy changed to `USING (true)` leaves every test green, because the app-level `tenant_id` predicate in the read and the notebook-binding `SELECT` still isolate the tenants. Defence in depth holds. The real test of isolation is M40, which removes both layers and turns `other_tenant_cannot_read_or_write` red.
- **Transient failure, not reproduced.** The first M21 run also failed `observation_then_fix_on_same_notebook_still_dispatches`. The re-run, with the same code and mutation, failed only the readback test. The two integration files share one database and run in parallel workers. No GREEN run failed this way (two green runs, 48/48 each). Cause not established; not attributed to the feature.
- **M10 was re-run after sharpening the test.** The first version of the correction test passed under the mutation (the newer-observed ordering already chose the correction). The test now observes the original later than its correction, so only the supersession exclusion keeps it out. Results were recorded against the sharpened test.
- **M18 was re-run after fixing the mutation.** The first version removed the `$3` parameter, which broke every insert with a parameter-type error (10 failures, not the mismatch logic). The mutation now keeps `$3` in use, and only `asset_mismatch_cannot_record` fails.

## GREEN summary (unmutated tree, final)

- `npx vitest run src/capabilities/observations` (default config): 4 files, **27 passed / 0 failed**.
- `npx vitest run --config vitest.integration.config.ts src/capabilities/observations src/capabilities/cmms-dispatch` (real Postgres): 2 files, **48 passed / 0 failed** (10 new + 38 existing dispatcher).
- Full comparison, `npx vitest run src/capabilities src/app/api/equipment-notebooks`: base (origin/main d7bf852a1) 236 files / 8301 passed / 53 skipped; after 240 files / 8328 passed / 53 skipped. Exit 0. Delta +27 = the new tests, no existing test changed status.
- `tsc --noEmit -p tsconfig.json`: 134 errors before and after; sorted error list identical (`diff` empty). All 134 are pre-existing, outside the changed files.
- `eslint` on changed files: 0 errors; 3 warnings, all pre-existing in `chat/route.ts` (`Context`, `GenerationAttempt`, `matchSafetyStop`).

## Orchestrator additions (UI + browser proof)

| Test | Mutation | Red | Green |
|---|---|---|---|
| machine-observations-logic: retry reuses the request id; corrected field gets new id | `idFor` never reuses (`let id = undefined`) | ⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
      Tests  1 failed | 6 passed (7) |       Tests  7 passed (7) |
| machine-observations-logic: repair reads as reported, not healthy | label `repaired: "fixed"` | ⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
      Tests  1 failed | 6 passed (7) |       Tests  7 passed (7) |
| observations.browser.integration: A previews, confirms through a lost reply, B reads back + next answer | `idFor` never reuses | expected {obs: 2, events: 2} to equal {obs: 1, events: 1} (1 failed) | 1 passed |

## Codex round 1 follow-ups (fixed in PR #5091 before round 2)

| Finding | Test | Mutation | Red | Green |
|---|---|---|---|---|
| #5092 (F1) leak then repair within 60 minutes projected as contested | `leak_then_repair_within_window_is_repair_reported_not_contested`, `recurrence_after_repair_within_window_is_leak_reported_not_contested`, browser proof with repair pinned 5 minutes after the leak | restore the obs-proj-1 rule `r.factValue !== current.factValue` | unit 2F/6P; browser 1F ("contested" where "repair_reported" expected) | unit 8/8, browser 1/1 |
| #5093 (F2) rollback narrows the CHECK while observation events remain | `documented_rollback_succeeds_after_an_observation_event_exists` (runs the ROLLBACK-BEGIN block from 113 in one transaction on a dedicated client) | delete the `DELETE FROM notebook_domain_events ...` line from the block | int 1F/10P, "check constraint ... is violated by some row" | int 11/11 |

## Codex round 2 findings (fixed in PR #5091 before round 3)

| Finding | Test | Mutation | Red | Green |
|---|---|---|---|---|
| F1 (MEDIUM) a pre-repair report contests a post-repair one | `absent_then_repair_then_leak_is_a_post_repair_recurrence_not_contested`, `leak_then_repair_then_not_seen_is_not_contested`, control `contradiction_after_the_same_repair_is_still_contested` | obs-proj-2 rule (no repair boundary) | unit 2F (control green) | unit 13/13 |
| F2 (MEDIUM) bare times read as Lake Wales for every tenant | parse `same_bare_time_in_two_plant_zones_is_three_hours_apart`, `no_zone_means_no_guess_...`, `validTimeZone_...`; route `reads a bare time in the caller's IANA zone ...`; browser on a Los Angeles device | panel stops sending its zone | unit 3F; browser 2F (empty time field) | unit, route and browser green |
| F3 (LOW) StrictMode replay leaves the panel hidden | browser: development React under StrictMode must show the pill | restore `useRef(true)` with cleanup-only effect | browser 1F (pill never appears, 15 s timeout) | browser 2/2 |
