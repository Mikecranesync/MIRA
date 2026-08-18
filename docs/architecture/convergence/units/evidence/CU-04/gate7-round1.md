# Gate 7 adversarial review — PR #3283

**Verdict:** BLOCK · **Effort:** xhigh · **Reviewer:** groq (openai/gpt-oss-120b)
**Escalation triggers:** security boundaries, cross-repository contract

> Independent = different vendor + fresh context + a brief to disprove. NOT a second
> human, and the reviewer did not run the tests. Gate 7 is one check of eleven.

## Run receipts

- head: `978a824d16f0849ecf5887690891b4446a0e528d`
- scope (--paths): full PR diff
- excluded by scope (0): none
- diff chars sent/total: 34,373/34,373 (cap 40,000)
- reviewed-diff sha256 (sent bytes): `f3563e875e17e881d3de54ba43db3dc6b189fe410720fcfa8934c7946538de00`
- full scoped-diff sha256 (pre-cap): `f3563e875e17e881d3de54ba43db3dc6b189fe410720fcfa8934c7946538de00`
- requested reasoning_effort: high (see Cascade attempts for what was sent)

## Findings

- **[high] Duplicate top‑level keys `[SN]` cause data loss in REGISTRY.yaml** — The diff adds four separate entries with the identical top‑level key `[SN]`. In a YAML mapping, later entries overwrite earlier ones, so only the last `[SN]` entry (for `[SN]/plc-modbus`) will survive, silently discarding the diagnosis, telegram_bot, and llm-router entries. This corrupts the registry data, breaks any tooling that reads component status, and can lead to unsafe deletions.
- **[high] Placeholder `[SN]` used as a key and as a path component violates naming and path conventions** — The registry expects concrete component identifiers; using a literal placeholder `[SN]` means downstream tools will attempt to resolve directories like `[SN]/diagnosis/` which do not exist, leading to file‑not‑found errors and incorrect status look‑ups. This also makes the `path` values invalid (they contain bracketed placeholders), breaking any code that constructs filesystem paths from the registry.

## Raw review

## VERDICT
BLOCK

## FINDINGS
- **[severity: high] Duplicate top‑level keys `[SN]` cause data loss in REGISTRY.yaml** — The diff adds four separate entries with the identical top‑level key `[SN]`. In a YAML mapping, later entries overwrite earlier ones, so only the last `[SN]` entry (for `[SN]/plc-modbus`) will survive, silently discarding the diagnosis, telegram_bot, and llm-router entries. This corrupts the registry data, breaks any tooling that reads component status, and can lead to unsafe deletions.  
  **file:line evidence:**  
  ```diff
  +[SN]:
  +  repo: factorylm
  +  path: [SN]/diagnosis/
  +  tags: ["type:engine", "domain:diagnostics"]
  +  purpose: "FastAPI PLC-to-LLM diagnosis bridge; frozen 2026-03 predecessor of the MIRA Supervisor."
  +  language: python
  +  status: LEGACY
  +  declared_state: "DUPLICATE_CAPABILITIES.md:11 proposes 'LEGACY -> DELETE_CANDIDATE'"
  +  deletion_safe: false
  +  blocking_evidence:
  +    - "factorylm/docker-compose.yml:44-58 — defined compose [SN] 'diagnosis' (container factorylm-diagnosis, :8200, build context ./[SN]/diagnosis, CMD uvicorn main:app)"
  +    - "/Users/charlienode/CLAUDE.md — declares the SCADA stack incl. 'Diagnosis :8200' with documented start + health commands"
  +    - "docker-compose.yml:56 — depends_on plc-modbus; it is wired into a multi-[SN] stack, not standalone"
  +  known_drift: ["ZERO Python imports (it is not even a package: only main.py + a JS skill + docs), so an import-graph check alone would clear it. The compose [SN] and the CLAUDE.md declaration are what block deletion (CU-04)"]
  ...
  +[SN]:
  +  repo: factorylm
  +  path: [SN]/telegram_bot/
  +  tags: ["type:adapter", "domain:diagnostics"]
  +  purpose: "Frozen 2026-03 Telegram handler; predecessor of mira-bots/telegram/bot.py."
  +  language: python
  +  status: DELETE_CANDIDATE
  +  declared_state: "DUPLICATE_CAPABILITIES.md:12 — 329 lines vs mira-bots/telegram/bot.py 2,805 lines / 175 commits"
  +  deletion_safe: true
  +  blocking_evidence: []
  +  clearing_evidence:
  +    - "ZERO external Python imports. The one apparent inbound ref, [SN]/troubleshoot/adapters/__main__.py:2 'from adapters.telegram_bot import main', resolves to [SN]/troubleshoot/adapters/telegram_bot.py — a DIFFERENT 6,119-byte file"
  +    - "ZERO references in any *.yml / *.yaml / *.sh / *.toml across the factorylm repo"
  +    - "no process on CHARLIE or BRAVO; no launchd job on either node; no crontab entry"
  +  known_drift: ["CLUSTER.md's CHARLIE Telegram-poller claim points at [SN]/troubleshoot/, not this component, and is itself refuted — issue #3284 (CU-04)"]
  ...
  +[SN]:
  +  repo: factorylm
  +  path: [SN]/llm-router/
  +  tags: ["type:infra", "domain:platform"]
  +  purpose: "Skeleton LLM router (redis_logger only, no routing logic); superseded by mira-bots/shared/inference/router.py."
  +  language: python
  +  status: LEGACY
  +  declared_state: "DUPLICATE_CAPABILITIES.md:13 proposes 'LEGACY -> DELETE_CANDIDATE'"
  +  deletion_safe: false
  +  blocking_evidence:
  +    - "factorylm/docker-compose.yml:51 — the LIVE-defined diagnosis [SN] is configured with LLM_ROUTER_URL: 'http://llm-router:8100'"
  +    - "[SN]/diagnosis/main.py:236 — code path documents 'Tries llm-router first (budget + circuit breaker + multi-provider)'"
  +  known_drift: ["the compose env points at an llm-router [SN] that docker-compose.yml never DEFINES — a dangling deployment reference. Deleting the component requires removing that configuration too, so it is not a zero-reference deletion (CU-04)"]
  ...
  +[SN]:
  +  repo: factorylm
  +  path: [SN]/plc-modbus/
  +  tags: ["type:infra", "domain:telemetry"]
  +  purpose: "Modbus TCP/RTU PLC driver [SN] (FastAPI backend, :8001)."
  +  language: python
  +  status: LEGACY
  +  declared_state: "DUPLICATE_CAPABILITIES.md:25 — 'LEGACY (dormant 5+ mo); do not revive without review'"
  +  deletion_safe: false
  +  blocking_evidence:
  +    - "factorylm/docker-compose.yml:26-41 — defined compose [SN] (container factorylm-plc, :8001, healthcheck) "
  +    - "docker-compose.yml:52,70,109 — THREE peer [SN] consume it by URL (PLC_MODBUS_URL, PLC_API_URL, FACTORYLM_PLC_MODBUS_URL); :56,76,114 declare depends_on"
  +    - "factorylm/docs/ops/registry.yaml:67-69 — registered with entry_point '[SN]/plc-modbus/backend/main.py'"
  +    - "/Users/charlienode/CLAUDE.md:43,76 — declares it AUTHORITATIVE ('PLC Modbus driver (162 tests)') with a documented run command"
  +  known_drift: ["four independent Gate 11 blockers. 1,561 of its 1,619 .py files are a committed .venv/; real source is ~43 files (CU-04)"]
  ```
- **[severity: high] Placeholder `[SN]` used as a key and as a path component violates naming and path conventions** — The registry expects concrete component identifiers; using a literal placeholder `[SN]` means downstream tools will attempt to resolve directories like `[SN]/diagnosis/` which do not exist, leading to file‑not‑found errors and incorrect status look‑ups. This also makes the `path` values invalid (they contain bracketed placeholders), breaking any code that constructs filesystem paths from the registry.  
  **file:line evidence:** (same lines quoted above, e.g., `path: [SN]/diagnosis/`, `path: [SN]/telegram_bot/`, etc.)

## NOT REVIEWED
- Runtime behavior of the MIRA platform when loading the modified `REGISTRY.yaml` (e.g., whether the system validates duplicate keys or placeholder values and how it reacts).  
- Any unit or integration tests that parse `REGISTRY.yaml` for schema compliance; the test suite may or may not detect duplicate keys or invalid path strings.  
- Impact on downstream deployment scripts, CI pipelines, or tooling that consume the `path` field; without executing those pipelines we cannot confirm the exact failure mode.  
- Potential security implications of the newly added markdown file `CU-04.md`; its content is documentation only, but we have not inspected its rendering in the platform.  

## Cascade attempts

- `groq: ok (reasoning_effort=high)`
