# Discovery — Weekend CV-200 / Northwind interlock demo (consume side of the flywheel)

Discovery-only pass (no code) for turning the merged **interlock flywheel** (PR #2391) into a
**local, replayable** weekend demo: MIRA explains *why CV-200 will not run* by grounding in
approved `kg_relationships` interlock edges — proving it understands factory **context**, not just
isolated tag values. Branch `feat/weekend-cv200-interlock-demo` (off `origin/main`, includes #2391).

## 1. Where the interlock flywheel plugs into the answer path
- Consume module: `mira-bots/shared/interlock_context.py`
  - `recall_interlocks(cur, tenant_id, asset_subtree, include_unapproved=False)` — reads **verified**
    `kg_relationships` (types `USED_IN_LOGIC` / `CAUSES`) under a UNS subtree, with `relationship_evidence`
    (the `plc_rung` citation). Empty recall ⇒ callers must refuse. `include_unapproved` (dev/test only,
    default off) is the ONLY way a `proposed` edge surfaces.
  - `fetch_interlocks(tenant_id, asset_subtree)` — psycopg2 wrapper over `recall_interlocks` (needs
    `NEON_DATABASE_URL`); returns `[]` on any miss.
  - `evaluate_permissive(...)` — deterministic, **read-only** model of the Conv_Simple run-permissive
    chain (stands in for a live PLC/Ignition read).
  - `build_interlock_answer(recalled, live_state, asset)` — PURE over (recalled edges, live state);
    returns `None` when `recalled` is empty (the core trust guard).
- Engine wiring: `mira-bots/shared/engine.py`
  - `_INTERLOCK_CONTEXT_ENABLED = os.getenv("MIRA_INTERLOCK_CONTEXT_ENABLED","0") == "1"` (line 388) —
    **default OFF**.
  - `Supervisor._build_interlock_context(state, tenant_id)` (line 3580): `if not _INTERLOCK_CONTEXT_ENABLED
    or not tenant_id: return ""` → else `fetch_interlocks` (to_thread, 3s timeout) → `build_interlock_answer`
    → `_format_interlock_context`. Woven into `extra_context` at line 3663. **Additive; never raises.**

## 2. Where approved `kg_relationships` are read from
`recall_interlocks` `_RECALL_SQL` (interlock_context.py:85) joins
`kg_relationships r → kg_entities se/te → relationship_evidence ev`, filtered by
`r.tenant_id`, `r.approval_state = 'verified'`, `r.relationship_type IN ('USED_IN_LOGIC','CAUSES')`,
and `te.uns_path <@ subtree OR se.uns_path <@ subtree` (ltree). Row shape (8 cols):
`source_name, target_name, relationship_type, confidence, evidence_summary, ev_type, ev_location, ev_excerpt`.

## 3. Northwind / CV-200 / conveyor fixtures that already exist
- **CV-200 UNS node:** `enterprise.riverside.area.packaging.line.line1.equipment.discharge_conveyor_cv200`
  (from `mira-hub/db/seeds/command_center_northwind_cv200.sql`).
- That seed registers only a **display_endpoint** (the live Perspective screen) — it does **NOT** seed
  any interlock `kg_relationships`. So the approved edges the demo needs do not exist in any local store.
- Other Northwind assets (reference, not modified): `tools/seeds/northwind-bottling-hub.sql`,
  `tools/seeds/approved_tags_northwind_cv200.sql`, `tools/command-center/northwind-cv200.json`,
  `tests/test_northwind_cv200_seed_and_config.py`, the `plc/ignition-project/NorthwindBottling/**`
  Perspective project (DO NOT TOUCH — Ignition), `simlab/docs/conveyorzone02/**`.
- The permissive chain modelled by `evaluate_permissive` mirrors `Prog_init_ConvSimple_v2.1.st:208-236`.

## 4. Demo scripts / replay fixtures that already exist
- `tests/flywheel/test_interlock_answer.py` — the **proven offline pattern**: hand-built `RecalledEdge`
  list (verified edges) + `evaluate_permissive` → `build_interlock_answer`; asserts grounded answer +
  `plc_rung` citation + "empty recall ⇒ None".
- `tests/flywheel/test_interlock_engine_wiring.py` — integration wiring (imports the full engine, sets
  the flag ON at import). Heavy (OpenWebUI/DB env). `test_interlock_extract.py` — the produce side.
- No existing **CV-200-specific** interlock fixture or standalone local runner. That is the gap.

## 5. Smallest safe implementation plan
Reuse the consume module unchanged; add a **local demo harness** that needs no DB and no live device:
1. **Deterministic fixture** of CV-200 interlock edges (verified **and** a couple `proposed`) under the
   CV-200 UNS subtree, each with a `plc_rung` citation — the rows a real approve step would produce.
2. **In-memory fake cursor** that serves those rows through the **real** `recall_interlocks` (honouring
   the `verified`-only vs `include_unapproved` SQL branch, tenant, and subtree) — so recall stays
   load-bearing and the approval gate is exercised without a DB.
3. **Local runner** `tools/flywheel/cv200_interlock_demo.py`: idempotent seed → recall → `evaluate_permissive`
   (photoeye-blocked scenario) → `build_interlock_answer` → render artifact (JSON + Markdown). Interlock
   inclusion is gated by a **call-time param** (`enabled`, default = the env flag) — the demo passes
   `True` for its own run only. **No global `os.environ` flip.**
4. **Runbook** + **tests** (the 7 proofs below).

Everything is additive, under `tools/flywheel/`, `tests/flywheel/`, `docs/`. No change to `engine.py`,
`interlock_context.py`, the flag default, Ignition, or PLC.

## 6. Files expected to change (all NEW)
- `tools/flywheel/fixtures/northwind_cv200_interlocks.json`
- `tools/flywheel/cv200_interlock_demo.py`
- `tests/flywheel/test_cv200_interlock_demo.py`
- `docs/demo/weekend_cv200_interlock_demo.md`
- `docs/discovery/weekend_demo_interlock_northwind_cv200.md` (this note)

## 7. Tests expected to add
- flag **off** ⇒ no interlock context (even with a live block + approved edges).
- flag **on** ⇒ approved interlock context included (grounded answer names permissive + blocker).
- **unapproved** (`proposed`) interlocks are ignored (verified-only recall excludes them; only
  `include_unapproved` surfaces them — proving the gate is what filters).
- **citations/evidence** present (`plc_rung` location + excerpt; `grounded=True`).
- **seeder idempotent** (seed twice ⇒ identical, de-duplicated edge set).
- **runner works in local/replay mode** (no `NEON_DATABASE_URL`, deterministic output).
- **no PLC write path** introduced (harness scan; `evaluate_permissive` is pure/read-only).

## 8. Out of scope (explicit)
- Flipping `MIRA_INTERLOCK_CONTEXT_ENABLED` globally / changing its default (stays OFF).
- Editing `engine.py` / `interlock_context.py` / the produce side.
- Any Ignition change (`plc/ignition-project/NorthwindBottling/**`), any PLC code, any live device.
- Prod credentials / real Neon DB / secret exposure.
- Rewriting synthetic users, the Northwind SQL seeds, or unrelated cleanup.
- Touching other worktrees / the primary checkout / `main`.

## Plan still small + safe? YES — proceed to build.
