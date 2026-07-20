"""CLI ``--recall`` flag (PR G): the paid interpretation is reused across runs.

Hermetic — the paid boundary is monkeypatched, so no model call, no cost. Real
``grade_case``/render run on the (recalled) graph.
"""

from __future__ import annotations

import pytest

pytest.importorskip("pydantic")

from printsense import cli, recall  # noqa: E402
from printsense.models import Entity, PrintSynthGraph  # noqa: E402


def _graph() -> PrintSynthGraph:
    return PrintSynthGraph(
        devices=[Entity(tag="-21/A13", type="opto module", evidence="A13", confidence=0.9)]
    )


def test_recall_flag_reuses_across_runs(monkeypatch, tmp_path, capsys):
    photo = tmp_path / "print.jpg"
    photo.write_bytes(b"fake-jpeg-bytes")
    store = tmp_path / "recall"
    calls = {"n": 0}

    def fake(pages, **kw):
        calls["n"] += 1
        return _graph()

    # the bridge calls the module-global interpret_print (late-bound); patch it there
    monkeypatch.setattr(recall, "interpret_print", fake)

    rc1 = cli.main(
        [str(photo), "--recall", "--recall-store", str(store), "--out", str(tmp_path / "o1")]
    )
    capsys.readouterr()  # drain run-1 output
    rc2 = cli.main(
        [str(photo), "--recall", "--recall-store", str(store), "--out", str(tmp_path / "o2")]
    )

    assert rc1 == cli.EXIT_OK
    assert rc2 == cli.EXIT_OK
    assert calls["n"] == 1  # second run recalled — the model was NOT paid again
    assert "recall HIT" in capsys.readouterr().err


def test_no_recall_flag_is_unchanged_behavior(monkeypatch, tmp_path):
    photo = tmp_path / "print.jpg"
    photo.write_bytes(b"fake-jpeg-bytes")
    calls = {"n": 0}

    def fake(pages, **kw):
        calls["n"] += 1
        return _graph()

    monkeypatch.setattr(cli, "interpret_print", fake)  # default path uses cli.interpret_print
    rc1 = cli.main([str(photo), "--out", str(tmp_path / "o1")])
    rc2 = cli.main([str(photo), "--out", str(tmp_path / "o2")])

    assert rc1 == cli.EXIT_OK
    assert rc2 == cli.EXIT_OK
    assert calls["n"] == 2  # no recall flag -> pays every run, exactly as before PR G
