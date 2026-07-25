"""Hermetic-test configuration for the ``factorylm_ai`` suite.

The paid-authorization guard forbids caller-supplied verifiers so no code path
can hand Together an always-approve stub and cause real spend. The hermetic
tests still need to drive the ledger directly — including the negative cases
that prove an unreadable or missing ledger blocks the request *before* any HTTP
call — so this fixture opens the one explicit, greppable seam for them.

Production never calls ``allow_ledger_injection_for_tests``; the flag is off by
default, and even when on, only a genuine ``PaidAuthorizationLedger`` is
accepted (duck-typed stubs stay rejected). The fixture restores the previous
value after each test so the seam never leaks into another suite in a
whole-repo pytest run.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest

from factorylm_ai.providers import paid_authorization_guard


@pytest.fixture(autouse=True)
def allow_hermetic_ledger_injection() -> Iterator[None]:
    previous = paid_authorization_guard._ledger_injection_allowed
    paid_authorization_guard.allow_ledger_injection_for_tests(True)
    try:
        yield
    finally:
        paid_authorization_guard.allow_ledger_injection_for_tests(previous)
