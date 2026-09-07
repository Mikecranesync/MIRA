# Peer-network schemas — version 1.0.0

Machine-readable shape of the seven durable records in
`docs/prd/2026-09-07-fleet-peer-network-001.md` §7 (JSON Schema 2020-12). They are the
**contract**; the Foreman state store (Slice B) and the Gateway operations (Slice C+)
must validate against them. Bump `version` (and the `$id` path) on any breaking change
and keep the previous file next to it — a session on an older Foreman must still parse.

| Record | File | Owner of writes |
|---|---|---|
| node | `node.schema.json` | Foreman (from `join_network` / heartbeat) |
| session | `session.schema.json` | Foreman (from `join_network` / heartbeat / handoff) |
| work_item | `work_item.schema.json` | Foreman + humans (authorization) |
| claim | `claim.schema.json` | Foreman (`claim_work` acquires every `resource_keys` entry atomically or none) |
| event | `event.schema.json` | Foreman, append-only, idempotent on `idempotency_key` |
| artifact | `artifact.schema.json` | Foreman (from `submit_result` / `submit_verdict`) — binds to one 40-char SHA |
| human_gate | `human_gate.schema.json` | Humans decide; Foreman records |

## Controller operations (PRD §9)

`join_network` · `heartbeat` · `fleet_status` · `request_work` · `claim_work` · `renew_claim` ·
`release_claim` · `submit_checkpoint` · `request_handoff` · `accept_handoff` · `submit_result` ·
`request_review` · `submit_verdict` · `leave_network`

Every mutating operation carries `mission_id`, `session_uuid`, lease `generation` and an
`idempotency_key`; unknown, stale, foreign or duplicated identities fail closed. Until
Slice B ships, these operations are performed **manually** as described in
`../START_HERE.md` (a GitHub comment is the event; the `[WORK-CLAIM]` block is the claim).

## Resource keys

Explicit canonical keys, e.g. `packages/factorylm-ui`, `mira-mobile`, `migration:next`,
`device:pixel9a`, `environment:staging`, `root:CLAUDE.md`. The pattern is enforced in
`claim.schema.json`. One active writer per key.
