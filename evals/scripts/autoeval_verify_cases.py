"""Deterministic quote verifier for drafted eval cases. No model, no network.

A candidate passes only when its source_quote occurs verbatim inside a supplied passage for the
EXACT source_doc and source_page. The only normalisation is whitespace: runs of whitespace
collapse to one space and the ends are stripped, on both sides. Case, punctuation and Unicode
are compared exactly. An empty quote is rejected explicitly, because the empty string is a
substring of every text.

Passages are a JSON array of {doc_id, page, text, is_private}. Candidates are JSONL, as written
by autoeval_draft.py.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

VERIFIER_VERSION = "verbatim-whitespace-v1"


def norm(text: str) -> str:
    return " ".join(text.split())


def index_passages(passages: list[dict]) -> dict[tuple[str, str], list[str]]:
    index: dict[tuple[str, str], list[str]] = {}
    for p in passages:
        index.setdefault((str(p["doc_id"]), str(p["page"])), []).append(str(p["text"]))
    return index


def verify_one(candidate: dict, index: dict[tuple[str, str], list[str]]) -> str | None:
    """Return None when the quote is verbatim in its own doc and page, else a reject reason."""
    quote = candidate.get("source_quote")
    if not isinstance(quote, str) or not norm(quote):
        return "source_quote missing or empty"
    doc, page = candidate.get("source_doc"), candidate.get("source_page")
    if not isinstance(doc, str) or not doc:
        return "source_doc missing"
    if page is None or isinstance(page, bool):
        return "source_page missing"
    texts = index.get((doc, str(page)))
    if not texts:
        return f"no supplied passage for doc={doc!r} page={page!r}"
    wanted = norm(quote)
    if any(wanted in norm(text) for text in texts):
        return None
    return "source_quote is not verbatim in the passage for that doc and page"


def verify(
    candidates: list[dict], passages: list[dict]
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    index = index_passages(passages)
    accepted: list[dict[str, Any]] = []
    rejected: list[dict[str, Any]] = []
    for candidate in candidates:
        reason = verify_one(candidate, index)
        if reason is None:
            accepted.append({**candidate, "quote_verified": True, "verifier": VERIFIER_VERSION})
        else:
            rejected.append({**candidate, "reject_reason": reason, "verifier": VERIFIER_VERSION})
    return accepted, rejected


def _jsonl(path: Path) -> list[dict]:
    rows = [json.loads(ln) for ln in path.read_text().splitlines() if ln.strip()]
    if not all(isinstance(r, dict) for r in rows):
        raise ValueError(f"{path} holds a non-object row")
    return rows


def run_verify(candidates_path: Path, passages_path: Path, out_dir: Path) -> dict[str, int]:
    passages = json.loads(Path(passages_path).read_text())
    accepted, rejected = verify(_jsonl(Path(candidates_path)), passages)
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    for name, rows in (("accepted.jsonl", accepted), ("rejected.jsonl", rejected)):
        body = "".join(json.dumps(r, sort_keys=True, ensure_ascii=False) + "\n" for r in rows)
        (out_dir / name).write_text(body)
    return {"accepted": len(accepted), "rejected": len(rejected)}
