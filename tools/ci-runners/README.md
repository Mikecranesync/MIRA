# Self-hosted CI runners on Bravo (Option B)

Moves MIRA's high-volume CI off GitHub-hosted runners so the repository can go private without
paying for ~100,000 Actions minutes a month. Workflows that hold production secrets stay on
GitHub-hosted runners (they run rarely and fit in GitHub Pro's 3,000 included minutes).

## The switch (no-op until set)

Every non-production workflow job uses:

```yaml
runs-on: ${{ fromJSON(vars.MIRA_RUNS_ON || '"ubuntu-latest"') }}           # general jobs
runs-on: ${{ fromJSON(vars.MIRA_RUNS_ON_SERVICES || '"ubuntu-latest"') }}  # jobs with services:/compose
```

| Repository variable | Value to move CI to Bravo |
|---|---|
| `MIRA_RUNS_ON` | `["self-hosted","linux","arm64","mira-bravo"]` |
| `MIRA_RUNS_ON_SERVICES` | `["self-hosted","linux","arm64","mira-bravo-services"]` |

Unset = GitHub-hosted `ubuntu-latest` (today's behaviour). **Rollback = delete the variables.**
Proven both ways in a private test repo: unset ran on GitHub's `ubuntu-24.04`; set ran on Bravo.

**Never set these while the repository is public.** On a public repo anyone can open a pull
request whose code would then run on Bravo, inside the plant network.

## Moving parts

| File | Runs on | Job |
|---|---|---|
| `Dockerfile` + `entrypoint.sh` | Bravo, Colima VM `gha` (arm64 Linux, 6 CPU / 8 GB / 100 GB) | Official runner image + the tools MIRA workflows use without a setup step. One container = one job (`--ephemeral`, `--rm`). |
| `bravo-runner-supervisor.sh` + `com.factorylm.gha-runners.plist` | Bravo (launchd, KeepAlive) | Keeps 4 general slots (own network namespace each, so fixed ports don't collide) + 1 services slot (`--network host`, so `services:` containers are reachable on `localhost`; one slot, so their fixed ports can't collide). |
| `charlie-regtoken-refresh.sh` + `com.factorylm.gha-regtoken.plist` | CHARLIE (launchd, every 30 min) | Mints a 1-hour runner **registration** token with CHARLIE's `gh` login and hands only that to Bravo over SSH stdin. |

## Security model

- **Only a registration token reaches Bravo.** It can register runners to this one repository
  for one hour; it cannot read code or secrets. CHARLIE's GitHub login never leaves CHARLIE.
- **Ephemeral containers.** Each job gets a fresh filesystem; nothing persists between jobs.
- **No production secrets on Bravo.** Workflows that deploy, migrate, seed, sign, or use
  `environment: production` / Doppler `prd` stay hard-coded to GitHub-hosted runners.
- **The services slot uses host networking inside the dedicated CI VM**, not on Bravo itself and
  not in any product container. This is a deliberate exception to the "no `network_mode: host`"
  container rule in `.claude/rules/security-boundaries.md`, which governs MIRA services.
- Jobs can reach the Docker socket of the CI VM (needed for `docker build`/`compose`), so a job can
  start a container with any VM path mounted. **The VM therefore must not share Bravo's home folder**
  (Colima's default does): the `gha` profile mounts only `~/.gha/vm-share`, read-only. Verified on
  2026-10-23: before the fix a job could read `~/.ssh` and `~/factorylm/.env`; after it, neither is
  visible. A job can still affect other CI jobs on that VM, never Bravo's own files or Ollama.

## Install (after the repo is private)

```bash
# Bravo
brew install colima docker docker-buildx
mkdir -p ~/.gha/vm-share   # the ONLY host folder the CI VM may see (Colima's default shares all of $HOME)
colima start gha --cpu 6 --memory 8 --disk 100 --vm-type vz --arch aarch64 --runtime docker --mount $HOME/.gha/vm-share
# verify: must print NOT-READABLE
DOCKER_HOST=unix://$HOME/.colima/gha/docker.sock docker run --rm -v $HOME:/h alpine:3.20 sh -c 'test -d /h/.ssh && echo READABLE || echo NOT-READABLE'
mkdir -p ~/gha-runners ~/.gha/logs && cp Dockerfile entrypoint.sh bravo-runner-supervisor.sh ~/gha-runners/
(cd ~/gha-runners && DOCKER_HOST=unix://$HOME/.colima/gha/docker.sock DOCKER_CONFIG=$HOME/.gha/docker-config docker build -t mira-gha-runner:2.338.1 .)
cp com.factorylm.gha-runners.plist ~/Library/LaunchAgents/ && launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.factorylm.gha-runners.plist

# CHARLIE
cp com.factorylm.gha-regtoken.plist ~/Library/LaunchAgents/ && launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.factorylm.gha-regtoken.plist

# Then switch CI over
gh variable set MIRA_RUNS_ON --body '["self-hosted","linux","arm64","mira-bravo"]'
gh variable set MIRA_RUNS_ON_SERVICES --body '["self-hosted","linux","arm64","mira-bravo-services"]'
```

## Operate

- Runners: `gh api repos/Mikecranesync/MIRA/actions/runners --jq '.runners[] | "\(.name) \(.status) busy=\(.busy)"'`
- Logs: Bravo `~/.gha/logs/<slot>.log`, `~/.gha/logs/supervisor.out`; CHARLIE `~/Library/Logs/gha-regtoken.log`
- More capacity: raise `GENERAL_SLOTS` in the Bravo plist and the VM size (`colima stop gha && colima start gha --cpu … --memory …`).
- If CHARLIE is down for more than an hour, new runners stop registering (the token expires) and
  jobs queue. Quick relief: delete `MIRA_RUNS_ON` to fall back to GitHub-hosted runners (metered).

## Known limits

- arm64 Linux: workflows that need x86-only binaries or the Android SDK stay GitHub-hosted.
- Capacity: 4 + 1 slots vs. GitHub's ~20 concurrent hosted jobs, so busy PR bursts queue longer.
- Bravo also serves Ollama; CI load competes with local inference.
