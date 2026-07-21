from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
USEFUL_WORK_DIR = ROOT / "tools" / "useful_work"
if str(USEFUL_WORK_DIR) not in sys.path:
    sys.path.insert(0, str(USEFUL_WORK_DIR))

from printsense_filing import HubAttachmentRequest, main, run_printsense_filing
from registry import load_registry


class FakeHubClient:
    def __init__(self, response: dict | None = None, error: Exception | None = None) -> None:
        self.calls: list[HubAttachmentRequest] = []
        self.response = response
        self.error = error

    def attach_file(self, request: HubAttachmentRequest) -> dict:
        if self.error:
            raise self.error
        self.calls.append(request)
        return self.response or {
            "ok": True,
            "indexed": True,
            "uploadId": f"upload-{len(self.calls)}",
            "chunkCount": 7,
        }


def _write_package(
    tmp_path: Path,
    *,
    manifest: dict,
    grade: dict | None = None,
    graph: dict | None = None,
    source_files: dict[str, bytes] | None = None,
) -> Path:
    package = tmp_path / "printsense_pkg"
    package.mkdir()
    (package / "graph.json").write_text(
        json.dumps(
            graph
            or {
                "package": {
                    "drawing_no": "AP31971",
                    "cabinet": "+SCU2",
                    "title": "Sensor Control Unit 2",
                    "sheets": [{"blatt": 20, "file": "SCU2-sheet-20.pdf"}],
                },
                "devices": [{"tag": "-3/F1", "trust": "proposed", "confidence": 0.9}],
                "unresolved": [{"item": "missing-sheet-9", "resolution": "Sheet 9 not present"}],
            }
        ),
        encoding="utf-8",
    )
    (package / "grade.json").write_text(
        json.dumps(grade or {"import_verdict": "PASS", "score": 94, "hard_failures": []}),
        encoding="utf-8",
    )
    (package / "source_manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    for name, content in (source_files or {}).items():
        target = package / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
    return package


def test_registry_declares_printsense_worker_boundaries():
    registry = load_registry()
    worker = registry["printsense_filing_worker"]

    assert worker["owner_persona"] == "Dana"
    assert "hub_node_file_attachment" in worker["allowed_writes"]
    assert "kg_verified_promotion" in worker["forbidden_writes"]
    assert worker["verification_pack"] == "stardust_document_visibility"


def test_explicit_node_manifest_attaches_local_file_and_writes_evidence(tmp_path: Path):
    package = _write_package(
        tmp_path,
        manifest={
            "schema": "factorylm.printsense_source_manifest.v1",
            "tenant_id": "tenant-1",
            "target": {
                "node_id": "node-1",
                "uns_path": "enterprise.celestial_park.stardust_racers.launch_1",
            },
            "files": [
                {
                    "filename": "SCU2-sheet-20.pdf",
                    "local_path": "SCU2-sheet-20.pdf",
                    "kind": "drawing",
                    "sheet": "20",
                }
            ],
        },
        source_files={"SCU2-sheet-20.pdf": b"%PDF-pretend"},
    )
    hub = FakeHubClient()

    result = run_printsense_filing(
        package,
        hub_client=hub,
        evidence_root=tmp_path / "evidence",
        ledger_path=tmp_path / "runner-ledger.jsonl",
        dry_run=False,
    )

    assert result.status == "green"
    assert len(hub.calls) == 1
    assert hub.calls[0].tenant_id == "tenant-1"
    assert hub.calls[0].node_id == "node-1"
    assert hub.calls[0].filename == "SCU2-sheet-20.pdf"
    assert hub.calls[0].content == b"%PDF-pretend"
    assert result.attached[0]["upload_id"] == "upload-1"
    assert Path(result.review_packet_path).exists()
    assert "missing-sheet-9" in Path(result.review_packet_path).read_text(encoding="utf-8")
    ledger = json.loads((tmp_path / "runner-ledger.jsonl").read_text(encoding="utf-8"))
    assert ledger["runner"] == "printsense_filing_worker"
    assert ledger["status"] == "green"
    assert ledger["counts"]["attached"] == 1
    assert "hub_node_files" in ledger["checked"]


def test_missing_exact_target_stops_as_needs_review_without_attaching(tmp_path: Path):
    package = _write_package(
        tmp_path,
        manifest={
            "schema": "factorylm.printsense_source_manifest.v1",
            "tenant_id": "tenant-1",
            "target": {},
            "files": [{"filename": "SCU2-sheet-20.pdf", "local_path": "SCU2-sheet-20.pdf"}],
        },
        source_files={"SCU2-sheet-20.pdf": b"%PDF-pretend"},
    )
    hub = FakeHubClient()

    result = run_printsense_filing(
        package,
        hub_client=hub,
        evidence_root=tmp_path / "evidence",
        ledger_path=tmp_path / "runner-ledger.jsonl",
        dry_run=False,
    )

    assert result.status == "needs_review"
    assert hub.calls == []
    assert "target node" in result.next_action.lower()
    assert "candidate" in Path(result.review_packet_path).read_text(encoding="utf-8").lower()


def test_failed_printsense_grade_blocks_attachment(tmp_path: Path):
    package = _write_package(
        tmp_path,
        grade={"import_verdict": "FAIL", "hard_failures": ["confident misread"]},
        manifest={
            "schema": "factorylm.printsense_source_manifest.v1",
            "tenant_id": "tenant-1",
            "target": {"node_id": "node-1"},
            "files": [{"filename": "SCU2-sheet-20.pdf", "local_path": "SCU2-sheet-20.pdf"}],
        },
        source_files={"SCU2-sheet-20.pdf": b"%PDF-pretend"},
    )
    hub = FakeHubClient()

    result = run_printsense_filing(
        package,
        hub_client=hub,
        evidence_root=tmp_path / "evidence",
        ledger_path=tmp_path / "runner-ledger.jsonl",
        dry_run=False,
    )

    assert result.status == "needs_review"
    assert hub.calls == []
    assert "import_verdict=FAIL" in result.next_action


def test_drive_file_without_fetcher_is_infra_not_green(tmp_path: Path):
    package = _write_package(
        tmp_path,
        manifest={
            "schema": "factorylm.printsense_source_manifest.v1",
            "tenant_id": "tenant-1",
            "target": {"node_id": "node-1"},
            "files": [{"filename": "SCU2-sheet-20.pdf", "drive_file_id": "drive-123"}],
        },
    )
    hub = FakeHubClient()

    result = run_printsense_filing(
        package,
        hub_client=hub,
        evidence_root=tmp_path / "evidence",
        ledger_path=tmp_path / "runner-ledger.jsonl",
        dry_run=False,
    )

    assert result.status == "infra"
    assert hub.calls == []
    assert result.unable_sources == ["approved_external_source_connector"]
    assert "not approved/enabled" in result.next_action


def test_dry_run_resolves_and_reports_without_attaching(tmp_path: Path):
    package = _write_package(
        tmp_path,
        manifest={
            "schema": "factorylm.printsense_source_manifest.v1",
            "tenant_id": "tenant-1",
            "target": {"node_id": "node-1"},
            "files": [{"filename": "SCU2-sheet-20.pdf", "local_path": "SCU2-sheet-20.pdf"}],
        },
        source_files={"SCU2-sheet-20.pdf": b"%PDF-pretend"},
    )
    hub = FakeHubClient()

    result = run_printsense_filing(
        package,
        hub_client=hub,
        evidence_root=tmp_path / "evidence",
        ledger_path=tmp_path / "runner-ledger.jsonl",
        dry_run=True,
    )

    assert result.status == "yellow"
    assert hub.calls == []
    assert result.counts["dry_run_files_ready"] == 1
    assert "dry-run" in result.next_action.lower()


def test_package_json_accepts_utf8_bom_from_windows_tools(tmp_path: Path):
    package = _write_package(
        tmp_path,
        manifest={
            "schema": "factorylm.printsense_source_manifest.v1",
            "tenant_id": "tenant-1",
            "target": {"node_id": "node-1"},
            "files": [{"filename": "SCU2-sheet-20.pdf", "local_path": "SCU2-sheet-20.pdf"}],
        },
        source_files={"SCU2-sheet-20.pdf": b"%PDF-pretend"},
    )
    (package / "grade.json").write_text(
        json.dumps({"import_verdict": "PASS", "score": 94, "hard_failures": []}),
        encoding="utf-8-sig",
    )

    result = run_printsense_filing(
        package,
        hub_client=FakeHubClient(),
        evidence_root=tmp_path / "evidence",
        ledger_path=tmp_path / "runner-ledger.jsonl",
        dry_run=True,
    )

    assert result.status == "yellow"
    assert result.counts["dry_run_files_ready"] == 1


def test_pdf_kept_but_not_indexed_is_not_green(tmp_path: Path):
    package = _write_package(
        tmp_path,
        manifest={
            "schema": "factorylm.printsense_source_manifest.v1",
            "tenant_id": "tenant-1",
            "target": {"node_id": "node-1"},
            "files": [{"filename": "SCU2-sheet-20.pdf", "local_path": "SCU2-sheet-20.pdf"}],
        },
        source_files={"SCU2-sheet-20.pdf": b"%PDF-pretend"},
    )
    hub = FakeHubClient(
        response={
            "ok": True,
            "indexed": False,
            "warning": "PDF processing is temporarily unavailable",
            "file": {"id": "direct-1"},
        }
    )

    result = run_printsense_filing(
        package,
        hub_client=hub,
        evidence_root=tmp_path / "evidence",
        ledger_path=tmp_path / "runner-ledger.jsonl",
        dry_run=False,
    )

    assert result.status == "yellow"
    assert result.counts["attached"] == 1
    assert result.counts["indexed"] == 0
    assert "not citable" in result.next_action.lower()
    assert "PDF processing" in Path(result.review_packet_path).read_text(encoding="utf-8")


def test_hub_attach_failure_is_infra_not_crash(tmp_path: Path):
    package = _write_package(
        tmp_path,
        manifest={
            "schema": "factorylm.printsense_source_manifest.v1",
            "tenant_id": "tenant-1",
            "target": {"node_id": "node-1"},
            "files": [{"filename": "SCU2-sheet-20.pdf", "local_path": "SCU2-sheet-20.pdf"}],
        },
        source_files={"SCU2-sheet-20.pdf": b"%PDF-pretend"},
    )
    hub = FakeHubClient(error=RuntimeError("401 unauthorized"))

    result = run_printsense_filing(
        package,
        hub_client=hub,
        evidence_root=tmp_path / "evidence",
        ledger_path=tmp_path / "runner-ledger.jsonl",
        dry_run=False,
    )

    assert result.status == "infra"
    assert result.unable_sources == ["hub_node_files"]
    assert "401 unauthorized" in result.next_action


def test_local_path_cannot_escape_package(tmp_path: Path):
    package = _write_package(
        tmp_path,
        manifest={
            "schema": "factorylm.printsense_source_manifest.v1",
            "tenant_id": "tenant-1",
            "target": {"node_id": "node-1"},
            "files": [{"filename": "secret.pdf", "local_path": "../secret.pdf"}],
        },
    )
    (tmp_path / "secret.pdf").write_bytes(b"%PDF-outside-package")

    result = run_printsense_filing(
        package,
        hub_client=FakeHubClient(),
        evidence_root=tmp_path / "evidence",
        ledger_path=tmp_path / "runner-ledger.jsonl",
        dry_run=False,
    )

    assert result.status == "infra"
    assert result.unable_sources == ["approved_local_source"]
    assert "outside approved source root" in result.next_action.lower()


def test_missing_package_metadata_stops_as_needs_review(tmp_path: Path):
    package = _write_package(
        tmp_path,
        graph={"package": {}, "devices": [{"tag": "-3/F1"}]},
        manifest={
            "schema": "factorylm.printsense_source_manifest.v1",
            "tenant_id": "tenant-1",
            "target": {"node_id": "node-1"},
            "files": [{"filename": "SCU2-sheet-20.pdf", "local_path": "SCU2-sheet-20.pdf"}],
        },
        source_files={"SCU2-sheet-20.pdf": b"%PDF-pretend"},
    )

    result = run_printsense_filing(
        package,
        hub_client=FakeHubClient(),
        evidence_root=tmp_path / "evidence",
        ledger_path=tmp_path / "runner-ledger.jsonl",
        dry_run=False,
    )

    assert result.status == "needs_review"
    assert "drawing_no" in result.next_action


def test_cli_dry_run_outputs_machine_readable_result(tmp_path: Path, capsys):
    package = _write_package(
        tmp_path,
        manifest={
            "schema": "factorylm.printsense_source_manifest.v1",
            "tenant_id": "tenant-1",
            "target": {"node_id": "node-1"},
            "files": [{"filename": "SCU2-sheet-20.pdf", "local_path": "SCU2-sheet-20.pdf"}],
        },
        source_files={"SCU2-sheet-20.pdf": b"%PDF-pretend"},
    )

    rc = main(
        [
            str(package),
            "--evidence-root",
            str(tmp_path / "evidence"),
            "--ledger",
            str(tmp_path / "runner-ledger.jsonl"),
            "--run-id",
            "cli-run",
        ]
    )

    assert rc == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["runner"] == "printsense_filing_worker"
    assert payload["run_id"] == "cli-run"
    assert payload["status"] == "yellow"
    assert payload["counts"]["dry_run_files_ready"] == 1


def test_script_dry_run_invocation_imports_repo_modules(tmp_path: Path):
    package = _write_package(
        tmp_path,
        manifest={
            "schema": "factorylm.printsense_source_manifest.v1",
            "tenant_id": "tenant-1",
            "target": {"node_id": "node-1"},
            "files": [{"filename": "SCU2-sheet-20.pdf", "local_path": "SCU2-sheet-20.pdf"}],
        },
        source_files={"SCU2-sheet-20.pdf": b"%PDF-pretend"},
    )

    result = subprocess.run(
        [
            sys.executable,
            str(ROOT / "tools" / "useful_work" / "printsense_filing.py"),
            str(package),
            "--evidence-root",
            str(tmp_path / "evidence"),
            "--ledger",
            str(tmp_path / "runner-ledger.jsonl"),
            "--run-id",
            "script-run",
        ],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["run_id"] == "script-run"
    assert payload["status"] == "yellow"
