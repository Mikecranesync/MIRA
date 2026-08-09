# PR 2881 Paid Authorization Trust Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make PR #2881 green without reopening the paid Together self-authorization hole.

**Architecture:** Public Together paid entry points must construct authorization verification internally from trusted operator configuration. Hermetic tests may replace that verifier only through a private module variable in `factorylm_ai.providers.paid_authorization_guard`, never through public `authorization_verifier=` kwargs. Signed receipts remain Ed25519 verified before ledger enrollment, and emitted verification evidence must not leak secret material or absolute local paths.

**Tech Stack:** Python 3.12, pytest, ruff, pyright, `cryptography` Ed25519, existing `factorylm_ai` paid authorization ledger and Together provider.

## Global Constraints

- No Together upload, fine-tune job, endpoint creation, endpoint benchmark, deployment, authorization consumption, or spend.
- Keep all network calls fake; tests continue to monkeypatch `together_module.httpx.AsyncClient`.
- Do not add cloud providers, LangChain, TensorFlow, n8n, or an LLM-call abstraction framework.
- Preserve signed registry receipt verification, request-hash binding, spend-cap binding, revocation, atomic single-use consumption, and fail-closed behavior.
- Do not widen the current pytest-only ledger bypass. Replace it with a private monkeypatchable factory.
- Use `/opt/homebrew/bin/python3.12` locally; plain `python3` on this Mac is 3.9 and cannot run this package.
- Worktree: `/Users/charlienode/Documents/Codex/worktrees/mira-pr2881-paid-gate`.

---

## Current Failure Summary

PR #2881 currently fails `Unit Tests`, `Eval Offline`, and therefore `CI Gate`.

The shared failure is:

```text
PaidAuthorizationRejected: caller-supplied paid-authorization verifiers are forbidden; the Together provider owns trusted verifier construction
```

Affected tests from GitHub Actions:

```text
tests/factorylm_ai/test_finetune_orchestration.py::test_create_finetune_job_requires_paid_authorization_before_http
tests/factorylm_ai/test_finetune_orchestration.py::test_create_finetune_job_blocks_when_trusted_verifier_unavailable_before_http
tests/factorylm_ai/test_finetune_orchestration.py::test_create_finetune_job_blocks_when_trusted_ledger_unreadable_before_http
tests/factorylm_ai/test_finetune_orchestration.py::test_temporary_endpoint_requires_paid_authorization_before_http
```

Local Python 3.12 also exposes a Mac-only evidence bug:

```text
tests/factorylm_ai/test_paid_authorization_trust_boundary.py::test_signed_receipt_is_request_bound_and_single_use
assert "private" not in json.dumps(state.to_dict()).lower()
```

The failure is caused by `ledger_ref` containing `/private/var/...`, not by private key leakage. The correct repair is to avoid absolute filesystem paths in emitted authorization evidence.

## File Structure

- Modify: `factorylm_ai/providers/paid_authorization_guard.py`
  - Owns the trusted verifier construction boundary.
  - Add a private monkeypatchable verifier factory.
  - Remove the generic pytest-only ledger compatibility path.

- Modify: `factorylm_ai/finetune.py`
  - Owns the append-only authorization ledger and `PaidAuthorizationVerificationState`.
  - Redact or stabilize `ledger_ref` so emitted evidence never includes an absolute path.

- Modify: `tests/factorylm_ai/test_finetune_orchestration.py`
  - Replace public `authorization_verifier=` kwargs with private factory monkeypatching.
  - Keep fake HTTP client tests and fail-closed assertions.

- Modify: `tests/factorylm_ai/test_paid_authorization_trust_boundary.py`
  - Keep adversarial public kwarg tests.
  - Keep signed receipt tests.
  - Add or adjust assertion for path-safe `ledger_ref`.

- Modify: `docs/zta/together-governed-cloud-exception.md`
  - Document that verification evidence exposes a safe ledger reference, not a filesystem path.

- Modify: `docs/CHANGELOG.d/3.211.2-paid-together-authorization.md`
  - Add a short line for the test seam and safe evidence reference.

---

### Task 1: Replace Public Test Verifier Injection With a Private Factory

**Files:**
- Modify: `factorylm_ai/providers/paid_authorization_guard.py:11-258`
- Test: `tests/factorylm_ai/test_paid_authorization_trust_boundary.py`

**Interfaces:**
- Consumes: `TrustedPaidAuthorizationVerifier.from_environment()`
- Produces: private `_trusted_verifier_factory: Callable[[], PaidAuthorizationVerifier]`
- Produces: `_RuntimeVerifier.verify_and_consume(...)` calls `_trusted_verifier_factory().verify_and_consume(...)`
- Removes: `_legacy_pytest_ledger(...)`

- [ ] **Step 1: Write the failing boundary expectation**

Confirm the existing adversarial tests stay as-is:

```python
with pytest.raises(PaidAuthorizationRejected, match="caller-supplied"):
    await together_module.create_finetune_job(
        "file-train",
        "Qwen/Qwen3.5-9B",
        suffix="fixture",
        budget=BudgetGuard(cap_usd=5.0),
        est_training_tokens=1,
        authorization_verifier=cast(Any, _FakeVerifier()),
    )
```

And:

```python
with pytest.raises(PaidAuthorizationRejected, match="caller-supplied"):
    await together_module.run_temporary_endpoint_benchmark(
        {"model": "fixture", "inactive_timeout": 60},
        benchmark,
        budget=BudgetGuard(cap_usd=5.0),
        est_endpoint_usd=1.0,
        authorization_verifier=cast(Any, _FakeVerifier()),
    )
```

- [ ] **Step 2: Run the boundary tests before editing**

Run:

```bash
/opt/homebrew/bin/python3.12 -m pytest tests/factorylm_ai/test_paid_authorization_trust_boundary.py -q
```

Expected before Task 2:

```text
1 failed, 8 passed
```

The only local failure should be the Mac `/private/...` `ledger_ref` assertion.

- [ ] **Step 3: Edit `paid_authorization_guard.py` imports**

Change:

```python
from typing import Any, cast
```

To:

```python
from collections.abc import Callable
from typing import Any
```

- [ ] **Step 4: Add the private verifier factory**

Insert after `TrustedPaidAuthorizationVerifier`:

```python
TrustedVerifierFactory = Callable[[], PaidAuthorizationVerifier]


def _default_trusted_verifier_factory() -> PaidAuthorizationVerifier:
    return TrustedPaidAuthorizationVerifier.from_environment()


_trusted_verifier_factory: TrustedVerifierFactory = _default_trusted_verifier_factory
```

Also add `PaidAuthorizationVerifier` to the import from `factorylm_ai.finetune`:

```python
from factorylm_ai.finetune import (
    PaidAuthorizationLedger,
    PaidAuthorizationRejected,
    PaidAuthorizationUnavailable,
    PaidAuthorizationVerificationState,
    PaidAuthorizationVerifier,
    PaidEventAuthorization,
)
```

- [ ] **Step 5: Update `_RuntimeVerifier`**

Replace:

```python
return TrustedPaidAuthorizationVerifier.from_environment().verify_and_consume(
    authorization, **kwargs
)
```

With:

```python
return _trusted_verifier_factory().verify_and_consume(authorization, **kwargs)
```

- [ ] **Step 6: Remove the legacy pytest bypass**

Delete `_legacy_pytest_ledger(...)` entirely.

Replace `_select_verifier(...)` with:

```python
def _select_verifier(supplied: object | None) -> PaidAuthorizationVerifier:
    if supplied is None:
        return _RuntimeVerifier()
    raise PaidAuthorizationRejected(
        "caller-supplied paid-authorization verifiers are forbidden; "
        "the Together provider owns trusted verifier construction"
    )
```

- [ ] **Step 7: Run the adversarial public API tests**

Run:

```bash
/opt/homebrew/bin/python3.12 -m pytest \
  tests/factorylm_ai/test_paid_authorization_trust_boundary.py::test_create_finetune_rejects_caller_injected_verifier \
  tests/factorylm_ai/test_paid_authorization_trust_boundary.py::test_endpoint_benchmark_rejects_caller_injected_verifier \
  -q
```

Expected:

```text
2 passed
```

---

### Task 2: Stop Emitting Absolute Ledger Paths

**Files:**
- Modify: `factorylm_ai/finetune.py:366-390, 542-553`
- Test: `tests/factorylm_ai/test_paid_authorization_trust_boundary.py:184-199`

**Interfaces:**
- Consumes: `PaidAuthorizationLedger.path`
- Produces: `PaidAuthorizationVerificationState.ledger_ref` as a safe logical reference.

- [ ] **Step 1: Add a safe ledger reference helper**

Insert above `PaidAuthorizationVerificationState`:

```python
def _safe_ledger_ref(path: Path) -> str:
    name = path.name or "paid-authorizations.jsonl"
    return f"paid-authorization-ledger:{name}"
```

- [ ] **Step 2: Use the safe reference in consumption evidence**

Change:

```python
ledger_ref=str(self.path),
```

To:

```python
ledger_ref=_safe_ledger_ref(self.path),
```

- [ ] **Step 3: Strengthen the test assertion**

In `test_signed_receipt_is_request_bound_and_single_use`, after:

```python
assert "signature" not in json.dumps(state.to_dict()).lower()
```

Use:

```python
state_json = json.dumps(state.to_dict()).lower()
assert "signature" not in state_json
assert "private_key" not in state_json
assert str(tmp_path).lower() not in state_json
assert state.ledger_ref == "paid-authorization-ledger:paid-authorizations.jsonl"
```

Remove the broad assertion:

```python
assert "private" not in json.dumps(state.to_dict()).lower()
```

- [ ] **Step 4: Run the signed receipt test**

Run:

```bash
/opt/homebrew/bin/python3.12 -m pytest \
  tests/factorylm_ai/test_paid_authorization_trust_boundary.py::test_signed_receipt_is_request_bound_and_single_use \
  -q
```

Expected:

```text
1 passed
```

---

### Task 3: Move Orchestration Tests Onto the Private Factory

**Files:**
- Modify: `tests/factorylm_ai/test_finetune_orchestration.py`
- Test: `tests/factorylm_ai/test_finetune_orchestration.py`

**Interfaces:**
- Consumes: `paid_authorization_guard._trusted_verifier_factory`
- Produces: `_install_test_verifier(monkeypatch, verifier)` helper.

- [ ] **Step 1: Add the private guard module import**

Add near the existing Together import:

```python
from factorylm_ai.providers import paid_authorization_guard as paid_guard_module
```

- [ ] **Step 2: Add a helper for trusted test verification**

Insert after `_trusted_ledger(...)`:

```python
def _install_test_verifier(
    monkeypatch: pytest.MonkeyPatch,
    verifier: PaidAuthorizationLedger,
) -> None:
    monkeypatch.setattr(paid_guard_module, "_trusted_verifier_factory", lambda: verifier)
```

- [ ] **Step 3: Update successful fine-tune calls**

For every test that currently does this:

```python
ledger = _trusted_ledger(tmp_path, auth)

job = await together_module.create_finetune_job(
    "file-train",
    "Qwen/Qwen3.5-9B",
    suffix="technician-v0",
    budget=guard,
    est_training_tokens=500_000,
    dataset_manifest_hash="manifest-abc",
    approval_evidence=_approval(
        authorization=auth,
        request_hash=request.request_hash,
        together_estimate=_together_estimate(request_hash=request.request_hash),
    ),
    authorization_verifier=ledger,
)
```

Change to:

```python
ledger = _trusted_ledger(tmp_path, auth)
_install_test_verifier(monkeypatch, ledger)

job = await together_module.create_finetune_job(
    "file-train",
    "Qwen/Qwen3.5-9B",
    suffix="technician-v0",
    budget=guard,
    est_training_tokens=500_000,
    dataset_manifest_hash="manifest-abc",
    approval_evidence=_approval(
        authorization=auth,
        request_hash=request.request_hash,
        together_estimate=_together_estimate(request_hash=request.request_hash),
    ),
)
```

Apply the same pattern to all `create_finetune_job(...)` calls in this file that currently pass `authorization_verifier=ledger`.

- [ ] **Step 4: Update the no-approval tests**

Change:

```python
await together_module.create_finetune_job(
    "file-train",
    "Qwen/Qwen3.5-9B",
    suffix="technician-v0",
    budget=guard,
    est_training_tokens=500_000,
    dataset_manifest_hash="manifest-abc",
    approval_evidence=None,
    authorization_verifier=PaidAuthorizationLedger(path=Path("missing.jsonl")),
)
```

To:

```python
await together_module.create_finetune_job(
    "file-train",
    "Qwen/Qwen3.5-9B",
    suffix="technician-v0",
    budget=guard,
    est_training_tokens=500_000,
    dataset_manifest_hash="manifest-abc",
    approval_evidence=None,
)
```

Change:

```python
await together_module.run_temporary_endpoint_benchmark(
    _endpoint_payload(),
    benchmark,
    budget=BudgetGuard(cap_usd=3.0),
    est_endpoint_usd=2.0,
    poll_interval_seconds=0,
    dataset_manifest_hash="manifest-abc",
    approval_evidence=None,
    authorization_verifier=PaidAuthorizationLedger(path=Path("missing.jsonl")),
)
```

To:

```python
await together_module.run_temporary_endpoint_benchmark(
    _endpoint_payload(),
    benchmark,
    budget=BudgetGuard(cap_usd=3.0),
    est_endpoint_usd=2.0,
    poll_interval_seconds=0,
    dataset_manifest_hash="manifest-abc",
    approval_evidence=None,
)
```

- [ ] **Step 5: Update unavailable verifier tests**

For:

```python
verifier = PaidAuthorizationLedger(path=tmp_path / "missing-parent" / "ledger.jsonl")
```

Add:

```python
_install_test_verifier(monkeypatch, verifier)
```

Then remove `authorization_verifier=verifier` from the call.

For:

```python
verifier = PaidAuthorizationLedger(path=tmp_path)
```

Add:

```python
_install_test_verifier(monkeypatch, verifier)
```

Then remove `authorization_verifier=verifier` from the call.

- [ ] **Step 6: Update temporary endpoint tests**

For every `run_temporary_endpoint_benchmark(...)` call that currently passes a ledger:

```python
auth, ledger = _endpoint_auth(tmp_path, payload)
```

Add:

```python
_install_test_verifier(monkeypatch, ledger)
```

Then remove:

```python
authorization_verifier=ledger,
```

In `test_endpoint_delete_204_and_404_are_successful`, install the correct ledger before each separate endpoint run:

```python
auth_204, ledger_204 = _endpoint_auth(tmp_path / "case204", payload_204)
_install_test_verifier(monkeypatch, ledger_204)
```

And later:

```python
ledger_404 = _trusted_ledger(tmp_path / "case404", auth_404)
_install_test_verifier(monkeypatch, ledger_404)
```

- [ ] **Step 7: Ensure no production call sites expose the verifier kwarg**

Run:

```bash
rg -n "authorization_verifier=" tests/factorylm_ai/test_finetune_orchestration.py factorylm_ai/providers
```

Expected remaining hits:

```text
tests/factorylm_ai/test_paid_authorization_trust_boundary.py:... authorization_verifier=cast(Any, _FakeVerifier())
```

No `authorization_verifier=` hits should remain in `tests/factorylm_ai/test_finetune_orchestration.py`.

- [ ] **Step 8: Run the previously failing four tests**

Run:

```bash
/opt/homebrew/bin/python3.12 -m pytest \
  tests/factorylm_ai/test_finetune_orchestration.py::test_create_finetune_job_requires_paid_authorization_before_http \
  tests/factorylm_ai/test_finetune_orchestration.py::test_create_finetune_job_blocks_when_trusted_verifier_unavailable_before_http \
  tests/factorylm_ai/test_finetune_orchestration.py::test_create_finetune_job_blocks_when_trusted_ledger_unreadable_before_http \
  tests/factorylm_ai/test_finetune_orchestration.py::test_temporary_endpoint_requires_paid_authorization_before_http \
  -q
```

Expected:

```text
4 passed
```

---

### Task 4: Update Docs and Changelog

**Files:**
- Modify: `docs/zta/together-governed-cloud-exception.md`
- Modify: `docs/CHANGELOG.d/3.211.2-paid-together-authorization.md`

**Interfaces:**
- Consumes: implementation from Tasks 1-3.
- Produces: review-visible doctrine that explains the private test seam and safe evidence.

- [ ] **Step 1: Update the authorization boundary doc**

In `docs/zta/together-governed-cloud-exception.md`, append to the `Authorization Boundary` list:

```markdown
- emitted verification state exposes only a logical ledger reference, never a
  local filesystem path, API key, private signing key, signature, or bearer token.
```

Add this paragraph after the list:

```markdown
Hermetic tests may monkeypatch the private verifier factory inside
`factorylm_ai.providers.paid_authorization_guard`; production and public callers
must not pass verifier objects into Together paid entry points.
```

- [ ] **Step 2: Update changelog fragment**

Append to `docs/CHANGELOG.d/3.211.2-paid-together-authorization.md`:

```markdown
- Hardened the paid Together test seam: public callers can no longer inject verifier
  objects, while hermetic tests use a private factory hook and emitted authorization
  state avoids absolute local ledger paths.
```

- [ ] **Step 3: Run docs diff check**

Run:

```bash
git diff --check docs/zta/together-governed-cloud-exception.md docs/CHANGELOG.d/3.211.2-paid-together-authorization.md
```

Expected:

```text
```

No output.

---

### Task 5: Verification Ladder

**Files:**
- Test-only task.

**Interfaces:**
- Consumes: all implementation tasks.
- Produces: local evidence for PR #2881 update.

- [ ] **Step 1: Run targeted trust-boundary tests**

Run:

```bash
/opt/homebrew/bin/python3.12 -m pytest tests/factorylm_ai/test_paid_authorization_trust_boundary.py -q
```

Expected:

```text
9 passed
```

- [ ] **Step 2: Run full FactoryLM AI tests**

Run:

```bash
/opt/homebrew/bin/python3.12 -m pytest tests/factorylm_ai -q
```

Expected:

```text
All tests pass
```

The previous CI baseline was `528 passed` for the focused FactoryLM AI job after the latest PR commits, minus the four failing tests. Accept a different count only if collection output shows added/removed tests from this branch.

- [ ] **Step 3: Run Ruff**

Run:

```bash
/opt/homebrew/bin/python3.12 -m ruff check factorylm_ai tests/factorylm_ai
/opt/homebrew/bin/python3.12 -m ruff format --check factorylm_ai tests/factorylm_ai
```

Expected:

```text
All checks passed!
```

And:

```text
files already formatted
```

- [ ] **Step 4: Run Pyright on touched Python files**

Run:

```bash
/opt/homebrew/bin/python3.12 -m pyright \
  factorylm_ai/finetune.py \
  factorylm_ai/providers/paid_authorization_guard.py \
  factorylm_ai/providers/together.py \
  tests/factorylm_ai/test_finetune_orchestration.py \
  tests/factorylm_ai/test_paid_authorization_trust_boundary.py
```

Expected:

```text
0 errors
```

- [ ] **Step 5: Run whitespace check**

Run:

```bash
git diff --check
```

Expected:

```text
```

No output.

- [ ] **Step 6: Inspect public signature and kwarg residue**

Run:

```bash
/opt/homebrew/bin/python3.12 - <<'PY'
import inspect
from factorylm_ai.providers import together

for fn in (together.create_finetune_job, together.run_temporary_endpoint_benchmark):
    params = inspect.signature(fn).parameters
    print(fn.__name__, "authorization_verifier" in params)
PY
```

Expected:

```text
create_finetune_job False
run_temporary_endpoint_benchmark False
```

Run:

```bash
rg -n "authorization_verifier=" factorylm_ai tests/factorylm_ai
```

Expected remaining hits only in adversarial public-injection tests:

```text
tests/factorylm_ai/test_paid_authorization_trust_boundary.py:... authorization_verifier=cast(Any, _FakeVerifier())
tests/factorylm_ai/test_paid_authorization_trust_boundary.py:... authorization_verifier=cast(Any, _FakeVerifier())
```

- [ ] **Step 7: Check PR status after push**

Run:

```bash
gh pr checks 2881 --repo Mikecranesync/MIRA
```

Expected:

```text
Unit Tests pass
Eval Offline pass
CI Gate pass
```

Do not merge from this task. PR #2881 still needs review because it gates paid execution.

---

## Self-Review

**Spec coverage:** The plan addresses all owner blockers from PR #2881 comments: public verifier injection is rejected, ledger enrollment remains signed-registry gated in `TrustedPaidAuthorizationVerifier`, caller-created ledger records cannot become trusted, altered signed fields fail, valid signed receipts stay single-use and revocable, and emitted evidence avoids private material.

**Placeholder scan:** No placeholder instructions are present.

**Type consistency:** `_trusted_verifier_factory` returns `PaidAuthorizationVerifier`; `PaidAuthorizationLedger` and `TrustedPaidAuthorizationVerifier` both satisfy `verify_and_consume(...)`, so existing tests can use the private factory without new production interfaces.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-24-pr2881-paid-authorization-trust-boundary.md`.

Two execution options:

1. Subagent-Driven (recommended) - dispatch a fresh subagent per task, review between tasks, fast iteration.

2. Inline Execution - execute tasks in this session using executing-plans, batch execution with checkpoints.

Recommended here: Inline Execution. The touched surface is small, security-sensitive, and the hard part is preserving one trust-boundary invariant across a handful of tests.
