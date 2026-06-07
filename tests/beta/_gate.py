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
  BETA_GATE_ASSET        asset / UNS hint sent with the question (optional).
  BETA_GATE_POLL_SECONDS ingestion poll budget (default 90).
"""

from __future__ import annotations

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
    )


def _headers(cfg: GateConfig) -> dict[str, str]:
    h = {"X-Tenant-Id": cfg.tenant}
    if cfg.api_key:
        h["Authorization"] = f"Bearer {cfg.api_key}"
    return h


def _ask(cfg: GateConfig, client: httpx.Client) -> str:
    """Ask the question through the real chat endpoint; return the answer text."""
    payload = {"question": QUESTION, "query": QUESTION, "tenant_id": cfg.tenant}
    if cfg.asset:
        payload["asset_id"] = cfg.asset
    resp = client.post(cfg.chat_url, json=payload, headers=_headers(cfg))
    resp.raise_for_status()
    data = resp.json()
    # Accept a few common response shapes (engine/pipeline/OpenAI-compat).
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

    with httpx.Client(timeout=60) as client:
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
            if EXPECTED_CONTENT in last.lower():
                break
            time.sleep(5)

    low = last.lower()
    has_content = EXPECTED_CONTENT in low
    has_citation = any(m in low for m in CITATION_MARKERS)
    cited = has_content and has_citation
    explain = (
        f"answer({len(last)} chars) content={has_content} citation={has_citation}; "
        f"first 240: {last[:240]!r}"
    )
    return GateResult(cited=cited, answer=last, explain=explain)
