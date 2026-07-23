"""Export MIRA's historical Langfuse `rag_query` traces to local files.

Pulls the production trace history out of Langfuse Cloud (read-only) into local
JSONL + CSV so it can be analysed, archived, and seeded into an eval pack. The
project has ~3,725 `rag_query` traces, each with four child spans (embed_query,
vector_search, context_compose, llm_inference).

Run it under Doppler so the Langfuse keys resolve (the data lives in the project
whose keys are in factorylm/prd):

    doppler run --project factorylm --config prd -- \
        python tools/langfuse_export.py --dry-run
    doppler run --project factorylm --config prd -- \
        python tools/langfuse_export.py --max 50
    doppler run --project factorylm --config prd -- \
        python tools/langfuse_export.py                       # full export
    doppler run --project factorylm --config prd -- \
        python tools/langfuse_export.py --as-evalseed         # + draft eval pack

Uses the Langfuse public REST API directly via httpx (version-independent — the
installed SDK on a given host may be too old to have `fetch_traces`). Two sweeps:
`GET /api/public/traces` (top-level input/metadata) and `GET
/api/public/observations` (span input/output), joined in memory by trace id.

Output lands in a git-ignored dir (default ``tools/langfuse-export/``) — it is
**unsanitized customer data**: never commit it, never re-upload it. The draft
eval-seed YAML *is* PII-scrubbed (it may be curated into the repo). Read-only
against Langfuse; nothing is written back to the SaaS.
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

# Make shared.inference.router importable (for the canonical PII scrubber).
_REPO_ROOT = Path(__file__).resolve().parents[1]
_BOTS = str(_REPO_ROOT / "mira-bots")
if _BOTS not in sys.path:
    sys.path.insert(0, _BOTS)

logger = logging.getLogger("mira.tools.langfuse_export")

_SPAN_NAMES = {"embed_query", "vector_search", "context_compose", "llm_inference"}
_MACHINE_RE = re.compile(r"\[MACHINE:\s*([^\]\n]+)\]", re.IGNORECASE)


# --- pure helpers (unit-testable, no network) -------------------------------


def parse_machine(query: str) -> str:
    """Pull the machine name out of a ``[MACHINE: <name>]`` context block."""
    if not isinstance(query, str):
        return ""
    m = _MACHINE_RE.search(query)
    return m.group(1).strip() if m else ""


def parse_question(query: str) -> str:
    """Best-effort: isolate the natural-language question from a query string.

    The /ask kiosk prepends a large ``[MACHINE: …]`` status card, then the
    technician's question. Heuristic: the question is the last non-empty,
    non-bracketed line. Falls back to the whole (trimmed) string. This is
    deliberately conservative — eval seeds built from it ship inactive for
    human review.
    """
    if not isinstance(query, str):
        return ""
    lines = [ln.strip() for ln in query.splitlines() if ln.strip()]
    for ln in reversed(lines):
        if not ln.startswith("[") and not ln.upper().startswith("MACHINE"):
            return ln
    return query.strip()


def slug(text: str, maxlen: int = 48) -> str:
    """Lowercase, non-alphanumeric runs collapsed to ``_`` (UNS-style slug)."""
    s = re.sub(r"[^a-z0-9]+", "_", (text or "").lower()).strip("_")
    return s[:maxlen] or "item"


def scrub(text: str) -> str:
    """Strip IPs/MACs/serials via the canonical InferenceRouter.sanitize_text.

    Historical trace input is unsanitized (the forward-going scrub shipped
    later); scrub anything that might be curated into the repo.
    """
    if not isinstance(text, str):
        return text
    try:
        from shared.inference.router import InferenceRouter  # noqa: PLC0415

        return InferenceRouter.sanitize_text(text)
    except Exception:  # noqa: BLE001 — never block an export on the scrubber
        return text


def _span_by_name(spans: list[dict], name: str) -> dict | None:
    for s in spans:
        if s.get("name") == name:
            return s
    return None


def _output(span: dict | None) -> dict:
    out = (span or {}).get("output")
    return out if isinstance(out, dict) else {}


def flatten_row(trace: dict, spans: list[dict]) -> dict:
    """Flatten one joined trace+spans into a flat analysis CSV row."""
    query = ((trace.get("input") or {}) or {}).get("query", "")
    if not isinstance(query, str):
        query = json.dumps(query, ensure_ascii=False) if query else ""
    meta = trace.get("metadata") or {}

    vsearch = _output(_span_by_name(spans, "vector_search"))
    retrieved = vsearch.get("retrieved") or []
    scores = [
        float(r["score"]) for r in retrieved
        if isinstance(r, dict) and isinstance(r.get("score"), (int, float))
    ]
    count = vsearch.get("count")
    n_chunks = count if isinstance(count, (int, float)) else len(retrieved)
    llm = _output(_span_by_name(spans, "llm_inference"))
    llm_span = _span_by_name(spans, "llm_inference") or {}

    return {
        "timestamp": trace.get("timestamp") or "",
        "trace_id": trace.get("id") or "",
        "machine": parse_machine(query),
        "question": parse_question(query),
        "answer_preview": llm.get("response_preview", ""),
        "latency_ms": llm.get("latency_ms") or llm_span.get("latency") or trace.get("latency") or "",
        "fsm_state": meta.get("fsm_state", ""),
        "prompt_version": meta.get("prompt_version", ""),
        "n_chunks": n_chunks,
        "top_score": max(scores) if scores else "",
    }


_CSV_FIELDS = [
    "timestamp", "trace_id", "machine", "question", "answer_preview",
    "latency_ms", "fsm_state", "prompt_version", "n_chunks", "top_score",
]


def eval_item(row: dict, idx: int) -> dict:
    """Shape one analysis row into an EvalItem-style dict (draft, inactive).

    Matches simlab/observe/evalpacks/*.yaml. The question is PII-scrubbed.
    expected_asset is a best-effort machine slug placeholder — the human curator
    replaces it with the real UNS path and adds expected_documents /
    answer_points / required_citations before flipping ``active: true``.
    """
    q = scrub(row.get("question") or "")
    machine = row.get("machine") or "unknown"
    return {
        "id": f"hist_{idx:04d}_{slug(q, 32)}",
        "question": q,
        "expected_asset": slug(machine),  # PLACEHOLDER — replace with real UNS path
        "expected_tags": [],
        "expected_documents": [],
        "expected_answer_points": [],
        "required_citations": [],
        "severity": "production",
        "active": False,
    }


# --- Langfuse REST fetch (network) ------------------------------------------


def _client():
    """Return (httpx.Client, host) or (None, host) if keys are missing."""
    import httpx  # noqa: PLC0415

    host = (
        os.environ.get("LANGFUSE_HOST")
        or os.environ.get("LANGFUSE_BASE_URL")
        or "https://cloud.langfuse.com"
    ).rstrip("/")
    pk = os.environ.get("LANGFUSE_PUBLIC_KEY") or os.environ.get("LANGFUSE_PUBLIC_API_KEY", "")
    sk = os.environ.get("LANGFUSE_SECRET_KEY", "")
    if not pk or not sk:
        return None, host
    return httpx.Client(base_url=host, auth=(pk, sk), timeout=60), host


def _get_page(client, path: str, params: dict, *, retries: int = 7) -> tuple[list[dict], dict]:
    """GET one page, retrying 429/5xx with Retry-After + exponential backoff."""
    delay = 2.0
    last = None
    for attempt in range(retries):
        r = client.get(path, params=params)
        if r.status_code == 429 or r.status_code >= 500:
            ra = r.headers.get("Retry-After")
            wait = float(ra) if (ra and ra.replace(".", "", 1).isdigit()) else delay
            logger.warning("%s on %s p%s — sleep %.1fs (attempt %d/%d)",
                           r.status_code, path, params.get("page"), wait, attempt + 1, retries)
            time.sleep(wait)
            delay = min(delay * 2, 30)
            last = r
            continue
        r.raise_for_status()
        d = r.json()
        return (d.get("data") or []), (d.get("meta") or {})
    if last is not None:
        last.raise_for_status()
    return [], {}


def _sweep(client, path, base_params, *, limit, max_items, label, sleep) -> list[dict]:
    out: list[dict] = []
    page = 1
    while True:
        data, meta = _get_page(client, path, dict(base_params, page=page, limit=limit))
        out.extend(data)
        total_pages = meta.get("totalPages", page) or page
        logger.info("%s: page %d/%s (+%d, total %d)", label, page, total_pages, len(data), len(out))
        if max_items is not None and len(out) >= max_items:
            return out[:max_items]
        if page >= total_pages or not data:
            return out
        page += 1
        if sleep:
            time.sleep(sleep)


def export(args) -> int:
    client, host = _client()
    if client is None:
        logger.error("LANGFUSE_PUBLIC_API_KEY / LANGFUSE_SECRET_KEY not set — "
                     "run under doppler (factorylm/prd).")
        return 2
    logger.info("Langfuse REST host=%s", host)

    base = {"name": args.name}
    if args.from_date:
        base["fromTimestamp"] = _parse_dt(args.from_date)
    if args.to_date:
        base["toTimestamp"] = _parse_dt(args.to_date)

    if args.dry_run:
        data, meta = _get_page(client, "/api/public/traces", dict(base, page=1, limit=1))
        logger.info("DRY RUN — name=%r totalItems=%s totalPages=%s",
                    args.name, meta.get("totalItems"), meta.get("totalPages"))
        if data:
            q = ((data[0].get("input") or {}) or {}).get("query", "")
            q = q if isinstance(q, str) else ""
            logger.info("sample trace_id=%s machine=%r question=%r",
                        data[0].get("id"), parse_machine(q), parse_question(q))
        return 0

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    seen = _load_manifest(out_dir) if args.resume else set()

    logger.info("Sweeping traces (name=%s)…", args.name)
    traces = _sweep(client, "/api/public/traces", base, limit=args.limit,
                    max_items=args.max, label="traces", sleep=args.sleep)
    trace_ids = {t.get("id") for t in traces}

    # Spans: per-trace fetch for small runs (cheap, exact); bulk sweep for large.
    by_trace: dict[str, list[dict]] = {}
    if len(trace_ids) <= 200:
        logger.info("Fetching observations per-trace (%d traces)…", len(trace_ids))
        for tid in trace_ids:
            data, _ = _get_page(client, "/api/public/observations",
                                {"traceId": tid, "limit": 100, "page": 1})
            by_trace[tid] = [s for s in data if s.get("name") in _SPAN_NAMES]
            if args.sleep:
                time.sleep(args.sleep)
    else:
        # Bulk observations, swept in weekly time windows. The list endpoint
        # rejects deep offset pagination (HTTP 422 past ~page 42), so we keep
        # each window shallow by bounding fromStartTime/toStartTime.
        times = sorted(t.get("timestamp") for t in traces if t.get("timestamp"))
        start = _dt(times[0]) if times else None
        end = (_dt(times[-1]) + timedelta(days=1)) if times else None
        if start is None:
            start, end = datetime(2026, 1, 1, tzinfo=timezone.utc), datetime.now(timezone.utc)
        cur = start
        n_spans = 0
        while cur < end:
            nxt = min(cur + timedelta(days=7), end)
            spans = _sweep(
                client, "/api/public/observations",
                {"fromStartTime": cur.isoformat(), "toStartTime": nxt.isoformat()},
                limit=args.limit, max_items=None,
                label=f"obs {cur.date()}", sleep=args.sleep,
            )
            for s in spans:
                tid = s.get("traceId") or s.get("trace_id")
                if tid in trace_ids and s.get("name") in _SPAN_NAMES:
                    by_trace.setdefault(tid, []).append(s)
                    n_spans += 1
            cur = nxt
        logger.info("joined %d spans across %d traces", n_spans, len(by_trace))

    new = [t for t in traces if t.get("id") not in seen]
    logger.info("%d traces (%d new after resume)", len(traces), len(new))

    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
    jsonl_path = out_dir / f"traces-{ts}.jsonl"
    csv_path = out_dir / f"traces-{ts}.csv"
    rows: list[dict] = []
    with jsonl_path.open("w", encoding="utf-8") as jf:
        for t in new:
            sp = by_trace.get(t.get("id"), [])
            jf.write(json.dumps({"trace": t, "spans": sp}, ensure_ascii=False, default=str) + "\n")
            try:
                rows.append(flatten_row(t, sp))
            except Exception as exc:  # noqa: BLE001 — one bad row must not lose the run
                logger.warning("flatten_row failed for %s: %s", t.get("id"), exc)
                rows.append({"trace_id": t.get("id"), "timestamp": t.get("timestamp")})

    with csv_path.open("w", encoding="utf-8", newline="") as cf:
        w = csv.DictWriter(cf, fieldnames=_CSV_FIELDS)
        w.writeheader()
        w.writerows(rows)

    _write_manifest(out_dir, seen | {t.get("id") for t in new}, ts, len(new))
    logger.info("Wrote %s (%d) + %s", jsonl_path.name, len(new), csv_path.name)

    if args.as_evalseed:
        _write_evalseed(out_dir, rows, ts)
    return 0


def _write_evalseed(out_dir: Path, rows: list[dict], ts: str) -> None:
    import yaml  # noqa: PLC0415

    seen_q: set[str] = set()
    items: list[dict] = []
    for r in rows:
        q = (r.get("question") or "").strip()
        norm = q.lower()
        if not q or len(q) < 8 or norm in seen_q or norm in {"hello", "hi", "test"}:
            continue
        seen_q.add(norm)
        items.append(eval_item(r, len(items)))
    path = out_dir / f"evalseed-{ts}.yaml"
    header = ("# DRAFT eval pack seeded from historical Langfuse questions (PII-scrubbed).\n"
              "# Every item is active:false. Before activating, replace the\n"
              "# expected_asset placeholder with the real UNS path and add\n"
              "# expected_documents / expected_answer_points / required_citations.\n"
              "# Then move curated items into simlab/observe/evalpacks/.\n")
    path.write_text(header + yaml.safe_dump(items, sort_keys=False, allow_unicode=True),
                    encoding="utf-8")
    logger.info("Wrote %s (%d unique questions)", path.name, len(items))


# --- small io helpers -------------------------------------------------------


def _dt(s: str) -> datetime:
    """Parse a Langfuse ISO timestamp (handles a trailing ``Z``)."""
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def _parse_dt(s: str | None) -> str | None:
    """Normalize an ISO date/datetime to a UTC ISO string for the REST filter."""
    if not s:
        return None
    return datetime.fromisoformat(s).replace(tzinfo=timezone.utc).isoformat()


def _load_manifest(out_dir: Path) -> set[str]:
    p = out_dir / "manifest.json"
    if not p.exists():
        return set()
    try:
        return set(json.loads(p.read_text(encoding="utf-8")).get("trace_ids", []))
    except Exception:  # noqa: BLE001
        return set()


def _write_manifest(out_dir: Path, ids: set[str], ts: str, n_new: int) -> None:
    (out_dir / "manifest.json").write_text(
        json.dumps({"updated": ts, "n_new": n_new, "trace_ids": sorted(i for i in ids if i)},
                   indent=2), encoding="utf-8")


def main() -> None:
    p = argparse.ArgumentParser(description="Export Langfuse rag_query traces to local JSONL/CSV.")
    p.add_argument("--name", default="rag_query", help="Trace name filter (default rag_query)")
    p.add_argument("--from", dest="from_date", help="ISO date lower bound (e.g. 2026-03-01)")
    p.add_argument("--to", dest="to_date", help="ISO date upper bound")
    p.add_argument("--limit", type=int, default=100, help="Page size (default 100)")
    p.add_argument("--max", type=int, default=None, help="Cap number of traces (testing)")
    p.add_argument("--out-dir", default=str(_REPO_ROOT / "tools" / "langfuse-export"))
    p.add_argument("--sleep", type=float, default=0.5,
                   help="Inter-page sleep seconds (raise if you hit 429s)")
    p.add_argument("--dry-run", action="store_true", help="Count + sample only; write nothing")
    p.add_argument("--resume", action="store_true", help="Skip trace IDs already in manifest")
    p.add_argument("--as-evalseed", action="store_true", help="Also emit a draft eval pack YAML")
    args = p.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    raise SystemExit(export(args))


if __name__ == "__main__":
    main()
