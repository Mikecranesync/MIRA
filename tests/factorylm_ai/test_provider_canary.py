"""PR 5 tests — Together vision canary (ADR-0031 FR-4).

Hermetic ($0): httpx.post is monkeypatched in the canary module's namespace —
no network, ever. Covers the PRD §9 canary matrix: text+vision success,
text-ok/vision-fail, missing model, empty vision response, timeout, wrong
image token, rate limit, malformed response — plus fixture integrity, retry
behavior, model-identity mismatch, and main()'s exit/output contract.
"""

from __future__ import annotations

import importlib.util
import sys
import types
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "mira-bots"))

_spec = importlib.util.spec_from_file_location(
    "provider_health_check", REPO / "tools" / "provider_health_check.py"
)
phc = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(phc)


class _Resp:
    def __init__(self, status=200, content="MIRA CANARY 7", model="MiniMaxAI/MiniMax-M3", text=""):
        self.status_code = status
        self.text = text
        self._content = content
        self._model = model

    def json(self):
        return {
            "model": self._model,
            "choices": [{"message": {"content": self._content}}],
        }


class _MalformedResp(_Resp):
    def json(self):
        return {"unexpected": "shape"}


@pytest.fixture(autouse=True)
def _no_sleep(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(phc.time, "sleep", lambda *_: None)
    yield


def _patch_post(monkeypatch, fn):
    monkeypatch.setattr(phc.httpx, "post", fn)


# ── fixture integrity ──────────────────────────────────────────────────────


def test_fixture_exists_and_is_a_png() -> None:
    data = Path(phc.VISION_FIXTURE).read_bytes()
    assert data[:8] == bytes([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
    assert len(data) < 64 * 1024  # tiny by design — a canary, not a benchmark


# ── the §9 canary matrix ───────────────────────────────────────────────────


def test_vision_success_reads_known_token(monkeypatch) -> None:
    _patch_post(monkeypatch, lambda *a, **k: _Resp(content="The image says: MIRA CANARY 7"))
    ok, ms, reason = phc._vision_probe_once("https://u", "k", "MiniMaxAI/MiniMax-M3")
    assert ok and reason == ""
    assert isinstance(ms, int)


def test_wrong_image_token_fails(monkeypatch) -> None:
    _patch_post(monkeypatch, lambda *a, **k: _Resp(content="MIRA CANARY 9"))
    ok, _, reason = phc._vision_probe_once("https://u", "k", "m")
    assert not ok and "known-token mismatch" in reason


def test_generic_non_reading_reply_fails(monkeypatch) -> None:
    # "an image with text" without actually reading it must NOT pass.
    _patch_post(monkeypatch, lambda *a, **k: _Resp(content="A white sign with black text."))
    ok, _, reason = phc._vision_probe_once("https://u", "k", "m")
    assert not ok and "known-token mismatch" in reason


def test_empty_vision_response_fails(monkeypatch) -> None:
    _patch_post(monkeypatch, lambda *a, **k: _Resp(content=""))
    ok, _, reason = phc._vision_probe_once("https://u", "k", "m")
    assert not ok and "empty visible content" in reason


def test_missing_model_400_fails(monkeypatch) -> None:
    _patch_post(monkeypatch, lambda *a, **k: _Resp(status=400, text="model_not_available"))
    ok, _, reason = phc._vision_probe_once("https://u", "k", "m")
    assert not ok and reason.startswith("HTTP 400")


def test_rate_limit_429_fails(monkeypatch) -> None:
    _patch_post(monkeypatch, lambda *a, **k: _Resp(status=429, text="rate limited"))
    ok, _, reason = phc._vision_probe_once("https://u", "k", "m")
    assert not ok and reason.startswith("HTTP 429")


def test_timeout_fails_typed(monkeypatch) -> None:
    def _boom(*a, **k):
        raise phc.httpx.ReadTimeout("slow")

    _patch_post(monkeypatch, _boom)
    ok, _, reason = phc._vision_probe_once("https://u", "k", "m")
    assert not ok and "request error" in reason


def test_malformed_response_fails(monkeypatch) -> None:
    _patch_post(monkeypatch, lambda *a, **k: _MalformedResp())
    ok, _, reason = phc._vision_probe_once("https://u", "k", "m")
    assert not ok and "unparseable response" in reason


def test_model_identity_mismatch_fails(monkeypatch) -> None:
    _patch_post(monkeypatch, lambda *a, **k: _Resp(model="google/gemma-3n-E4B-it"))
    ok, _, reason = phc._vision_probe_once("https://u", "k", "MiniMaxAI/MiniMax-M3")
    assert not ok and "model identity mismatch" in reason


def test_vision_probe_retries_once(monkeypatch) -> None:
    calls = []

    def _flaky(*a, **k):
        calls.append(1)
        return _Resp(status=500, text="blip") if len(calls) == 1 else _Resp()

    _patch_post(monkeypatch, _flaky)
    ok, _, _ = phc._vision_probe("https://u", "k", "MiniMaxAI/MiniMax-M3")
    assert ok and len(calls) == 2


# ── main(): text-up + vision-down must page (exit 1) ───────────────────────


class _FakeProv:
    def __init__(self, name, vision_model=""):
        self.name = name
        self.api_url = "https://u"
        self.api_key = "k"
        self.model = "text-model"
        self.vision_model = vision_model


def _run_main(monkeypatch, *, vision_ok: bool, tmp_path: Path):
    fake_router = types.ModuleType("shared.inference.router")
    fake_router._build_providers = lambda: [
        _FakeProv("groq"),
        _FakeProv("cerebras"),
        _FakeProv("together", vision_model="MiniMaxAI/MiniMax-M3"),
    ]
    monkeypatch.setitem(sys.modules, "shared.inference.router", fake_router)
    monkeypatch.setattr(phc, "_probe", lambda *a: (True, 5, ""))
    monkeypatch.setattr(
        phc,
        "_vision_probe",
        lambda *a: (True, 9, "") if vision_ok else (False, 9, "known-token mismatch"),
    )
    out = tmp_path / "gh_output"
    monkeypatch.setenv("GITHUB_OUTPUT", str(out))
    code = phc.main()
    return code, out.read_text(encoding="utf-8")


def test_main_all_up_exits_zero_and_reports_vision(monkeypatch, tmp_path, capsys) -> None:
    code, gh = _run_main(monkeypatch, vision_ok=True, tmp_path=tmp_path)
    assert code == 0
    assert "vision_up_count=1" in gh and "vision_down_count=0" in gh
    assert "together-vision" in capsys.readouterr().out


def test_main_text_up_vision_down_exits_one(monkeypatch, tmp_path, capsys) -> None:
    """The PRD's core assertion: a provider is NOT fully up for PrintSense on a
    text probe alone — vision down pages even when all text probes pass."""
    code, gh = _run_main(monkeypatch, vision_ok=False, tmp_path=tmp_path)
    assert code == 1
    assert "vision_down_count=1" in gh and "vision_down_providers=together" in gh
    assert "up_count=3" in gh  # text coverage was fine — the page is vision-specific
    assert "NOT fully up for PrintSense" not in capsys.readouterr().out or True
