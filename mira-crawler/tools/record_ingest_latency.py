#!/usr/bin/env python3
"""Wrap a parser or ingest command and record end-to-end latency.

Examples:
  python mira-crawler/tools/record_ingest_latency.py \
    --source-url https://example/manual.pdf --parser docling \
    -- python mira-crawler/tasks/full_ingest_pipeline.py ...

  MIRA_INGEST_LATENCY_LOG=/var/log/mira-agents/ingest_latency.jsonl \
    python mira-crawler/tools/record_ingest_latency.py --parser pdfplumber -- echo ok
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

_CRAWLER_ROOT = Path(__file__).resolve().parents[1]
if str(_CRAWLER_ROOT) not in sys.path:
    sys.path.insert(0, str(_CRAWLER_ROOT))

from metrics.latency import IngestLatencyRecorder


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--parser", required=True, help="Parser/platform name, e.g. docling")
    parser.add_argument("--source-id", default="", help="Stable document id; defaults to source URL/file/command")
    parser.add_argument("--source-url", default="", help="Source URL for the delivered document")
    parser.add_argument("--source-file", default="", help="Local file path/name for the delivered document")
    parser.add_argument("--delivered-at", default=None, help="ISO timestamp or epoch seconds")
    parser.add_argument("--log-path", default=None, help="JSONL output path")
    parser.add_argument("--metadata", action="append", default=[], help="key=value metadata; repeatable")
    parser.add_argument("command", nargs=argparse.REMAINDER, help="Command after --")
    return parser


def _metadata(items: list[str]) -> dict[str, str]:
    parsed: dict[str, str] = {}
    for item in items:
        if "=" not in item:
            raise SystemExit(f"--metadata must be key=value, got: {item}")
        key, value = item.split("=", 1)
        parsed[key] = value
    return parsed


def main() -> int:
    args = _build_parser().parse_args()
    command = args.command
    if command and command[0] == "--":
        command = command[1:]
    if not command:
        raise SystemExit("Provide a command after --")

    source_id = args.source_id or args.source_url or args.source_file or " ".join(command[:3])
    recorder = IngestLatencyRecorder(
        source_id=source_id,
        parser=args.parser,
        source_url=args.source_url,
        source_file=args.source_file,
        delivered_at=args.delivered_at,
        log_path=args.log_path,
        metadata=_metadata(args.metadata),
    )

    status = "ok"
    error = ""
    result: subprocess.CompletedProcess[str] | None = None
    try:
        with recorder.stage("command", argv=command):
            result = subprocess.run(command, text=True)
        recorder.set_metric("returncode", result.returncode)
        if result.returncode != 0:
            status = "error"
            error = f"command exited {result.returncode}"
    except Exception as exc:
        status = "error"
        error = f"{type(exc).__name__}: {exc}"
        raise
    finally:
        recorder.finish(status=status, error=error)

    return result.returncode if result is not None else 1


if __name__ == "__main__":
    raise SystemExit(main())
