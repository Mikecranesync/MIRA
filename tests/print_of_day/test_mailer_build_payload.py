"""Regression coverage for mailer.build_payload — the pure Resend-payload builder.

Ported (reconciliation) from the superseded PR #2865. The canonical mailer gained
``EmailPackage.text`` / ``inline_images`` and CID support, but the payload
construction was still inline in ``send()``; this locks in the extracted pure
builder and proves it serializes HTML, the plain-text alternative (FR-9), CID
inline images (FR-2), and conventional attachments — and that ``send`` still
POSTs exactly what ``build_payload`` produces (existing callers unchanged).

Hermetic ($0, no network — httpx is stubbed for the send-parity test).
"""
from __future__ import annotations

import base64
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "tools" / "internet_print_test"))

import mailer  # noqa: E402


def test_build_payload_serializes_html_from_to_subject():
    pkg = mailer.build_package("SUBJ", "<b>Body</b>", "x@y.com", [])
    p = mailer.build_payload(pkg)
    assert p["from"] == mailer.RESEND_FROM
    assert p["to"] == ["x@y.com"]
    assert p["subject"] == "SUBJ"
    assert p["html"] == "<b>Body</b>"
    assert p["attachments"] == []
    assert "text" not in p  # omitted unless a plain-text alternative is set


def test_build_payload_includes_plain_text_when_set():
    pkg = mailer.build_package("S", "<b>H</b>", "x@y.com", [])
    pkg.text = "PLAIN-TEXT-ALTERNATIVE"
    assert mailer.build_payload(pkg)["text"] == "PLAIN-TEXT-ALTERNATIVE"


def test_build_payload_serializes_conventional_attachment(tmp_path: Path):
    f = tmp_path / "report.md"
    f.write_bytes(b"hello-report")
    pkg = mailer.build_package("S", "<b>H</b>", "x@y.com", [f])
    att = mailer.build_payload(pkg)["attachments"]
    assert len(att) == 1
    assert att[0]["filename"] == "report.md"
    assert base64.b64decode(att[0]["content"]) == b"hello-report"
    assert "content_id" not in att[0]  # conventional attachment, not inline


def test_build_payload_serializes_cid_inline_image_with_content_id(tmp_path: Path):
    img = tmp_path / "print.png"
    img.write_bytes(b"PNGBYTES")
    pkg = mailer.build_package("S", '<img src="cid:print">', "x@y.com", [])
    pkg.inline_images = [{"cid": "print", "path": str(img)}]
    att = mailer.build_payload(pkg)["attachments"]
    assert len(att) == 1
    assert att[0]["content_id"] == "print"
    assert att[0]["filename"] == "print.png"
    assert base64.b64decode(att[0]["content"]) == b"PNGBYTES"


def test_build_payload_drops_over_budget_attachments():
    # A package attachment marked not-included (over budget) is not serialized.
    pkg = mailer.build_package("S", "<b>H</b>", "x@y.com", [])
    pkg.attachments = [{"filename": "big.bin", "path": "/x/big.bin", "bytes": 1,
                        "included": False, "reason": "over budget"}]
    assert mailer.build_payload(pkg)["attachments"] == []


def test_send_posts_exactly_build_payload_so_callers_are_unchanged(monkeypatch):
    # Backward-compatibility proof: send() serializes via build_payload and POSTs
    # precisely that dict — existing callers' behavior is unchanged.
    pkg = mailer.build_package("S", "<b>H</b>", "x@y.com", [])
    pkg.text = "t"
    captured: dict = {}

    class _Resp:
        status_code = 200

        def json(self):
            return {"id": "email-123"}

    class _Client:
        def __init__(self, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def post(self, url, headers=None, json=None):
            captured["url"] = url
            captured["headers"] = headers
            captured["json"] = json
            return _Resp()

    monkeypatch.setattr(mailer.httpx, "Client", _Client)
    monkeypatch.setenv("RESEND_API_KEY", "test-key")

    res = mailer.send(pkg)
    assert res["sent"] is True and res["id"] == "email-123"
    assert captured["json"] == mailer.build_payload(pkg)
    assert captured["headers"]["Authorization"] == "Bearer test-key"
    assert captured["url"] == mailer.RESEND_ENDPOINT
