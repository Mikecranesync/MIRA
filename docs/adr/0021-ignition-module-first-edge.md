# ADR-0021: Ignition-Module-First Edge Architecture

## Status

Accepted — 2026-06-01

**Related:** ADR-0008 (sidecar deprecation), ADR-0013 (Hub schema canonicalization), ADR-0017 (proposal state machine), ADR-0019 (MiraDrop Ingest v2), ADR-0020 (knowledge node addressing).
**Implements:** the architecture established in [`docs/mira-ignition-secure-architecture.md`](../mira-ignition-secure-architecture.md), tasks D1–D4 of which shipped in PRs [8b3e82fe](../../commit/8b3e82fe), [ed5f19f9](../../commit/ed5f19f9), [f97c5206](../../commit/f97c5206), and [2a1c8515](../../commit/2a1c8515).
**Supersedes:** nothing structurally — this ADR makes durable what the architecture doc already declared, so a future reviewer reading only the ADR index sees the boundary.

---

## Context

Through Q1–Q2 2026 the customer-deployable shape of MIRA drifted toward an implied "MIRA owns the broker and polls the PLC directly" architecture: `docker-compose.fault-detective.yml` spins up `eclipse-mosquitto`, `live-plc-bridge` polls Modbus TCP from inside a MIRA-named container, and the WebDev `/chat` handler still posts at `localhost:5000/rag` (the sunset `mira-sidecar`). That shape works on the bench. It is the wrong shape for a customer install for three reasons:

1. **Trust boundary.** The customer's plant LAN must not be reachable from a MIRA-cloud component. Every customer IT review of "a vendor that polls our PLC" ends with the firewall rule the customer is unwilling to write.
2. **Distribution.** The customer already owns (or is buying) Ignition. The Ignition Exchange is the de-facto distribution channel for SCADA add-ons. Selling against Inductive Automation is a losing fight; partnering with them via the Exchange is the winning one.
3. **Roadmap headroom.** The Ignition Module shape lets us add an On-Prem deployment (same module, different target URL) without re-engineering, and lets us add an MQTT/Sparkplug B subscriber (`mira-connect`, the non-Ignition counterpart) without affecting either path.

The architecture audit at [`docs/mira-ignition-secure-architecture.md`](../mira-ignition-secure-architecture.md) made this concrete in May 2026. This ADR is the durable record of the decision and the constraints it imposes.

## Decision

**MIRA's customer-deployable surface is an Ignition Module.** Today: a Perspective project + WebDev endpoints + gateway scripts, installable via `deploy_ignition.ps1` and (post-MVP) the Ignition Exchange. Tomorrow: a packaged Module JAR. Either way:

1. **The Module runs inside the customer's Ignition Gateway JVM.** It does not run on its own VM, not in a sidecar container on the plant LAN, not as a service the customer's IT has to provision separately.
2. **All plant-side I/O stays inside Ignition.** Modbus / EtherNet/IP / OPC-UA are Ignition's job — that is what Ignition was built for and what the customer already paid for. MIRA reads tags by browsing Ignition's tag space, never by opening its own protocol socket to the plant.
3. **The Module talks to MIRA Cloud over outbound HTTPS only.** No inbound port openings. No reverse tunnel. No VPN. No Tailscale. No NAT punch. Customer IT only has to allow `outbound 443 → *.factorylm.com`. Auth is HMAC-SHA256 with a per-tenant key.
4. **Tag access is allowlist-first, read-by-default.** A tag NOT in `approved_tags.json` is invisible to MIRA (`ignition/webdev/FactoryLM/api/tags/doGet.py` enforces fail-closed). Writes do not exist in the MVP; the code path is absent. A future "operator-assisted write" feature would require explicit per-tag admin approval AND per-prompt cloud approval, and is not on the current roadmap.
5. **The cloud reasons; the gateway carries.** The engine (UNS gate, RAG, KG, cascade LLM, citation compliance) lives in MIRA Cloud. The gateway moves tag snapshots and chat round-trips between technician and cloud, signs them, and respects the allowlist. This split lets the cloud iterate fast (typed, tested) without touching the plant's safety-critical edge.

### Alternatives considered and rejected

| Alternative | Why rejected |
|---|---|
| **Direct Modbus / EtherNet/IP from MIRA Cloud or a MIRA-named container** | Violates the trust boundary. Customer IT will block. Live tag latency stops mattering when the firewall request is the actual gate. |
| **MIRA-hosted local MQTT broker as the customer's edge** | Makes us the broker. Out of scope, competes with HiveMQ / Mosquitto / Cirrus Link, and adds plant-side ops burden we do not want. |
| **Cloud-initiated reverse tunnel / VPN / Tailscale** | Requires inbound posture or third-party agent on plant equipment. Customer IT review fails on this. |
| **MIRA appliance VM the customer's IT hosts** | Possible as an On-Prem tier (§5 of the architecture doc); rejected as the MVP shape because it triples install effort and pushes the wedge out by months. |
| **OPC UA aggregating server hosted by MIRA** | Same trust-boundary problem. We are *the maintenance brain*, not a SCADA layer. |

### What this decision *enables*

- **On-Prem mode without re-engineering.** Same Module, different target URL (customer's own MIRA appliance). §5 of the architecture doc.
- **MQTT/Sparkplug B mode without forcing Ignition.** `mira-connect` runs at the customer's edge, subscribes to allowlisted Sparkplug topics, posts to `mira-relay` over the same HMAC contract. §6 of the architecture doc. Spec tracked at #1627.
- **Identical multi-tenant audit story.** Tenant id flows from the HMAC header → engine → `ignition_audit_log` (migration 031) → admin Perspective view + Hub `/audit` page.

## Consequences

### What we now forbid

These are hard nos for the customer-shipped surface — anti-patterns from §8 of the architecture doc, codified here:

1. ❌ Direct Modbus / EtherNet/IP / OPC-UA from MIRA Cloud or any cloud-resident container.
2. ❌ MIRA Cloud initiating connections to the plant.
3. ❌ A MIRA-hosted local MQTT broker as the customer's edge.
4. ❌ Customer-side `pymodbus` / `pycomm3` / `python-snap7` / `opcua` calls in any package shipped to customers.
5. ❌ Reading tags not on the allowlist, ever.
6. ❌ Writing to tags from the MVP. The code path does not ship.
7. ❌ Replacing Ignition, replacing CMMS, replacing the historian.
8. ❌ Skipping the UNS gate for "convenience" in the Perspective chat path.

`plc/live_monitor.py` (writes GS10 control words) and `plc/live-plc-bridge/bridge.py` (direct Modbus poll from a MIRA container) remain in the repo as bench-only tools, with prominent BENCH-ONLY headers (PR [0cfec42f](../../commit/0cfec42f), D5, #1621) and explicit exclusion from customer-facing compose targets. They never ship.

### What we now require

- Every customer-shipped tag read goes through Ignition + the allowlist module.
- Every customer-shipped chat round-trip is HMAC-signed, tenant-scoped, and audit-logged.
- Every PR that adds a customer-shipped path involving a fieldbus, a broker, or a write surface gets reviewed against this ADR and the architecture doc.
- New direct-connection surfaces (Ignition cloud chat, MQTT, PLC bridge, Hub display, QR) declare their UNS-identity source per [`.claude/rules/direct-connection-uns-certified.md`](../../.claude/rules/direct-connection-uns-certified.md) and reject turns without a UNS identifier rather than downgrading to the chat-gate.

### Performance / latency implications

- Tag snapshots travel cloud-wards via outbound HTTPS, batched. Typical end-to-end latency for the chat round-trip in development: ~1–2 s for the engine + ~50 ms for the HMAC + transport overhead. Acceptable for a technician-driven interaction; not acceptable for safety interlocks (which are not in scope anyway).
- The cloud cannot push to the plant. If a future feature needs cloud-initiated work (e.g. "remind the technician at 3pm"), it's a polled-from-gateway design, not a server-push.

### Migration / rollout implications

- The PRs implementing D1–D4 of the architecture audit (allowlist enforcement, HMAC-signed WebDev client, cloud chat endpoint, relay HMAC + tenant routing) land on `feat/hub-command-center` and ride to staging behind the normal gate (`docs/environments.md`).
- Migration 031 (`mira-hub/db/migrations/031_ignition_audit_log.sql`) flows dev → staging → prod via `apply-migrations.yml`. No hand-edited schema.
- The Ignition Exchange listing (#1625, D9) is the gate to a real customer install. Until then, customer installs are hand-driven by `deploy_ignition.ps1`.

## Cross-references

- [`docs/mira-ignition-secure-architecture.md`](../mira-ignition-secure-architecture.md) — the long-form architecture doc this ADR makes durable.
- [`docs/THEORY_OF_OPERATIONS.md`](../THEORY_OF_OPERATIONS.md) — primary product doctrine; identifies UNS / MQTT / Ignition as MIRA's live context layer.
- [`docs/specs/maintenance-namespace-builder-spec.md`](../specs/maintenance-namespace-builder-spec.md) — UNS gate, AI proposals, readiness levels.
- [`docs/specs/ignition-exchange-spec.md`](../specs/ignition-exchange-spec.md) — sibling spec for the Exchange listing (D9).
- [`.claude/rules/fieldbus-readonly.md`](../../.claude/rules/fieldbus-readonly.md) — extended scope: customer-shipped surfaces never open a fieldbus socket.
- [`.claude/rules/direct-connection-uns-certified.md`](../../.claude/rules/direct-connection-uns-certified.md) — direct-connection surfaces certify UNS by construction, reject turns without a UNS identifier.
- [`.claude/skills/mira-architecture-guardian/SKILL.md`](../../.claude/skills/mira-architecture-guardian/SKILL.md) — PR-time invariants this ADR implies.
- [`.claude/skills/mira-saas-scope-guard/SKILL.md`](../../.claude/skills/mira-saas-scope-guard/SKILL.md) — scope classifier covering the anti-patterns above.
- ADR-0017 — proposal state machine (referenced by audit log + tag-import wizard).
- ADR-0013 — Hub schema canonicalization (audit_log migration lives there).

## Open questions tracked elsewhere

- **`mira-connect` rename.** Audit doc §11.2 recommends renaming to `mira-edge-mqtt`. Tracked in #1627 (D11, Sparkplug spec).
- **HMAC key rotation.** Per-tenant minting, gateway-side storage, rotation cadence. Audit doc §11.3.
- **On-prem appliance shape.** Single container / VM / compose stack — audit doc §11.4. Deferred until first enterprise prospect.
- **Tag-write feature.** Out of scope for MVP. Two-step approval design lives in the audit doc §4.2; no code path exists.
