# mira-uns-mcp — Spec

MCP server exposing the Unified Namespace for read-only lookup. Powers the UNS location-confirmation gate.

**Status:** proposed. Read-only.
**Underlying data:** `kg_entities` (NeonDB), `mira-crawler/ingest/uns.py` builders, optionally MQTT/Ignition tag streams for `get_live_tags`.
**Auth:** tenant scope inferred from caller; cross-tenant denied.

## Tools

### `search_namespace(query: str, tenant_id?: str, limit?: int = 10) -> list[Match]`
Free-text → UNS path candidates. Wraps `uns_resolver.resolve_uns_path()`.

```jsonc
// Match
{
  "uns_path": "enterprise.stardust_racers.site.garage_factory.area.conveyor_lab.line.line5.work_cell.conveyor_b16.pe_b16_2",
  "kind": "asset|component|line|area|site",
  "name": "Occupancy Sensor B16.2",
  "evidence": [{"type": "tag_hint", "value": "B16.2"}, {"type": "history", "value": "14 prior tickets"}],
  "confidence": "high"
}
```

### `get_asset(path: str) -> Asset`
Resolve a single UNS path. Returns metadata + parents + child slugs. 404 if not found.

```jsonc
{
  "uns_path": "...",
  "kind": "asset",
  "name": "...",
  "manufacturer": "...",
  "model": "...",
  "parent_path": "...",
  "child_paths": [...],
  "evidence": [...],
  "confidence": "verified"
}
```

### `list_children(path: str) -> list[Asset]`
ISA-95 children one level down.

### `get_related_components(path: str) -> list[Component]`
Components attached to an asset/cell.

### `get_live_tags(path: str) -> list[TagSample]`
Most recent values for tags tied to an asset. Returns `null` when no tag stream is configured for the tenant — **don't fabricate**.

```jsonc
{
  "tag": "Conveyor_B16_Run",
  "value": 0,
  "ts": "2026-05-13T17:30:01Z",
  "source": "ignition|mqtt|sqlite_relay",
  "confidence": "live"
}
```

### `resolve_location_hint(message: str, tenant_id?: str) -> list[Candidate]`
Extracts asset/line/component/fault hints from a free-text technician message. Returns ranked candidates. Cites `docs/specs/uns-message-resolver-spec.md`.

### `get_candidate_contexts(message: str, tenant_id?: str, k: int = 3) -> list[Context]`
Higher-level: returns up to k full `(site, area, line, asset, component, fault, evidence, confidence)` tuples ready for the Slack confirmation message.

## Safety

- **Read-only.** No mutators.
- **No troubleshooting answers.** This MCP returns context only — engine layer decides whether to enter troubleshooting after technician confirmation.
- **No live-write to MQTT.** `get_live_tags` is read-side only.
- **Evidence required.** Every return includes `evidence: list[{type, value}]`.
- **Confidence required.** Every return includes `confidence: low|medium|high|verified|live`.

## Cross-references

- `docs/specs/uns-kg-unification-spec.md` — ISA-95 hierarchy authority
- `docs/specs/uns-message-resolver-spec.md` — resolver logic
- `.claude/rules/uns-compliance.md` — data-shape rules
- `.claude/skills/uns-location-gate-designer/SKILL.md` — flow that consumes this MCP
