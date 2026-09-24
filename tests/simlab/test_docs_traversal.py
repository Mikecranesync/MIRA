"""Path-traversal containment for the SimLab docs route (#3815 / #3883).

`get_doc` builds a filesystem path from URL segments; without containment a
request like `/simlab/docs/../scenarios.py` reads `simlab/scenarios.py` — the
rubric answer key. `_safe_doc_path` resolves the target and returns None unless
it stays under `_DOCS_ROOT`. The literal, percent-encoded (`%2e%2e`) and
double-encoded forms all decode to `..` before the handler, so the resolved-path
check covers them; the live end-to-end proof (`curl --path-as-is`) is in the PR
body.
"""

from __future__ import annotations

from typing import Any

import pytest

pytest.importorskip("fastapi", reason="fastapi not installed")
pytest.importorskip("httpx", reason="httpx not installed")

from simlab.api import _DOCS_ROOT, _safe_doc_path, build_app  # noqa: E402
from simlab.approval import ApprovalStore  # noqa: E402
from simlab.engine import SimEngine  # noqa: E402
from simlab.lines.juice_bottling import build_line  # noqa: E402


@pytest.fixture()
def client(tmp_path: Any) -> Any:
    from fastapi.testclient import TestClient

    engine = SimEngine(build_line(), seed=42)
    approvals = ApprovalStore(str(tmp_path / "approvals.db"))
    return TestClient(build_app(engine=engine, approvals=approvals))


def _first_real_doc(client: Any) -> tuple[str, str]:
    """An (asset_id, filename) pair that genuinely exists under _DOCS_ROOT."""
    for asset in client.get("/simlab/lines/line01/assets").json():
        docs = client.get(f"/simlab/assets/{asset['asset_id']}/docs").json()
        if docs:
            return asset["asset_id"], docs[0]
    pytest.skip("no asset docs to exercise the legit path")


# ---------------------------------------------------------------------------
# Containment — the exfil vector is refused
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "asset_id, filename",
    [
        ("..", "scenarios.py"),   # the reported answer-key exfil
        ("..", "diagnostic.py"),
        ("..", "api.py"),
        ("../..", "api.py"),      # deeper escape
    ],
)
def test_safe_doc_path_refuses_traversal(asset_id: str, filename: str) -> None:
    assert _safe_doc_path(asset_id, filename) is None


def test_get_doc_containment_keeps_the_answer_key_out(client: Any) -> None:
    """The resolved escape target is genuinely outside _DOCS_ROOT.

    TestClient/httpx normalises `..` in a URL, so the handler is exercised
    through the helper it calls; this pins that the helper refuses the exact
    exfil path and that the escape resolves outside the docs tree.
    """
    assert _safe_doc_path("..", "scenarios.py") is None
    escaped = (_DOCS_ROOT.resolve() / ".." / "scenarios.py").resolve()
    assert not escaped.is_relative_to(_DOCS_ROOT.resolve())


# ---------------------------------------------------------------------------
# Controls — a real doc still resolves and still serves
# ---------------------------------------------------------------------------


def test_safe_doc_path_allows_a_real_doc(client: Any) -> None:
    asset_id, filename = _first_real_doc(client)
    resolved = _safe_doc_path(asset_id, filename)
    assert resolved is not None
    assert resolved.is_relative_to(_DOCS_ROOT.resolve())


def test_get_doc_serves_a_real_doc(client: Any) -> None:
    asset_id, filename = _first_real_doc(client)
    res = client.get(f"/simlab/docs/{asset_id}/{filename}")
    assert res.status_code == 200
    assert res.text
