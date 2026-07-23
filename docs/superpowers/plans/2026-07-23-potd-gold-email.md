# Print of the Day Gold Email Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a graded E-003 Print of the Day gold candidate and ensure scheduled POTD runs email exactly one report for every completed run.

**Architecture:** Keep the existing POTD runner and renderers as the orchestration point. Separate report email delivery from gold/promotion gating, make duplicate protection run-ID scoped, and add a launchd-style scheduled wrapper that runs with `--send`.

**Tech Stack:** Python 3.12, pytest, Pydantic, Resend mailer, Doppler, launchd shell/plist scheduling.

## Global Constraints

- Reuse the existing POTD runner, judge, report, mailer, and scheduler patterns.
- Do not derive the E-003 rubric from any prior model output.
- Do not hard-code or expose recipient email addresses or secrets.
- `--dry-run` must never send email.
- The scheduled production command must include email-enabled mode.
- Every completed scheduled run must send one report, including failed, unapproved, or degraded runs.
- Duplicate sends are blocked by `run_id`; later intentional runs of the same print must be allowed.
- Email delivery failure must make the job visibly fail.
- Tests and reconnaissance must not send emails.

---

### Task 1: Hermetic Runner Tests

**Files:**
- Modify: `tests/print_of_day/test_potd_pr6.py`

**Interfaces:**
- Consumes: `tools.print_of_day.run.main(argv)`.
- Produces: failing tests that define email and duplicate semantics.

- [ ] **Step 1: Write failing tests**
  Add tests that monkeypatch runner dependencies and assert:
  `--dry-run` sends nothing; `--send` sends once; failed grade/unapproved runs still send;
  same `run_id` blocks duplicates; a different `run_id` sends again; missing recipient fails.

- [ ] **Step 2: Verify RED**
  Run `python -m pytest tests/print_of_day/test_potd_pr6.py -q`.
  Expected: failures around missing `--dry-run`, case-scoped duplicate behavior, and send-gate blocking unapproved report sends.

### Task 2: Runner and Ledger Behavior

**Files:**
- Modify: `tools/print_of_day/run.py`
- Modify: `printsense/print_of_day/send_gate.py`
- Modify: `tools/internet_print_test/mailer.py`

**Interfaces:**
- Produces: `--dry-run`, recipient resolution, run-ID duplicate semantics, always-report send flow.

- [ ] **Step 1: Implement minimal code**
  Add explicit dry-run/send mutually exclusive CLI flags; resolve recipients without embedded defaults; change `SendLedger.already_sent()` to run-ID scope; render and send the report whenever `--send` is true and artifacts exist; keep promotion blockers visible in the email/report.

- [ ] **Step 2: Verify GREEN**
  Run `python -m pytest tests/print_of_day/test_potd_pr6.py -q`.

### Task 3: E-003 Gold Fixture

**Files:**
- Create: `printsense/print_of_day/gold/e003_vfd_power/rubric.json`
- Create: `printsense/print_of_day/gold/e003_vfd_power/approval.json`
- Modify: `tests/print_of_day/test_potd_pr6.py`

**Interfaces:**
- Consumes: `printsense.grade_case.grade_case`.
- Produces: an auditable rubric and approval record for the scheduled E-003 run.

- [ ] **Step 1: Write fixture tests**
  Assert the rubric source metadata says it is human-authored from the committed sheet, references E-003, and the known-good graph fixture grades as `AUTO_IMPORT` / `PASS` with an A.

- [ ] **Step 2: Add rubric and approval**
  Encode the E-003 devices, wires, structure, and unresolved field-verification items from the committed source print.

- [ ] **Step 3: Verify fixture tests**
  Run `python -m pytest tests/print_of_day/test_potd_pr6.py -q`.

### Task 4: Scheduler

**Files:**
- Create: `tools/print_of_day/scheduled_run.sh`
- Create: `tools/print_of_day/com.factorylm.print-of-day.plist`
- Modify: `tests/print_of_day/test_potd_pr6.py`
- Modify: `docs/runbooks/2026-07-21-potd-staging-activation.md`

**Interfaces:**
- Produces: production scheduled command and artifact retention path.

- [ ] **Step 1: Write scheduler test**
  Assert the script contains `--send`, the E-003 image/rubric/approval, Doppler `factorylm/prd`, no literal recipient address, and a retained timestamped output path.

- [ ] **Step 2: Add scheduler files**
  Mirror the Drive Commander launchd token pattern and retain artifacts in `dogfood-output/print-of-day/`.

- [ ] **Step 3: Verify scheduler test**
  Run `python -m pytest tests/print_of_day/test_potd_pr6.py -q`.

### Task 5: Live Acceptance and PR

**Files:**
- Modify: `VERSION`
- Modify: `docs/CHANGELOG.md`

**Interfaces:**
- Produces: one live email test, duplicate proof, commit, pushed branch, unmerged PR.

- [ ] **Step 1: Full local verification**
  Run `python -m pytest tests/print_of_day/ -q` and `ruff check` on changed Python files.

- [ ] **Step 2: One authorized live email test**
  Run the E-003 command once with `--send`, production or staging Doppler as appropriate, no literal recipient, and capture the run ID and Resend response ID. Retry the same `run_id` once to prove duplicate delivery is blocked before sending.

- [ ] **Step 3: Commit and PR**
  Stage only intended files, commit with a conventional message, push branch, open an unmerged PR, and report branch, commit, PR link, tests, schedule, live evidence, duplicate proof, and risks.
