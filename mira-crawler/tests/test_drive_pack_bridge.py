"""Tests for the manual-KB-ingest → drive-pack update-candidate bridge.

Offline, CI-safe: a tmp registry fixture + a tmp PDF whose hash we control. The
bridge is default-off, fail-open, review-only, and must never touch trusted
packs or affect KB ingest — every one of those is asserted here."""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

_CRAWLER = Path(__file__).resolve().parent.parent  # mira-crawler/
if str(_CRAWLER) not in sys.path:
    sys.path.insert(0, str(_CRAWLER))

import drive_pack_bridge as bridge  # noqa: E402

_ON = {"MIRA_DRIVE_PACK_BRIDGE": "1"}
_ENTRY = {
    "url": "https://example.com/docs/pf525.pdf",
    "manufacturer": "Allen-Bradley",
    "model": "PowerFlex-525",
}


def _pdf(tmp: Path, data: bytes = b"%PDF-1.4 fake manual bytes") -> tuple[Path, str]:
    p = tmp / "pf525.pdf"
    p.write_bytes(data)
    return p, hashlib.sha256(data).hexdigest()


def _registry(tmp: Path, *, pdf_sha256) -> Path:
    reg = {
        "schema_version": 1,
        "manuals": [
            {
                "manual_id": "test_pf525",
                "vendor": "Rockwell Automation",
                "product_family": "PowerFlex 525",
                "applicable_drive_models": ["PowerFlex 525"],
                "manual_title": "PowerFlex 525 User Manual",
                "publication": "520-UM001O-EN-E",
                "revision": "O",
                "pack_id": "powerflex_525",
                "automatable": False,
                "source_classification": ["official"],
                "pack_trust_status": "candidate",
                "pdf_sha256": pdf_sha256,
            }
        ],
    }
    p = tmp / "sources.json"
    p.write_text(json.dumps(reg), encoding="utf-8")
    return p


def _call(tmp, entry=_ENTRY, *, pdf, registry_path, env=_ON, stop=None, cdir=None, **kw):
    return bridge.maybe_create_candidate(
        entry,
        local_pdf=pdf,
        registry_path=registry_path,
        candidate_dir=cdir or (tmp / "candidates"),
        stop_flag=stop or (tmp / "NO_STOP"),
        env=env,
        now_iso="2026-07-06T12:00:00+00:00",
        **kw,
    )


# --- disabled / stop switch -------------------------------------------------


def test_bridge_disabled_creates_nothing(tmp_path):
    pdf, sha = _pdf(tmp_path)
    reg = _registry(tmp_path, pdf_sha256="deadbeef")
    r = _call(tmp_path, pdf=pdf, registry_path=reg, env={})  # flag not set
    assert r["status"] == "disabled"
    assert not (tmp_path / "candidates").exists()


def test_stop_ingest_prevents_bridge_work(tmp_path):
    pdf, sha = _pdf(tmp_path)
    reg = _registry(tmp_path, pdf_sha256="deadbeef")
    stop = tmp_path / "STOP_INGEST"
    stop.write_text("paused", encoding="utf-8")
    r = _call(tmp_path, pdf=pdf, registry_path=reg, stop=stop)
    assert r["status"] == "stopped"
    assert not (tmp_path / "candidates").exists()


# --- fail-open paths --------------------------------------------------------


def test_missing_local_pdf_fails_open(tmp_path):
    reg = _registry(tmp_path, pdf_sha256="deadbeef")
    # local_pdf None + a manuals_root with no cached file → resolve returns None.
    r = bridge.maybe_create_candidate(
        _ENTRY,
        local_pdf=None,
        registry_path=reg,
        manuals_root=tmp_path / "empty",
        candidate_dir=tmp_path / "candidates",
        stop_flag=tmp_path / "NO",
        env=_ON,
    )
    assert r["status"] == "skipped" and r["reason"] == "no_local_pdf"
    assert "report" in r


def test_no_registry_match_fails_open_with_report(tmp_path):
    pdf, sha = _pdf(tmp_path)
    reg = _registry(tmp_path, pdf_sha256="deadbeef")
    entry = {"url": "https://x/y.pdf", "manufacturer": "Acme", "model": "Nonexistent-9000"}
    r = _call(tmp_path, entry=entry, pdf=pdf, registry_path=reg)
    assert r["status"] == "skipped" and r["reason"] == "no_registry_match"
    assert "Nonexistent-9000" in r["report"]


def test_bridge_failure_fails_open(tmp_path):
    pdf, sha = _pdf(tmp_path)
    # A malformed registry file makes load_registry() raise mid-bridge; the error
    # must be swallowed into status=error and NEVER propagate (KB ingest safe).
    bad = tmp_path / "sources.json"
    bad.write_text("{ this is not valid json", encoding="utf-8")
    r = _call(tmp_path, pdf=pdf, registry_path=bad)
    assert r["status"] == "error"
    assert "error" in r
    assert not (tmp_path / "candidates").exists()


# --- unchanged / changed / new ---------------------------------------------


def test_unchanged_hash_creates_no_candidate(tmp_path):
    pdf, sha = _pdf(tmp_path)
    reg = _registry(tmp_path, pdf_sha256=sha)  # registered hash == this PDF
    r = _call(tmp_path, pdf=pdf, registry_path=reg)
    assert r["status"] == "unchanged"
    assert not (tmp_path / "candidates").exists()


def test_changed_hash_creates_candidate(tmp_path):
    pdf, sha = _pdf(tmp_path)
    reg = _registry(tmp_path, pdf_sha256="0" * 64)  # different registered hash
    r = _call(tmp_path, pdf=pdf, registry_path=reg)
    assert r["status"] == "candidate_created"
    assert r["change_state"] == "changed_by_hash"
    assert Path(r["candidate_path"]).is_file()


def test_new_known_manual_creates_candidate(tmp_path):
    pdf, sha = _pdf(tmp_path)
    reg = _registry(tmp_path, pdf_sha256=None)  # known family, never hashed
    r = _call(tmp_path, pdf=pdf, registry_path=reg)
    assert r["status"] == "candidate_created"
    assert r["change_state"] == "needs_initial_candidate"


# --- trust-preserving guarantees -------------------------------------------


def _created_record(tmp_path):
    pdf, sha = _pdf(tmp_path)
    reg = _registry(tmp_path, pdf_sha256="0" * 64)
    r = _call(tmp_path, pdf=pdf, registry_path=reg)
    return (
        json.loads(Path(r["candidate_path"]).read_text(encoding="utf-8")),
        r["candidate_path"],
        sha,
    )


def test_candidate_is_review_only_not_trusted(tmp_path):
    rec, _, _ = _created_record(tmp_path)
    assert rec["review_only"] is True
    assert rec["promoted"] is False
    assert rec["trust_status"] == "candidate"  # never 'trusted'


def test_candidate_never_targets_trusted_pack_tree(tmp_path):
    _, path, _ = _created_record(tmp_path)
    # Written only under the candidate dir; never into the live served packs tree.
    assert "drive_packs/packs" not in path.replace("\\", "/")
    assert str(tmp_path / "candidates") in path


def test_candidate_writes_only_under_candidate_dir(tmp_path):
    """Bridge does not change runtime DriveSense: its ONLY side effect is the
    one candidate file under the candidate dir."""
    _, path, _ = _created_record(tmp_path)
    written = list((tmp_path / "candidates").rglob("*"))
    files = [p for p in written if p.is_file()]
    assert len(files) == 1 and str(files[0]) == path


def test_provenance_is_complete(tmp_path):
    rec, _, sha = _created_record(tmp_path)
    ms = rec["manual_source"]
    assert ms["manufacturer"] == "Allen-Bradley"
    assert ms["model"] == "PowerFlex-525"
    assert ms["manual_id"] == "test_pf525"
    assert ms["source_url"] == _ENTRY["url"]
    assert ms["publication"] == "520-UM001O-EN-E"
    assert rec["pdf_sha256"] == sha
    assert rec["ingest_timestamp"] == "2026-07-06T12:00:00+00:00"
    assert rec["local_pdf_path"].endswith("pf525.pdf")
    assert rec["next_step"].startswith(
        "python tools/drive-pack-extract/registry/update_candidate.py"
    )


# --- pure helpers -----------------------------------------------------------


def test_resolve_local_pdf_mirrors_pipeline_convention(tmp_path):
    root = tmp_path / "manuals"
    dest = root / "Allen-Bradley" / "PowerFlex-525" / "pf525.pdf"
    dest.parent.mkdir(parents=True)
    dest.write_bytes(b"x")
    got = bridge.resolve_local_pdf(_ENTRY, root)
    assert got == dest


def test_resolve_local_pdf_absent_returns_none(tmp_path):
    assert bridge.resolve_local_pdf(_ENTRY, tmp_path / "empty") is None


def test_match_prefers_model_over_vendor_string():
    # Discovery says "Allen-Bradley"; registry vendor says "Rockwell" — model wins.
    registry = {
        "manuals": [
            {
                "manual_id": "x",
                "vendor": "Rockwell Automation",
                "product_family": "PowerFlex 525",
                "applicable_drive_models": ["PowerFlex 525"],
            }
        ]
    }
    assert (
        bridge.match_registry_entry(registry, "Allen-Bradley", "PowerFlex-525")["manual_id"] == "x"
    )
    assert bridge.match_registry_entry(registry, "Allen-Bradley", "GS10") is None
