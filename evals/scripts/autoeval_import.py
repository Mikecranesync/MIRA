"""Import generated answer records into a validated transcript set. Pure: no network, no clock.

The contract is the recorded-transcript shape the runner reads (see the real example
evals/results/f06922ac6-cov100 and judge_baseline.py): one JSON object per case with
case_id, case_type, case, turns (each turn: turn, question, answer, citations, status) and a
null error. A record that carries an error is an infrastructure failure, not an answer, and is
refused (judge_baseline scores it as infra_fail). Optional `retrieved_passages` is the list of
real retrieved passages {doc_id, page, text} that the fixture judge passes as rag_context.

Output: <results_root>/<set>/<route>/<case_id>.json plus _manifest.json with sha, base_url,
route, source = "generated", case_count and records_sha256. The same inputs always produce the
same bytes. An existing set is never overwritten.
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any

ROUTES = ("technician",)
REQUIRED_TOP = ("case_id", "case_type", "case", "turns", "error")
REQUIRED_TURN = ("turn", "question", "answer", "citations", "status")
SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
SHA = re.compile(r"^[0-9a-f]{7,40}$")


class ImportRefused(ValueError):
    """A record, the arguments or the target set is unacceptable. Nothing is written."""


def _check_turn(turn: Any, where: str, index: int) -> None:
    if not isinstance(turn, dict):
        raise ImportRefused(f"{where}: turn {index} is not a JSON object")
    for field in REQUIRED_TURN:
        if field not in turn:
            raise ImportRefused(f"{where}: turn {index} is missing required field {field!r}")
    if not isinstance(turn["question"], str) or not isinstance(turn["answer"], str):
        raise ImportRefused(f"{where}: turn {index} question and answer must be strings")
    if not isinstance(turn["citations"], list):
        raise ImportRefused(f"{where}: turn {index} citations must be a list")


def validate_record(record: Any, where: str, route: str) -> str:
    """Return the case_id of a valid record, or raise ImportRefused naming the problem."""
    if not isinstance(record, dict):
        raise ImportRefused(f"{where}: record is not a JSON object")
    for field in REQUIRED_TOP:
        if field not in record:
            raise ImportRefused(f"{where}: missing required field {field!r}")
    case_id = record["case_id"]
    if not isinstance(case_id, str) or not SAFE_ID.match(case_id):
        raise ImportRefused(f"{where}: case_id {case_id!r} is not a safe file name")
    if record["case_type"] != route:
        raise ImportRefused(f"{where}: case_type {record['case_type']!r} is not route {route!r}")
    if not isinstance(record["case"], dict):
        raise ImportRefused(f"{where}: case must be a JSON object")
    turns = record["turns"]
    if not isinstance(turns, list) or not turns:
        raise ImportRefused(f"{where}: turns must be a non-empty list")
    for i, turn in enumerate(turns):
        _check_turn(turn, where, i)
    if record["error"] is not None:
        raise ImportRefused(f"{where}: carries an error ({record['error']!r}); regenerate it")
    return case_id


def _digest(records: dict[str, dict]) -> str:
    body = json.dumps(records, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(body.encode()).hexdigest()


def _load(path: Path) -> Any:
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as e:
        raise ImportRefused(f"{path.name}: not readable JSON ({e})") from e


def import_records(
    src: Path,
    results_root: Path,
    *,
    set_name: str,
    route: str,
    sha: str,
    base_url: str,
) -> dict[str, Any]:
    """Validate every *.json record in src and write one transcript set. Returns the manifest."""
    if route not in ROUTES:
        raise ImportRefused(f"route {route!r} is not one of {ROUTES}")
    if not SAFE_ID.match(set_name):
        raise ImportRefused(f"set name {set_name!r} is not a safe directory name")
    if not SHA.match(sha):
        raise ImportRefused(f"sha {sha!r} is not a commit SHA")
    if not base_url.startswith(("http://", "https://")):
        raise ImportRefused(f"base_url {base_url!r} is not an http(s) URL")
    files = sorted(p for p in Path(src).glob("*.json") if not p.name.startswith("_"))
    if not files:
        raise ImportRefused(f"no records found in {src}")
    records: dict[str, dict] = {}
    for path in files:
        record = _load(path)
        case_id = validate_record(record, path.name, route)
        if case_id in records:
            raise ImportRefused(f"duplicate case_id {case_id!r} in {path.name}")
        records[case_id] = record
    dest = Path(results_root) / set_name / route
    if dest.exists():
        raise ImportRefused(f"{dest} already exists; refusing to overwrite a transcript set")
    dest.mkdir(parents=True)
    for case_id in sorted(records):
        text = json.dumps(records[case_id], indent=2, sort_keys=True, ensure_ascii=False)
        (dest / f"{case_id}.json").write_text(text + "\n")
    manifest = {
        "sha": sha,
        "base_url": base_url,
        "route": route,
        "source": "generated",
        "case_count": len(records),
        "records_sha256": _digest(records),
    }
    (dest / "_manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    return manifest
