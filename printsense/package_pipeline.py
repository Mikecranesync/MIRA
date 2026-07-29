"""Durable, resumable package pipeline (PR-F).

upload → CAS → split → hash → dedup → OCR → classify → inventory → xref →
graph proposal → unresolved-work queue. Every stage is idempotent: results
key on ``(page_sha, stage, version)`` in the CAS derivation cache, so a
resumed run skips finished work and retries only failures. Page identity is
its content hash (survives reordering); a reupload is detected by the
package hash. Tenancy is a manifest field; logs carry hashes only.

PDF splitting streams page-by-page via **pypdfium2** (explicit dependency
decision: Apache-2.0/BSD-3, pure-wheel, added to printsense/requirements.txt;
absent → :class:`SplitUnavailable`, an explicit skipped status — never a
silent pass). OCR uses the xref_extractor adapter; when Tesseract is absent
the stage records ``skipped_ocr_unavailable`` explicitly.
"""

from __future__ import annotations

import json
import logging
import time
from pathlib import Path

from .cas import CAS

logger = logging.getLogger("printsense.pipeline")

PIPELINE_VERSION = "package_pipeline_v1"
STAGES = ("split", "ocr", "classify", "inventory", "xref", "graph_proposal")


class SplitUnavailable(RuntimeError):
    """pypdfium2 missing — splitting cannot run (explicit, never silent)."""


def split_pdf_pages(pdf_bytes: bytes, scale: float = 2.0):
    """Yield (index, png_bytes) one page at a time (bounded memory)."""
    try:
        import pypdfium2 as pdfium
    except Exception as exc:  # pragma: no cover - environment-dependent
        raise SplitUnavailable(f"pypdfium2 unavailable: {exc}") from exc
    import io

    doc = pdfium.PdfDocument(pdf_bytes)
    try:
        for i in range(len(doc)):
            page = doc[i]
            img = page.render(scale=scale).to_pil()
            buf = io.BytesIO()
            img.save(buf, "PNG")
            page.close()
            yield i, buf.getvalue()
    finally:
        doc.close()


class PackageWorkspace:
    """Manifest + per-page/per-stage status, file-backed and resumable."""

    def __init__(self, root: str | Path, tenant_id: str):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.manifest_path = self.root / "manifest.json"
        if self.manifest_path.exists():
            self.manifest = json.loads(self.manifest_path.read_text("utf-8"))
        else:
            self.manifest = {"tenant_id": tenant_id, "package_sha": None,
                             "pipeline_version": PIPELINE_VERSION,
                             "pages": [], "unresolved_work": []}
        if self.manifest.get("tenant_id") != tenant_id:
            raise ValueError("workspace belongs to a different tenant")

    def save(self) -> None:
        self.manifest_path.write_text(
            json.dumps(self.manifest, indent=1, sort_keys=True), "utf-8")

    def page(self, page_sha: str) -> dict:
        for p in self.manifest["pages"]:
            if p["page_sha"] == page_sha:
                return p
        raise KeyError(page_sha)


def ingest_package(data: bytes, ws: PackageWorkspace, cas: CAS,
                   filename: str = "package.pdf") -> dict:
    """upload -> CAS -> split -> hash -> dedup. Returns ingest summary."""
    package_sha = cas.put(data, "package")
    reupload = ws.manifest.get("package_sha") == package_sha
    ws.manifest["package_sha"] = package_sha
    ws.manifest["source_name"] = filename
    logger.info("package ingest sha=%s reupload=%s", package_sha[:12], reupload)
    if reupload and ws.manifest["pages"]:
        ws.save()
        return {"package_sha": package_sha, "reupload": True,
                "pages": len(ws.manifest["pages"])}
    seen: dict[str, int] = {}
    if filename.lower().endswith(".pdf"):
        pages = split_pdf_pages(data)
    else:  # single image package
        pages = [(0, data)]
    for idx, png in pages:
        psha = cas.put(png, "page")
        entry = {"page_sha": psha, "source_index": idx, "stages": {},
                 "duplicate_of": None}
        if psha in seen:
            entry["duplicate_of"] = seen[psha]
            entry["stages"]["dedup"] = {"status": "duplicate"}
        else:
            seen[psha] = idx
        ws.manifest["pages"].append(entry)
    ws.save()
    return {"package_sha": package_sha, "reupload": False,
            "pages": len(ws.manifest["pages"]),
            "duplicates": sum(1 for p in ws.manifest["pages"]
                              if p["duplicate_of"] is not None)}


def run_stage(ws: PackageWorkspace, cas: CAS, stage: str, version: str,
              fn) -> dict:
    """Run one stage across pages: idempotent, resume-safe, retry-failed-only.

    ``fn(page_bytes, page_entry) -> dict payload``; result cached under
    ``(page_sha, stage, version)``. Exceptions mark the page-stage failed
    (recorded reason) and processing continues — a re-run retries ONLY
    failed/absent pages.
    """
    done = skipped = failed = cached = 0
    for entry in ws.manifest["pages"]:
        if entry.get("duplicate_of") is not None:
            continue
        psha = entry["page_sha"]
        if cas.cache_get(psha, stage, version) is not None:
            entry["stages"][stage] = {"status": "ok", "cached": True}
            cached += 1
            continue
        try:
            payload = fn(cas.get("page", psha), entry)
        except Exception as exc:
            reason = f"{type(exc).__name__}"
            status = ("skipped_ocr_unavailable"
                      if reason == "OcrUnavailable" else "failed")
            entry["stages"][stage] = {"status": status, "reason": reason,
                                      "at": time.time()}
            logger.warning("stage=%s page=%s status=%s", stage, psha[:12], status)
            failed += status == "failed"
            skipped += status != "failed"
            continue
        cas.cache_put(psha, stage, version, payload)
        entry["stages"][stage] = {"status": "ok", "cached": False}
        done += 1
    ws.save()
    return {"stage": stage, "ok": done, "cached": cached,
            "failed": failed, "skipped": skipped}


def queue_unresolved(ws: PackageWorkspace, records: list[dict]) -> int:
    """Durably queue ambiguous/missing/contradictory work for review."""
    open_items = [r for r in records
                  if r.get("resolution") in ("ambiguous", "missing_target",
                                             "contradictory")]
    ws.manifest["unresolved_work"] = open_items
    ws.save()
    return len(open_items)
