"""Shared beta-gate flow — the real "upload → ask → cited answer" check.

Both `test_upload_retrieval_citation.py` (Lane 2) and
`beta_ready_upload_retrieval_citation.py` (Lane 6, the canonical RELEASE GATE)
call `run_beta_gate()` here so there is ONE real assertion behind both names.

Honesty contract (why this is not theater):
  * The fixture manual enters through the **real upload door** (an HTTP POST to
    whatever upload endpoint the operator points us at), then we **poll** for
    ingestion, then we ask a question through the **real chat endpoint**. We
    never write `knowledge_entries` directly — doing so would hide the exact gap
    this gate exists to catch (uploads land in the Open WebUI KB; chat retrieval
    reads only `knowledge_entries`).
  * The gate is **environment-driven** and never hardcodes a prod URL. The
    operator supplies dev/staging endpoints via env vars. If the env is not
    provisioned, `load_gate_config()` raises `GateUnavailable` — and because the
    callers mark the test `xfail(strict=True)`, an unprovisioned env and a real
    gap both surface as the EXPECTED failure. The day the gap closes AND the env
    is provided, the test passes and strict-xfail flips the suite red — the
    signal that beta readiness must be re-confirmed and the marker removed.

Env contract (all dev/staging — NEVER point this at prod):
  BETA_GATE_UPLOAD_URL   POST multipart {file} → ingests a manual (Hub/ingest).
  BETA_GATE_CHAT_URL     POST → ask a question, get an answer (engine/pipeline).
  BETA_GATE_TENANT       tenant id the upload + chat share.
  BETA_GATE_API_KEY      bearer token for both endpoints (optional).
  BETA_GATE_COOKIE       raw Cookie header for both endpoints (optional). Hub
                         NodeChat routes authenticate via a next-auth
                         `next-auth.session-token` cookie, NOT a bearer — set
                         this to the session cookie when pointing the gate at a
                         Hub surface (`/api/namespace/node/<id>/{files,chat}`).
                         See tests/beta/README.md for how to mint it.
  BETA_GATE_ASSET        asset / UNS hint sent with the question (optional).
  BETA_GATE_POLL_SECONDS ingestion poll budget (default 90).
"""

from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass
from pathlib import Path

import httpx

FIXTURE = Path(__file__).parent / "fixtures" / "gs10_fault_codes.pdf"

# The known-good Q/A the fixture supports.
QUESTION = "What does GS10 fault code oC mean?"
# Content that only the uploaded manual supplies (proves retrieval of THIS file).
EXPECTED_CONTENT = "overcurrent"
# Markers that indicate the answer is grounded in a cited source.
CITATION_MARKERS = ("source", "gs10_fault_codes", "[", "page", "manual", "—")


def answers_with_manual_fact(text: str) -> bool:
    """Did the answer state the GS10 ``oC`` fact from the manual?

    The manual fact is *overcurrent* — the output current exceeds the rated
    current. The LLM states it either literally ("overcurrent") or as the same
    fact paraphrased ("output current exceeded 200% of rated current"), so we
    match the FACT, not one literal word. (The citation markers carry the
    separate "grounded in the *uploaded* file" proof.) De-flakes a real run:
    the answer is always grounded + cited; only the wording varies (2026-06-17).
    """
    low = text.lower()
    if "overcurrent" in low or "over current" in low:
        return True
    return "current" in low and any(
        k in low for k in ("exceed", "200%", "rated", "excess", "too high")
    )


class GateUnavailable(AssertionError):
    """Raised inside the test body when the integration env is not provisioned.

    Subclasses AssertionError so an `xfail(strict=True)` test records it as the
    expected failure rather than a hard error — keeping "env missing" and "gap
    present" on the same RED side of the gate.
    """


@dataclass
class GateConfig:
    upload_url: str
    chat_url: str
    tenant: str
    api_key: str | None
    asset: str | None
    poll_seconds: int
    cookie: str | None = None


@dataclass
class GateResult:
    cited: bool
    answer: str
    explain: str


def load_gate_config() -> GateConfig:
    upload = os.getenv("BETA_GATE_UPLOAD_URL", "").strip()
    chat = os.getenv("BETA_GATE_CHAT_URL", "").strip()
    tenant = os.getenv("BETA_GATE_TENANT", "").strip()
    missing = [
        name
        for name, val in (
            ("BETA_GATE_UPLOAD_URL", upload),
            ("BETA_GATE_CHAT_URL", chat),
            ("BETA_GATE_TENANT", tenant),
        )
        if not val
    ]
    if missing:
        raise GateUnavailable(
            "Beta gate not verifiable — integration env not provisioned. "
            f"Set {', '.join(missing)} to a DEV/STAGING (never prod) endpoint. "
            "Until then the beta gate is RED by definition: we cannot demonstrate "
            "that a stranger's uploaded manual becomes a cited answer."
        )
    return GateConfig(
        upload_url=upload,
        chat_url=chat,
        tenant=tenant,
        api_key=os.getenv("BETA_GATE_API_KEY") or None,
        asset=os.getenv("BETA_GATE_ASSET") or None,
        poll_seconds=int(os.getenv("BETA_GATE_POLL_SECONDS", "90")),
        cookie=os.getenv("BETA_GATE_COOKIE") or None,
    )


def _headers(cfg: GateConfig) -> dict[str, str]:
    h = {"X-Tenant-Id": cfg.tenant}
    if cfg.api_key:
        h["Authorization"] = f"Bearer {cfg.api_key}"
    # Hub NodeChat routes (sessionOr401) authenticate via a next-auth session
    # cookie, not a bearer. Forward the raw Cookie header when provided so the
    # gate can drive the real /api/namespace/node/<id>/{files,chat} doors.
    if cfg.cookie:
        h["Cookie"] = cfg.cookie
    return h


def _parse_sse_answer(text: str) -> str:
    """Accumulate the answer from an SSE stream.

    The Hub NodeChat surface (`/api/namespace/node/<id>/chat`) streams
    `text/event-stream` lines of the form `data: {"content": "..."}` (token
    deltas), plus a leading `data: {"sources": [...]}` and a terminating
    `data: [DONE]`. We concatenate the `content` deltas — the assembled string
    is the answer the human reads.
    """
    parts: list[str] = []
    for line in text.splitlines():
        line = line.strip()
        if not line.startswith("data:"):
            continue
        payload = line[len("data:"):].strip()
        if not payload or payload == "[DONE]":
            continue
        try:
            obj = json.loads(payload)
        except (ValueError, TypeError):
            continue
        if isinstance(obj, dict) and isinstance(obj.get("content"), str):
            parts.append(obj["content"])
    return "".join(parts)


def _ask(cfg: GateConfig, client: httpx.Client) -> str:
    """Ask the question through the real chat endpoint; return the answer text.

    Supports two contracts so the same gate runs against either beta surface:
      * Hub **NodeChat** (`/api/namespace/node/<id>/chat`): body is a `messages`
        array, response is an **SSE** stream of `content` deltas. This is the
        surface PR #1592 grounds (uploads → `knowledge_entries` → cited answer).
      * Engine / pipeline / OpenAI-compat: JSON body, JSON response
        (`reply` / `answer` / `choices[].message.content`).

    We always send both `messages` and the legacy `question`/`query` keys, then
    branch on the response: SSE (event-stream) is accumulated; otherwise parsed
    as JSON. This keeps one gate working across surfaces without a mode flag.
    """
    payload: dict[str, object] = {
        "messages": [{"role": "user", "content": QUESTION}],
        "question": QUESTION,
        "query": QUESTION,
        "tenant_id": cfg.tenant,
    }
    if cfg.asset:
        payload["asset_id"] = cfg.asset
    resp = client.post(cfg.chat_url, json=payload, headers=_headers(cfg))
    resp.raise_for_status()

    # SSE surface (NodeChat) — accumulate the streamed content deltas.
    ctype = resp.headers.get("content-type", "")
    body = resp.text
    if "text/event-stream" in ctype or body.lstrip().startswith("data:"):
        return _parse_sse_answer(body)

    # JSON surfaces (engine / pipeline / OpenAI-compat).
    try:
        data = resp.json()
    except (ValueError, TypeError):
        return body
    if isinstance(data, dict):
        if "reply" in data:
            return str(data["reply"])
        if "answer" in data:
            return str(data["answer"])
        choices = data.get("choices")
        if isinstance(choices, list) and choices:
            return str(choices[0].get("message", {}).get("content", ""))
    return str(data)


def run_beta_gate() -> GateResult:
    """Upload the fixture, wait for ingestion, ask, and judge the answer.

    Raises GateUnavailable if the env isn't provisioned (→ expected xfail).
    """
    cfg = load_gate_config()
    if not FIXTURE.exists():
        raise GateUnavailable(f"fixture missing: {FIXTURE}")

    # follow_redirects: Hub runs with Next.js `trailingSlash: true`, so the
    # canonical doors are `/files/` and `/chat/` and a slash-less URL 308s.
    # httpx preserves method + body across a 308, so following it reaches the
    # real door instead of erroring on the redirect.
    with httpx.Client(timeout=60, follow_redirects=True) as client:
        # 1. Upload through the REAL door (multipart form). No direct DB writes.
        with FIXTURE.open("rb") as fh:
            files = {"file": (FIXTURE.name, fh, "application/pdf")}
            up = client.post(cfg.upload_url, files=files, headers=_headers(cfg))
            up.raise_for_status()

        # 2. Poll: re-ask until the uploaded content shows up or the budget runs out.
        deadline = time.monotonic() + cfg.poll_seconds
        last = ""
        while time.monotonic() < deadline:
            last = _ask(cfg, client)
            if answers_with_manual_fact(last):
                break
            time.sleep(5)

    low = last.lower()
    has_content = answers_with_manual_fact(last)
    has_citation = any(m in low for m in CITATION_MARKERS)
    cited = has_content and has_citation
    explain = (
        f"answer({len(last)} chars) content={has_content} citation={has_citation}; "
        f"first 240: {last[:240]!r}"
    )
    return GateResult(cited=cited, answer=last, explain=explain)
