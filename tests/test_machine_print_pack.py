"""Hermetic tests for the MIRA Print Pack build/validate pipeline.

No DB, no network. Drives build_pack.py / validate_pack.py via subprocess
(sys.executable) rather than importing them as modules, so the test exercises
the exact CLI contract a real invocation uses and stays isolated from this
process's own sys.path/module-cache state.

Golden-diff scope (deliberately narrowed -- see CROSS-PLATFORM NOTE below):
the cross-run byte-diff between a fresh rebuild and the committed golden
bundle (machine-print-pack/examples/cv-101) covers only the deterministic
TEXT/DATA artifacts: data/*.csv, data/*.json, data/*.yaml, evidence/*.md,
evidence/*.csv, open_items/*, approval/*.yaml, pack_manifest.{json,yaml},
README.md.

CROSS-PLATFORM NOTE: prints/**, worksheets/*.pdf, and evidence/photos/** are
EXCLUDED from that cross-run diff. fitz/PyMuPDF PDF+PNG rendering (and
Pillow's JPEG re-encode for redacted photos) is deterministic on the SAME
machine/library-version (proven separately by a local double-build byte-diff
during development -- see the build session notes) but is NOT guaranteed
byte-identical across OS/font stacks. This test may run on Linux CI while the
committed golden bundle was built on Windows, so binary render output is not
a valid cross-run comparison target; the text/data backbone is.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
BUILD_DIR = REPO_ROOT / "machine-print-pack" / "build"
PACKAGE_DIR = REPO_ROOT / "plc" / "conv_simple_electrical"
INTAKE = REPO_ROOT / "machine-print-pack" / "examples" / "cv-101" / "intake_manifest.yaml"
GOLDEN_BUNDLE = REPO_ROOT / "machine-print-pack" / "examples" / "cv-101"
AS_OF = "2026-07-11"
ASSET_TAG = "CV-101"

# Text/data artifacts covered by the cross-run golden byte-diff (see module
# docstring CROSS-PLATFORM NOTE for why binary render output is excluded).
_GOLDEN_DIFF_GLOBS = (
    "data/*.csv",
    "data/*.json",
    "data/*.yaml",
    "evidence/*.md",
    "evidence/*.csv",
    "open_items/*",
    "approval/*.yaml",
    "pack_manifest.json",
    "pack_manifest.yaml",
    "README.md",
)

_SHEET_BASENAMES = {
    "E-001": "E-001_cover",
    "E-002": "E-002_power_oneline",
    "E-003": "E-003_vfd_power",
    "E-004": "E-004_24vdc_control_power",
    "E-005": "E-005_plc_inputs",
    "E-006": "E-006_plc_outputs",
    "E-007": "E-007_rs485_modbus",
    "E-008": "E-008_terminal_strip_wire_list",
    "E-009": "E-009_open_items",
}


def _run_build(out_dir: Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        [
            sys.executable,
            str(BUILD_DIR / "build_pack.py"),
            "--package",
            str(PACKAGE_DIR),
            "--intake",
            str(INTAKE),
            "--as-of",
            AS_OF,
            "--out",
            str(out_dir),
            "--redact",
        ],
        capture_output=True,
        text=True,
        cwd=str(REPO_ROOT),
    )


def _golden_diff_relpaths(root: Path) -> set[str]:
    paths = set()
    for pattern in _GOLDEN_DIFF_GLOBS:
        for p in root.glob(pattern):
            if p.is_file():
                paths.add(p.relative_to(root).as_posix())
    return paths


@pytest.fixture(scope="module")
def rebuilt_bundle(tmp_path_factory) -> Path:
    """Rebuild the CV-101 bundle to an isolated tmp dir once per test module."""
    # build_pack.py renders sheet PDFs/PNGs via fitz/PyMuPDF (validate_model.py's
    # raster-parity gate), so a full rebuild cannot run without it. Skip these
    # rebuild tests where PyMuPDF is absent (e.g. the lean "Eval Offline" job that
    # sweeps all of tests/) -- they run in the dedicated "Machine Print Pack" CI
    # step, which installs pymupdf. The fitz-independent tests below still run
    # everywhere (validate_pack.py degrades gracefully without fitz).
    pytest.importorskip("fitz", reason="needs PyMuPDF to render sheets")
    out = tmp_path_factory.mktemp("cv101_rebuild") / "cv-101"
    result = _run_build(out)
    assert result.returncode == 0, (
        f"build_pack.py failed (exit {result.returncode}):\n"
        f"--- stdout ---\n{result.stdout}\n--- stderr ---\n{result.stderr}"
    )
    return out


def test_build_pack_succeeds(rebuilt_bundle: Path) -> None:
    """The build actually produced a bundle directory (fixture already
    asserted the exit code; this names the artifact explicitly for a clear
    failure if the fixture is ever refactored)."""
    assert rebuilt_bundle.is_dir()
    assert (rebuilt_bundle / "pack_manifest.json").is_file()


def test_golden_text_data_artifacts_byte_identical(rebuilt_bundle: Path) -> None:
    """Determinism/golden guard: same inputs + same --as-of produces a
    byte-identical TEXT/DATA backbone as the committed example (the golden
    reference). This is the cross-run determinism proof for CI; the fuller
    same-machine proof (including all PDFs/PNGs) is documented in the build
    session notes and is captured by the committed CHECKSUMS.txt."""
    golden_paths = _golden_diff_relpaths(GOLDEN_BUNDLE)
    rebuilt_paths = _golden_diff_relpaths(rebuilt_bundle)
    assert golden_paths, (
        "no golden text/data artifacts found -- golden bundle missing or globs wrong"
    )
    assert golden_paths == rebuilt_paths, (
        f"file set mismatch.\n"
        f"only in golden bundle: {sorted(golden_paths - rebuilt_paths)}\n"
        f"only in rebuild:       {sorted(rebuilt_paths - golden_paths)}"
    )
    mismatches = []
    for rel in sorted(golden_paths):
        golden_bytes = (GOLDEN_BUNDLE / rel).read_bytes()
        rebuilt_bytes = (rebuilt_bundle / rel).read_bytes()
        if golden_bytes != rebuilt_bytes:
            mismatches.append(rel)
    assert not mismatches, f"byte-for-byte mismatch in: {mismatches}"


def test_validate_pack_passes_on_committed_bundle() -> None:
    """validate_pack.py's checks M-R must not report a CRITICAL finding
    (exit 2, "never ship") on the committed golden bundle.

    NOTE: this asserts exit code in (0, 1), not strictly == 0. SPEC.md's own
    exit-code contract is 0=pass, 1=recoverable warnings, 2=critical/never
    ship -- both 0 and 1 mean "fit to ship". A faithful implementation of
    check M (scoped to devices/terminals/wires/e007/e002 per SPEC.md, wider
    than the original validate_model.py gate's wires-only D/E checks) and
    check N surfaced real, narrow, pre-existing gaps in the CV-101 model that
    predate this tooling and are outside this feature's file scope to fix
    (the model lives under plc/conv_simple_electrical/, not under
    machine-print-pack/): a handful of devices.yaml/terminals.yaml rows carry
    no row-level citation of their own (backed only by their owning sheet's
    `sources:` annotation block), and one open one-directional
    cross-reference between E-005 and E-006 (S2's pushbutton contact vs. its
    lamp). Both are WARN-severity by design -- see validate_pack.py's check_M
    and check_N docstrings for the full rationale against RUBRIC.md's own
    6-item hard-fail taxonomy, which does not list either defect class.
    """
    result = subprocess.run(
        [sys.executable, str(BUILD_DIR / "validate_pack.py"), "--bundle", str(GOLDEN_BUNDLE)],
        capture_output=True,
        text=True,
        cwd=str(REPO_ROOT),
    )
    assert result.returncode in (0, 1), (
        f"validate_pack.py reported a CRITICAL finding (exit {result.returncode}):\n{result.stdout}"
    )


def test_validate_pack_degrades_without_fitz(tmp_path: Path) -> None:
    """validate_pack.py must still run its pure data checks (M/N/O/P/R,
    Q(iii)/(iv)) and SKIP (not crash) the rendered-PDF text checks (Q(i)/(ii))
    when fitz/PyMuPDF is unavailable."""
    blocker = tmp_path / "block_fitz"
    blocker.mkdir()
    (blocker / "fitz.py").write_text("raise ImportError('blocked for test')\n", encoding="utf-8")
    existing_pythonpath = os.environ.get("PYTHONPATH", "")
    new_pythonpath = str(blocker) + (
        os.pathsep + existing_pythonpath if existing_pythonpath else ""
    )
    env = {**os.environ, "PYTHONPATH": new_pythonpath}
    result = subprocess.run(
        [sys.executable, str(BUILD_DIR / "validate_pack.py"), "--bundle", str(GOLDEN_BUNDLE)],
        capture_output=True,
        text=True,
        cwd=str(REPO_ROOT),
        env=env,
    )
    assert "SKIP" in result.stdout
    assert "fitz" in result.stdout.lower() or "pymupdf" in result.stdout.lower()
    assert "Traceback" not in result.stdout
    assert result.returncode in (0, 1, 2)  # must exit cleanly either way, never crash


def test_bundle_structural_completeness() -> None:
    """All 7 sub-artifact dirs/files exist; the printed approval tier is
    exactly 'APPROVABLE WITH FIELD VERIFICATION'; pack_model.json carries a
    normalized `status` key on every section (SPEC.md §3g) -- the source
    files split status:/evidence:, so a consumer must be able to rely on one
    field name across the whole export."""
    b = GOLDEN_BUNDLE
    expected_files = [
        "README.md",
        "pack_manifest.json",
        "pack_manifest.yaml",
        "CHECKSUMS.txt",
        "intake_manifest.yaml",
        "prints/CV-101_print_set.pdf",
        "data/components.csv",
        "data/connections.csv",
        "data/terminals.csv",
        "data/pack_model.json",
        "data/pack_model.yaml",
        "evidence/provenance_report.md",
        "evidence/evidence_matrix.csv",
        "evidence/crossref_matrix.csv",
        "evidence/photos/wire_2.jpg",
        "evidence/photos/wire_3.jpg",
        "open_items/field_verify_register.csv",
        "open_items/field_verify_register.md",
        "worksheets/field_verification_worksheet.pdf",
        "approval/revision_approval_record.yaml",
        "approval/cover_status.md",
    ]
    for rel in expected_files:
        assert (b / rel).is_file(), f"missing bundle artifact: {rel}"

    for sheet_id, basename in _SHEET_BASENAMES.items():
        assert (b / "prints" / "sheets" / f"{basename}.pdf").is_file(), (
            f"missing sheet PDF: {sheet_id}"
        )
        assert (b / "prints" / "sheets" / f"{basename}.png").is_file(), (
            f"missing sheet PNG: {sheet_id}"
        )

    manifest = json.loads((b / "pack_manifest.json").read_text(encoding="utf-8"))
    assert manifest["achieved_tier"] == "APPROVABLE WITH FIELD VERIFICATION"
    assert manifest["asset"]["tag"] == ASSET_TAG
    # redaction actually took effect on the published example
    assert manifest["customer"]["name"] == ""
    assert manifest["customer"]["site"] == ""

    pack_model = json.loads((b / "data" / "pack_model.json").read_text(encoding="utf-8"))
    checked_sections = 0
    for section in ("devices", "terminals", "wires"):
        entries = pack_model[section]
        assert entries, f"pack_model.json section {section!r} is empty"
        for entry in entries:
            assert "status" in entry and entry["status"], (
                f"{section} entry missing normalized status: {entry}"
            )
        checked_sections += 1
    for entry in pack_model["e007_rs485"]["links"]:
        assert "status" in entry and entry["status"]
    for entry in pack_model["e002_oneline"]["nodes"] + pack_model["e002_oneline"]["segments"]:
        assert "status" in entry and entry["status"]
    assert checked_sections == 3

    open_items = pack_model["open_items"]
    assert len(open_items) == 28
    for it in open_items:
        for field in (
            "id",
            "sheet",
            "item",
            "verify",
            "severity",
            "status",
            "closed_date",
            "closed_by",
            "as_found",
            "tooling_needed",
        ):
            assert field in it, f"open item {it.get('id')} missing structured field {field!r}"
