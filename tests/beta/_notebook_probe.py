"""Production-equivalent notebook probe — Workstream B (PRD §8).

ONE reusable probe, three callers:
  * `beta_ready_notebook_confirmed_source.py`  — the pytest release gate (staging CI)
  * `python tests/beta/_notebook_probe.py`      — CLI; DRY-RUN unless every input is present
  * `.github/workflows/beta-probe-prod.yml`     — Mike-dispatched production run

It drives ONLY public Hub application APIs, exactly the calls mira-mobile makes:

  GET  /api/health/                                  gate state (non-secret) must be enforced
  POST /api/equipment-notebooks/                     run-unique notebook (+ backing node)
  POST /api/equipment-notebooks/{id}/chat/           grounded, NO sources → 422 no_sources_selected
  POST /api/namespace/node/{nodeId}/files/           run-unique PDF with a run-unique sentinel fact
  POST /api/equipment-notebooks/{id}/sources/        attach = the technician's confirmation
  GET  /api/equipment-notebooks/{id}/                poll sources[].readiness.canChat (the contract)
  POST /api/equipment-notebooks/{id}/chat/           sentinel question → answered + exact doc/page
  GET  /api/equipment-notebooks/{id}/sources/{doc}/passage/?page=N   cited passage identity
  POST /api/equipment-notebooks/{id}/chat/           unsupported question → provider-free refusal
  DELETE notebook / upload / file                    run-owned cleanup only

Never: raw SQL, secrets in output, fixed sleeps as proof, shared-corpus fixtures.
The uploaded chunks stay `knowledge_entries.verified = false`; they become
citable ONLY through the server-derived confirmed-source admission (Workstream
A). A locally reverted admission fix makes the sentinel turn refuse → the lane
goes red.

Env contract (all optional → DRY-RUN when incomplete):
  BETA_PROBE_HUB_BASE     e.g. http://localhost:3100 or https://app.factorylm.com
  BETA_PROBE_COOKIE       raw next-auth cookie header, OR
  BETA_PROBE_EMAIL + BETA_PROBE_PASSWORD   an EXISTING QA tenant login (the probe
                          signs in itself; it never registers — registration does
                          not mirror the data-side tenant row, and that is a
                          provisioning concern, not a public-API one)
  BETA_PROBE_POLL_SECONDS readiness budget (default 180)
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

import httpx

REDACT_KEYS = ("cookie", "password", "authorization", "set-cookie", "token")


class ProbeUnavailable(RuntimeError):
    """Inputs incomplete — the probe must not send a single request."""


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

    def to_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "run_id": self.run_id,
            "notebook_id": self.notebook_id,
            "doc_id": self.doc_id,
            "failures": self.failures,
            "steps": self.steps,
            "total_ms": sum(int(s.get("ms", 0)) for s in self.steps),
        }


# ── config ────────────────────────────────────────────────────────────────────


def load_probe_config() -> ProbeConfig:
    base = os.getenv("BETA_PROBE_HUB_BASE", "").strip().rstrip("/")
    cookie = os.getenv("BETA_PROBE_COOKIE", "").strip() or None
    email = os.getenv("BETA_PROBE_EMAIL", "").strip() or None
    password = os.getenv("BETA_PROBE_PASSWORD", "") or None
    missing: list[str] = []
    if not base:
        missing.append("BETA_PROBE_HUB_BASE")
    if not cookie and not (email and password):
        missing.append("BETA_PROBE_COOKIE or BETA_PROBE_EMAIL+BETA_PROBE_PASSWORD")
    if missing:
        raise ProbeUnavailable("notebook probe not runnable — missing " + ", ".join(missing))
    return ProbeConfig(
        hub_base=base,
        cookie=cookie,
        email=email,
        password=password,
        poll_seconds=int(os.getenv("BETA_PROBE_POLL_SECONDS", "180")),
        require_usage=os.getenv("BETA_PROBE_REQUIRE_USAGE", "1") != "0",
    )


# ── run-unique document (pure-python PDF, no dependency) ─────────────────────


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
    streams = [_page_stream(page1), _page_stream(page2)]
    objs: list[bytes] = []
    objs.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    objs.append(b"<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>")
    for i, st in enumerate(streams):
        page_no = 3 + i * 2
        objs.append(
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents {page_no + 1} 0 R >>".encode()
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
    frames: Frames, *, doc_id: str, expected_page: int, expected_value: str, require_usage: bool
) -> list[str]:
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
    if expected_value not in frames.content:
        fails.append(f"answer does not state the sentinel value {expected_value}")
    if require_usage:
        if frames.usage is None or not frames.usage.get("provider"):
            fails.append("provider usage missing/null on an answered turn")
        elif not frames.usage.get("model"):
            fails.append("model null on an answered turn")
    return fails


def judge_refusal(frames: Frames) -> list[str]:
    fails: list[str] = []
    if frames.status != "insufficient_evidence":
        fails.append(f"status={frames.status!r}, expected 'insufficient_evidence'")
    if frames.citations:
        fails.append(f"refusal shipped citations: {[c.get('docId') for c in frames.citations]}")
    if frames.usage is not None:
        fails.append(
            f"provider was called on a refusal path (usage provider={frames.usage.get('provider')!r})"
        )
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


def run_notebook_probe(cfg: ProbeConfig, client: httpx.Client | None = None) -> ProbeReport:
    run_id = secrets.token_hex(4)
    code, value = _sentinel()
    steps: list[dict[str, Any]] = []
    failures: list[str] = []
    notebook_id: str | None = None
    node_id: str | None = None
    doc_id: str | None = None
    file_id: str | None = None
    own_client = client is None
    if client is None:
        client = httpx.Client(base_url=cfg.hub_base, timeout=90, follow_redirects=True)
    # The ACTIVE session cookie lives outside the try so cleanup can use it
    # whether it was supplied (BETA_PROBE_COOKIE) or minted by sign-in.
    active_cookie: str | None = cfg.cookie

    def step(name: str, t0: float, **info: Any) -> None:
        steps.append({"name": name, "ms": int((time.monotonic() - t0) * 1000), **_redact(info)})

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
        step("gate_state", t0, http=health.status_code, approvedRetrievalEnforced=enforced)
        if not enforced:
            failures.append(
                "MIRA_ENFORCE_APPROVED_RETRIEVAL is not effective on this Hub — not the production gate"
            )
            return ProbeReport(False, failures, steps, run_id)

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
            failures.append(f"notebook create HTTP {r.status_code}")
            return ProbeReport(False, failures, steps, run_id)
        nb = r.json()["notebook"]
        notebook_id, node_id = nb["id"], nb.get("nodeId")
        step("create_notebook", t0, notebook_id=notebook_id, node_id=node_id)

        question = f"What is the torque setting for coupling bolt code {code}?"
        unsupported = "Where is the hydraulic reservoir drain plug on this machine?"

        # 3. pre-upload: grounded ask with nothing attached must refuse without a provider
        t0 = time.monotonic()
        pre = _chat(client, h, notebook_id, question, [])
        pre_ok = pre.http_status == 422 and (pre.error or {}).get("error") == "no_sources_selected"
        step("pre_upload_refusal", t0, http=pre.http_status, error=pre.error, status=pre.status)
        if not pre_ok:
            failures.append(
                f"pre-upload grounded ask did not refuse provider-free (HTTP {pre.http_status}, status={pre.status!r}, error={pre.error})"
            )
            return ProbeReport(False, failures, steps, run_id, notebook_id=notebook_id)

        # 4. upload the run-unique document through the real door
        t0 = time.monotonic()
        pdf = build_probe_document(run_id, code, value)
        r = client.post(
            f"/api/namespace/node/{node_id}/files/",
            files={"file": (f"probe-{run_id}.pdf", pdf, "application/pdf")},
            headers=h,
        )
        body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
        doc_id, file_id = body.get("uploadId"), body.get("fileId")
        step(
            "upload",
            t0,
            http=r.status_code,
            indexed=body.get("indexed"),
            duplicate=body.get("duplicate"),
            chunkCount=body.get("chunkCount"),
            doc_id=doc_id,
        )
        if r.status_code != 201 or not doc_id or body.get("duplicate"):
            failures.append(
                f"upload was not a fresh indexed document (HTTP {r.status_code}, body={_redact(body)})"
            )
            return ProbeReport(False, failures, steps, run_id, doc_id, notebook_id)

        # 5. confirm through the product contract (attach = user_confirmed)
        t0 = time.monotonic()
        r = client.post(
            f"/api/equipment-notebooks/{notebook_id}/sources/",
            json={"docId": doc_id, "sourceRole": "manual"},
            headers=h,
        )
        step("confirm_source", t0, http=r.status_code)
        if r.status_code != 201:
            failures.append(f"source confirmation HTTP {r.status_code}")
            return ProbeReport(False, failures, steps, run_id, doc_id, notebook_id)

        # 6. readiness — poll the contract, never a fixed sleep
        t0 = time.monotonic()
        deadline = time.monotonic() + cfg.poll_seconds
        last: dict[str, Any] | None = None
        polls = 0
        while True:
            polls += 1
            r = client.get(f"/api/equipment-notebooks/{notebook_id}/", headers=h)
            srcs = r.json().get("sources", []) if r.status_code == 200 else []
            last = next((s for s in srcs if s.get("docId") == doc_id), None)
            rd = (last or {}).get("readiness") or {}
            if (
                rd.get("canChat")
                or rd.get("state") in ("failed", "needs_ocr")
                or time.monotonic() >= deadline
            ):
                break
            time.sleep(2)
        rd = (last or {}).get("readiness") or {}
        step(
            "readiness",
            t0,
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
            failures.append(
                f"source never became askable+confirmed within {cfg.poll_seconds}s (readiness={rd}, source={_redact(last)})"
            )
            return ProbeReport(False, failures, steps, run_id, doc_id, notebook_id)

        # 7. the sentinel question — answered ONLY from the run-owned document
        t0 = time.monotonic()
        ans = _chat(client, h, notebook_id, question, [doc_id])
        fails = judge_answered(
            ans,
            doc_id=doc_id,
            expected_page=2,
            expected_value=value,
            require_usage=cfg.require_usage,
        )
        step(
            "sentinel_answer",
            t0,
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

        # 8. passage identity — the cited page really carries the sentinel
        t0 = time.monotonic()
        r = client.get(
            f"/api/equipment-notebooks/{notebook_id}/sources/{doc_id}/passage/",
            params={"page": 2},
            headers=h,
        )
        texts = [
            p.get("text", "")
            for p in (r.json().get("passages", []) if r.status_code == 200 else [])
        ]
        hit = any(code in t and value in t for t in texts)
        step("passage_identity", t0, http=r.status_code, passages=len(texts), sentinel_on_page=hit)
        if not hit:
            failures.append("cited page 2 passage does not contain the sentinel fact")

        # 9. unsupported grounded question — refuse, provider-free
        t0 = time.monotonic()
        ref = _chat(client, h, notebook_id, unsupported, [doc_id])
        step(
            "unsupported_refusal",
            t0,
            http=ref.http_status,
            status=ref.status,
            usage=ref.usage,
            citations=ref.citations,
        )
        failures.extend(judge_refusal(ref))
    except Exception as exc:  # noqa: BLE001 — every failure is evidence, never a traceback with secrets
        failures.append(f"{type(exc).__name__}: {str(exc)[:300]}")
    finally:
        # 10. run-owned cleanup, even after failure — only what THIS run created
        # Cleanup is PROOF, not observation: any target that is neither
        # deleted (2xx) nor already gone (404) is a probe failure, and so is
        # an exception mid-cleanup — a QA tenant must not accumulate rows.
        #
        # Order matters, and every step is proof-checked:
        #   1. GET /api/files/{fileId}/ → detach each of this run-unique file's
        #      links (the upload door filed it at the notebook's node; without
        #      the detach, DELETE file is a 409 has_links);
        #   2. DELETE notebook (removes sources/turns/notebook links only — it
        #      deliberately keeps the file and the backing kg node);
        #   3. DELETE upload; 4. DELETE file (now link-free);
        #   5. DELETE the run-owned backing node (/api/namespace/node/{id}/).
        t0 = time.monotonic()
        outcome: dict[str, Any] = {}
        targets: list[tuple[str, str]] = []
        h2 = {"Cookie": active_cookie} if active_cookie else {}
        if file_id and active_cookie:
            try:
                fr = client.get(f"/api/files/{file_id}/", headers=h2)
                outcome["file_links_get"] = fr.status_code
                if fr.status_code == 200:
                    links = fr.json().get("links") or []
                    for ln in links:
                        lid = str(ln.get("id") or "")
                        if lid:
                            targets.append((f"link:{lid}", f"/api/files/{file_id}/links/{lid}/"))
                    outcome["file_links"] = len(links)
                elif fr.status_code != 404:
                    failures.append(
                        f"cleanup file links GET HTTP {fr.status_code} — cannot detach run-owned file"
                    )
            except Exception as exc:  # noqa: BLE001
                outcome["file_links_get"] = type(exc).__name__
                failures.append(
                    f"cleanup file links GET raised {type(exc).__name__}: {str(exc)[:200]}"
                )
        if notebook_id:
            targets.append(("notebook", f"/api/equipment-notebooks/{notebook_id}/"))
        if doc_id:
            targets.append(("upload", f"/api/uploads/{doc_id}/"))
        if file_id:
            targets.append(("file", f"/api/files/{file_id}/"))
        if node_id:
            targets.append(("node", f"/api/namespace/node/{node_id}/"))
        if targets and not active_cookie:
            failures.append("cleanup impossible: no active session cookie")
        for name, path in targets:
            try:
                code_ = client.delete(path, headers=h2).status_code
            except Exception as exc:  # noqa: BLE001
                outcome[name] = f"{type(exc).__name__}"
                failures.append(f"cleanup {name} raised {type(exc).__name__}: {str(exc)[:200]}")
                continue
            outcome[name] = code_
            if not (200 <= code_ < 300 or code_ == 404):
                failures.append(
                    f"cleanup {name} HTTP {code_} — run-owned record NOT removed ({path})"
                )
        steps.append({"name": "cleanup", "ms": int((time.monotonic() - t0) * 1000), **outcome})
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
    args = ap.parse_args(argv)
    try:
        cfg = None if args.dry_run else load_probe_config()
    except ProbeUnavailable as exc:
        cfg = None
        print(f"DRY-RUN: {exc}")
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
    payload = report.to_dict()
    if args.evidence_out:
        with open(args.evidence_out, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, indent=2)
    print(json.dumps(payload, indent=2))
    print("PROBE " + ("PASS" if report.ok else "FAIL"))
    return 0 if report.ok else 1


if __name__ == "__main__":
    sys.exit(main())
