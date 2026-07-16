"""Lead-magnet intake — secure, bounded, tenant-isolated (commercial PR-2).

One page or a small phone-photo set, a question, explicit consent — nothing
else. Hard limits keep unrestricted multi-thousand-page packages OUT of this
surface (those are the managed pilot's job). Files are content-addressed;
original filenames are sanitized display metadata only; logs carry hashes
and statuses, never content or raw names.
"""

from __future__ import annotations

import json
import logging
import re
import time
from pathlib import Path

from pydantic import BaseModel, Field, field_validator

from .cas import CAS, sha256_bytes

logger = logging.getLogger("printsense.intake")

MAX_FILES = 8
MAX_FILE_BYTES = 15 * 1024 * 1024
MAX_TOTAL_BYTES = 60 * 1024 * 1024
MAX_PDF_PAGES = 25
STATUSES = ("received", "queued", "processing", "needs_review",
            "delivered", "failed")

_EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")
_MAGIC = {b"%PDF": "pdf", b"\x89PNG": "png", b"\xff\xd8\xff": "jpg"}


class IntakeRequest(BaseModel):
    work_email: str
    company: str = Field(min_length=1, max_length=200)
    machine_type: str = Field(min_length=1, max_length=200)
    question: str = Field(min_length=5, max_length=2000)
    consent_confidentiality: bool
    request_full_package: bool = False

    model_config = {"extra": "forbid"}

    @field_validator("work_email")
    @classmethod
    def _email(cls, v: str) -> str:
        if not _EMAIL_RE.match(v):
            raise ValueError("invalid work email")
        return v.lower()

    @field_validator("consent_confidentiality")
    @classmethod
    def _consent(cls, v: bool) -> bool:
        if v is not True:
            raise ValueError("confidentiality consent is required")
        return v


class IntakeRefused(ValueError):
    """Submission outside this surface's bounds (explicit, never silent)."""


def _sniff(data: bytes) -> str:
    for magic, kind in _MAGIC.items():
        if data.startswith(magic):
            return kind
    raise IntakeRefused("unsupported file type (PDF, JPG, PNG only)")


def _pdf_pages(data: bytes) -> int | None:
    try:
        import pypdfium2 as pdfium
    except Exception:
        return None  # explicit: page count not verifiable in this env
    doc = pdfium.PdfDocument(data)
    try:
        return len(doc)
    finally:
        doc.close()


def _safe_display_name(name: str) -> str:
    base = re.sub(r"[^A-Za-z0-9._ -]", "_", Path(name).name)[:80]
    return base or "upload"


def submit_intake(req: IntakeRequest, files: list[tuple[str, bytes]],
                  root: str | Path, tenant_id: str) -> dict:
    if not files:
        raise IntakeRefused("at least one file is required")
    if len(files) > MAX_FILES:
        raise IntakeRefused(f"at most {MAX_FILES} files on this surface — "
                            f"request the managed package pilot instead")
    total = sum(len(d) for _, d in files)
    if total > MAX_TOTAL_BYTES:
        raise IntakeRefused("upload too large for this surface — request "
                            "the managed package pilot instead")
    stored = []
    for name, data in files:
        if len(data) > MAX_FILE_BYTES:
            raise IntakeRefused(f"file over {MAX_FILE_BYTES // (1024*1024)}MB")
        kind = _sniff(data)
        if kind == "pdf":
            pages = _pdf_pages(data)
            if pages is not None and pages > MAX_PDF_PAGES:
                raise IntakeRefused(
                    f"PDF has {pages} pages (> {MAX_PDF_PAGES}) — complete "
                    f"packages run through the managed pilot, not this form")
        stored.append((name, data, kind))

    intake_id = sha256_bytes(
        (req.work_email + "|" + str(time.time_ns())).encode())[:20]
    ws_root = Path(root) / "tenants" / tenant_id / intake_id
    cas = CAS(ws_root / "cas")
    file_rows = []
    for name, data, kind in stored:
        sha = cas.put(data, "upload")
        file_rows.append({"sha256": sha, "kind": kind,
                          "display_name": _safe_display_name(name),
                          "bytes": len(data)})
        logger.info("intake=%s tenant=%s file sha=%s kind=%s",
                    intake_id, tenant_id, sha[:12], kind)
    record = {"intake_id": intake_id, "tenant_id": tenant_id,
              "status": "received",
              "request": req.model_dump(),
              "files": file_rows,
              "created_at": time.time(),
              "history": [{"at": time.time(), "status": "received"}]}
    (ws_root / "intake.json").write_text(
        json.dumps(record, indent=1, sort_keys=True), encoding="utf-8")
    set_status(root, tenant_id, intake_id, "queued")
    return {"intake_id": intake_id, "status": "queued",
            "files": len(file_rows),
            "full_package_requested": req.request_full_package}


def _record_path(root, tenant_id, intake_id) -> Path:
    p = Path(root) / "tenants" / tenant_id / intake_id / "intake.json"
    if not p.exists():
        raise KeyError("unknown intake for this tenant")
    return p


def get_intake(root, tenant_id: str, intake_id: str) -> dict:
    return json.loads(_record_path(root, tenant_id, intake_id)
                      .read_text(encoding="utf-8"))


def set_status(root, tenant_id: str, intake_id: str, status: str,
               note: str | None = None) -> dict:
    if status not in STATUSES:
        raise ValueError(f"unknown status {status!r}")
    p = _record_path(root, tenant_id, intake_id)
    rec = json.loads(p.read_text(encoding="utf-8"))
    rec["status"] = status
    rec["history"].append({"at": time.time(), "status": status,
                           **({"note": note} if note else {})})
    p.write_text(json.dumps(rec, indent=1, sort_keys=True), encoding="utf-8")
    logger.info("intake=%s tenant=%s status=%s", intake_id, tenant_id, status)
    return rec
