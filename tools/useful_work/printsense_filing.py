"""PrintSense package filing worker.

The worker is deliberately policy-first and dependency-injected: tests can prove
tenant, target, grade, and source-file behavior without touching Hub, external
cloud sources, or Neon. A real scheduler can pass a Hub client.
"""

from __future__ import annotations

import json
import mimetypes
import os
import sys
from argparse import ArgumentParser
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Literal, Protocol

from printsense.models import PrintSynthGraph

RUNNER_ID = "printsense_filing_worker"
MANIFEST_NAME = "source_manifest.json"
STARDUST_PATH_PREFIX = "enterprise.celestial_park.stardust_racers"
FilingStatus = Literal["green", "yellow", "red", "infra", "needs_review"]
OK_CLI_STATUSES: set[FilingStatus] = {"green", "yellow", "needs_review"}


class HubAttachmentClient(Protocol):
    def attach_file(self, request: "HubAttachmentRequest") -> dict[str, Any]:
        """Attach a file to a Hub namespace node and return upload metadata."""


NodeResolver = Callable[[str, str], str | None]


@dataclass(frozen=True)
class HubAttachmentRequest:
    tenant_id: str
    node_id: str
    filename: str
    content: bytes
    content_type: str
    uns_path: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class FilingResult:
    runner: str
    run_id: str
    status: FilingStatus
    tenant_id: str = ""
    target_node_id: str = ""
    target_uns_path: str = ""
    checked: list[str] = field(default_factory=list)
    attached: list[dict[str, Any]] = field(default_factory=list)
    proposals_created: int = 0
    unable_sources: list[str] = field(default_factory=list)
    evidence_path: str = ""
    review_packet_path: str = ""
    next_action: str = ""
    counts: dict[str, int] = field(default_factory=dict)

    def to_ledger_event(self) -> dict[str, Any]:
        return {
            "runner": self.runner,
            "run_id": self.run_id,
            "status": self.status,
            "checked": self.checked,
            "counts": self.counts,
            "evidence_path": self.evidence_path,
            "unable_sources": self.unable_sources,
            "next_action": self.next_action,
            "personas": ["Dana"],
            "finished_at": utc_now_iso(),
        }

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class _Target:
    tenant_id: str
    node_id: str
    uns_path: str
    needs_review_reason: str = ""


@dataclass
class _FetchedFile:
    spec: dict[str, Any]
    filename: str
    content: bytes
    content_type: str
    source: str


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def run_printsense_filing(
    package_dir: str | Path,
    *,
    hub_client: HubAttachmentClient,
    evidence_root: str | Path,
    ledger_path: str | Path,
    dry_run: bool = True,
    node_resolver: NodeResolver | None = None,
    run_id: str | None = None,
) -> FilingResult:
    package = Path(package_dir)
    run_id = run_id or f"printsense-filing-{utc_now_iso().replace(':', '').replace('-', '')}"
    evidence_dir = Path(evidence_root) / run_id
    evidence_dir.mkdir(parents=True, exist_ok=True)

    checked = ["graph.json", "grade.json", MANIFEST_NAME]
    graph_raw = _read_json(package / "graph.json")
    graph = PrintSynthGraph.model_validate(graph_raw)
    grade = _read_json(package / "grade.json")
    manifest = _read_json(package / MANIFEST_NAME)

    target = _resolve_target(manifest, node_resolver)
    base = FilingResult(
        runner=RUNNER_ID,
        run_id=run_id,
        status="needs_review",
        tenant_id=target.tenant_id,
        target_node_id=target.node_id,
        target_uns_path=target.uns_path,
        checked=checked,
        evidence_path=str(evidence_dir),
    )

    if target.needs_review_reason:
        base.next_action = target.needs_review_reason
        return _finish_result(ledger_path, evidence_dir, base, graph, grade, manifest, [])

    metadata_blocker = _metadata_blocker(graph)
    if metadata_blocker:
        base.next_action = metadata_blocker
        return _finish_result(ledger_path, evidence_dir, base, graph, grade, manifest, [])

    grade_blocker = _grade_blocker(grade)
    if grade_blocker:
        base.next_action = grade_blocker
        return _finish_result(ledger_path, evidence_dir, base, graph, grade, manifest, [])

    fetched, fetch_error = _fetch_manifest_files(package, manifest)
    if fetch_error:
        base.status = "infra"
        base.unable_sources = fetch_error["unable_sources"]
        base.next_action = fetch_error["next_action"]
        return _finish_result(ledger_path, evidence_dir, base, graph, grade, manifest, [])

    checked.append("external_source_connector" if _uses_external_source(manifest) else "local_files")
    checked.append("hub_node_files")

    if dry_run:
        base.status = "yellow"
        base.next_action = f"Dry-run only: {len(fetched)} file(s) ready for Hub attachment"
        base.counts = {"dry_run_files_ready": len(fetched)}
        return _finish_result(ledger_path, evidence_dir, base, graph, grade, manifest, fetched)

    attached = []
    for item in fetched:
        try:
            response = hub_client.attach_file(
                HubAttachmentRequest(
                    tenant_id=target.tenant_id,
                    node_id=target.node_id,
                    uns_path=target.uns_path,
                    filename=item.filename,
                    content=item.content,
                    content_type=item.content_type,
                    metadata={
                        "source": item.source,
                        "kind": item.spec.get("kind") or "",
                        "sheet": item.spec.get("sheet") or "",
                        "drawing_no": (manifest.get("package") or {}).get("drawing_no") or "",
                    },
                )
            )
        except Exception as exc:  # noqa: BLE001 - source-aware runner must report infra.
            base.status = "infra"
            base.unable_sources = ["hub_node_files"]
            base.next_action = f"Hub attachment failed: {exc}"
            return _finish_result(ledger_path, evidence_dir, base, graph, grade, manifest, fetched)
        attached.append(_attachment_result(item, response))

    base.attached = attached
    pdf_not_citable = [
        item for item in attached if _is_pdf_name(item["filename"]) and not item.get("indexed")
    ]
    base.status = "yellow" if pdf_not_citable else ("green" if attached else "yellow")
    if pdf_not_citable:
        base.next_action = "One or more PDFs were attached but are not citable; review indexing warning"
    else:
        base.next_action = "Review unresolved PrintSense items" if _unresolved_items(graph) else "none"
    return _finish_result(ledger_path, evidence_dir, base, graph, grade, manifest, fetched)


def _finish_result(
    ledger_path: str | Path,
    evidence_dir: Path,
    result: FilingResult,
    graph: PrintSynthGraph,
    grade: dict[str, Any],
    manifest: dict[str, Any],
    fetched: list[_FetchedFile],
) -> FilingResult:
    result.counts = _counts(graph, result.attached) | result.counts
    _write_review_packet(evidence_dir, result, graph, grade, manifest, fetched)
    _append_ledger(ledger_path, result)
    return result


def _read_json(path: Path) -> dict[str, Any]:
    try:
        with path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
    except FileNotFoundError as exc:
        raise ValueError(f"required file missing: {path.name}") from exc
    if not isinstance(data, dict):
        raise ValueError(f"{path.name} must contain a JSON object")
    return data


def _resolve_target(manifest: dict[str, Any], node_resolver: NodeResolver | None) -> _Target:
    tenant_id = str(manifest.get("tenant_id") or "").strip()
    target = manifest.get("target") if isinstance(manifest.get("target"), dict) else {}
    node_id = str(target.get("node_id") or "").strip()
    uns_path = str(target.get("uns_path") or "").strip()

    if not tenant_id:
        return _Target("", "", uns_path, "Needs review: explicit tenant_id is required")
    if node_id:
        return _Target(tenant_id, node_id, uns_path)
    if uns_path and node_resolver is not None:
        resolved = node_resolver(tenant_id, uns_path)
        if resolved:
            return _Target(tenant_id, resolved, uns_path)
    if uns_path.startswith(STARDUST_PATH_PREFIX):
        reason = "Needs review: exact Stardust UNS path found, but target node id or resolver is required"
    else:
        reason = "Needs review: exact target node is required before attachment; candidate matches only"
    return _Target(tenant_id, "", uns_path, reason)


def _grade_blocker(grade: dict[str, Any]) -> str:
    verdict = str(grade.get("import_verdict") or "").upper()
    hard_failures = grade.get("hard_failures") or []
    import_blocking = grade.get("import_blocking_failures") or []
    if verdict == "FAIL":
        return "Needs review: PrintSense import_verdict=FAIL blocks attachment"
    if hard_failures:
        return "Needs review: PrintSense hard_failures block attachment"
    if import_blocking:
        return "Needs review: PrintSense import_blocking_failures block attachment"
    return ""


def _metadata_blocker(graph: PrintSynthGraph) -> str:
    package = graph.package if isinstance(graph.package, dict) else {}
    missing = []
    if not str(package.get("drawing_no") or package.get("doc_no") or "").strip():
        missing.append("drawing_no")
    if not str(package.get("cabinet") or package.get("title") or package.get("name") or "").strip():
        missing.append("cabinet_or_package_name")
    sheets = package.get("sheets")
    if not isinstance(sheets, list) or not sheets:
        missing.append("sheet_identifiers")
    if missing:
        return "Needs review: PrintSense package metadata missing " + ", ".join(missing)
    return ""


def _fetch_manifest_files(
    package: Path,
    manifest: dict[str, Any],
) -> tuple[list[_FetchedFile], dict[str, Any] | None]:
    files = manifest.get("files")
    if not isinstance(files, list) or not files:
        return [], {
            "unable_sources": ["source_manifest.files"],
            "next_action": "Restore source_manifest.files before filing this package",
        }

    fetched: list[_FetchedFile] = []
    for spec in files:
        if not isinstance(spec, dict):
            return [], {
                "unable_sources": ["source_manifest.files"],
                "next_action": "Each source_manifest file entry must be an object",
            }
        filename = str(spec.get("filename") or "").strip()
        if not filename:
            return [], {
                "unable_sources": ["source_manifest.files.filename"],
                "next_action": "Every file entry needs an exact filename",
            }
        if spec.get("local_path"):
            try:
                local_path = _resolve_local_path(package, str(spec["local_path"]))
            except ValueError as exc:
                return [], {
                    "unable_sources": ["approved_local_source"],
                    "next_action": str(exc),
                }
            if not local_path.exists():
                return [], {
                    "unable_sources": [str(local_path)],
                    "next_action": f"Local source file not found: {local_path}",
                }
            content = local_path.read_bytes()
            source = f"local:{local_path}"
        elif spec.get("drive_file_id"):
            drive_file_id = str(spec["drive_file_id"])
            return [], {
                "unable_sources": ["approved_external_source_connector"],
                "next_action": (
                    "External source connector is not approved/enabled for manifest "
                    f"drive_file_id={drive_file_id}"
                ),
            }
        else:
            return [], {
                "unable_sources": ["source_manifest.files"],
                "next_action": "Every file entry needs local_path or drive_file_id",
            }
        fetched.append(
            _FetchedFile(
                spec=spec,
                filename=filename,
                content=content,
                content_type=_content_type(filename),
                source=source,
            )
        )
    return fetched, None


def _resolve_local_path(package: Path, raw: str) -> Path:
    path = Path(raw)
    if path.is_absolute():
        raise ValueError("Local source path is outside approved source root")
    if not path.is_absolute():
        path = package / path
    resolved = path.resolve()
    root = package.resolve()
    if resolved != root and root not in resolved.parents:
        raise ValueError("Local source path is outside approved source root")
    return resolved


def _content_type(filename: str) -> str:
    return mimetypes.guess_type(filename)[0] or "application/octet-stream"


def _uses_external_source(manifest: dict[str, Any]) -> bool:
    files = manifest.get("files")
    return isinstance(files, list) and any(isinstance(f, dict) and f.get("drive_file_id") for f in files)


def _counts(graph: PrintSynthGraph, attached: list[dict[str, Any]]) -> dict[str, int]:
    return {
        "attached": len(attached),
        "indexed": sum(1 for item in attached if item.get("indexed")),
        "devices": len(graph.devices),
        "unresolved": len(_unresolved_items(graph)),
    }


def _attachment_result(item: _FetchedFile, response: dict[str, Any]) -> dict[str, Any]:
    upload_id = response.get("uploadId") or response.get("upload_id") or ""
    chunk_count = response.get("chunkCount") or response.get("chunk_count") or 0
    indexed = bool(response.get("indexed"))
    return {
        "filename": item.filename,
        "upload_id": str(upload_id),
        "chunk_count": int(chunk_count or 0),
        "indexed": indexed,
        "warning": str(response.get("warning") or ""),
        "source": item.source,
    }


def _is_pdf_name(filename: str) -> bool:
    return filename.lower().endswith(".pdf")


def _unresolved_items(graph: PrintSynthGraph) -> list[Any]:
    unresolved = getattr(graph, "unresolved", [])
    return list(unresolved or [])


def _write_review_packet(
    evidence_dir: Path,
    result: FilingResult,
    graph: PrintSynthGraph,
    grade: dict[str, Any],
    manifest: dict[str, Any],
    fetched: list[_FetchedFile],
) -> Path:
    packet = evidence_dir / "review-packet.md"
    package = graph.package if isinstance(graph.package, dict) else {}
    unresolved = _unresolved_items(graph)
    lines = [
        "# PrintSense Filing Review Packet",
        "",
        f"- runner: `{result.runner}`",
        f"- run_id: `{result.run_id}`",
        f"- status: `{result.status}`",
        f"- tenant_id: `{result.tenant_id}`",
        f"- target_node_id: `{result.target_node_id}`",
        f"- target_uns_path: `{result.target_uns_path}`",
        f"- drawing_no: `{package.get('drawing_no', '')}`",
        f"- cabinet: `{package.get('cabinet', '')}`",
        f"- import_verdict: `{grade.get('import_verdict', '')}`",
        f"- next_action: {result.next_action or 'none'}",
        "",
        "## Attached Files",
    ]
    if result.attached:
        for item in result.attached:
            warning = f" warning=`{item['warning']}`" if item.get("warning") else ""
            lines.append(
                f"- `{item['filename']}` upload_id=`{item['upload_id']}` "
                f"chunks={item['chunk_count']} indexed={item['indexed']}{warning}"
            )
    elif fetched:
        for item in fetched:
            lines.append(f"- candidate `{item.filename}` from `{item.source}`")
    else:
        lines.append("- none")
    lines += ["", "## Unresolved Items"]
    if unresolved:
        for item in unresolved:
            lines.append(f"- `{_item_label(item)}` {_item_detail(item)}".rstrip())
    else:
        lines.append("- none")
    lines += ["", "## Manifest", "```json", json.dumps(manifest, indent=2, sort_keys=True), "```"]
    packet.write_text("\n".join(lines) + "\n", encoding="utf-8")
    result.review_packet_path = str(packet)
    return packet


def _item_label(item: Any) -> str:
    if isinstance(item, dict):
        return str(
            item.get("item") or item.get("tag") or item.get("id") or item.get("label") or "unresolved"
        )
    tag = getattr(item, "tag", None)
    return str(tag or item)


def _item_detail(item: Any) -> str:
    if isinstance(item, dict):
        return str(item.get("detail") or item.get("resolution") or item.get("reason") or "")
    detail = getattr(item, "detail", None)
    return str(detail or "")


def _append_ledger(path: str | Path, result: FilingResult) -> Path:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(result.to_ledger_event(), sort_keys=True) + "\n")
    return target


class HttpHubNodeAttachmentClient:
    """Small real Hub client for scheduler use.

    Tests should inject a fake client. This class intentionally imports httpx
    inside the method so offline policy tests do not depend on network packages.
    """

    def __init__(self, base_url: str, session_cookie: str | None = None, timeout: float = 30.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.session_cookie = session_cookie or os.environ.get("MIRA_HUB_COOKIE", "")
        self.timeout = timeout

    def attach_file(self, request: HubAttachmentRequest) -> dict[str, Any]:
        import httpx

        headers = {}
        if self.session_cookie:
            headers["Cookie"] = self.session_cookie
        files = {
            "file": (request.filename, request.content, request.content_type),
        }
        url = f"{self.base_url}/api/namespace/node/{request.node_id}/files"
        with httpx.Client(timeout=self.timeout) as client:
            response = client.post(url, headers=headers, files=files)
            response.raise_for_status()
            data = response.json()
        if not isinstance(data, dict):
            raise RuntimeError("Hub attachment response was not a JSON object")
        return data


class _DryRunHubClient:
    def attach_file(self, _request: HubAttachmentRequest) -> dict[str, Any]:
        raise RuntimeError("dry-run Hub client cannot attach files")


def build_parser() -> ArgumentParser:
    parser = ArgumentParser(description="File a PrintSense package into Hub useful-work evidence.")
    parser.add_argument("package_dir", help="PrintSense output package directory")
    parser.add_argument(
        "--evidence-root",
        default=os.environ.get("MIRA_USEFUL_WORK_EVIDENCE_ROOT", "dogfood-output/useful-work"),
        help="Directory where review packets are written",
    )
    parser.add_argument(
        "--ledger",
        default=os.environ.get("MIRA_RUNNER_LEDGER_PATH", "dogfood-output/runner-ledger.jsonl"),
        help="Runner ledger JSONL path",
    )
    parser.add_argument("--run-id", default=None, help="Stable run id for this filing attempt")
    parser.add_argument(
        "--commit",
        action="store_true",
        help="Attach files to Hub. Default is dry-run evidence only.",
    )
    parser.add_argument("--hub-url", default=os.environ.get("MIRA_HUB_URL", ""), help="Hub base URL")
    parser.add_argument("--hub-cookie", default=os.environ.get("MIRA_HUB_COOKIE", ""), help="Hub session cookie")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.commit and (not args.hub_url or not args.hub_cookie):
        print("--commit requires --hub-url and --hub-cookie", file=sys.stderr)
        return 2
    hub_client: HubAttachmentClient = (
        HttpHubNodeAttachmentClient(args.hub_url, session_cookie=args.hub_cookie)
        if args.commit
        else _DryRunHubClient()
    )
    result = run_printsense_filing(
        args.package_dir,
        hub_client=hub_client,
        evidence_root=args.evidence_root,
        ledger_path=args.ledger,
        dry_run=not args.commit,
        run_id=args.run_id,
    )
    print(json.dumps(result.to_dict(), sort_keys=True))
    return 0 if result.status in OK_CLI_STATUSES else 1


if __name__ == "__main__":
    raise SystemExit(main())
