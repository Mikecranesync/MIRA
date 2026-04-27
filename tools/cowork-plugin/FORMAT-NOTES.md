# FORMAT-NOTES — what's guessed, what to verify

This plugin's manifest shape was authored without access to Cowork ground truth on the build machine: no Cowork CLI installed, no example Cowork plugin to reference, no `cowork-plugin-management` skill on disk. The shape below is a best-guess based on (a) the Claude Code skill convention (`<skill>/SKILL.md` with YAML frontmatter), and (b) the `<plugin>:<skill>` namespace pattern observed in Cowork's `available_skills` list (`engineering:debug`, `cowork-plugin-management:create-cowork-plugin`, etc.).

Treat this file as a debugging companion if install doesn't work first try.

## What's likely correct

These mirror Claude Code / generic plugin conventions and would be surprising if Cowork rejected them:

- **`SKILL.md` location and frontmatter format.** Claude Code reads `skills/<name>/SKILL.md`, parses YAML frontmatter for `name` + `description`. Cowork is built on Claude Code conventions; high confidence this matches.
- **`name`, `version`, `description` top-level keys.** Standard across npm, Python, Cargo, etc. Plugin systems almost universally accept these.
- **`skills` as a list of `{name, path}` objects.** Matches how Claude Code refers to skills internally.

## What's a guess

If install fails, these are the candidates to flip in order of likelihood:

| Field | Guess | Likely alternatives | How to find out |
|---|---|---|---|
| Manifest filename | `plugin.json` | `manifest.json`, `cowork-plugin.json`, `cowork.json`, `package.json` | The error from Cowork's install command will usually name the file it expected. Rename `plugin.json` to that. |
| Manifest format | JSON | YAML (`plugin.yaml`), TOML (`plugin.toml`) | Same — error message will name the parser that failed. |
| `skills` shape | array of `{name, path}` objects | Directory scan (any `skills/*/SKILL.md` is auto-included with no manifest entry); or array of strings (just the path); or `{<name>: <path>}` map | If install succeeds but the skill doesn't appear in `available_skills`, this is the most likely cause. Try removing the `skills` array entirely first — Cowork may auto-discover. |
| `author`, `license` | Top-level strings | Nested under a `package` or `metadata` key; or unrecognized and silently dropped | Lowest priority — these are decorative. |
| Skill `name` namespace | `mira-autonomous-run:autonomous-run` (plugin name + skill name) | `autonomous-run` only (plugin name not prepended) | Look for the exact namespaced name in Cowork's available_skills list after install. |

## Failure-mode triage

**"Plugin not found" / "Invalid plugin"** → manifest filename or format wrong. Try the alternatives in row 1 of the table.

**"Plugin installed but no skills appear"** → `skills` shape wrong. Remove the `skills` array and let Cowork directory-scan, OR change to a string array `["skills/autonomous-run/SKILL.md"]`.

**"Skill appears in list but never triggers"** → frontmatter `description` not being parsed correctly, OR skill name conflicts with another. Verify the `description` line (has all the trigger phrases) survived intact in the installed copy.

**"Trigger fires but skill content is wrong"** → the verbatim copy is stale. Re-copy from `/Users/charlienode/MIRA/.claude/skills/autonomous-run/SKILL.md`.

## Iteration loop

1. Run install command in Cowork → capture exact error string.
2. Match error string against the table above → flip the most-likely field.
3. Re-install. Repeat at most 3 times.
4. If still failing after 3 tries: the format diverges from Claude Code conventions in a non-obvious way. Find a working Cowork plugin (any one) and copy its manifest shape directly. Or share the error back to Claude Code.

## Two non-format issues to know about

These are unrelated to the manifest but will affect how the skill behaves once installed:

1. **Operator-memory entries the skill references may not exist.** `SKILL.md` step 7 of pre-flight tells Claude to read `automated_run_gates`, `mira_definition_of_done`, `mira_security_checklist`, `subagent_dispatch_rules`, `mira_overnight_scaffolding` from operator memory. None of these are in the current MIRA MEMORY.md index. The skill will instruct Claude to look for them and fail to find them. Pre-existing issue — fix in the source `.claude/skills/autonomous-run/SKILL.md`, not here.

2. **MIRA-specific paths assume the Cowork session's working directory is the MIRA repo.** If a Cowork session opens this skill while pointed at a different repo, the pre-flight will (correctly) refuse — the worktree path check expects `/Users/charlienode/MIRA` ancestry. That's intended; the skill is not a generic-purpose autonomous-runner.
