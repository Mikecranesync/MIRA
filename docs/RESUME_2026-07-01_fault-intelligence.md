# RESUME — FactoryLM/MIRA Factory Difference Engine → Fault Intelligence (2026-07-01)

Paste the block below into a fresh Claude Code session to resume this work.

---

Resume the FactoryLM/MIRA "Factory Difference Engine → Fault Intelligence" work.

REPO: C:\Users\hharp\Documents\GitHub\MIRA
Read first: memory files project_proveit_difference_engine_demo.md,
project_difference_engine_reposition.md, project_litmus_edge_bench.md (in the
.claude memory dir) — they carry the full state.

PRODUCT THESIS (the wedge):
FactoryLM = the signal Difference Engine; MIRA = the agent that explains the
differences. The advanced wedge: turn cryptic PLC/HMI/VFD/OEM fault codes into
plain-English, evidence-backed troubleshooting. NOT generic predictive maintenance.
Loop: cryptic fault → affected asset → event window → baseline-vs-current diff →
tag/manual/history evidence → MIRA explanation → tech accept/reject/edit → approved
fix becomes future context.

WHAT'S DONE (all offline, deterministic, no DB/cloud/LLM/PLC-writes):
- main: the difference engine merged (baseline_learner, difference_detectors,
  event_context in plc/conv_simple_anomaly/; reposition squash 2a7af723, VERSION 3.53.3).
- Branch feat/proveit-difference-engine-demo (off main) — the ACTIVE demo branch:
    e06fe1ba  5-stage ProveIt demo (demo/factory_difference_engine/: pipeline.py
              run_pipeline() Connect→Pick→Prove→Explain→Learn; __main__ narrated CLI;
              tests/simlab/test_proveit_demo.py). "Northwind Bottling / CV-200" is a
              DISPLAY ALIAS over SimLab filler01 (real deterministic data).
    9de9dc3a  2a Fault Dictionary: demo/factory_difference_engine/fault_dictionary.py
              (parses simlab/docs/*/fault_code_table.md → 11 assets/53 codes;
              extract_fault_dictionary(), lookup_fault(code, asset); referenced_tags +
              honest missing_evidence). test_fault_dictionary.py.
    81cf90d3  2b Fault→Bundle join: fault_bundle.py build_fault_bundle(code,
              run_pipeline_result) → corroborated/uncorroborated + baseline-vs-current +
              cited manual + missing_evidence + review_state. test_fault_bundle.py.
    7b109bdd  2c Fault Report: fault_report.py render_fault_report(bundle) + --html
              (standalone HTML: fault observed→means→what changed→evidence→check
              first→what's missing→review). test_fault_report.py.
  Full offline chain = 35 tests green.

UNCOMMITTED (in the feat/litmus-bench-proof working tree — DO NOT lose):
- Phase-1 Flight Recorder Report: demo/factory_difference_engine/flight_report.py,
  the --html flag in __main__.py, tests/simlab/test_flight_report.py, and the
  README "Visual report" section. (Intentionally never committed yet.)
- Planning/discovery docs: docs/discovery/{factory_difference_engine_visual_workflow,
  proveit_2026_factory_data_richness_audit, fault_intelligence_from_flight_recorder_plan,
  factorylm_flight_recorder_black_box_discovery}.md and docs/prd/factorylm_flight_recorder_black_box_prd.md.
- Generated artifacts under demo/factory_difference_engine/out/ (regenerable; keep git-ignored).

DATA-RICHNESS FINDING: the ProveIt/Northwind sim is process/quality/state-rich but
VFD/electrical/condition-POOR (vs Mike's real conveyor: PRESENT 3 / PARTIAL 3 / ABSENT 10).
It has motor_current_amps (4 assets) + vfd_speed_hz (filler only) + string fault_code;
ABSENT: torque%, DC bus, output voltage, kW, drive/IGBT temp, overload count, numeric
fault codes, vibration, bearing temp, runtime hours. So sim fault intelligence is strong
for process/mechanical/controls faults, weak for electrical/VFD. Mike's real GS10-via-
Micro820 conveyor (torque/freq/current/voltage/DC bus/RPM/power + GS10_FAULT_CODES in
plc/conv_simple_anomaly/rules_core.py) is the maintenance-grade GOLD STANDARD.

CANDIDATE NEXT STEPS (ask me which):
1. Commit the Phase-1 Flight Recorder Report to feat/proveit-difference-engine-demo.
2. Commit the planning/discovery docs.
3. 2d — close the tag-depth gap: EITHER enrich SimLab filler01/CV-200 with a VFD block
   (vfd_torque_pct, dc_bus_voltage_v, output_voltage_v, drive_temp_c, numeric decoded
   fault code, runtime/starts) so missing_evidence shrinks — OR point the same fault-
   intelligence loop at the real GS10 conveyor and fold GS10_FAULT_CODES into the dictionary.
4. Open a PR for feat/proveit-difference-engine-demo → main.
5. Housekeeping: rebase feat/garage-conveyor-onboarding onto main (drops a redundant
   reposition commit 6f780fcc already on main via squash).
6. Litmus bench: continue Micro820/Litmus DeviceHub provisioning (plc/litmus/, container
   `le` at https://100.72.2.99:8443; provision.py needs one live-token validation).

HARD RULES / CONVENTIONS:
- Do NOT commit unless I explicitly ask. Discovery/planning first for anything non-trivial.
- Do NOT disturb the dirty working tree WIP. Foreign WIP that is NOT mine and must be left
  alone: mira-hub/** RAG route changes, mira-mcp/factorylm_external_ai + its tests +
  scripts/verify_factorylm_external_ai_stack.py, docs/external-ai/, docs/customer_workflows/,
  mira-plc-parser/evals/, wiki/hot.md, .agents/skills/qr-onboarding/SKILL.md.
- To commit demo work: use a git worktree off origin/feat/proveit-difference-engine-demo,
  copy only the exact files, stage them explicitly (never git add -A), test on the branch
  base, commit, push, remove worktree, return to feat/litmus-bench-proof. (LF→CRLF warnings
  are benign.)
- Everything in these phases stays offline/deterministic: no DB, cloud, live LLM, PLC writes,
  Hub UI, DB schema, live adapters, LangGraph, or Langfuse (ADR-0011 rejects LangGraph;
  ADR-0022 keeps decision_traces in NeonDB, not Langfuse).
- REUSE, don't rebuild: decision_traces (mig 032/055) + WhyMiraThinksThis.tsx + /api/
  decision-trace, historian (#2350/#2354), Sparkplug consumer (#2358), review-queue.tsx +
  ADR-0017 proposal_transition.py, fault_codes table (mig 002) + recall_fault_code,
  GS10_FAULT_CODES, the SimLab manuals, and simlab/flight_recorder.py (PR #2335, the Layer-0 tape).

Start by confirming git state, then tell me the smallest next step and wait for my go-ahead.
