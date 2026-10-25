# Orca as engineering mission control (CHARLIE)

Status: operating runbook, 2026-10-25. Extends the Project #4 proposal on
`docs/project4-orca-findings` (PR #4736). It does **not** create a tracker,
dispatcher, rule set or skill. It points at the ones that already exist.
Nothing here authorizes merge, deploy, paid review or new access.

Orca Desktop 1.4.237 (`com.stablyai.orca`). The CLI ships inside the app at
`/Applications/Orca.app/Contents/Resources/bin/orca` and is not on the login
`PATH`. Use the full path from a non-Orca terminal.

## 1. One project, four workstreams, one tracker

Orca carries one MIRA project (`github:mikecranesync/mira`). **GitHub
Project #4 is the only task store.** Orca Tasks, the read-only Mission
Control page (#4737) and this runbook all read it. None of them is a second
board.

Project #4 has a single-select **Workstream** field:

| Workstream | Covers |
| --- | --- |
| Release & Reliability | CI, deploy, staging/prod verification, migrations, incidents |
| Android & Technician UX | mira-mobile, Hub chat/notebook UI, device acceptance |
| Manuals, Retrieval & Safety | ingest, retrieval, citations, safety guardrails, evals |
| Pilot Customers & Revenue | pilot access, onboarding, billing, GTM evidence |

Set the field when an item is picked up. A bulk backfill of the roughly
1,945 existing items is an owner-approved batch, not a side effect.

## 2. Concurrency: three active agents at most

| Role | Count | Model | Does | Never does |
| --- | --- | --- | --- | --- |
| Implementer | 1 | Sonnet by default; Opus only for engine/inference/architecture | Steps 1–5 below in its own Orca workspace | Review its own work, merge, deploy |
| Independent reviewer | 1 | Codex (ChatGPT plan), read-only | Step 6 on a pinned SHA | Edit the branch |
| Coordinator | 1 | Haiku or Sonnet, short-lived | Reads Project #4, assigns one item, relays verdicts | Write code, poll in a loop |

Rules:

1. **Count before launching.** Run `tools/worktree-health.sh` and
   `orca worktree ps`. If three agents are already working, queue the item
   instead of starting another.
2. **Scheduled automations count against the cap while they run.** A run
   that finishes must leave no live agent behind. Prefer a precheck script
   (exit 1 = skip) over a model run that decides there is nothing to do.
3. **An idle agent terminal still counts until it is reconciled.**
   Reconcile = its branch is pushed or its PR is merged or closed, its claim
   is set to `RELEASED`/`COMPLETE`, and its last result is recorded on the
   issue. Then close the terminal. Do not close an unreconciled one.
4. Subagents are bounded per task: a read-only Haiku explorer is fine; writers
   need a worktree (`.claude/rules/subagent-worktree-isolation.md`). No fan-out
   workflows without the owner's explicit opt-in.

## 3. The engineering loop (each step names the existing tool)

| # | Step | Use | Evidence it leaves |
| --- | --- | --- | --- |
| 1 | One bounded objective | One Project #4 item, one `[WORK-CLAIM]` (`.claude/rules/multi-session-protocol.md` §2) | Claim comment with branch, base SHA, file scope |
| 2 | Reproduce | `investigator` agent / `diagnose` skill | Command plus the failing output, quoted |
| 3 | Failing regression test | `test-engineer` agent / `tdd` skill | The red run, captured **before** the fix |
| 4 | Smallest fix | `implementer` agent, own worktree | Diff touching only the claimed scope |
| 5 | Tests and CI | Local gates (`ruff format --check`, `ruff check`, affected suites), then `gh pr checks` | Green run on the **current** head SHA, with the new test names visible in the log |
| 6 | Independent review on a pinned SHA | `pr-review` skill; `[CODEX-REVIEW-REQUEST]` packet (`.claude/rules/factorylm-unified-ui-cutover.md` § Codex gate) | `[CODEX-REVIEW] PASS <sha>`. A Claude review is labelled PARTIAL and does not clear the gate |
| 7 | Evidence handoff | `session-handoff` skill; short handoff file plus issue comment | Branch, head SHA, tests, open risks, next owner |
| 8 | Owner approval for protected actions | Merge, deploy, migrations, paid runs, access, deletion | Owner's explicit yes, recorded on the issue |

`defect-workflow` packages steps 2–4 for defects. "Done" means the
capability-closure definition in root `CLAUDE.md`, not "merged".

## 4. Token-efficiency controls

| Control | How |
| --- | --- |
| Small sessions | One item per session. `/clear` once the handoff is posted; the Orca status line shows how many tokens that saves |
| Short handoffs | 15 lines or fewer: item, branch, SHA, red/green proof, risks, next action |
| File-scoped investigation | CodeGraph first (`codegraph_explore`), then targeted reads. No whole-repo greps |
| No model polling | Wait on CI with `gh pr checks --watch` or a Monitor until-loop, not repeated model turns. Automations gate on a precheck script |
| Bounded retries | Three review/remediation rounds at most, then escalate (multi-session protocol §6) |
| Bounded goals | `/goal` conditions must be checkable by a command. A goal that re-verifies the same evidence every turn is a loop: stop it and report |
| Model fit | Haiku for search/read, Sonnet for routine implementation, Opus only for engine/inference/architecture. Automations can pin a model with `--extra-agent-args="--model sonnet"` |

## 5. Orca settings that matter

- **Worktree setup script** (Repo settings → Hooks): currently `bun install`.
  On CHARLIE `~/.bun/bin/bun` (1.3.10) shadows Homebrew bun (1.4.0), while the
  repo pins `bun@1.4.0` and `lockfileVersion: 2`. Every new workspace therefore
  logs `Unknown lockfile version` and installs **without the lockfile**. Fix
  (owner action): upgrade `~/.bun` to 1.4.0, or set the setup script to
  `/opt/homebrew/bin/bun install --frozen-lockfile`.
- **Automations**: `orca automations list|show|runs`. Prefer `--disabled`
  while testing. Each automation needs a precheck, a lock, a checkpoint and an
  exit path that leaves no live agent.
- **Worktree inventory**: `tools/worktree-health.sh` attributes Orca
  workspaces (`*/orca/workspaces/*`) as "Orca workspace". It is
  detection-only; removal stays a human decision.

## Cross-references

- PR #4736 `docs/proposals/project4-mission-control.md` — Project #4 operating model and Send contract
- #4737 — read-only Mission Control page (separate claim; not modified here)
- `.claude/rules/multi-session-protocol.md`, `.claude/rules/session-discipline.md`
- `docs/agents/subagent-development-handbook.md` — investigator → test-engineer → implementer
