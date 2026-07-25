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
    text: str | None = None      # FR-9 plain-text alternative
    inline_images: list[dict] | None = None  # [{cid, path}] — CID-embedded (FR-2)


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


def send(pkg: EmailPackage) -> dict:
    """Send via Resend. Returns {sent, status, id/error}. Requires RESEND_API_KEY (Doppler)."""
    api_key = os.getenv("RESEND_API_KEY", "")
    if not api_key:
        return {"sent": False, "status": None, "error": "RESEND_API_KEY not set (load via Doppler)"}

    attachments = []
    for a in pkg.attachments:
        if not a["included"]:
            continue
        data = Path(a["path"]).read_bytes()
        attachments.append({"filename": a["filename"], "content": base64.b64encode(data).decode()})
    # CID-embedded inline images (FR-2): a content_id makes the image render
    # inline via `cid:` in the HTML without any public URL.
    for img in pkg.inline_images or []:
        data = Path(img["path"]).read_bytes()
        attachments.append({
            "filename": Path(img["path"]).name,
            "content": base64.b64encode(data).decode(),
            "content_id": img["cid"],
        })

    payload = {
        "from": RESEND_FROM,
        "to": [pkg.recipient],
        "subject": pkg.subject,
        "html": pkg.html,
        "attachments": attachments,
    }
    if pkg.text:  # FR-9 plain-text alternative
        payload["text"] = pkg.text
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


def verify_attachments(files: list[Path], expected_sha256: dict[str, str]) -> list[str]:
    """FR-15: before send, verify each expected attachment exists, is non-empty,
    and matches the report's recorded hash. Returns the list of problems (empty
    == all good). The send gate must hold when this is non-empty."""
    import hashlib as _h  # noqa: PLC0415

    problems: list[str] = []
    for f in files:
        f = Path(f)
        if not f.exists():
            problems.append(f"missing:{f.name}")
            continue
        if f.stat().st_size == 0:
            problems.append(f"empty:{f.name}")
            continue
        want = expected_sha256.get(f.name)
        if want:
            got = _h.sha256(f.read_bytes()).hexdigest()
            if got != want:
                problems.append(f"hash_mismatch:{f.name}")
    return problems


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
