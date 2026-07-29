"""Hermetic tests for the PrintSense CLI (``py -3 -m printsense``).

No Anthropic, no network: ``interpret_print`` is monkeypatched at the CLI's
import site. ``grade_case`` and the render layer run for REAL on the mocked
graph — the CLI's value is wiring the shipped pieces, so the wiring is what
gets tested.
"""

import json

import pytest

pytest.importorskip("pydantic")

from printsense import cli  # noqa: E402
from printsense.interpret import PrintVisionUnavailable  # noqa: E402
from printsense.models import Entity, PrintSynthGraph  # noqa: E402


def _graph() -> PrintSynthGraph:
    return PrintSynthGraph(
        package={"drawing_no": "AP31971", "cabinet": "+SCU2", "sheet": "20"},
        devices=[Entity(tag="-21/A13", type="opto module", evidence="A13", confidence=0.9)],
        unresolved=[],
    )


@pytest.fixture
def photo(tmp_path):
    p = tmp_path / "print.jpg"
    p.write_bytes(b"fake-jpeg-bytes")
    return p


def test_happy_path_writes_artifacts(monkeypatch, tmp_path, photo, capsys):
    calls = {}

    def fake_interpret(pages, *, question=None, preprocess=True, **kw):
        calls["pages"] = pages
        calls["question"] = question
        calls["preprocess"] = preprocess
        return _graph()

    monkeypatch.setattr(cli, "interpret_print", fake_interpret)
    out = tmp_path / "out"

    rc = cli.main([str(photo), "--out", str(out)])

    assert rc == cli.EXIT_OK
    assert calls["pages"] == [(b"fake-jpeg-bytes", "image/jpeg")]
    assert calls["preprocess"] is True
    # artifacts
    graph = json.loads((out / "graph.json").read_text(encoding="utf-8"))
    assert graph["devices"][0]["tag"] == "-21/A13"
    assert (out / "brief.txt").read_text(encoding="utf-8")
    grade = json.loads((out / "grade.json").read_text(encoding="utf-8"))
    assert grade["import_verdict"] in ("PASS", "FAIL")  # real grade_case ran
    # stdout carries the brief + verdict line
    got = capsys.readouterr().out
    assert "import_verdict=" in got


def test_question_and_no_preprocess_passthrough(monkeypatch, tmp_path, photo):
    seen = {}

    def fake_interpret(pages, *, question=None, preprocess=True, **kw):
        seen["question"] = question
        seen["preprocess"] = preprocess
        return _graph()

    monkeypatch.setattr(cli, "interpret_print", fake_interpret)

    rc = cli.main(
        [
            str(photo),
            "--question",
            "why is the heater dead?",
            "--no-preprocess",
            "--out",
            str(tmp_path / "o"),
        ]
    )

    assert rc == cli.EXIT_OK
    assert seen["question"] == "why is the heater dead?"
    assert seen["preprocess"] is False


def test_multiple_inputs_are_one_package(monkeypatch, tmp_path):
    a = tmp_path / "s1.jpg"
    b = tmp_path / "s2.png"
    a.write_bytes(b"one")
    b.write_bytes(b"two")
    seen = {}

    def fake_interpret(pages, **kw):
        seen["pages"] = pages
        return _graph()

    monkeypatch.setattr(cli, "interpret_print", fake_interpret)

    rc = cli.main([str(a), str(b), "--out", str(tmp_path / "o")])

    assert rc == cli.EXIT_OK
    assert seen["pages"] == [(b"one", "image/jpeg"), (b"two", "image/png")]


def test_unknown_extension_is_usage_error(monkeypatch, tmp_path, capsys):
    bad = tmp_path / "notes.txt"
    bad.write_text("hi")
    called = []
    monkeypatch.setattr(cli, "interpret_print", lambda *a, **k: called.append(1))

    rc = cli.main([str(bad), "--out", str(tmp_path / "o")])

    assert rc == cli.EXIT_USAGE
    assert not called  # no API attempt on bad input
    assert "unsupported file type" in capsys.readouterr().err


def test_missing_file_is_usage_error(monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(cli, "interpret_print", lambda *a, **k: _graph())
    rc = cli.main([str(tmp_path / "nope.jpg"), "--out", str(tmp_path / "o")])
    assert rc == cli.EXIT_USAGE
    assert "not found" in capsys.readouterr().err


def test_provider_unavailable_exit_code_and_hint(monkeypatch, tmp_path, photo, capsys):
    def raise_unavailable(*a, **k):
        raise PrintVisionUnavailable("ANTHROPIC_API_KEY is not set")

    monkeypatch.setattr(cli, "interpret_print", raise_unavailable)

    rc = cli.main([str(photo), "--out", str(tmp_path / "o")])

    assert rc == cli.EXIT_UNAVAILABLE
    err = capsys.readouterr().err
    assert "doppler run -p factorylm -c stg" in err  # actionable hint


def test_map_flag_writes_map(monkeypatch, tmp_path, photo):
    monkeypatch.setattr(cli, "interpret_print", lambda *a, **k: _graph())
    out = tmp_path / "o"

    rc = cli.main([str(photo), "--map", "--out", str(out)])

    assert rc == cli.EXIT_OK
    assert (out / "map.txt").read_text(encoding="utf-8")


def test_pdf_media_type(monkeypatch, tmp_path):
    pdf = tmp_path / "sheet.pdf"
    pdf.write_bytes(b"%PDF-1.4 fake")
    seen = {}
    monkeypatch.setattr(
        cli, "interpret_print", lambda pages, **kw: seen.update(pages=pages) or _graph()
    )

    rc = cli.main([str(pdf), "--out", str(tmp_path / "o")])

    assert rc == cli.EXIT_OK
    assert seen["pages"][0][1] == "application/pdf"
