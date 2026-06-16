# PLAN — Path to Beta Testers (next official dev phase)

**Branch:** `feat/path-to-beta` · **Worktree:** `.claude/worktrees/path-to-beta` · **Base:** origin/main `4b9778c8`
**Authored:** 2026-06-07 · **Owner:** Mike Harper (operator)

## North Star (the beta gate)
A maintenance person can upload their own equipment manual, ask a real troubleshooting
question, and MIRA returns a grounded answer with citations from that uploaded manual —
**without Mike manually fixing anything.**

## Scope (numbered — the contract)

1. **Lane 1 — Repo memory / North Star alignment.** Add the BETA GATE line to root
   `CLAUDE.md` North Star; add the 4-week beta phase to `NORTH_STAR.md`; record blockers in
   `wiki/hot.md`; add beta-readiness as primary focus to `.claude/CLAUDE.md`. Update auto-memory.
2. **Lane 2 — Upload-to-retrieval gap investigation.** Trace the full upload path (CodeGraph),
   write a findings doc, assess PR #1592 (right fix? mergeable? minimal path), and write a
   **failing** test `tests/beta/test_upload_retrieval_citation.py` that proves the gap.
3. **Lane 3 — Beta demo tenant / empty state.** Idempotent seed (`tools/seeds/beta_demo_seed.py`
   or `.sql`) for the bench story (CV-101, Micro820, GS10 + fault codes, manuals, WOs, KG nodes,
   a known-good Q/A). Design a first-run empty-state message.
4. **Lane 4 — Graph stability.** Confirm PR #1742 (NaN coord fix) merge/deploy state; add a
   regression test for empty/NaN graph coords.
5. **Lane 5 — Ignition Ask MIRA readiness.** Check HMAC key in Doppler prd, WebDev deploy state,
   `ignition_chat.py` `source="direct_connection"`, endpoint health. Write
   `docs/runbooks/activate-ignition-ask-mira.md`.
6. **Lane 6 — Beta readiness verification harness.** `tests/beta/beta_ready_upload_retrieval_citation.py`
   — the RELEASE GATE test (expected to FAIL until the gap closes). PDF fixture
   `tests/beta/fixtures/gs10_fault_codes.pdf`.

## OUT of scope (do NOT touch)

- Merging PR #1592, #1742, or any PR (operator merges; I only assess + flag).
- Any prod deploy, VPS SSH, `docker compose` on VPS, prod NeonDB `psql`, prod schema edits.
- Engine FSM/gate logic rewrites (`engine.py`) — Lane 2 closing-the-gap code is NOT in scope
  this session; investigation + failing test only.
- Reading/writing prod Telegram bot; pointing any build at `@FactoryLM_Diagnose`.
- Rotating/printing secret VALUES (Doppler key presence check only — name, not value).
- Touching `mira-hub` schema migrations against any live DB.

## Per-task success criteria

1. Lane 1: BETA GATE line present in root CLAUDE.md; 4-week plan in NORTH_STAR.md; hot.md session
   block added; .claude/CLAUDE.md beta-focus line. Memory file + MEMORY.md index line.
2. Lane 2: `docs/research/2026-06-07-upload-retrieval-gap-and-beta-path.md` exists with the traced
   path + #1592 assessment + minimal close path. `pytest tests/beta/test_upload_retrieval_citation.py`
   runs and **fails/xfails for the documented reason** (marker explaining it's the gate).
3. Lane 3: seed script is idempotent (re-run = no dup rows), labels rows as demo, offline-safe
   (does NOT require prod). Empty-state copy written to a doc.
4. Lane 4: PR #1742 state confirmed in writing; regression test added that asserts no crash on
   empty/NaN coords.
5. Lane 5: runbook exists with exact PLC-laptop steps; Doppler key presence reported; endpoint health.
6. Lane 6: release-gate test exists, importable, runs, clearly marked as the beta gate.

## Verify steps
- `ruff check` on any `.py` touched.
- `pytest tests/beta/ -q` runs (gate tests may xfail by design).
- `git diff --name-only $(git merge-base origin/main HEAD)..HEAD` contains nothing in OUT-of-scope.
- HANDOFF.md written at stop with row-by-row PLAN status.
