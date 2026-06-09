# Direct-Connection UNS Certification

If MIRA is **directly connected to a machine**, MIRA already knows where it is in the UNS — that's what the connection IS. The technician must not be asked to re-confirm the asset; the connection itself certifies the UNS path.

This rule carves the **direct-connection** exception out of `.claude/rules/uns-confirmation-gate.md`. Both rules apply: the gate covers chat without a connection; this rule covers connections that already carry plant context.

## Hard Rule

**A direct connection that does not carry a resolvable UNS identity is rejected.** It is NOT downgraded to a chat-gate confirmation. The connection is the gate.

## What counts as a "direct connection" (UNS-certified by construction)

A turn arrives over one of these surfaces, AND the surface supplies a UNS identifier:

| Surface | UNS identity comes from | Example |
|---|---|---|
| Ignition cloud-chat endpoint (`mira-pipeline /api/v1/ignition/chat`) | `asset_context` field on the signed payload | `{site,area,line,equipment}` resolves via `uns_resolver.resolve_uns_path` |
| Ignition Perspective panel ("Ask MIRA" button) | Perspective session view path + bound tag provider | `enterprise.garage.demo_cell.cv_101` |
| MQTT / Sparkplug B turn (`mira-bridge`, `mira-relay`) | Sparkplug B topic namespace | `spBv1.0/<group>/<edge>/<device>` → UNS path |
| PLC bridge / Modbus poller (`plc/`, `mira-live-plc-bridge`) | Bridge config bound to a specific cell | `enterprise.<site>.<area>.<line>.<machine>` from the bridge's config |
| Hub Command Center display (live HMI subtree) | The subtree the operator is *already looking at* | `enterprise.garage.demo_cell` |
| QR-scan deep-link (`qr-onboarding` skill) | The asset/component the QR encodes | `enterprise.<site>.<area>.<line>.<asset>` |
| Component-template card / asset detail page | The row the user opened | `equipment_entity_id` FK → UNS path |

If the surface is in this list AND the identifier resolves, MIRA enters live-assist mode immediately. No "Did I find the right machine?" question. No gate.

## What does NOT count as a direct connection

- Slack DM / channel message → no machine attached. Gate applies.
- Telegram chat → no machine attached. Gate applies.
- Email → no machine attached. Gate applies.
- Web chat on `factorylm.com` without an asset-bound session → gate applies.
- A chat turn that *mentions* an asset name in free text ("the GS10 is faulted") → gate applies. Free-text references are NOT direct connections, even if confident.

## Required behavior when a direct connection arrives

The receiving adapter (Ignition endpoint, MQTT subscriber, PLC bridge, Perspective view binding, Hub display, QR handler) must:

1. **Carry a UNS identifier on every turn.** Either:
   - A resolved UNS path string (`enterprise.garage.demo_cell.cv_101`), OR
   - An asset-context object (`{site, area, line, equipment, component?}`) that `mira-bots/shared/uns_resolver.resolve_uns_path()` can resolve, OR
   - An `equipment_entity_id` FK that joins to a row with a `uns_path`.
2. **Reject the turn if the identifier is missing or unresolvable.** Return 400/422 with `{"error":"uns_required"}`. Do NOT fall back to asking the technician.
3. **Pass the resolved UNS context to the engine** by populating `state["uns_context"]` with `source="direct_connection"` and `confidence="certified"`.
4. **Skip the chat-gate confirmation message.** The engine MUST NOT emit "I think you're looking at X — is that right?" for direct-connection turns. It goes straight to grounded diagnosis.
5. **Still ground every claim** per `.claude/CLAUDE.md` § "Grounded troubleshooting". UNS certification covers *where* — not *what's wrong*. Citations, fault codes, manuals, work-order history still apply.

## What the engine must enforce

`mira-bots/shared/engine.py` already has the UNS confirmation gate. To support this rule the engine must:

- Branch on `state["uns_context"]["source"]`:
  - `"chat_resolver"` or `"technician_hint"` → chat-gate applies (existing behavior).
  - `"direct_connection"` → gate is SATISFIED on arrival; skip steps 6–7 of the gate flow in `.claude/CLAUDE.md` § "The non-negotiable UNS location-confirmation gate".
- Treat `source="direct_connection"` with the same trust level as `step 7` of the chat-gate (technician confirmation).
- Log every direct-connection turn with the certifying surface (`ignition_chat`, `sparkplug`, `plc_bridge`, `perspective_view`, `hub_display`, `qr_onboarding`) for groundedness audits.

## What the audit must catch

`mira-run-hallucination-audit` must flag:

- ❌ A direct-connection surface that accepts a turn without a UNS identifier and proceeds.
- ❌ A direct-connection surface that downgrades to a chat-gate confirmation when the identifier is missing (must reject instead).
- ❌ An engine path that emits a confirmation question for `state["uns_context"]["source"]=="direct_connection"`.
- ❌ A new direct-connection surface added without populating `source="direct_connection"`.

## Why this matters

The chat-gate exists because Slack/Telegram messages don't know which machine the tech is staring at. Ignition does. MQTT does. A PLC bridge does. A Perspective panel bound to `cv_101` does. Asking the technician "are you sure you're looking at CV-101?" when they're literally tapping the "Ask MIRA" button INSIDE the CV-101 dashboard is:

1. **Insulting.** The connection already proved it.
2. **A latency tax.** Two round-trips before any useful answer.
3. **A correctness risk.** Free-text confirmation introduces a chance to mis-type the asset and override the certified path.

The connection is the truth. Honor it.

## When this applies

- Any code under `mira-pipeline/ignition_chat.py` and the Ignition WebDev/Perspective client that calls it.
- Any code under `mira-bridge/` or `mira-relay/` that turns MQTT/Sparkplug B into engine turns.
- Any code under `plc/` or `mira-live-plc-bridge` that feeds tag snapshots to the engine.
- Any "Ask MIRA" affordance inside a Hub Command Center display, Perspective view, or component-template card.
- Any QR-scan deep-link that opens a chat session bound to an asset.
- Any new direct-connection surface — must declare its UNS-identity source before it can ship.

## When this does NOT apply

- Slack / Telegram / email / generic web chat → chat-gate (`uns-confirmation-gate.md`) is the law there.
- Educational / general questions ("what is MQTT?") on any surface → no gate either way.
- A direct-connection surface that explicitly carries a `cross_asset` flag (e.g. an operator asking "compare CV-101 to CV-102 from the gateway") — that's a multi-asset query and the engine handles it as a survey, not a single-asset diagnosis.

## Cross-references

- `.claude/rules/uns-confirmation-gate.md` — the chat-gate this rule carves an exception out of
- `.claude/rules/uns-compliance.md` — UNS data-shape (paths, slugs, resolver) all direct connections must honor
- `.claude/CLAUDE.md` § "The non-negotiable UNS location-confirmation gate" — engine-level gate flow
- `docs/specs/maintenance-namespace-builder-spec.md` — the UNS gate product surface
- `docs/specs/uns-message-resolver-spec.md` — `resolve_uns_path()` contract
- `mira-pipeline/ignition_chat.py` — first direct-connection surface in the codebase
- `mira-bots/shared/uns_resolver.py` — where `source` and `confidence` band live on `state["uns_context"]`
