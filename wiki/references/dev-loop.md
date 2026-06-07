# Dev Loop — Pre-Commit + On-Save Eval Watcher

Velocity #3 ships two shift-left layers so regressions surface before push, not 8 minutes after.

## Install (one-time, per checkout)

```bash
bash tools/setup_precommit.sh
```

Idempotent. Re-run anytime.

Installs `pre-commit` + `watchdog` and registers the git hook. Works on Windows (Git Bash), macOS, Linux.

## What fires on every `git commit`

| Hook | What | Why | Time |
|------|------|-----|------|
| `ruff` | lint + auto-fix | catches typos, unused imports, style | <1s |
| `ruff-format` | format | no-bikeshed formatting | <1s |
| `pyright` | type check | catches type mismatches CI would catch | 5-15s |
| `bandit` | security scan | mirrors CI (`.bandit.yml`, severity high) | 2-5s |
| `gitleaks` | secret scan | mirrors CI (`.gitleaks.toml`) | <1s |
| `actionlint` | GitHub Actions workflow lint | catches the duplicate-key / schema / parse errors GitHub rejects at load time (e.g. #1725); runs on staged `.github/workflows/*.yml` only. Needs `brew install actionlint`. | <1s |
| `fsm-smoke` | engine + Q-trap + guardrails unit tests | catches the regression class PR #411 fixed | 5-30s |

Total budget: **<60s** on a typical commit.

Bypass any hook for emergencies: `git commit --no-verify`

## Watcher (opt-in, manual)

For prompt-tweak sessions. Run in a side terminal:

```bash
doppler run --project factorylm --config prd -- python tools/eval_watch.py
```

(Doppler needed because the watcher runs real eval scenarios — Claude/Groq API calls.)

On every save in `mira-bots/shared/`, `mira-pipeline/`, or `tests/eval/fixtures/`:
- Debounces 500ms (collapses VS Code auto-save bursts)
- Runs the 10 fixtures listed in `tests/eval/watch_set.txt`
- Prints one line per fixture + `N/M passed in T.Ts`
- Target: **<60s per loop** (depends on LLM latency; trim watch_set if slower)

`Ctrl-C` to stop. `python tools/eval_watch.py --once` runs once and exits.

## Tuning

- **Add/remove smoke unit tests:** edit `.pre-commit-config.yaml` under the `fsm-smoke` hook's `entry`.
- **Add/remove watcher fixtures:** edit `tests/eval/watch_set.txt` (one filename per line; `#` comments OK).
- **Add a hook:** add a new `repos:` entry in `.pre-commit-config.yaml`, then `bash tools/setup_precommit.sh` to refresh.

## What's NOT in pre-commit (and why)

| Out of scope | Why | Where it runs |
|--------------|-----|---------------|
| LLM-as-judge | 5-30s per scenario × 10+ = blows budget; needs API keys | nightly CI eval |
| Full 51-scenario eval | CI's job (PR + nightly) | `.github/workflows/ci-evals.yml` |
| Trivy CVE scan | Only meaningful on built images | `.github/workflows/ci.yml` `docker-build-check` |
| Doppler env validation | Live secrets aren't in scope at commit time | runtime |

## Coexistence with `.claude/settings.json`

The existing Claude-Code `PreToolUse` gitleaks hook in `.claude/settings.json` stays — it guards Claude-driven commits. Pre-commit's gitleaks hook covers all commits (Claude + human). Both run gitleaks; gitleaks is fast (<1s), so the duplicate cost is negligible.

A future PR may consolidate after adoption is confirmed.

## Spec + plan

- Spec: `docs/superpowers/specs/2026-04-19-velocity-3-precommit-smoke-design.md`
- Plan: `docs/superpowers/plans/2026-04-19-velocity-3-precommit-smoke.md`

## Claude Code v2.1+ commands worth knowing (added 2026-05-07)

| Command | Use it for |
|---------|-----------|
| `/effort` | Tune effort interactively. **Set `xhigh` for engine.py / shared/inference / mira-mcp work.** |
| `/usage` | What's eating your 5-hour budget. Run before kicking off an autonomous session |
| `/mcp` | Per-server tool counts. Zero-tool servers are flagged — fast misconfig diagnosis |
| `/autofix-pr` | Native CI auto-fix. Alternative to `bash scripts/pr_self_fix.sh <PR>` |
| `/team-onboarding` | Replayable setup guide for new MIRA contributors |
| `/loop` (no arg) | Self-paced autonomous loop — use for poll-style work |

Pre-commit picks up `CLAUDE_CODE_SESSION_ID` automatically (v2.1+) and logs to `.git/claude-sessions/log` so you can correlate failed hooks back to the session that ran them.

Full v2.1+ reference + Routines list: `wiki/references/claude-code-v2.1.md` and `wiki/references/routines.md`.
