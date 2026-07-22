"""Print of the Day v2 — send orchestration (PRD FR-6/7/8/15).

REUSES tools/internet_print_test/mailer.py (build_package + send) — does NOT fork
the mailer (PRD 13.1). Enforces the send-gate (recipient / attachment / hash),
wires the inline print (content_id) + plain-text part, attaches the full report,
and blocks duplicate sends with a durable per-send-key marker.
"""
from __future__ import annotations

import hashlib
import sys
from pathlib import Path

_MAILER_DIR = Path(__file__).resolve().parents[1] / "internet_print_test"
if str(_MAILER_DIR) not in sys.path:
    sys.path.insert(0, str(_MAILER_DIR))
import mailer  # noqa: E402  (reuse — do not fork)

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))
import render  # noqa: E402

_UNSET = object()


def _sha256_file(p) -> str:
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def send_case(vm, *, attachment_path, recipient, marker_dir, report_html=None,
              image_cid="potd-print", expected_sha256=_UNSET, send_fn=None,
              build_package=None) -> dict:
    send_fn = send_fn or mailer.send
    build_package = build_package or mailer.build_package
    marker_dir = Path(marker_dir)
    attachment_path = Path(attachment_path)

    # ── send-gate (FR-7): a missing recipient/artifact holds the send ──────────
    if not recipient:
        return {"status": "held", "reason": "recipient missing"}
    if not attachment_path.exists() or attachment_path.stat().st_size == 0:
        return {"status": "held", "reason": f"attachment missing/empty: {attachment_path.name}"}
    expected = vm.source.get("sha256") if expected_sha256 is _UNSET else expected_sha256
    if expected and _sha256_file(attachment_path) != expected:
        return {"status": "held", "reason": "attachment hash mismatch (FR-15)"}

    # ── duplicate-send protection (FR-6/8): one durable key, never re-sent ─────
    key = vm.send_key(recipient)
    marker = marker_dir / f".sent_{key}"
    if marker.exists():
        return {"status": "duplicate", "reason": "already sent", "send_key": key,
                "detail": marker.read_text(encoding="utf-8").strip()}

    # ── build (reuse mailer): inline print + attached report + plain-text part ─
    marker_dir.mkdir(parents=True, exist_ok=True)
    files = [attachment_path]
    if report_html is not None:
        report_path = marker_dir / f"report_{vm.case_id}.html"
        report_path.write_text(report_html, encoding="utf-8")
        files.append(report_path)
    subject = render.render_subject(vm)
    html = render.render_email_html(vm, image_cid=image_cid)
    text = render.render_email_text(vm)
    pkg = build_package(subject, html, recipient, files)
    for a in pkg.attachments:
        if a.get("included") and Path(a["path"]) == attachment_path:
            a["content_id"] = image_cid  # inline the print (PRD 13.5)

    res = send_fn(pkg, text=text)
    if res.get("sent"):
        marker.write_text(f"{res.get('id')} status={res.get('status')}", encoding="utf-8")
        return {"status": "sent", "id": res.get("id"), "send_key": key, "subject": subject}
    return {"status": "failed", "reason": str(res.get("error")), "send_key": key}
