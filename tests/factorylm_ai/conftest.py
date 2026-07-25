"""Hermetic-test configuration for the ``factorylm_ai`` suite.

The paid-authorization guard forbids caller-supplied verifiers so no code path
can hand Together an always-approve stub and cause real spend. The hermetic
tests still need to drive the ledger directly — including the negative cases
that prove an unreadable or missing ledger blocks the request *before* any HTTP
call — so this conftest opens the one explicit, greppable seam for them.

Production never calls ``allow_ledger_injection_for_tests``; the flag is off by
default, and even when on, only a genuine ``PaidAuthorizationLedger`` is
accepted (duck-typed stubs stay rejected).
"""

from __future__ import annotations

from factorylm_ai.providers.paid_authorization_guard import (
    allow_ledger_injection_for_tests,
)

allow_ledger_injection_for_tests(True)
