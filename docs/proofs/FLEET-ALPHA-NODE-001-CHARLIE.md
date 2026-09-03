# FLEET-ALPHA-NODE-001-CHARLIE — Independent review

**Verdict:** PASS (with tool-surface caveat below)
**Date:** 2026-09-03 ~12:45 AM ET
**Exact tip reviewed:** `6d84121c2d64fe885c3af690f6ee92fd7aaf25c8`
**Baseline parent:** `17f9a391aa68fb92f136bdf0a5206ce51fd544f7`
**Intermediate Bravo tip Mike named:** `8c5aeb82ac51c565a50e68d3268c249608070024` (Charlie FAILed enum gap → Bravo FIX → this tip)
**Host:** CharlieNodes-Mac-mini.local / charlienode
**Worktree:** `/Users/charlienode/MIRA-worktrees/fleet-e2e-FLEET-ALPHA-NODE-001-CHARLIE-CLAUDE-0ad06ac0cf94`
**CAO session (static review):** `cao-FLEET-ALPHA-NODE-001-CHARLIE-CLA-4870243a`

## How this review was produced

1. **Charlie Claude (independent, on Charlie)** performed a full static read of the Alpha delta (`contract.py`, `factory.py`, `worktree.py`, `service.py`, `mcp_rpc.py`, `mcp_api.py`, `test_node_routing.py`, `test_tools_list_role_enum.py`, Bravo proof). No code defects found. Session then self-reported **BLOCKED** because the CAO **reviewer** profile for `role=charlie` has **no Bash / Git / Write tools** (confirmed in-session via ToolSearch + hard error). It correctly refused to fabricate SHAs or pytest counts.
2. **Mechanical gates** (`git rev-parse`, `git log`/`diff --stat` vs baseline, `pytest`) were executed on this same Charlie worktree at the exact tip because Charlie Claude could not run them. Outputs are recorded below.
3. This proof file was written on CharlieNodes and pushed on a disposable review branch. **Do not merge.** #3533 / #3558 remain HELD.

**Caveat / follow-up:** Fleet Gateway maps `role=charlie` → CAO reviewer profile that strips shell/write. That breaks the "Charlie writes durable proof" loop. Needs a tooled Charlie review profile (Mike decision) — not done in this mission.

## Mechanical evidence (CharlieNodes worktree)

```
HOST=CharlieNodes-Mac-mini.local
USER=charlienode
HEAD=6d84121c2d64fe885c3af690f6ee92fd7aaf25c8
PARENT=8c5aeb82ac51c565a50e68d3268c249608070024

git log --oneline 17f9a391a..HEAD
6d84121c2 fix(fleet-gateway): FLEET-ALPHA-NODE-001 — include alpha in launch_worker role enum
8c5aeb82a feat(fleet-gateway): FLEET-ALPHA-NODE-001 — Alpha as third physical fleet node

git diff --stat 17f9a391a..HEAD
 docs/proofs/FLEET-ALPHA-NODE-001-BRAVO.md        | 83 +++++++++++++++++++++
 fleet-gateway/fleet_gateway/contract.py          |  7 +-
 fleet-gateway/fleet_gateway/factory.py           | 19 ++++-
 fleet-gateway/fleet_gateway/mcp_api.py           |  2 +-
 fleet-gateway/fleet_gateway/mcp_rpc.py           |  6 +-
 fleet-gateway/fleet_gateway/service.py           |  7 +-
 fleet-gateway/fleet_gateway/worktree.py          | 19 +++++
 fleet-gateway/run-local.sh                       |  3 +-
 fleet-gateway/tests/test_node_routing.py         | 93 ++++++++++++++++++++++++
 fleet-gateway/tests/test_tools_list_role_enum.py | 29 ++++++++
 10 files changed, 254 insertions(+), 14 deletions(-)

cd fleet-gateway && python3 -m pytest -q
94 passed in 2.41s
```

## Charlie static findings (no defects)

| Check | Result |
|---|---|
| Alpha in ALLOWED_ROLES, not REJECTED_ROLES | PASS |
| `mcp_rpc.py` role enum = `sorted(ALLOWED_ROLES)` (fixes 8c5aeb82 gap) | PASS |
| `mcp_api.py` docstring lists alpha | PASS |
| Fail-closed NodeRouter — no Bravo/Charlie fallback | PASS |
| `default_node="bravo"` only for node-less ops, not launch fallback | PASS |
| Alpha CAO/SSH/worktree wiring consistent (`/Users/factorylm/...`, ssh_host=alpha) | PASS |
| Alpha regression tests assert zero cross-node CAO calls | PASS |
| `test_unknown_node_fails_closed` still present | PASS |

## Gates vs Mike approval

- Exact tip after FAIL→fix contingency: `6d84121c` (not `8c5aeb82`) — PASS
- Minimal Alpha-only delta from proven Bravo+Charlie baseline `17f9a391` — PASS (10 files)
- No Bravo/Charlie regression / silent fallback path (static + tests) — PASS
- Tests green on tip — PASS (94)

## Authorization

- No merge, no deploy, protected sessions untouched.
- Live Gateway cutover / Alpha spawn / fail-closed live probes are separate Foreman steps after this proof lands.
