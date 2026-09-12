# FLEET-PEER-NETWORK-001 — Slice A handoff

- **Owner/session:** `bravo-fleet-peernet-001a` (Claude Code), physical **Bravo** — generation 2.
- **Predecessor:** gen-1 `mira-97` (Claude, Charlie), transferred as a thin bundle
  (`cbacc99da1…c896…`), verified on Bravo (sha256 + `git bundle verify` + 4-commit ancestry) and
  continued from `c89648b9e` without recreating. Receipt confirmed on #3648; claim released to gen 2.
- **Branch:** `feat/fleet-peer-network-001a-contract` · **Worktree:** an isolated worktree created
  from the base SHA (path is local to the node — not recorded here, it is machine-specific).
- **Base SHA:** `f5f994a78d6d2f2e9393381662804f375dc59209`
- **Frozen candidate HEAD:** bound by the **immutable frozen-SHA comment on PR #3653** (a GitHub
  comment is the binding — this file is only a pointer and must never be the sole place a reviewed
  SHA is written).
- **Claim generation:** 2

## Status: all six Codex HOLD findings closed locally · FROZEN · not pushed (blocked on #3647)

| # | Finding | Fix (commit) |
|---|---|---|
| F1 | resolver normalised noncanonical resource keys the schema rejects | reject symmetrically w/ Codex-probe controls |
| F2 | `landed` root-pointer transition unsatisfiable vs the unconditional root-file ban | status-aware guard; landed permits only the exact additive pointer stanza (synthetic-diff controls) |
| F3 | product **deletions** evaded acceptance #11 (`--diff-filter=ACMR`) | `ACMRD`; hermetic tmp-repo control proves the mutation lands |
| F4 | `.fleet/` grandfather doc (pixel-acceptance) vs executable allowlist disagreed | added the exact branch→paths to `FLEET_ALLOWANCES`; doc↔table agreement test |
| F5 | `verdict`/`shell_command` could ride a non-`submit_verdict` payload | forbidden on every non-`submit_verdict` kind + `shell_command` everywhere; heartbeat controls |
| F6 | blank `human_gate.mission_id`; onboarding + README drift; 15 whitespace lines | mission_id pattern; `peer-contract` (not `test-unit`); README race-key + `BLOCKED`; whitespace |
| — | shared-file governance invisible in the repo | `docs/missions/README.md` §"fragments in, one composer out" |

## Changed files (vs `origin/main`)
`docs/peer-network/{START_HERE.md, pointers.status, schemas/README.md, schemas/*.schema.json (7)}`,
`docs/prd/2026-09-07-fleet-peer-network-001.md`, `deployment/network.yml` (metadata only),
`docs/missions/README.md`, `docs/missions/FLEET-PEER-NETWORK-001/{MISSION,HANDOFF,CLAIMS}.md`,
`tools/peer_network/{__init__,capabilities,claims,resource_keys}.py`,
`tests/peer_network/{__init__,requirements.txt,test_contract,test_contract_hardening,test_contract_hardening2,test_claims_resolver}.py`,
`.github/workflows/ci.yml` (always-run `peer-contract` job).

## Tests / verification (at the frozen head)
- `pytest tests/peer_network -q` → **183 passed** (python 3.12, pinned `tests/peer_network/requirements.txt`).
- `ruff check` + `ruff format --check` over `tools/peer_network` + `tests/peer_network` → clean.
- All 7 JSON schemas valid draft-2020-12; `git diff --check` clean; no machine paths/secrets in the diff.
- Runs in CI in its own **always-run `peer-contract` job** (`fetch-depth: 0`, no `changes:` filter,
  in `ci-gate.needs`, result consumed via `require_success`).
- Known property (**measured this session at the frozen head**): a full-history restore of the
  branch into a fresh single-branch clone yields **180 passed / 3 failed** (183 − 3) — the three
  are the ancestry/merge-base guards correctly failing closed because a single-branch clone has no
  `origin/main`. In a real-remote worktree they pass. If they ever PASS in a bundle-only clone,
  that is the defect. (The gen-1 "169/3" figure was pre-remediation; the count moved with the test
  count, the property did not.)
- **Not re-run this session:** the inherited 13/13 mutation battery (it is a documented list, not a
  located script). The reviewer should re-execute it against the frozen SHA; all six findings here
  ship with their own paired positive controls in-suite.

## Remaining work — BLOCKED on governance PR #3647 (still OPEN, head moves; bind to the head you measure)
1. **When #3647 merges:** rebase this branch **exactly once** onto the resulting `main`.
2. Add the two short root pointers (`CLAUDE.md`, `AGENTS.md` → `docs/peer-network/START_HERE.md`) as
   the **exact additive pointer stanza** (F2 guard permits only that), and flip
   `docs/peer-network/pointers.status` from `pending:#3647` to `landed`.
3. Re-run the full suite + CI + mutation/negative controls (the pointer tests flip on `landed`).
4. Push **one** coherent head, freeze it, record the 40-char SHA in a pinned #3653 comment.
5. Request a fresh **read-only Codex review on Charlie** against that exact SHA; after PASS, request
   **independent PLC-laptop verification** of the same SHA from a clean full-history checkout.
6. Do not merge — Mike is the sole merge/deploy authority. Alpha integrates only after both PASS.

## Resume (from an isolated worktree on this branch, in the repo root)
```
git fetch origin
pytest tests/peer_network -q     # expect 183 passed on a real-remote worktree
```
