# Mission Control: private cockpit over Project #4, agent reports and GitHub evidence

**Status, 2026-11-12:** v1 (Project #4 board) deployed on CHARLIE since 2026-10-24, tailnet only.
v2 (this document's second half: agent reports, GitHub events, five-state evidence lifecycle,
GO/NO-GO) is built and runs on **BRAVO** as a candidate; hosting it on CHARLIE or the OVH VPS is
an owner decision (see "Stage A / Stage B"). **Send is disabled**. Tracking: #4737. Background and
the dispatch contract: PR #4736, `docs/proposals/project4-mission-control.md`.

## What it is

`tools/mission-control/server.py` serves one read-only page.

**The page (top to bottom):**
- **LIVE / STALE** pill and data-as-of times for the board, the last poll, the last webhook and the last evidence read.
- **GO / NO-GO** badge for the pilot candidate set, with the first failing reason, plus four tiles (reviewed items, CI pass rate from the feed, decisions for Mike, blocked lanes).
- **Environments:** staging and production `gitSha` / `builtAt` and how many merges on `main` are not deployed yet.
- **Decisions for Mike:** the `Decision for Mike` and `Blocked by / needs` lines from current trusted lane reports.
- **Agent lanes:** one card per lane (CHARLIE-CODEX, CHARLIE-CLAUDE, BRAVO-CODEX, BRAVO-CLAUDE and any other lane seen), from the newest trusted `[DELIVERY-UPDATE]` comment on the coordination issue (#5232).
- **Evidence lifecycle table:** per tracked PR, six cells IMPLEMENTED · TESTED · REVIEWED · DEPLOYED:staging · DEPLOYED:production · FIELD-VERIFIED, each lit only by independent evidence with a source link, and a last column showing what the agent *reported*.
- The v1 sections (**In progress**, **Needs Mike**, **Blocked**, **Card and record disagree**) and an **Activity** feed of the last 50 GitHub events (webhook or poll).

**Guarantees:**
- **Read-only.** One GraphQL *query* for the board, one aliased GraphQL query for PR heads/rollups, REST `GET`s for events, comments, compare and `/api/version`. No mutations, no model calls. The only `POST` is `/webhook/github`; every other `POST` is 405.
- **Reports never imply success.** A missing report reads "no report"; a report older than `MC_STALE_HOURS` (default 9) is grey "stale"; a report only ever *claims* a state — it never lights a lifecycle cell.
- **Trust is by author.** Only comments by `MC_TRUSTED_AUTHORS` (default the owner account) count as reports, Codex ledgers, `[REVIEW-FOLLOWUPS]` or `[FIELD-VERIFIED]` markers. Other authors are stored and shown as "untrusted author".
- **Webhook fail-closed.** Without `MC_WEBHOOK_SECRET` the route answers 503. With it, the body's HMAC-SHA256 must match `X-Hub-Signature-256` (401 otherwise); a redelivered `X-GitHub-Delivery` id is a no-op.
- **Stale sources force NO-GO.** If neither a poll nor a webhook landed in the last two poll intervals the pill reads STALE and the badge reads NO-GO.
- **Safe rendering.** Every value is HTML-escaped; links are limited to `https://github.com/` (plus the optional `MC_PLAN_URL` header link); no inline JavaScript (CSP `default-src 'self'`); not frameable.
- **Loopback only** unless `MC_ALLOW_NONLOOPBACK=1`.

## The five-state lifecycle (owner standard, 2026-11-11)

States are never collapsed and "done" is not a state. Each cell lights only on the evidence in its row.

| Cell | Evidence that lights it | What can never light it |
|---|---|---|
| IMPLEMENTED | the PR exists with a head commit (GitHub record) | an agent saying so |
| TESTED | `statusCheckRollup = SUCCESS` at the **exact** head | a rollup at an older sha; a failed or pending rollup |
| REVIEWED | newest owner `[CODEX-ADVERSARIAL-REVIEW]` with `reviewed_sha == head` and `status: GREEN`, or CONVERGED (ISSUES_FOUND, 0 BLOCKER, 0 HIGH) plus an owner `[REVIEW-FOLLOWUPS]` for the same head | a GREEN at an older head; a non-owner ledger; CONVERGED without follow-ups |
| DEPLOYED:staging / DEPLOYED:production | the PR is merged **and** `GET compare/{merge_sha}...{deployed gitSha}` reports `behind_by == 0` for that environment's `/api/version` | a string-equal sha with `behind_by > 0`; an unmerged PR; an unreachable environment (grey) |
| FIELD-VERIFIED | DEPLOYED:production **and** an owner comment starting `[FIELD-VERIFIED]` naming the production sha | CI, any deploy, a staging receipt, agent prose |

**GO** requires every candidate item DEPLOYED:production and FIELD-VERIFIED. A staging deploy can never light GO.
The Pilot Acceptance Ledger (`.planning/2026-11-10-garage-pilot/PILOT-ACCEPTANCE-LEDGER.md`, gitignored on CHARLIE) stays the authoritative pilot record; the cockpit never re-stores its rows (a header link to it is a follow-up; the file is not on a public URL).

**Candidate items** = open PR cards in Project #4 with Status "In Progress" plus every `#n` named in a current trusted lane report (capped at 25).

**Known gap:** the same event can arrive by webhook (delivery id) and by poll (event id) and appear twice in the feed. Lifecycle and reports are unaffected (keyed by sha and comment id).

## Agent reports (the contract)

The report format is `DELIVERY.md` from PR #5314 (`[DELIVERY-UPDATE: LANE]` blocks on #5232). The parser takes only the **top** block of a comment (history nested in `<details>` never counts), requires the marker and an `Updated:` line, and is strict about the enum lines: an absent `State:` / `Evidence:` / `Stage:` reads **not stated**, a value outside the enum reads **unparsed**. Free-text lane comments therefore render grey rather than green — that is the point. Two fields the cockpit would like that the template lacks (`Item: #n`, `Receipt: <url>`) are proposed on #5314, not forked here; until then `#n` references are taken from the whole block.

## Run it locally

```bash
GITHUB_TOKEN="$(gh auth token)" MC_DATA_DIR=/tmp/mc python3 tools/mission-control/server.py   # http://127.0.0.1:8787
```

`gh auth token` usually lacks `read:project`, so the v1 board shows "Refresh failed" while everything else works; the deployed services use Doppler `GITHUB_PAT`.

Health: `GET /healthz` → `{"items", "ok", "last_poll", "last_webhook", "evidence_at", "events", "reports"}`. Model: `GET /api/snapshot.json`.

**Tests:** `uv run pytest tests/test_mission_control*.py` — 92 tests on synthetic fixtures (28 v1 + 64 v2), every protected behaviour mutation-checked (the PR lists each mutation and its red count).

### Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `GITHUB_TOKEN` | required | `read:project` + repo read |
| `MC_PORT` / `MC_BIND` | `8787` / `127.0.0.1` | bind; non-loopback needs `MC_ALLOW_NONLOOPBACK=1` |
| `MC_DATA_DIR` | `~/Services/mission-control/data` | SQLite (WAL) location |
| `MC_REPO` / `MC_COORD_ISSUE` | `Mikecranesync/MIRA` / `5232` | repo polled; issue carrying lane reports |
| `MC_POLL_SECONDS` | `60` | REST poll interval (GitHub's `X-Poll-Interval` wins if larger) |
| `MC_STALE_HOURS` | `9` | report age after which a lane is grey |
| `MC_TRUSTED_AUTHORS` | `Mikecranesync` | comma-separated logins whose comments count |
| `MC_WEBHOOK_SECRET` | unset | enables `POST /webhook/github`; unset → 503 |
| `MC_ENV_PRODUCTION_URL` / `MC_ENV_STAGING_URL` | unset | `/api/version/` URLs (note the trailing slash: the hub 308s without it) |
| `MC_PLAN_URL` | unset | optional `https://claude.ai/artifact/...` header link (#4982) |

## Where it runs

### v1 on CHARLIE (deployed 2026-10-24)

| | |
|---|---|
| **URL** | CHARLIE's MagicDNS name on port 8443 (tailnet only); `tailscale serve status` on CHARLIE |
| **Code** | `~/Services/mission-control/current` (`git archive` of the deployed commit, `DEPLOYED_SHA` inside) |
| **Process** | LaunchAgent `com.factorylm.mission-control` → `tools/mission-control/charlie/run.sh`, binds `127.0.0.1:8787` |
| **HTTPS** | `tailscale serve --bg --https=8443 http://127.0.0.1:8787` (serve, not funnel) |
| **Token** | Doppler `factorylm/prd` `GITHUB_PAT` |

### v2 candidate on BRAVO (2026-11-12)

BRAVO already runs an unrelated static `python3 -m http.server` under the label `com.factorylm.mission-control` on 8787, fronted by `tailscale serve` on 443. v2 therefore uses **label `com.factorylm.mission-control-v2`, port 8790, HTTPS 8443**, and leaves that service alone.

```bash
SHA=<commit>; B=~/Services/mission-control-v2; REL=$B/releases/${SHA:0:8}
mkdir -p "$REL" "$B/logs" "$B/data"
git archive "$SHA" tools/mission-control | tar -x -C "$REL" --strip-components=2
echo "$SHA" > "$REL/DEPLOYED_SHA"
ln -sfn "$REL" "$B/current"
cp tools/mission-control/bravo/run.sh "$B/run.sh"; chmod 700 "$B/run.sh"
sed "s#__HOME__#$HOME#g" tools/mission-control/bravo/com.factorylm.mission-control-v2.plist \
  > ~/Library/LaunchAgents/com.factorylm.mission-control-v2.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.factorylm.mission-control-v2.plist 2>/dev/null \
  || launchctl kickstart -k gui/$(id -u)/com.factorylm.mission-control-v2
tailscale serve --bg --https=8443 http://127.0.0.1:8790
```

**Rollback:** point `current` at the previous release and `launchctl kickstart -k gui/$(id -u)/com.factorylm.mission-control-v2`.
**Remove:** `tailscale serve --https=8443 off`, then `launchctl bootout gui/$(id -u)/com.factorylm.mission-control-v2`.

Staging reads "unreachable from this host" from BRAVO (the hub's `/api/version` is VPS-local); webhooks cannot reach a tailnet host, so BRAVO is poll-only (60 s).

### Stage A — upgrade CHARLIE to v2 (needs owner GO)

Run the CHARLIE install recipe above with the merged sha, the existing label and `charlie/run.sh`; add `MC_ENV_PRODUCTION_URL` to `run.sh`. Same limits as BRAVO: poll-only, staging grey.

### Stage B — OVH VPS (needs owner GO; delivers webhooks, staging, off-tailnet phone access)

Files: `tools/mission-control/vps/mission-control.service` (systemd, `ubuntu` user, Doppler `prd`, binds `127.0.0.1:8787`) and `tools/mission-control/vps/nginx-mission-control.conf.example` (`mc.factorylm.com`, `auth_basic` on `/`, `/webhook/github` HMAC-only). The `deployment/` nginx tree and the compose files are guarded, so these are copied by hand, never by a workflow.

**Owner checklist (nothing here is done by this PR):**
1. DNS A record `mc.factorylm.com` → `40.160.141.61`.
2. `sudo certbot --nginx -d mc.factorylm.com`.
3. `sudo htpasswd -c /etc/nginx/.htpasswd-mc <user>` — private, authenticated access only.
4. Generate `MC_WEBHOOK_SECRET` (`openssl rand -hex 32`) into Doppler `factorylm/prd`.
5. Register the repo webhook: payload URL `https://mc.factorylm.com/webhook/github`, content type `application/json`, the same secret, events `pull_request`, `issue_comment`, `check_suite`, `workflow_run`, `push`, `deployment_status`.
6. `GITHUB_PAT` scopes: `read:project` + repo read.
7. `git archive <sha> tools/mission-control | sudo tar -x -C /opt/mission-control/current --strip-components=2`, copy the two files above, `systemctl enable --now mission-control`, then confirm `https://mc.factorylm.com/healthz` behind basic auth and a `202` in the webhook's "Recent Deliveries".

## Not built (by design)

- The **Send** path (dispatcher, durable decision record, receipts). Phase 1 is read-only oversight: no autonomous merge, deploy, production control or agent command.
- Reading the Pilot Acceptance Ledger's rows (it is linked, not copied).
- Extra Project fields. Project #4 has only `Status` today; "Needs Mike" and "Blocked" come from labels.
