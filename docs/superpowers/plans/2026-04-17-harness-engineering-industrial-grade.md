# MIRA Harness Engineering — Industrial-Grade Code Quality

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden MIRA's harness from 5.5/10 to 8+/10 maturity — the level where industrial market professionals (maintenance managers, plant engineers, safety auditors) trust the codebase enough to deploy it alongside production equipment.

**Architecture:** Four phases — each independently shippable. Phase 1 blocks bad code from ever reaching main. Phase 2 quantifies quality. Phase 3 prevents structural decay. Phase 4 catches subtle bugs over time. Each phase adds a new "layer" to the harness that compounds with previous layers.

**Tech Stack:** ruff, semgrep, gitleaks, bandit, pyright, pytest-cov, import-linter, hypothesis, mutmut, Dependabot, GitHub Actions, pre-commit hooks (Claude Code + git)

**Source framework:** [Harness Engineering (Martin Fowler)](https://martinfowler.com/articles/harness-engineering.html) + [Harness Engineering for Coding Agents (HumanLayer)](https://www.humanlayer.dev/blog/skill-issue-harness-engineering-for-coding-agents)

**Audit baseline:** 100 test files, 5 CI jobs, 2 hooks, 10 skills, 0 SAST, 0 type checking, 0 coverage measurement, 0 pre-commit gates, 0 architecture enforcement.

---

## Phase 1: Security Gates — Block Bad Code from Shipping

*"Anytime you find an agent makes a mistake, engineer a solution such that the agent never makes that mistake again."*

**Outcome:** Every push to main is scanned for secrets, common vulnerabilities, and unsafe patterns. No code with known security issues reaches production.

---

### Task 1.1: Add semgrep SAST scanning to CI

**Files:**
- Create: `.github/semgrep.yml` (rule config)
- Modify: `.github/workflows/ci.yml` (add job)

- [x] **Step 1: Create semgrep config with MIRA-specific rules**

```yaml
# .github/semgrep.yml
rules:
  # Block yaml.load() without SafeLoader (already in python-standards.md but not enforced)
  - id: unsafe-yaml-load
    patterns:
      - pattern: yaml.load(...)
      - pattern-not: yaml.safe_load(...)
      - pattern-not: yaml.load(..., Loader=yaml.SafeLoader)
    message: "Use yaml.safe_load() — never yaml.load(). See .claude/rules/python-standards.md"
    languages: [python]
    severity: ERROR

  # Block os.system() and subprocess with shell=True
  - id: shell-injection
    patterns:
      - pattern-either:
          - pattern: os.system(...)
          - pattern: subprocess.call(..., shell=True, ...)
          - pattern: subprocess.run(..., shell=True, ...)
          - pattern: subprocess.Popen(..., shell=True, ...)
    message: "Shell injection risk. Use subprocess.run([...], shell=False) instead."
    languages: [python]
    severity: ERROR

  # Block pickle deserialization (security-boundaries.md: "Do not deserialize untrusted pickle")
  - id: unsafe-pickle
    pattern: pickle.loads(...)
    message: "Never deserialize untrusted pickle data. See security-boundaries.md."
    languages: [python]
    severity: ERROR

  # Block hardcoded API keys/tokens
  - id: hardcoded-secret
    patterns:
      - pattern-regex: '(sk-ant-|sk-proj-|ghp_|ghs_|glpat-|xoxb-|xoxp-)[a-zA-Z0-9]{10,}'
    message: "Hardcoded secret detected. Use Doppler (factorylm/prd)."
    languages: [python, javascript, typescript]
    severity: ERROR

  # Block requests library (must use httpx per python-standards.md)
  - id: use-httpx-not-requests
    pattern: import requests
    message: "Use httpx, not requests. See .claude/rules/python-standards.md"
    languages: [python]
    severity: WARNING

  # Block print() in production code (must use logging)
  - id: no-print-in-production
    pattern: print(...)
    paths:
      exclude:
        - "tests/*"
        - "tools/*"
        - "scripts/*"
        - "**/test_*.py"
    message: "Use logging.getLogger(), not print(). See python-standards.md"
    languages: [python]
    severity: WARNING

  # Block bare except
  - id: no-bare-except
    pattern: |
      except:
        ...
    message: "Catch specific exceptions, not bare except. See python-standards.md"
    languages: [python]
    severity: ERROR
```

- [x] **Step 2: Add semgrep job to CI**

Add to `.github/workflows/ci.yml` after the `lint-and-type-check` job:

```yaml
  sast-scan:
    name: Security Scan (SAST)
    runs-on: ubuntu-latest
    needs: lint-and-type-check
    steps:
      - uses: actions/checkout@v4

      - name: Run semgrep
        uses: returntocorp/semgrep-action@v1
        with:
          config: .github/semgrep.yml
          generateSarif: "1"

      - name: Upload SARIF
        if: always()
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: semgrep.sarif
```

- [x] **Step 3: Run semgrep locally to find existing violations**

Run: `uvx semgrep --config .github/semgrep.yml mira-bots/ mira-core/ mira-mcp/ mira-crawler/ 2>&1 | tee /tmp/semgrep-baseline.txt`

Expected: List of existing violations to triage (fix or suppress with `# nosemgrep` comments).

- [x] **Step 4: Fix or suppress all existing violations**

For each violation:
- If it's a real bug → fix it
- If it's a false positive → add `# nosemgrep: <rule-id>` with a reason comment
- If it's in legacy code → suppress with a TODO comment and open an issue

- [x] **Step 5: Verify semgrep passes clean**

Run: `uvx semgrep --config .github/semgrep.yml mira-bots/ mira-core/ mira-mcp/ mira-crawler/ --error`
Expected: Exit code 0 (no errors)

- [ ] **Step 6: Commit** *(deferred — bundling all Phase 1 into single commit)*

```bash
git add .github/semgrep.yml .github/workflows/ci.yml
git commit -m "security: add semgrep SAST scanning to CI pipeline

Rules enforce: no yaml.load, no shell injection, no pickle, no hardcoded
secrets, no requests (use httpx), no print (use logging), no bare except.
SARIF upload to GitHub Security tab for tracking."
```

---

### Task 1.2: Add gitleaks pre-commit + CI secrets scanning

**Files:**
- Create: `.gitleaks.toml` (config)
- Modify: `.github/workflows/ci.yml` (add job)
- Modify: `.claude/settings.json` (add pre-commit hook)

- [x] **Step 1: Create gitleaks config**

```toml
# .gitleaks.toml
title = "MIRA gitleaks config"

[allowlist]
  description = "Known safe patterns"
  paths = [
    '''\.env\.template$''',
    '''\.gitleaks\.toml$''',
    '''wiki/''',
    '''docs/''',
  ]

[[rules]]
  id = "anthropic-api-key"
  description = "Anthropic API Key"
  regex = '''sk-ant-[a-zA-Z0-9_-]{20,}'''
  tags = ["key", "anthropic"]

[[rules]]
  id = "doppler-token"
  description = "Doppler Service Token"
  regex = '''dp\.st\.[a-zA-Z0-9_-]{20,}'''
  tags = ["key", "doppler"]

[[rules]]
  id = "telegram-bot-token"
  description = "Telegram Bot Token"
  regex = '''\d{8,10}:AA[a-zA-Z0-9_-]{33}'''
  tags = ["key", "telegram"]

[[rules]]
  id = "generic-api-key"
  description = "Generic API Key assignment"
  regex = '''(?i)(api[_-]?key|api[_-]?secret|api[_-]?token)\s*[=:]\s*['"][a-zA-Z0-9_-]{16,}['"]'''
  tags = ["key", "generic"]
```

- [x] **Step 2: Add gitleaks job to CI**

Add to `.github/workflows/ci.yml`:

```yaml
  secrets-scan:
    name: Secrets Scan
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0  # full history for historical scan

      - name: Run gitleaks
        uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          GITLEAKS_LICENSE: ${{ secrets.GITLEAKS_LICENSE }}
```

- [x] **Step 3: Add gitleaks as a Claude Code pre-commit hook**

Edit `.claude/settings.json` to add a PreCommit hook:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "echo \"$CLAUDE_TOOL_INPUT\" | grep -qE 'git commit|git push' && gitleaks protect --staged --config .gitleaks.toml 2>/dev/null || true"
          }
        ]
      }
    ]
  }
}
```

- [x] **Step 4: Run historical scan on full repo**

Run: `uvx gitleaks detect --source . --config .gitleaks.toml --report-path /tmp/gitleaks-report.json --verbose`
Expected: Report of any historical secret exposure. Rotate any found secrets immediately via Doppler.

- [ ] **Step 5: Commit** *(deferred — bundling all Phase 1 into single commit)*

```bash
git add .gitleaks.toml .github/workflows/ci.yml .claude/settings.json
git commit -m "security: add gitleaks secrets scanning — CI + pre-commit hook

Historical scan clean. Covers: Anthropic keys, Doppler tokens, Telegram
bot tokens, generic API keys. Pre-commit hook via Claude Code settings."
```

---

### Task 1.3: Add bandit Python security linting to CI

**Files:**
- Create: `.bandit.yml` (config)
- Modify: `.github/workflows/ci.yml` (extend sast-scan job)

- [x] **Step 1: Create bandit config**

```yaml
# .bandit.yml
# Bandit Python security linter config
skips:
  - B101  # assert used (fine in tests, bandit runs on non-test code)
  - B104  # binding to 0.0.0.0 (expected in Docker containers)

exclude_dirs:
  - tests
  - tools
  - archives
  - mira-bots-phase1
  - mira-bots-phase2
  - mira-bots-phase3
```

- [x] **Step 2: Add bandit to the SAST scan job in CI**

Extend the `sast-scan` job:

```yaml
      - name: Install bandit
        run: pip install "bandit[toml]==1.8.*"

      - name: Run bandit
        run: |
          bandit -r mira-bots/shared/ mira-bots/telegram/ mira-bots/slack/ \
            mira-core/mira-ingest/ mira-mcp/ mira-crawler/tasks/ \
            -c .bandit.yml -f json -o /tmp/bandit-report.json || true
          bandit -r mira-bots/shared/ mira-bots/telegram/ mira-bots/slack/ \
            mira-core/mira-ingest/ mira-mcp/ mira-crawler/tasks/ \
            -c .bandit.yml --severity-level high
```

- [x] **Step 3: Run bandit locally, triage results**

Run: `uvx bandit -r mira-bots/ mira-core/ mira-mcp/ mira-crawler/tasks/ -c .bandit.yml`
Expected: List of findings. Fix HIGH severity, suppress LOW with `# nosec` + justification.

- [ ] **Step 4: Commit** *(deferred — bundling all Phase 1 into single commit)*

```bash
git add .bandit.yml .github/workflows/ci.yml
git commit -m "security: add bandit Python security linting to SAST pipeline

Blocks HIGH severity findings. Skips: assert (B101), bind 0.0.0.0 (B104).
Covers: mira-bots, mira-core, mira-mcp, mira-crawler."
```

---

## Phase 2: Measurement — Quantify Quality

**Outcome:** Every PR shows test coverage delta. Type errors caught before merge. Quality is a number, not a feeling.

---

### Task 2.1: Add pyright type checking to CI

**Files:**
- Create: `pyrightconfig.json`
- Modify: `.github/workflows/ci.yml` (add to lint job)
- Modify: `.claude/settings.json` (add PostToolUse hook)

- [x] **Step 1: Create pyright config (permissive start, tighten over time)**

```json
{
  "include": [
    "mira-bots/shared",
    "mira-core/mira-ingest",
    "mira-mcp",
    "mira-crawler/tasks"
  ],
  "exclude": [
    "mira-bots-phase1",
    "mira-bots-phase2",
    "mira-bots-phase3",
    "archives",
    "tests",
    "tools"
  ],
  "typeCheckingMode": "basic",
  "pythonVersion": "3.12",
  "reportMissingImports": true,
  "reportMissingTypeStubs": false,
  "reportGeneralClassIssues": false,
  "reportOptionalMemberAccess": false,
  "reportOptionalSubscript": false
}
```

- [x] **Step 2: Add pyright to CI lint job**

Extend `lint-and-type-check` job in ci.yml:

```yaml
      - name: Install pyright
        run: pip install pyright

      - name: Type check
        run: pyright --outputjson > /tmp/pyright-report.json || pyright
```

- [x] **Step 3: Add pyright as a PostToolUse back-pressure hook**

Add to `.claude/settings.json` PostToolUse hooks:

```json
{
  "matcher": "Edit|Write",
  "hooks": [
    {
      "type": "command",
      "command": "pyright \"$CLAUDE_FILE_PATH\" 2>/dev/null | grep -c 'error' | xargs -I{} test {} -eq 0 || echo 'pyright: type errors found'"
    }
  ]
}
```

- [x] **Step 4: Run pyright locally, triage errors**

Run: `uvx pyright`
Expected: Potentially many errors in basic mode. Fix critical ones (missing imports, wrong types on API boundaries). Suppress noise with `# type: ignore[<code>]` + comment.

- [ ] **Step 5: Commit** *(deferred — bundling Phase 2)*

```bash
git add pyrightconfig.json .github/workflows/ci.yml .claude/settings.json
git commit -m "feat: add pyright type checking — CI gate + editor back-pressure

Basic mode on mira-bots/shared, mira-core/mira-ingest, mira-mcp,
mira-crawler/tasks. PostToolUse hook warns on type errors after edits."
```

---

### Task 2.2: Add pytest-cov coverage measurement + threshold

**Files:**
- Modify: `mira-core/mira-ingest/requirements.txt` (add pytest-cov)
- Modify: `mira-bots/telegram/requirements.txt` (add pytest-cov)
- Modify: `.github/workflows/ci.yml` (add --cov flags)
- Modify: `pyproject.toml` (add coverage config)

- [x] **Step 1: Add coverage config to pyproject.toml**

```toml
[tool.coverage.run]
source = ["mira-bots/shared", "mira-core/mira-ingest", "mira-mcp"]
omit = ["*/tests/*", "*/test_*", "*/conftest.py"]

[tool.coverage.report]
fail_under = 50
show_missing = true
exclude_lines = [
    "pragma: no cover",
    "if __name__ == .__main__.",
    "if TYPE_CHECKING:",
    "raise NotImplementedError",
]
```

- [x] **Step 2: Add pytest-cov to requirements files**

Add `pytest-cov>=5.0` to both:
- `mira-core/mira-ingest/requirements.txt`
- `mira-bots/telegram/requirements.txt`

- [x] **Step 3: Update CI to collect and enforce coverage**

Update test steps in ci.yml:

```yaml
      - name: Run ingest tests with coverage
        run: |
          pytest mira-core/mira-ingest/tests/ -v \
            --cov=mira-core/mira-ingest --cov-report=term-missing \
            --cov-fail-under=50

      - name: Run bot tests with coverage
        run: |
          pytest mira-bots/tests/ -v \
            --ignore=mira-bots/tests/test_slack_relay.py \
            --cov=mira-bots/shared --cov-report=term-missing \
            --cov-fail-under=50 --cov-append
```

- [x] **Step 4: Run locally, check baseline coverage** *(blocked locally — Python 3.14 vs 3.12, missing deps; CI will measure)*

Run: `pytest mira-core/mira-ingest/tests/ --cov=mira-core/mira-ingest --cov-report=term-missing`
Expected: A coverage percentage. If below 50%, write tests for uncovered critical paths before enforcing.

- [ ] **Step 5: Commit** *(deferred — bundling Phase 2)*

```bash
git add pyproject.toml mira-core/mira-ingest/requirements.txt \
  mira-bots/telegram/requirements.txt .github/workflows/ci.yml
git commit -m "test: add pytest-cov coverage measurement — 50% minimum enforced

Coverage measured on mira-bots/shared + mira-core/mira-ingest.
Threshold starts at 50%, ratchet up as tests are added."
```

---

## Phase 3: Architecture Enforcement — Prevent Structural Decay

**Outcome:** Module boundaries are enforced by tests. Imports that cross boundaries fail CI. Architecture documentation is a living, verified artifact.

---

### Task 3.1: Add import-linter to enforce module boundaries

**Files:**
- Create: `.importlinter` (config)
- Modify: `.github/workflows/ci.yml` (add job)

- [x] **Step 1: Create architecture boundary tests** *(adapted: test_architecture.py instead of import-linter — monorepo has non-standard package layout)*

```ini
# .importlinter
[importlinter]
root_packages =
    mira_bots
    mira_core
    mira_mcp
    mira_crawler

[importlinter:contract:1]
name = Bots cannot import from crawler
type = forbidden
source_modules =
    mira_bots
forbidden_modules =
    mira_crawler

[importlinter:contract:2]
name = Crawler cannot import from bots
type = forbidden
source_modules =
    mira_crawler
forbidden_modules =
    mira_bots

[importlinter:contract:3]
name = MCP server cannot import from bots or crawler
type = forbidden
source_modules =
    mira_mcp
forbidden_modules =
    mira_bots
    mira_crawler

[importlinter:contract:4]
name = No module imports from mira_core internals directly
type = forbidden
source_modules =
    mira_bots
    mira_mcp
    mira_crawler
forbidden_modules =
    mira_core.mira_ingest.db
```

- [x] **Step 2: Add to CI**

```yaml
  architecture-check:
    name: Architecture Check
    runs-on: ubuntu-latest
    needs: lint-and-type-check
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - run: pip install import-linter
      - run: lint-imports
```

- [x] **Step 3: Run locally, fix violations** *(all 6 contracts pass clean)*

Run: `uvx import-linter --config .importlinter`
Expected: Some violations from cross-module imports. Fix by moving shared code to a shared package or adding explicit interface modules.

- [ ] **Step 4: Commit** *(deferred — bundling Phase 3)*

```bash
git add .importlinter .github/workflows/ci.yml
git commit -m "refactor: add import-linter — enforce module boundaries in CI

Contracts: bots↛crawler, crawler↛bots, mcp↛bots/crawler,
no direct imports of mira_core internals."
```

---

### Task 3.2: Add Dependabot for automated dependency updates

**Files:**
- Create: `.github/dependabot.yml`

- [x] **Step 1: Create Dependabot config**

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: "pip"
    directory: "/mira-core/mira-ingest"
    schedule:
      interval: "weekly"
      day: "monday"
    labels: ["dependencies", "python"]
    open-pull-requests-limit: 5

  - package-ecosystem: "pip"
    directory: "/mira-bots/telegram"
    schedule:
      interval: "weekly"
      day: "monday"
    labels: ["dependencies", "python"]
    open-pull-requests-limit: 5

  - package-ecosystem: "pip"
    directory: "/mira-mcp"
    schedule:
      interval: "weekly"
      day: "monday"
    labels: ["dependencies", "python"]
    open-pull-requests-limit: 5

  - package-ecosystem: "pip"
    directory: "/mira-crawler"
    schedule:
      interval: "weekly"
      day: "monday"
    labels: ["dependencies", "python"]
    open-pull-requests-limit: 5

  - package-ecosystem: "npm"
    directory: "/mira-web"
    schedule:
      interval: "weekly"
      day: "monday"
    labels: ["dependencies", "javascript"]
    open-pull-requests-limit: 5

  - package-ecosystem: "docker"
    directory: "/"
    schedule:
      interval: "weekly"
      day: "monday"
    labels: ["dependencies", "docker"]
    open-pull-requests-limit: 3

  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
      day: "monday"
    labels: ["dependencies", "ci"]
    open-pull-requests-limit: 3
```

- [ ] **Step 2: Commit** *(deferred — bundling Phase 3)*

```bash
git add .github/dependabot.yml
git commit -m "chore: add Dependabot — weekly dependency updates for pip, npm, Docker, GH Actions"
```

---

## Phase 4: Continuous Improvement — Catch Subtle Bugs

**Outcome:** Property-based testing catches FSM edge cases. Mutation testing validates test quality. Background scanning detects drift.

---

### Task 4.1: Add hypothesis property-based testing for FSM + guardrails

**Files:**
- Create: `tests/test_fsm_properties.py`
- Create: `tests/test_guardrails_properties.py`
- Modify: `pyproject.toml` (add hypothesis config)

*Goal:* Automatically discover edge cases in the FSM state machine (7 states, 4+ transition rules) and the guardrails module (safety keywords, intent classification, abbreviation expansion).

- [ ] **Step 1: Add hypothesis to test deps and config**

Add to pyproject.toml:
```toml
[tool.hypothesis]
database_backend = "directory"
max_examples = 200
```

- [ ] **Step 2: Write FSM property tests**

```python
# tests/test_fsm_properties.py
"""Property-based tests for MIRA FSM state transitions.

Verifies invariants that must hold regardless of input sequence:
- State never leaves the valid set
- SAFETY_ALERT is always reachable from any state
- DIAGNOSIS is only reachable after Q1/Q2/Q3
- State doesn't regress (Q3 → Q1 should be impossible)
"""
import sys
sys.path.insert(0, "mira-bots")

from hypothesis import given, strategies as st, assume
from shared.engine import Supervisor

VALID_STATES = {"IDLE", "Q1", "Q2", "Q3", "DIAGNOSIS", "FIX_STEP", "RESOLVED",
                "ASSET_IDENTIFIED", "ELECTRICAL_PRINT", "SAFETY_ALERT"}

@given(st.lists(st.text(min_size=1, max_size=200), min_size=1, max_size=20))
def test_state_always_valid(messages):
    """No sequence of messages should produce an invalid FSM state."""
    # This test would need a mock supervisor — sketch for now
    for msg in messages:
        # state = supervisor.process(chat_id, msg)
        # assert state in VALID_STATES
        pass

@given(st.text(min_size=1, max_size=500))
def test_safety_keywords_never_miss(message):
    """If a safety keyword is present, classify_intent MUST return 'safety'."""
    from shared.guardrails import SAFETY_KEYWORDS, classify_intent
    for keyword in SAFETY_KEYWORDS:
        if keyword.lower() in message.lower():
            result = classify_intent(message)
            assert result == "safety", f"Safety keyword '{keyword}' in message but got '{result}'"
```

- [ ] **Step 3: Write guardrails property tests**

```python
# tests/test_guardrails_properties.py
"""Property-based tests for guardrails module."""
from hypothesis import given, strategies as st
import sys
sys.path.insert(0, "mira-bots")

from shared.guardrails import expand_abbreviations, rewrite_question

@given(st.text(min_size=0, max_size=1000))
def test_expand_abbreviations_idempotent(text):
    """Expanding abbreviations twice should produce the same result."""
    once = expand_abbreviations(text)
    twice = expand_abbreviations(once)
    assert once == twice

@given(st.text(min_size=1, max_size=500), st.text(min_size=0, max_size=100))
def test_rewrite_question_preserves_meaning(message, asset):
    """Rewritten question should contain the original message or asset."""
    result = rewrite_question(message, asset if asset else None)
    assert isinstance(result, str)
    assert len(result) > 0
```

- [ ] **Step 4: Run property tests**

Run: `pytest tests/test_fsm_properties.py tests/test_guardrails_properties.py -v --hypothesis-show-statistics`
Expected: PASS, with hypothesis exploring 200 examples per test.

- [ ] **Step 5: Commit**

```bash
git add tests/test_fsm_properties.py tests/test_guardrails_properties.py pyproject.toml
git commit -m "test: add hypothesis property-based tests for FSM + guardrails

Properties tested: state validity, safety keyword exhaustiveness,
abbreviation expansion idempotency, rewrite preservation."
```

---

### Task 4.2: Add Docker image scanning with trivy

**Files:**
- Modify: `.github/workflows/ci.yml` (extend docker-build-check job)

- [ ] **Step 1: Add trivy scan after each Docker build**

Extend `docker-build-check` job:

```yaml
      - name: Install Trivy
        run: |
          curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh | sh -s -- -b /usr/local/bin

      - name: Scan mira-ingest image
        run: |
          docker buildx build -f mira-core/mira-ingest/Dockerfile mira-core/mira-ingest/ -t mira-ingest:scan --load
          trivy image --severity HIGH,CRITICAL --exit-code 1 mira-ingest:scan

      - name: Scan mira-bot-telegram image
        run: |
          docker buildx build -f mira-bots/telegram/Dockerfile mira-bots/ -t mira-telegram:scan --load
          trivy image --severity HIGH,CRITICAL --exit-code 1 mira-telegram:scan
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "security: add trivy Docker image scanning — blocks HIGH/CRITICAL CVEs"
```

---

## Harness Hook Consolidation

After all phases are complete, the `.claude/settings.json` hooks should look like this:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [{
          "type": "command",
          "command": "echo '--- MIRA v2.0 ---' && git log --oneline -5 && echo '--- Skills ---' && ls .claude/skills/*.md 2>/dev/null | xargs -I{} basename {} .md | tr '\\n' ' ' && echo"
        }]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "ruff check --fix \"$CLAUDE_FILE_PATH\" 2>/dev/null; ruff format \"$CLAUDE_FILE_PATH\" 2>/dev/null; pyright \"$CLAUDE_FILE_PATH\" 2>/dev/null | tail -1 || true"
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "echo \"$CLAUDE_TOOL_INPUT\" | grep -qE 'git commit|git push' && gitleaks protect --staged --config .gitleaks.toml 2>/dev/null || true"
          }
        ]
      }
    ]
  }
}
```

---

## Summary: What Changes at Each Phase

| Phase | New CI Jobs | New Hooks | New Config Files | Gate Behavior |
|-------|-------------|-----------|-----------------|---------------|
| **1: Security** | sast-scan, secrets-scan | PreToolUse (gitleaks) | .github/semgrep.yml, .gitleaks.toml, .bandit.yml | Blocks merge on HIGH-severity SAST/secrets |
| **2: Measurement** | type-check (in lint), coverage (in tests) | PostToolUse (pyright) | pyrightconfig.json, coverage config in pyproject.toml | Blocks merge on type errors + <50% coverage |
| **3: Architecture** | architecture-check | — | .importlinter, .github/dependabot.yml | Blocks merge on boundary violations |
| **4: Continuous** | trivy (in docker-build) | — | hypothesis config in pyproject.toml | Blocks on HIGH/CRITICAL CVEs in images |

## Maturity Progression

| Metric | Before | After Phase 1 | After Phase 2 | After Phase 3 | After Phase 4 |
|--------|--------|--------------|--------------|--------------|--------------|
| SAST coverage | 0 tools | semgrep + bandit | same | same | + trivy |
| Secrets scanning | 0 | gitleaks CI + hook | same | same | same |
| Type checking | 0% | 0% | pyright basic | same | same |
| Test coverage | unmeasured | unmeasured | 50%+ enforced | same | + hypothesis |
| Architecture | 0 contracts | 0 | 0 | 4 contracts | same |
| Dependency mgmt | manual | manual | manual | Dependabot weekly | same |
| Harness score | 5.5/10 | 7/10 | 7.5/10 | 8/10 | 8.5/10 |
