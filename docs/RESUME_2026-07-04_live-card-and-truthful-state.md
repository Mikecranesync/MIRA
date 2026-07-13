# RESUME 2026-07-04 — CV-101 live card: 12/12 tags, truthful state, visibly-live values

## State: everything merged + deployed to prod (verified)

**Morning (session 1):** e-stop demo captured live in `machine_state_window`; #2423 merged.

**This session (all on `main`, all deployed):**

| PR | What | Verified |
|---|---|---|
| #2425 | Seed backfill: 6 VFD-analyzer tags → `approved_tags` (gateway/relay parity; parity test now pins only `Config/conveyor/map`) | staging 0→64, prod 58→64 rows; ingest measured **12 tags per 2 s batch, rejected=0** |
| #2426 | Card v1: live-tags list (underlined `--status-green-ink`), freshness-aware `current_state`, 5 s poll | live on app.factorylm.com |
| #2429 | **Relay: `last_seen_at` = server NOW()** (client tag ts freezes under Ignition report-by-exception; skew grew 8→23 min on a healthy stream — prod-proven via the new db-inspect clock-skew probe) | post-deploy skew **00:00:00** |
| #2432 | **Historian on server time**: `historize_runs` reads/orders/stamps windows on `ingested_at`; real `now` → A0_OFFLINE (≥30 s) fires on a dead stream instead of pinning the last state | deployed `mira-historian-worker`+`beat`; window `ended_at` seconds-fresh and advancing |
| #2433 | Card v2: engineering units via `mira-hub/src/lib/gs10-display.ts` (**parity-pinned** against `ignition/webdev/FactoryLM/api/diagnose/tag_topic_map.py`; dc_bus ÷10 V, freq/current ÷100 Hz/A; status word → "Stopped · FWD"), **2 s poll**, `.signal-flash` on change, `· chg Xs ago`, SVG sparklines via new `/api/assets/[id]/signal-history` (ingested_at-keyed, 5 min/60 pts), anomalies deduped **×N** | deployed mira-hub |

Issues filed: **#2427** (WO wizard buttons say "Description"/"Review" — no `common.next` i18n key), **#2428** (WO save 500 — prime suspect: migration 060 `source_run_diff_id` never applied to prod; read the real `[api/work-orders POST]` error first), **#2431** (historian cross-window anomaly cooldown — A9 re-fires per window).

## The three timestamp-freeze bugs (one disease, three layers — all fixed)
Ignition stamps tags by VALUE CHANGE (report-by-exception): idle bench → frozen client ts.
1. Relay `live_signal_cache.last_seen_at` (#2429) → grey "last seen 8 min ago" on a healthy stream.
2. Historian window filter/clock (#2432) → State bubble pinned "faulted" forever.
3. Any future consumer: use `tag_events.ingested_at` (server), never `event_timestamp`, for freshness/windows.

## NEXT (in order)
1. **Mike: press Start on the bench** — `pe_latched` is a LATCHED PLC flag; clearing the beam is not enough. Bubble flips `faulted`→`idle` within one 30 s beat + one 2 s poll. Then screenshots (1440x900 + 412x915) → `docs/promo-screenshots/`.
2. **Bench diagnosis — frozen `vfd_dc_bus` register while stopped** (sparkline shows it honestly flat): watch the raw tag in Ignition designer; suspect the PLC's rotating GS10 poll (`poll_step` 1–4) not refreshing at idle, or stale RS-485. Read-only checks only (`.claude/rules/fieldbus-readonly.md`).
3. **#2428 WO save bug**: db-inspect prod → does `work_orders.source_run_diff_id` exist / is `060_work_orders_source_run_diff.sql` in `schema_migrations`? If missing → `apply-migrations.yml` dry-run → apply. Then #2427 (add `common.next` to en+es, relabel wizard buttons).
4. **#2431** historian anomaly cooldown (data layer; display already dedupes ×N).
5. Standing: `powercfg /change standby-timeout-ac 0` (elevated, bench laptop); collector resource pack (`docs/plans/2026-07-03-ignition-collector-resource-pack.md`); runbook "Known gap" §~125-134 now stale; relay h2c hardening; ISO-8601 gateway ts.

## Gotchas for the next session
- **⚠️ Concurrent sessions shared this checkout today.** A parallel session's WIP got swept into PR #2430 (closed; rebuilt clean as #2432). Its branch `feat/wiring-diagram-generator` still carries my stray commit `525e7415` on top — that session should drop it before opening its PR. Cloud-routine merges also moved main 3× mid-flight (VERSION re-bumps + conflicts). **Use `git worktree` when two sessions run; always `git branch --show-current` before committing; never `git add -A`.**
- Local branch `chore/db-inspect-equipment-kg` is pinned by worktree `C:/wt-db` (remove worktree to delete).
- `wiki/hot.md` + memory updated; hot.md changes are uncommitted in the tree.
- db-inspect now has a permanent **clock-skew probe** (live_signal_cache `updated_at - last_seen_at`) — use it whenever freshness looks wrong.
- E2E smoke's signup magic-link test flakes on repeat runs (rate-limit + strict-mode locator) — not a required check; don't chase it.
