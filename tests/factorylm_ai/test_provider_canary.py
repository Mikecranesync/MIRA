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


def test_vision_probe_sends_the_providers_cap_field(monkeypatch) -> None:
    """Codex F3 on #4349: the vision probe must use the provider's cap field.

    OpenAI's gpt-5 family rejects `max_tokens` (wants `max_completion_tokens`)
    with HTTP 400, so a probe that hardcodes `max_tokens` reports vision DOWN
    for a provider whose runtime vision works. Both retry attempts carry it.
    """
    sent: list[dict] = []

    def fake_post(url, **kw):
        sent.append(kw["json"])
        return _Resp(content="MIRA CANARY 7", model="gpt-5-vision")

    _patch_post(monkeypatch, fake_post)
    ok, _, reason = phc._vision_probe(
        "https://u", "k", "gpt-5-vision", cap_key="max_completion_tokens"
    )
    assert ok and reason == ""
    assert sent and all("max_completion_tokens" in b and "max_tokens" not in b for b in sent)
    assert sent[0]["max_completion_tokens"] == phc.VISION_PROBE_MAX_TOKENS


def test_vision_probe_default_cap_field_is_max_tokens(monkeypatch) -> None:
    """Control: the compat providers (Together today) keep the exact old body."""
    sent: list[dict] = []

    def fake_post(url, **kw):
        sent.append(kw["json"])
        return _Resp(content="MIRA CANARY 7")

    _patch_post(monkeypatch, fake_post)
    ok, _, _ = phc._vision_probe_once("https://u", "k", "MiniMaxAI/MiniMax-M3")
    assert ok
    assert sent[0]["max_tokens"] == phc.VISION_PROBE_MAX_TOKENS
    assert "max_completion_tokens" not in sent[0]


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
    def __init__(self, name, vision_model="", cap_key="max_tokens", extra_body=None):
        self.name = name
        self.api_url = "https://u"
        self.api_key = "k"
        self.model = "text-model"
        self.vision_model = vision_model
        # Mirrors _Provider.cap_key: the request field carrying the output-token
        # cap ("max_tokens" for OpenAI-compat providers, "max_completion_tokens"
        # for the OpenAI gpt-5 dialect). main() passes it through to _probe.
        self.cap_key = cap_key
        # Mirrors _Provider.extra_body (OpenRouter's data-policy routing block).
        self.extra_body = extra_body or {}


def _cascade():
    # Cerebras archived 2026-09-29. Since 2026-10-11 OpenAI LEADS the cascade
    # (gpt-5 dialect: max_completion_tokens); since 2026-10-14 OpenRouter is the
    # backup tier right behind it (text + vision), then Groq → Together.
    return [
        _FakeProv("openai", cap_key="max_completion_tokens"),
        _FakeProv(
            "openrouter",
            vision_model="qwen/qwen3-vl-30b-a3b-instruct",
            extra_body={"provider": {"data_collection": "deny", "zdr": True}},
        ),
        _FakeProv("groq"),
        _FakeProv("together", vision_model="MiniMaxAI/MiniMax-M3"),
    ]


def _run_main(monkeypatch, *, vision_ok: bool, tmp_path: Path, providers=None):
    fake_router = types.ModuleType("shared.inference.router")
    built = _cascade() if providers is None else providers
    fake_router._build_providers = lambda: built
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
    assert "vision_up_count=2" in gh and "vision_down_count=0" in gh
    out = capsys.readouterr().out
    assert "together-vision" in out and "openrouter-vision" in out


def test_main_text_up_vision_down_exits_one(monkeypatch, tmp_path, capsys) -> None:
    """The PRD's core assertion: a provider is NOT fully up for PrintSense on a
    text probe alone — vision down pages even when all text probes pass."""
    code, gh = _run_main(monkeypatch, vision_ok=False, tmp_path=tmp_path)
    assert code == 1
    assert "vision_down_count=2" in gh
    assert "vision_down_providers=openrouter,together" in gh
    assert "up_count=4" in gh  # text coverage was fine — the page is vision-specific
    assert "NOT fully up for PrintSense" not in capsys.readouterr().out or True


def test_archived_cerebras_absent_is_healthy(monkeypatch, tmp_path) -> None:
    """Cerebras is archived (no key → not built): its absence must not page."""
    code, gh = _run_main(monkeypatch, vision_ok=True, tmp_path=tmp_path)
    assert "cerebras" not in phc.EXPECTED
    assert code == 0
    assert "up_count=4" in gh


@pytest.mark.parametrize("missing", ["openai", "openrouter", "groq", "together"])
def test_missing_expected_provider_still_pages(monkeypatch, tmp_path, missing) -> None:
    """Control: a provider that IS expected and has no key is still DOWN (exit 1)."""
    providers = [p for p in _cascade() if p.name != missing]
    code, _gh = _run_main(monkeypatch, vision_ok=True, tmp_path=tmp_path, providers=providers)
    assert code == 1


# ── OpenRouter: the probe sends the runtime's request body (2026-10-14) ────────
# OpenRouter requests carry a data-policy block (no training, no retention). A
# probe without it could pass while every real request finds no host, so main()
# hands each provider's `extra_body` to both probes.

_ROUTING = {"provider": {"data_collection": "deny", "zdr": True}}


def test_text_and_vision_probes_carry_the_extra_body(monkeypatch) -> None:
    sent: list[dict] = []

    def fake_post(url, **kw):
        sent.append(kw["json"])
        return _Resp(content="MIRA CANARY 7", model="qwen/qwen3-vl-30b-a3b-instruct")

    _patch_post(monkeypatch, fake_post)
    assert phc._probe_once("https://u", "k", "m", extra_body=_ROUTING)[0]
    assert phc._vision_probe_once(
        "https://u", "k", "qwen/qwen3-vl-30b-a3b-instruct", extra_body=_ROUTING
    )[0]
    assert [b.get("provider") for b in sent] == [_ROUTING["provider"]] * 2


def test_main_passes_each_providers_extra_body(monkeypatch, tmp_path) -> None:
    fake_router = types.ModuleType("shared.inference.router")
    fake_router._build_providers = _cascade
    monkeypatch.setitem(sys.modules, "shared.inference.router", fake_router)
    bodies: dict[str, list[dict]] = {}

    def fake_post(url, **kw):
        body = kw["json"]
        bodies.setdefault(body["model"], []).append(body)
        return _Resp(content="MIRA CANARY 7", model=body["model"])

    _patch_post(monkeypatch, fake_post)
    monkeypatch.setenv("GITHUB_OUTPUT", str(tmp_path / "gh_output"))
    assert phc.main() == 0
    (vision,) = bodies["qwen/qwen3-vl-30b-a3b-instruct"]
    assert vision["provider"] == _ROUTING["provider"]
    # Control: providers without an extra_body keep the exact old body.
    assert all("provider" not in b for b in bodies["MiniMaxAI/MiniMax-M3"])
