# Mission Control: private Project #4 overview

**Status, 2026-10-24:** deployed on CHARLIE, reachable on the owner's Tailscale network only (see below).
**Send is disabled**. Tracking: #4737. Background and the dispatch contract: PR #4736,
`docs/proposals/project4-mission-control.md`.

## What it is

`tools/mission-control/server.py` serves one read-only page built from GitHub Project #4.

**The page:**
- Lists **In progress**, **Needs Mike**, **Blocked** and **Card and record disagree**.
- Shows status counts and a "data as of" time.
- Gives each card a rule-based recommendation: Mark Done, Reopen or close, Unblock, Decide, Hold or Continue.

**Guarantees:**
- **Reads every item.** The query pages through all ~1,940 cards, never just the first 100.
- **Cached.** It refetches at most every 5 minutes (`MC_CACHE_SECONDS`). A first load takes about 25 seconds; cached loads are instant.
- **Read-only.** One GraphQL *query*, no mutations, no model calls. `POST` returns 405.
- **Safe rendering.** All card text is HTML-escaped. Links are limited to `https://github.com/`.
- **Send stays disabled** until the dispatcher, permissions and delivery receipts in the proposal are built, approved and verified.
- **Loopback only.** It binds `127.0.0.1` by default (`::1` and `localhost` are also accepted) and refuses any other address unless `MC_ALLOW_NONLOOPBACK=1` is set.
- **Not frameable.** The page forbids other sites from embedding it (`frame-ancestors 'none'`, `X-Frame-Options: DENY`).

## Run it locally

```bash
GITHUB_TOKEN="$(gh auth token)" python3 tools/mission-control/server.py   # http://127.0.0.1:8787
```

Health check: `GET /healthz` returns `{"items": N, "ok": true}`.

**Tests:** `pytest tests/test_mission_control.py` (18 tests on synthetic fixtures). Each protected behaviour was mutation-checked, and every break failed its named test:
- escaping
- pagination
- case-insensitive status
- the loopback guard
- the disabled Send button
- not mutating the shared cached snapshot

## Where it runs (deployed 2026-10-24)

The owner chose **CHARLIE on Tailscale**: the OVH VPS has no Tailscale (#4741), and this keeps the page off the internet.

| | |
|---|---|
| **URL** | CHARLIE's MagicDNS name on port 8443 (tailnet only). Get it on CHARLIE with `tailscale serve status`; it is deliberately not written here because this repo is public |
| **Code** | `~/Services/mission-control/current`, a `git archive` of the deployed commit; see `DEPLOYED_SHA` in that folder |
| **Process** | LaunchAgent `com.factorylm.mission-control` runs `tools/mission-control/charlie/run.sh`, which binds `127.0.0.1:8787` |
| **HTTPS** | `tailscale serve --bg --https=8443 http://127.0.0.1:8787`. This is Tailscale *serve*, not *funnel*, so it reaches tailnet devices only |
| **Token** | Doppler `factorylm/prd` `GITHUB_PAT`, fetched at start. The owner chose this key and accepted its broad scopes on 2026-10-24; a `read:project`-only token would be enough |
| **Logs** | `~/Services/mission-control/logs/` |

### Install or upgrade to a newer commit

```bash
SHA=<commit>; B=~/Services/mission-control; REL=$B/releases/${SHA:0:8}
mkdir -p "$REL" "$B/logs"
git archive "$SHA" tools/mission-control | tar -x -C "$REL" --strip-components=2
echo "$SHA" > "$REL/DEPLOYED_SHA"
ln -sfn "$REL" "$B/current"
cp tools/mission-control/charlie/run.sh "$B/run.sh"; chmod 700 "$B/run.sh"
sed "s#__HOME__#$HOME#g" tools/mission-control/charlie/com.factorylm.mission-control.plist \
  > ~/Library/LaunchAgents/com.factorylm.mission-control.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.factorylm.mission-control.plist 2>/dev/null \
  || launchctl kickstart -k gui/$(id -u)/com.factorylm.mission-control
```

**Rollback:** point `current` at the previous release and run `launchctl kickstart -k gui/$(id -u)/com.factorylm.mission-control`.

**Remove completely:** run `tailscale serve --https=8443 off`, then `launchctl bootout gui/$(id -u)/com.factorylm.mission-control`.

## Verified on 2026-10-24 (deployed commit `1df50644`)

**From BRAVO, a different tailnet machine:**
- page 200 over HTTPS with a valid certificate;
- 1,938 cards read;
- all 74 Send buttons disabled;
- `POST` returns 405;
- plain HTTP on 8443 returns 400.

**Negative and recovery checks:**
- **Direct access to `:8787`** from the tailnet and from the LAN is refused.
- **From the VPS (off-tailnet):** the name does not resolve and no connection is made.
- **Killing the process:** launchd restarts it.

## Not yet done

The browser homepage and Android shortcut have to be set up on the owner's own devices. Those devices need the Tailscale app signed in with MagicDNS on. BRAVO could not resolve MagicDNS names, so check that setting first.

## Not built (by design)

- The **Send** path (dispatcher, durable decision record, Orca/Claude route, receipts). See the proposal's Send contract and acceptance checklist.
- Extra Project fields (owner, claim, expiry, evidence). Project #4 has only `Status` (Todo, In Progress, Done) today. "Needs Mike" and "Blocked" come from labels.
