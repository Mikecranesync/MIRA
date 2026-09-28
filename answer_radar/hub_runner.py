"""Run MIRA against one Answer Radar question through the deployed Hub chat route.

`runner.py` drives the Python engine in-process (the Telegram/Slack path). This adapter
drives the path technicians actually use — the Hub web app and the phone app both POST the
same body to `/api/equipment-notebooks/{id}/chat/` (`hub-host-logic.ts::chatBodyFor`,
`mira-mobile/src/api/resources.ts`). So one run grades the answers of both surfaces.

It reuses the HTTP client of `tools/qa/retrieval_acceptance.py` rather than forking one, and
it refuses any base other than staging: a benchmark run is test traffic, and test traffic
never goes to production (`docs/environments.md`).

Two conditions, because the product behaves differently for them:

* ``new_chat`` — an empty notebook, no machine selected. Exactly what a technician who just
  types a question gets.
* ``machine_selected`` — the notebook is bound (user-confirmed) to the manufacturer and model
  the question names, as when a technician picks the machine first. The question text is the
  same; only the identity a technician would have chosen is added. That is not leakage (PRS
  §5): no reply, ground truth or expected solution reaches MIRA.
"""

from __future__ import annotations

import importlib.util
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from typing import Any

from answer_radar.runner import classify_answer
from answer_radar.schema import AnswerStatus, EvaluationRecord, EvidenceTier, QuestionRecord

REPO_ROOT = Path(__file__).resolve().parents[1]
STAGING_HOSTS = ("app-staging.factorylm.com",)
# NotebookStatusFrame.status (mira-hub/src/lib/notebook-chat-types.ts).
TERMINAL_STATUSES = ("answered", "insufficient_evidence", "error")
CONDITIONS = ("new_chat", "machine_selected")


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Never follow a redirect: urllib would re-send the explicit Cookie header to
    whatever host the Location names (Codex #4063 R3 F1). The 3xx is returned to
    the caller as an HTTPError, which the Hub client reports as a status code."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


_NO_REDIRECT_OPENER = urllib.request.build_opener(_NoRedirect)


def load_hub_client():
    """The acceptance suite's `Hub` class — one HTTP client for the Hub, not two —
    with redirects refused, so the session cookie never leaves the staging origin."""
    path = REPO_ROOT / "tools/qa/retrieval_acceptance.py"
    spec = importlib.util.spec_from_file_location("_retrieval_acceptance", path)
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    # Its dataclasses resolve their module through sys.modules at class creation.
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)

    class RadarHub(mod.Hub):
        def _req(self, method, path, body=None, headers=None):
            h = {"Cookie": self.cookie, **(headers or {})}
            req = urllib.request.Request(self.base + path, data=body, method=method, headers=h)
            try:
                with _NO_REDIRECT_OPENER.open(req, timeout=self.timeout) as r:
                    return r.status, {k.lower(): v for k, v in r.headers.items()}, r.read()
            except urllib.error.HTTPError as e:
                return e.code, {k.lower(): v for k, v in e.headers.items()}, e.read()

    return RadarHub


def assert_staging(base: str) -> None:
    """Exactly https://app-staging.factorylm.com — the session cookie never
    travels over plaintext or to a look-alike host (Codex #4063 F3)."""
    u = urllib.parse.urlsplit(base.strip())
    if (
        u.scheme != "https"
        or u.hostname not in STAGING_HOSTS
        or u.port is not None
        or u.username is not None
        or u.password is not None
        or u.netloc != u.hostname
        or u.path not in ("", "/")
        or u.query
        or u.fragment
    ):
        raise SystemExit(f"answer radar hub runs refuse non-staging targets (got {base!r})")


_SHA = re.compile(r"^[0-9a-f]{12,40}$")


def deployed_sha(hub) -> str:
    """The serving build, or the run stops: an "unknown" build would compare equal
    to itself across a mid-sweep deploy (Codex #4063 R3 F2)."""
    st, _, j = hub.json("GET", "/api/version/")
    sha = str(j.get("gitSha") or "") if st == 200 and isinstance(j, dict) else ""
    if not _SHA.match(sha):
        raise SystemExit(f"staging /api/version/ gave no valid gitSha (HTTP {st}); refusing to run")
    return sha[:12]


def _frames(raw: bytes) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for block in raw.decode(errors="replace").split("\n\n"):
        block = block.strip()
        if block.startswith("data: {"):
            try:
                out.append(json.loads(block[6:]))
            except json.JSONDecodeError:
                pass
    return out


def _citation_label(c: Any) -> str:
    if isinstance(c, dict):
        # EvidenceCitation.sourceTitle is the Hub's typed field
        # (mira-hub/src/lib/notebook-chat-types.ts); the rest are legacy shapes.
        for k in ("sourceTitle", "label", "title", "source", "docTitle", "fileName"):
            if c.get(k):
                page = c.get("page")
                return f"{c[k]}" + (f" p.{page}" if page else "")
        return json.dumps(c)[:120]
    return str(c)[:120]


def create_notebook(hub, question: QuestionRecord, condition: str, stamp: str) -> dict[str, Any]:
    name = f"AnswerRadar {question.question_id} {condition} {stamp}"
    if condition == "machine_selected" and question.manufacturer and question.model:
        return hub.create_notebook(
            name,
            manufacturer=question.manufacturer,
            model=question.model,
            identityStatus="user_confirmed",
        )
    return hub.create_notebook(name)


def run_question_hub(
    question: QuestionRecord, hub, *, condition: str, mira_version: str, stamp: str
) -> tuple[EvaluationRecord, dict[str, Any]]:
    """Ask the deployed Hub one question, blind. Returns the record and a packet summary."""
    if condition not in CONDITIONS:
        raise ValueError(condition)
    nb = create_notebook(hub, question, condition, stamp)

    # The body both clients send for a turn with no attached sources.
    body = {
        "message": question.normalized_question,
        "sourceDocIds": [],
        "mode": "general",
        "clientRequestId": str(uuid.uuid4()),
    }
    t0 = time.monotonic()
    st, hd, raw = hub._req(
        "POST",
        f"/api/equipment-notebooks/{nb['id']}/chat/",
        json.dumps(body).encode(),
        {"Content-Type": "application/json"},
    )
    total_ms = int((time.monotonic() - t0) * 1000)
    frames = _frames(raw)
    content = "".join(f.get("content", "") for f in frames if f.get("kind") == "content")
    sources = next((f for f in frames if f.get("kind") == "sources"), {})
    status_frame = next((f for f in frames if f.get("kind") == "status"), {})
    status = status_frame.get("status")
    # A declined turn carries its text in the status frame's `message`, not in
    # `content` frames — the clients render that message as the reply
    # (chat/route.ts Gate G abstain). Reading only `content` graded a real
    # "I couldn't find that…" reply as an empty answer (2026-09-27, seed 004).
    if not content and status_frame.get("message"):
        content = str(status_frame["message"])
    evidence = next((f for f in frames if f.get("kind") == "evidence"), {})
    citations = [_citation_label(c) for c in (sources.get("citations") or [])]
    if st != 200 and not content:
        content = f"[ENGINE ERROR {st}] {raw[:200].decode(errors='replace')}"

    retrieval: dict[str, Any] = {}
    trace_id = hd.get("x-mira-trace-id")
    try:
        d = hub.diagnostics(nb["id"], trace_id)
        retrieval = (d.get("packet") or {}).get("retrieval") or {}
    except RuntimeError as exc:  # diagnostics are evidence about the run, never a gate on it
        retrieval = {"error": str(exc)[:200]}

    answer_status = classify_answer(content, st)
    if status == "insufficient_evidence" and answer_status is AnswerStatus.ANSWERED:
        answer_status = AnswerStatus.ABSTAINED
    # Codex #4063 F4: an HTTP 200 stream whose status frame says error is an
    # engine error ("No answer provider available."), not MIRA's answer.
    # R3 F3: a 200 stream must END in exactly one recognised terminal status;
    # a cut-off stream is an incomplete turn, never a graded answer.
    terminal = [f.get("status") for f in frames if f.get("kind") == "status"]
    if status == "error" or (
        st == 200 and (len(terminal) != 1 or terminal[0] not in TERMINAL_STATUSES)
    ):
        answer_status = AnswerStatus.ERROR
    # Codex #4063 F5: no packet means retrieval is UNKNOWN, never "0 candidates".
    # R2 F4: only an explicit integer candidate_count is a measurement.
    cc = retrieval.get("candidate_count")
    chunk_count = cc if isinstance(cc, int) and not isinstance(cc, bool) else None

    doc_ids = [str(x) for x in (retrieval.get("returned_doc_ids") or [])]
    record = EvaluationRecord(
        question_id=question.question_id,
        mira_run_id=f"hub-{uuid.uuid4().hex[:12]}",
        mira_version=mira_version,
        prompt_version=f"hub-chat:{condition}",
        retrieval_version=str(retrieval.get("strategy") or "unknown"),
        answer_text=content,
        answer_status=answer_status,
        citations=citations,
        source_documents=doc_ids[:10],
        retrieved_chunk_count=chunk_count,
        best_evidence_tier=EvidenceTier.TRUSTED_INDEPENDENT if citations else EvidenceTier.NONE,
        total_answer_time_ms=total_ms,
        time_to_first_answer_ms=total_ms,
        notes=f"condition={condition} turn_status={status} basis={evidence.get('basis')} trace={trace_id}",
    )
    summary = {
        "condition": condition,
        "notebook_id": nb["id"],
        "trace_id": trace_id,
        "http": st,
        "turn_status": status,
        "basis": evidence.get("basis"),
        "retrieval": {
            k: retrieval.get(k)
            for k in (
                "strategy",
                "executed",
                "oem_corpus_searched",
                "oem_manufacturer_source",
                "candidate_count",
                "error",
            )
            if k in retrieval
        },
    }
    return record, summary
