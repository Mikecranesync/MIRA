---
name: work-order-history-miner
description: Use when extracting maintenance intelligence from CMMS work-order history. Triggers on edits to `mira-mcp/server.py` CMMS tools, Atlas CMMS integration in `mira-cmms/`, or when a customer onboarding includes a CMMS export.
---

# Work-Order History Miner

Turn raw CMMS work-order history into the intelligence MIRA needs to ground troubleshooting and propose component-profile updates.

## What to identify

1. **Repeated failures** — same asset + failure-mode-cluster occurring above a threshold (default 3 in 6 months)
2. **Common fixes** — most-frequent resolutions per asset/component
3. **Reset-only events** — work orders closed with no parts replaced and short duration → flags chronic nuisance vs real failure
4. **Replaced parts** — frequency-ranked, by component
5. **MTBF** (mean time between failures) — per asset or per component
6. **Downtime patterns** — failures clustered by day-of-week, shift, or season
7. **Technician notes** — free-text comments; extract actionable phrases
8. **Likely root causes** — clusters of (symptom, action, success) into root-cause hypotheses
9. **Recurring nuisance faults** — high-frequency, low-effort, line-stop-causing faults
10. **Parts that should be watched** — parts replaced N+ times, or parts with replacement intervals shorter than expected
11. **PM opportunities** — failures that would have been prevented by an existing PM done correctly
12. **Useful KB entries** — fixes that should be turned into knowledge-graph relationships

## Output shape (per finding)

```jsonc
{
  "asset_id": "...",
  "uns_path": "...",
  "component_id": "...",
  "finding_kind": "repeat_failure|common_fix|reset_only|...",
  "summary": "Occupancy Sensor B16.2 has 14 OCCUPIED_TOO_LONG faults in 6 months; 11 closed reset-only",
  "evidence": [
    {"type": "wo_history", "wo_ids": ["wo_...", "wo_..."]},
    {"type": "duration_pattern", "median_minutes": 4}
  ],
  "recommended_kg_relationship": {
    "source": "component:pe_b16_2",
    "target": "fault:1.SOC_B16_2.OCCUPIED_TOO_LONG",
    "relation": "HasChronicFault",
    "status": "proposed",
    "confidence": "high"
  },
  "recommended_component_profile_update": {
    "field": "known_fixes",
    "value": {"symptom": "OCCUPIED_TOO_LONG repeats", "action": "Reset at Panel B16, then realign", "evidence_wo_ids": [...]}
  },
  "confidence": "high|medium|low"
}
```

## Rules

- **Preserve source.** Every finding cites the work-order IDs it came from.
- **Component-link before relationship.** Findings need a `component_id` (or `asset_id` fallback) — orphaned findings stay in a review queue.
- **Proposed by default.** Recommended KG relationships start as `proposed`. Never auto-verify.
- **Tenant isolation.** Findings are per-tenant; don't cross-pollinate insights.
- **Don't write to closed work orders.** They're immutable.
- **Draft new work orders, don't commit them.** If a finding suggests a new work order (e.g., "schedule a sensor replacement"), call `create_draft_work_order`, not a live create.

## Useful aggregations

| Aggregation | Why it matters |
|---|---|
| `count(wo) GROUP BY (asset_id, failure_mode) HAVING count >= 3` | Repeat failures |
| `wo.parts_used = [] AND wo.duration_minutes < 10` | Reset-only events |
| `lag(wo.created_at) OVER (PARTITION BY asset_id ORDER BY created_at)` | MTBF |
| `EXTRACT(DOW FROM wo.created_at)` | Day-of-week patterns (shift correlation) |
| `wo.parts_used` exploded with frequency rank | Parts churn |
| `LEFT JOIN pm_schedule ON asset_id` | PM coverage gaps |

## What to do when invoked

1. Identify the CMMS surface — Atlas CMMS REST (`atlas-api:8080`), MaintainX via Nango (per memory), or other tenant CMMS
2. Pull work-order history scoped to the relevant asset(s) — via `mira-mcp/server.py` `cmms_list_work_orders` or `mira-work-order-mcp` `search_work_orders`
3. Run the aggregations above
4. Generate findings per schema
5. Propose KG relationships → hand off to `knowledge-graph-proposer` skill
6. Propose component-profile updates → hand off to `component-profile-builder` skill
7. Write a mining report at `docs/work-order-mining/<asset_id>-<date>.md` (audit trail)

## Anti-patterns

- Drawing conclusions from < 3 work orders (insufficient signal)
- Promoting "common fix" to `verified` without technician confirmation
- Aggregating across tenants (tenant isolation)
- Inventing failure-mode names that don't appear in the work-order data
- Mining notes that contain PII without sanitization

## Cross-references

- `mira-mcp/server.py` — existing `cmms_*` tools
- `mira-cmms/` — Atlas CMMS integration
- `.claude/mcp/mira-work-order-mcp-spec.md`
- `.claude/skills/component-profile-builder/SKILL.md`
- `.claude/skills/knowledge-graph-proposer/SKILL.md`
