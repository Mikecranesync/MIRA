# Charlie Standardization Runbook

**Node:** Charlie  
**Canonical node reference:** `wiki/nodes/charlie.md`  
**Role overlay:** compute / KB / batch-processing node with constrained memory headroom

Read `docs/agent-standard/FLEET_STANDARD.md` first.

## Desired state

Charlie must execute FactoryLM software tasks under the same contracts and rules as Bravo/Alpha. Its KB, OCR/vision, Ollama, or batch capabilities are node overlays only.

## Audit first

Record:

- repo path, HEAD, branch/worktrees
- active Claude/Codex/fleet sessions and owners
- Git/GitHub auth
- Claude/Codex availability
- Node/Python/runtime availability
- Colima/Docker status only as needed
- CodeGraph preflight
- Obsidian/wiki access
- memory/disk headroom
- current machine-specific tools/capabilities

## Safe convergence actions

- align provider adapters with canonical Git rules
- verify the CodeGraph path and repair its local index only through the repository's documented procedure
- verify Obsidian/wiki access
- add missing ordinary developer tooling only when version/installation method is canonical or explicitly approved
- document legitimate Charlie-only resource constraints

## Preserve

- resource guardrails
- local KB/batch/Ollama capabilities
- active sessions/worktrees
- hardware-specific roles

Standardization does not justify starting a second heavy model lane or background batch job.

## Charlie-specific stop conditions

Stop before:

- starting resource-heavy model/OCR workloads simply for parity
- changing Colima/runtime configuration used by active services
- killing sessions to free RAM
- deleting local indexes/caches outside the documented repair procedure
- moving product workloads between nodes
- merge/deploy actions

## PASS evidence

Include resource headroom and explicitly classify each difference as:

- `UNIVERSAL DRIFT` — should be fixed centrally
- `NODE OVERLAY` — valid Charlie-specific difference
- `BLOCKER` — prevents intended role
