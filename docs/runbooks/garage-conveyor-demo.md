# Demo Runbook — Garage Demo / Micro820 Conveyor (HubV3 §7)

End-to-end acceptance demo for the HubV3 contextualization intake: a technician builds a machine
context bundle **offline** from real exports, carries it to the Hub, and the Hub dedupes → matches →
stages → reviews → approves → publishes it for MIRA. This runbook is the §7 demo acceptance target and
the operator script behind PRD §6 test 12.

## Fixtures (real, on disk)

| File | What it is |
|---|---|
| `plc/Micro820_v4.1.9_Program.st` | the conveyor's Allen-Bradley Micro820 CCW Structured Text program (controller `2080-LC20-20QBB`) |
| `plc/MbSrvConf_v4.xml` | its Modbus server map (tag → register) |
| a GS10 drive manual excerpt | fault + rated-current evidence (inlined in the demo test; in the field this is the `gs10` user manual PDF) |

## The flow

1. **Offline — build the bundle.** Open the Contextualizer, create profile *Garage Demo / Micro820
   Conveyor*, add the CCW project + the GS10 manual, accept the proposals, export
   `machine_context_bundle.zip`. The bundle carries: `manifest.json` (asset_match → controller
   `2080-LC20-20QBB`, propose-only intent), `uns.json` (signals: `conveyor_running`, `motor_running`,
   `fault_alarm`, `e_stop_active`, …), `i3x.json`, `kg_entities.json` (asset + signals, all
   `proposed`), `fault_catalog.json`, `parameters.json`, `evidence.json`, `scorecard.json`,
   `review.json`, `documents/*.json`.
   - **Export modes:** *full* (raw documents + verbatim evidence) or *sanitized structured context*
     (derived context only — no raw documents). Never "anonymous": identity + hashes remain.
2. **Carry it.** The zip is the USB-carryable artifact; no network needed to build it.
3. **Hub — import.** `POST /api/contextualization/import` (multipart `file=machine_context_bundle.zip`).
   The Hub creates an **import batch**, dedupes sources by `source_sha256` (re-import = no-op), matches
   the conveyor against `cmms_equipment` (strong → stage under it; none → draft asset), and stages every
   signal / fault / parameter / UNS / i3X proposal as **proposed**.
4. **Review & approve.** The review queue lists the staged proposals. A human approves the batch; only
   then is the context **published** to the project model / UNS / i3X / MIRA KB. Approved Hub data is
   never overwritten by a re-import.

## Run the tests

### Offline half (no DB) — proves the bundle is non-empty and well-formed
```bash
cd mira-contextualizer
python -m pytest tests/test_demo_garage_conveyor.py -v
```
Asserts: ≥5 UNS signals, i3X signal leaves, proposed kg asset+signals, scorecard, review audit,
`asset_match.model == "2080-LC20-20QBB"`, and the full-vs-sanitized export contract.

### Hub half (DB) — proves import → staged batch / dedupe
```bash
# 1) ephemeral Postgres with the contextualization schema
docker run --rm -d -p 5440:5432 -e POSTGRES_PASSWORD=test --name mira-ctx-test postgres:16
PGPASSWORD=test psql -h localhost -p 5440 -U postgres \
  -c "CREATE ROLE factorylm_app NOLOGIN; GRANT USAGE ON SCHEMA public TO factorylm_app;"
PGPASSWORD=test psql -h localhost -p 5440 -U postgres -f mira-hub/db/migrations/055_contextualization.sql
PGPASSWORD=test psql -h localhost -p 5440 -U postgres -f mira-hub/db/migrations/056_contextualization_intake.sql

# 2) run the DB-backed import tests (PRD §6 tests 2, 3, 12 Hub half)
cd mira-hub
TEST_DATABASE_URL=postgres://postgres:test@localhost:5440/postgres npm run test:integration

docker rm -f mira-ctx-test
```

### Acceptance matrix (no DB) — the whole §6 matrix pinned in one suite
```bash
cd mira-hub && npm test -- src/lib/contextualization/acceptance-matrix.test.ts
```

## Acceptance (§7) — pass criteria

- Offline build yields a non-empty bundle for the real Micro820 conveyor (offline test green).
- Import creates one batch; re-import with the same sha256 adds no duplicate sources.
- The conveyor either strong-matches an existing asset or becomes a draft proposal — never a silent
  merge, never auto-verified.
- Staged signals / UNS / i3X / scorecard / review queue are non-empty and all `proposed` until a human
  approves.

See `docs/specs/hubv3-hub-as-system-of-record.md` for the architecture this demo exercises.
