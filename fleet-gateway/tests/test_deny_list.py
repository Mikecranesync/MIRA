from __future__ import annotations

import pytest
from fleet_gateway.contract import ALLOWED_TOOLS, DENIED_TOOLS
from fleet_gateway.errors import DeniedToolError
from fleet_gateway.mcp_api import mcp_tool_names


def test_exactly_nine_tools(service):
    assert tuple(service.list_tools()) == ALLOWED_TOOLS
    assert len(service.list_tools()) == 9
    assert mcp_tool_names() == ALLOWED_TOOLS


def test_deny_list_tools_absent(service, auth):
    assert DENIED_TOOLS.isdisjoint(set(service.list_tools()))
    for name in sorted(DENIED_TOOLS):
        with pytest.raises(DeniedToolError):
            service.invoke(name, {}, authorization=auth)


def test_unknown_tool_absent(service, auth):
    with pytest.raises(DeniedToolError):
        service.invoke("unrestricted_shell", {"cmd": "id"}, authorization=auth)


def test_launch_rejects_merge_flag(service, auth):
    from helpers import LAUNCH_OK

    with pytest.raises(DeniedToolError):
        service.invoke(
            "launch_worker",
            {**LAUNCH_OK, "merge": True},
            authorization=auth,
        )
