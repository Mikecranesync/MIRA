---
name: mira-uns-architecture
description: |
  L1 domain skill for everything UNS in MIRA — path construction via mira-crawler/ingest/uns.py, message resolution via mira-bots/shared/uns_resolver.py, the non-negotiable location-confirmation gate in mira-bots/shared/engine.py, kg_entities.uns_path, and MQTT/Sparkplug B topic mapping. Triggers on any task touching a UNS path string, the resolver, the gate, ltree storage, or the namespace structure. Subsumes and extends the older uns-location-gate-designer skill — this one owns the architecture, not just the gate.
version: 0.1.0
status: draft
last-updated: 2026-05-19
owner-paths:
  - mira-crawler/ingest/uns.py
  - mira-bots/shared/uns_resolver.py
  - mira-bots/shared/engine.py
  - .claude/rules/uns-compliance.md
  - docs/specs/uns-kg-unification-spec.md
  - docs/specs/uns-message-resolver-spec.md
  - docs/specs/maintenance-namespace-builder-spec.md
  - docs/migrations/004_kg_entities.sql
related-skills:
  - mira-platform
  - mira-industrial-safety
  - mira-component-profile
  - mira-maintenance-workflow
  - knowledge-graph-proposer
---

# mira-uns-architecture

> **Status:** Draft (Phase 6 of the Fuuz-adaptation initiative). Subsumes the role of `uns-location-gate-designer/`. Until the alias is wired (Phase B of the roadmap), both may coexist; this one is the broader target.

## 1. When to invoke

Invoke for any task that:

- Changes a UNS path string in code, tests, or docs.
- Touches `mira-crawler/ingest/uns.py` (the path builders).
- Touches `mira-bots/shared/uns_resolver.py` (message → UNS resolution).
- Touches `mira-bots/shared/engine.py` in the location-gate region (FSM state `awaiting_context`).
- Reasons about `kg_entities.uns_path` storage, ltree queries, or namespace migrations.
- Designs or modifies the technician confirmation message that follows resolution.
- Maps MQTT topics or Sparkplug B namespaces into MIRA's UNS.
- Adds a new front door that needs to invoke the gate.

### Do NOT trigger as the primary skill for

- Pure component-template design (per-instance/per-model, profile schema) → use `mira-component-profile`. (UNS is the address; the profile is the contents.)
- KG relationship rules (proposed/verified, evidence/confidence) → use `knowledge-graph-proposer`.
- Slack message styling apart from the gate confirmation message → use `slack-technician-ux-writer`.

## 2. What this skill grounds in

| File | What it covers |
|---|---|
| `mira-crawler/ingest/uns.py` | Path builders: `slug()`, `manufacturer_path()`, `family_path()`, `model_path()`, `manual_path()`, `fault_code_path()`, `pm_schedule_path()`, `parts_list_path()`, `community_class_path()`, `site_path()`. `RESERVED_LABELS` set. `is_valid_path()`, `is_valid_label()`. |
| `mira-bots/shared/uns_resolver.py` | `UNSContext` + `UNSResolution` dataclasses. `resolve_uns_path()`, `resolve_uns_path_multi()`. Extractors: `_extract_fault_codes()`, `_match_vendor()`, `_is_model_candidate()`, `_find_model_near_vendor()`. Confidence assignment via `_confidence()`. DB enrichment via `_enrich_from_db()`. |
| `mira-bots/shared/engine.py` (gate region) | FSM state `awaiting_context` → `troubleshooting`. Confirmation payload construction. `_clear_diagnostic_carryover` on asset change. |
| `.claude/rules/uns-compliance.md` | 9 numbered rules: never reinvent builders, one extraction point per turn, slugs from `uns.slug()`, fault-codes-before-model, pure-digit models valid, reserved labels off-limits, lowercase only, offline mode is the floor, confidence is a band. |
| `docs/specs/uns-kg-unification-spec.md` | UNS schema authority. |
| `docs/specs/uns-message-resolver-spec.md` | Resolver Stage-1 spec (shipped). Confidence bands defined in §2.4. |
| `docs/specs/maintenance-namespace-builder-spec.md` | The product surface — UNS gate, AI proposals, readiness levels. |
| `docs/migrations/004_kg_entities.sql` | `kg_entities.uns_path` column shape. |

## 3. The non-negotiable rule

**MIRA must not begin troubleshooting until it has resolved the technician's work context inside the UNS AND the technician has confirmed.**

A code path that emits troubleshooting advice before the gate is a **bug**. `/mira-run-hallucination-audit` exists to find these.

## 4. Constraints

### 4.1 Path construction

- **UNS-001** `[FATAL]` Paths under `enterprise.*` are built ONLY by the functions in `mira-crawler/ingest/uns.py`. Never hand-format `f"enterprise.knowledge_base.{mfr}.{model}"` anywhere in the codebase.
- **UNS-002** `[FATAL]` Slugs are produced by `uns.slug()` — lowercase, runs of non-alphanumeric collapsed to `_`. Never `.lower().replace(" ", "_")` ad-hoc.
- **UNS-003** `[FATAL]` UNS paths are lowercase. Display names (e.g., `"Rockwell Automation"`) live on `UNSContext.manufacturer`; the path segment is `uns.slug("Rockwell Automation")` → `rockwell_automation`.
- **UNS-004** `[FATAL]` Reserved labels in `uns.RESERVED_LABELS` (e.g., `site`, `area`, `equipment`, `fault_codes`) must never be used as manufacturer / model / instance slugs.
- **UNS-005** `[WARNING]` Pure-digit models are valid when adjacent to a known vendor/family. `"PowerFlex 525"` → `model="525"`. The old "must contain a letter" rule in `_looks_like_model_number` is wrong for this case — do not reintroduce.

### 4.2 Message resolution

- **UNS-010** `[FATAL]` One extraction point per turn. Vendor, model, fault code, and category are resolved in `mira-bots/shared/uns_resolver.py` and stored on `state["uns_context"]`. Never call `vendor_name_from_text()` or `_looks_like_model_number()` directly in engine, workers, or DST code — they are private to the resolver.
- **UNS-011** `[FATAL]` Fault codes are extracted BEFORE model candidates. Fault patterns (`F0004`, `E001`, `oC`, `A002`) must be stripped from the model-candidate token list before the model heuristic runs. Otherwise `"powerflex 525 f0004"` mis-resolves to `model="f0004"` (the historical bug).
- **UNS-012** `[WARNING]` Confidence is a band (`high` / `medium` / `low`), not a freeform numeric score. Use the bands defined in `docs/specs/uns-message-resolver-spec.md` §2.4. Don't invent a new scheme per call site.
- **UNS-013** `[WARNING]` Offline mode is the floor. The resolver must produce a useful result without NeonDB. DB enrichment via `_enrich_from_db()` is additive; any DB error falls back to the alias-table-only result.

### 4.3 The location gate

- **UNS-020** `[FATAL]` The FSM cannot reach the `troubleshooting` state without passing through the gate. New front doors (Teams, email, voice, web chat) must invoke the gate; they cannot bypass to direct LLM completion.
- **UNS-021** `[FATAL]` Never auto-confirm context based on a thumbs-up emoji reaction or a single-character reply. Require text confirmation or an explicit button click.
- **UNS-022** `[FATAL]` Never default to "common asset", "Line 1", or any other guess. When no UNS match exists, ask for context; do not fabricate.
- **UNS-023** `[WARNING]` When confidence is `low` (only message-text hint, no UNS match), ask the technician for context rather than presenting a candidate.
- **UNS-024** `[WARNING]` Confidence `high` requires a UNS match plus at least one corroborating evidence source (work-order history, PLC tag match, prior session, technician hint).
- **UNS-025** `[WARNING]` When the technician changes asset mid-thread, reset the gate via `_clear_diagnostic_carryover` — do not carry context across asset changes.

### 4.4 KG / persistence

- **UNS-030** `[FATAL]` Every asset row in `kg_entities` has `uns_path` set, or an `equipment_entity_id` FK. No free-form manufacturer/model string pairs.
- **UNS-031** `[BLOCKING]` UNS-related migrations go through `apply-migrations.yml` (`dry-run` then `apply`) in the dev → staging → prod order. Hub `mira-hub/db/migrations/` is authoritative for proposals/wizard/readiness columns; engine `docs/migrations/` keeps `kg_entities`/`kg_relationships` only (ADR-0013).

### 4.5 MQTT / Sparkplug B

- **UNS-040** `[WARNING]` MQTT topic mapping to MIRA's UNS must respect ISA-95 hierarchy and translate via `mira-relay` / `mira-crawler/ingest/uns.py` builders — not via free-form `topic.replace("/", ".")` shortcuts.
- **UNS-041** `[STYLE]` Sparkplug B `spBv1.0/group_id/MESSAGE_TYPE/edge_node_id/device_id` topic segments translate to ISA-95 levels by convention; document the mapping in code comments at each translation site.

## 5. Workflow — the gate, in detail

When implementing or reviewing the gate, walk these steps in order:

1. **Receive technician message** at the front-door adapter (Slack: `mira-bots/slack/bot.py`).
2. **Extract candidates** — asset, line, area, machine, component, symptom, fault_code — from message text + thread context + user profile. All extraction lives in `uns_resolver.py`; do not duplicate.
3. **Search the UNS** via `uns_resolver.resolve_uns_path()`. For multi-candidate use `resolve_uns_path_multi()`.
4. **Identify candidates** — top K (default 3) `(site, area, line, asset, component, fault, evidence)` tuples.
5. **Gather evidence** for the top candidate: message hint, work-order history hit, PLC tag match, manual reference, prior session context, technician profile hint.
6. **Send the confirmation message** to Slack. The structured payload contains site / area / line / machine / asset / component / fault / evidence list / confidence band / confirm-buttons.
7. **Wait** for confirmation, correction, or "different asset". Implement timeout + re-prompt cycle.
8. **Only after confirmation, transition** FSM `awaiting_context` → `troubleshooting`.

### Confirmation message shape

```
I think you are working on:

Site:       <site>
Area:       <area>
Line:       <line>
Asset:      <asset>
Component:  <component>
Fault/Symptom: <fault or symptom>

Evidence:
• <hint 1>
• <hint 2>
• <hint 3>

Confidence: <high|medium|low>

Confirm before I troubleshoot.
[ ✅ Yes ]   [ ✏️ Different asset ]   [ ❌ Wrong, let me clarify ]
```

Slack rendering uses block-kit; the engine returns a structured payload that the adapter renders. See `mira-maintenance-workflow/references/slack-message-templates.md` for the canonical block-kit JSON.

## 6. Edge cases

- **No UNS match at all** → don't fabricate. Ask for asset/line/component (UNS-022, UNS-023).
- **Multiple equally-likely candidates** → present top 2 side-by-side and ask the technician to pick.
- **Technician corrects the candidate** → record the correction as evidence for future inference; transition to `troubleshooting` with the corrected context.
- **Technician changes asset mid-thread** → reset the gate (UNS-025).
- **Quick repeat fault on same asset** → prior-session context is evidence, but still confirm.
- **Imperative language ("just tell me how to fix the conveyor")** → still gate. The gate is cheap; the bug is expensive.

## 7. Anti-patterns (these are bugs)

- Returning troubleshooting advice on the first message without confirmation (UNS-020).
- Defaulting to a guess (UNS-022).
- Marking confidence `high` without a UNS match (UNS-024).
- Skipping the gate when the technician uses imperative language.
- Auto-verifying the candidate after a thumbs-up reaction (UNS-021).
- Hand-formatting `f"enterprise.knowledge_base.{mfr}.{model}"` (UNS-001).
- Lowercase ad-hoc via `.lower().replace(" ", "_")` (UNS-002).

## 8. Common errors (error message → cause → fix)

| Error / symptom | Likely cause | Fix |
|---|---|---|
| Resolver returns `model="f0004"` for "powerflex 525 f0004" | Fault code not stripped from model candidates | Verify `_extract_fault_codes()` runs before `_find_model_near_vendor()` (UNS-011) |
| UNS path has mixed case | Slug not via `uns.slug()` | Replace ad-hoc lowercasing with `uns.slug()` (UNS-002, UNS-003) |
| Engine begins troubleshooting on first message | FSM transition allowed pre-gate | Audit `mira-bots/shared/engine.py`; restore the `awaiting_context → troubleshooting` transition guard (UNS-020) |
| `kg_entities` rows missing `uns_path` | New writer skipped the resolver | Add `uns_path` population at the writer or migrate with backfill (UNS-030) |
| MQTT topic ingestion produces invalid ltree | Free-form replace shortcut | Route through `uns.py` builders (UNS-040) |
| Context persists after technician switches asset | `_clear_diagnostic_carryover` not called | Wire it on asset-change detection (UNS-025) |

## 9. Output checklist

Before declaring a UNS-touching change complete, verify all of:

- [ ] All UNS paths built via `mira-crawler/ingest/uns.py` functions.
- [ ] All slugs via `uns.slug()`.
- [ ] All paths lowercase.
- [ ] No reserved labels used as manufacturer/model/instance slugs.
- [ ] Fault codes extracted before model candidates.
- [ ] Resolver extraction happens once per turn; downstream consumers read `state["uns_context"]`.
- [ ] Confidence reported in bands, not floats.
- [ ] Offline mode produces a useful result (DB optional).
- [ ] The FSM cannot reach `troubleshooting` without passing the gate.
- [ ] The confirmation message contains site / area / line / machine / asset / component / fault + evidence + confidence + buttons.
- [ ] Auto-confirmation on emoji reactions blocked.
- [ ] `_clear_diagnostic_carryover` wired on asset-change.
- [ ] Golden cases added/updated in `tests/golden_*.csv` for each edge case touched.
- [ ] `/mira-run-hallucination-audit` run and passing.

## 10. References

See `references/` for depth:

- `references/uns-path-grammar.md` — slug grammar, reserved labels, path templates, ltree storage shape.
- `references/resolver-state-machine.md` — vendor/model/fault extraction order, confidence assignment, offline fallback path.
- `references/gate-message-templates.md` — confirmation block-kit JSON, timeout behavior, correction handling.

## 11. Cross-references

- `mira-platform/SKILL.md` — doctrine, environment boundaries.
- `mira-industrial-safety/SKILL.md` — safety reroute supersedes the gate for safety-keyword messages.
- `mira-component-profile/SKILL.md` — what sits at a UNS address.
- `knowledge-graph-proposer/SKILL.md` — KG relationships keyed off UNS paths.
- `mira-maintenance-workflow/SKILL.md` — the gate is the first stage of the workflow.
- `slack-technician-ux-writer/SKILL.md` — Slack message style outside the gate.
