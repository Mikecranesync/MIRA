# mira-autonomous-run — Cowork plugin

Packages the `autonomous-run` skill (operator discipline for unattended MIRA sessions) so it auto-discovers in Cowork the way it already does in Claude Code.

## Layout

```
tools/cowork-plugin/
├── plugin.json                          # Manifest (best-guess shape — see FORMAT-NOTES.md)
├── README.md                            # This file
├── FORMAT-NOTES.md                      # Honest accounting of what's guessed and how to iterate
└── skills/
    └── autonomous-run/
        └── SKILL.md                     # Verbatim copy of .claude/skills/autonomous-run/SKILL.md
```

## What it does

Once installed, Cowork sessions auto-trigger the same 7-check pre-flight (worktree isolation, branch check, PLAN.md scope-lock, hook wiring, override env vars, coordination check, operator-memory rules) on prompts like "run overnight", "while I sleep", "do this autonomously", etc. Same trigger phrases, same discipline as the Claude Code version.

The skill is **MIRA-context** — it references MIRA-specific paths (`tools/hooks/stop-gate.sh`, `docs/templates/overnight-PLAN.md`, `wiki/references/overnight-runs.md`, etc.). It only does useful work when the Cowork session is operating against the MIRA repo. That's intentional, not a portability bug.

## Install (TBD — verify command)

The exact Cowork install command was not verifiable from this machine when the plugin was authored (no Cowork CLI installed locally, no other plugins to reference). Try in this order from a Cowork session:

```bash
cowork plugin install /Users/charlienode/MIRA/tools/cowork-plugin
# or
cowork plugin add ./tools/cowork-plugin
```

If Cowork has a plugin UI, drag the `tools/cowork-plugin/` directory into it.

## Verify it loaded

1. Start a fresh Cowork session.
2. Ask: *"what skills do you have?"* — look for `mira-autonomous-run:autonomous-run` in the list.
3. In a session pointed at the MIRA repo, type: *"run this overnight"* — the skill should fire its pre-flight (it should refuse if you're not in a `.claude/worktrees/<name>` worktree).

## If install fails

See `FORMAT-NOTES.md` — it lists the most likely failure modes (wrong manifest filename, different `skills` shape, etc.) and the one-line fix for each. Capture the exact error from Cowork and either iterate from the notes or share the error back to Claude Code for adjustment.

## Source

The canonical SKILL.md lives at `/Users/charlienode/MIRA/.claude/skills/autonomous-run/SKILL.md`. The copy in this plugin is verbatim. If you update the source, re-copy it here (or symlink, if Cowork tolerates symlinks inside plugin directories).
