"""Regression: PrintWorker must fail SOFT when its backend is disabled (#2923).

Staging / cloud-only environments point ``openwebui_url`` at a ``disabled://``
sentinel. Before this fix, ``PrintWorker.process`` posted to
``disabled://api/chat/completions`` → httpx raised ``Request URL has an
unsupported protocol 'disabled://'`` → ``PRINT_WORKER_ERROR`` in
``_handle_electrical_print_followup`` → the user saw the generic
"MIRA ran into an unexpected problem" reply. A disabled optional backend must
degrade gracefully, not crash.
"""

from __future__ import annotations

import sys

import pytest

sys.path.insert(0, "mira-bots")

from shared.workers.print_worker import (  # noqa: E402
    PRINT_BACKEND_UNAVAILABLE_MESSAGE,
    PrintWorker,
)


@pytest.mark.parametrize("disabled_url", ["disabled://", "disabled://localhost", "", "   "])
@pytest.mark.asyncio
async def test_process_degrades_gracefully_when_backend_disabled(disabled_url):
    """A disabled/unconfigured endpoint returns the graceful notice, no raise."""
    worker = PrintWorker(openwebui_url=disabled_url, api_key="")

    # Must NOT raise (the pre-fix behaviour was an httpx unsupported-protocol error).
    reply = await worker.process("what does terminal 3 connect to?", {"context": {}})

    assert reply == PRINT_BACKEND_UNAVAILABLE_MESSAGE
    assert not worker._backend_available()


@pytest.mark.parametrize("real_url", ["http://localhost:3000", "https://ow.example.com/"])
def test_real_http_endpoint_is_considered_available(real_url):
    """A genuine http(s) endpoint is treated as available (the call proceeds)."""
    worker = PrintWorker(openwebui_url=real_url, api_key="k")
    assert worker._backend_available()
