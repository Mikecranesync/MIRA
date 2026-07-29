# fix(engine): FSM determinism rewrite — separate documentation-request path, fix UNS gate intent-check, and close Phase 6 direct-connection bypass

**Labels:** `fix` `engine` `eval` `ready-for-agent`
**Phase:** Phase 6 — `docs/plans/2026-06-01-mira-master-architecture-plan.md`
**Blocks:** #1658 (Phase 6 direct_connection bypass), #1659 (citation enforcement)
**Related:** #1884 (latest eval regression), ADR-0021, `.claude/rules/direct-connection-uns-certified.md`
**Files:** `mira-bots/shared/engine.py`, `mira-bots/shared/guardrails.py`, `mira-bots/prompts/diagnose/active.yaml`, `mira-pipeline/ignition_chat.py`
**Schema changes:** None
**Estimated effort:** S — surgical, 3 files + prompt sync, all verification harnesses already exist

---

## Problem

The offline eval (`tests/eval/offline_run.py`, text suite, 57 scenarios) has been oscillating between 78% and 89% for two weeks and cannot converge. Last five runs: 82% → 78% → 84% → 78% → 80% (`tests/eval/runs/2026-06-11T2314` through `2026-06-12T1654`). Issue #1884 captured the floor at 45/57. The suite has never crossed 90% — the best run on record is 51/57 (89%, 2026-06-11T1009).

This is not noise. It is two contradictory failure clusters pulling `engine.py` in opposite directions, plus a prompt/guardrails terminology drift riding along:

**Cluster A — under-progression.** Troubleshooting sessions with enough context to proceed get stuck at `AWAITING_UNS_CONFIRMATION` or `Q1`. From the 2026-06-01T0841 run: `vague_opener_stuck_state_05`, `asset_change_mid_session_08`, `reset_new_session_09`, `abbreviation_heavy_10`, `pf527_phase_loss_20`, `yaskawa_a1000_ov_23`, `self_critique_low_groundedness_34` all died at `AWAITING_UNS_CONFIRMATION`; `sew_overcurrent_29` died there when the fixture expected `DIAGNOSIS`. Separately, `pf525_f004_02`, `vfd_ab_01_pf525_f004_undervoltage`, and `vfd_abb_01_acs580_fault_2310` stall at `Q1`/`Q2` when a fully deterministic fault code (PF525 F004, ACS580 2310) should have gone straight to `DIAGNOSIS`.

**Cluster B — over-progression.** Purely documentary turns advance into asset states when they should terminate in `IDLE`. Same run: `vfd_ab_04_pf70_find_manual`, `vfd_abb_02_acs880_find_manual`, `vfd_danfoss_02_aqua_drive_manual`, `vfd_mitsu_02_fr_e700_find_datasheet`, `vfd_siemens_02_micromaster_manual` all failed `cp_reached_state` with `State='ASSET_IDENTIFIED', expected exactly IDLE`; `vfd_mitsu_03_a700_parameter` landed in `Q1`, expected exactly `IDLE`.

Every fix that loosens the UNS gate to release Cluster A worsens Cluster B. Every fix that tightens it to fix Cluster B re-strands Cluster A. That is the entire history of the 78–89% oscillation: we have been moving one knob that controls two opposing behaviors.

The nightly fix-proposer (`tests/eval/fix_proposer_tasks.py`) hard-stops on this every night because the failure clusters span three files simultaneously — `mira-bots/shared/engine.py`, `mira-bots/shared/guardrails.py`, `mira-bots/prompts/diagnose/active.yaml` — and it only drafts single-cluster PRs. This issue is the coordinated three-file change the autopatcher structurally cannot produce.

---

## Root cause

### 1. The UNS gate is intent-blind (drives Cluster B and most of Cluster A)

`_should_fire_uns_gate()` (`mira-bots/shared/engine.py`, ~L5367) decides whether to interrupt the turn with `AWAITING_UNS_CONFIRMATION`. It consults exactly one intent signal — the **LLM router's** label — and explicitly discards everything else:

```python
def _should_fire_uns_gate(self, router_intent, state, message, session_context) -> bool:
    del message, session_context  # "reserved for future signal expansion"
    if not _UNS_GATE_ENABLED:
        return False
    uns_ctx = (state.get("context") or {}).get("uns_context") or {}
    if uns_ctx.get("source") == "direct_connection":
        return False
    if router_intent not in _GATED_INTENTS:   # {"diagnose_equipment", "schedule_maintenance"}
        return False
    if state.get("asset_identified"):
        return False
    if state.get("state", "IDLE") != "IDLE":
        return False
    return True
```

The call site in `process_full()` arms it on **vendor/model presence**: `uns_ctx.confidence > 0 and self._should_fire_uns_gate(...)`.

Here is the failure mechanism. "Where's the manual for the ACS880?" carries vendor+model, so `uns_ctx.confidence > 0`. When the LLM router mislabels it `diagnose_equipment` — which it reliably does whenever vendor/model/fault-shaped tokens dominate the message — nothing downstream vetoes the gate. The deterministic keyword classifier (`classify_intent()`, `guardrails.py:777`) correctly returns `documentation` for these turns, and `process_full()` has that verdict in hand as `_keyword_intent` — but it is never passed into the gate decision. The one signal that could catch the router's mistake is deleted on the first line of the function body. Result: a manual request enters `AWAITING_UNS_CONFIRMATION`, the fixture's follow-up turn gets consumed as a confirmation answer, and the session terminates in `ASSET_IDENTIFIED` instead of `IDLE`. That is Cluster B, and it is also why tightening anything else never helps: the gate fires on *evidence of an asset*, not *intent to troubleshoot one*.

### 2. The question-skip is fault-blind (the rest of Cluster A)

`_should_skip_questions()` requires all three slots (vendor, model, fault_code) before bypassing the Q-ladder, and treats every fault code as equally ambiguous. But "PowerFlex 525 F004" is fully deterministic — the structured `fault_codes` table (migration `docs/migrations/002_fault_codes.sql`, read path `recall_fault_code()` in `mira-bots/shared/neon_recall.py`) resolves it with similarity 0.95. The engine asks Q2/Q3 anyway, burning the fixture's turn budget, and the only thing that eventually forces `DIAGNOSIS` is the Q-trap commit in `fsm.py` — a bail-out at the *end* of the conversation compensating for a decision we could have made at the *start*. That is `pf525_f004_02` (`State='Q2', expected='DIAGNOSIS'`), `vfd_ab_01_pf525_f004_undervoltage`, and `vfd_abb_01_acs580_fault_2310`.

### 3. The Ignition adapter doesn't certify what the connection already proves (Phase 6 gap)

`mira-pipeline/ignition_chat.py` builds `chat_id = f"ignition:{tenant_id}:{asset_id or 'default'}"` but does not fully populate `state["uns_context"]` as a certified direct connection: no `confidence = "certified"`, no resolution through `uns_resolver.resolve_uns_path()`, and no rejection contract for turns arriving without an identifier. The master plan (`docs/plans/2026-06-01-mira-master-architecture-plan.md` §1.1) names this exact gap. The engine side is already done — `_should_fire_uns_gate()` returns `False` on `source == "direct_connection"` per ADR-0021 and `.claude/rules/direct-connection-uns-certified.md`. The adapter just isn't supplying the certified context.

### 4. Guardrails/prompt terminology drift (the `cp_keyword_match` stragglers)

`SAFETY_KEYWORDS` and the fault-pattern vocabulary in `guardrails.py` have drifted from `prompts/diagnose/active.yaml`. Ground-fault family terminology is the visible casualty: `gs3_ground_fault_14` fails `cp_keyword_match` because the prompt doesn't carry the safety-adjacent fault vocabulary the classifier and grader both expect.

---

## Proposed fix

Three surgical changes plus one prompt-side companion. No schema changes. No new FSM states. No resolver rewrite.

### (a) Intent guard on `_should_fire_uns_gate()` — `engine.py` + `guardrails.py`

Pass `_keyword_intent` (already computed in `process_full()`) into the gate — the signature already reserves the slot. The gate may fire only when **both** signals agree the turn is troubleshooting-shaped:

```python
# router label necessary but no longer sufficient
if router_intent not in _GATED_INTENTS:
    return False
# deterministic veto: documentation / greeting / help / safety / off_topic never gate
if keyword_intent != "industrial":
    return False
```

Deterministic classifier beats probabilistic router. Documentary turns fall through to the existing documentation handler and the session stays `IDLE`. Safety turns already short-circuit before the gate; this makes that invariant explicit rather than incidental. This single check fixes all six Cluster B fixtures and removes the gate over-fire half of Cluster A — without touching the gate's behavior for genuine `industrial` troubleshooting turns, which is the property every previous one-knob fix destroyed.

### (b) High-confidence fault fast-path in `_should_skip_questions()` — `engine.py`

Add a fast-path: if vendor+model are resolved AND the extracted fault code gets a structured hit from `recall_fault_code()` (the `fault_codes` table — PF525 F-codes, GS10 fault table, ACS580 fault tables are already seeded) at similarity ≥ 0.9 scoped to that vendor/model family, skip Q2/Q3 and enter `DIAGNOSIS` directly. Honor the offline floor (`.claude/rules/uns-compliance.md` rule 8): on DB error or no structured hit, fail closed to the existing Q-ladder — never crash, never over-skip.

### (c) Direct-connection certification in `ignition_chat.py` — closes the Phase 6 gap

When `asset_id` (or `asset_context`) is present and resolves via `uns_resolver.resolve_uns_path()`: stamp `state["uns_context"]["source"] = "direct_connection"` and `confidence = "certified"` on the turn handed to the engine. When the identifier is missing or unresolvable: reject with 422 `{"error": "uns_required"}` — do **not** downgrade to a chat-gate confirmation, per `.claude/rules/direct-connection-uns-certified.md`. The engine branch already exists and is already tested; this is adapter wiring only.

### Companion: terminology sync in `prompts/diagnose/active.yaml`

Align the fault vocabulary in `active.yaml` with the `guardrails.py` keyword families so ground-fault/earth-fault/insulation/megger terminology survives the prompt → reply → `cp_keyword_match` loop. Bump the prompt version per `prompts/diagnose/CHANGELOG.md` convention.

**Explicitly out of scope:** cross-vendor retrieval bleed (`gs1_undervoltage_12`/`gs2_overvoltage_13` failing on `Forbidden keywords present: ['PowerFlex']`) is a retrieval-ranking bug, not an FSM bug. File separately.

---

## Success criteria

All measurable, all gated on a fresh `tests/eval/offline_run.py` text-suite pass:

1. **Cluster A released.** `vague_opener_stuck_state_05`, `asset_change_mid_session_08`, `reset_new_session_09`, `abbreviation_heavy_10`, `pf527_phase_loss_20`, `yaskawa_a1000_ov_23`, `sew_overcurrent_29`, `self_critique_low_groundedness_34` reach their expected `Q1`/`Q2`/`DIAGNOSIS` states — zero terminal `AWAITING_UNS_CONFIRMATION` failures.
2. **Fast-path proven.** `pf525_f004_02`, `vfd_ab_01_pf525_f004_undervoltage`, `vfd_abb_01_acs580_fault_2310` reach `DIAGNOSIS`.
3. **Cluster B grounded.** `vfd_ab_04_pf70_find_manual`, `vfd_abb_02_acs880_find_manual`, `vfd_danfoss_02_aqua_drive_manual`, `vfd_mitsu_02_fr_e700_find_datasheet`, `vfd_siemens_02_micromaster_manual`, `vfd_mitsu_03_a700_parameter` all terminate exactly `IDLE`.
4. **Eval score ≥ 52/57 (91%)** — first crossing of the 90% barrier in project history.
5. **Ignition integration.** Resolvable `asset_id` → `source=="direct_connection"` + `confidence=="certified"`, no gate card. Missing identifier → 422 `{"error":"uns_required"}`.
6. **No safety regressions.** All 22 safety-keyword fixtures pass; `pytest mira-bots/tests -k safety` clean.
7. **No gate regressions.** `mira-run-hallucination-audit` flags zero new violations.

---

## Test plan

**Unit (`mira-bots/tests/`):**
- `test_uns_gate_intent_matrix.py` — parametrized matrix over (router_intent × keyword_intent × asset_identified × FSM state × uns_source) → expected gate decision, ~30 cases. Load-bearing rows: `(diagnose_equipment, documentation) → no gate`, `(diagnose_equipment, industrial) → gate`, `(*, *, source=direct_connection) → no gate`.
- `test_skip_questions_fastpath.py` — mocked `recall_fault_code()`: PF525+F004 structured hit → skip to `DIAGNOSIS`; PF525+unknown code → Q-ladder; DB exception → Q-ladder (fail-closed).

**Adapter (`mira-pipeline/tests/`):**
- `test_ignition_chat_uns.py` — TestClient: resolvable `asset_id` → certified context, gate skipped; missing identifier → 422 `uns_required`; unresolvable identifier → 422.

**Eval (`tests/eval/fixtures/`):**
- `doc_intent_01_find_manual_gate_veto.yaml` — vendor+model+"find the manual" → expected exactly `IDLE`.
- `doc_intent_02_datasheet_with_fault_token.yaml` — documentary phrasing with fault-shaped token ("need the F004 page of the 525 manual") → exactly `IDLE`. Permanent counterweight preventing future Cluster-A loosening from silently reopening Cluster B.
- `fastpath_01_pf525_f004_direct_diagnosis.yaml` — opener with vendor+model+known code → `DIAGNOSIS` inside turn budget.
- `fastpath_02_unknown_code_still_q2.yaml` — unknown code must still ask Q2 (anti-over-skip guard).
- Add all four to `tests/eval/watch_set.txt`.

**Golden:**
- `tests/golden_uns_direct_connection.csv` (new — named in master plan Phase 6 suggested files).
- One documentary-veto and one fast-path row added to `tests/golden_factorylm.csv`.

**Process (non-negotiable per repo doctrine):**
- `tools/codegraph-preflight.sh` + `codegraph_impact _should_fire_uns_gate` before touching `engine.py`.
- `mira-run-hallucination-audit` after engine/guardrails edits.
- Staging gate (`smoke-test.yml` + relevant `tests/eval/` regime) before merge to `main`.
- No feature-branch traffic to `@FactoryLM_Diagnose`.

---

> The deadlock breaks because we stop using one knob for two behaviors: intent decides *whether* to gate, fault determinism decides *how fast* to diagnose, and the connection decides *when neither question needs asking*.
