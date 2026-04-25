## Why

#576 ships the webhook delivery system end-to-end: signing, retry, dead-letter, replay, URL guard, cron. **But the dispatcher is never invoked from the routes that should fire events.** The webhook subsystem is built and idle.

This issue tracks wiring `dispatchEvent()` into every event source in the codebase so customers actually see notifications when a work order opens, an alert fires, etc.

## Source

- `docs/competitors/cowork-gap-report-2026-04-25.md` §3.5
- `docs/competitors/pre-merge-review-2026-04-25.md` #576 functional-blockers section
- `mira-hub/src/lib/webhooks/dispatcher.ts` — already exists; just needs callers
- `docs/competitors/factory-ai.md` — leapfrog claim depends on this working

## Acceptance criteria

### Event sources to wire

For each, add a `dispatchEvent(...)` call after the relevant DB mutation commits. Use `withServiceRole` or the active `withTenant` client; never call from inside an open transaction (the dispatcher does its own DB write).

**Work orders (#565)**:
- [ ] `POST /api/v1/work-orders` → `workorder.created`
- [ ] `POST /api/v1/work-orders/{id}/transition` → `workorder.status_changed` with `{from, to, reason, force_skip}`
- [ ] PATCH that changes `assignee_id` → `workorder.assigned`
- [ ] Final `closed` transition → `workorder.completed`
- [ ] Daily cron pass: WOs past `due_at` with status != closed → `workorder.overdue`

**Assets (#562)**:
- [ ] `POST /api/v1/assets` → `asset.created`
- [ ] PATCH that changes `criticality` → `asset.criticality_changed` (specifically, this is what wires PagerDuty for many customers)
- [ ] DELETE → `asset.deleted`

**PMs (#566)**:
- [ ] Spawn worker creates a WO → `pm.spawned` (referencing both pm_id and the new wo_id)
- [ ] Cron tick finds an overdue PM → `pm.due_soon`

**Alerts (#569 / sensor data)**:
- [ ] FFT peak crosses configured threshold → `sensor.threshold_crossed`
- [ ] Anomaly resolved → `alert.resolved`
- [ ] Sensor offline > N minutes → `sensor.offline`

**Chat (#574)**:
- [ ] First message in a thread → `chat.thread_created`

**Integrations (#570 external events)**:
- [ ] OAuth-style integration linked → `integration.connected`
- [ ] Integration revoked → `integration.disconnected`

**Security**:
- [ ] API key rotated → `security.api_key_rotated`
- [ ] N failed logins in M minutes → `security.login_failed_repeated` (depends on rate-limit issue)

### Verification

- [ ] `grep -r 'dispatchEvent' mira-hub/src/app/api` shows callers in every route listed above
- [ ] `mira-hub/src/lib/webhooks/__tests__/integration.test.ts` (NEW) — for each event type:
  - Create a webhook subscribed to that event type
  - Trigger the source (insert WO, transition, etc.)
  - Assert a `webhook_deliveries` row appears in `pending` state within 1s
  - Run `processBatch()` against a test endpoint
  - Assert delivery status flips to `succeeded` and the body matches the expected envelope
- [ ] First-class recipe smoke tests:
  - Slack incoming webhook URL — JSON body renders as a Slack message
  - PagerDuty Events API v2 — `routing_key` field is present and dedupes on `asset.id`
  - Generic JSON — full envelope arrives unmodified
- [ ] No double-fires: PATCH that doesn't change criticality must NOT emit `asset.criticality_changed`. Add a test that asserts no row appears in `webhook_events` for a no-op update.

### Idempotency + ordering

- [ ] Each event row gets a stable `event_id` derived from the action. Re-running the same logical action (e.g. transitioning from `open` to `assigned` twice — illegal but theoretically possible via clock skew) does NOT create a second event row.
- [ ] Within a resource (same `wo_id`), events are queued in order of `created_at` so consumers see them in causal order.
- [ ] Across resources, ordering is **not** guaranteed — documented in the API ref already.

## Dependency order

- Hard dep on **#576** (the dispatcher itself).
- Soft dep on each feature branch (the routes don't exist on `main` until they land).
- Best landed as a sweep PR AFTER all feature branches are merged. Or, more pragmatically, included in each feature branch's sweep commit when it gets converted via the auth-sweep codemod.

## Out of scope

- The recipe UI on `/hub/integrations/webhooks` — that's part of #576 itself.
- Webhook delivery monitoring dashboard — separate issue, post-launch.
- Per-tenant rate limits on the dispatcher — already stored on `webhook_endpoints.rate_limit_per_min` but the worker ignores it. Track as v1.1.
