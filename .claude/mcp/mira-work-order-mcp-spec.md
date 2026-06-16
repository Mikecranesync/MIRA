# mira-work-order-mcp — Spec

MCP server exposing CMMS work-order history and a single **draft-only** write tool.

**Status:** proposed. Some tools already exist in `mira-mcp/server.py` (cmms_create_work_order, cmms_list_work_orders); this spec defines the proper boundary.
**Underlying data:** Atlas CMMS (`mira-cmms/`, REST API at `atlas-api:8080`), and `cmms_*` tables in NeonDB.
**Auth:** tenant scope required; explicit approval token required to **commit** a draft work order.

## Tools

### `search_work_orders(asset_id: str, query?: str, status?: str, limit?: int = 20) -> list[WorkOrder]`
Asset-scoped search. Status ∈ `open|in_progress|done|cancelled`.

```jsonc
{
  "id": "wo_...",
  "asset_id": "...",
  "uns_path": "...",
  "status": "done",
  "title": "Reset Conveyor B16",
  "description": "...",
  "fault_code": "1.SOC_B16_2.OCCUPIED_TOO_LONG",
  "parts_used": [],
  "duration_minutes": 4,
  "technician": "...",
  "created_at": "...",
  "closed_at": "..."
}
```

### `get_failure_history(asset_id: str, since?: str) -> FailureSummary`
Aggregates work-order history into a maintenance picture.

```jsonc
{
  "asset_id": "...",
  "uns_path": "...",
  "window": "6 months",
  "total_failures": 14,
  "top_failure_modes": [{"mode": "OCCUPIED_TOO_LONG", "count": 14}],
  "mtbf_hours": 312,
  "common_fixes": [{"action": "Reset at Panel B16", "count": 11}],
  "parts_replaced": [],
  "reset_only_events": 11,
  "evidence": [{"type": "work_order_history", "count": 14}],
  "confidence": "high"
}
```

### `get_common_fixes(asset_id: str) -> list[Fix]`
Top resolutions by frequency, with confidence.

### `get_repeat_failures(asset_id: str, min_count: int = 3) -> list[RepeatPattern]`
Components/faults repeating ≥ N times. Useful for "this asset has a chronic problem" surfacing.

### `create_draft_work_order(asset_id: str, issue: str, recommended_action: str, evidence: list, tenant_id?: str) -> Draft`
Write — **creates a DRAFT only**, never a live work order. Status = `draft`, requires a separate `commit_draft_work_order(draft_id, approver)` (defined elsewhere or via Atlas API) to become a real work order. Preserves source work-order references in `evidence`.

```jsonc
{
  "draft_id": "draft_...",
  "asset_id": "...",
  "title": "...",
  "description": "...",
  "evidence": [{"type": "wo_history", "wo_ids": [...]}],
  "status": "draft",
  "created_by": "mira-bot",
  "requires_approval_by": "technician|admin"
}
```

## Safety

- **Draft only by default.** No tool here creates a live work order without an explicit, separate commit step.
- **Preserve source.** `evidence` always carries the prior work-order IDs that justify the draft.
- **No retroactive edits.** Closed work orders are immutable; the tool cannot rewrite them.
- **Tenant isolation.**
- **PII sanitization.** Technician notes may contain names/emails — sanitize before logging.

## Cross-references

- `.claude/skills/work-order-history-miner/SKILL.md`
- `mira-mcp/server.py` — existing CMMS tools
- `mira-cmms/CLAUDE.md` — Atlas CMMS integration
