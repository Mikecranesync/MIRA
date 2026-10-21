"""Join each Stranger Walk turn to its staging retrieval span (read-only) (#4576).

For every observed turn, read the ``retrieval.execute`` span from Langfuse and
record what the vector lane actually did and how long retrieval took. This is
the evidence for validity check V4 in ``docs/evals/retrieval-eval/release-gates.md``:
an arm that claims the vector lane must show it ran.

    doppler run --project factorylm --config stg -- \
        python3 tools/retrieval_eval/lanes.py RUN_DIR OUT.jsonl

Uses the Langfuse v2 observations API (the v1 trace endpoint is removed on
2026-11-16). Needs LANGFUSE_PUBLIC_API_KEY and LANGFUSE_SECRET_KEY; reads only.
"""

from __future__ import annotations

import json
import logging
import os
import re
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

import httpx

log = logging.getLogger("retrieval-eval.lanes")
TRACE_RE = re.compile(r'"traceId"\s*:\s*"([0-9a-f]{32})"')
SPAN = "retrieval.execute"


def trace_id(obs: dict) -> str | None:
    m = TRACE_RE.search(obs.get("sse") or "")
    return m.group(1) if m else None


def lane_of(observations: list[dict]) -> dict:
    """Reduce one trace's observations to the retrieval span's lane and latency."""
    for o in observations:
        if o.get("name") != SPAN:
            continue
        attrs = (o.get("metadata") or {}).get("attributes") or {}
        if isinstance(attrs, str):  # unexpanded metadata is truncated to 200 chars by the API
            try:
                attrs = json.loads(attrs)
            except json.JSONDecodeError:
                return {"lane": "attrs_truncated", "retrieval_latency_s": o.get("latency")}
        return {
            "lane": attrs.get("mira.retrieval.vector_lane") or "no_lane_attr",
            "retrieval_latency_s": o.get("latency"),
        }
    return {
        "lane": "no_retrieval_span" if observations else "trace_not_found",
        "retrieval_latency_s": None,
    }


def fetch(client: httpx.Client, tid: str, since: str, until: str) -> list[dict]:
    params = {
        "traceId": tid,
        "fields": "core,basic,metadata",
        "expandMetadata": "attributes",
        "fromStartTime": since,
        "toStartTime": until,
    }
    for attempt in range(8):
        r = client.get("/api/public/v2/observations", params=params)
        if r.status_code != 429:
            r.raise_for_status()
            return r.json().get("data") or []
        time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"rate limited 8 times for trace {tid}")


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    run_dir, out = (argv or sys.argv[1:])[:2]
    meta = json.loads(Path(run_dir, "scored.json").read_text()).get("meta") or {}
    start = datetime.fromisoformat(meta["builtAt"].replace("Z", "+00:00"))
    since, until = start.isoformat(), (start + timedelta(days=3)).isoformat()
    observations = json.loads(Path(run_dir, "observations.json").read_text())
    host = os.environ.get("LANGFUSE_HOST", "https://us.cloud.langfuse.com")
    auth = (os.environ["LANGFUSE_PUBLIC_API_KEY"], os.environ["LANGFUSE_SECRET_KEY"])
    with httpx.Client(base_url=host, auth=auth, timeout=30) as client, open(out, "w") as fh:
        for o in observations:
            tid = trace_id(o)
            row = {"id": o["id"], "trace_id": tid}
            row.update(lane_of(fetch(client, tid, since, until)) if tid else {"lane": "no_trace"})
            fh.write(json.dumps(row) + "\n")
            time.sleep(1)
    log.info("wrote %s", out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
