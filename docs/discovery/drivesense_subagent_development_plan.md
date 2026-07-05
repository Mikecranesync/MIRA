# DriveSense Manual-Keypad — Subagent-Driven Development Plan

> **Status:** Discovery. A small-PR sequence to land the keypad/parameter phase, using the
> `superpowers:subagent-driven-development` pattern already used for the fault-card PRs (Haiku scout →
> author brief with exact values → Sonnet TDD builder → Sonnet task-review → fix loop → doc/version →
> PR). Each PR is independently shippable and behavior-preserving.
> **Objects** are defined in `drivesense_service_pack_schema_proposal.md` (canonical).
> **Base:** branch off `main` (current `ee74a0c8`, VERSION 3.69.0). Note `DriveDiagnostic` (#2486) is
> currently **open** on `feat/drivesense-response-object` — PR B should base on `main` *after* #2486
> merges, or rebase onto it; do not stack on an unmerged base (CI won't trigger — a known gotcha).

---

## Global constraints (every PR)

- **Read-only. View-only.** No parameter/keypad write or edit execution. No fieldbus client, no
  `socket`, no Modbus write function codes. The AST gate `mira-bots/tests/test_drive_packs_readonly.py`
  must pass over every new file under `drive_packs/**`.
- **No live fieldbus in tests.** All tests offline; new paths must survive `socket.socket` monkeypatched
  to raise (mirror the existing offline tests).
- **Behavior-preserving.** Existing byte-identical tests (`test_drive_diagnostic.py`,
  `test_live_snapshot.py`, `test_live_fault_card_wiring.py`) stay green — new fields default empty/None.
- **Citation honesty.** No fabricated page numbers; section-level floor; `tier ∈ {bench_verified,
  manual_cited}` (schema proposal axioms 2–3).
- **Pack edits re-sync the Hub copy** (`mira-hub/src/lib/drive-packs/gs10-pack.json`) or
  `test_drive_pack_hub_copy_sync.py` fails.
- **Tooling:** no local `ruff`; run `uvx --from 'ruff==0.9.*' ruff format|check <files>` before every
  PR (CI's `ruff format --check` has failed on a first push before). Run `mira-bots/tests` and
  `mira-pipeline/tests` in **separate** pytest invocations (conftest name-clash). Merges to `main`
  need `--admin` (phantom required check). Merging `main` auto-deploys hub+pipeline — **confirm with
  the user first**.

---

## PR A — Discovery docs only

- **Goal:** land these six discovery docs (this deliverable).
- **Files:** `docs/discovery/drivesense_*.md` (six). No code.
- **Tests:** none (docs). Markdown-lint if configured.
- **Safety:** n/a.
- **Do not touch:** any code, any pack, VERSION (docs-only PRs don't bump runtime; follow repo
  convention — a `chore(docs)` bump only if the version gate requires it).

## PR B — Schema / types only (the seam everything depends on)

- **Goal:** add the new dataclasses + extend `DriveDiagnostic` + bump `pack.json` schema_version to 2
  with v1 back-compat. **No data, no rendering, no wiring.**
- **Files (likely):**
  - `mira-bots/shared/drive_packs/schema.py` — add `ParameterCard`, `ValueMeaning`,
    `KeypadNavigationCard`, `DriveSenseServicePack`; extend `Citation`; add optional
    `parameters`/`keypad_navigation` to the pack model; support `schema_version` 1→2 back-compat in
    the loader (missing blocks → empty).
  - `mira-bots/shared/live_snapshot.py` — extend `DriveDiagnostic` with `related_parameters`,
    `keypad_navigation`, `evidence`, `unknowns`, `safety_warning` (all defaulted).
  - `mira-bots/shared/drive_packs/loader.py` — parse the new optional blocks; extend
    `_ALLOWED_TOP_LEVEL_PACK_KEYS` / `_REQUIRED_TOP_LEVEL_KEYS` handling for v2.
- **Tests:** dataclass shape/frozen; a v1 `pack.json` loads with empty new blocks; a v2 pack with the
  blocks parses; `DriveDiagnostic` defaults keep existing tests green; read-only gate still passes.
- **Safety:** no writes, no new imports beyond stdlib/dataclasses.
- **Do not touch:** `cards.py` rendering, `render_machine_evidence`, `assess_from_paths`, any GS10
  data, the Hub loader (schema only, no data yet), `engine.py`.

## PR C — GS10 keypad + parameter fixture (hand-curated data)

- **Goal:** hand-curate the GS10 CE10→P09.03 case (+ a few more parameters) as `manual_cited` pack
  data. No extraction.
- **Files (likely):**
  - `mira-bots/shared/drive_packs/packs/durapulse_gs10/pack.json` — add `parameters[]` +
    `keypad_navigation[]` blocks (schema_version 2), section-cited, `manual_cited`.
  - `mira-hub/src/lib/drive-packs/gs10-pack.json` — re-sync byte-identical.
  - (Optional) `mira-bots/shared/drive_param_intel.py` — an offline adapter parallel to
    `drive_fault_intel.py` **if** the data is cleaner as code than JSON; keep it outside `drive_packs/`
    if it ever touches a DB (it doesn't here).
- **Tests:** drift guard — every `related_faults` entry references a real pack fault code (mirror
  `test_gs10_fault_intel_matches_pack_fault_codes_exactly`); every `KeypadNavigationCard` has a
  non-empty `view_only_warning`; no `page` unless provable; `test_drive_pack_hub_copy_sync.py` green.
- **Safety:** view-only warning mandatory; no register `addr` invented; `parameter_id` (P09.03) kept
  distinct from any Modbus addr.
- **Do not touch:** rendering, `build_drive_diagnostic` wiring (comes in PR D), register `addr` (still
  deferred), other families.

## PR D — Wire `build_drive_diagnostic` + both surfaces render

- **Goal:** populate the new `DriveDiagnostic` fields from the active fault and render them on both
  the engine and Ignition text surfaces.
- **Files (likely):**
  - `mira-bots/shared/live_snapshot.py` — in `build_drive_diagnostic`, look up the active fault's
    `related_faults`-matching `ParameterCard`s, pick the top `KeypadNavigationCard`, flatten
    `evidence`, set `unknowns`/`safety_warning`; extend `render_machine_evidence` +
    `assess_from_paths` to append the "### Related parameter" / "### Keypad steps" blocks via **one
    shared render helper** (single source of truth, like the fault card).
- **Tests:** both surfaces render byte-identical related-parameter + keypad text; no active/GOOD fault
  → new fields empty, existing text unchanged; STALE fault still suppresses.
- **Safety:** `mira-industrial-safety` co-activation — a SAFETY keyword in the goal/steps triggers
  STOP/escalate over rendering.
- **Do not touch:** `ignition_chat.py` (the consumer already `\n\n`-joins multi-line evidence — no
  change needed, verify with a test); `engine.py` gate logic; `decision_traces` (PR G).

## PR E — End-to-end proof: CE10 → P09.03 keypad guide

- **Goal:** the acceptance test proving the whole arc.
- **Files (likely):** `mira-bots/tests/test_drive_keypad_navigation.py` (new).
- **Tests:** GS10 CE10 snapshot → `build_drive_diagnostic` yields `related_parameters` containing
  `P09.03` + a `keypad_navigation` card with non-empty steps + view-only warning; engine and Ignition
  render byte-identical; offline (`socket` blocked) passes; citation-honesty assertion (no
  unprovable page).
- **Safety:** the test itself asserts the view-only warning + honest `unknowns`.
- **Do not touch:** production code (test-only PR) unless a bug is found — then fix minimally.

## PR F — Simple Hub/phone render (optional)

- **Goal:** a `KeypadNavigationCard` component on the Hub asset page / phone, or confirm the Ask-MIRA
  text render (PR D) is the shippable surface and defer the component.
- **Files (likely):** `mira-hub/src/lib/drive-packs/loader.ts` (extend the ported subset to type the
  new blocks — currently it ignores `knowledge`/`provenance`), a small React component under
  `mira-hub/src/` using `docs/design/factorylm-tokens.css` (per `ui-style.md`; muted-normal,
  color-for-state, no hardcoded hex).
- **Tests:** Hub unit test for the loader subset; screenshot rule (`docs/promo-screenshots/`,
  desktop 1440×900 + mobile 412×915) for the visible component.
- **Safety:** view-only rendering; no action buttons.
- **Do not touch:** the byte-identical pack copy contract (extend the *loader*, not the JSON).

## PR G — Optional trace threading (deferred, larger)

- **Goal:** thread `parameter_id` + keypad/parameter citations into `decision_traces` for auditability.
- **Files (likely):** `mira-bots/shared/decision_trace.py`, `engine.py::_schedule_decision_trace`, a
  Hub migration (`mira-hub/db/migrations/NNN_*.sql`) adding a nullable field or overloading
  `metadata`/`manual_evidence`.
- **Tests:** trace-row build test; migration idempotency + tenant-type per `mira-hub-migrations.md`
  (UUID family for Hub tables).
- **Safety:** append-only trace table unchanged; no PII in trace.
- **Do not touch:** the trace table's append-only grants; existing trace fields' meaning. **Scope
  carefully** — this is engine + schema surface, not a tiny PR; follow the `mira-hub-migrations` rule
  and `managing-the-knowledge-graph` skill.

---

## Sequencing & dependencies

```
PR A (docs) ──▶ independent, ship first
PR B (types) ──▶ PR C (data) ──▶ PR D (wire+render) ──▶ PR E (proof)
                                      └──▶ PR F (Hub render, optional, parallel to E)
PR G (trace) ──▶ after D, independently scoped, deferred
```

- **Recommended first code PR: PR B.** Smallest, safest, fully offline, byte-identical-preserving, and
  the seam every later PR depends on — mirrors how the fault-card work started with the reader seam.
- Ship B→C→D→E as a tight chain; F and G are optional/deferred.

## Suggested skills per PR
- All: `superpowers:subagent-driven-development`, `superpowers:using-git-worktrees` (one worktree per
  PR), `ship-pr`/`ship`, `superpowers:test-driven-development`, `verification-before-completion`.
- PR D/F: `mira-industrial-safety` (safety framing), `factorylm-ui-style` + `industrial-hmi-scada-design`
  (F only).
- PR G: `managing-the-knowledge-graph` + the `.claude/rules/mira-hub-migrations.md` rule.

## Cross-references
- `drivesense_service_pack_schema_proposal.md`, `drivesense_manual_keypad_prd.md`,
  `drivesense_manual_keypad_gap_report.md`, `drivesense_manual_parsing_plan.md`,
  `drivesense_technician_keypad_workflow.md`.
