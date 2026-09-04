# AUTONOMOUS-FOREMAN-V1 — Implementer Handoff

**Task ID:** AUTONOMOUS-FOREMAN-V1  
**Issue:** https://github.com/Mikecranesync/MIRA/issues/3566  
**Draft PR:** https://github.com/Mikecranesync/MIRA/pull/3567

## Node Identity (Bravo proof)

| Field | Value |
|---|---|
| Hostname | `FactoryLM-Bravo.local` |
| User | `bravonode` |
| Worktree | `/Users/bravonode/Mira-worktrees/fleet-e2e-AUTONOMOUS-FOREMAN-V1-b4c5b203a3bb` |
| Provider | Claude Sonnet 4.6 |

## Git

| Field | Value |
|---|---|
| Base SHA | `d16faa5ed000a22319cf45688aff3293a0c1db6f` |
| Branch | `fleet/AUTONOMOUS-FOREMAN-V1` |
| Head SHA | `c2aad8f04ed53d034d788d7fef097021930c665f` |

## Tests

```
pytest mira-bots/foreman/test_mission_loop.py -v
```

**Result:** 73 passed, 0 failed, 0 errors  
**Ruff:** clean (`ruff check` + `ruff format --check`)

## Files Shipped

| File | Purpose |
|---|---|
| `mira-bots/foreman/mission_loop.py` | Pure Foreman management policy (AC A–H) |
| `mira-bots/foreman/test_mission_loop.py` | 73 hermetic offline tests |
| `docs/missions/AUTONOMOUS-FOREMAN-V1.md` | Mission spec (AC A–J copy) |
| `mira-bots/foreman/README.md` | Pointer to mission_loop.py |
| `docs/missions/AUTONOMOUS-FOREMAN-V1.HANDOFF.md` | This file |

## AC Status

| AC | Description | Status |
|---|---|---|
| A | Manager ≠ implementer | ✅ No open_worktree/edit_file/commit on ForemanPolicy |
| B | Max one implementer | ✅ Second dispatch refused when one RUNNING |
| C | Charlie reviews exact SHA | ✅ 40-char hex required; branch names rejected |
| D | No merge / no deploy | ✅ can_merge/can_deploy always return allowed=False |
| E | HELD stays HELD | ✅ PRs #3533/#3558 + HELD-titled PRs refused |
| F | Hard boundaries | ✅ 18 forbidden actions including gateway/tunnels/Doppler/secrets |
| G | GitHub source of truth | ✅ MissionState JSON round-trip; save_state/load_state |
| H | GO/NO-GO shape | ✅ Exactly "GO"/"NO-GO" + PR URL + SHA + reviewer verdict + human gates |
| I | Isolation | ✅ Branch fleet/AUTONOMOUS-FOREMAN-V1 from base SHA, worktree |
| J | Tests | ✅ 73 tests, ruff clean |

## What Mike Must Do

1. Dispatch a Codex session on physical Charlie to independently review exact SHA `c2aad8f04ed53d034d788d7fef097021930c665f`
2. If Charlie returns PASS: merge the Draft PR via `gh pr merge 3567 --squash`
3. If Charlie returns FAIL: dispatch a Bravo fix round, re-review the new SHA

## Not Touched

- `fleet-gateway/` — no changes
- Tunnels / Cloudflare / Tailscale — no changes
- `docker-compose.saas.yml` — no changes
- Inference cascade — no changes
- Hub / mobile product code — no changes
- PRs #3533 / #3558 — HELD, untouched
