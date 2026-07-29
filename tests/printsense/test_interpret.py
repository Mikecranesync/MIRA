"""Tests for the isolated paid print-vision interpreter (openai | anthropic).

No real API call and no SDK required: the client is mocked (both SDKs are
lazy-imported inside ``_client``). Verifies the not-configured guard, the
provider dispatch, and that a model JSON response parses + validates into a
PrintSynthGraph with everything ``trust="proposed"``.
"""

import json

import pytest

pytest.importorskip("pydantic")

from printsense import interpret  # noqa: E402
from printsense.models import PrintSynthGraph, TrustState  # noqa: E402


def test_unavailable_without_key_anthropic(monkeypatch):
    monkeypatch.setattr(interpret, "PROVIDER", "anthropic")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    with pytest.raises(interpret.PrintVisionUnavailable):
        interpret.interpret_print([(b"imgbytes", "image/jpeg")])


def test_unavailable_without_key_openai(monkeypatch):
    monkeypatch.setattr(interpret, "PROVIDER", "openai")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    with pytest.raises(interpret.PrintVisionUnavailable):
        interpret.interpret_print([(b"imgbytes", "image/jpeg")])


def test_unavailable_when_provider_unsupported(monkeypatch):
    monkeypatch.setattr(interpret, "PROVIDER", "groq")
    with pytest.raises(interpret.PrintVisionUnavailable):
        interpret.interpret_print([(b"imgbytes", "image/jpeg")])


def test_is_configured_matrix(monkeypatch):
    monkeypatch.setattr(interpret, "PROVIDER", "openai")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    assert interpret.is_configured() is True
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    assert interpret.is_configured() is False
    monkeypatch.setattr(interpret, "PROVIDER", "anthropic")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
    assert interpret.is_configured() is True
    monkeypatch.setattr(interpret, "PROVIDER", "groq")
    assert interpret.is_configured() is False


# ── anthropic-path mocks ─────────────────────────────────────────────────────


class _Block:
    type = "text"

    def __init__(self, text):
        self.text = text


class _Msg:
    def __init__(self, text):
        self.content = [_Block(text)]


class _Stream:
    def __init__(self, text):
        self._text = text

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def get_final_message(self):
        return _Msg(self._text)


def _fake_anthropic_client(canned_json: str):
    class _Messages:
        def stream(self, **kwargs):
            self.kwargs = kwargs
            return _Stream(canned_json)

    class _Client:
        messages = _Messages()

    return _Client()


# ── openai-path mocks ────────────────────────────────────────────────────────


class _FakeResponse:
    def __init__(self, text):
        self.output_text = text
        self.usage = None


def _fake_openai_client(canned_json: str, seen: dict):
    class _Responses:
        def create(self, **kwargs):
            seen.update(kwargs)
            return _FakeResponse(canned_json)

    class _Client:
        responses = _Responses()

    return _Client()


_CANNED = json.dumps(
    {
        "package": {"cabinet": "SCU2", "drawing_no": "AP31971"},
        "devices": [{"tag": "-3/F1", "type": "breaker", "evidence": "F1", "trust": "proposed"}],
        "pe_bonds": [{"tag": "-3/PE:1", "type": "pe_bond_terminal", "evidence": "PE"}],
        "unresolved": [{"item": "S11 top terminal labels", "status": "unresolved"}],
    }
)


def test_parses_and_validates_claude_graph(monkeypatch):
    monkeypatch.setattr(interpret, "PROVIDER", "anthropic")
    monkeypatch.setattr(interpret, "_client", lambda *a, **k: _fake_anthropic_client(_CANNED))
    graph = interpret.interpret_print(
        [(b"imgbytes", "image/jpeg")], question="what devices are listed in this print?"
    )
    assert isinstance(graph, PrintSynthGraph)
    assert any(d.tag == "-3/F1" for d in graph.devices)
    # freshly interpreted -> everything proposed, nothing auto-verified
    assert all(e.trust == TrustState.proposed for e in graph.all_entities())
    assert graph.pe_bonds and graph.unresolved


def test_parses_and_validates_openai_graph(monkeypatch):
    seen: dict = {}
    monkeypatch.setattr(interpret, "PROVIDER", "openai")
    monkeypatch.setattr(interpret, "_client", lambda *a, **k: _fake_openai_client(_CANNED, seen))
    graph = interpret.interpret_print(
        [(b"imgbytes", "image/jpeg")],
        question="what devices are listed in this print?",
        model="gpt-5.5",
    )
    assert isinstance(graph, PrintSynthGraph)
    assert any(d.tag == "-3/F1" for d in graph.devices)
    assert all(e.trust == TrustState.proposed for e in graph.all_entities())
    # request shape: image block + text block, system prompt as instructions,
    # reasoning effort included for a gpt-5-family model
    kinds = [b["type"] for b in seen["input"][0]["content"]]
    assert kinds == ["input_image", "input_text"]
    assert seen["instructions"] == interpret._SYSTEM
    assert seen["reasoning"] == {"effort": "high"}


def test_openai_pdf_goes_as_input_file(monkeypatch):
    seen: dict = {}
    monkeypatch.setattr(interpret, "PROVIDER", "openai")
    monkeypatch.setattr(interpret, "_client", lambda *a, **k: _fake_openai_client(_CANNED, seen))
    interpret.interpret_print([(b"%PDF-1.7", "application/pdf")], preprocess=False)
    kinds = [b["type"] for b in seen["input"][0]["content"]]
    assert kinds == ["input_file", "input_text"]


def test_openai_reasoning_omitted_for_non_reasoning_model(monkeypatch):
    seen: dict = {}
    monkeypatch.setattr(interpret, "PROVIDER", "openai")
    monkeypatch.setattr(interpret, "_client", lambda *a, **k: _fake_openai_client(_CANNED, seen))
    interpret.interpret_print([(b"x", "image/jpeg")], model="gpt-4o")
    assert "reasoning" not in seen


def test_openai_effort_mapping():
    assert interpret._openai_effort("xhigh") == "high"
    assert interpret._openai_effort("max") == "high"
    assert interpret._openai_effort("none") == "minimal"
    assert interpret._openai_effort("medium") == "medium"


def test_strips_markdown_fences(monkeypatch):
    fenced = '```json\n{"devices": [{"tag": "-3/E1", "evidence": "heater symbol"}]}\n```'
    monkeypatch.setattr(interpret, "PROVIDER", "anthropic")
    monkeypatch.setattr(interpret, "_client", lambda *a, **k: _fake_anthropic_client(fenced))
    graph = interpret.interpret_print([(b"x", "image/jpeg")])
    assert graph.devices[0].tag == "-3/E1"


def test_strips_markdown_fences_openai(monkeypatch):
    fenced = '```json\n{"devices": [{"tag": "-3/E1", "evidence": "heater symbol"}]}\n```'
    seen: dict = {}
    monkeypatch.setattr(interpret, "PROVIDER", "openai")
    monkeypatch.setattr(interpret, "_client", lambda *a, **k: _fake_openai_client(fenced, seen))
    graph = interpret.interpret_print([(b"x", "image/jpeg")])
    assert graph.devices[0].tag == "-3/E1"


# ── ZTA cost meter + spend guards (v3.156.0) ─────────────────────────────────


class _FakeUsage:
    def __init__(self, tin, tout):
        self.input_tokens = tin
        self.output_tokens = tout


def test_usage_capture_pop_semantics():
    interpret.pop_last_usage()  # clear any prior state
    interpret._record_usage("openai", "gpt-5.5", _FakeUsage(1000, 2000))
    usage = interpret.pop_last_usage()
    # Core token keys, plus the FR-5 attribution keys (ADR-0031) — always present.
    assert usage["provider"] == "openai"
    assert usage["model"] == "gpt-5.5"
    assert usage["input_tokens"] == 1000
    assert usage["output_tokens"] == 2000
    assert usage["endpoint_class"] == "api"
    assert usage["input_kind"] == "vision"
    assert usage["fallback_attempts"] == []
    assert "latency_ms" in usage
    assert interpret.pop_last_usage() is None  # pop clears the slot


def test_record_usage_ignores_none():
    interpret.pop_last_usage()
    interpret._record_usage("openai", "gpt-5.5", None)
    assert interpret.pop_last_usage() is None


def test_openai_call_records_usage(monkeypatch):
    seen: dict = {}
    client = _fake_openai_client(_CANNED, seen)
    orig_create = client.responses.create

    def create_with_usage(**kwargs):
        response = orig_create(**kwargs)
        response.usage = _FakeUsage(5000, 700)
        return response

    client.responses.create = create_with_usage
    monkeypatch.setattr(interpret, "PROVIDER", "openai")
    monkeypatch.setattr(interpret, "_client", lambda *a, **k: client)
    interpret.pop_last_usage()
    interpret.interpret_print([(b"x", "image/jpeg")], model="gpt-5.5")
    usage = interpret.pop_last_usage()
    assert usage["provider"] == "openai" and usage["model"] == "gpt-5.5"
    assert usage["input_tokens"] == 5000 and usage["output_tokens"] == 700


def test_max_tokens_default_12k_and_empty_env_safe(monkeypatch):
    import importlib

    monkeypatch.delenv("PRINT_VISION_MAX_TOKENS", raising=False)
    importlib.reload(interpret)
    assert interpret.MAX_TOKENS == 12000
    monkeypatch.setenv("PRINT_VISION_MAX_TOKENS", "")  # compose ${VAR:-} shape
    importlib.reload(interpret)
    assert interpret.MAX_TOKENS == 12000  # empty string must not crash import
    monkeypatch.setenv("PRINT_VISION_MAX_TOKENS", "8000")
    importlib.reload(interpret)
    assert interpret.MAX_TOKENS == 8000
    monkeypatch.delenv("PRINT_VISION_MAX_TOKENS", raising=False)
    importlib.reload(interpret)
    assert interpret.MAX_TOKENS == 12000
