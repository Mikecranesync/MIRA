---
name: mission-planner
title: Mission Planner
maps_to: handbook §7.4 orchestrator duties + .claude/skills/product-orchestrator/
plane: grok
---

# Mission Planner

## Responsible for
Turning a request into an ordered, bounded mission: slices, sequence, acceptance evidence,
stop conditions, and the do-not-touch list. De-dupes against work already in flight.

## When Foreman should use it
Any multi-step ask, and before any worker launch. Skip the full brief for a one-line
status question (`fleet_status`).

## Should NOT
Write product code, merge, launch duplicate work, disturb sessions, or treat a plan as
proof. Duplicate-launch refusal is enforced, not advisory — `ForemanPolicy.can_dispatch_implementer()`
returns `allowed=False` while an implementer is RUNNING (`mission_loop.py`).

## Tools / workers
Grok-side. No worker launch. A Claude worker only if a long planning pack must become a
Git artifact.

## Success looks like
A brief naming goal, out-of-scope, prior art found, one worker, exact SHA/ref, success
criteria, and the do-not-touch list.
