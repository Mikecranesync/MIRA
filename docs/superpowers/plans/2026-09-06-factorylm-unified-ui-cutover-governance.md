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
- Every guarded touch fails closed: addition, modification, deletion, rename-in,
  and rename-out. `legacy-ui-exception` requires a live maintainer label plus a
  substantive reason, canonical impact, and rollback in the PR body.
- Dynamic workflows never permit parallel writers in `packages/factorylm-*` and never merge or deploy.
- Apache-2.0/MIT only; no production route, database, provider, or deployment change in this governance slice.

---

### Task 1: Declare canonical and legacy presentation ownership

**Files:**
- Modify: `docs/architecture/convergence/REGISTRY.yaml`
- Modify: `docs/architecture/convergence/CAPABILITY_CLOSURE.yaml`
- Modify: `tests/test_architecture.py`
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
  - legacy/presentation/tree/**
```

Use the charter's directory boundaries exactly:

```text
mira-web/src/views/**
mira-web/public/mira-chat.js
mira-web/public/mira-chat.css
mira-hub/src/app/(hub)/**
mira-hub/src/components/layout/**
mira-hub/src/components/equipment/**
mira-mobile/src/App.tsx
mira-mobile/src/nav.ts
mira-mobile/src/screens/**
```

Before relying on strict YAML parsing, rename the five known duplicate
factorylm-repository keys to `factorylm-docs`, `factorylm-infra`,
`factorylm-scripts`, `factorylm-tests`, and `factorylm-tools`. Preserve every
entry body. Update the architecture-test comment that currently documents the
duplicates; the registry must have unique top-level keys after this task.

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
  docs/architecture/convergence/CAPABILITY_CLOSURE.yaml tests/test_architecture.py \
  MODULES.md AGENTS.md \
  CLAUDE.md .claude/rules/factorylm-unified-ui-cutover.md
git commit -m "docs(ui): declare unified shell cutover authority"
```

### Task 2: Build the lifecycle guard test-first

**Files:**
- Create: `tests/test_ui_surface_lifecycle_guard.py`
- Create: `tools/ui_surface_lifecycle_guard.py`

**Interfaces:**
- Consumes: trusted-base legacy entries with `change_policy: exception_only`,
  `deletion_safe: false`, and `guarded_paths` from `REGISTRY.yaml`, plus GitHub
  changed-file metadata.
- Produces: strict `load_guard_policy(registry_path)`, `path_is_guarded()`,
  `changed_files_between()`, `load_changed_files()`, `evaluate()`, and a CLI
  returning 0/1 without network access.

- [ ] **Step 1: Write failing behavior tests**

Define immutable `ChangedFile(status, path, previous_path=None)`, `GuardPolicy`,
and `GuardResult` values. Tests must prove these independent outcomes with
literal fixtures:

- modification, addition under `legacy/tree/**`, deletion, rename-in, and
  rename-out all fail without an exception;
- deletion and both rename directions are derived from a real temporary Git
  repository using `git diff --name-status -z --find-renames BASE...HEAD`;
- an unrelated canonical package change passes;
- a newly created sibling file under each guarded directory is caught;
- edits to every static `CONTROL_PATTERNS` path are guarded even if the head
  revision removes or changes registry policy;
- a valid label without a body, a valid body without a label, missing fields,
  blank fields, `N/A`, `<placeholder>` values, HTML-comment-only values,
  duplicate exception sections, and a complete block inside a fenced code block
  all fail;
- exactly one live section with substantive values passes;
- duplicate YAML keys, a scalar `guarded_paths`, empty lists, non-string paths,
  absolute/backslash/traversal paths, and wildcard forms other than terminal
  `/**` raise a policy error rather than weakening protection;
- GitHub JSON-lines input accepts `added`, `modified`, `removed`, and `renamed`
  records and rejects unknown/missing fields;
- the real registry supplies the public, Hub, and mobile directory patterns.

Use a tiny committed fixture string for a valid body; do not make the parser
accept the explanatory placeholder block in the charter or PR template.

- [ ] **Step 2: Run RED**

Run: `python3 -m pytest tests/test_ui_surface_lifecycle_guard.py -q`

Expected: collection/import fails because `tools/ui_surface_lifecycle_guard.py` does not exist.

- [ ] **Step 3: Implement the minimal guard**

Use a PyYAML `SafeLoader` subclass that rejects duplicate mapping keys before
constructing the policy. The loader reads only entries carrying all of
`status: LEGACY`, `change_policy: exception_only`, `deletion_safe: false`, a
non-empty `canonical_replacement`, and a validated non-empty list of normalized
`guarded_paths`. Matching supports exact paths and one deliberate terminal
`/**` prefix form. No other wildcard is accepted.

`CONTROL_PATTERNS` is code-owned trusted-base policy and includes:

```text
docs/architecture/convergence/REGISTRY.yaml
docs/architecture/convergence/UNIFIED_UI_CUTOVER.md
tools/ui_surface_lifecycle_guard.py
tests/test_ui_surface_lifecycle_guard.py
.claude/rules/factorylm-unified-ui-cutover.md
.claude/workflows/flm-ui-map.js
.claude/workflows/flm-ui-slice.js
.claude/workflows/flm-ui-verify.js
.github/workflows/ui-lifecycle-guard.yml
.github/pull_request_template.md
```

> **Hardening amendment (post-Task-2 adversarial review, four fail-closed
> fixes — see the retrofit commit before Task 3):**
> 1. **Public-static sibling bypass.** `mira-web/public/**` is served
>    statically — every file there is a candidate presentation surface, not
>    just the two originally-listed `mira-chat.js`/`.css`. `path_is_guarded()`
>    special-cases any path under `mira-web/public/` (code-owned, like
>    `CONTROL_PATTERNS` — not sourced from the registry) via a deterministic
>    classifier: passive asset suffixes (`.png .jpg .jpeg .webp .gif .avif
>    .ico .woff .woff2 .ttf .otf .pdf .map .json .txt`) are unguarded; exactly
>    `mira-web/public/sw.js` and `mira-web/public/posthog-init.js` are exempt
>    infrastructure; everything else — html/htm/css/js/mjs/svg, unknown
>    suffixes, extensionless names — is guarded. `REGISTRY.yaml`'s
>    `mira-web-legacy-ui` entry now lists `mira-web/public/**` for
>    documentation; the classifier, not the glob, is the actual enforcement.
> 2. **GitHub pull-files pagination truncation.** The `pulls/{n}/files`
>    endpoint silently stops paginating around 3000 entries. The workflow now
>    also fetches `pulls/{n}.changed_files` to a count file, and
>    `load_changed_files()` takes a keyword-only `expected_count` the CLI's new
>    required (with `--changes-json-file`) `--expected-change-count-file`
>    supplies. Fails closed on: malformed/negative count, count > `
>    MAX_EXPECTED_CHANGE_COUNT = 3000`, duplicate filename records, or any
>    parsed-record-count vs. expected-count mismatch.
> 3. **`--labels-file` only.** The CLI never had a working bare `--labels`
>    flag (that was this doc's prose, not the implementation) — every
>    reference below is corrected to `--labels-file`.
> 4. **`.github/pull_request_template.md` is a control pattern** (added to
>    `CONTROL_PATTERNS` above) — it documents the exact exception-section
>    shape the guard parses, so editing it is a control-plane change.

The exception parser strips fenced code blocks and HTML comments, requires
exactly one level-two `## Legacy UI exception` section, and requires
substantive same-line values after these exact labels:

```text
Reason:
Canonical replacement impact:
Rollback:
```

Reject case-insensitive `n/a`, `na`, `none`, `not applicable`, `tbd`, `todo`,
and angle-bracket placeholders. Use this public shape so local tests and the
trusted workflow call the same behavior:

```python
@dataclass(frozen=True)
class ChangedFile:
    status: str
    path: str
    previous_path: str | None = None


@dataclass(frozen=True)
class GuardResult:
    allowed: bool
    guarded_paths: tuple[str, ...]
    missing_fields: tuple[str, ...]
    message: str


def changed_files_between(
    root: Path, base: str, head: str
) -> tuple[ChangedFile, ...]:
    """Parse NUL-delimited name-status output without losing rename origins."""


def load_changed_files(
    path: Path, *, expected_count: int | None = None
) -> tuple[ChangedFile, ...]:
    """Parse normalized GitHub pull-files JSON-lines from a data-only file.
    Rejects duplicate filenames and, when expected_count is given (the PR's
    own `changed_files` field), a mismatched record count."""


def evaluate(
    changes: Iterable[ChangedFile],
    labels: AbstractSet[str],
    pr_body: str,
    policy: GuardPolicy,
) -> GuardResult:
    """Require an audited exception for any guarded or control-plane touch."""
```

For a rename, evaluate both `previous_path` and `path`. The CLI accepts
`--registry`, `--labels-file`, `--pr-body-file`, and exactly one source of
changes: either `--changes-json-file` (which additionally REQUIRES
`--expected-change-count-file` — the pagination-truncation defense above) or
the pair `--base`/`--head`. It prints GitHub error annotations for violations
and fails closed on policy, diff, input, or exception parsing errors. It
performs no network access and never reads a GitHub token.

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

### Task 3: Run the guard from trusted base and bind it to protected main

**Files:**
- Create: `.github/workflows/ui-lifecycle-guard.yml`
- Modify: `.github/pull_request_template.md`

**Interfaces:**
- Consumes: the guard and registry from the default-branch base revision plus
  live GitHub PR-file, label, and body metadata.
- Produces: a `Legacy UI Lifecycle Guard` commit status on the PR head SHA,
  later registered as a strict required `main` status check.

- [ ] **Step 1: Add the trusted-base workflow**

Use `pull_request_target` with explicit activity types `opened`, `reopened`,
`synchronize`, `edited`, `labeled`, `unlabeled`, and `ready_for_review`.
Grant only `contents: read`, `pull-requests: read`, and `statuses: write`.
Constrain concurrent runs by PR number.

The workflow must:

1. Post `pending` to the PR head SHA under the unique context
   `Legacy UI Lifecycle Guard`.
2. Check out `github.event.pull_request.base.sha` only, with
   `persist-credentials: false`. Never check out the head or merge ref.
3. Install `pyyaml` and `pytest`, then run the trusted-base guard tests.
4. In a metadata-only step carrying `GH_TOKEN`, fetch all changed-file pages as
   JSON lines plus the current labels and body into `$RUNNER_TEMP`. Treat these
   values only as data; never interpolate them into executable script text.
5. In a separate step with no token, execute the checked-out base guard against
   those files.
6. In an `if: always()` trusted step, post `success` only when every prior step
   succeeded; otherwise post `failure` to the same head/context.

The metadata command shape is:

```bash
gh api "/repos/$GITHUB_REPOSITORY/pulls/$PR_NUMBER" --jq '.changed_files' \
  > "$RUNNER_TEMP/expected-change-count.txt"
gh api --paginate "/repos/$GITHUB_REPOSITORY/pulls/$PR_NUMBER/files?per_page=100" \
  --jq '.[] | {filename, status, previous_filename}' \
  > "$RUNNER_TEMP/changed-files.jsonl"
gh api "/repos/$GITHUB_REPOSITORY/pulls/$PR_NUMBER" --jq '.body // ""' \
  > "$RUNNER_TEMP/pr-body.md"
gh api "/repos/$GITHUB_REPOSITORY/issues/$PR_NUMBER/labels" --jq '.[].name' \
  > "$RUNNER_TEMP/labels.txt"
python tools/ui_surface_lifecycle_guard.py \
  --changes-json-file "$RUNNER_TEMP/changed-files.jsonl" \
  --expected-change-count-file "$RUNNER_TEMP/expected-change-count.txt" \
  --labels-file "$RUNNER_TEMP/labels.txt" \
  --pr-body-file "$RUNNER_TEMP/pr-body.md"
```

`expected-change-count.txt` is fetched from the PR OBJECT (`.changed_files`),
not the files endpoint — it is the count that endpoint cannot be trusted to
honor past ~3000 entries, which is exactly the failure mode the guard's
`--expected-change-count-file` requirement exists to catch (see the hardening
amendment above Step 3).

Do not pass `GH_TOKEN` to the Python step. Pin third-party actions according to
the repository's existing workflow convention and run `actionlint`.

- [ ] **Step 2: Add structural workflow tests**

Extend `tests/test_ui_surface_lifecycle_guard.py` to assert that the committed
workflow uses `pull_request_target`, lists every metadata-sensitive event,
checks out only `base.sha`, disables credential persistence, never references
`head.sha` in checkout, separates the token-bearing metadata step from the
Python step, publishes the exact status context, fetches `.changed_files` into
an expected-change-count file, passes `--expected-change-count-file` to the
guard CLI, and uses `--labels-file` (never a bare `--labels`). These tests
protect the trusted boundary from accidental drift; the base workflow remains
the runtime authority.

- [ ] **Step 3: Document the optional exception section**

Add exactly one three-field section from the charter to the PR template. Leave
values blank and explain requirements only in HTML comments. Never prefill
`N/A` or angle-bracket placeholders that could satisfy the parser.

- [ ] **Step 4: Validate workflow syntax and behavior**

Run:

```bash
python3 -m pytest tests/test_ui_surface_lifecycle_guard.py -q
docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:1.7.12 -color
git diff --check
```

Expected: tests and actionlint pass. This bootstrap PR cannot run a workflow
that does not yet exist on the default branch; local/adversarial proof covers
bootstrap, and the required status is enabled only after merge.

- [ ] **Step 5: Commit CI wiring**

```bash
git add .github/workflows/ui-lifecycle-guard.yml \
  .github/pull_request_template.md tests/test_ui_surface_lifecycle_guard.py
git commit -m "ci(ui): enforce legacy presentation freeze"
```

### Task 4: Add project-scoped Claude workflows

**Files:**
- Create: `.claude/workflows/flm-ui-map.js`
- Create: `.claude/workflows/flm-ui-slice.js`
- Create: `.claude/workflows/flm-ui-verify.js`

**Interfaces:**
- Consumes: structured `args`, issue #3626, charter, exact SHA, and work-claim contract.
- Produces: read-only mapping report; claim-gated one-writer implementation/report/review chain; read-only exact-SHA verdict.

- [ ] **Step 1: Use Claude Code workflow authoring guidance**

Run `/workflow-authoring` in Claude Code 2.1.248 or newer before editing. Each
file starts with a literal `export const meta = { name, description }`, uses no
imports, timestamps, randomness, direct filesystem access, or direct shell
access, and keeps intermediate results in variables.

- [ ] **Step 2: Implement `/flm-ui-map`**

Fan out read-only mapping agents across public, Hub, mobile, shared core, and
capability closure. A cross-check agent rejects invented paths/symbols; a final
agent emits proposed `[WORK-CLAIM]` drafts. Validate that `args` is present and includes
`mission`, `issue`, and a full 40-character `baseSha` before dispatch. Return
structured results; do not edit.

- [ ] **Step 3: Implement `/flm-ui-slice`**

Validate required arguments, run one read-only preflight agent, then one writer
agent. The writer creates/enters an isolated worktree at `baseSha`, touches only
`allowedPaths`, follows TDD, commits, pushes, and opens a draft PR without
merging. After it returns, fan out read-only contract, safety, and test
reviewers and synthesize their verdict for the exact head. Require the writer
to return structured JSON containing a full 40-character `headSha`; validate it
in the workflow before review dispatch and include that exact value in every
review and synthesis prompt.

Required arguments include `claimUrl`. Before the writer starts, the preflight
agent must reread open issues, pull requests, and `[WORK-CLAIM]` markers for the
slice under `.claude/rules/multi-session-protocol.md`. Require structured output
that identifies the supplied claim and returns `claimStatus: "WON"`; validate
that value and the requested `baseSha` in workflow code. `MISSING`, `LOST`,
`BLOCKED`, stale, malformed, or unverifiable claims stop execution.

- [ ] **Step 4: Implement `/flm-ui-verify`**

Fan out read-only reviewers for interaction parity, safety/identity/evidence,
tenant authorization, mobile/accessibility, transport honesty, performance/
licenses, and rollback. Synthesize `GREEN`, `PARTIAL`, or `BLOCKED`, naming the
exact SHA and every unverified claim. Validate that `args` is present and
includes `mission`, `issue`, and a full 40-character `headSha` before dispatch;
all reviewers receive that immutable SHA verbatim.

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
core task or active claim, and explicit no-production-change statement to
`wiki/hot.md`. At implementation time shared-shell Task 5 is ACTIVE under
Claude 5.1 on CHARLIE at issue #3626; do not duplicate it.

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

The owner authorization must be recorded in issue #3626 or the pull request so
it is available through GitHub alone. It may also be mirrored into the
originating Codex task, but private task state is not a merge prerequisite.
Merge serially and verify the resulting `main` SHA. Create the
`legacy-ui-exception` repository label if absent, add the unique
`Legacy UI Lifecycle Guard` context to the existing strict `main` required
status checks without removing any current contexts, and verify administrator
enforcement remains enabled. Update the governance claim on issue #3626 to
`COMPLETE`; leave the mission issue open while the active shared-core claim and
later adapter slices continue.
