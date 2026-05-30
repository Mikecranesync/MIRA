# Handoff — amux + tmux on prod VPS

**From:** Claude Code (CHARLIE, MIRA repo)
**Date:** 2026-05-28
**Branch state:** `feat/fault-detective-scaffolding`, clean tree, 3 commits ahead of where this session started (chore/docs only — not engine code).

## What's done — durable state

### On prod VPS (`factorylm-prod`, `100.68.120.99` via Tailscale alias `prod`, ATL1)
- **tmux 3.4** at `/usr/bin/tmux` (already present; not installed by us)
- **amux v0.3.0** (mixpeek fork) at `/usr/local/bin/amux` + `/usr/local/bin/amux-server.py`. Source at `/root/amux/` (git clone)
- **Claude Code v2.1.154** (auto-upgraded from system v2.1.29 → user-local `/root/.local/bin/claude` during first `/login`). Authed to Mike's Claude Max account, default model `sonnet`. Mike completed OAuth on 2026-05-27 23:09
- **Scratch artifacts preserved** for re-running tests without rebuild: `~/amux-smoke/` (Fibonacci), `~/amux-L1/` (sphinx_clone + inventory.txt + samples.txt + elapsed.txt), `~/mira-amux/` (shallow clone of github.com/Mikecranesync/MIRA + L3's TASK.md)

### On CHARLIE
- `~/MIRA/.claude/settings.local.json` — added SSH permissions for `prod` / `prod-public` / `root@165.245.138.91` / `root@100.68.120.99` / `scp`. File is gitignored (per-clone)
- `~/vps-dev-tools/install-tmux-amux.sh` — idempotent bootstrap script archived
- `~/hermes-provision/` — earlier-deferred Hermes VPS scripts (cloud-init template, droplet-create script, namecheap DNS instructions). Hermes is deferred, scripts preserved for future
- 3 new commits on `feat/fault-detective-scaffolding`: hub-audit screenshots, competitor intel snapshot, routine eval/state files. NOT pushed.

### Memory entries written (`~/.claude/projects/-Users-charlienode-MIRA/memory/`)
- `reference_vps_ssh.md` — how to SSH to prod
- `project_amux_on_prod.md` — full amux state including L1/L2/L3 test results and the `--yolo` blocker
- Indexed in `MEMORY.md`

## Trust-ladder results (2026-05-27 → 2026-05-28)

| Level | Verdict | Why it matters |
|---|---|---|
| L0 smoke (Fibonacci) | PASS | wiring proven |
| L1 (sphinx inventory, 2088 files, 225s) | PASS | self-corrected on multi-dot extension bug; output capture intact |
| L2 (MIRA importer hunt + longest function) | **PARTIAL** — longest function `process_full` 990 lines @ L1103 was correct; importer count of 6 was wrong, real answer is 0 inside `mira-bots/shared/` (agent matched docstring text mentioning engine.py, not actual `import` statements) | **The most important failure mode found**: confidently produces plausible but wrong answers when the question has a semantic vs. text-pattern distinction. Don't delegate "find all callers/usages of X" without giving the agent codegraph or a verification step |
| L3 (wiki/hot.md freshness check) | PASS — correctly identified 2026-05-23 as 5 days old, branched to "FRESH ENOUGH", made no edit, didn't commit | "do not modify" constraint respected |
| L4 (real PR, do not merge) | NOT RUN — non-root user now exists (✅), but heavy/long runs are gated on the memory decision below |

### ⚠️ Memory decision blocks the heavy runs (items 2–4)
Prod is **prod + staging stacks co-resident on one 8GB box**. On 2026-05-29: `available` ~2.8Gi (fine for *bounded* single tasks — judge by `available`, not `free`), but **swap is exhausted (3.9/4.0Gi)**. Bounded tasks (smoke/L0/L1) are safe. *Unbounded* runs (L2 codegraph-init repo analysis, L4 real-PR edit/push, or any concurrency) risk crossing the 2.8Gi ceiling with no swap to absorb overflow → OOM killer fires hard and targets the fattest RSS, **likely a prod container**. This is a **Mike decision before L2/L4**: proceed anyway / move staging off this box / use a separate host. Don't discover it at 3am.

## Open / next session

1. **Create non-root user on prod for unattended use — ✅ DONE 2026-05-29.** Created `amux` (uid **2000**, off 1001 to dodge the docling container's host-UID mapping). Seeded auth by copying ONLY `/root/.claude/.credentials.json` → `/home/amux/.claude/` — no interactive `/login` needed (auth lives in that file; the smoke test authed with nothing else present). **Did NOT add amux to docker group** (docker = root-equivalent; unattended agents must not get prod docker access).

   Verified end-to-end: `sudo -iu amux claude --dangerously-skip-permissions -p "say hi"` → text; full `amux register --yolo` → start → send → real `Bash(echo …)` executed unattended with no approval prompt.

   **Three first-run gates** (interactive amux sessions only; `-p` print-mode skips them). All pre-cleared durably in `/home/amux/.claude.json`:
   | Gate | Symptom | Fix |
   |---|---|---|
   | theme picker | "Choose the text style…" | top-level `"hasCompletedOnboarding": true` |
   | trust folder | "Is this a project you trust?" (NOT bypassed by `--yolo`) | per-project `projects["<dir>"]["hasTrustDialogAccepted"]: true` — **pre-seed every new working dir** or it re-prompts |
   | bypass warning | "WARNING: Bypass Permissions mode" — default = **No, exit** | top-level `"bypassPermissionsModeAccepted": true` (interactive accept does NOT persist; set explicitly) |

   With all three set, a brand-new **empty** dir launches straight to the prompt (verified with a throwaway `/home/amux/clean-test` session, since removed). **Scope caveat:** this was proven on empty dirs only. A real repo clone (e.g. `mira-amux`) contains `.mcp.json`, which triggers a **4th gate — MCP-server approval** (not pre-seeded; the trust schema shows `enabledMcpjsonServers: []`) — and spawns those MCP servers (codegraph etc.) on startup, adding unmeasured resident memory right when the L2 run needs headroom. Before L2/L4: pre-seed `projects["<repo>"]["enabledMcpjsonServers"]` for the servers in its `.mcp.json`, and take a fresh `free -h` measurement of a real-repo session's footprint.

   **Quirk:** `amux send <name> "<text>"` auto-Enter is flaky — text lands unsubmitted. Follow with `amux send <name> --keys "Enter"`.

   Recipe for a new unattended dir:
   ```
   ssh prod 'sudo -iu amux mkdir -p /home/amux/<dir>'
   # pre-seed trust for <dir> in /home/amux/.claude.json projects map (see table)
   ssh prod 'sudo -iu amux amux exec <name> --yolo --dir /home/amux/<dir>'
   ```

2. **Re-run L2 with codegraph hints in TASK.md** (`prefer codegraph_search and codegraph_callers over grep`). Quick A/B test to see if the importer plausibility-trap goes away. Mind that the cloned `~/mira-amux/` repo doesn't have codegraph initialized — would need `npx -y @colbymchenry/codegraph init -i` first.

3. **Then L4**: real PR-shaped task from the issue tracker, branch + edit + push + PR, do NOT merge. Acceptance bar: 3 of 3 trial PRs land clean before trusting unattended use.

4. **Dashboard exposure decision still open**. `amux serve` binds `localhost:8822`. Options for phone access: SSH tunnel (`ssh -L 8822:localhost:8822 prod`), Tailscale Funnel, or Nginx reverse-proxy with auth. amux's own dashboard has no built-in auth.

5. **Disk check before any unattended runs**: prod was 67% used (53G free) when amux test ran. amux session logs + agent workspaces can grow — pre-flight `ssh prod 'free -h && df -h / && docker stats --no-stream'`.

6. **Branch hygiene**: 3 new commits on `feat/fault-detective-scaffolding` are routine docs/chore only. They probably belong on a separate `chore/routine-2026-05-28` branch and a PR, not bundled into the fault-detective feature work. Recommend: `git reset HEAD~3 && git stash && git checkout main && git checkout -b chore/routine-artifacts-2026-05-28 && git stash pop && commit again`. Or just cherry-pick to main when feat/fault-detective-scaffolding PR merges.

## Do not

- Don't try `amux register --yolo` while running as root on prod — it'll spawn claude which immediately exits.
- Don't run amux agents against `/opt/mira` (the live prod MIRA checkout). Use the scratch clone at `/root/mira-amux` or, post-non-root-user, `/home/amux/mira-amux`.
- Don't expose `amux serve` publicly without auth in front. The dashboard accepts commands.
- Don't push `feat/fault-detective-scaffolding` to remote without splitting the 3 routine commits off first (see #6 above).
- Watch for a **stale-token 401** on amux: `/home/amux/.claude/.credentials.json` is a *copy* of root's token taken 2026-05-29. If root's OAuth token refreshes in-place, amux's copy can go stale and 401. If that happens, that's the signal amux genuinely needs its own `/login` (the Mike-dependency we sidestepped) — re-copy the file or have Mike `/login` as amux; don't paper over it.

## CLI handoff prompt — paste into a fresh Claude Code session on CHARLIE

```
Read docs/handoffs/2026-05-28-amux-tmux-prod-vps.md.

Goal: stand up unattended amux use on the prod VPS by completing the next-session list.

Non-root `amux` user (uid 2000) is DONE + verified (item 1). FIRST: confirm Mike's
call on the memory blocker (prod+staging co-resident, swap exhausted) — L2/L4 are
unbounded runs that can OOM a prod container. Do not start them until that's settled.

Priority order (after memory decision):
2) Re-run L2 with codegraph-hinted TASK.md (init codegraph in ~/mira-amux first),
   compare against the recorded result (6 importers wrong, real=0).
3) Run L4 — pick a small read-only issue from `gh issue list --label "good first issue"`
   or whatever the labels actually are, give amux a branch + edit + push + PR task,
   DO NOT merge.

Constraints:
- prod-guard.sh hook is active. SSH to prod is allowlisted in .claude/settings.local.json.
- Never `docker compose` / restart containers on prod directly. Use deploy-vps.yml.
- Never commit settings.local.json (gitignored).
- The 3 commits on feat/fault-detective-scaffolding from 2026-05-28 should be split
  off to chore/routine-artifacts-2026-05-28 before that branch is PR'd.
```

— end —
