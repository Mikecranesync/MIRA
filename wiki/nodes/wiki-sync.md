---
title: Wiki Sync — How the Vault Lives on 6 Nodes
type: ops
updated: 2026-04-26
tags: [wiki, obsidian, sync, cluster, raw-ingest]
---

# Wiki Sync — How the Vault Lives on 6 Nodes

The wiki at `/Users/.../Mira/wiki/` is a plain-Markdown Obsidian vault. There is no SMB share, Syncthing, or live filesystem replication between cluster nodes. **All sync goes through git on this repo.** Each node has the wiki because each node has the repo cloned.

## Per-node setup

| Node | Wiki path | Updates | Push |
|---|---|---|---|
| ALPHA (`Michaels-Mac-mini-2`) | `/Users/factorylm/Documents/mira/wiki/` | Obsidian + obsidian-git auto-commit | auto-pushes (see footgun below) |
| BRAVO (`FactoryLM-Bravo`) | `/Users/bravonode/Mira/wiki/` | Obsidian (manual) + `~/MiraDrop/` auto-ingest into `wiki/raw/` | manual |
| CHARLIE (`CharlieNodes-Mac-mini`) | scripted only | eval-fixer agent commits `docs(wiki): eval-fixer run …` | manual |
| TRAVEL | scripted only | direct commits (`docs(wiki): capture travel-laptop session log …`) | manual |
| PLC, PI | not active for wiki | — | — |

`.gitignore` already excludes per-machine state:
- `wiki/.obsidian/`, `wiki/.obsidian/workspace*`, `wiki/.obsidian/app.json`, `wiki/.obsidian/appearance.json`
- `wiki/.smart-env/` (Smart Connections embeddings — local per-node)

So opening the vault on a new node never pollutes the repo with editor state.

## Auto-ingest from `~/MiraDrop/`

Drop a `.md` file into `~/MiraDrop/` on any node where the launchd watcher is installed. Within ~5 seconds:

1. The file moves to `wiki/raw/<YYYY-MM-DD>/<sanitized-name>.md`
2. A `chore(wiki): raw ingest <name>` commit is made on `main` (no auto-push)
3. The event is logged to `~/Library/Logs/wiki-raw-ingest.log`

Duplicates (same SHA-256 as something already under `wiki/raw/`) are removed from the drop folder and logged as `dedup-skipped`. The watcher refuses to run unless the repo is on an allowed branch (default `main`) — see footgun below.

**Install on a node:**
```bash
bash tools/install_wiki_raw_ingest.sh        # launchd watcher for ~/MiraDrop
bash tools/install_wiki_pull_cron.sh         # hourly `git pull --rebase --autostash`
```
Both are idempotent. Uninstall instructions are inside each script.

**Verify:**
```bash
echo "# test $(date)" > ~/MiraDrop/test-$(date +%s).md
sleep 6
git -C ~/Mira log -1 --oneline   # expect: chore(wiki): raw ingest test-...md
tail ~/Library/Logs/wiki-raw-ingest.log
```

## Footgun: obsidian-git pushed to the wrong branch

On 2026-04-25, ALPHA's obsidian-git plugin auto-committed and **auto-pushed** to whatever branch ALPHA's checkout happened to be on at the time — which was `feat/comic-pipeline-v2`, not `main`. Four wiki commits ended up stranded there and will never merge as-is.

Stranded SHAs (on `origin/feat/comic-pipeline-v2`):
- `22ac09a` — `wiki: session auto-commit 2026-04-25T02:27:07Z`
- `16b8c4d` — `wiki: session auto-commit 2026-04-25T00:53:45Z`
- `23595d3` — `wiki: session auto-commit 2026-04-25T00:48:51Z`
- `41383d8` — `wiki: session auto-commit 2026-04-25T00:45:21Z`

**Recovery (one-time, optional):**
```bash
git checkout main
git checkout 22ac09a -- wiki/log.md         # cherry-pick just the log delta
# (.smart-env/ blobs are now gitignored — they won't follow)
git diff --cached
git commit -m "docs(wiki): recover stranded log delta from 2026-04-25 ALPHA auto-commits"
```

**Prevention going forward:**
- The `~/MiraDrop/` ingest watcher (`tools/wiki_raw_ingest.py`) refuses to run if the repo isn't on an allowed branch. Default allowlist is `main`; override via `MIRA_WIKI_ALLOWED_BRANCHES` env on the launchd plist.
- ALPHA's obsidian-git should be reconfigured to **commit only**, not push. The user pushes manually at end of session — same way every other node already works.

## Why git, not Syncthing or SMB

- The repo is already on every node — zero new infrastructure.
- Conflicts surface as standard git merge conflicts, not as silent file-overwrite-wins races.
- Works offline (TRAVEL, PLC laptop on the factory floor) — commits queue locally, push when the node sees the network again.
- `CLUSTER.md` describes a `/Users/Shared/cluster/` SMB share on ALPHA, but that share is not currently mounted on BRAVO and is out of scope for the wiki.

If realtime sync between two nodes ever becomes necessary, point Syncthing at `~/MiraDrop/` only — never at the repo itself. The repo and Syncthing fight over file ownership.
