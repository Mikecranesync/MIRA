# Runbook — turn capture: what it records, how to check it, how to debug it

Covers the turn lifecycle (091/092), the ingress ledger (093), the lifecycle
invariant (094), the reconciler, and the live acceptance harness.

## The one-line model

Two independent ledgers, reconciled against each other:

```
turn_ingress      arrival + response      written by the route WRAPPER, before auth
decision_traces   started + closed        written by the RECORDER, after acceptance
```

Neither can vouch for itself. A turn missing from `decision_traces` is invisible
to any query of `decision_traces`; `turn_ingress` is what makes it a number.

## Check capture health

```bash
curl -s "$HUB/api/observability/coverage/?window_min=60" -H "Cookie: $SESSION" | jq
```

| field | healthy | what a bad value means |
|---|---|---|
| `lost_starts` | `0` | a 2xx was served and the ledger never heard about it — **capture defect** |
| `server_error_no_start` | `0` | a 5xx with no start: the turn was accepted and something broke |
| `starts_without_arrival` | `0` | the INGRESS side is failing — the mirror check |
| `accepted_unfinished` | `0` | turns open past the stale window; the reconciler should close them |
| `no_response_recorded` | small | arrivals whose response never landed; cannot be judged either way |
| `close_rate` | `1` | accepted turns that reached a terminal outcome |

`copy_text` in the same response is a paste-ready summary for an issue.

**The denominator is requests that reached the route handler.** `middleware.ts`
returns 401 for `/api/*` before the wrapper runs, and middleware is the edge
runtime where a durable write is impossible. Pre-route rejections are outside
every number here — `reconciliation_denominator` says so in the payload.

## "What happened to the turn I just sent?"

```bash
curl -s "$HUB/api/observability/coverage/?attempts=25" -H "Cookie: $SESSION" | jq '.attempts'
```

Per attempt: `accepted`, `closed`, `outcome`, `has_packet`, `http_status`,
`client_request_id`. No trace id needed — which is the point, since a technician
never sees one.

Clients may send `X-Client-Request-Id` (or `clientRequestId` in the body). The
header is read **before** parsing, so an attempt whose body is malformed is still
joinable to the client that sent it.

## Outcomes, and one that does not exist

`answered · refused · abstained · safety_stop · error · cancelled · superseded ·
abandoned`

- `abandoned` is written **only** by the reconciler — a start whose process died.
- `superseded` is an idempotent replay.
- **`timeout` is declared and never written.** The provider cascade has no timeout
  concept, so a slow provider surfaces as an exception and closes `error`. An
  empty `timeout` bucket is **not** evidence that no timeouts occurred.
  `outcome-reachability.test.ts` fails if that ever silently changes.

## The reconciler

`MIRA_TURN_RECONCILER=1` starts it from the instrumentation hook.
`MIRA_TURN_RECONCILER_STALE_MIN` (default 15, floor 5) and
`..._INTERVAL_MIN` (default 5). It appends `abandoned`; it never mutates a start.
Concurrent replicas are safe — the append is idempotent.

Off by default: it is the sole writer of `abandoned` and should earn each
environment rather than arrive with a merge.

## Live acceptance

Runs automatically after every staging deploy inside `retrieval-acceptance.yml`,
beside the six retrieval scenarios. Manually:

```bash
export ACCEPT_BASE=https://app-staging.factorylm.com ACCEPT_COOKIE='next-auth.session-token=…'
python3 tools/qa/capture_acceptance.py --notebook <uuid> --photo <jpg>
```

It pre-registers every attempt **before sending**, then reconciles — so
"never sent" and "sent but never recorded" stay distinguishable. It fails on
`lost_starts > 0` or `starts_without_arrival > 0`.

**The harness must ship in the deploy it audits.** The workflow checks out the
SHA staging reports, so a deploy predating the harness skips the step with a
`::notice::` naming that SHA. A skip is not a pass.

## Debugging a suspicious `lost_starts`

Before filing anything, rule these out in order — every one of them has produced
a false positive:

1. **A swept test tenant.** `provision-beta-gate.ts --cleanup` deletes
   `decision_traces` for its stranger. `turn_ingress` is now in that list too,
   but orphans from before that fix read as permanent lost starts.
2. **A tenant-scoped vs unscoped query.** The endpoint scopes to the caller; an
   ad-hoc SQL query across all tenants will show other people's traffic.
3. **A non-UUID notebook id.** Fixed — `openTurn` drops the id, not the row — but
   check the deployed SHA carries it.
4. **A replay.** Writes a lifecycle and closes `superseded`; it is not a loss.

Check `failure_counters.open_failed` — but note it is **process-local** and dies
on restart, which is exactly why the durable mirror exists.

## Migrations

`091` lifecycle columns · `092` the `(attempt_id, lifecycle)` unique index ·
`093` `turn_ingress` · `094` the closed-row invariant (an attempt-bearing closed
row must carry an outcome, so a writer that omits `lifecycle` fails loudly rather
than colliding silently).

⚠️ **091 cannot be re-applied to a database that already holds lifecycle data.**
It creates `UNIQUE (attempt_id)`, which 092 replaces precisely because a turn is
two rows. `migration-verify` re-applies every PR-touched migration directly
against staging, so a PR carrying 091 fails there. See `HANDOFF.md`.
