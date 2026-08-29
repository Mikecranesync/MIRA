"""Production-equivalent notebook probe — Workstream B (PRD §8).

ONE reusable probe, three callers:
  * `beta_ready_notebook_confirmed_source.py`  — the pytest release gate (staging CI)
  * `python tests/beta/_notebook_probe.py`      — CLI; DRY-RUN unless every input is present
  * `.github/workflows/beta-probe-prod.yml`     — Mike-dispatched production run

It drives ONLY public Hub application APIs, exactly the calls mira-mobile makes:

  GET  /api/health/                                  gate state (non-secret) must be enforced
  POST /api/equipment-notebooks/                     run-unique notebook (+ backing node)
  POST /api/equipment-notebooks/{id}/chat/           grounded, NO sources → 422 no_sources_selected
  POST /api/namespace/node/{nodeId}/files/           run-unique CONTROL document (no sentinel)
  POST /api/equipment-notebooks/{id}/sources/        attach = the technician's confirmation
  GET  /api/equipment-notebooks/{id}/                poll sources[].readiness.canChat (the contract)
  POST …/chat/  [control]                            sentinel question through REAL retrieval →
                                                     200 insufficient_evidence, no citation, no usage
  POST /api/namespace/node/{nodeId}/files/           run-unique SENTINEL document (fact on page 2)
  POST …/sources/ + GET …/ (readiness)               confirm + wait, same contract
  POST …/chat/  [control, sentinel]                  → answered, every citation = the sentinel doc,
                                                     page 2, provider usage non-null
  GET  …/sources/{doc}/passage/?page=2               cited passage identity (server-side)
  POST …/chat/  [control, sentinel]  unsupported     → 200 insufficient_evidence, provider-free
  DELETE links → notebook → uploads → files → node   run-owned cleanup only, every status checked

Never: raw SQL, secrets in output, fixed sleeps as proof, shared-corpus fixtures.
The uploaded chunks stay `knowledge_entries.verified = false`; they become
citable ONLY through the server-derived confirmed-source admission (Workstream
A). With that admission reverted the sentinel turn refuses — the lane goes red,
and `expected_regression_outcome()` recognises exactly that signature (§8.4).

Env contract (all optional → DRY-RUN when incomplete):
  BETA_PROBE_HUB_BASE      bare http(s) origin, e.g. http://localhost:3100
  BETA_PROBE_EXPECT_ORIGIN when set, HUB_BASE must equal it EXACTLY (scheme,
                           host, port) — the production workflow pins
                           https://app.factorylm.com; a mismatch is REFUSED
                           (exit 2), never a silent dry-run
  BETA_PROBE_COOKIE        raw next-auth cookie header, OR
  BETA_PROBE_EMAIL + BETA_PROBE_PASSWORD   an EXISTING QA tenant login (the probe
                           signs in itself; it never registers)
  BETA_PROBE_POLL_SECONDS  readiness budget per document (default 180)
  BETA_PROBE_REQUIRE_USAGE "0" to accept a Hub running the legacy cascade (no
                           usage frame). Default "1": provider/model must be non-null.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import secrets
import sys
import time
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlsplit

import httpx

REDACT_KEYS = ("cookie", "password", "authorization", "set-cookie", "token")
SENTINEL_PAGE = 2
SETUP_STEPS = (
    "gate_state",
    "create_notebook",
    "pre_upload_no_sources",
    "control_upload",
    "control_confirm",
    "control_readiness",
    "pre_upload_control_refusal",
    "upload",
    "confirm_source",
    "readiness",
)


class ProbeUnavailable(RuntimeError):
    """Inputs incomplete — the probe must not send a single request (→ DRY-RUN)."""


class ProbeRefused(RuntimeError):
    """Inputs present but UNSAFE (wrong origin, malformed base) — loud failure, no request."""


@dataclass
class ProbeConfig:
    hub_base: str
    cookie: str | None = None
    email: str | None = None
    password: str | None = None
    poll_seconds: int = 180
    require_usage: bool = True


@dataclass
class Frames:
    content: str = ""
    citations: list[dict[str, Any]] = field(default_factory=list)
    status: str | None = None
    status_message: str | None = None
    usage: dict[str, Any] | None = None
    evidence: dict[str, Any] | None = None
    http_status: int | None = None
    error: dict[str, Any] | None = None


@dataclass
class ProbeReport:
    ok: bool
    failures: list[str]
    steps: list[dict[str, Any]]
    run_id: str
    doc_id: str | None = None
    notebook_id: str | None = None
    expected_regression: str | None = None  # set by the CLI: "matched" | "not_matched"

    def step(self, name: str) -> dict[str, Any] | None:
        return next((s for s in self.steps if s.get("name") == name), None)

    def outcome(self) -> dict[str, Any]:
        """Structured, grep-free summary of WHAT happened (PRD §8.4)."""
        done = {s["name"]: s for s in self.steps}
        sentinel = done.get("sentinel_answer") or {}
        return {
            "setup_ok": all(bool(done.get(n, {}).get("ok")) for n in SETUP_STEPS),
            "sentinel_turn": {
                "http": sentinel.get("http"),
                "status": sentinel.get("status"),
                "citations": len(sentinel.get("citations") or []),
                "usage_present": sentinel.get("usage") is not None,
            },
            "passage_identity_ok": bool(done.get("passage_identity", {}).get("ok")),
            "unsupported_refusal_ok": bool(done.get("unsupported_refusal", {}).get("ok")),
            "cleanup_ok": bool(done.get("cleanup", {}).get("ok")),
            "expected_regression": self.expected_regression,
        }

    def to_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "run_id": self.run_id,
            "notebook_id": self.notebook_id,
            "doc_id": self.doc_id,
            "failures": self.failures,
            "steps": self.steps,
            "outcome": self.outcome(),
            "total_ms": sum(int(s.get("ms", 0)) for s in self.steps),
        }


# ── config ────────────────────────────────────────────────────────────────────


def _normalise_origin(raw: str) -> str:
    """A bare http(s) origin: scheme + host[:port]; no userinfo/path/query/fragment."""
    s = raw.strip()
    parts = urlsplit(s)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise ProbeRefused(f"BETA_PROBE_HUB_BASE must be a bare http(s) origin (got {s[:60]!r})")
    if parts.username or parts.password:
        raise ProbeRefused("BETA_PROBE_HUB_BASE must not carry credentials")
    if parts.path not in ("", "/") or parts.query or parts.fragment:
        raise ProbeRefused("BETA_PROBE_HUB_BASE must be an origin only (no path/query/fragment)")
    port = f":{parts.port}" if parts.port else ""
    return f"{parts.scheme}://{parts.hostname.lower()}{port}"


def load_probe_config() -> ProbeConfig:
    base_raw = os.getenv("BETA_PROBE_HUB_BASE", "").strip()
    cookie = os.getenv("BETA_PROBE_COOKIE", "").strip() or None
    email = os.getenv("BETA_PROBE_EMAIL", "").strip() or None
    password = os.getenv("BETA_PROBE_PASSWORD", "") or None
    missing: list[str] = []
    if not base_raw:
        missing.append("BETA_PROBE_HUB_BASE")
    if not cookie and not (email and password):
        missing.append("BETA_PROBE_COOKIE or BETA_PROBE_EMAIL+BETA_PROBE_PASSWORD")
    if missing:
        raise ProbeUnavailable("notebook probe not runnable — missing " + ", ".join(missing))
    base = _normalise_origin(base_raw)
    expect = os.getenv("BETA_PROBE_EXPECT_ORIGIN", "").strip()
    if expect and base != _normalise_origin(expect):
        raise ProbeRefused(f"destination {base} is not the pinned origin {expect}")
    return ProbeConfig(
        hub_base=base,
        cookie=cookie,
        email=email,
        password=password,
        poll_seconds=int(os.getenv("BETA_PROBE_POLL_SECONDS", "180")),
        require_usage=os.getenv("BETA_PROBE_REQUIRE_USAGE", "1") != "0",
    )


# ── run-unique documents (pure-python PDF, no dependency) ────────────────────


def _sentinel() -> tuple[str, str]:
    """A code no corpus has ever seen + a value the answer must repeat."""
    code = "QZ" + secrets.token_hex(3).upper()  # e.g. QZ3F9A1C
    value = str(secrets.randbelow(880) + 101)  # 101..980 newton meters
    return code, value


def _pdf_escape(s: str) -> str:
    return s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _page_stream(lines: list[str]) -> bytes:
    ops = ["BT", "/F1 12 Tf", "72 740 Td", "14 TL"]
    for ln in lines:
        ops.append(f"({_pdf_escape(ln)}) Tj T*")
    ops.append("ET")
    return "\n".join(ops).encode("ascii")


def _pdf(pages: list[list[str]]) -> bytes:
    streams = [_page_stream(p) for p in pages]
    objs: list[bytes] = [b"<< /Type /Catalog /Pages 2 0 R >>"]
    kids = " ".join(f"{3 + i * 2} 0 R" for i in range(len(streams)))
    objs.append(f"<< /Type /Pages /Kids [{kids}] /Count {len(streams)} >>".encode())
    font_obj = 3 + len(streams) * 2
    for i, st in enumerate(streams):
        page_no = 3 + i * 2
        objs.append(
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 {font_obj} 0 R >> >> /Contents {page_no + 1} 0 R >>".encode()
        )
        objs.append(b"<< /Length " + str(len(st)).encode() + b" >>\nstream\n" + st + b"\nendstream")
    objs.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets: list[int] = []
    for n, body in enumerate(objs, start=1):
        offsets.append(len(out))
        out += f"{n} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n".encode()
    out += b"0000000000 65535 f \n"
    for off in offsets:
        out += f"{off:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return bytes(out)


def build_probe_document(run_id: str, sentinel_code: str, sentinel_value: str) -> bytes:
    """Two-page text PDF. Page 1 = identity, page 2 = the sentinel fact.

    Vocabulary is deliberately controlled so the UNSUPPORTED question
    (hydraulic reservoir drain plug) shares no stem with any chunk — that is
    what makes its refusal provider-free by construction (zero BM25 hits).
    """
    page1 = [
        f"FactoryLM beta probe document, run {run_id}",
        "Section 1. Identity",
        "This document is generated for one automated probe run and is",
        "deleted by that run. It is not an OEM manual.",
        f"Run identifier: {run_id}",
    ]
    page2 = [
        "Section 2. Coupling bolt torque",
        f"Coupling bolt code {sentinel_code}: the torque setting is",
        f"{sentinel_value} newton meters.",
        f"Tighten coupling bolt {sentinel_code} to {sentinel_value} newton meters",
        "with the motor isolated.",
    ]
    return _pdf([page1, page2])


def build_control_document(run_id: str) -> bytes:
    """A run-unique CONTROL document that shares NO stem with the sentinel
    question (torque / setting / coupling / bolt / code / the sentinel token)
    nor with the unsupported question. Asking the sentinel over it exercises
    the real retrieval + Gate G path and must refuse without a provider."""
    page1 = [
        f"FactoryLM beta probe control document, run {run_id}",
        "Section 1. Belt guard inspection interval",
        "Inspect the belt guard every 250 operating hours and record the",
        "result on the inspection card. Replace a cracked guard before restart.",
        f"Control identifier: control-{run_id}",
    ]
    return _pdf([page1])


# ── SSE frames ────────────────────────────────────────────────────────────────


def parse_notebook_frames(text: str) -> Frames:
    f = Frames()
    parts: list[str] = []
    for line in text.splitlines():
        line = line.strip()
        if not line.startswith("data:"):
            continue
        payload = line[5:].strip()
        if not payload or payload == "[DONE]":
            continue
        try:
            obj = json.loads(payload)
        except (ValueError, TypeError):
            continue
        if not isinstance(obj, dict):
            continue
        kind = obj.get("kind")
        if kind == "content" and isinstance(obj.get("content"), str):
            parts.append(obj["content"])
        elif kind == "sources" and isinstance(obj.get("citations"), list):
            f.citations = obj["citations"]
        elif kind == "status":
            f.status = obj.get("status")
            f.status_message = obj.get("message")
        elif kind == "usage":
            f.usage = obj
        elif kind == "evidence":
            f.evidence = obj
    f.content = "".join(parts)
    return f


# ── judges ────────────────────────────────────────────────────────────────────


def judge_answered(
    frames: Frames,
    *,
    doc_id: str,
    expected_page: int,
    expected_value: str,
    require_usage: bool,
    expected_excerpt_tokens: tuple[str, ...] = (),
    expected_file_id: str | None = None,
) -> list[str]:
    """Judge an answered turn on SERVER-exposed identity only.

    `docId`, `page`, `quote` (the server's excerpt window of the cited chunk)
    and `fileId` (resolved server-side from the upload id) all come from the
    Hub's citation contract; `expected_file_id` is the id the upload door
    itself returned. Nothing here trusts a client-supplied identity.
    """
    fails: list[str] = []
    if frames.status != "answered":
        fails.append(f"status={frames.status!r}, expected 'answered' ({frames.status_message!r})")
    if not frames.citations:
        fails.append("no citation emitted for a run-owned fact")
    foreign = [c for c in frames.citations if str(c.get("docId")) != doc_id]
    if foreign:
        fails.append(
            f"other document cited: {[c.get('docId') for c in foreign]} (run-owned doc is {doc_id})"
        )
    pages = {c.get("page") for c in frames.citations if str(c.get("docId")) == doc_id}
    if frames.citations and expected_page not in pages:
        fails.append(
            f"cited page(s) {sorted(str(p) for p in pages)} do not include the sentinel page {expected_page}"
        )
    own = [c for c in frames.citations if str(c.get("docId")) == doc_id]
    if expected_excerpt_tokens and frames.citations:
        quotes = [str(c.get("quote") or "") for c in own]
        if not any(all(tok in q for tok in expected_excerpt_tokens) for q in quotes):
            fails.append(
                "no cited excerpt (server `quote`) carries the sentinel "
                f"{expected_excerpt_tokens} — citation is not evidence for the answer"
            )
    if expected_file_id and frames.citations:
        file_ids = {str(c.get("fileId")) for c in own if c.get("fileId")}
        if file_ids and expected_file_id not in file_ids:
            fails.append(
                f"citation file identity {sorted(file_ids)} != server-issued upload file {expected_file_id}"
            )
    if expected_value not in frames.content:
        fails.append(f"answer does not state the sentinel value {expected_value}")
    if require_usage:
        if frames.usage is None or not frames.usage.get("provider"):
            fails.append("provider usage missing/null on an answered turn")
        elif not frames.usage.get("model"):
            fails.append("model null on an answered turn")
    return fails


def judge_refusal(frames: Frames) -> list[str]:
    """A grounded refusal must be a 200 SSE `insufficient_evidence` with no
    citations and NO provider usage (Gate G — the provider was never called)."""
    fails: list[str] = []
    if frames.http_status is not None and frames.http_status != 200:
        fails.append(f"HTTP {frames.http_status}, expected 200 SSE refusal (error={frames.error})")
    if frames.status != "insufficient_evidence":
        fails.append(f"status={frames.status!r}, expected 'insufficient_evidence'")
    if frames.citations:
        fails.append(f"refusal shipped citations: {[c.get('docId') for c in frames.citations]}")
    if frames.usage is not None:
        fails.append(
            f"provider was called on a refusal path (usage provider={frames.usage.get('provider')!r})"
        )
    return fails


def expected_regression_outcome(report: ProbeReport) -> list[str]:
    """PRD §8.4: the DELIBERATE-DEFECT signature, and nothing else.

    Matches only when every setup step (auth, gate, notebook, control, upload,
    confirmation, readiness), the passage identity, the unsupported refusal and
    the cleanup all SUCCEEDED, and the sentinel turn is exactly HTTP 200 +
    `insufficient_evidence` + zero citations + no usage frame. Auth, upload,
    timeout, provider, 5xx, cleanup or assertion failures stay red.
    """
    o = report.outcome()
    fails: list[str] = []
    if not o["setup_ok"]:
        bad = [n for n in SETUP_STEPS if not (report.step(n) or {}).get("ok")]
        fails.append(f"setup did not succeed: {bad}")
    st = o["sentinel_turn"]
    if st["http"] != 200:
        fails.append(
            f"sentinel turn HTTP {st['http']}, expected 200 (a broken build, not the defect)"
        )
    if st["status"] == "answered":
        fails.append("sentinel turn was answered — the admission fix is present, not the defect")
    elif st["status"] != "insufficient_evidence":
        fails.append(f"sentinel turn status {st['status']!r}, expected 'insufficient_evidence'")
    if st["citations"]:
        fails.append("sentinel turn shipped citations")
    if st["usage_present"]:
        fails.append("provider was called on the sentinel turn — not the provider-free defect")
    if not o["passage_identity_ok"]:
        fails.append(
            "passage identity did not resolve (ingest/page anchoring problem, not the defect)"
        )
    if not o["unsupported_refusal_ok"]:
        fails.append("unsupported question did not refuse provider-free")
    if not o["cleanup_ok"]:
        fails.append("cleanup did not fully succeed")
    return fails


# ── the probe ─────────────────────────────────────────────────────────────────


def _redact(obj: Any) -> Any:
    if isinstance(obj, dict):
        return {
            k: ("[redacted]" if any(r in k.lower() for r in REDACT_KEYS) else _redact(v))
            for k, v in obj.items()
        }
    if isinstance(obj, list):
        return [_redact(v) for v in obj]
    return obj


def _extract_session(raw: str) -> str | None:
    m = re.findall(r"next-auth\.session-token=([^;,\s]+)", raw)
    return m[-1] if m else None


def _sign_in(client: httpx.Client, cfg: ProbeConfig) -> str:
    csrf = client.get("/api/auth/csrf/")
    csrf.raise_for_status()
    token = csrf.json()["csrfToken"]
    form = {
        "email": cfg.email,
        "password": cfg.password,
        "csrfToken": token,
        "redirect": "false",
        "json": "true",
        "callbackUrl": cfg.hub_base,
    }
    r = client.post("/api/auth/callback/credentials/", data=form, follow_redirects=False)
    session = _extract_session(", ".join(r.headers.get_list("set-cookie")))
    if not session:
        raise RuntimeError(f"sign-in produced no session cookie (HTTP {r.status_code})")
    return f"next-auth.session-token={session}"


def _chat(
    client: httpx.Client, h: dict[str, str], nb: str, message: str, doc_ids: list[str]
) -> Frames:
    r = client.post(
        f"/api/equipment-notebooks/{nb}/chat/",
        json={"message": message, "sourceDocIds": doc_ids, "history": []},
        headers=h,
    )
    if "text/event-stream" in r.headers.get("content-type", "") or r.text.lstrip().startswith(
        "data:"
    ):
        f = parse_notebook_frames(r.text)
        f.http_status = r.status_code
        return f
    f = Frames(http_status=r.status_code)
    try:
        f.error = r.json()
    except ValueError:
        f.error = {"raw": r.text[:200]}
    return f


class _Abort(Exception):
    """Stop the flow after a recorded failure; cleanup still runs."""


def run_notebook_probe(cfg: ProbeConfig, client: httpx.Client | None = None) -> ProbeReport:
    run_id = secrets.token_hex(4)
    code, value = _sentinel()
    steps: list[dict[str, Any]] = []
    failures: list[str] = []
    notebook_id: str | None = None
    node_id: str | None = None
    doc_id: str | None = None
    file_id: str | None = None
    control_doc_id: str | None = None
    control_file_id: str | None = None
    own_client = client is None
    if client is None:
        client = httpx.Client(base_url=cfg.hub_base, timeout=90, follow_redirects=True)
    # The ACTIVE session cookie lives outside the try so cleanup can use it
    # whether it was supplied (BETA_PROBE_COOKIE) or minted by sign-in.
    active_cookie: str | None = cfg.cookie

    def step(name: str, t0: float, ok: bool, **info: Any) -> None:
        steps.append(
            {"name": name, "ok": ok, "ms": int((time.monotonic() - t0) * 1000), **_redact(info)}
        )

    def fail(name: str, t0: float, msg: str, **info: Any) -> None:
        step(name, t0, False, **info)
        failures.append(msg)
        raise _Abort()

    def upload(h: dict[str, str], filename: str, pdf: bytes, name: str) -> tuple[str, str]:
        t0 = time.monotonic()
        r = client.post(
            f"/api/namespace/node/{node_id}/files/",
            files={"file": (filename, pdf, "application/pdf")},
            headers=h,
        )
        body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
        up, fid = body.get("uploadId"), body.get("fileId")
        info = dict(
            http=r.status_code,
            indexed=body.get("indexed"),
            duplicate=body.get("duplicate"),
            chunkCount=body.get("chunkCount"),
            doc_id=up,
            file_id=fid,
        )
        if r.status_code != 201 or not up or body.get("duplicate"):
            fail(
                name,
                t0,
                f"{name}: not a fresh indexed document (HTTP {r.status_code}, body={_redact(body)})",
                **info,
            )
        step(name, t0, True, **info)
        return str(up), str(fid) if fid else ""

    def confirm(h: dict[str, str], did: str, name: str) -> None:
        t0 = time.monotonic()
        r = client.post(
            f"/api/equipment-notebooks/{notebook_id}/sources/",
            json={"docId": did, "sourceRole": "manual"},
            headers=h,
        )
        if r.status_code != 201:
            fail(name, t0, f"{name}: source confirmation HTTP {r.status_code}", http=r.status_code)
        step(name, t0, True, http=r.status_code)

    def wait_ready(h: dict[str, str], did: str, name: str) -> None:
        t0 = time.monotonic()
        deadline = time.monotonic() + cfg.poll_seconds
        last: dict[str, Any] | None = None
        polls = 0
        while True:
            polls += 1
            r = client.get(f"/api/equipment-notebooks/{notebook_id}/", headers=h)
            srcs = r.json().get("sources", []) if r.status_code == 200 else []
            last = next((s for s in srcs if s.get("docId") == did), None)
            rd = (last or {}).get("readiness") or {}
            if (
                rd.get("canChat")
                or rd.get("state") in ("failed", "needs_ocr")
                or time.monotonic() >= deadline
            ):
                break
            time.sleep(2)
        rd = (last or {}).get("readiness") or {}
        info = dict(
            polls=polls,
            state=rd.get("state"),
            canChat=rd.get("canChat"),
            matchState=(last or {}).get("matchState"),
            enabled=(last or {}).get("enabledByDefault"),
        )
        if (
            not rd.get("canChat")
            or (last or {}).get("matchState") not in ("user_confirmed", "verified")
            or not (last or {}).get("enabledByDefault")
        ):
            fail(
                name,
                t0,
                f"{name}: source never became askable+confirmed within {cfg.poll_seconds}s (readiness={rd}, source={_redact(last)})",
                **info,
            )
        step(name, t0, True, **info)

    try:
        # 0. auth
        if not active_cookie:
            active_cookie = _sign_in(client, cfg)
        h = {"Cookie": active_cookie}

        # 1. gate state — the effective, non-secret production flag
        t0 = time.monotonic()
        health = client.get("/api/health/", headers=h)
        enforced = (
            bool(health.json().get("approvedRetrievalEnforced"))
            if health.status_code < 500
            else False
        )
        if not enforced:
            fail(
                "gate_state",
                t0,
                "MIRA_ENFORCE_APPROVED_RETRIEVAL is not effective on this Hub — not the production gate",
                http=health.status_code,
                approvedRetrievalEnforced=enforced,
            )
        step("gate_state", t0, True, http=health.status_code, approvedRetrievalEnforced=enforced)

        # 2. run-unique notebook
        t0 = time.monotonic()
        r = client.post(
            "/api/equipment-notebooks/",
            json={
                "displayName": f"Beta probe {run_id}",
                "manufacturer": "FactoryLM",
                "model": f"PROBE-{run_id}",
            },
            headers=h,
        )
        if r.status_code != 201:
            fail("create_notebook", t0, f"notebook create HTTP {r.status_code}", http=r.status_code)
        nb = r.json()["notebook"]
        notebook_id, node_id = nb["id"], nb.get("nodeId")
        step("create_notebook", t0, True, notebook_id=notebook_id, node_id=node_id)

        question = f"What is the torque setting for coupling bolt code {code}?"
        unsupported = "Where is the hydraulic reservoir drain plug on this machine?"

        # 3a. nothing attached → the product's explicit honest state, no provider
        t0 = time.monotonic()
        pre = _chat(client, h, notebook_id, question, [])
        info = dict(http=pre.http_status, error=pre.error, status=pre.status)
        if not (pre.http_status == 422 and (pre.error or {}).get("error") == "no_sources_selected"):
            fail(
                "pre_upload_no_sources",
                t0,
                f"pre-upload ask with no sources did not return 422 no_sources_selected (HTTP {pre.http_status}, status={pre.status!r}, error={pre.error})",
                **info,
            )
        step("pre_upload_no_sources", t0, True, **info)

        # 3b. CONTROL source: real retrieval over a confirmed doc that does NOT
        #     contain the sentinel → 200 insufficient_evidence, uncited, provider-free.
        control_doc_id, control_file_id = upload(
            h, f"control-{run_id}.pdf", build_control_document(run_id), "control_upload"
        )
        confirm(h, control_doc_id, "control_confirm")
        wait_ready(h, control_doc_id, "control_readiness")
        t0 = time.monotonic()
        ctl = _chat(client, h, notebook_id, question, [control_doc_id])
        ctl_fails = judge_refusal(ctl)
        info = dict(
            http=ctl.http_status,
            status=ctl.status,
            citations=ctl.citations,
            usage=ctl.usage,
            error=ctl.error,
        )
        if ctl_fails:
            fail(
                "pre_upload_control_refusal",
                t0,
                "pre-upload grounded ask over the control source did not refuse provider-free: "
                + "; ".join(ctl_fails),
                **info,
            )
        step("pre_upload_control_refusal", t0, True, **info)

        # 4–6. the SENTINEL document through the same contract
        doc_id, file_id = upload(
            h, f"probe-{run_id}.pdf", build_probe_document(run_id, code, value), "upload"
        )
        confirm(h, doc_id, "confirm_source")
        wait_ready(h, doc_id, "readiness")

        # 7. the sentinel question — answered ONLY from the run-owned sentinel
        #    document, with the control doc in scope so "no other document
        #    cited" is a real assertion.
        scope = [control_doc_id, doc_id]
        t0 = time.monotonic()
        ans = _chat(client, h, notebook_id, question, scope)
        fails = judge_answered(
            ans,
            doc_id=doc_id,
            expected_page=SENTINEL_PAGE,
            expected_value=value,
            require_usage=cfg.require_usage,
            # Server-exposed identity only: the citation's `quote` (the Hub's
            # excerpt window) must carry the sentinel, and its `fileId` must be
            # the id the upload door itself issued.
            expected_excerpt_tokens=(code, value),
            expected_file_id=file_id or None,
        )
        step(
            "sentinel_answer",
            t0,
            not fails,
            question=question,
            expected_value=value,
            http=ans.http_status,
            status=ans.status,
            citations=ans.citations,
            usage=ans.usage,
            evidence=ans.evidence,
            answer=ans.content[:400],
        )
        failures.extend(fails)

        # 8. passage identity — the cited page really carries the sentinel (server-side)
        t0 = time.monotonic()
        r = client.get(
            f"/api/equipment-notebooks/{notebook_id}/sources/{doc_id}/passage/",
            params={"page": SENTINEL_PAGE},
            headers=h,
        )
        texts = [
            p.get("text", "")
            for p in (r.json().get("passages", []) if r.status_code == 200 else [])
        ]
        hit = any(code in t and value in t for t in texts)
        step(
            "passage_identity",
            t0,
            hit,
            http=r.status_code,
            passages=len(texts),
            sentinel_on_page=hit,
        )
        if not hit:
            failures.append(
                f"cited page {SENTINEL_PAGE} passage does not contain the sentinel fact"
            )

        # 9. unsupported grounded question — refuse, provider-free
        t0 = time.monotonic()
        ref = _chat(client, h, notebook_id, unsupported, scope)
        ref_fails = judge_refusal(ref)
        step(
            "unsupported_refusal",
            t0,
            not ref_fails,
            http=ref.http_status,
            status=ref.status,
            usage=ref.usage,
            citations=ref.citations,
        )
        failures.extend(ref_fails)
    except _Abort:
        pass
    except Exception as exc:  # noqa: BLE001 — every failure is evidence, never a traceback with secrets
        failures.append(f"{type(exc).__name__}: {str(exc)[:300]}")
    finally:
        # 10. run-owned cleanup, even after failure — only what THIS run created.
        # Cleanup is PROOF, not observation: any target that is neither
        # deleted (2xx) nor already gone (404) is a probe failure, and so is
        # an exception mid-cleanup — a QA tenant must not accumulate rows.
        # Order: enumerate + detach each run-unique file's links (the upload
        # door filed them at the notebook's node; without the detach a file
        # delete is 409 has_links) → notebook (keeps files + node by design)
        # → uploads → files → the run-owned backing node, last.
        t0 = time.monotonic()
        outcome: dict[str, Any] = {}
        cleanup_ok = True
        targets: list[tuple[str, str]] = []
        h2 = {"Cookie": active_cookie} if active_cookie else {}

        def enumerate_links(fid: str, label: str) -> None:
            nonlocal cleanup_ok
            try:
                fr = client.get(f"/api/files/{fid}/", headers=h2)
                outcome[f"{label}_links_get"] = fr.status_code
                if fr.status_code == 200:
                    links = fr.json().get("links") or []
                    for ln in links:
                        lid = str(ln.get("id") or "")
                        if lid:
                            targets.append((f"link:{lid}", f"/api/files/{fid}/links/{lid}/"))
                    outcome[f"{label}_links"] = len(links)
                elif fr.status_code != 404:
                    cleanup_ok = False
                    failures.append(
                        f"cleanup {label} links GET HTTP {fr.status_code} — cannot detach run-owned file"
                    )
            except Exception as exc:  # noqa: BLE001
                cleanup_ok = False
                outcome[f"{label}_links_get"] = type(exc).__name__
                failures.append(
                    f"cleanup {label} links GET raised {type(exc).__name__}: {str(exc)[:200]}"
                )

        if active_cookie:
            if file_id:
                enumerate_links(file_id, "file")
            if control_file_id:
                enumerate_links(control_file_id, "control_file")
        if notebook_id:
            targets.append(("notebook", f"/api/equipment-notebooks/{notebook_id}/"))
        if doc_id:
            targets.append(("upload", f"/api/uploads/{doc_id}/"))
        if control_doc_id:
            targets.append(("control_upload", f"/api/uploads/{control_doc_id}/"))
        if file_id:
            targets.append(("file", f"/api/files/{file_id}/"))
        if control_file_id:
            targets.append(("control_file", f"/api/files/{control_file_id}/"))
        if node_id:
            targets.append(("node", f"/api/namespace/node/{node_id}/"))
        if targets and not active_cookie:
            cleanup_ok = False
            failures.append("cleanup impossible: no active session cookie")
        for name, path in targets:
            try:
                code_ = client.delete(path, headers=h2).status_code
            except Exception as exc:  # noqa: BLE001
                cleanup_ok = False
                outcome[name] = f"{type(exc).__name__}"
                failures.append(f"cleanup {name} raised {type(exc).__name__}: {str(exc)[:200]}")
                continue
            outcome[name] = code_
            if not (200 <= code_ < 300 or code_ == 404):
                cleanup_ok = False
                failures.append(
                    f"cleanup {name} HTTP {code_} — run-owned record NOT removed ({path})"
                )
        steps.append(
            {
                "name": "cleanup",
                "ok": cleanup_ok,
                "ms": int((time.monotonic() - t0) * 1000),
                **outcome,
            }
        )
        if own_client:
            client.close()
    return ProbeReport(not failures, failures, steps, run_id, doc_id, notebook_id)


# ── CLI ───────────────────────────────────────────────────────────────────────


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description="FactoryLM notebook probe (dry-run unless every input is present)"
    )
    ap.add_argument("--evidence-out", default=None, help="write the redacted JSON report here")
    ap.add_argument(
        "--dry-run", action="store_true", help="force dry-run even when inputs are present"
    )
    ap.add_argument(
        "--expect-regression",
        action="store_true",
        help="PRD §8.4: exit 0 ONLY if the run shows exactly the deliberate-defect signature",
    )
    args = ap.parse_args(argv)
    try:
        cfg = None if args.dry_run else load_probe_config()
    except ProbeUnavailable as exc:
        cfg = None
        print(f"DRY-RUN: {exc}")
    except ProbeRefused as exc:
        print(f"REFUSED: {exc} — no request was sent")
        return 2
    if cfg is None:
        print(
            "DRY-RUN: no request was sent. Mike owns dispatch authorization and the QA-tenant credentials; "
            "supply BETA_PROBE_HUB_BASE plus BETA_PROBE_COOKIE or BETA_PROBE_EMAIL/BETA_PROBE_PASSWORD to run."
        )
        return 0
    try:
        report = run_notebook_probe(cfg)
    except Exception as exc:  # noqa: BLE001
        print(f"PROBE ERROR: {type(exc).__name__}")
        return 2
    if args.expect_regression:
        mismatch = expected_regression_outcome(report)
        report.expected_regression = "matched" if not mismatch else "not_matched"
    payload = report.to_dict()
    if args.evidence_out:
        with open(args.evidence_out, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, indent=2)
    print(json.dumps(payload, indent=2))
    if args.expect_regression:
        if mismatch:
            print("EXPECTED-REGRESSION NOT MATCHED:\n  - " + "\n  - ".join(mismatch))
            return 1
        print(
            "EXPECTED-REGRESSION MATCHED: sentinel turn refused provider-free with everything else green"
        )
        return 0
    print("PROBE " + ("PASS" if report.ok else "FAIL"))
    return 0 if report.ok else 1


if __name__ == "__main__":
    sys.exit(main())
