"""Regression tests for kiosk /ask read-only register-write guardrails."""

from __future__ import annotations

import re
import sys
import types

import pytest

sys.path.insert(0, "mira-bots")

from ask_api.machine_context import MACHINE_CONTEXT


_WRITE_GUIDANCE = re.compile(
    r"\b(write|writing|set|clear|reset)\b.{0,40}\b(register|0x[0-9a-f]+|fc0?6|fc1[56])\b",
    re.IGNORECASE,
)


def test_machine_context_does_not_seed_register_write_instructions():
    assert not _WRITE_GUIDANCE.search(MACHINE_CONTEXT)
    assert "write 2 to 0x2002" not in MACHINE_CONTEXT.lower()
    assert "fc06" not in MACHINE_CONTEXT.lower()


def _install_app_import_stubs(monkeypatch):
    class FastAPI:
        def __init__(self, *_args, **_kwargs):
            pass

        def get(self, *_args, **_kwargs):
            return lambda fn: fn

        def post(self, *_args, **_kwargs):
            return lambda fn: fn

        def include_router(self, *_args, **_kwargs):
            pass

    class HTTPException(Exception):
        def __init__(self, status_code: int, detail: str):
            super().__init__(detail)
            self.status_code = status_code
            self.detail = detail

    class BaseModel:
        def __init__(self, **kwargs):
            for key, value in kwargs.items():
                setattr(self, key, value)

    class Supervisor:
        tenant_id = "tenant-test"

        def __init__(self, *_args, **_kwargs):
            pass

        async def process(self, **_kwargs):
            return ""

        def _load_state(self, _chat_id):
            return {}

    class APIRouter:
        """Router modules do `from fastapi import APIRouter` at import time.

        Each one is stubbed below so the real module never loads, but the stub
        `fastapi` must still expose the name: a router that slips into app.py
        without a matching stub entry otherwise fails with a bare
        `ImportError: cannot import name 'APIRouter'`, which reads like a
        dependency problem rather than a missing stub.
        """

        def __init__(self, *_args, **_kwargs):
            pass

        def get(self, *_args, **_kwargs):
            return lambda fn: fn

        def post(self, *_args, **_kwargs):
            return lambda fn: fn

    fastapi = types.ModuleType("fastapi")
    fastapi.FastAPI = FastAPI
    fastapi.APIRouter = APIRouter
    fastapi.Header = lambda default=None: default
    fastapi.HTTPException = HTTPException

    pydantic = types.ModuleType("pydantic")
    pydantic.BaseModel = BaseModel

    shared_engine = types.ModuleType("shared.engine")
    shared_engine.Supervisor = Supervisor

    shared_live_snapshot = types.ModuleType("shared.live_snapshot")
    shared_live_snapshot._FAULT_CODES = {}
    shared_live_snapshot.normalize = lambda *_args, **_kwargs: []
    shared_live_snapshot.render_status_block = lambda _snaps: ""

    ask_drive_pack = types.ModuleType("ask_api.drive_pack")
    ask_drive_pack.router = object()

    ask_workspace = types.ModuleType("ask_api.workspace")
    ask_workspace.router = object()

    ask_manual_discovery = types.ModuleType("ask_api.manual_discovery")
    ask_manual_discovery.router = object()

    ask_nameplate_detect = types.ModuleType("ask_api.nameplate_detect")
    ask_nameplate_detect.router = object()

    ask_ocr_extract = types.ModuleType("ask_api.ocr_extract")
    ask_ocr_extract.router = object()

    monkeypatch.setitem(sys.modules, "fastapi", fastapi)
    monkeypatch.setitem(sys.modules, "pydantic", pydantic)
    monkeypatch.setitem(sys.modules, "shared.engine", shared_engine)
    monkeypatch.setitem(sys.modules, "shared.live_snapshot", shared_live_snapshot)
    monkeypatch.setitem(sys.modules, "ask_api.drive_pack", ask_drive_pack)
    monkeypatch.setitem(sys.modules, "ask_api.workspace", ask_workspace)
    monkeypatch.setitem(sys.modules, "ask_api.manual_discovery", ask_manual_discovery)
    monkeypatch.setitem(sys.modules, "ask_api.nameplate_detect", ask_nameplate_detect)
    monkeypatch.setitem(sys.modules, "ask_api.ocr_extract", ask_ocr_extract)
    sys.modules.pop("ask_api.app", None)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "raw_reply",
    [
        "Clear the fault by writing 2 to register 0x2002, then retry.",
        "Use function code 06 (FC6) to write 2 to 0x2002.",
        "FC16 lets you write the frequency and run command in one transaction.",
    ],
)
async def test_ask_returns_readonly_warning_instead_of_register_write_advice(monkeypatch, raw_reply):
    _install_app_import_stubs(monkeypatch)
    from ask_api import app as app_module

    class FakeEngine:
        tenant_id = "tenant-test"

        async def process(self, **_kwargs):
            return raw_reply

        def _load_state(self, _chat_id):
            return {}

    monkeypatch.setattr(app_module, "ASK_API_KEY", "")
    monkeypatch.setattr(app_module, "engine", FakeEngine())

    response = await app_module.ask(
        app_module.AskRequest(question="How do I clear the VFD fault?", tags={}, session_id="test-session")
    )

    answer = response["answer"].lower()
    assert "read-only kiosk" in answer
    assert "qualified" in answer
    assert "write 2 to" not in answer
    assert "fc6" not in answer
    assert "fc16" not in answer
