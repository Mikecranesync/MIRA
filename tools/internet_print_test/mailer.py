"""Email delivery via the repo's approved mechanism (Resend), extended with attachments.

Reuses the Resend-over-httpx pattern from mira-bots/shared/notifications/morning_report.py and
adds base64 attachments (the Resend API supports them; the existing helper doesn't). Credentials
load from Doppler (`RESEND_API_KEY`); nothing is printed. `--dry-run` builds the complete package
(subject, HTML, attachment manifest) WITHOUT sending. If attachments exceed the size budget, we
drop the largest (the original drawing) and keep the tested-page PNG + report, always including the
public source URL in the body — never uploading the drawing to an unapproved third-party service.
"""

from __future__ import annotations

import base64
import json
import os
from dataclasses import dataclass
from pathlib import Path

import httpx

RESEND_ENDPOINT = "https://api.resend.com/emails"
RESEND_FROM = os.getenv("RESEND_FROM", "Mike at FactoryLM <noreply@factorylm.com>")
# Resend total-payload budget is ~40 MB; stay well under with base64 (~4/3) overhead.
ATTACH_BUDGET_BYTES = 18 * 1024 * 1024


@dataclass
class EmailPackage:
    subject: str
    html: str
    recipient: str
    attachments: list[dict]      # [{filename, path, bytes, included, reason}]
    dropped: list[str]


def build_package(subject: str, html: str, recipient: str, files: list[Path]) -> EmailPackage:
    """Assemble the package, deciding which attachments fit the budget (largest dropped first)."""
    entries = []
    for f in files:
        f = Path(f)
        if not f.exists():
            continue
        entries.append({"filename": f.name, "path": str(f), "bytes": f.stat().st_size,
                        "included": True, "reason": ""})
    # Greedily keep smallest-first until the budget is hit; drop the rest (largest last).
    total = 0
    dropped = []
    for e in sorted(entries, key=lambda x: x["bytes"]):
        if total + e["bytes"] <= ATTACH_BUDGET_BYTES:
            total += e["bytes"]
        else:
            e["included"] = False
            e["reason"] = "over attachment budget — source URL is in the email body"
            dropped.append(e["filename"])
    return EmailPackage(subject=subject, html=html, recipient=recipient,
                        attachments=entries, dropped=dropped)


def package_summary(pkg: EmailPackage) -> str:
    lines = [f"TO: {pkg.recipient}", f"SUBJECT: {pkg.subject}", "ATTACHMENTS:"]
    for a in pkg.attachments:
        tag = "attach" if a["included"] else "DROPPED"
        lines.append(f"  [{tag}] {a['filename']} ({a['bytes']:,} B){' — ' + a['reason'] if a['reason'] else ''}")
    lines.append(f"HTML: {len(pkg.html):,} chars")
    return "\n".join(lines)


def build_payload(pkg: EmailPackage, text: str | None = None) -> dict:
    """Pure Resend payload from a package. Additive over the original inline dict:
    threads per-attachment inline ``content_id`` (PRD 13.5) and an optional
    plain-text ``text`` part (FR-9). Existing callers set neither, so behavior is
    unchanged for them."""
    attachments = []
    for a in pkg.attachments:
        if not a["included"]:
            continue
        entry = {"filename": a["filename"],
                 "content": base64.b64encode(Path(a["path"]).read_bytes()).decode()}
        if a.get("content_id"):
            entry["content_id"] = a["content_id"]
        attachments.append(entry)
    payload = {
        "from": RESEND_FROM,
        "to": [pkg.recipient],
        "subject": pkg.subject,
        "html": pkg.html,
        "attachments": attachments,
    }
    if text is not None:
        payload["text"] = text
    return payload


def send(pkg: EmailPackage, text: str | None = None) -> dict:
    """Send via Resend. Returns {sent, status, id/error}. Requires RESEND_API_KEY (Doppler)."""
    api_key = os.getenv("RESEND_API_KEY", "")
    if not api_key:
        return {"sent": False, "status": None, "error": "RESEND_API_KEY not set (load via Doppler)"}

    payload = build_payload(pkg, text=text)
    try:
        with httpx.Client(timeout=30) as client:
            resp = client.post(RESEND_ENDPOINT,
                               headers={"Authorization": f"Bearer {api_key}"},
                               json=payload)
        ok = resp.status_code < 300
        body = {}
        try:
            body = resp.json()
        except Exception:  # noqa: BLE001
            pass
        return {"sent": ok, "status": resp.status_code,
                "id": body.get("id"), "error": None if ok else str(body)[:300]}
    except httpx.HTTPError as e:
        return {"sent": False, "status": None, "error": f"{type(e).__name__}: {e}"}


def default_recipient() -> str:
    return os.getenv("MORNING_REPORT_EMAIL", "harperhousebuyers@gmail.com")


def write_dry_run(out_dir: Path, pkg: EmailPackage) -> Path:
    """Persist the full email package for inspection without sending."""
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "email.html").write_text(pkg.html, encoding="utf-8")
    (out_dir / "email_manifest.json").write_text(
        json.dumps({"subject": pkg.subject, "recipient": pkg.recipient,
                    "attachments": pkg.attachments, "dropped": pkg.dropped}, indent=2),
        encoding="utf-8")
    return out_dir / "email_manifest.json"
