# Self-hosted CI runners on Bravo (Option B)

Moves MIRA's clean, high-volume CI jobs off GitHub-hosted runners so the repository can go
private without paying for every Actions minute. Anything that needs Docker, holds a
write-scoped token, uses an environment, or can reach production stays on GitHub-hosted runners.

## The switch (no-op until set)

Clean jobs use:

```yaml
runs-on: ${{ fromJSON(vars.MIRA_RUNS_ON || '"ubuntu-latest"') }}
```

| Repository variable | Value to move clean jobs to Bravo |
|---|---|
| `MIRA_RUNS_ON` | `["self-hosted","linux","arm64","mira-bravo"]` |

Unset = GitHub-hosted `ubuntu-latest` (today's behaviour). **Rollback = delete the variable.**
Proven both ways in a private test repo: unset ran on GitHub's `ubuntu-24.04`; set ran on Bravo.

**Never set it while the repository is public.** On a public repo anyone can open a pull
request whose code would then run on Bravo, inside the plant network.

## Which jobs may select Bravo (enforced)

`tools/ci_runner_placement.py` decides; `tests/test_ci_runner_placement.py` enforces it inside
the gated `test-unit` job of `ci.yml`. A job may select the pool only if it:

- needs no Docker: no `services:`/`container:`, no docker CLI, no container actions;
- holds no write-scoped token (job or workflow `permissions`);
- has no `environment:` and no production markers (`production`, `prd`, Doppler/deploy creds);
- is not in a control-plane or production workflow (lifecycle guard, R2 signal floor,
  deploy, migrate, seed, sign, release, QA cleanup).

The test was proven to fail: routing `docker-build-check` to Bravo, or deleting the checker's
Docker rule, turns it red.

## Isolation model

Each job runs in its own unprivileged container on the Colima VM `gha`, and gets **nothing**
from the VM: no Docker socket, no host network, no shared folder. Why: an earlier version
mounted the VM's Docker socket into every runner. Any job could then `docker exec` into a
sibling runner and read its token, start a privileged container and own the VM, or leave a
container behind to watch later jobs (independent review, PR #4658). Removing the socket removes
all three paths.

- Only a 1-hour, repo-scoped **registration token** reaches Bravo; CHARLIE's GitHub login stays
  on CHARLIE.
- One container per job (`--ephemeral --rm`), fresh filesystem every time.
- The VM shares **no** part of Bravo's home folder: Colima's default shares all of `$HOME`, so
  the `gha` profile mounts only `~/.gha/vm-share`, read-only. Verified 2026-10-23: before the fix
  a container could read `~/.ssh` and `~/factorylm/.env`; after it, neither is visible.

## Moving parts

| File | Runs on | Job |
|---|---|---|
| `Dockerfile` + `entrypoint.sh` | Bravo, Colima VM `gha` (arm64 Linux, 6 CPU / 8 GB / 100 GB) | Official runner image plus what clean jobs call without a setup step (gh, python3 + PyYAML/requests/markdown-it, psql, jq, shellcheck, node, rg), writable `/usr/local/bin` as on GitHub's image. One container = one job. |
| `bravo-runner-supervisor.sh` + `com.factorylm.gha-runners.plist` | Bravo (launchd, KeepAlive) | Keeps `SLOTS` (default 5) ephemeral runners alive. |
| `charlie-regtoken-refresh.sh` + `com.factorylm.gha-regtoken.plist` | CHARLIE (launchd, every 30 min) | Mints the registration token with CHARLIE's `gh` login, hands only that to Bravo over SSH stdin, removes offline registrations left by killed containers. |

## Install (after the repo is private)

```bash
# Bravo
brew install colima docker
mkdir -p ~/.gha/vm-share   # the ONLY host folder the CI VM may see
colima start gha --cpu 6 --memory 8 --disk 100 --vm-type vz --arch aarch64 --runtime docker --mount $HOME/.gha/vm-share
# verify: must print NOT-READABLE
DOCKER_HOST=unix://$HOME/.colima/gha/docker.sock docker run --rm -v $HOME:/h alpine:3.20 sh -c 'test -d /h/.ssh && echo READABLE || echo NOT-READABLE'
mkdir -p ~/gha-runners ~/.gha/logs && cp Dockerfile entrypoint.sh bravo-runner-supervisor.sh ~/gha-runners/
(cd ~/gha-runners && DOCKER_HOST=unix://$HOME/.colima/gha/docker.sock DOCKER_CONFIG=$HOME/.gha/docker-config docker build -t mira-gha-runner:2.338.1 .)
cp com.factorylm.gha-runners.plist ~/Library/LaunchAgents/ && launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.factorylm.gha-runners.plist

# CHARLIE
cp com.factorylm.gha-regtoken.plist ~/Library/LaunchAgents/ && launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.factorylm.gha-regtoken.plist

# Then switch clean jobs over
gh variable set MIRA_RUNS_ON --body '["self-hosted","linux","arm64","mira-bravo"]'
```

## Operate

- Runners: `gh api repos/Mikecranesync/MIRA/actions/runners --jq '.runners[] | "\(.name) \(.status) busy=\(.busy)"'`
- Logs: Bravo `~/.gha/logs/<slot>.log`, `~/.gha/logs/supervisor.out`; CHARLIE `~/Library/Logs/gha-regtoken.log`
- More capacity: raise `SLOTS` in the Bravo plist and the VM size.
- If CHARLIE is down for more than an hour, new runners stop registering (the token expires) and
  jobs queue. Quick relief: delete `MIRA_RUNS_ON` to fall back to GitHub-hosted runners.

## Known limits and cost

- Measured split (7 days of MIRA history): roughly 60,000 runner minutes a month move to Bravo,
  roughly 69,000 stay GitHub-hosted. On GitHub Pro (3,000 included) that is about 400 dollars a
  month, versus about 600 to 900 with everything hosted. The hosted half is mostly Docker jobs in
  `ci.yml`, the lifecycle and R2 control plane, and production smoke/staging gates.
- Cheaper later (each needs its own review): a separate, disposable VM for Docker jobs; allowing
  non-control-plane write-token jobs now that runners share nothing.
- Hash-locked tool sets (`tools/migration-drift-requirements.txt`,
  `requirements/ui-lifecycle-guard.txt`) pin x86_64 wheels; the jobs that install them are in
  hosted workflows anyway.
- Private-repo token permissions: a public repo serves clones, PR files and run lists to anyone;
  a private one only to a token with `contents`/`pull-requests`/`actions` read. Jobs that declare
  `permissions:` must list what they read.
- Capacity: 5 slots vs GitHub's ~20 concurrent hosted jobs, so busy PR bursts queue longer.
- Bravo also serves Ollama; CI load competes with local inference.
