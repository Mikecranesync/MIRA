"""Package pipeline + CAS — resume, idempotency, dedup, fail-explicit (PR-F).

Synthetic inputs only. The 2-page PDF is hand-rolled minimal PDF bytes; the
split test importorskips pypdfium2 (explicit skip where the wheel is absent).
"""

from __future__ import annotations

import logging

import pytest

pytest.importorskip("pydantic")

from printsense.cas import CAS, sha256_bytes  # noqa: E402
from printsense import package_pipeline as pp  # noqa: E402

PNG = (b"\x89PNG\r\n\x1a\n" + b"synthetic-page-bytes-")


def _ws(tmp_path, tenant="tenant-a"):
    return pp.PackageWorkspace(tmp_path / "ws", tenant)


def test_cas_roundtrip_and_idempotent_put(tmp_path):
    cas = CAS(tmp_path)
    k1 = cas.put(b"hello", "blob")
    k2 = cas.put(b"hello", "blob")
    assert k1 == k2 == sha256_bytes(b"hello")
    assert cas.get("blob", k1) == b"hello"


def test_cas_versioned_derivation_cache(tmp_path):
    cas = CAS(tmp_path)
    cas.cache_put("s" * 64, "ocr", "v1", {"tokens": 3})
    assert cas.cache_get("s" * 64, "ocr", "v1") == {"tokens": 3}
    assert cas.cache_get("s" * 64, "ocr", "v2") is None  # version bump = miss
    assert cas.cache_get("t" * 64, "ocr", "v1") is None  # new source = miss


def test_image_package_ingest_dedup_and_reupload(tmp_path):
    cas = CAS(tmp_path / "cas")
    ws = _ws(tmp_path)
    out = pp.ingest_package(PNG + b"1", ws, cas, filename="page.png")
    assert out["pages"] == 1 and out["reupload"] is False
    again = pp.ingest_package(PNG + b"1", ws, cas, filename="page.png")
    assert again["reupload"] is True


def test_stage_idempotent_resume_and_retry_failed_only(tmp_path):
    cas = CAS(tmp_path / "cas")
    ws = _ws(tmp_path)
    pp.ingest_package(PNG + b"1", ws, cas, filename="p.png")
    calls = []

    def flaky(_bytes, entry):
        calls.append(1)
        if len(calls) == 1:
            raise RuntimeError("transient")
        return {"ok": True}

    r1 = pp.run_stage(ws, cas, "classify", "v1", flaky)
    assert r1["failed"] == 1
    r2 = pp.run_stage(ws, cas, "classify", "v1", flaky)  # retries only failed
    assert r2["ok"] == 1 and len(calls) == 2
    # resume: a fresh workspace object over the same dirs skips via cache
    ws2 = pp.PackageWorkspace(tmp_path / "ws", "tenant-a")
    r3 = pp.run_stage(ws2, cas, "classify", "v1", flaky)
    assert r3["cached"] == 1 and len(calls) == 2


def test_ocr_unavailable_is_explicit_skip(tmp_path):
    from printsense.xref_extractor import OcrUnavailable

    cas = CAS(tmp_path / "cas")
    ws = _ws(tmp_path)
    pp.ingest_package(PNG + b"1", ws, cas, filename="p.png")

    def no_ocr(_b, _e):
        raise OcrUnavailable("tesseract missing")

    r = pp.run_stage(ws, cas, "ocr", "v1", no_ocr)
    assert r["skipped"] == 1 and r["failed"] == 0
    st = ws.manifest["pages"][0]["stages"]["ocr"]
    assert st["status"] == "skipped_ocr_unavailable"


def test_tenant_isolation_enforced(tmp_path):
    _ws(tmp_path, tenant="tenant-a").save()
    with pytest.raises(ValueError):
        pp.PackageWorkspace(tmp_path / "ws", "tenant-b")


def test_logs_carry_hashes_never_content(tmp_path, caplog):
    cas = CAS(tmp_path / "cas")
    ws = _ws(tmp_path)
    secret = PNG + b"CONFIDENTIAL-CONTENT-MARKER"
    with caplog.at_level(logging.INFO, logger="printsense.pipeline"):
        pp.ingest_package(secret, ws, cas, filename="p.png")
    joined = " ".join(r.getMessage() for r in caplog.records)
    assert "CONFIDENTIAL-CONTENT-MARKER" not in joined
    assert "sha=" in joined


def test_unresolved_queue_holds_only_open_resolutions(tmp_path):
    ws = _ws(tmp_path)
    n = pp.queue_unresolved(ws, [
        {"resolution": "resolved"}, {"resolution": "ambiguous"},
        {"resolution": "missing_target"}, {"resolution": "contradictory"}])
    assert n == 3
    assert len(ws.manifest["unresolved_work"]) == 3


def test_pdf_split_streams_pages(tmp_path):
    pdfium = pytest.importorskip("pypdfium2")
    doc = pdfium.PdfDocument.new()
    for _ in range(2):
        doc.new_page(200, 200)
    import io
    buf = io.BytesIO()
    doc.save(buf)
    pages = list(pp.split_pdf_pages(buf.getvalue(), scale=0.5))
    assert [i for i, _ in pages] == [0, 1]
    assert all(png.startswith(b"\x89PNG") for _, png in pages)
