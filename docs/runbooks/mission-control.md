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

## Run the current capability

The homepage shows the current step from the repository roadmap, its ordered work,
the coordinator's next action, and each check's expected and observed results.
Use **Open acceptance record** to work in the existing #5232 coordinator comment.
The Project work sections show current issues, their linked PRs, and the next
capability's issues. The relationship file `tools/mission-control/project-links.json`
records which PR addresses each issue and which proof remains. GitHub supplies names
and states at refresh. When no closing PR is linked the row says so. These links do
not affect capability acceptance or production readiness. The GitHub board and
release evidence remain available under Engineering details.

1. The coordinator names one action, its owner, and the expected result. Link the
   PR or test run where the work is performed.
2. The owner records the observed result with its build, environment and receipt
   in their existing report. Use PASS, FAIL, BLOCKED or NOT TESTED; name the next
   owner/action when a result does not pass.
3. The coordinator reconciles the checks below in their existing owner comment.
   At handoff, read back the dashboard and preserve superseded runs in the comment
   history. Keep the accepted plan revision and runtime in the human receipt.
4. After all required checks and Mike's recorded decision, update the roadmap
   through its normal review. The dashboard follows the current row in the plan.

Mission Control reads one `capability-results` JSON fence above the first
`<details>` history block in the configured, trusted coordinator comment. Start
with these fields and replace the placeholder values. The human report above the
fence can remain in the existing DELIVERY.md format.

```capability-results
{
  "plan_revision": "<full plan revision shown by Mission Control>",
  "step": 1,
  "pr": 5625,
  "head": "<full reviewed PR head>",
  "build": "<full staged runtime SHA>",
  "environment": "staging",
  "action": {
    "title": "Walk the connected tablet",
    "owner": "CHARLIE Codex",
    "expected": "Find and select the drive, then Q1/MLC, with the draft retained.",
    "observed": "Awaiting the qualified runtime and device window.",
    "status": "BLOCKED",
    "next": "Verify the staging version and arrange the tablet window."
  },
  "results": [],
  "decision": null
}
```

Add one entry per acceptance ID using `id`, `status`, `observed`, `build`,
`environment`, and `receipt`. A passing row requires a GitHub receipt link.
For `decision`, link Mike's separate acceptance comment on #5232, beginning with
these six lines and the exact values from the coordinator's record:

```text
[CAPABILITY-ACCEPTED]
Plan revision: <full plan revision>
Step: 1
PR head: <full reviewed PR head>
Build: <full staged runtime SHA>
Environment: staging
```

Mission Control retrieves the comment and verifies the configured decision author
and matching fields. Keep previous
runs linked in the existing comment history. Blank results display as NO RECEIPT.
Rows whose plan/build differs stay historical. Candidate review and CI, deployed
ancestry, running build, and all required check receipts must agree before the
page displays Accepted. That label concerns the named capability and environment.

For the initial rollout, `MC_ROADMAP_REF=b07057c6255b4608faa243ca59becdc3b706456a`
selects the published proposal for Find the Right Equipment. Remove that pin after
the roadmap is adopted on main. The roadmap's Capability sequence table names a
single current row and links its sibling Markdown plan in the proof cell. The
linked plan provides the acceptance table and work sequence. Unchanged document
contents retain their revision across unrelated main commits within a running
service. If a service restart sees the same documents at a different main commit,
the coordinator may rebind the record after comparing both source documents.

Install the scoped open source renderer using
`python -m pip install -r tools/mission-control/requirements-workflow.txt` in the
dashboard environment. It reads Markdown tokens with HTML disabled; projected
values are escaped by the existing server renderer.

## The five-state lifecycle (owner standard, 2026-11-11)

States are never collapsed and "done" is not a state. Each cell lights only on the evidence in its row.

| Cell | Evidence that lights it | What can never light it |
|---|---|---|
| IMPLEMENTED | the PR exists with a head commit (GitHub record) | an agent saying so |
| TESTED | `statusCheckRollup = SUCCESS` at the **exact** head | a rollup at an older sha; a failed or pending rollup |
| REVIEWED | newest owner v2 `[CODEX-ADVERSARIAL-REVIEW]` with `reviewed_sha == head`, `reviewed_body_sha256` equal to the SHA-256 of the current PR body, and either `status: GREEN` with 0 BLOCKER / 0 HIGH / 0 MEDIUM, or CONVERGED (ISSUES_FOUND, 0 BLOCKER, 0 HIGH) plus a *later* owner `[REVIEW-FOLLOWUPS]` record in the canonical envelope (same head **and** body hash, `issues:` listing at least one distinct issue per MEDIUM, one when only LOWs remain) — the same rules as `tools/ui_surface_lifecycle_guard.py` | a GREEN at an older head or for an edited body; a legacy record (no body hash); a GREEN that lists any finding (LOW included — it is ignored as malformed); a non-owner ledger; a loose-prose follow-ups note; follow-ups posted before the verdict or naming no issue |
| DEPLOYED:staging / DEPLOYED:production | the PR is merged **and** `GET compare/{merge_sha}...{deployed gitSha}` reports `behind_by == 0` for that environment's `/api/version` | a string-equal sha with `behind_by > 0`; an unmerged PR; an unreachable environment (grey) |
| FIELD-VERIFIED | DEPLOYED:production **and** an owner comment starting `[FIELD-VERIFIED]` naming the sha production is **currently running** (`/api/version` `gitSha`), not the merge commit; production moving to a new sha un-lights it | CI, any deploy, a staging receipt, agent prose, a marker for the merge commit |

**GO** requires every candidate item DEPLOYED:production and FIELD-VERIFIED. A staging deploy can never light GO.

**What forces NO-GO regardless of the cells:** lifecycle evidence older than two poll intervals (it has its own clock; webhook or poll traffic never refreshes it), a candidate list built from a Project board snapshot that never loaded, whose last refresh failed, or that is older than `MC_BOARD_MAX_SECONDS` (default 600 — the board is a candidate *source*; a hole in it hides unready items), a failed evidence refresh (the last rows stay on screen, stamped with the error), a failed read of the coordination-issue comments (the lane reports are a candidate source too, so a 5xx, a timeout or a connection error anywhere in the poll iteration — events, comments, the per-comment lookup or the main-commit read — stamps the evidence with `report poll failed` every iteration until a complete read succeeds — cached reports never stand in for a read), or any candidate whose GitHub reads were incomplete (a comment page that failed, a per-PR GraphQL error) — that row shows every cell as "evidence incomplete" and the badge names it.

**CI pass-rate tile:** fed only by `workflow_run` / `check_suite` webhook deliveries with a conclusion. GitHub's REST events feed carries no workflow or check events, so a poll-only host (BRAVO, CHARLIE Stage A) shows `n/a` until Stage B registers the webhook.

**Only the coordination issue carries lane reports.** A `[DELIVERY-UPDATE]` comment on any other issue or PR (or another repo) is stored as an activity-feed event and never becomes a lane report or a candidate source, whether it arrives by webhook or poll; anything stored out of scope is removed on the next complete poll.

**Reports are reconciled, not only accumulated:** a comment edited so the marker is gone is *withdrawn* as of that edit's `updated_at` — older deliveries are rejected, a later edit that restores the marker brings it back; a comment that no longer exists is removed for good (webhook `deleted`, or a *confirmed* 404 on the comment itself after it was absent from a complete poll — absence from the pages alone is not proof, since page-number pagination skips a comment when an earlier one is deleted between page reads; any other lookup status is a failed read). A poll only judges the versions it captured before it began, and every removal is conditional on that exact version, so a webhook that lands mid-poll is never reconciled away; a late withdrawal webhook likewise removes only versions it postdates, and an older version of a comment never overwrites a newer one. A marker that only appears inside `<details>` is history, never the current report.
The Pilot Acceptance Ledger (`.planning/2026-11-10-garage-pilot/PILOT-ACCEPTANCE-LEDGER.md`, gitignored on CHARLIE) stays the authoritative pilot record; the cockpit never re-stores its rows (a header link to it is a follow-up; the file is not on a public URL).

**Candidate items** = open PR cards in Project #4 with Status "In Progress" that belong to `MC_REPO` (a card from another repository is never read as a PR number here) plus every `#n` named in a current trusted lane report. The set is never capped: the PR query is sent in batches of 25, so a 26th candidate is evaluated, not dropped.

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
| `MC_BOARD_MAX_SECONDS` | `600` | Project board snapshot age beyond which the candidate list is not trusted (NO-GO) |
| `MC_TRUSTED_AUTHORS` | `Mikecranesync` | comma-separated logins whose comments count |
| `MC_WEBHOOK_SECRET` | unset | enables `POST /webhook/github`; unset → 503 |
| `MC_ENV_PRODUCTION_URL` / `MC_ENV_STAGING_URL` | unset | `/api/version/` URLs (note the trailing slash: the hub 308s without it) |
| `MC_PLAN_REPORT_ID` | `6870960483` | designated coordinator comment for capability results |
| `MC_PLAN_ACCEPTOR` | `Mikecranesync` | GitHub author of the separate acceptance decision |
| `MC_ROADMAP_REF` | unset | optional full SHA for the proposed roadmap; otherwise follow main |
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

**launchd prerequisite:** `run.sh` reads the token with the Doppler CLI, which under launchd has no shell token. One-time on the node: `doppler configure set token-storage file` and `doppler configure set token <token> --scope /` (the file is mode 0600 in the Doppler config dir). Without it `err.log` shows `Doppler Error: you must provide a token` and the agent restarts every 30 s.

Staging reads "unreachable from this host" from BRAVO (the hub's `/api/version` is VPS-local); webhooks cannot reach a tailnet host, so BRAVO is poll-only (60 s).

### Stage A — upgrade CHARLIE to v2 (needs owner GO)

Run the CHARLIE install recipe above with the merged sha, the existing label and `charlie/run.sh`; add `MC_ENV_PRODUCTION_URL` to `run.sh`. Same limits as BRAVO: poll-only, staging grey.

### Stage B — private HTTPS on the OVH VPS (needs owner GO)

Use the systemd unit and nginx example in `tools/mission-control/vps`.
Start with authenticated HTTPS and GitHub polling on the existing OVH VPS.

1. Inventory the current nginx server block, service, address bound to port 8787,
   DNS, certificate and data directory. Save the previous release target and service
   configuration. Take a consistent SQLite backup with the SQLite backup API.
2. Put the reviewed Git archive under `/opt/mission-control/releases/<full SHA>`.
   In that release, create a Python 3.12 `.venv` and install the existing dashboard
   HTTP client (`httpx==0.28.1`) and `requirements-workflow.txt` into it. The
   base OVH system interpreter may lack httpx. Keep the shared data directory outside
   the release. For the proposed roadmap add `MC_ROADMAP_REF` in the
   `/etc/mission-control.env` systemd environment file. Test the release on a
   separate loopback port before switching
   `current`; record the archive revision in `DEPLOYED_SHA`.
3. Install the reviewed unit and authenticated nginx site. Use the site's TLS
   certificate for `mc.factorylm.com` and an individual bcrypt htpasswd entry for
   each authorized reader. Apply `nginx -t` before reloading. Keep the application
   on loopback and the webhook location closed for the poll-only rollout.
4. Verify public HTTPS redirects, then confirm unauthenticated requests to the
   page, snapshot, and health route are refused. With a test login, check plan and
   evidence freshness and the correct staging and production version probes.
   Walk the actual phone on cellular and tablet on Wi-Fi with Tailscale off.
   Record the dashboard build, URLs, observed results and access limitations in #4737.
5. If verification fails, restore the prior `current` target, unit and nginx
   site, then restart only Mission Control and reload nginx after its config check.
   Verify the prior private route and data. Use the existing BRAVO tailnet route
   while the external hostname is repaired.

## Not built (by design)

- The **Send** path (dispatcher, durable decision record, receipts). Phase 1 is read-only oversight: no autonomous merge, deploy, production control or agent command.
- Reading the Pilot Acceptance Ledger's rows (it is linked, not copied).
- Extra Project fields. Project #4 has only `Status` today; "Needs Mike" and "Blocked" come from labels.
