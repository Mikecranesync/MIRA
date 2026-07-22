"""Hermetic tests for the Print of the Day v2 send orchestration (PRD FR-6/7/8/15).

Reuses the real mailer.build_package (pure) but injects a fake sender so no
network/email happens. Covers the send-gate, attachment-hash verify, inline
content_id + text wiring, and duplicate-send protection.
"""
import hashlib
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

import send  # noqa: E402
import view_model as vm  # noqa: E402


def _vm(**over):
    d = dict(
        case_id="potd-003", sequence_number=3, title="PowerFlex 523 Control I/O Wiring",
        evaluation_date="2026-07-21", verdict="gold_candidate", overall_grade="A",
        claim_counts={"confirmed": 20, "incorrect": 0, "unsupported": 0, "nuance": 1},
        dimension_grades={"accuracy": "A", "evidence": "A", "honesty": "A",
                          "safety": "pass", "rights": "evaluation_only"},
        source={"image_ref": "print.png", "sheet_label": "Control I/O Wiring",
                "rights_label": "evaluation_only", "sha256": "abc123"},
        blind_summary="PrintSense identified a PowerFlex 523 control I/O reference.",
        key_findings=[{"type": "confirmed", "title": "Terminals", "summary": "all correct"}],
        pipeline_health={"status": "degraded", "judge": "manual_fallback",
                         "ocr_crosscheck": "unavailable", "messages": []},
        report={"version": 1, "sha256": "def456", "url": None},
    )
    d.update(over)
    return vm.build_view_model(**d)


class _FakeSender:
    def __init__(self, ok=True):
        self.ok, self.pkg, self.text, self.calls = ok, None, None, 0

    def __call__(self, pkg, text=None):
        self.calls += 1
        self.pkg, self.text = pkg, text
        return {"sent": self.ok, "status": 200 if self.ok else 500,
                "id": "fake-id" if self.ok else None, "error": None if self.ok else "boom"}


def _png(tmp_path, data=b"PNGBYTES"):
    p = tmp_path / "print.png"
    p.write_bytes(data)
    return p


def test_holds_when_recipient_missing(tmp_path):
    r = send.send_case(_vm(), attachment_path=_png(tmp_path), recipient="",
                       marker_dir=tmp_path, send_fn=_FakeSender())
    assert r["status"] == "held" and "recipient" in r["reason"]


def test_holds_when_attachment_missing(tmp_path):
    r = send.send_case(_vm(), attachment_path=tmp_path / "nope.png", recipient="a@b.com",
                       marker_dir=tmp_path, send_fn=_FakeSender())
    assert r["status"] == "held" and "attachment" in r["reason"]


def test_holds_on_attachment_hash_mismatch(tmp_path):
    r = send.send_case(_vm(), attachment_path=_png(tmp_path), recipient="a@b.com",
                       marker_dir=tmp_path, expected_sha256="deadbeef", send_fn=_FakeSender())
    assert r["status"] == "held" and "hash" in r["reason"]


def test_sends_with_content_id_and_text_then_writes_marker(tmp_path):
    p = _png(tmp_path)
    h = hashlib.sha256(p.read_bytes()).hexdigest()
    fake = _FakeSender()
    r = send.send_case(_vm(), attachment_path=p, recipient="a@b.com", marker_dir=tmp_path,
                       expected_sha256=h, report_html="<html>REPORT</html>", send_fn=fake)
    assert r["status"] == "sent" and r["id"] == "fake-id"
    # marker written, keyed by the send_key
    key = _vm().send_key("a@b.com")
    assert (tmp_path / f".sent_{key}").exists()
    # the package carried the print (inline content_id) + the report; text part passed
    assert fake.pkg is not None and fake.text and "Gold Candidate" in fake.text
    png = [a for a in fake.pkg.attachments if a["filename"] == "print.png"][0]
    assert png.get("content_id")  # inline image wired
    assert any(a["filename"].endswith(".html") for a in fake.pkg.attachments)  # report attached


def test_duplicate_send_is_blocked_and_does_not_call_mailer(tmp_path):
    p = _png(tmp_path)
    h = hashlib.sha256(p.read_bytes()).hexdigest()
    kw = dict(attachment_path=p, recipient="a@b.com", marker_dir=tmp_path, expected_sha256=h)
    first = send.send_case(_vm(), send_fn=_FakeSender(), **kw)
    assert first["status"] == "sent"
    again = _FakeSender()
    second = send.send_case(_vm(), send_fn=again, **kw)
    assert second["status"] == "duplicate"
    assert again.calls == 0  # FR-6: never re-sent


def test_failed_send_does_not_write_marker(tmp_path):
    p = _png(tmp_path)
    h = hashlib.sha256(p.read_bytes()).hexdigest()
    r = send.send_case(_vm(), attachment_path=p, recipient="a@b.com", marker_dir=tmp_path,
                       expected_sha256=h, send_fn=_FakeSender(ok=False))
    assert r["status"] == "failed"
    key = _vm().send_key("a@b.com")
    assert not (tmp_path / f".sent_{key}").exists()  # can retry after a fix
