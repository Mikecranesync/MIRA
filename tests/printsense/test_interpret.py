"""Tests for the isolated Anthropic print-vision interpreter.

No real API call and no `anthropic` SDK required: the client is mocked (the SDK
is lazy-imported inside ``_client``). Verifies the not-configured guard and that
a Claude JSON response parses + validates into a PrintSynthGraph with everything
``trust="proposed"``.
"""

import json

import pytest

pytest.importorskip("pydantic")

from printsense import interpret  # noqa: E402
from printsense.models import PrintSynthGraph, TrustState  # noqa: E402


def test_unavailable_without_key(monkeypatch):
    monkeypatch.setattr(interpret, "PROVIDER", "anthropic")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    with pytest.raises(interpret.PrintVisionUnavailable):
        interpret.interpret_print([(b"imgbytes", "image/jpeg")])


def test_unavailable_when_provider_not_anthropic(monkeypatch):
    monkeypatch.setattr(interpret, "PROVIDER", "groq")
    with pytest.raises(interpret.PrintVisionUnavailable):
        interpret.interpret_print([(b"imgbytes", "image/jpeg")])


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


def _fake_client(canned_json: str):
    class _Messages:
        def stream(self, **kwargs):
            self.kwargs = kwargs
            return _Stream(canned_json)

    class _Client:
        messages = _Messages()

    return _Client()


def test_parses_and_validates_claude_graph(monkeypatch):
    canned = json.dumps(
        {
            "package": {"cabinet": "SCU2", "drawing_no": "AP31971"},
            "devices": [{"tag": "-3/F1", "type": "breaker", "evidence": "F1", "trust": "proposed"}],
            "pe_bonds": [{"tag": "-3/PE:1", "type": "pe_bond_terminal", "evidence": "PE"}],
            "unresolved": [{"item": "S11 top terminal labels", "status": "unresolved"}],
        }
    )
    monkeypatch.setattr(interpret, "_client", lambda: _fake_client(canned))
    graph = interpret.interpret_print(
        [(b"imgbytes", "image/jpeg")], question="what devices are listed in this print?"
    )
    assert isinstance(graph, PrintSynthGraph)
    assert any(d.tag == "-3/F1" for d in graph.devices)
    # freshly interpreted -> everything proposed, nothing auto-verified
    assert all(e.trust == TrustState.proposed for e in graph.all_entities())
    assert graph.pe_bonds and graph.unresolved


def test_strips_markdown_fences(monkeypatch):
    fenced = '```json\n{"devices": [{"tag": "-3/E1", "evidence": "heater symbol"}]}\n```'
    monkeypatch.setattr(interpret, "_client", lambda: _fake_client(fenced))
    graph = interpret.interpret_print([(b"x", "image/jpeg")])
    assert graph.devices[0].tag == "-3/E1"
