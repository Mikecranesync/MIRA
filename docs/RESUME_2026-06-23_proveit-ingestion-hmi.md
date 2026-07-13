# RESUME — ProveIt demo + stranger-factory ingestion + HMI (2026-06-23)

**Worktree:** `../mira-cappy-factory`  **Branch:** `feat/cappy-northstar-factory`
**Sibling fix branch (other repo checkout):** `fix/heartbeat-docling-to-tika` (main MIRA repo)

## Where we are (commit chain on feat/cappy-northstar-factory)
- `7e9de739` demo evidence folder (Conv_Simple bench manuals)
- `c4cabee7` Conv_Simple demo spine (evidence → answer card → narrow MQTT) — **keep green**
- `d52340c1` ProveIt bottling factory + Conv_Simple supervised live cell
- `5e2e81ff` bottling live telemetry (sim PLCs) + Ignition-HMI readiness
- `1ec85425` stranger-factory ingestion PROOF (foreign water-plant export)
- `5c4134c9` archetype classifier power-up (closed the unknown-signal gap)
- `35c5a6df` equipment-class intelligence (failure modes + instrumentation-gap detection)

## The ingestion story (now strong — the user's core concern)
Foreign Ignition/MES export → **0 unknown signals** (units⇒analog + name fallback + new `live_fault`/
`live_setpoint` archetypes + `dimension` inference) → assets **typed** (`equipment_type`: pump/blower/
clarifier/…) → **failure-mode candidates + missing-sensor gaps** per asset → Hub approval queue
(PR-1/PR-2 transforms), **0 auto-approved**. Proof: `python demo/ingestion_proof/run_ingest_proof.py`.
Beta gate (stranger's manual → cited answer) is the other half, already CI-enforced.

## Verify everything is green
```
python demo/run_demo.py                                  # Conv_Simple -> DEMO: OK
python demo/proveit_bottling/run_proveit_demo.py --telemetry --ticks 60 --scenario filler_jam --ignition-export --no-mqtt
python factory_context/run_phase1.py                     # PHASE 1: OK
python demo/ingestion_proof/run_ingest_proof.py          # 0 unknowns + equipment intel
python -m pytest factory_context/tests discovery_corpus/tests demo -q   # 93 passed
python -m ruff check factory_context discovery_corpus/scripts demo
```

## Open threads (pick up here)
1. **Capper HMI pick is WAITING.** Rendered HTML gallery of 5 options at
   `demo/proveit_bottling/hmi_mockups/` (UNCOMMITTED). Render pipeline proven: headless Chrome →
   `screenshots/*.png` → SendUserFile. 5 styles = HP-HMI faceplate / detail-diagnostic / equipment mimic /
   KPI tiles / alarm-first. After the user picks per asset, build the remaining assets (conveyor, filler,
   tank, mixer, labeler, case packer) the same way, then commit the chosen set.
2. **Self-Healer fix needs DEPLOY.** `fix/heartbeat-docling-to-tika` (`a11e283e`) swaps the phantom
   `mira-docling-saas` for the real `mira-tika-saas` in `heartbeat_monitor.py`. Won't stop the escalation
   until the crawler/agents redeploys on the VPS via gated `deploy-vps.yml` (human, MIRA_ALLOW_PROD). The
   `NANGO_DB_PASSWORD` warning is unrelated noise (compose parsed without Doppler).
3. **Next ingestion levers:** (a) wire equipment intelligence into the Hub (attach failure-mode candidates
   to `kg_entity` proposals so they render in the approval UI); (b) route residual `unknown` signals through
   the existing LLM-classify path for the long tail; (c) confidence calibration (unit-backed analog → high
   vs name-fallback → medium).

## Hard constraints (do not violate)
- Never break Conv_Simple (`conv_simple_demo.py` is read-only; `c4cabee7` stays green).
- No prod docker / VPS commands (prod-guard blocks; even literal "docker compose up" in a commit message
  trips it). Deploy only via gated workflows.
- Default demo runs stay deterministic + offline; no cloud/API. Missing live bench degrades, never fails.
- No invented models/part numbers; equipment failure modes are CLASS candidates a human confirms.
- Scoped commits only — the main MIRA repo checkout has unrelated WIP; never `git add -A`.

## Key files
- Classifier (single source of taxonomy): `discovery_corpus/scripts/interrogate_ignition_export.py`
  (`classify_signal`, `infer_dimension`, `infer_equipment_type`).
- Model build: `factory_context/build.py`, `model.py` (FactoryNode +dimension/+equipment_type),
  `uns_draft.py` (_CATEGORY + LIVE_ARCHETYPES), `run_phase1.py`.
- Equipment intelligence: `factory_context/equipment_profiles.py`.
- Hub transforms (TS, run in CI not locally): `mira-hub/src/lib/factory-model-proposals.ts` (PR-1),
  `factory-model-relationships.ts` (PR-2).
- Demo: `demo/conv_simple_demo.py`, `demo/proveit_bottling/` (sim_plc/telemetry/ignition_export/
  run_proveit_demo + hmi_mockups), `demo/ingestion_proof/`.
