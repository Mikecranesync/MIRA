# Synthetic Technician Recovery Battery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan. Use superpowers:test-driven-development for every behavior change and superpowers:verification-before-completion before any completion claim.

**Goal:** Extend the existing dogfood lane into a five-persona, run-unique, tenant-isolated technician recovery battery with structural trust verdicts, redacted artifacts, verified cleanup, and a two-run release-candidate streak.

**Architecture:** Keep the existing Celery task, queue, schedule, issue reporter, artifact root, finding schema, Hub Notebook UI, file intake, retrieval, citation, and cleanup paths. A focused Playwright sibling drives the visible journey; pure Python structures and validates its evidence; the current runner aggregates both legacy journeys and the recovery battery.

**Tech Stack:** Python 3, pytest, TypeScript, Playwright, PDFKit, Bun, Celery, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-30-technician-showcase-sprint-design.md` and PRD `docs/prd/2026-08-29-technician-beta-recovery-prd.md` §§11–18.

## Global Constraints

- Start from current `origin/main` in a fresh worktree only after the Machine Memory lane releases ownership of `mira-crawler/tasks/synthetic_dogfood.py`, its tests, `celeryconfig.py`, `docker-compose.saas.yml`, and the shared runbook.
- This lane adds no Android, Sensor, Machine Memory, Drive Commander, or production Notebook behavior.
- Keep the four existing seeded business-role journeys intact. Recovery is a separate battery in the same runner.
- Use five fresh tenants, users, notebooks, and fictional run-unique manuals. Never use customer content or vendor trademarks.
- At least upload, source confirmation, supported ask, citation opening, and unsupported refusal are driven through visible UI controls.
- API helpers may provision and verify; they may not manufacture the product journey or seed retrieval SQL.
- Keep credentials/cookies/raw tenant IDs in memory only. Public artifacts and issues use hashes and redacted details.
- A hard-trust failure blocks the full battery regardless of persona count. Playwright exit status alone never determines the verdict.
- Begin with `DOGFOOD_ISSUE_MODE=dry_run`. Mike alone deploys, enables live issue filing, or makes design-partner-readiness claims.

## Task 1: Define the recovery evidence contract offline

**Files:**

- Modify: `mira-crawler/agents/synthetic_dogfood.py`
- Create: `mira-crawler/agents/technician_recovery.py`
- Modify: `mira-crawler/tests/test_synthetic_dogfood.py`

- [ ] Write failing tests proving exactly the five PRD persona IDs are required; equipment IDs, sentinels, and document hashes are unique; every manual has at least three pages; malformed/missing evidence cannot pass; legacy Carlos/Dana/Jordan/Pat parsing is unchanged.
- [ ] Add pure, JSON-serializable structures for `RecoveryFixtureManifest`, `RecoveryTurnEvidence`, `RecoveryCitationEvidence`, `RecoveryPersonaResult`, and `RecoveryBatteryReport` with these required facts: run/persona identity; deployment/environment; hashed tenant/document identity; fixture hash/page/passage manifest; step timings; supported answer status/basis/model/provider call; citation ownership/page/target/passage match; refusal status/citation/provider absence; isolation; cleanup; traces/screenshots; failure/reason; structural verdict; streak eligibility.
- [ ] Keep `DogfoodFinding` as the only finding schema. Map recovery failures into stable recovery scenarios/reason codes and retain `DOGFOOD-FINGERPRINT` stability when timings, URLs, paths, or volatile evidence values change.
- [ ] Implement structural battery rules and tests:
  - five or four passes with one classified usability/transient-provider/timing miss may pass;
  - three passes fail;
  - every persona proves isolation and provider-free refusal;
  - a supported turn is `answered`, contains provider/model evidence, and has correct owned page/passage;
  - a refusal is `insufficient_evidence`, zero citations, and no provider use;
  - cross-tenant, false-citation, ungrounded-answer, unsafe-advice, misleading-live, or read-only violations fail the whole battery.
- [ ] Add redaction tests proving cookies, passwords, bearer/session tokens, raw tenant IDs, and credentials never enter reports or issue bodies.
- [ ] Run the focused Python suite and commit `feat(dogfood): define technician recovery battery contract`.

## Task 2: Build the five-persona visible journey

**Files:**

- Create: `mira-hub/tests/e2e/support/technician-recovery.ts`
- Create: `mira-hub/tests/e2e/technician-recovery-battery.spec.ts`
- Reuse without modification: `mira-hub/scripts/provision-beta-gate.ts`

- [ ] Implement the five fixed personas and fixtures exactly: Elena Ruiz/Zephyr ZX-9000 drive; Marcus Lee/Northstar CV-42 conveyor; Priya Shah/RelayWorks IO-88 remote I/O; Devon Brooks/Meridian PX-210 pump; Sam Ortega/Apex TH-500 process oven.
- [ ] Generate every PDF dynamically with the already-installed `pdfkit`. Include a run-specific fictional equipment ID, run-specific answer sentinel, at least three pages, a supported fact phrased differently from the question, an explicitly absent fact, and a manifest with document SHA-256, page, expected passage SHA-256, required answer terms, and absent terms.
- [ ] Provision five supported sessions and keep secrets in memory. For each persona, drive visible UI controls to create a Notebook, upload, observe processing/ready, confirm the source, ask the supported question, observe the answer, click/open its citation, ask the absent-fact question, observe refusal, reload, and verify both turns persist.
- [ ] Capture the UI-initiated response evidence and verify server-side: supported status `answered`; non-null provider/usage evidence; citation document equals the uploaded document; page/passage match the manifest; unsupported status `insufficient_evidence`; zero citations; no provider/usage frame.
- [ ] Add a ring isolation assertion: session N receives 403/404 for persona N+1's notebook and document. A random-UUID check is insufficient.
- [ ] In `finally`, delete only resources bearing the run ID and verify cleanup. Record unresolved run-owned resources without broadening deletion scope.
- [ ] Attach `recovery-evidence.json`, screenshots after source confirmation/cited answer/citation viewer/refusal, trace ZIP, and cleanup evidence. Do not place raw IDs, full manuals, credentials, or cookies in them.
- [ ] Do not mark persona tests Playwright `serial`; use one worker so one failure does not skip the remaining four. Enforce ten minutes per persona.
- [ ] Run focused Playwright plus the legacy sibling and commit `test(hub): add five-persona technician recovery journey`.

## Task 3: Aggregate recovery through the existing runner

**Files:**

- Modify: `mira-crawler/tasks/synthetic_dogfood.py`
- Modify: `mira-crawler/tests/test_synthetic_dogfood.py`

- [ ] Add failing runner tests for 5/5 streak one; a second same-SHA pass streak two; changed SHA resets to one; valid 4/5 transient with Playwright exit 1 may pass; hard-trust failure blocks; missing evidence blocks despite exit 0; malformed attachment creates a finding; legacy-only run still works; dry-run performs no GitHub mutation; timeout writes a redacted artifact; cleanup failure lists only run-owned resources.
- [ ] Run `synthetic-day.spec.ts` and the focused recovery spec from the same existing task. Pass `DOGFOOD_RUN_ID`, release SHA/version, target environment, and the current run artifact directory.
- [ ] Parse structured `recovery-evidence.json` attachments. Make the structural battery report authoritative; do not infer trust from test titles or Playwright exit code.
- [ ] Write one battery and five persona summaries under the existing run directory. Map actionable failures through the existing deduplicated reporter and fingerprint.
- [ ] Maintain an atomic streak record in the existing artifact root. Advance only for a complete passing battery with deployment SHA/version and environment, the same SHA as the previous pass, and zero hard-trust failures. Reset on new SHA, incomplete evidence, or failure. Dry-run artifacts never become a release claim.
- [ ] Increase the bounded whole-battery timeout from 600 seconds to 3,900–4,200 seconds while preserving the ten-minute per-persona assertion.
- [ ] Run the focused Python suite and commit `feat(dogfood): aggregate technician recovery battery`.

## Task 4: Wire deployment-safe operation and documentation

**Files:**

- Modify: `mira-crawler/Dockerfile.synthetic-dogfood`
- Modify: `docker-compose.saas.yml`
- Modify: `.github/workflows/ci.yml`
- Modify: `docs/runbooks/synthetic-dogfood-agents.md`

- [ ] Reuse the existing worker/beat containers and mounted `/mira-db/synthetic-dogfood` artifact root. Forward `NEON_DATABASE_URL` only through the existing secret-managed deployment boundary because the supported provisioner mirrors and cleans fresh tenant rows.
- [ ] Add disabled-by-default `DOGFOOD_RECOVERY_ENABLED`, the bounded timeout, and dry-run issue defaults without adding a scheduler, queue, reporter, credential system, or artifact root.
- [ ] Add the offline recovery contract suite to required CI. Keep live Playwright recovery as a deployed-environment gate.
- [ ] Correct the runbook artifact path, document supported deploy workflow only, cleanup remediation, exact two-run same-SHA proof, artifact redaction, hard-trust rules, and the distinction between synthetic recovery proof and human validation.
- [ ] Run image/config/static tests and commit `docs(dogfood): operationalize technician recovery gate`.

## Task 5: Verify, review, and hand off

- [ ] Run offline/root suites:

```powershell
python -m pytest tests/beta/test_notebook_probe.py -q
python -m pytest mira-crawler/tests/test_synthetic_dogfood.py -q
python -m pytest tests/test_architecture.py -q
python -m ruff check mira-crawler/agents/synthetic_dogfood.py mira-crawler/agents/technician_recovery.py mira-crawler/tasks/synthetic_dogfood.py mira-crawler/tests/test_synthetic_dogfood.py
```

- [ ] Run Hub and both Playwright lanes:

```powershell
Set-Location mira-hub
bun run test
bun run lint
bun run build
npx playwright test tests/e2e/technician-recovery-battery.spec.ts --project=chromium --workers=1
npx playwright test tests/e2e/synthetic-day.spec.ts --project=chromium --workers=1
Set-Location ..
git diff --check origin/main...HEAD
```

- [ ] Have Codex perform independent spec-compliance and code-quality reviews against the exact head. Fix release-blocking findings, rerun all affected tests, push, and open one reversible PR.
- [ ] Write `HANDOFF.md` with exact SHA, files, outputs, redacted artifact locations, cleanup result, legacy regression result, issue mode, and commands for two deployed same-SHA runs.
- [ ] Stop at the deployed gate. Workstream E remains open until two consecutive complete batteries on the same release-candidate SHA each meet 4/5, zero hard-trust failures, zero open P0/P1, and verified cleanup.

## Explicit Separation from the Integrated Showcase

- This lane proves browser Notebook recovery from private fictional manuals. It does not implement or prove native camera capture or the 60-second Android showcase.
- “Save memory” here means the canonical grounded turn and citations persist through existing `recordTurn`/Notebook history and survive reload; never write a diagnosis into telemetry Machine Memory.
- Do not import PR #3454's WebView trust-boundary changes, duplicate PR #3436 camera work, or edit `equipment-notebooks.ts` while PR #3477 owns overlapping changes.
- Overall release proof still depends on Workstream C's seven-day physical CV-101 artifact, Workstream D's emulator evidence, and Mike's physical Pixel smoke.
