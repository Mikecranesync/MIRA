# CodeGraph operational tooling (launchd)

Background on *why* this exists: `docs/tech-debt/2026-06-09-codegraph-evaluation.md`.
The incremental file-watcher silently drops call edges (`FOREIGN KEY constraint
failed`), so the call-graph degrades over time while `status`/`sync` still report
"healthy". `sync` cannot repair it — only `index --force` (a full reindex, ~7 s)
does. These pieces keep the index honest.

## Pieces

| File | Role |
|---|---|
| `tools/codegraph-canary.sh` | Corruption canary. Queries callers of `resolve_uns_path`; 0 callers ⇒ corrupt ⇒ auto `index --force`. Exit 0 healthy / 1 repaired / 2 repair-failed. |
| `tools/codegraph-force-reindex.sh` | Full `index --force`, then runs the canary to verify. Logs to stdout. |
| `tools/launchd/com.factorylm.codegraph-reindex.plist` | Daily (04:17) launchd job that runs the force-reindex. |
| `.githooks/post-merge` | After a merge/pull: `sync`, then the canary (force-reindex if call edges collapsed). Logs to `.codegraph/hook.log`. |

## Git hooks (one-time per checkout)

```bash
git config core.hooksPath .githooks
chmod +x .githooks/*
```

Verify: `git config core.hooksPath` → `.githooks`.

## Install the daily reindex job (CHARLIE)

```bash
cp tools/launchd/com.factorylm.codegraph-reindex.plist ~/Library/LaunchAgents/
launchctl unload ~/Library/LaunchAgents/com.factorylm.codegraph-reindex.plist 2>/dev/null
launchctl load   ~/Library/LaunchAgents/com.factorylm.codegraph-reindex.plist
launchctl list | grep codegraph-reindex      # confirm it's registered
launchctl start  com.factorylm.codegraph-reindex   # optional: run once now
tail -f ~/Library/Logs/codegraph-reindex.log
```

## Other nodes (Alpha / Bravo)

The plist paths are CHARLIE-absolute (`/Users/charlienode/MIRA`). On another
node, edit the `ProgramArguments`, `WorkingDirectory`, and log paths to match
that node's checkout and home directory before loading.

## Manual repair

```bash
tools/codegraph-force-reindex.sh   # rebuild + verify
tools/codegraph-canary.sh          # just check (self-heals if corrupt)
```
