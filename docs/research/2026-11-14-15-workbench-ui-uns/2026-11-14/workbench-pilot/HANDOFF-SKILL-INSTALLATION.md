# Handoff skill installation receipt

> Publication note (2026-11-15): archived research and observations from the date stated below, not a current release-status report or new authorization. See the [collection index](../../README.md) and [private-evidence policy](../../PRIVATE-EVIDENCE.md).


2026-11-14, 17:32 ET. Requested by Mike as part of the drive + MLC verification loop.

## Installed and verified

- CHARLIE Codex: /Users/charlienode/.codex/skills/mira-handoff/SKILL.md
- BRAVO Codex: /Users/bravonode/.codex/skills/mira-handoff/SKILL.md
- CHARLIE Claude /handoff: /Users/charlienode/.claude/skills/handoff/SKILL.md
- BRAVO Claude /handoff: /Users/bravonode/.claude/skills/handoff/SKILL.md

Both Claude /handoff paths are symlinks to the existing mattpocock productivity
skill source. Added one MIRA-specific paragraph to the existing skill, pointing
to the shared Mission Control contract installed alongside the Codex skill.
Existing text was preserved. A future vendor refresh may replace local changes;
the versioned candidate below preserves the contract and repo handoff hook.

Codex invocation: `$mira-handoff`. Claude invocation: `/handoff`.
Existing running sessions should explicitly read the updated skill/reference;
installation is not proof that already-loaded instructions were refreshed.

## Validation

- Codex skill-creator quick validation passed on CHARLIE and BRAVO.
- All three Codex skill files matched byte-for-byte across the two installations.
- Both modified Claude handoff files matched byte-for-byte.
- The report example was parsed by the existing Mission Control parser: HANDOFF,
  VERIFIED, local, with expected fields recognized. A compound lane marker was
  rejected, reproducing the formatting risk addressed by the instructions.
- Repo-relative contract link resolved; staged diff passed whitespace checks.
- No product application tests were needed: changes are skill instructions only.
- No live status report was posted or another owner's record edited. The new
  handoff publication/readback workflow has not yet been executed by an owner.

SHA-256:

```text
2782013922087e0f8b49056e95e103dd63e621777f97217db117a6d559182ed5  mira-handoff/SKILL.md
301b4b027f6c85cb47c0419a5fcd9fa44c295936127367bd32166c399246f983  mira-handoff/agents/openai.yaml
76d47e85e12728ac6ba57bfc19cc2a804b7178862dcb7d45fd9362d77286bdac  mira-handoff/references/mission-control.md
ff4494d61c0d8d935a43a0609b42a29336f6840a6238af571b3ea5eed2634e0d  claude/handoff/SKILL.md
```

## Source candidate and recovery

Local branch `codex/handoff-mission-control`, based on eab62164d, in
/Users/charlienode/.codex/worktrees/e116/MIRA. Three skill files under
.agents/skills/mira-handoff plus one Mission Control paragraph in
.claude/skills/session-handoff/SKILL.md are staged, uncommitted and unpublished.
Only these new skill files were explicitly added from the ignored .agents tree.
No existing .agents content was swept into the change.

The project session-handoff addition is a local source candidate; it is not yet
present in every other checkout. The installed home Claude /handoff changes are
already on both hosts.

Original Claude skill backups:
- CHARLIE: /Users/charlienode/Documents/Codex/2026-11-14/workbench-pilot/skill-backups/charlie-claude-handoff-before.md
- BRAVO: /Users/bravonode/.claude/handoffs/skill-backups/2026-11-14-handoff-before-mission-control.md

To reverse, restore only the added paragraph after checking for intervening edits;
do not replace another session's later changes blindly. The Codex skills were new
installations, not replacements. No application merge, deployment or device run
was performed by this installation.
