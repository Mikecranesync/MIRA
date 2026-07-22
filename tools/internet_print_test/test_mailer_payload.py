"""Hermetic tests for mailer.build_payload — the pure Resend-payload builder.

Additive to the existing mailer (no network). Adds a plain-text part (FR-9) and
inline content_id (PRD 13.5) without forking the mailer.
"""
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

import mailer  # noqa: E402


def test_build_payload_has_from_to_subject_html():
    pkg = mailer.build_package("SUB", "<b>H</b>", "x@y.com", [])
    p = mailer.build_payload(pkg)
    assert p["from"] and p["to"] == ["x@y.com"]
    assert p["subject"] == "SUB" and p["html"] == "<b>H</b>"
    assert isinstance(p["attachments"], list)
    assert "text" not in p  # omitted unless provided


def test_build_payload_includes_text_when_given():
    pkg = mailer.build_package("SUB", "<b>H</b>", "x@y.com", [])
    p = mailer.build_payload(pkg, text="PLAIN-ALT")
    assert p["text"] == "PLAIN-ALT"


def test_build_payload_threads_content_id_for_inline_image(tmp_path):
    f = tmp_path / "a.png"
    f.write_bytes(b"IMGDATA")
    pkg = mailer.build_package("S", "<b>H</b>", "x@y.com", [f])
    pkg.attachments[0]["content_id"] = "inline-1"
    p = mailer.build_payload(pkg)
    att = p["attachments"]
    assert att and att[0]["filename"] == "a.png"
    assert att[0]["content"]  # base64 body present
    assert att[0]["content_id"] == "inline-1"


def test_build_payload_omits_content_id_when_absent(tmp_path):
    f = tmp_path / "a.png"
    f.write_bytes(b"IMGDATA")
    pkg = mailer.build_package("S", "<b>H</b>", "x@y.com", [f])
    p = mailer.build_payload(pkg)
    assert "content_id" not in p["attachments"][0]
