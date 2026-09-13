# VPS Standardization Runbook

**Node:** FactoryLM VPS / production deployment target  
**Canonical node reference:** `wiki/nodes/vps.md`  
**Role overlay:** production infrastructure and deployment target

Read `docs/agent-standard/FLEET_STANDARD.md` first.

## Desired state

The VPS should expose the same canonical project context and evidence rules when an authorized agent operates there, but it is not required to become a general-purpose development workstation.

## Default posture

**Read/observe by default. Mutate only with explicit deployment/operations authority.**

## Audit first

Record without changing:

- deployed repo/SHA where applicable
- running service/container health
- Git checkout state
- standard documentation availability
- deployment/runbook references
- Doppler availability without revealing values
- disk/memory pressure
- divergence between deployed SHA and intended release SHA

## Safe convergence actions

- place/reference provider-neutral runbooks
- verify that deployment evidence records exact commit SHA
- ensure operator agents can find the same architecture and release policy
- document VPS-only runtime details in node overlay

## Do not standardize by

- installing every developer tool
- giving production broad write authority
- running interactive experiments
- using production as a code-authoring worktree
- synchronizing secrets to developer nodes

## Stop conditions

Explicit authorization is required before:

- deployment
- container restart that affects users
- database migration
- nginx/TLS/firewall change
- branch/reset operation in deployed checkout
- secret rotation/change
- destructive cleanup

## PASS evidence

`STANDARD` means production operations follow the same repo-defined release/evidence contract, not that the VPS looks like Alpha/Bravo/Charlie.
