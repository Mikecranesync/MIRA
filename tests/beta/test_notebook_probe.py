"""Unit tests for the production-equivalent notebook probe (no live env).

Workstream B (PRD §8): the probe drives ONLY public Hub application APIs —
notebook create → upload → attach/confirm → readiness → grounded chat — and
judges the REAL notebook SSE frames. These tests pin the judge so it cannot
be satisfied by shared-corpus evidence, another document, a hallucinated
citation, a provider call on a refusal path, or a fixed sleep standing in
for the readiness contract.
"""

from __future__ import annotations

import json
import os
from unittest import mock

import httpx
import pytest

from . import _notebook_probe as probe_mod
from ._notebook_probe import (
    ProbeConfig,
    ProbeUnavailable,
    build_probe_document,
    judge_answered,
    judge_refusal,
    load_probe_config,
    main,
    parse_notebook_frames,
    run_notebook_probe,
)

DOC = "11111111-1111-4111-8111-111111111111"
OTHER_DOC = "22222222-2222-4222-8222-222222222222"
CONTROL = "33333333-3333-4333-8333-333333333333"


def _behaviour(name: str):
    """Resolve a probe symbol at TEST time so a not-yet-implemented behaviour
    fails as an assertion for its own reason, not as a collection error."""
    sym = getattr(probe_mod, name, None)
    assert sym is not None, f"missing behaviour: _notebook_probe.{name} is not implemented"
    return sym


def expected_regression_outcome(report):
    return _behaviour("expected_regression_outcome")(report)


class _NeverRaised(Exception):
    """Stand-in when ProbeRefused does not exist yet → pytest.raises reports DID NOT RAISE."""


def _probe_refused():
    return getattr(probe_mod, "ProbeRefused", _NeverRaised)


def _sse(*frames: object) -> str:
    return "".join(f"data: {json.dumps(f)}\n\n" for f in frames) + "data: [DONE]\n\n"


def _answered(
    doc_id: str = DOC,
    page: int = 2,
    usage: object = "default",
    answer: str = "It is 137 newton meters [1].",
):
    frames: list[object] = [
        {"kind": "content", "content": answer},
        {
            "kind": "sources",
            "citations": [
                {
                    "citationId": "1",
                    "docId": doc_id,
                    "page": page,
                    "sourceTitle": "probe.pdf",
                    "fileId": "file-1",
                    "quote": "Coupling bolt code QX7K3: the torque setting is 137 newton meters.",
                }
            ],
            "sourceSnapshot": [DOC],
        },
        {
            "kind": "evidence",
            "basis": "oem_documentation",
            "label": "Grounded in this notebook's sources.",
        },
    ]
    if usage == "default":
        usage = {
            "kind": "usage",
            "provider": "Groq",
            "model": "openai/gpt-oss-120b",
            "status": "ok",
        }
    if usage is not None:
        frames.append(usage)
    frames.append({"kind": "status", "status": "answered"})
    return _sse(*frames)


def _refusal(with_usage: bool = False, citations: list | None = None):
    frames: list[object] = [
        {"kind": "sources", "citations": citations or [], "sourceSnapshot": [DOC]}
    ]
    if with_usage:
        frames.append({"kind": "usage", "provider": "Groq", "model": "x", "status": "ok"})
    frames.append(
        {
            "kind": "status",
            "status": "insufficient_evidence",
            "message": "I couldn't find that in the selected sources.",
        }
    )
    return _sse(*frames)


# ── frame parsing ─────────────────────────────────────────────────────────────


def test_parse_frames_collects_typed_frames():
    f = parse_notebook_frames(_answered())
    assert f.content == "It is 137 newton meters [1]."
    assert f.status == "answered"
    assert f.citations[0]["docId"] == DOC
    assert f.usage["provider"] == "Groq"


def test_parse_frames_usage_none_when_absent():
    f = parse_notebook_frames(_refusal())
    assert f.status == "insufficient_evidence"
    assert f.usage is None
    assert f.citations == []


# ── judge: answered path ──────────────────────────────────────────────────────


def test_judge_answered_passes_on_exact_document_page_and_provider():
    f = parse_notebook_frames(_answered())
    assert (
        judge_answered(f, doc_id=DOC, expected_page=2, expected_value="137", require_usage=True)
        == []
    )


def test_judge_answered_rejects_other_document_citation():
    f = parse_notebook_frames(_answered(doc_id=OTHER_DOC))
    failures = judge_answered(
        f, doc_id=DOC, expected_page=2, expected_value="137", require_usage=True
    )
    assert any("other document" in x for x in failures)


def test_judge_answered_rejects_wrong_page():
    f = parse_notebook_frames(_answered(page=1))
    failures = judge_answered(
        f, doc_id=DOC, expected_page=2, expected_value="137", require_usage=True
    )
    assert any("page" in x for x in failures)


def test_judge_answered_rejects_missing_provider_usage():
    f = parse_notebook_frames(_answered(usage=None))
    failures = judge_answered(
        f, doc_id=DOC, expected_page=2, expected_value="137", require_usage=True
    )
    assert any("provider" in x for x in failures)
    # non-null provider AND model are both required
    f2 = parse_notebook_frames(
        _answered(usage={"kind": "usage", "provider": "Groq", "model": None})
    )
    assert any(
        "model" in x
        for x in judge_answered(
            f2, doc_id=DOC, expected_page=2, expected_value="137", require_usage=True
        )
    )


def test_judge_answered_rejects_missing_sentinel_value_and_no_citations():
    f = parse_notebook_frames(_answered(answer="I could not find that in the sources."))
    failures = judge_answered(
        f, doc_id=DOC, expected_page=2, expected_value="137", require_usage=True
    )
    assert any("sentinel" in x for x in failures)
    g = parse_notebook_frames(
        _sse(
            {"kind": "content", "content": "137 [1]"},
            {"kind": "sources", "citations": [], "sourceSnapshot": []},
            {"kind": "usage", "provider": "Groq", "model": "m"},
            {"kind": "status", "status": "answered"},
        )
    )
    assert any(
        "citation" in x
        for x in judge_answered(
            g, doc_id=DOC, expected_page=2, expected_value="137", require_usage=True
        )
    )


def _answered_with(citation_extra: dict, answer: str = "It is 137 newton meters [1]."):
    """_answered() with the single citation's fields overridden (quote/fileId…)."""
    frames = []
    for line in _answered(answer=answer).split("\n\n"):
        if not line.startswith("data: ") or line == "data: [DONE]":
            continue
        obj = json.loads(line[6:])
        if obj.get("kind") == "sources":
            obj["citations"][0] = {
                k: v for k, v in obj["citations"][0].items() if k not in ("quote", "fileId")
            }
            obj["citations"][0].update(citation_extra)
        frames.append(obj)
    return _sse(*frames)


def _requires_judge_param(name: str) -> None:
    import inspect

    assert name in inspect.signature(judge_answered).parameters, (
        f"missing behaviour: judge_answered has no {name!r} check"
    )


def test_judge_answered_requires_server_excerpt_to_carry_the_sentinel():
    _requires_judge_param("expected_excerpt_tokens")
    # The citation contract exposes `quote` — a SERVER-derived excerpt window of
    # the cited chunk (buildCitations → relevantQuoteWindow). It must contain
    # the sentinel; a citation whose excerpt is about something else is not
    # evidence for the answer, even when docId/page are right.
    good = parse_notebook_frames(
        _answered_with(
            {"quote": "Coupling bolt code QX7K3: the torque setting is 137 newton meters."}
        )
    )
    assert (
        judge_answered(
            good,
            doc_id=DOC,
            expected_page=2,
            expected_value="137",
            require_usage=True,
            expected_excerpt_tokens=("QX7K3", "137"),
        )
        == []
    )
    bad = parse_notebook_frames(
        _answered_with({"quote": "Inspect the belt guard every 250 hours."})
    )
    fails = judge_answered(
        bad,
        doc_id=DOC,
        expected_page=2,
        expected_value="137",
        require_usage=True,
        expected_excerpt_tokens=("QX7K3", "137"),
    )
    assert any("excerpt" in x for x in fails)
    missing = parse_notebook_frames(_answered_with({}))  # no quote field at all
    assert any(
        "excerpt" in x
        for x in judge_answered(
            missing,
            doc_id=DOC,
            expected_page=2,
            expected_value="137",
            require_usage=True,
            expected_excerpt_tokens=("QX7K3", "137"),
        )
    )


def test_judge_answered_requires_server_file_identity_when_known():
    _requires_judge_param("expected_file_id")
    # `fileId` on a citation is resolved SERVER-side (namespace_direct_uploads
    # by upload_id); the probe compares it with the server-issued id from the
    # upload response — two server identities, nothing client-trusted.
    ok = parse_notebook_frames(_answered_with({"fileId": "file-1", "quote": "QX7K3 137"}))
    assert (
        judge_answered(
            ok,
            doc_id=DOC,
            expected_page=2,
            expected_value="137",
            require_usage=True,
            expected_excerpt_tokens=("QX7K3", "137"),
            expected_file_id="file-1",
        )
        == []
    )
    other = parse_notebook_frames(_answered_with({"fileId": "file-9", "quote": "QX7K3 137"}))
    assert any(
        "file identity" in x
        for x in judge_answered(
            other,
            doc_id=DOC,
            expected_page=2,
            expected_value="137",
            require_usage=True,
            expected_excerpt_tokens=("QX7K3", "137"),
            expected_file_id="file-1",
        )
    )


# ── judge: refusal path must be provider-free ────────────────────────────────


def test_judge_refusal_passes_provider_free():
    assert judge_refusal(parse_notebook_frames(_refusal())) == []


def test_judge_refusal_rejects_provider_call_or_citations_or_answer():
    assert any(
        "provider" in x for x in judge_refusal(parse_notebook_frames(_refusal(with_usage=True)))
    )
    assert any(
        "citation" in x
        for x in judge_refusal(parse_notebook_frames(_refusal(citations=[{"docId": DOC}])))
    )
    assert any("status" in x for x in judge_refusal(parse_notebook_frames(_answered())))


# ── run-unique document ───────────────────────────────────────────────────────


def test_probe_document_is_a_pdf_with_sentinel_on_page_two():
    pdf = build_probe_document(run_id="abc123", sentinel_code="QX7K3", sentinel_value="137")
    assert pdf.startswith(b"%PDF-1.4")
    assert pdf.count(b"/Type /Page\n") == 2 or pdf.count(b"/Type /Page ") == 2
    assert b"QX7K3" in pdf and b"137" in pdf
    # Two different runs never produce identical bytes (dedup would return the OTHER run's doc).
    assert pdf != build_probe_document(run_id="def456", sentinel_code="QX7K3", sentinel_value="137")


# ── config / dry-run ──────────────────────────────────────────────────────────


def test_load_config_requires_hub_base_and_auth(monkeypatch):
    for k in (
        "BETA_PROBE_HUB_BASE",
        "BETA_PROBE_COOKIE",
        "BETA_PROBE_EMAIL",
        "BETA_PROBE_PASSWORD",
    ):
        monkeypatch.delenv(k, raising=False)
    with pytest.raises(ProbeUnavailable):
        load_probe_config()
    monkeypatch.setenv("BETA_PROBE_HUB_BASE", "http://localhost:3100")
    with pytest.raises(ProbeUnavailable):
        load_probe_config()  # no auth at all
    monkeypatch.setenv("BETA_PROBE_EMAIL", "qa@example.com")
    with pytest.raises(ProbeUnavailable):
        load_probe_config()  # email without password is not a credential
    monkeypatch.setenv("BETA_PROBE_PASSWORD", "pw")
    assert load_probe_config().hub_base == "http://localhost:3100"


def test_main_dry_run_is_inert_without_inputs(monkeypatch, capsys):
    for k in (
        "BETA_PROBE_HUB_BASE",
        "BETA_PROBE_COOKIE",
        "BETA_PROBE_EMAIL",
        "BETA_PROBE_PASSWORD",
    ):
        monkeypatch.delenv(k, raising=False)
    with mock.patch("httpx.Client") as client:
        rc = main([])
        assert rc == 0
        client.assert_not_called()
    out = capsys.readouterr().out
    assert "DRY-RUN" in out and "no request" in out.lower()


def test_main_refuses_to_print_secrets(monkeypatch, capsys):
    monkeypatch.setenv("BETA_PROBE_HUB_BASE", "http://localhost:3100")
    monkeypatch.setenv("BETA_PROBE_COOKIE", "next-auth.session-token=SECRETJWE")
    with mock.patch(
        "tests.beta._notebook_probe.run_notebook_probe", side_effect=RuntimeError("boom")
    ):
        rc = main([])
    assert rc != 0
    assert "SECRETJWE" not in capsys.readouterr().out


# ── end-to-end against a mocked Hub ──────────────────────────────────────────


class FakeHub:
    """Minimal stand-in for the notebook product contract."""

    def __init__(
        self,
        answered_body: str | None = None,
        refusal_body: str | None = None,
        delete_status: int = 200,
        links_get_status: int = 200,
        control_body: str | None = None,
        sentinel_http: int = 200,
    ):
        self.delete_status = delete_status
        self.links_get_status = links_get_status
        self.calls: list[tuple[str, str]] = []
        self.cookies_seen: list[str] = []
        self.readiness_polls = 0  # polls while the SENTINEL doc is attached
        self.answered_body = answered_body
        self.refusal_body = refusal_body if refusal_body is not None else _refusal()
        # The control source never contains the sentinel: asking for it through
        # real retrieval must refuse, provider-free.
        self.control_body = control_body if control_body is not None else _refusal()
        self.sentinel_http = sentinel_http
        self.uploaded = False  # the SENTINEL document
        self.control_uploaded = False
        self.attached = False
        self.attached_ids: list[str] = []
        self.chat_bodies: list[dict] = []
        self.deleted: list[str] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        p, m = request.url.path, request.method
        self.calls.append((m, p))
        # Sign-in doors (email/password auth) are the only cookie-less calls.
        if p == "/api/auth/csrf/":
            return httpx.Response(200, json={"csrfToken": "csrf-1"})
        if p == "/api/auth/callback/credentials/":
            return httpx.Response(
                200, headers={"set-cookie": "next-auth.session-token=MINTED; Path=/; HttpOnly"}
            )
        assert "cookie" in {k.lower() for k in request.headers}, (
            "every call must carry the session cookie"
        )
        self.cookies_seen.append(request.headers["cookie"])
        if p == "/api/health/":
            return httpx.Response(200, json={"status": "ok", "approvedRetrievalEnforced": True})
        if m == "POST" and p == "/api/equipment-notebooks/":
            return httpx.Response(201, json={"notebook": {"id": "nb-1", "nodeId": "node-1"}})
        if m == "POST" and p == "/api/equipment-notebooks/nb-1/chat/":
            body = json.loads(request.content)
            self.chat_bodies.append(body)
            if not body.get("sourceDocIds"):
                return httpx.Response(422, json={"error": "no_sources_selected"})
            ids = body["sourceDocIds"]
            assert set(ids) <= {CONTROL, DOC}, ids
            assert all(i in self.attached_ids for i in ids), "chat may only scope attached docs"
            sse = {"content-type": "text/event-stream"}
            if "QX7K3" in body["message"] and DOC in ids:
                if self.sentinel_http != 200:
                    return httpx.Response(self.sentinel_http, json={"error": "boom"})
                return httpx.Response(200, headers=sse, text=self.answered_body or _answered())
            if "QX7K3" in body["message"] and ids == [CONTROL]:
                return httpx.Response(200, headers=sse, text=self.control_body)
            return httpx.Response(200, headers=sse, text=self.refusal_body)
        if m == "POST" and p == "/api/namespace/node/node-1/files/":
            is_control = b"control-" in request.content
            if is_control:
                self.control_uploaded = True
                return httpx.Response(
                    201,
                    json={
                        "ok": True,
                        "indexed": True,
                        "uploadId": CONTROL,
                        "fileId": "file-c",
                        "chunkCount": 1,
                    },
                )
            self.uploaded = True
            return httpx.Response(
                201,
                json={
                    "ok": True,
                    "indexed": True,
                    "uploadId": DOC,
                    "fileId": "file-1",
                    "chunkCount": 2,
                },
            )
        if m == "POST" and p == "/api/equipment-notebooks/nb-1/sources/":
            doc = json.loads(request.content)["docId"]
            assert doc in (CONTROL, DOC)
            self.attached_ids.append(doc)
            self.attached = DOC in self.attached_ids
            return httpx.Response(201, json={"ok": True})
        if m == "GET" and p == "/api/equipment-notebooks/nb-1/":
            sources = []
            if CONTROL in self.attached_ids:
                sources.append(
                    {
                        "docId": CONTROL,
                        "matchState": "user_confirmed",
                        "enabledByDefault": True,
                        "readiness": {"state": "chat_ready_basic", "canChat": True},
                    }
                )
            if DOC in self.attached_ids:
                self.readiness_polls += 1
                state = "stored" if self.readiness_polls < 3 else "chat_ready_basic"
                sources.append(
                    {
                        "docId": DOC,
                        "matchState": "user_confirmed",
                        "enabledByDefault": True,
                        "readiness": {"state": state, "canChat": state != "stored"},
                    }
                )
            return httpx.Response(
                200, json={"notebook": {"id": "nb-1"}, "sources": sources, "turns": []}
            )
        if m == "GET" and p == f"/api/equipment-notebooks/nb-1/sources/{DOC}/passage/":
            return httpx.Response(
                200,
                json={
                    "page": 2,
                    "passages": [
                        {"page": 2, "text": "coupling bolt code QX7K3 is 137 newton meters"}
                    ],
                },
            )
        if m == "GET" and p == "/api/files/file-1/":
            if self.links_get_status != 200:
                return httpx.Response(self.links_get_status, json={"error": "Query failed"})
            return httpx.Response(
                200,
                json={
                    "file": {"id": "file-1"},
                    "links": [
                        {"id": "link-1", "targetType": "namespace_node", "targetId": "node-1"},
                        {"id": "link-2", "targetType": "equipment_notebook", "targetId": "nb-1"},
                    ],
                },
            )
        if m == "GET" and p == "/api/files/file-c/":
            return httpx.Response(
                200,
                json={
                    "file": {"id": "file-c"},
                    "links": [
                        {"id": "link-c1", "targetType": "namespace_node", "targetId": "node-1"}
                    ],
                },
            )
        if m == "DELETE":
            self.deleted.append(p)
            if self.delete_status >= 500:
                return httpx.Response(self.delete_status, json={"error": "delete_failed"})
            return httpx.Response(self.delete_status, json={"ok": True})
        return httpx.Response(404, json={"error": f"unexpected {m} {p}"})


def _cfg(**kw) -> ProbeConfig:
    base = {
        "hub_base": "http://hub.test",
        "cookie": "next-auth.session-token=x",
        "poll_seconds": 30,
    }
    base.update(kw)
    return ProbeConfig(**base)


def _run(hub: FakeHub, cfg: ProbeConfig | None = None):
    with (
        mock.patch("tests.beta._notebook_probe.time.sleep") as sleep,
        mock.patch("tests.beta._notebook_probe._sentinel", return_value=("QX7K3", "137")),
    ):
        client = httpx.Client(
            transport=httpx.MockTransport(hub.handler), base_url="http://hub.test"
        )
        report = run_notebook_probe(cfg or _cfg(), client=client)
    return report, sleep


# ── cleanup is proof, not observation ────────────────────────────────────────


def test_probe_fails_when_cleanup_returns_500_even_if_everything_else_passed():
    hub = FakeHub(delete_status=500)
    report, _ = _run(hub)
    assert not report.ok
    assert any("cleanup notebook HTTP 500" in f for f in report.failures)
    # every run-owned target was still attempted (2 links + notebook + upload + file + node)
    assert len(hub.deleted) == 9
    cleanup = next(s for s in report.steps if s["name"] == "cleanup")
    assert cleanup["notebook"] == 500 and cleanup["node"] == 500 and cleanup["link:link-1"] == 500


def test_cleanup_detaches_links_before_file_delete_and_deletes_node_last():
    hub = FakeHub()
    report, _ = _run(hub)
    assert report.ok, report.failures
    d = hub.deleted
    assert d == [
        "/api/files/file-1/links/link-1/",
        "/api/files/file-1/links/link-2/",
        "/api/files/file-c/links/link-c1/",
        "/api/equipment-notebooks/nb-1/",
        f"/api/uploads/{DOC}/",
        f"/api/uploads/{CONTROL}/",
        "/api/files/file-1/",
        "/api/files/file-c/",
        "/api/namespace/node/node-1/",
    ]
    calls = hub.calls
    # the link enumeration (GET) precedes the first detach, which precedes the file delete
    assert (
        calls.index(("GET", "/api/files/file-1/"))
        < calls.index(("DELETE", "/api/files/file-1/links/link-1/"))
        < calls.index(("DELETE", "/api/files/file-1/"))
        < calls.index(("DELETE", "/api/namespace/node/node-1/"))
    )
    cleanup = next(s for s in report.steps if s["name"] == "cleanup")
    assert cleanup["file_links"] == 2 and cleanup["file"] == 200 and cleanup["node"] == 200
    assert cleanup["control_file_links"] == 1 and cleanup["control_file"] == 200
    assert cleanup["control_upload"] == 200 and cleanup["ok"] is True


def test_cleanup_fails_when_links_cannot_be_enumerated_but_still_attempts_the_rest():
    hub = FakeHub(links_get_status=500)
    report, _ = _run(hub)
    assert not report.ok and any("file links GET HTTP 500" in f for f in report.failures)
    assert hub.deleted[-1] == "/api/namespace/node/node-1/"
    assert "/api/files/file-1/" in hub.deleted


def test_cleanup_fails_when_a_link_detach_is_refused():
    hub = FakeHub()
    orig = hub.handler

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "DELETE" and request.url.path.endswith("/links/link-1/"):
            return httpx.Response(409, json={"error": "has_links"})
        return orig(request)

    hub.handler = handler
    report, _ = _run(hub)
    assert not report.ok and any("cleanup link:link-1 HTTP 409" in f for f in report.failures)


def test_probe_accepts_404_on_cleanup_as_already_gone():
    hub = FakeHub(delete_status=404)
    report, _ = _run(hub)
    assert report.ok, report.failures


def test_probe_fails_when_cleanup_raises():
    hub = FakeHub()
    orig = hub.handler

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "DELETE" and "/uploads/" in request.url.path:
            raise httpx.ConnectError("boom")
        return orig(request)

    hub.handler = handler
    report, _ = _run(hub)
    assert not report.ok and any("cleanup upload raised ConnectError" in f for f in report.failures)
    # the remaining target is still attempted after the exception
    assert any(p.startswith("/api/files/") for p in hub.deleted)


def test_email_password_auth_cleanup_uses_the_minted_cookie():
    hub = FakeHub()
    report, _ = _run(hub, cfg=_cfg(cookie=None, email="qa@example.com", password="pw"))
    assert report.ok, report.failures
    order = [p for _, p in hub.calls]
    assert order[:2] == ["/api/auth/csrf/", "/api/auth/callback/credentials/"]
    # every authenticated call — INCLUDING the DELETEs in finally — carried the minted session
    assert hub.cookies_seen and all(c == "next-auth.session-token=MINTED" for c in hub.cookies_seen)
    assert len(hub.deleted) == 9
    assert "MINTED" not in json.dumps(report.to_dict())


def test_probe_happy_path_walks_the_product_contract_in_order():
    hub = FakeHub()
    report, sleep = _run(hub)
    assert report.ok, report.failures
    order = [p for _, p in hub.calls]
    # The control source is uploaded+confirmed FIRST; the sentinel is asked
    # through REAL retrieval over it (refuses); only then is the sentinel doc
    # uploaded. Readiness is polled on the contract, never a fixed sleep.
    uploads = [i for i, p in enumerate(order) if p == "/api/namespace/node/node-1/files/"]
    chats = [i for i, p in enumerate(order) if p == "/api/equipment-notebooks/nb-1/chat/"]
    assert len(uploads) == 2 and len(chats) == 4
    assert chats[0] < uploads[0] < chats[1] < uploads[1] < chats[2] < chats[3]
    assert hub.readiness_polls == 3 and sleep.call_count == 2, (
        "readiness must be polled, never a single fixed sleep"
    )
    assert hub.attached and hub.attached_ids == [CONTROL, DOC]
    assert "/api/equipment-notebooks/nb-1/" in hub.deleted  # run-owned cleanup
    names = [s["name"] for s in report.steps]
    assert names == [
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
        "sentinel_answer",
        "passage_identity",
        "unsupported_refusal",
        "cleanup",
    ]
    assert all(s["ok"] is True for s in report.steps)
    # the answered turn is scoped to BOTH docs so "no other document cited" is meaningful
    assert [b["sourceDocIds"] for b in hub.chat_bodies] == [
        [],
        [CONTROL],
        [CONTROL, DOC],
        [CONTROL, DOC],
    ]
    assert report.to_dict()["outcome"]["sentinel_turn"] == {
        "http": 200,
        "status": "answered",
        "citations": 1,
        "usage_present": True,
    }
    # evidence is machine-readable + redacted
    dumped = json.dumps(report.to_dict())
    assert "session-token" not in dumped and "QX7K3" in dumped


def test_probe_fails_when_other_document_is_cited_but_still_cleans_up():
    hub = FakeHub(answered_body=_answered(doc_id=OTHER_DOC))
    report, _ = _run(hub)
    assert not report.ok and any("other document" in f for f in report.failures)
    assert "/api/equipment-notebooks/nb-1/" in hub.deleted


def test_probe_fails_when_refusal_path_called_a_provider():
    hub = FakeHub(refusal_body=_refusal(with_usage=True))
    report, _ = _run(hub)
    assert not report.ok and any("provider" in f for f in report.failures)


def test_probe_fails_when_gate_flag_is_not_enforced():
    hub = FakeHub()
    orig = hub.handler

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/health/":
            return httpx.Response(200, json={"status": "ok", "approvedRetrievalEnforced": False})
        return orig(request)

    hub.handler = handler
    report, _ = _run(hub)
    assert not report.ok and any("MIRA_ENFORCE_APPROVED_RETRIEVAL" in f for f in report.failures)
    assert not hub.uploaded, "nothing is uploaded when the gate is not the production gate"


def test_probe_fails_when_pre_upload_question_is_answered():
    hub = FakeHub()
    orig = hub.handler

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/chat/") and not json.loads(request.content).get(
            "sourceDocIds"
        ):
            return httpx.Response(
                200, headers={"content-type": "text/event-stream"}, text=_answered()
            )
        return orig(request)

    hub.handler = handler
    report, _ = _run(hub)
    assert not report.ok and any("pre-upload" in f for f in report.failures)
    assert not hub.uploaded


def test_gate_module_skips_without_env(monkeypatch):
    for k in (
        "BETA_PROBE_HUB_BASE",
        "BETA_PROBE_COOKIE",
        "BETA_PROBE_EMAIL",
        "BETA_PROBE_PASSWORD",
    ):
        monkeypatch.delenv(k, raising=False)
    from . import beta_ready_notebook_confirmed_source as gate

    with pytest.raises(pytest.skip.Exception):
        gate.test_beta_ready_notebook_confirmed_source()


def test_control_refusal_must_be_provider_free_and_uncited():
    hub = FakeHub(control_body=_refusal(with_usage=True))
    report, _ = _run(hub)
    assert not report.ok and any("pre-upload" in f and "provider" in f for f in report.failures)
    assert not hub.uploaded, "the sentinel doc is never uploaded after a bad control refusal"
    assert hub.control_uploaded and f"/api/uploads/{CONTROL}/" in hub.deleted


def test_control_answer_before_sentinel_upload_fails_the_lane():
    hub = FakeHub(control_body=_answered())
    report, _ = _run(hub)
    assert not report.ok and any("pre-upload" in f for f in report.failures)
    assert not hub.uploaded


def test_control_refusal_must_be_http_200_sse_not_422():
    hub = FakeHub()
    orig = hub.handler

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/chat/") and json.loads(request.content).get(
            "sourceDocIds"
        ) == [CONTROL]:
            return httpx.Response(422, json={"error": "source_not_in_notebook"})
        return orig(request)

    hub.handler = handler
    report, _ = _run(hub)
    assert not report.ok and any("pre-upload" in f and "422" in f for f in report.failures)
    assert not hub.uploaded


# ── structured expected-regression outcome (§8.4, no grep) ───────────────────


def test_expected_regression_outcome_matches_only_the_deliberate_defect_signature():
    # Deliberate defect: everything else works, the sentinel turn refuses 200/insufficient_evidence.
    hub = FakeHub(answered_body=_refusal())
    report, _ = _run(hub)
    assert not report.ok
    assert expected_regression_outcome(report) == []
    o = report.to_dict()["outcome"]
    assert o["setup_ok"] and o["cleanup_ok"] and o["passage_identity_ok"]
    assert o["sentinel_turn"] == {
        "http": 200,
        "status": "insufficient_evidence",
        "citations": 0,
        "usage_present": False,
    }


def test_expected_regression_outcome_rejects_everything_else():
    # (a) the fix present → answered → NOT the defect
    r, _ = _run(FakeHub())
    assert any("answered" in f for f in expected_regression_outcome(r))
    # (b) a 500 on the sentinel turn is a broken build, not the defect
    r, _ = _run(FakeHub(sentinel_http=500))
    assert any("500" in f for f in expected_regression_outcome(r))
    # (c) cleanup failure stays red even when the sentinel turn shows the defect
    r, _ = _run(FakeHub(answered_body=_refusal(), delete_status=500))
    assert any("cleanup" in f for f in expected_regression_outcome(r))
    # (d) a refusal that called a provider is not the defect
    r, _ = _run(FakeHub(answered_body=_refusal(with_usage=True)))
    assert any("provider" in f for f in expected_regression_outcome(r))
    # (e) gate not enforced → setup failed
    hub = FakeHub(answered_body=_refusal())
    orig = hub.handler

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/health/":
            return httpx.Response(200, json={"status": "ok", "approvedRetrievalEnforced": False})
        return orig(request)

    hub.handler = handler
    r, _ = _run(hub)
    assert any("setup" in f for f in expected_regression_outcome(r))


def test_main_expect_regression_exit_codes(monkeypatch, tmp_path):
    monkeypatch.setenv("BETA_PROBE_HUB_BASE", "http://hub.test")
    monkeypatch.setenv("BETA_PROBE_COOKIE", "next-auth.session-token=x")
    defect, _ = _run(FakeHub(answered_body=_refusal()))
    fixed, _ = _run(FakeHub())
    out = tmp_path / "e.json"
    with mock.patch("tests.beta._notebook_probe.run_notebook_probe", return_value=defect):
        assert main(["--expect-regression", "--evidence-out", str(out)]) == 0
    assert (
        json.loads(out.read_text(encoding="utf-8"))["outcome"]["expected_regression"] == "matched"
    )
    with mock.patch("tests.beta._notebook_probe.run_notebook_probe", return_value=fixed):
        assert main(["--expect-regression"]) == 1
    with mock.patch("tests.beta._notebook_probe.run_notebook_probe", return_value=fixed):
        assert main([]) == 0
    with mock.patch("tests.beta._notebook_probe.run_notebook_probe", return_value=defect):
        assert main([]) == 1


# ── strict origin pin (production probe) ─────────────────────────────────────


def test_origin_pin_refuses_any_other_destination(monkeypatch):
    monkeypatch.setenv("BETA_PROBE_COOKIE", "next-auth.session-token=x")
    monkeypatch.setenv("BETA_PROBE_EXPECT_ORIGIN", "https://app.factorylm.com")
    for bad in (
        "https://app.factorylm.com.evil.example",
        "http://app.factorylm.com",
        "https://staging.factorylm.com",
        "https://app.factorylm.com/hub",
        "https://user:pw@app.factorylm.com",
        "https://app.factorylm.com:8443",
    ):
        monkeypatch.setenv("BETA_PROBE_HUB_BASE", bad)
        with pytest.raises(_probe_refused()):
            load_probe_config()
    monkeypatch.setenv("BETA_PROBE_HUB_BASE", "https://app.factorylm.com/")
    assert load_probe_config().hub_base == "https://app.factorylm.com"


def test_hub_base_must_be_a_bare_http_origin(monkeypatch):
    monkeypatch.delenv("BETA_PROBE_EXPECT_ORIGIN", raising=False)
    monkeypatch.setenv("BETA_PROBE_COOKIE", "next-auth.session-token=x")
    for bad in ("localhost:3100", "ftp://hub", "http://hub/path", "http://u:p@hub"):
        monkeypatch.setenv("BETA_PROBE_HUB_BASE", bad)
        with pytest.raises(_probe_refused()):
            load_probe_config()


def test_main_refused_origin_is_loud_not_dry_run(monkeypatch, capsys):
    monkeypatch.setenv("BETA_PROBE_HUB_BASE", "https://staging.factorylm.com")
    monkeypatch.setenv("BETA_PROBE_COOKIE", "next-auth.session-token=x")
    monkeypatch.setenv("BETA_PROBE_EXPECT_ORIGIN", "https://app.factorylm.com")
    with mock.patch("httpx.Client") as client:
        rc = main([])
        client.assert_not_called()
    assert rc == 2 and "REFUSED" in capsys.readouterr().out


# ── import/config never mutate the process environment ───────────────────────


def test_env_is_never_written_by_import_or_config(monkeypatch):
    import importlib.util
    import pathlib

    # A FRESH module object (not importlib.reload of the shared one — that
    # would replace the exception classes other test modules already bound).
    src = pathlib.Path(probe_mod.__file__)
    monkeypatch.setenv("BETA_PROBE_HUB_BASE", "http://hub.test/")
    monkeypatch.setenv("BETA_PROBE_COOKIE", "next-auth.session-token=x")
    snapshot = dict(os.environ)
    import sys

    spec = importlib.util.spec_from_file_location("_notebook_probe_fresh", src)
    fresh = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = fresh  # dataclasses resolve the module by name
    try:
        spec.loader.exec_module(fresh)  # import-time side effects would show here
    finally:
        sys.modules.pop(spec.name, None)
    assert dict(os.environ) == snapshot
    cfg = fresh.load_probe_config()
    assert cfg.hub_base == "http://hub.test"  # normalised in the config, not in the env
    assert dict(os.environ) == snapshot
    monkeypatch.delenv("BETA_PROBE_COOKIE")
    snapshot2 = dict(os.environ)
    with pytest.raises(fresh.ProbeUnavailable):
        fresh.load_probe_config()
    assert dict(os.environ) == snapshot2
