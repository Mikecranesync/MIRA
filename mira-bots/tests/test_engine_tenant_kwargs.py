"""Tests that Supervisor.process accepts per-call tenant_id and mira_user_id
without breaking the existing call shape."""

from __future__ import annotations

import os
import sys
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest


@pytest.mark.asyncio
async def test_process_accepts_tenant_kwargs(tmp_db):
    from shared.engine import Supervisor

    sup = Supervisor(
        db_path=tmp_db,
        openwebui_url="http://stub",
        api_key="",
        collection_id="",
        tenant_id="default_t",
    )
    # Patch process_full so we can assert what process() forwarded.
    with patch.object(sup, "process_full", new=AsyncMock(return_value={"reply": "ok"})) as mock_pf:
        await sup.process(
            chat_id="c1",
            message="hi",
            tenant_id="per_call_t",
            mira_user_id="per_call_u",
        )
        # The request-authenticated tenant is authoritative. It must survive the
        # process() -> process_full() boundary rather than falling back to the
        # chat-id cache or the Supervisor default tenant.
        assert mock_pf.await_args.kwargs["tenant_id"] == "per_call_t"


@pytest.mark.asyncio
async def test_process_backward_compatible_without_tenant_kwargs(tmp_db):
    from shared.engine import Supervisor

    sup = Supervisor(
        db_path=tmp_db,
        openwebui_url="http://stub",
        api_key="",
        collection_id="",
        tenant_id="default_t",
    )
    with patch.object(sup, "process_full", new=AsyncMock(return_value={"reply": "ok"})):
        # Existing call shape must keep working.
        result = await sup.process(chat_id="c1", message="hi")
    assert result == "ok"
