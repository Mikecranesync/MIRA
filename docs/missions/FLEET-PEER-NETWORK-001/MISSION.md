# FLEET-PEER-NETWORK-001 — durable peer development network

- **PRD:** `docs/prd/2026-09-07-fleet-peer-network-001.md` (Mike Harper, 2026-09-07)
- **Record:** issue #3648 (claims, rulings, dispatch history)
- **Contract:** `docs/peer-network/START_HERE.md` + `docs/peer-network/schemas/` (v1.0.0)

| Slice | Scope | Status |
|---|---|---|
| A | contract + onboarding (this directory, START_HERE, schemas, `deployment/network.yml` Travel+PLC metadata, missions convention, `.fleet/` notice) | draft PR open; root pointers pending #3647 |
| B | Foreman shadow state (ForemanPolicy on the live bot, Slack dedup + thread→mission map, one Grok context per thread) | next — dependency-ready after A |
| C | membership + heartbeat (nodes/sessions registration, capability discovery incl. **tool capabilities**, restart recovery) | after B |
| D | atomic claims + collision refusal | after C |
| E | durable handoff + exact-SHA review orchestration | after D |
| F | guarded scheduler + Slack roster | after E |

**Human gates:** merge (every slice), any Gateway/tunnel/Slack production change (separate mission).
**Dispatch record for Slice A (2026-09-07):** Travel unreachable → Bravo silent → charlienode-be
unequipped (no Bash/git/gh/write) → fleet-001-review-e9 declined (relayed authority) → mira-97 on
Charlie under Mike's direct instruction. Lesson carried into Slice C: registration must record
tool capabilities, not just presence.
