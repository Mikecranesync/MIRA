# PLAN — feat/dt2026-gap-closure (Phases 5–9: engine/intelligence layer)

**Status:** Active (2026-06-02)
**Branch:** `feat/dt2026-gap-closure` (worktree `/Users/charlienode/MIRA-gapclose`, off `feat/hub-command-center` @ `80d5c624`)
**Task source:** Mike's "continue Walker DT gap closure, build Phases 5–9" brief, 2026-06-02
**Companion docs:** `docs/plans/current-state-gap-closure-plan.md` (Phase 0 truth audit),
`docs/plans/2026-06-01-mira-master-architecture-plan.md` (master plan).

> Phases 0–4 already shipped on this branch (7 commits, migrations 032–036,
> `POST /api/v1/tags/ingest`, Ignition collector, Command Center freshness).
> This PLAN is THIS session's scope contract: Phases 5–9, the intelligence
> layer that reads the Phase-1 tables.

---

## In-scope (this session) — numbered

### P5 — Tag diff / event-stream logger
1. `mira-relay/tag_diff_logger.py` — `compute_diffs()` pure fn + store-agnostic
   `TagDiffLogger` (same store-injection pattern as `tag_ingest.py`).
   Transitions: digital 0→1 / 1→0, analog threshold crossings (configurable),
   quality good→bad, fault windows (group events ±N s around a fault trigger).
2. `mira-hub/db/migrations/037_tag_event_diffs.sql` — NET-NEW sink table for the
   meaningful-diff stream (plan §4.1 anticipated "its own `tag_event_diffs`
   table later"). RLS, append-only, provenance (`simulated`) carried through.
3. `mira-relay/tests/test_tag_diff_logger.py` — fixture-driven, in-memory store.

### P6 — Reconcile bench MQTT/demo namespace → ISA-95 UNS
4. `mira-relay/uns_topic_map.py` — mapping config loader + `resolve_topic_to_uns()`
   that builds paths via `mira-crawler/ingest/uns.py` builders (NOT hand-formatted).
5. `mira-relay/config/bench_uns_map.json` — seed mapping for the garage bench
   (Micro820 tags, GS10 tags, sensor tags) as structured UNS components.
6. `mira-relay/tests/test_uns_topic_map.py` — proves demo topics resolve to
   `enterprise.*` builder output.
7. `mira-pipeline/ignition_chat.py` + minimal additive engine hook: stamp
   `state["context"]["uns_context"]["source"]="direct_connection"` for Ignition
   turns. **Scope guard:** this marks + records the source (so Phase 9 traces it
   and the rule's audit can see it); it does NOT change gate-firing — the full
   gate bypass is master-plan **P6**, explicitly out of this work stream
   (gap plan §2.4). Additive optional kwarg only; default behavior unchanged.

### P7 — Flaky-input detector on real `tag_events`
8. `mira-relay/flaky_detector.py` — `FlakyInputDetector` reads real `tag_events`,
   counts transitions per configured digital tag in a window, compares stable
   peers, writes `flaky_input_signals` with `evidence_event_ids` → real
   `tag_events.event_id`. Simulated alerts marked `simulated`. NEVER auto-verify.
9. `mira-relay/config/flaky_rules.json` — bench config (PE-101/PE-102/PX-101).
10. `mira-relay/tests/test_flaky_detector.py` — stable→no alert, chatter→alert
    with evidence, simulated→marked, proposal created NOT verified.

### P8 — KG proposal loop from live evidence
11. In the detector's bridge step: create a `relationship_proposals` row
    (status `proposed`, `created_by='rule'`) linking the flaky signal's tag
    entity → asset/component, plus `relationship_evidence` rows
    (`evidence_type='live_data'`) pointing at `tag_events` + `flaky_input_signals`,
    and an `ai_suggestions` `kg_edge` header. Respect ADR-0017 (proposed only).
12. Document Hub `/proposals` wiring (route reads `relationship_proposals` +
    counts `relationship_evidence` — already surfaces; record what shows).

### P9 — Decision-trace writer
13. `mira-bots/shared/decision_trace.py` — `DecisionTraceWriter` writes a
    `decision_traces` row (PII-sanitized question/recommendation).
14. Wire into `mira-bots/shared/engine.py` `process()` after `_log_interaction`,
    before `return reply`. Captures uns_context (path/source/confidence),
    tag/manual/kg evidence, recommendation, citations_present, technician_confirmed
    (nullable), outcome (nullable). **CRITICAL:** trace write wrapped in
    try/except — never blocks or fails the user response.
15. `mira-bots/tests/test_decision_trace.py` — trace written, tag evidence when
    available, citations when present, failed write doesn't block response.

### Wrap
16. Run gates (ruff, pytest relay + bots, any TS build if touched), update
    `wiki/hot.md`, write `HANDOFF_2026-06-02_P5-9.md`, final commit, push.

---

## Out-of-scope (HANDOFF to operator). Editing these = STOP.

| Item | Why |
|---|---|
| Full `direct_connection` gate **bypass** in `engine.py` (skip steps 6–7) | Master-plan **P6**; large engine blast radius; gap plan §2.4 defers it. P6 here only sets the source marker. |
| Citation **enforcement** (make compliance block) | Master-plan P7 |
| `kg_writer.py` re-route + proposal-transition helper | Master-plan P3; not flaky-loop |
| Hub `/proposals` rendering `ai_suggestions` (non-edge types) | Solve-stage gap, separate |
| `mock_tag_stream.py` / scenarios | Master-plan P4 (engine-side), separate |
| Any prod NeonDB / prod docker / VPS SSH / `@FactoryLM_Diagnose` | Always |
| Migration renumber vs origin/main 030+ collision | Handle at merge time, operator |

---

## Stop conditions
- All 16 items complete → run gates, write HANDOFF, stop.
- Token > 70% / turns > 200 → stop, HANDOFF.
- Edit would touch an OUT-of-scope path → STOP.
- 5 consecutive turns on one failing test → STOP, HANDOFF.
- `codegraph_impact` on `engine.py` shows unexpected blast radius → narrow, surface.

---

## Verification gates
| Item | Gate |
|---|---|
| P5 | `pytest mira-relay/tests/test_tag_diff_logger.py -q` green; migration parses |
| P6 | `pytest mira-relay/tests/test_uns_topic_map.py -q` green; paths match `uns.*` builder output; ignition_chat source set |
| P7 | `pytest mira-relay/tests/test_flaky_detector.py -q` green; no auto-verify |
| P8 | proposal row `status='proposed'`, evidence rows present, never `verified` |
| P9 | `pytest mira-bots/tests/test_decision_trace.py -q` green; failed-write non-blocking |
| All | `ruff check` clean on changed `.py`; relay + bots suites pass |
