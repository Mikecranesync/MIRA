# Weekend runbook — CV-200 interlock demo (MIRA understands factory context)

**Thesis:** MIRA doesn't just read isolated tags — it explains *why CV-200 will not run* by grounding
in **approved** `kg_relationships` interlock edges (the consume side of the interlock flywheel,
PR #2391). **Local, deterministic, replayable. No DB, no PLC, no Ignition, no cloud, no secrets.**

The feature flag `MIRA_INTERLOCK_CONTEXT_ENABLED` stays **default-off**; this demo enables interlock
context **for its own run only** (a call-time flag), never globally.

---

## What it proves (in one screen)

- **Flag OFF (default):** MIRA surfaces **no** interlock context — isolated tag values only.
- **Flag ON (scoped):** MIRA recalls the **verified** CV-200 interlock chain and answers:
  > The Discharge Conveyor CV-200 is not running: the run permissive `vfd_run_permit` is FALSE
  > because the blocking condition `pe_latched` is TRUE.
  …with **`plc_rung` citations** and actionable next checks.
- **Unapproved edges are ignored:** the fixture also contains `proposed` edges
  (`dust_collector_ok`, `upstream_jam`) — the verified-only recall never cites them.

## 1. Run it (no setup — pure Python, stdlib)

```bash
cd ../mira-weekend-cv200        # the weekend worktree

# the demo: interlock context ON (scoped), photoeye blocked -> conveyor stopped
python tools/flywheel/cv200_interlock_demo.py --enable-interlock

# the default baseline: flag OFF -> no interlock context
python tools/flywheel/cv200_interlock_demo.py

# conveyor running (beam clear) -> nothing blocked
python tools/flywheel/cv200_interlock_demo.py --enable-interlock --clear
```

## 2. Expected output (flag ON, blocked)

```
live state: {'photoeye_blocked': True, 'vfd_run_permit': False, 'motor_running': False}
recalled approved edges: 4
ANSWER: The Discharge Conveyor CV-200 is not running: the run permissive 'vfd_run_permit'
        is FALSE because the blocking condition 'pe_latched' is TRUE.
  citations: 4 | grounded: True
artifacts -> out/demo/cv200_interlock
```

## 3. Artifacts

`out/demo/cv200_interlock/`
- `interlock_answer.json` — the full structured result (recalled edges, live state, grounded answer, evidence).
- `interlock_report.md` — a readable, screen-share report: recalled approved edges, the grounded
  answer, the `plc_rung` citations (file:line + excerpt), and next checks.

## 4. How it stays honest (the wiring, briefly)

- Reuses the **production consume module** `mira-bots/shared/interlock_context.py` **unchanged**:
  `recall_interlocks()` (verified-only store read) → `evaluate_permissive()` (read-only live model)
  → `build_interlock_answer()` (pure; returns `None` on empty recall).
- The store is an **in-memory fake cursor** serving the fixture through the **real**
  `recall_interlocks` — so the `verified` approval gate, tenant scope, and ltree subtree filter are
  genuinely exercised. No Neon DB, no `NEON_DATABASE_URL`.
- Inclusion is gated exactly like `engine._build_interlock_context`: off unless enabled; the runner
  passes `enabled=True` for the demo run only and **never mutates `os.environ`**.

## 5. Fixture (what "approved" looks like)

`tools/flywheel/fixtures/northwind_cv200_interlocks.json` — CV-200 UNS
`enterprise.riverside.area.packaging.line.line1.equipment.discharge_conveyor_cv200`:
- **verified:** `e_stop_ok`,`_IO_EM_DO_02` → `vfd_run_permit` (USED_IN_LOGIC); `vfd_run_permit` →
  `motor_running` (USED_IN_LOGIC); `pe_latched` → `vfd_run_permit` (CAUSES) — each with a `plc_rung` citation.
- **proposed (must be ignored):** `dust_collector_ok` → `vfd_run_permit`; `upstream_jam` → `motor_running`.

## 6. Tests

```bash
python -m pytest tests/flywheel/test_cv200_interlock_demo.py -q          # the 8 demo proofs
python -m pytest tests/flywheel/test_interlock_answer.py -q              # existing flywheel logic (regression)
```

## Out of scope (unchanged)
- Flipping `MIRA_INTERLOCK_CONTEXT_ENABLED` globally / changing its default.
- Editing `engine.py` / `interlock_context.py`; any Ignition (`plc/ignition-project/NorthwindBottling/**`),
  PLC code, or live device; prod credentials / real DB; synthetic-user or seed rewrites.

## Follow-up (not in this demo)
- A `DATABASE_URL`-gated integration test that seeds these edges into a real Neon staging branch and
  recalls them through `fetch_interlocks` (the DB round-trip) — the pure/offline half is proven here.
- Wiring the CV-200 asset-context (tenant + UNS) into a live engine turn behind the flag for a
  Perspective "Ask MIRA" surface (separate, gated).
