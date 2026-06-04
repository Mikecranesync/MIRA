# Command Center — Staging Test (CHARLIE)

PR #1593 · branch `feat/hub-command-center` · commit `36796590`

## How to test it

**Open on CHARLIE:**  → **http://127.0.0.1:3971/**

That one URL signs you in (mints a session cookie for the staging tenant) and drops
you on the Command Center, served against the **staging NeonDB** (`factorylm/stg`).

What you should see / try:
- Left tree = real staging namespace (13 nodes for tenant `e88bd0e8…`):
  Enterprise → Home Garage → Conveyor Lab → **Conveyor 1 🟢** → GS10 VFD / Micro820 PLC / Photoeye 1, plus Celestial Park + Knowledge Base.
- Header badge: **"1 live · 1 display"**.
- Click **Conveyor 1** → right pane frames the **live fault-detective dashboard**
  (Node-RED at 192.168.1.12:1880) with a 🟢 Live indicator.
- Click **Refresh** or wait 10 s — the tree re-polls and the green dot re-probes.
- The green dot is REAL: it reflects an actual server-side reachability probe of the
  display. Stop Node-RED (`:1880`) and within ~10 s the dot goes gray; restart → green.

## Why this is "staging"

Per `docs/environments.md` Gap-1, there is **no `mira-hub` in `docker-compose.staging.yml`**
(staging compose is engine-path-only). The documented staging environment is a **local
CHARLIE boot against `factorylm/stg`** — which is exactly this. Running on CHARLIE is also
what makes the green dot real: only CHARLIE can reach the LAN Node-RED display.

## Honesty caveat

This proves: the Hub page renders, migration 030 schema is present on staging
(`display_endpoints` already existed there), staging data populates the tree, and the
liveness probe works against a real display. It does **NOT** exercise the Phase-2
cloud-reachability gap — a remote/cloud Hub (prod) cannot reach CHARLIE's LAN display.
"Works in staging here" ≠ "works for the prod cloud Hub". That's Phase 2 (on-prem
Tailscale reverse proxy).

## Ports / processes

| Port | What | Launcher |
|------|------|----------|
| 3970 | Hub prod build, `-c stg` NeonDB | `./serve-command-center-staging.sh` |
| 3971 | one-click cookie-setter → redirects to :3970 | `/tmp/cc_stg_entry.py` |

Also still running from the dev view (optional, can kill): 3960 (dev hub) + 3961 (dev entry).

## Restart (if a server died)

```bash
cd /Users/charlienode/cc-view-worktree
./serve-command-center-staging.sh &                 # :3970
python3 /tmp/cc_stg_entry.py &                        # :3971  (token in /tmp/cc_stg_token.txt)
```

## Teardown when done

```bash
# kill the view servers
lsof -ti tcp:3970 tcp:3971 tcp:3960 tcp:3961 | xargs kill 2>/dev/null
# remove the isolated worktree
git -C /Users/charlienode/MIRA worktree remove /Users/charlienode/cc-view-worktree --force
```

## NOT done (your call)

- **Merge is intentionally NOT done.** `deploy-vps.yml` fires on `workflow_run: [Smoke Test]
  completed on main`, so merging PR #1593 → push to main → **auto-deploys to PROD**. That's
  the prod deploy we deferred to Phase 2. Merge only when you want it live in prod.

## Verified 2026-05-30 (post-review)

- **Iframe body renders** (not just the header): the framed Node-RED Fault Detective
  dashboard paints inside the viewer — panels Motor Speed / Current / Temp / State /
  Photo Eye / Faults. Node-RED sends **no** `X-Frame-Options` / CSP `frame-ancestors`
  header, so the embed is not blocked. Headline "watch the live screen" works E2E on staging.
- **Green case proven on :3970** (real probe → liveCount=1). **Gray case** (dead display →
  gray dot) was proven in DEV, not re-run on :3970 — try it live per the steps above.
