# 2026-05-14 — Tablet Demo Backend Plan (May 21, 2026)

**One-liner:** Wire the component intelligence layer end-to-end on one demo conveyor so a tech with a tablet can ask MIRA "is the PLC seeing this sensor?" and get a grounded answer.

**Deadline:** 2026-05-21 (Florida Automation Expo). T-7 days.
**Scope-lock:** This plan covers backend only. Frontend (tablet UI) is consumed via existing Hub routes + a thin demo page; no new app surface.
**North Star:** Slack = front door · UNS = nervous system · KG + templates = memory · Customer docs + WOs = evidence.

---

## Phase 1 — Repository Discovery (COMPLETE)

### What exists
| Area | Status | Files |
|---|---|---|
| Component intelligence schema | ✅ Merged | `mira-hub/db/migrations/016_component_templates.sql`, `017_installed_component_instances.sql`, `018_relationship_proposals.sql` |
| UNS ltree on `kg_entities` | ✅ | `mira-hub/db/migrations/010_kg_uns_path.sql` + `014_uns_path_backfill.sql` |
| UNS ltree on `cmms_equipment` | ✅ | `mira-hub/db/migrations/015_equipment_uns_path.sql` |
| Knowledge graph base | ✅ | `mira-hub/db/migrations/001_knowledge_graph.sql` (kg_entities/relationships/triples_log) |
| External ID columns (plc_tag, mqtt_topic, scada_path) | ✅ | `mira-hub/db/migrations/013_external_ids.sql` |
| Variable manifest (78 PLC vars, GS10 VFD, sensors, faults) | ✅ | `research/variable-manifest.json` |
| Micro820 ST source | ✅ | `plc/Prog2.stf` |
| Ignition tag emitter (Micro820 → tag JSON) | ✅ | `mira-machine-logic-graph/` (bun + TS) |
| Manifest → KG loader (proposals + evidence) | ✅ Tool | `tools/load_manifest_to_kg.py` |
| Component template builder (LLM extraction) | ✅ Tool | `tools/build_component_template.py` |
| Slack adapter (Socket Mode, slack_bolt) | ✅ | `mira-bots/slack/bot.py`, `chat_adapter.py` |
| Slack OAuth callback | ✅ | `mira-hub/src/app/api/auth/slack/route.ts` + `callback/route.ts` |
| Supervisor engine | ✅ | `mira-bots/shared/engine.py` |
| Chat dispatcher | ✅ | `mira-bots/shared/chat/dispatcher.py` |
| UNS browse/subtree API | ✅ | `mira-hub/src/app/api/uns/{browse,subtree}/route.ts` |
| MCP server (FastMCP + atlas/maintainx/fiix/limble adapters) | ✅ | `mira-mcp/server.py`, `mira-mcp/cmms/*.py` |
| Modbus driver scaffold | ✅ | `mira-connect/mira_connect/drivers/modbus_driver.py` |

### What's missing
| Gap | Risk | Owner of fix |
|---|---|---|
| `slack-technician-workflow-spec.md` (user referenced, not in repo) | M — written intent only in skill descriptions + chat | P4 |
| **Namespace confirmation gate** in Slack engine — no FSM state that blocks troubleshooting until asset/component context is confirmed | **H — North Star non-negotiable** | P4 |
| Live signal source for demo (real MQTT/Modbus too risky for tablet demo on May 21) | M | P5 mock |
| Tablet-friendly read API: `/api/demo/conveyor/:id/context` returning asset + components + recent signals + last 3 work orders, one round-trip | H | P3 |
| Demo seed (Conveyor 001, PE-001/MTR-001/VFD-001/PLC-001/PANEL-001, UNS, PLC tag bindings, relationship_proposals chain, PE-001 template) | H | **P2 (this PR)** |
| `cmms_equipment` table — referenced by 014/015/017 but CREATE TABLE not in mira-hub/db/migrations (lives in Atlas DB or earlier shared schema) | M — verify before seed runs in prod | P2 verify step |
| Promotion path from `relationship_proposals.verified` → `kg_relationships` (spec says "follow-up PR") | L — seed inserts both directly | P6 |

### Reuse vs build
**Reuse as-is:**
- `tools/load_manifest_to_kg.py` — already proposes 4 edge types (HAS_ALIAS, MAPS_TO, WIRED_TO, PUBLISHED_AS) from the manifest. Use it to populate sensor-side edges.
- `mira-bots/slack/bot.py` — already wires `Supervisor(engine)` + `ChatDispatcher`; add intent handler + namespace gate.
- `mira-hub/src/app/api/uns/subtree/route.ts` — already returns subtree by uns_path prefix. The tablet UI reads from this.
- Migrations 014/015/016/017/018 — apply via `ops/apply-prod-migrations` workflow (already exists per commit 832552e5).

**Build new:**
- Demo seed SQL + Python runner — **P2 (now)**.
- Namespace-confirmation FSM state in `shared/engine.py` — **P4**.
- Tablet context endpoint + mocked signal feed — **P3 + P5**.
- 5 troubleshooting question handlers wired to KG queries — **P6**.

---

## Phases 2–8 — Order + Effort

| # | Phase | Deliverable | Effort | Blocks |
|---|---|---|---|---|
| **2** | **Demo seed (NOW)** | `tools/seeds/demo-conveyor-001.sql` + `run_demo_seed.py` — 1 tenant, 1 asset, 5 components, 5 UNS paths, ~30 PLC-tag-bound instances from manifest, PE-001 template fully populated, HAS_COMPONENT + WIRED_TO + POWERED_BY + USED_IN_LOGIC proposals + matching `kg_relationships` for demo queries | **4h** | P3, P6 |
| 3 | Tablet read API | `GET /api/demo/conveyor/:tag` returning `{asset, components[], plc_tags[], recent_signals[], last_wo[]}` in one round-trip; tablet UI hits this | 6h | P8 |
| 4 | Slack namespace gate | New FSM state `AWAITING_NAMESPACE` in `shared/engine.py`; blocks routing to troubleshooting until `tenant + asset_id` (or asset_tag) is confirmed; emits Slack block with asset picker; writes `slack-technician-workflow-spec.md` | 6h | P7 |
| 5 | Mock signal feed | `tools/demo/signal_replayer.py` — replays a 90s scripted scenario (sensor health → motor start → VFD comm error → recovery) into a `signal_samples` table; tablet polls latest | 3h | P3 read |
| 6 | KG query handlers | 5 typed query functions in `mira-bots/shared/kg_queries.py`: `does_plc_see_sensor`, `where_is_wired`, `why_motor_stopped`, `flag_count`, `first_check_recommendation`. All return `(answer, evidence[], confidence)`. | 8h | P7 |
| 7 | Engine + intent classifier wire-up | Route the 5 demo intents through `Supervisor` → `kg_queries` → grounded answer; reject ungrounded answers (no evidence → "I can't confirm, please verify with…") | 5h | demo |
| 8 | Tablet demo page | `mira-web/src/app/demo/conveyor/[tag]/page.tsx` — single page, 3 panels: live signals, KG/component card, Slack-like chat embedded; reuses Hub design tokens | 6h | demo |

**Total backend effort: ~38h (5 working days). One person can ship by 2026-05-19 dry-run.**

## Hard rules (lifted from North Star)

1. **No confirmed namespace context, no troubleshooting.** FSM enforces this in P4. The 5 KG query handlers in P6 take `(tenant_id, asset_id, component_id)` as required args — there is no path to call them without context.
2. **Every answer cites evidence.** Each KG query returns `evidence[]` (manifest entry / wiring note / WO id / manual chunk). Empty evidence array → engine must refuse with a help message.
3. **No Anthropic.** Groq → Cerebras → Gemini cascade only.
4. **Apache 2.0 / MIT only.** Banner QS18 spec is public; manifest is internal Micro820 work.

## Verification gates

| Gate | When | How |
|---|---|---|
| Seed loads cleanly | P2 done | `psql -f tools/seeds/demo-conveyor-001.sql` returns 0; `SELECT COUNT(*) FROM installed_component_instances WHERE tenant_id = '00000000-0000-0000-0000-0000000000d1'` ≥ 5 |
| Migrations 016–018 applied to prod | Before P3 | `ops/apply-prod-migrations` workflow run; smoke check `SELECT 1 FROM component_templates LIMIT 1` |
| Namespace gate blocks | P4 done | Pytest: send Slack message w/o asset context → engine returns asset-picker block, not LLM answer |
| KG queries grounded | P6 done | Each handler returns ≥1 evidence row from `relationship_evidence` for demo asset; refusal path emits explicit "no evidence" |
| Tablet renders on iPad Safari | P8 done | Playwright snapshot at 1024×768 + 820×1180 portrait |
| May 18 dry-run | T-3 | Full demo script from `demo-readiness-may21-spec.md` passes on physical tablet |

## What this plan deliberately does NOT do

- Real-time MQTT subscription (deferred — mock feed for demo).
- Promotion service from `relationship_proposals` → `kg_relationships` (use direct insert for demo; build promotion in post-demo PR).
- Auth on the demo page (single-tenant, single asset; bearer-token guard is sufficient).
- New component templates beyond PE-001 + GS10 (use placeholders for MTR/PLC/PANEL with `verification_status='proposed'`).

## Tracking

- Linear: hit Free tier limit (per memory) — track in GitHub issues only until resolved.
- Issues to file after this plan lands: P3, P4, P5, P6, P7, P8 (one each).

---

## 2026-05-15 — Phases 4–6 status (this PR)

Task brief used different numbering than the plan above; reconciling here.

| Brief phase | Plan phase(s) | Status in this PR |
|---|---|---|
| **Brief P4: signal simulator + event store** | P5 (mock signal feed) | ✅ Migration 020 adds `live_signal_cache` (current state, keyed on `(tenant_id, plc_tag)`), `diagnostic_trend_sessions`, `diagnostic_trend_signals`. New helper `mira-hub/src/lib/signal-recorder.ts` is the single write path that fans out to events + cache and reports edge classification. Endpoints: existing `POST /api/demo/signals/toggle` now writes through the recorder; new `POST /api/demo/signals/set` (arbitrary value by plc_tag or component_id) and `GET /api/demo/signals/summary` (full cache snapshot). Transition counting lives in `countTransitions` (LAG window over the events table). |
| **Brief P5: wire /api/mira/ask to real data** | P6 + P7 (KG handlers, intent wire-up) | ✅ The Phase 3 ask endpoint already pulled `components`, `kg_relationships`, and recent `live_signal_events`. This PR adds: cache-derived "current signal state" block, transition count injection when the question mentions "in the last N seconds/minutes", and a `trend_proposal` payload (non-creating) when the question implies a recurring fault. We deliberately did NOT add 5 named KG handlers — the existing context-injection path covers the demo's 5 question shapes and stays smaller. |
| **Brief P6: Slack namespace gate** | P4 (Slack namespace gate) | ✅ The gate landed in PR #1280 (engine.py `_handle_uns_confirmation_request`). This PR adds the tenant-scoped lookup path: `mira-bots/shared/demo_namespace.py` matches asset tags (CV-001, PE-001…) and names ("Conveyor 001") against `kg_entities` + `installed_component_instances` for the active tenant; the gate consults it *before* the generic manufacturer/model prompt. The existing UNS resolver is untouched (no global VENDOR_ALIASES drift). When the tech confirms, the match's `asset_id`/`component_id` lands on `state["context"]["confirmed_namespace"]` so downstream retrieval can target the KG row. |

Also fixed in this PR: migration 019 policies were not idempotent (no `DROP POLICY IF EXISTS`). Patched to match the pattern PR #1296 established for 017/018.

Out of scope (still per the original plan or follow-up):
- P3 tablet read API — already merged in PR #1295.
- Real-time MQTT subscription — still mocked.
- Promotion service from `relationship_proposals.verified` → `kg_relationships` — still direct-insert.
- Tablet demo page (P8) — frontend, separate PR.
