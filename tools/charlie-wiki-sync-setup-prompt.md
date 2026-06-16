# CHARLIE Wiki Sync Setup — Claude Code Prompt

Paste the block below into a Claude Code session on CHARLIE (the `charlienode` user on `CharlieNodes-Mac-mini`). It mirrors the setup that BRAVO got on 2026-04-26: Obsidian opens `wiki/` as a vault, a launchd watcher auto-ingests `~/MiraDrop/*.md` into `wiki/raw/<date>/`, and an hourly cron pulls wiki updates from other nodes.

---

```
You are running on CHARLIE node (CharlieNodes-Mac-mini, user `charlienode`, Tailscale 100.70.49.126). I want you to set up the same wiki auto-ingest pipeline that's already running on BRAVO.

**Context:**
- The MIRA repo is at /Users/charlienode/Mira (verify with `ls`; if it's elsewhere, use that path everywhere below).
- The pipeline scripts live in `tools/` and are documented in `wiki/nodes/wiki-sync.md`. They were added on 2026-04-26 — make sure your checkout has them: `ls tools/install_wiki_raw_ingest.sh tools/install_wiki_pull_cron.sh tools/wiki_raw_ingest.py`. If those files are missing, fetch and checkout the branch they live on (ask the user; the BRAVO session left them on `codex/repo-sync-baseline` pending PR to main).
- CHARLIE already runs the eval-fixer agent which commits `docs(wiki): eval-fixer run …` to main. Don't break that. The auto-ingest script commits separately and never auto-pushes, so they won't fight.
- CHARLIE also runs the Telegram bot and Qdrant — leave those alone.

**Steps:**

1. **Confirm the wiki files exist locally.** If `tools/wiki_raw_ingest.py` is missing, stop and tell the user which branch to merge first.

2. **Open the vault in Obsidian.** Tell the user to install Obsidian (if not already), then "Open folder as vault" → /Users/charlienode/Mira/wiki/. The repo `.gitignore` already excludes `wiki/.obsidian/` and `wiki/.smart-env/`, so opening the vault will not pollute git. Wait for the user to confirm before proceeding to step 3 — this is the only manual UI step.

3. **Install the launchd auto-ingest watcher.** Run:
   ```
   bash tools/install_wiki_raw_ingest.sh
   ```
   Verify with `launchctl list | grep wiki-raw` — expect `com.mira.wiki-raw-ingest` listed. Then verify the plist content with `cat ~/Library/LaunchAgents/com.mira.wiki-raw-ingest.plist | grep WatchPaths -A1` — expect `<string>/Users/charlienode/MiraDrop</string>`.

4. **Install the hourly pull cron.** Run:
   ```
   bash tools/install_wiki_pull_cron.sh
   ```
   Verify with `crontab -l | grep mira-wiki-pull` — expect one entry pulling /Users/charlienode/Mira hourly.

5. **Smoke-verify the pipeline fires.** Run:
   ```
   echo "# charlie install verification $(date)" > ~/MiraDrop/charlie-verify-$(date +%s).md
   sleep 6
   cat ~/Library/Logs/wiki-raw-ingest.log
   git -C ~/Mira status -s wiki/raw/
   ```
   Expected log line: `INFO moved charlie-verify-….md -> wiki/raw/2026-04-26/charlie-verify-….md` (or similar).
   Expected git status: one new file under `wiki/raw/<today>/` and a new commit `chore(wiki): raw ingest charlie-verify-….md`.

   **If the log says "branch X not in allowed=['main']":** that's the safety guard firing because your checkout isn't on `main`. The file stays in `~/MiraDrop/` for later. Either (a) `git checkout main` and re-test, or (b) run the smoke test in a temp repo: `bash tools/wiki_raw_ingest.test.sh` — should print 7 passes.

6. **Do NOT push.** Per the operator doc, every node commits but only the human pushes. End of session: `git -C ~/Mira log origin/main..HEAD --oneline` to see what'll go up, then `git push` if the user approves.

7. **Update wiki/nodes/wiki-sync.md.** In the per-node table, change CHARLIE's row from "scripted only" to "Obsidian + `~/MiraDrop/` auto-ingest + scripted (eval-fixer)." Commit as `docs(wiki): mark CHARLIE wiki-sync as installed`.

8. **Report back.** Single message to the user: confirmation that all four checks passed (Obsidian opens, launchctl shows the agent, crontab shows the entry, smoke verification produced a commit), plus any deviations.

**What this does NOT do:**
- Does not install Syncthing or any cross-node filesystem replication. Wiki sync stays git-only.
- Does not change CHARLIE's existing eval-fixer cron or Telegram poller.
- Does not touch CHARLIE's Qdrant, Docker, or SSH config.

**Footgun to avoid:**
ALPHA's obsidian-git plugin auto-pushes on a timer and on 2026-04-25 stranded four wiki commits on `feat/comic-pipeline-v2` (see `wiki/nodes/wiki-sync.md`). On CHARLIE, if you install obsidian-git, set it to **commit-only, no auto-push**.
```

---

## After CHARLIE finishes

Update `wiki/nodes/wiki-sync.md` per-node table — CHARLIE row, "scripted only" → "Obsidian + auto-ingest + scripted." That marks the rollout as complete on the two macs you said you wanted in v1 scope.

ALPHA / TRAVEL / PLC / PI can run the same two installer scripts later when you're ready; the prompt above is reusable with the path swapped (e.g., `/Users/factorylm/Documents/mira/` for ALPHA).
