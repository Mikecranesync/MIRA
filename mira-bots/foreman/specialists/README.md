# Foreman Specialist Dispatch Roles

Roles Foreman delegates to. One markdown file each; adding a role is a file, not a code change.

## The hierarchy

```
Mike -> Foreman (manager, only one who talks to Mike)
          -> specialist ROLE     ... what KIND of work this is (these files)
               -> Claude/Codex WORKER  ... who performs it
                    -> Alpha|Bravo|Charlie ... which physical COMPUTER
```

Alpha, Bravo and Charlie are computers. Never roles, never agent identities.

## Two axes, deliberately separate

| | |
|---|---|
| **Dispatch role** | the eight files here — Foreman-side vocabulary |
| **`WorkerRole`** | `mission_loop.WorkerRole` — what actually gets launched |

Not the same axis. Three roles are `plane: grok` and **never launch a worker at all**:

| Plane | Roles | Launches a worker? |
|---|---|---|
| `grok` | mission-planner, repo-archaeologist, product-researcher | No |
| `fleet` | software-engineer, fleet-engineer → `IMPLEMENTER`; adversarial-reviewer → `REVIEWER`; verifier-qa → `VERIFIER` | Yes |
| `advisory` | industrial-robotics-engineer | Only on Mike's explicit opt-in |

## Cite, don't restate

These cards **cite** enforcement rather than repeat it. "Reviewer must be Codex on Charlie"
and "review requires an exact SHA" are already executable in `mission_loop.ForemanPolicy`.
Prose that restates an enforced rule drifts from it silently, so the cards point at the
guard instead.

Every card declares `maps_to` — the existing `.claude/agents/` agent it aliases, or `NEW`.
The loader **rejects a card without it**, because forking the handbook into eight new
personalities is the failure this design exists to prevent. Exactly one card is `NEW`:
**Fleet Engineer** — nothing in `.claude/agents/` owns the orchestration substrate.

## Format

```markdown
---
name: kebab-case
title: Human Readable
maps_to: .claude/agents/<agent>.md   # or: NEW
plane: grok | fleet | advisory
worker_role: IMPLEMENTER | REVIEWER | VERIFIER   # fleet/advisory only
---

## Responsible for
## When Foreman should use it
## Should NOT
## Tools / workers
## Success looks like
```

All five sections required — a role with no stated **Should NOT** is one Foreman would
delegate to with an unstated boundary.

## The routing card

`render_roster()` builds Foreman's briefing from these files, so the roster has one source
rather than being retyped into a prompt string.

`bot.py` sends it **once, at agent creation** — the warm Grok agent retains conversation
context, so re-sending per turn would pay for it repeatedly and bury the user's message.

**Opt-in.** Unset `FOREMAN_ROUTING_CARD` means `_brief_agent()` returns immediately and
Foreman behaves exactly as before. Briefing failures are logged and swallowed — a bad
definition file must never cost Mike his message.

```bash
FOREMAN_ROUTING_CARD=1    # 1 | true | yes | on
```

## Related

- #3570 — the routing-card design these implement
- #3567 — `mission_loop.py`, the policy these cite
- #3572 — the Verifier slot that makes reviewer/verifier separable
