# FactoryLM Unified UI Cutover Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the unified FactoryLM shell the only destination for new product UI work while preserving legacy runtime rollback and existing capabilities.

**Architecture:** Extend the existing convergence and capability-closure registries, then enforce their legacy presentation paths with one deterministic CI guard. Repository-loaded Codex/Claude instructions point every agent to the same charter, and three project-scoped Claude workflows divide read-only mapping, single-writer implementation, and exact-SHA verification.

**Tech Stack:** Markdown, YAML, Python 3.12, pytest, GitHub Actions, Claude Code dynamic workflow JavaScript.

**Spec:** `docs/architecture/convergence/UNIFIED_UI_CUTOVER.md`

## Global Constraints

- Freeze presentation paths only; `mira-web`, `mira-hub`, and `mira-mobile` remain live capability owners.
- Canonical shared UI paths are `packages/factorylm-theme/**`, `packages/factorylm-interaction/**`, `packages/factorylm-ui/**`, and `apps/factorylm-ui-lab/**`.
- Existing Equipment Notebook persistence, typed SSE, evidence, safety, identity, provider routing, and authorization remain server-owned.
- Do not create a second capability registry; extend `CAPABILITY_CLOSURE.yaml`.
- Legacy additions/modifications/renames fail closed; deletions pass; `legacy-ui-exception` requires live maintainer label plus reason, canonical impact, and rollback in the PR body.
- Dynamic workflows never permit parallel writers in `packages/factorylm-*` and never merge or deploy.
- Apache-2.0/MIT only; no production route, database, provider, or deployment change in this governance slice.

---

### Task 1: Declare canonical and legacy presentation ownership

**Files:**
- Modify: `docs/architecture/convergence/REGISTRY.yaml`
- Modify: `docs/architecture/convergence/CAPABILITY_CLOSURE.yaml`
- Modify: `MODULES.md`
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`
- Create: `.claude/rules/factorylm-unified-ui-cutover.md`

**Interfaces:**
- Consumes: the approved charter and current registry vocabularies.
- Produces: unique registry entries with `guarded_paths`, one `unified_ui_shell` capability record, and automatic agent entrypoints.

- [ ] **Step 1: Add per-component registry entries**

Add canonical entries for each shared package/lab and legacy entries for the
three guarded presentation groups. Every entry includes valid `type:*` and
`domain:*` tags. Legacy entries use:

```yaml
status: LEGACY
change_policy: exception_only
deletion_safe: false
canonical_replacement: packages/factorylm-ui/
guarded_paths:
  - exact/repository/path
```

- [ ] **Step 2: Register the disconnected shell honestly**

Add `unified_ui_shell` to `CAPABILITY_CLOSURE.yaml` with state
`implemented_unconnected`, all environments unset, current package/lab
entrypoints, owner, existing test evidence, reason, review date, and promotion
criteria through Golden Conversation connection. Do not claim deployment.

- [ ] **Step 3: Add concise agent entrypoints**

Add one pointer in root `AGENTS.md`, one pointer in root `CLAUDE.md`, one module
lifecycle note in `MODULES.md`, and the focused `.claude/rules/` file. The rule
must route new UI work to canonical packages, name the exception policy, and
link the charter rather than duplicate it.

- [ ] **Step 4: Validate registry baselines**

Run:

```bash
python3 -m pytest \
  tests/test_architecture.py::test_registry_entries_all_tagged \
  tests/test_architecture.py::test_registry_tags_checker_catches_violations \
  tests/test_capability_closure.py -q
python3 tools/capability_closure.py
```

Expected: all tests pass and the capability registry reports every record complete.

- [ ] **Step 5: Commit ownership declarations**

```bash
git add docs/architecture/convergence/REGISTRY.yaml \
  docs/architecture/convergence/CAPABILITY_CLOSURE.yaml MODULES.md AGENTS.md \
  CLAUDE.md .claude/rules/factorylm-unified-ui-cutover.md
git commit -m "docs(ui): declare unified shell cutover authority"
```

### Task 2: Build the lifecycle guard test-first

**Files:**
- Create: `tests/test_ui_surface_lifecycle_guard.py`
- Create: `tools/ui_surface_lifecycle_guard.py`

**Interfaces:**
- Consumes: legacy entries with `change_policy: exception_only` and `guarded_paths` from `REGISTRY.yaml`.
- Produces: `load_guarded_paths(registry_path)`, `path_is_guarded(path, patterns)`, `evaluate(changed_paths, labels, pr_body, patterns)`, `changed_paths_between(root, base, head)`, and a CLI returning 0/1.

- [ ] **Step 1: Write failing behavior tests**

Tests must prove these independent outcomes with literal fixtures:

```python
from pathlib import Path
import importlib.util
import subprocess

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "ui_surface_lifecycle_guard", ROOT / "tools" / "ui_surface_lifecycle_guard.py"
)
guard = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(guard)

PATTERNS = ("legacy/file.ts", "legacy/tree/**")
VALID_BODY = """## Legacy UI exception

Reason: Restore a production rollback control.
Canonical replacement impact: No shared-shell behavior changes.
Rollback: Revert this commit and redeploy the prior image.
"""


def run_git(root: Path, *args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=root, check=True, text=True,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    ).stdout.strip()


def init_repo(root: Path) -> str:
    run_git(root, "init", "-q")
    run_git(root, "config", "user.email", "guard@example.test")
    run_git(root, "config", "user.name", "Guard Test")
    (root / "legacy").mkdir()
    (root / "legacy" / "file.ts").write_text("old\n", encoding="utf-8")
    run_git(root, "add", ".")
    run_git(root, "commit", "-qm", "base")
    return run_git(root, "rev-parse", "HEAD")


def test_modified_legacy_path_fails_without_exception():
    result = guard.evaluate(["legacy/file.ts"], set(), "", PATTERNS)
    assert result.allowed is False
    assert result.guarded_paths == ("legacy/file.ts",)


def test_nonlegacy_path_passes():
    result = guard.evaluate(["packages/factorylm-ui/src/new.tsx"], set(), "", PATTERNS)
    assert result.allowed is True
    assert result.guarded_paths == ()


def test_deletion_is_absent_from_changed_paths_between(tmp_path: Path):
    base = init_repo(tmp_path)
    (tmp_path / "legacy" / "file.ts").unlink()
    run_git(tmp_path, "add", "-A")
    run_git(tmp_path, "commit", "-qm", "delete")
    assert guard.changed_paths_between(tmp_path, base, "HEAD") == ()


def test_rename_into_legacy_path_is_guarded(tmp_path: Path):
    base = init_repo(tmp_path)
    (tmp_path / "legacy" / "file.ts").rename(tmp_path / "outside.ts")
    run_git(tmp_path, "add", "-A")
    run_git(tmp_path, "commit", "-qm", "move out")
    second = run_git(tmp_path, "rev-parse", "HEAD")
    (tmp_path / "outside.ts").rename(tmp_path / "legacy" / "file.ts")
    run_git(tmp_path, "add", "-A")
    run_git(tmp_path, "commit", "-qm", "move in")
    assert guard.changed_paths_between(tmp_path, second, "HEAD") == ("legacy/file.ts",)


def test_exception_requires_reason_canonical_impact_and_rollback():
    result = guard.evaluate(
        ["legacy/file.ts"], {"legacy-ui-exception"},
        "## Legacy UI exception\n\nReason: Urgent repair.\n", PATTERNS,
    )
    assert result.allowed is False
    assert result.missing_fields == ("Canonical replacement impact", "Rollback")


def test_valid_live_exception_passes():
    result = guard.evaluate(
        ["legacy/file.ts"], {"legacy-ui-exception"}, VALID_BODY, PATTERNS,
    )
    assert result.allowed is True


def test_registry_supplies_the_real_guarded_paths():
    paths = set(guard.load_guarded_paths(
        ROOT / "docs/architecture/convergence/REGISTRY.yaml"
    ))
    assert "mira-web/src/views/home.ts" in paths
    assert "mira-hub/src/components/equipment/NotebookChat.tsx" in paths
    assert "mira-mobile/src/screens/ChatV2.tsx" in paths
```

The git tests create a temporary repository, commit a base, then use real
`git diff --name-only --diff-filter=AMR --find-renames BASE...HEAD` behavior. A deletion
must not reach `evaluate`; a rename into a guarded path must.

- [ ] **Step 2: Run RED**

Run: `python3 -m pytest tests/test_ui_surface_lifecycle_guard.py -q`

Expected: collection/import fails because `tools/ui_surface_lifecycle_guard.py` does not exist.

- [ ] **Step 3: Implement the minimal guard**

The loader reads only unique entries carrying both `status: LEGACY` and
`change_policy: exception_only`. Matching supports exact paths and a deliberate
trailing `/**` prefix form. The result object contains guarded paths plus a
human-readable reason. The exception parser requires non-empty values after
these exact labels under `## Legacy UI exception`:

```text
Reason:
Canonical replacement impact:
Rollback:
```

Use this exact public shape so the tests and CI call the same behavior:

```python
@dataclass(frozen=True)
class GuardResult:
    allowed: bool
    guarded_paths: tuple[str, ...]
    missing_fields: tuple[str, ...]
    message: str


def load_guarded_paths(registry_path: Path) -> tuple[str, ...]:
    data = yaml.safe_load(registry_path.read_text(encoding="utf-8"))
    paths = {
        path
        for entry in data.values()
        if isinstance(entry, dict)
        and entry.get("status") == "LEGACY"
        and entry.get("change_policy") == "exception_only"
        for path in entry.get("guarded_paths", [])
    }
    return tuple(sorted(paths))


def path_is_guarded(path: str, patterns: Iterable[str]) -> bool:
    return any(
        path == pattern
        or (pattern.endswith("/**") and path.startswith(pattern[:-3].rstrip("/") + "/"))
        for pattern in patterns
    )


def changed_paths_between(root: Path, base: str, head: str) -> tuple[str, ...]:
    output = subprocess.run(
        ["git", "diff", "--name-only", "--diff-filter=AMR", "--find-renames",
         f"{base}...{head}", "--"],
        cwd=root, check=True, text=True, stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    ).stdout
    return tuple(line for line in output.splitlines() if line)
```

The CLI accepts `--registry`, `--base`, `--head`, `--labels`, and
`--pr-body-file`, prints GitHub error annotations for violations, and fails
closed on malformed registry or missing base/head inputs.

- [ ] **Step 4: Run GREEN and regression tests**

Run:

```bash
python3 -m pytest tests/test_ui_surface_lifecycle_guard.py -q
python3 -m pytest \
  tests/test_architecture.py::test_registry_entries_all_tagged \
  tests/test_capability_closure.py -q
```

Expected: all tests pass with no warnings.

- [ ] **Step 5: Commit the guard**

```bash
git add tests/test_ui_surface_lifecycle_guard.py tools/ui_surface_lifecycle_guard.py
git commit -m "feat(ci): guard legacy FactoryLM presentation paths"
```

### Task 3: Wire the guard into the required merge gate

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/pull_request_template.md`

**Interfaces:**
- Consumes: guard CLI from Task 2 and GitHub live PR metadata.
- Produces: unconditional `ui-lifecycle-guard` CI job and a required `CI Gate` dependency.

- [ ] **Step 1: Add the CI job**

The job checks out full history, installs `pyyaml` and `pytest`, runs the guard
tests, then fetches labels and body live:

```bash
gh pr view "$PR_NUMBER" --repo "$GITHUB_REPOSITORY" \
  --json labels --jq '[.labels[].name] | join(",")'
gh pr view "$PR_NUMBER" --repo "$GITHUB_REPOSITORY" \
  --json body --jq '.body' > "$RUNNER_TEMP/pr-body.md"
python tools/ui_surface_lifecycle_guard.py \
  --base "$BASE_SHA" --head "$HEAD_SHA" --labels "$LABELS" \
  --pr-body-file "$RUNNER_TEMP/pr-body.md"
```

On non-PR pushes, run the tests and skip only the diff enforcement.

- [ ] **Step 2: Make the job required by `CI Gate`**

Add the job to `needs`, expose `UI_LIFECYCLE_RESULT`, and call
`require_success ui-lifecycle-guard "$UI_LIFECYCLE_RESULT"`.

- [ ] **Step 3: Document the optional exception section**

Add the exact three-field block from the charter to the PR template, marked
N/A unless the label is present.

- [ ] **Step 4: Validate workflow syntax and behavior**

Run:

```bash
python3 -m pytest tests/test_ui_surface_lifecycle_guard.py -q
docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:1.7.12 -color
git diff --check
```

Expected: tests and actionlint pass; the guard job is fail-closed in `CI Gate`.

- [ ] **Step 5: Commit CI wiring**

```bash
git add .github/workflows/ci.yml .github/pull_request_template.md
git commit -m "ci(ui): enforce legacy presentation freeze"
```

### Task 4: Add project-scoped Claude workflows

**Files:**
- Create: `.claude/workflows/flm-ui-map.js`
- Create: `.claude/workflows/flm-ui-slice.js`
- Create: `.claude/workflows/flm-ui-verify.js`

**Interfaces:**
- Consumes: structured `args`, issue #3626, charter, exact SHA, and work-packet contract.
- Produces: read-only mapping report; one-writer implementation/report/review chain; read-only exact-SHA verdict.

- [ ] **Step 1: Use Claude Code workflow authoring guidance**

Run `/workflow-authoring` in Claude Code 2.1.248 or newer before editing. Each
file starts with a literal `export const meta = { name, description }`, uses no
imports, timestamps, randomness, direct filesystem access, or direct shell
access, and keeps intermediate results in variables.

- [ ] **Step 2: Implement `/flm-ui-map`**

Fan out read-only mapping agents across public, Hub, mobile, shared core, and
capability closure. A cross-check agent rejects invented paths/symbols; a final
agent emits proposed work packets. Return structured results; do not edit.

- [ ] **Step 3: Implement `/flm-ui-slice`**

Validate required arguments, run one read-only preflight agent, then one writer
agent. The writer creates/enters an isolated worktree at `baseSha`, touches only
`allowedPaths`, follows TDD, commits, pushes, and opens a draft PR without
merging. After it returns, fan out read-only contract, safety, and test
reviewers and synthesize their verdict for the exact head.

- [ ] **Step 4: Implement `/flm-ui-verify`**

Fan out read-only reviewers for interaction parity, safety/identity/evidence,
tenant authorization, mobile/accessibility, transport honesty, performance/
licenses, and rollback. Synthesize `GREEN`, `PARTIAL`, or `BLOCKED`, naming the
exact SHA and every unverified claim.

- [ ] **Step 5: Validate saved scripts**

Run from Claude Code: `/reload-skills`, then confirm the three commands appear
in slash-command autocomplete. Also parse all three files without executing
agents:

```bash
WORKFLOW_OUT="$(mktemp -d)"
bun build .claude/workflows/flm-ui-map.js \
  .claude/workflows/flm-ui-slice.js \
  .claude/workflows/flm-ui-verify.js \
  --target=bun --format=esm --outdir "$WORKFLOW_OUT"
rm -rf "$WORKFLOW_OUT"
```

Expected: Bun reports three successful builds and Claude lists all three commands.

- [ ] **Step 6: Commit workflows**

```bash
git add .claude/workflows
git commit -m "feat(agents): add unified UI delivery workflows"
```

### Task 5: Close the governance slice with exact-SHA proof

**Files:**
- Modify: `wiki/hot.md`

**Interfaces:**
- Consumes: Tasks 1-4 and repository review protocol.
- Produces: durable handoff, reviewed SHA, draft PR, and owner-authorized merge.

- [ ] **Step 1: Update continuity**

Add the mission, GitHub issue, charter, branch/PR, legacy policy, next shared-
core task, and explicit no-production-change statement to `wiki/hot.md`.

- [ ] **Step 2: Run full local verification**

```bash
python3 -m pytest tests/test_ui_surface_lifecycle_guard.py tests/test_capability_closure.py -q
python3 tools/capability_closure.py
python3 -m pytest \
  tests/test_architecture.py::test_registry_entries_all_tagged \
  tests/test_architecture.py::test_registry_tags_checker_catches_violations -q
docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:1.7.12 -color
git diff --check origin/main...HEAD
tools/codegraph-preflight.sh "FACTORYLM-UNIFIED-UI-CUTOVER-001"
```

- [ ] **Step 3: Recheck collisions and push**

Repeat the three coordination commands, inspect changed files of overlapping
PRs, push the branch, and open a draft PR linked to #3626. Do not merge through
a new red check.

- [ ] **Step 4: Run the repository adversarial gate**

Run the committed exact-SHA review workflow. Claude owns remediation; Codex
reviews read-only. Any head change invalidates the previous verdict.

- [ ] **Step 5: Merge only after owner authorization and green CI**

The owner authorization is recorded in issue #3626 and the originating Codex
task. Merge serially, verify the resulting `main` SHA, create the
`legacy-ui-exception` repository label if absent, and update issue #3626 to
`COMPLETE` with the next unclaimed shared-core slice.
