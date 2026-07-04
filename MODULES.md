# MODULES.md — Module Lifecycle Manifest

Status of every top-level module directory. Guarded by `tests/test_modules_manifest.py`
(fails CI if a qualifying dir is missing here or a listed dir no longer exists).

Statuses: **DEPLOYED** (built/mounted by a production compose — `docker-compose.saas.yml`,
`.observability.yml`, `.hub.yml`, or a module-owned prod compose), **BENCH** (dev/staging/
fault-detective/pathb composes only), **CI** (exercised only by `.github/workflows/`),
**DEFERRED** / **LEGACY** (per root `CLAUDE.md` § Deferred / Archived Modules), **ORPHAN**
(no compose, no workflow reference found).

| Module | Status | Evidence | Note |
|---|---|---|---|
| mira-bots | DEPLOYED | saas.yml builds `mira-bot-telegram`, `mira-bot-slack`, `mira-ask` | Telegram/Slack adapters + ask_api + shared engine |
| mira-bridge | BENCH | only in docker-compose.yml / .override.yml / .fault-detective.yml | saas.yml references only `/opt/mira/mira-bridge/data` host volumes, not the module |
| mira-cmms | DEPLOYED | own prod compose `mira-cmms/docker-compose.yml` (atlas-api/atlas-db, PR #1439); included by root docker-compose.yml; staging mirror in .staging-vps.yml | Not in saas.yml directly — saas `mira-hub`/`mira-web` proxy to `cmms-backend:8080` |
| mira-connect | DEFERRED | root CLAUDE.md § Deferred ("Config 4", post-MVP); no compose or workflow | Modbus/PLC drivers, dormant |
| mira-connectors | DEPLOYED | `mira-pipeline/Dockerfile` COPYs + pip-installs `mira-connectors/`; own pytest job in ci.yml | Ships inside mira-pipeline-saas image |
| mira-contextualizer | ORPHAN | no compose, workflow, or test reference found | Desktop GUI tool; runs outside docker |
| mira-core | DEPLOYED | saas.yml `mira-core` (Open WebUI image + entrypoint) and `mira-ingest` (builds `mira-core/mira-ingest/Dockerfile`) | |
| mira-crawler | DEPLOYED | saas.yml builds `mira-synthetic-dogfood-worker`/`-beat` from `mira-crawler/Dockerfile.synthetic-dogfood` | Also KB ingest tooling used from CI seeds |
| mira-fault-detective | BENCH | docker-compose.fault-detective.yml builds `./mira-fault-detective` | Bench Fault-Detective demo harness |
| mira-fault-sim | BENCH | docker-compose.fault-detective.yml builds `./mira-fault-sim` | |
| mira-hub | DEPLOYED | saas.yml builds `mira-hub` + `mira-cmms-sync` (context `./mira-hub`); also docker-compose.hub.yml | Command Center, app.factorylm.com |
| mira-ignition-exchange | ORPHAN | no compose, workflow, or test reference found | Ignition Exchange packaging artifacts |
| mira-machine-logic-graph | ORPHAN | no compose, workflow, or test reference found | |
| mira-mcp | DEPLOYED | saas.yml builds `./mira-mcp` | |
| mira-pipeline | DEPLOYED | saas.yml builds `mira-pipeline/Dockerfile` | Active VPS chat path |
| mira-plc-parser | DEPLOYED | `mira-core/mira-ingest/Dockerfile` COPYs `mira-plc-parser/mira_plc_parser/` (powers /ingest/plc-parse) | Ships inside mira-ingest-saas image; GUI itself is a desktop tool |
| mira-relay | DEPLOYED | saas.yml builds `./mira-relay`; root CLAUDE.md: "Active SaaS infrastructure (NOT deferred)" | Ignition factory→cloud tag streaming |
| mira-scan-monday | ORPHAN | no compose, workflow, or test reference found | |
| mira-sidecar | LEGACY | root CLAUDE.md: sunset pending (ADR-0008/0014); saas.yml mentions are removal comments; only built by docker-compose.pathb.yml | Awaiting OEM migration before stop |
| mira-trend-viewer | ORPHAN | no compose, workflow, or test reference found | |
| mira-web | DEPLOYED | saas.yml builds `./mira-web` | PLG funnel, factorylm.com |
| nango-integrations | DEPLOYED | saas.yml mounts `./nango-integrations/providers.yaml` into `nango-server` | Config consumed by pinned nango image |
| plc | BENCH | docker-compose.fault-detective.yml builds `./plc/conv_simple_anomaly` + `./plc/live-plc-bridge` | Also CI-exercised: `tests/regime7_ignition/test_diagnose_parity.py` drift-guards `plc/conv_simple_anomaly/rules_core.py` |
| ignition | CI | `tests/regime7_ignition/` (ci.yml full offline suite) exercises `ignition/webdev/` + `ignition/gateway-scripts/` + `ignition/project/` | Deployed to the Ignition gateway out-of-band, not via docker compose |
| simlab | CI | ci.yml `simlab-gate` job runs `tests/simlab/*` against the `simlab/` package | Headless juice-bottling benchmark, runs locally via `python -m simlab` |
| paperclip | ORPHAN | no compose, workflow, or test reference found | |
