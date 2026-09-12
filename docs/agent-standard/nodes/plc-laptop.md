# PLC Laptop Standardization Runbook

**Node:** PLC Laptop  
**Canonical node reference:** `wiki/nodes/plc-laptop.md`  
**Role overlay:** industrial hardware engineering / PLC commissioning / FactoryLM development client

Read `docs/agent-standard/FLEET_STANDARD.md` first.

## Critical rule

**Standardize the development/agent environment, not the connected industrial hardware.**

No standardization task authorizes online PLC edits, downloads, firmware changes, drive parameter writes, network re-addressing, output forcing, safety bypasses, or machine motion.

## Desired state

Claude and Codex on the PLC Laptop should understand FactoryLM the same way they do elsewhere while preserving PLC-specific tools and strict hardware safety boundaries.

## Audit first

Record:

- Windows/hostname
- repo path and worktrees
- shell behavior
- Git/GitHub auth
- Tailscale
- Claude/Codex availability
- CodeGraph path
- Obsidian/wiki access
- CCW/Rockwell tooling presence (presence only unless task requires more)
- network interfaces at a descriptive level; do not reconfigure
- connected hardware state as `UNKNOWN/CONNECTED/DISCONNECTED` unless independently verified

## Safe convergence actions

- align repo/provider rules
- verify CodeGraph/wiki access
- configure task-worktree behavior
- document machine-specific tooling
- run offline software tests

## Hardware safety boundary

A coding agent MUST NOT, without an explicit hardware task and authorization:

- go online with a PLC
- download a program
- write tags/outputs
- force I/O
- change IP configuration
- change VFD/servo parameters
- reset industrial faults
- bypass interlocks
- command motion

If the requested software test would require any of those, return `HARDWARE AUTHORITY REQUIRED`.

## Stop-work/escalation

If physical machine state, energy isolation, personnel clearance, safety circuit state, or target-device identity is uncertain, do not perform a write action.

## PASS evidence

Parity means the **software workflow** is standardized. It does not require Docker, hardware drivers, PLC software, or runtime services to match the Mac nodes.
