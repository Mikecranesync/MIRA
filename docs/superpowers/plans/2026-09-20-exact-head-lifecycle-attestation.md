# Exact-Head Lifecycle Attestation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire the `legacy-ui-exception` label route completely and make a repository-owner Codex adversarial-review GREEN, bound to the current PR head and current PR-body digest, the sole attestation that can authorize a guarded legacy/control-plane change.

**Architecture:** Keep `pull_request_target` and trusted-base evaluation. The review producer hashes the normalized current PR body and stamps `reviewed_body_sha256` into the strict ledger envelope. The lifecycle guard independently hashes the current pull snapshot body and accepts only the newest well-formed owner-account `User` record whose head SHA, body digest, and status all match. The guard still requires a substantive `## Lifecycle guard rationale`; the removed label, actor-permission endpoint, label-event snapshot, and label-based fallback cannot influence the decision.

**Tech Stack:** Bash, Node.js ESM, Python 3.12, pytest, GitHub Actions YAML, GitHub CLI.

**Spec:** `docs/superpowers/specs/2026-09-20-exact-head-lifecycle-attestation-design.md`

## Global Constraints

- Work only in `/Users/charlienode/MIRA-worktrees/legacy-gate-codex-attest` on `feat/legacy-ui-gate-codex-attestation`.
- Start every task from a clean tree and record `git rev-parse HEAD`; stop if unrelated edits appear.
- Preserve trusted-base execution: the workflow must never check out or execute PR-head code and the evaluation job must remain tokenless.
- Preserve fail-closed behavior for missing, malformed, foreign, bot-authored, stale-head, stale-body, and `ISSUES_FOUND` ledger records.
- Preserve the existing review budget, reservation, exact-head, coverage, and remediation contracts.
- Do not add a replacement label, bypass flag, second manual route, deployment action, secret, environment mutation, migration, or device action.
- Do not merge or deploy #3919 while this prerequisite is incomplete. After #3847 integrates, refresh #3919 and repeat exact-head review and CI before merge-only consideration.
- Make production changes test-first. For each task, run the named RED command before implementation and preserve the failure output in the working notes.
- Commit each completed task with the conventional commit shown. Do not push the rebased branch until all local verification is green and the remote lease is rechecked.

---

### Task 1: Bind adversarial-review records to the PR-body snapshot

**Files:**

- Modify: `tests/test_adversarial_review_scripts.py`
- Modify: `scripts/adversarial-review-render.mjs`
- Modify: `scripts/adversarial-review-ledger.mjs`
- Modify: `scripts/adversarial-review.sh`

**Interfaces:**

- Ledger envelope adds the load-bearing line `reviewed_body_sha256: <64 lowercase hex>` immediately after `reviewed_sha`.
- Renderer adds required `--body-sha256 <64 lowercase hex>`.
- Ledger CLI adds optional `--body-sha256 <64 lowercase hex>` alongside `--sha`; dedupe at a current head is authoritative only when both values match.
- Pre-migration review records without a body digest continue to count toward iteration and the durable round budget, but they can never authorize, deduplicate, or report GREEN for an exact head/body query.
- Review runner reads `.body // ""` from the same `gh pr view` snapshot used for `headRefOid` and computes its UTF-8 SHA-256 without adding a newline.

- [ ] **Step 1: Add failing renderer and ledger tests.**

  Update `_record` to accept `body_sha256` and emit the new line. Add focused tests proving:

  ```python
  BODY_HASH_A = "1" * 64
  BODY_HASH_B = "2" * 64

  def test_green_at_same_head_with_old_body_hash_is_not_deduplicated(tmp_path):
      ledger = run_ledger(
          tmp_path,
          [_record(SHA_A, "GREEN", 1, body_sha256=BODY_HASH_A)],
          sha=SHA_A,
          body_sha256=BODY_HASH_B,
      )
      assert ledger["already"] == 0
      assert ledger["prior_status"] == "STALE_BODY"

  def test_renderer_requires_and_stamps_body_sha256(tmp_path):
      envelope = tmp_path / "envelope.json"
      envelope.write_text(json.dumps(GREEN_ENVELOPE), encoding="utf-8")
      base = [
          NODE,
          str(SCRIPTS / "adversarial-review-render.mjs"),
          str(envelope),
          "--sha", SHA_A,
          "--base", SHA_B,
          "--iteration", "1",
      ]
      missing = subprocess.run(base, capture_output=True, text=True)
      assert missing.returncode == 3
      rendered = subprocess.run(
          [*base, "--body-sha256", BODY_HASH_A],
          capture_output=True,
          text=True,
          check=True,
      )
      assert f"reviewed_body_sha256: {BODY_HASH_A}" in rendered.stdout

  def test_legacy_records_still_consume_budget_but_never_authorize(tmp_path):
      legacy = _legacy_record_without_body_hash(SHA_A, "GREEN", 3)
      ledger = run_ledger(
          tmp_path,
          [legacy],
          sha=SHA_A,
          body_sha256=BODY_HASH_A,
      )
      assert ledger["consumed"] == 1
      assert ledger["next_iteration"] == 4
      assert ledger["already"] == 0
      assert ledger["prior_status"] == "STALE_BODY"
  ```

  Extend the `Harness` PR fixture with a `body` value and assert a successful review posts the digest of that exact string.

- [ ] **Step 2: Run the focused tests and confirm RED.**

  Run:

  ```bash
  pytest tests/test_adversarial_review_scripts.py -q -k 'body_sha256 or old_body_hash or stable_head_is_green'
  ```

  Expected: failures because the helpers/renderer/ledger do not yet accept or emit `reviewed_body_sha256` and the runner does not request the PR body.

- [ ] **Step 3: Implement the strict envelope and parser.**

  In `adversarial-review-render.mjs`, validate the new argument and render:

  ```javascript
  const bodySha256 = arg("--body-sha256");
  if (!/^[0-9a-f]{64}$/.test(bodySha256 ?? "")) {
    fail("--body-sha256 must be 64 lowercase hex chars");
  }
  // ...
  lines.push(`reviewed_sha: ${sha}`);
  lines.push(`reviewed_body_sha256: ${bodySha256}`);
  lines.push(`base_sha: ${baseSha}`);
  ```

  In `adversarial-review-ledger.mjs`, retain a strict legacy parser for budget/iteration compatibility and add a strict v2 parser that captures the digest. Parse `--body-sha256` and match dedupe on `(sha, bodySha256)` using v2 records only. Feed both legacy and v2 records into existing iteration/budget accounting; a body edit or format migration invalidates authorization but never refunds a consumed round.

- [ ] **Step 4: Make the runner compute and propagate the body digest.**

  Request `body` in the existing PR JSON:

  ```bash
  PR_JSON="$(gh pr view "$PR_NUMBER" --json number,title,body,baseRefName,headRefOid,headRefName)"
  PR_BODY_SHA256="$(printf '%s' "$PR_JSON" | node -e '
    const crypto=require("node:crypto");
    let d="";
    process.stdin.on("data",c=>d+=c).on("end",()=>{
      const body=JSON.parse(d).body ?? "";
      process.stdout.write(crypto.createHash("sha256").update(body,"utf8").digest("hex"));
    });')"
  ```

  Pass `--body-sha256 "$PR_BODY_SHA256"` to both ledger reads and `RENDER_ARGS`. Extend `final_green_gate` to re-read `headRefOid,body`, recompute both values, and exit 4 if either changed. This closes the race where the PR body changes while Codex is reviewing.

- [ ] **Step 5: Run the task suite GREEN.**

  Run:

  ```bash
  pytest tests/test_adversarial_review_scripts.py -q
  ```

  Expected: all adversarial-review behavior locks pass, including existing budget/reservation/head-movement cases and the new body-snapshot cases.

- [ ] **Step 6: Commit.**

  ```bash
  git add tests/test_adversarial_review_scripts.py scripts/adversarial-review-render.mjs scripts/adversarial-review-ledger.mjs scripts/adversarial-review.sh
  git commit -m "feat(review): bind adversarial verdicts to PR body"
  ```

---

### Task 2: Make the exact-head/body ledger the guard's sole authorization route

**Files:**

- Modify: `tests/test_ui_surface_lifecycle_guard.py`
- Modify: `tools/ui_surface_lifecycle_guard.py`

**Interfaces:**

- Rename the required PR section to `## Lifecycle guard rationale` while retaining `Reason:`, `Canonical replacement impact:`, and `Rollback:`.
- `CodexAttestation` adds `reviewed_body_sha256` and validates it against `sha256((current.body or "").encode("utf-8"))`.
- Remove `ExceptionApproval`, `load_exception_approval`, `_LEGACY_LABEL`, label/event/permission CLI arguments, and the label fallback in `evaluate`.
- Simplify `evaluate(changes, pr_body, policy, *, codex_attestation=None)` so a guarded touch requires both a substantive rationale and a valid attestation.

- [ ] **Step 1: Mechanically rename the section in fixtures, then add failing sole-route tests.**

  Rename existing parser/body fixtures from `## Legacy UI exception` to `## Lifecycle guard rationale` so the mature Markdown/parser security suite continues to exercise the same cases. Replace label-route tests with explicit rejection tests:

  ```python
  def test_legacy_label_text_cannot_authorize_a_guarded_touch():
      result = evaluate(_TOUCH, pr_body=_VALID_BODY, policy=_POLICY, codex_attestation=None)
      assert result.allowed is False
      assert "exact-head and exact-body Codex GREEN" in result.message

  def test_codex_green_for_same_head_but_old_body_is_stale(tmp_path):
      old_body = _VALID_BODY.replace("rollback route", "old rollback route")
      comments_path, pull_path = _write_codex_ledger(
          tmp_path,
          [_owner_comment(1, _ledger_comment(_HEAD_A, "GREEN", body=old_body))],
          body=_VALID_BODY,
      )
      attestation = load_codex_attestation(comments_path, pull_path)
      assert attestation.valid is False
      assert attestation.reason.startswith("review body stale")
  ```

  Retain/add coverage for current head + current body GREEN, stale head, newer `ISSUES_FOUND`, newer GREEN after issues, foreign account, bot account, malformed envelope, malformed JSONL, empty ledger, missing current body, and null body normalized to `""`.

- [ ] **Step 2: Add a repository-wide contract test that the obsolete route is absent from active policy files.**

  Add a parametrized test over the production guard/workflow/template/governing-doc set asserting `legacy-ui-exception` is absent. Historical plans/reviews and unrelated product documents are not executable policy and are out of this assertion.

- [ ] **Step 3: Run the focused guard tests and confirm RED.**

  Run:

  ```bash
  PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python3 -I -m pytest -c /dev/null --noconftest --import-mode=importlib --rootdir=. -p no:cacheprovider tests/test_ui_surface_lifecycle_guard.py -q -k 'codex or ledger or label or body or rationale'
  ```

  Expected: stale-body GREEN is accepted, label-only compatibility remains, and active files still contain the obsolete label name.

- [ ] **Step 4: Implement body-digest attestation and remove label authorization.**

  Use `hashlib.sha256` over the current pull snapshot body, failing closed if `body` is neither string nor null. Make the strict ledger regex include the new digest line. The decision shape should be:

  ```python
  body_missing = _rationale_missing_fields(pr_body)
  review_valid = codex_attestation is not None and codex_attestation.valid
  if not body_missing and review_valid:
      return GuardResult(True, tuple(touched), (), "INDEPENDENT REVIEW: ...")

  missing = list(body_missing)
  if not review_valid:
      missing.append("review:exact-head and exact-body Codex GREEN")
  return GuardResult(False, tuple(touched), tuple(missing), diagnostic)
  ```

  Remove the obsolete CLI surface rather than silently ignoring it. Supplying `--labels-file`, `--event-json-file`, or `--approver-permission-json-file` must be an argparse usage error.

- [ ] **Step 5: Run the complete isolated guard suite GREEN.**

  Run:

  ```bash
  PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python3 -I -m pytest -c /dev/null --noconftest --import-mode=importlib --rootdir=. -p no:cacheprovider tests/test_ui_surface_lifecycle_guard.py -q
  ```

  Expected: all parser, path-classification, tree-evidence, workflow-contract, and ledger tests pass with the sole-route contract.

- [ ] **Step 6: Commit.**

  ```bash
  git add tests/test_ui_surface_lifecycle_guard.py tools/ui_surface_lifecycle_guard.py
  git commit -m "refactor(ui-guard): remove legacy label authorization"
  ```

---

### Task 3: Remove label/permission plumbing from the trusted workflow

**Files:**

- Modify: `.github/workflows/ui-lifecycle-guard.yml`
- Modify: `tests/test_ui_surface_lifecycle_guard.py`

**Interfaces:**

- Keep triggers: `opened`, `reopened`, `synchronize`, `edited`, `ready_for_review`.
- Remove triggers: `labeled`, `unlabeled`.
- The metadata step still fetches the current pull snapshot, changed-file count/list, immutable comparison/tree evidence, and PR body.
- Delete label extraction, `APPROVER_LOGIN`, collaborator-permission API calls, and the three removed guard CLI flags.
- Final status text names only the exact-head/exact-body ledger GREEN plus substantive rationale.

- [ ] **Step 1: Add/replace workflow contract tests and confirm RED.**

  Add assertions that the workflow:

  ```python
  assert "labeled" not in event_types
  assert "unlabeled" not in event_types
  assert "/collaborators/" not in workflow_text
  assert "approver-permission.json" not in workflow_text
  assert "labels.txt" not in workflow_text
  assert "--event-json-file" not in eval_step["run"]
  assert "--labels-file" not in eval_step["run"]
  assert "--approver-permission-json-file" not in eval_step["run"]
  ```

  Run the affected workflow tests and observe failure against the old plumbing.

- [ ] **Step 2: Simplify the workflow without weakening its trust boundary.**

  Update the header comments and metadata step. Keep the ledger fetch before checkout, `persist-credentials: false`, per-job permissions, base-ref assertion, isolated Python invocation, and separate final-status job unchanged.

- [ ] **Step 3: Run the complete isolated guard suite GREEN.**

  ```bash
  PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python3 -I -m pytest -c /dev/null --noconftest --import-mode=importlib --rootdir=. -p no:cacheprovider tests/test_ui_surface_lifecycle_guard.py -q
  ```

- [ ] **Step 4: Commit.**

  ```bash
  git add .github/workflows/ui-lifecycle-guard.yml tests/test_ui_surface_lifecycle_guard.py
  git commit -m "ci(ui-guard): retire legacy label plumbing"
  ```

---

### Task 4: Align the reviewer contract, PR template, and governing documentation

**Files:**

- Modify: `scripts/adversarial-review-prompt.md`
- Modify: `.github/pull_request_template.md`
- Modify: `.claude/rules/factorylm-unified-ui-cutover.md`
- Modify: `docs/adversarial-review-workflow.md`
- Modify: `docs/architecture/convergence/UNIFIED_UI_CUTOVER.md`
- Modify: `tests/test_ui_surface_lifecycle_guard.py`

**Interfaces:**

- New/expanded frozen legacy presentation remains a reviewer `BLOCKER` and therefore can never produce GREEN.
- A change to the guard/control plane is not categorically a blocker; it is reviewable, must be covered by exact-head/body GREEN, and must preserve fail-closed/trusted-base guarantees.
- Template and governing docs use `## Lifecycle guard rationale` and describe one attestation route only.

- [ ] **Step 1: Tighten contract tests before editing prose.**

  Extend the prompt/template/doc tests to require `reviewed_body_sha256`, `## Lifecycle guard rationale`, and sole-route wording; forbid `legacy-ui-exception`, maintainer-label authorization, and the old statement that every control-plane edit is automatically a BLOCKER.

- [ ] **Step 2: Run focused documentation-contract tests and confirm RED.**

  ```bash
  PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python3 -I -m pytest -c /dev/null --noconftest --import-mode=importlib --rootdir=. -p no:cacheprovider tests/test_ui_surface_lifecycle_guard.py -q -k 'prompt or template or charter or documentation or obsolete'
  ```

- [ ] **Step 3: Update the active governance documents.**

  State the authorization formula explicitly:

  ```text
  guarded path touched
    AND substantive Lifecycle guard rationale
    AND newest valid owner-account ledger record matches current head SHA
    AND reviewed_body_sha256 matches SHA-256(current PR body)
    AND status is GREEN
  ```

  Explain that any push or body edit requires a fresh review. Do not rewrite historical incident records or archived plans; they may accurately describe the retired mechanism in historical context.

- [ ] **Step 4: Run tests and an active-policy residue scan.**

  ```bash
  PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python3 -I -m pytest -c /dev/null --noconftest --import-mode=importlib --rootdir=. -p no:cacheprovider tests/test_ui_surface_lifecycle_guard.py -q
  rg -n 'legacy-ui-exception|## Legacy UI exception' \
    .github/pull_request_template.md .github/workflows/ui-lifecycle-guard.yml \
    .claude/rules/factorylm-unified-ui-cutover.md \
    docs/adversarial-review-workflow.md \
    docs/architecture/convergence/UNIFIED_UI_CUTOVER.md \
    scripts/adversarial-review-prompt.md tools/ui_surface_lifecycle_guard.py
  ```

  Expected: pytest passes; `rg` exits 1 with no matches.

- [ ] **Step 5: Commit.**

  ```bash
  git add scripts/adversarial-review-prompt.md .github/pull_request_template.md \
    .claude/rules/factorylm-unified-ui-cutover.md docs/adversarial-review-workflow.md \
    docs/architecture/convergence/UNIFIED_UI_CUTOVER.md tests/test_ui_surface_lifecycle_guard.py
  git commit -m "docs(ui-guard): make review ledger the sole attestation"
  ```

---

### Task 5: Verify the complete change and publish a new exact head for #3847

**Files:**

- Verify: all files changed in Tasks 1–4
- Modify remotely: PR #3847 body and branch head only after local proof

- [ ] **Step 1: Run the complete local verification matrix.**

  ```bash
  pytest tests/test_adversarial_review_scripts.py -q
  PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python3 -I -m pytest -c /dev/null --noconftest --import-mode=importlib --rootdir=. -p no:cacheprovider tests/test_ui_surface_lifecycle_guard.py -q
  bash -n scripts/adversarial-review.sh scripts/adversarial-review-loop.sh
  shellcheck scripts/adversarial-review.sh scripts/adversarial-review-loop.sh
  npx --yes actionlint .github/workflows/ui-lifecycle-guard.yml
  python3 -m ruff check tools/ui_surface_lifecycle_guard.py tests/test_ui_surface_lifecycle_guard.py tests/test_adversarial_review_scripts.py
  git diff --check origin/main...HEAD
  ```

  If `actionlint` is unavailable, use the repository's existing actionlint invocation; do not silently omit the check. Record exact versions/output in the PR test plan.

- [ ] **Step 2: Self-review the entire rebased diff.**

  ```bash
  git diff --stat origin/main...HEAD
  git diff --check origin/main...HEAD
  git diff origin/main...HEAD -- \
    scripts/adversarial-review.sh scripts/adversarial-review-render.mjs \
    scripts/adversarial-review-ledger.mjs tools/ui_surface_lifecycle_guard.py \
    .github/workflows/ui-lifecycle-guard.yml
  ```

  Confirm every newly referenced option, field, and function exists and every removed option has no active call site.

- [ ] **Step 3: Prepare #3847 body for the new contract.**

  Fetch the current remote body, preserve unrelated content, replace the old section with one substantive `## Lifecycle guard rationale`, and list the exact verification commands/results. Do not put memory citations, secrets, or deployment language in the PR.

- [ ] **Step 4: Recheck the remote lease and publish safely.**

  ```bash
  git fetch origin feat/legacy-ui-gate-codex-attestation main
  REMOTE_HEAD="$(git rev-parse refs/remotes/origin/feat/legacy-ui-gate-codex-attestation)"
  printf '%s\n' "$REMOTE_HEAD"
  git log --oneline HEAD..origin/main
  git status --short
  ```

  Stop if `origin/main` moved or the remote PR head is not the expected pre-rebase SHA. If both are stable, update the PR body and use an explicit lease tied to the observed remote SHA:

  ```bash
  git push --force-with-lease=refs/heads/feat/legacy-ui-gate-codex-attestation:"$REMOTE_HEAD" \
    origin HEAD:refs/heads/feat/legacy-ui-gate-codex-attestation
  ```

  Immediately verify `gh pr view 3847 --json headRefOid,body,isDraft,mergeStateStatus` matches the pushed head and intended body.

---

### Task 6: Obtain exact-head review and integrate #3847 without a label bypass

**Files:**

- No source edits unless review findings require a new TDD remediation commit.
- Remote evidence: PR #3847 comments/checks/statuses.

- [ ] **Step 1: Run the exact-head adversarial review.**

  From the clean PR worktree, run:

  ```bash
  bash scripts/adversarial-review.sh 3847
  ```

  Because #3847 changes the guard that reads the ledger, separately verify that the posted comment contains the current `reviewed_sha`, the digest of the current PR body, and `status: GREEN`. A FAIL gets one bounded TDD remediation round and a new exact-head review; never reinterpret FAIL as approval.

- [ ] **Step 2: Recheck CI and mergeability at the exact reviewed head.**

  ```bash
  gh pr view 3847 --json headRefOid,body,mergeable,mergeStateStatus,isDraft
  gh pr checks 3847
  ```

  Compare any red check with `origin/main` as required by repository policy. The old advisory Lifecycle Guard may remain red on this bootstrap PR because trusted base still contains the retired rule; document that exact bootstrap condition. Do not use or apply the obsolete label.

- [ ] **Step 3: Merge #3847 only when the reviewed head, required CI, and owner-approved bootstrap disposition all align.**

  Re-read the PR head/body and ledger immediately before merge. Merge with the repository's normal method; record the merge commit. No deployment is part of this task.

- [ ] **Step 4: Prove the new default-branch behavior live, then delete the repository label.**

  On a safe test PR or the next guarded PR, verify the trusted-base workflow accepts current head+body GREEN, rejects a body edit until re-review, and has no label event/permission lookup. Only after that proof, delete the `legacy-ui-exception` repository label through GitHub and record that irreversible governance cleanup on #3626 and #3847.

---

### Task 7: Refresh, re-review, and merge #3919—without deploying

**Files:**

- Modify as needed: PR #3919 branch/body only to resolve drift from #3847/main
- Remote evidence: PR #3919 review ledger, checks, merge result, #3626 update

- [ ] **Step 1: Refresh #3919 onto the post-#3847 main.**

  Verify its worktree/branch ownership first. Fetch main, rebase or rebuild from the new main without importing foreign work, and update its PR body to use `## Lifecycle guard rationale`. Re-run its existing contract tests for dirty-checkout fail-closed behavior and receipt/image identity.

- [ ] **Step 2: Publish the new #3919 head and obtain a fresh exact-head/body GREEN.**

  The prior PASS at `b24700ba99c4c9977635f64eb9ad81c8667d6400` is stale after any refresh or body edit. Run the adversarial review on the new head and verify the body digest matches the current PR body.

- [ ] **Step 3: Recheck CI/mergeability immediately before merge.**

  ```bash
  gh pr view 3919 --json headRefOid,body,mergeable,mergeStateStatus,isDraft
  gh pr checks 3919
  ```

  Require the new Lifecycle Guard plus all required checks to be green. Compare any failure against main and return to the user for disposition if it is pre-existing/unrelated.

- [ ] **Step 4: Merge #3919 and stop at the deployment boundary.**

  Merge only after exact-head/body review and CI are current. Do not dispatch staging or production, mutate credentials, run migrations, touch the Pixel, or claim deployed acceptance. Post the merge SHA and the remaining authorized-staging acceptance checklist to #3626, then hand control back for separate deploy authorization.
