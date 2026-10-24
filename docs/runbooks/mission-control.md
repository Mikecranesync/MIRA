# Mission Control: private Project #4 overview

**Status, 2026-10-24:** built and tested as a **local preview only**. It is **not hosted anywhere**, and
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

## Hosting: needs owner approval before anything is set up

Nothing below has been done. Each step needs explicit approval.

1. **A server credential.**
   - The Project is owned by a personal account. GitHub Apps and fine-grained tokens **cannot** read user-owned Projects v2.
   - The only working option is a **classic** token with `read:project` plus `repo`. `repo` is broad (read *and write* on every repository), so store it in Doppler and only on the host that runs this.
2. **Where it runs:**
   - **(A, recommended) Tailscale-only on the VPS.** Bind to the VPS tailnet address only. No public DNS or certificate, nothing reachable from the internet. Your phone and computer need the Tailscale app signed in.
   - **(B) Public subdomain.** Needs a DNS record, a TLS certificate, a web-server site and an authentication layer in front. All four are security or DNS changes.
3. **How it runs.**
   - Production changes go through `deploy-vps.yml` only (no hand-run services on the VPS).
   - That means a compose entry, which sits in a guarded path. It needs one Codex review or an explicit owner exception, then a merge, staging and acceptance receipts, and your production approval.
4. **Entry points, after hosting exists:**
   - a browser homepage or startup tab on your computer;
   - an Android home-screen shortcut (Chrome → ⋮ → Add to Home screen).

## Not built (by design)

- The **Send** path (dispatcher, durable decision record, Orca/Claude route, receipts). See the proposal's Send contract and acceptance checklist.
- Extra Project fields (owner, claim, expiry, evidence). Project #4 has only `Status` (Todo, In Progress, Done) today. "Needs Mike" and "Blocked" come from labels.
