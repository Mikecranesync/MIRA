#!/usr/bin/env python3
"""Retrieval / evidence acceptance suite — six live scenarios against a deployed
MIRA Hub, asserted from the Turn Evidence Packet + the SSE wire, never from
mocks. The change → automated acceptance → traces → PASS/FAIL loop that
replaced "Mike tests on the phone and reports what broke" (2026-09-22).

Runs the exact request shapes the mobile app sends (POST /look with a photo,
POST /chat with `visualEvidence` / `history` / `sourceDocIds`), then reads each
turn's durable packet through the diagnostics endpoint and checks the contract:

  1. empty notebook + generic question         → retrieval skipped, general badge
  2. empty notebook + resolved identity        → OEM corpus searched; chunks reach the
                                                  provider; citations OR an honest refusal
  3. notebook with an attached manual          → notebook retrieval; ≥1 citation;
                                                  "notebook's sources" badge
  4. photo turn, then a text-only follow-up    → prior photo observation recalled
                                                  SERVER-side (prior_visual_observations_considered ≥ 1)
  5. no evidence + exact rating requested      → no unit-bearing number escapes as fact
  6. (every row) token usage present — or, for a deterministic answer-gate
     abstain, proof that NO model ran; no secrets or question/answer text in
     any packet

Usage:
  export ACCEPT_BASE=https://app-staging.factorylm.com
  export ACCEPT_COOKIE='next-auth.session-token=…'   # from provision-beta-gate.ts (BETA_GATE_COOKIE)
  python3 tools/qa/retrieval_acceptance.py --photo docs/proofs/2026-09-22-pixel9a-staging-session/turn2-photo-siemens-tp700-nameplate.jpg \
      --manual tools/demo-3tag-plc-vfd-conveyor.pdf --out /tmp/retrieval-acceptance.json

Exit 0 only when every scenario passes. The JSON artifact carries every trace
id, turn id, packet, and the wire frames (ids/flags only — content is
truncated to the first 200 chars for the report and never asserted on).
Requires the target's flight recorder (MIRA #3940+) and the routing/continuity
fixes (#3943–#3945). Standard library only.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib import request as urlreq
from urllib.error import HTTPError

UNIT_CLAIM = re.compile(r"\d[\d.,]*\s*(?:°\s?[cf]|v(?:dc|ac)?|a|hz|rpm|bar|psi|mm|in)\b", re.I)
DISCLAIMER = re.compile(
    r"\b(can't|cannot|unable to|don't have|do not have|not (?:able|possible)|won't guess)\b[^.]{0,80}"
    r"\b(exact|specific|this (?:unit|screen|panel|model|machine)|rating|data ?sheet|manual|documentation)",
    re.I,
)
HEDGE = re.compile(
    r"\b(typically|usually|generally|commonly|often|for example|about|around|approximately|roughly)\b",
    re.I,
)
SECRET_MARKERS = (
    "pk-lf-",
    "sk-lf-",
    "bearer ",
    "basic ",
    "cookie",
    "authorization",
    "postgres://",
    "gsk_",
    "csk-",
)


@dataclass
class Row:
    scenario: str
    trace_id: str | None = None
    turn_id: str | None = None
    expected: str = ""
    observed: str = ""
    checks: list[tuple[str, bool, str]] = field(default_factory=list)
    packet: dict[str, Any] | None = None
    wire: dict[str, Any] | None = None

    @property
    def passed(self) -> bool:
        return all(ok for _, ok, _ in self.checks)

    def check(self, name: str, ok: bool, detail: str = "") -> None:
        self.checks.append((name, bool(ok), detail))


class Hub:
    def __init__(self, base: str, cookie: str, timeout: int = 180):
        self.base = base.rstrip("/")
        self.cookie = cookie
        self.timeout = timeout

    def _req(
        self,
        method: str,
        path: str,
        body: bytes | None = None,
        headers: dict[str, str] | None = None,
    ) -> tuple[int, dict[str, str], bytes]:
        h = {"Cookie": self.cookie, **(headers or {})}
        req = urlreq.Request(self.base + path, data=body, method=method, headers=h)
        try:
            with urlreq.urlopen(req, timeout=self.timeout) as r:
                return r.status, {k.lower(): v for k, v in r.headers.items()}, r.read()
        except HTTPError as e:
            return e.code, {k.lower(): v for k, v in e.headers.items()}, e.read()

    def json(self, method: str, path: str, obj: Any = None) -> tuple[int, dict[str, str], Any]:
        body = json.dumps(obj).encode() if obj is not None else None
        st, hd, raw = self._req(
            method, path, body, {"Content-Type": "application/json"} if obj is not None else None
        )
        try:
            return st, hd, json.loads(raw or b"null")
        except json.JSONDecodeError:
            return st, hd, {"_raw": raw[:300].decode(errors="replace")}

    def multipart(
        self, path: str, fields: dict[str, str], file_field: str, file_path: Path, mime: str
    ) -> tuple[int, dict[str, str], Any]:
        boundary = "----mira" + uuid.uuid4().hex
        parts: list[bytes] = []
        for k, v in fields.items():
            parts.append(
                f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode()
            )
        parts.append(
            f'--{boundary}\r\nContent-Disposition: form-data; name="{file_field}"; filename="{file_path.name}"\r\nContent-Type: {mime}\r\n\r\n'.encode()
            + file_path.read_bytes()
            + b"\r\n"
        )
        parts.append(f"--{boundary}--\r\n".encode())
        st, hd, raw = self._req(
            "POST",
            path,
            b"".join(parts),
            {"Content-Type": f"multipart/form-data; boundary={boundary}"},
        )
        try:
            return st, hd, json.loads(raw or b"null")
        except json.JSONDecodeError:
            return st, hd, {"_raw": raw[:300].decode(errors="replace")}

    # --- domain helpers -----------------------------------------------------
    def create_notebook(self, name: str, **identity: str) -> dict[str, Any]:
        st, _, j = self.json("POST", "/api/equipment-notebooks/", {"displayName": name, **identity})
        if st != 201 or not isinstance(j, dict) or "notebook" not in j:
            raise RuntimeError(f"create notebook failed: {st} {j}")
        return j["notebook"]

    def chat(self, notebook_id: str, body: dict[str, Any]) -> tuple[str | None, dict[str, Any]]:
        """POST a chat turn; return (trace id from the response header, parsed wire summary)."""
        body = {"sourceDocIds": [], "clientRequestId": str(uuid.uuid4()), **body}
        st, hd, raw = self._req(
            "POST",
            f"/api/equipment-notebooks/{notebook_id}/chat/",
            json.dumps(body).encode(),
            {"Content-Type": "application/json"},
        )
        frames: list[dict[str, Any]] = []
        for block in raw.decode(errors="replace").split("\n\n"):
            block = block.strip()
            if block.startswith("data: {"):
                try:
                    frames.append(json.loads(block[6:]))
                except json.JSONDecodeError:
                    pass
        content = "".join(f.get("content", "") for f in frames if f.get("kind") == "content")
        sources = next((f for f in frames if f.get("kind") == "sources"), {})
        evidence = next((f for f in frames if f.get("kind") == "evidence"), {})
        status = next((f for f in frames if f.get("kind") == "status"), {})
        trace_frame = next((f for f in frames if f.get("kind") == "trace"), {})
        return hd.get("x-mira-trace-id"), {
            "http": st,
            "kinds": [f.get("kind") for f in frames],
            "trace_frame": trace_frame,
            "citations": len(sources.get("citations") or []),
            "basis": evidence.get("basis"),
            "label": evidence.get("label"),
            "status": status.get("status"),
            "content_head": content[:200],
            "content": content,  # asserted on for unit claims only, never persisted to the artifact
        }

    def look(self, notebook_id: str, photo: Path) -> tuple[str | None, dict[str, Any]]:
        st, hd, j = self.multipart(
            f"/api/equipment-notebooks/{notebook_id}/look/",
            {"clientKey": str(uuid.uuid4())},
            "image",
            photo,
            "image/jpeg",
        )
        if st != 200:
            raise RuntimeError(f"look failed: {st} {j}")
        return hd.get("x-mira-trace-id"), j

    def diagnostics(
        self, notebook_id: str, trace_id: str | None, attempts: int = 8
    ) -> dict[str, Any]:
        if not trace_id:
            raise RuntimeError(
                f"no x-mira-trace-id on the chat response for notebook {notebook_id} (flight recorder disabled?)"
            )
        for _ in range(attempts):
            st, _, j = self.json(
                "GET", f"/api/equipment-notebooks/{notebook_id}/turns/diagnostics/?limit=5"
            )
            rows = (j or {}).get("turns") or [] if isinstance(j, dict) else []
            hit = next((t for t in rows if t.get("traceId") == trace_id), None)
            if hit:
                st2, _, d = self.json(
                    "GET",
                    f"/api/equipment-notebooks/{notebook_id}/turns/{hit['turnId']}/diagnostics/",
                )
                if st2 == 200 and isinstance(d, dict) and d.get("packet"):
                    return d
            time.sleep(2)
        raise RuntimeError(f"no diagnostics row for trace {trace_id} on notebook {notebook_id}")

    def attach_manual(self, notebook: dict[str, Any], pdf: Path) -> str:
        st, _, up = self.multipart(
            f"/api/namespace/node/{notebook['nodeId']}/files/", {}, "file", pdf, "application/pdf"
        )
        # 201 = new upload; 200 + duplicate=true = the same bytes are already
        # parked for this tenant (SHA-256 dedup) — equally usable as a source.
        if st not in (200, 201) or not up.get("indexed") or not up.get("uploadId"):
            raise RuntimeError(f"upload failed: {st} {up}")
        doc_id = str(up["uploadId"])
        st2, _, j = self.json(
            "POST",
            f"/api/equipment-notebooks/{notebook['id']}/sources/",
            {"docId": doc_id, "sourceRole": "manual"},
        )
        if st2 not in (200, 201):
            raise RuntimeError(f"attach failed: {st2} {j}")
        return doc_id


# --- invariants ---------------------------------------------------------------


def common_checks(row: Row, d: dict[str, Any], w: dict[str, Any]) -> None:
    p = d["packet"]
    row.check(
        "trace id on header == packet == diagnostics",
        bool(row.trace_id)
        and d.get("traceId") == row.trace_id
        and w["trace_frame"].get("traceId") == row.trace_id,
        f"hdr={row.trace_id} pkt={d.get('traceId')} frame={w['trace_frame'].get('traceId')}",
    )
    row.check(
        "first SSE frame is the trace frame", w["kinds"][:1] == ["trace"], str(w["kinds"][:3])
    )
    row.check(
        "environment attribution", p.get("environment") == "staging", str(p.get("environment"))
    )
    g = p["generation"]
    gate_reason = (p.get("answer_gate") or {}).get("reason")
    if gate_reason and not g.get("attempts") and w["status"] == "insufficient_evidence":
        # A deterministic answer-gate abstain (e.g. #4004 identity_bound_no_manual)
        # calls no model, so provider and tokens are truthfully empty. Assert
        # exactly that rather than demanding a model call that must not happen.
        row.check(
            "deterministic abstain ran no inference",
            not g.get("served_provider")
            and not g.get("served_model")
            and g.get("input_tokens") is None
            and g.get("output_tokens") is None,
            f"gate={gate_reason} {g.get('served_provider')}/{g.get('input_tokens')}",
        )
    else:
        row.check(
            "provider/model recorded",
            bool(g.get("served_provider")) and bool(g.get("served_model")),
            f"{g.get('served_provider')}/{g.get('served_model')}",
        )
        row.check(
            "token usage recorded",
            isinstance(g.get("input_tokens"), int) and isinstance(g.get("output_tokens"), int),
            f"{g.get('input_tokens')}/{g.get('output_tokens')}",
        )
    serialized = json.dumps(d).lower()
    row.check("no secrets in packet", not any(m in serialized for m in SECRET_MARKERS), "")
    head = (w["content"][:60] or "").lower()
    row.check("no answer text in packet", not (len(head) > 20 and head in serialized), "")
    # evidence that reached the provider is consistent with retrieval
    r, c = p["retrieval"], p["context"]
    if r["executed"] and r["candidate_count"] > 0:
        row.check(
            "retrieved chunks reached the provider (context ids, grounded prompt)",
            c["chunk_count"] == r["candidate_count"]
            and len(c["evidence_doc_ids"]) > 0
            and c.get("system_prompt_kind") in ("grounded", "machine"),
            f"chunks={c['chunk_count']} ids={len(c['evidence_doc_ids'])} prompt={c.get('system_prompt_kind')}",
        )
    # badge truthfulness
    b = w["basis"]
    if b == "oem_documentation":
        row.check(
            "documentation badge is backed by ≥1 shipped citation",
            w["citations"] > 0,
            f"citations={w['citations']}",
        )
    if b == "general_reasoning":
        row.check(
            "general badge ⇒ no documents in context",
            c["chunk_count"] == 0 or w["citations"] == 0,
            f"chunks={c['chunk_count']} cit={w['citations']}",
        )


def run(args: argparse.Namespace) -> int:
    hub = Hub(args.base, args.cookie)
    photo, manual = Path(args.photo), Path(args.manual)
    rows: list[Row] = []
    stamp = time.strftime("%Y%m%d-%H%M%S")

    # 1 ---------------------------------------------------------------------
    row = Row(
        "1 empty notebook + generic question",
        expected="retrieval skipped_general_mode; general badge; answered",
    )
    nb = hub.create_notebook(f"ACC1 {stamp}")
    row.trace_id, w = hub.chat(
        nb["id"], {"message": "how does a VFD work in general", "mode": "general"}
    )
    d = hub.diagnostics(nb["id"], row.trace_id)
    row.turn_id = d["turnId"]
    p = d["packet"]
    row.check(
        "strategy skipped_general_mode",
        p["retrieval"]["strategy"] == "skipped_general_mode" and not p["retrieval"]["executed"],
        p["retrieval"]["strategy"],
    )
    row.check("OEM corpus not searched", not p["retrieval"]["oem_corpus_searched"])
    row.check("general badge", w["basis"] == "general_reasoning", str(w["basis"]))
    row.check("answered", w["status"] == "answered", str(w["status"]))
    common_checks(row, d, w)
    row.observed = f"{p['retrieval']['strategy']} / {w['basis']} / {w['status']}"
    row.packet, row.wire = p, {k: v for k, v in w.items() if k != "content"}
    rows.append(row)

    # 2 ---------------------------------------------------------------------
    row = Row(
        "2 empty notebook + resolved Siemens identity",
        expected="oem_corpus_bm25 executed; chunks reach provider; citations>0 with OEM badge OR honest insufficient_evidence",
    )
    nb = hub.create_notebook(
        f"ACC2 {stamp}",
        manufacturer="Siemens",
        model="TP700 Comfort",
        identityStatus="user_confirmed",
    )
    row.trace_id, w = hub.chat(
        nb["id"],
        {
            "message": "what supply voltage does the TP700 Comfort panel need and what is its operating temperature range",
            "mode": "general",
        },
    )
    d = hub.diagnostics(nb["id"], row.trace_id)
    row.turn_id = d["turnId"]
    p = d["packet"]
    r = p["retrieval"]
    row.check(
        "strategy oem_corpus_bm25 executed",
        r["strategy"] == "oem_corpus_bm25" and r["executed"] and r["oem_corpus_searched"],
        r["strategy"],
    )
    row.check(
        "manufacturer source = notebook",
        r.get("oem_manufacturer_source") == "notebook",
        str(r.get("oem_manufacturer_source")),
    )
    # Traceability applies to candidates that WERE returned. Zero candidates is
    # the correct outcome when the corpus has no manual for the bound model
    # (#3970 scopes to the model; the old ">0" only passed on the wrong-family
    # V20 chunks #3966 was filed about) — and is acceptable ONLY together with
    # an honest insufficient_evidence, never an answer (#4004).
    row.check(
        "candidates traceable (source_url#page ids), or none + honest abstain",
        (r["candidate_count"] > 0 and len(r["returned_doc_ids"]) > 0)
        or (r["candidate_count"] == 0 and w["status"] == "insufficient_evidence"),
        f"{r['candidate_count']} / {len(r['returned_doc_ids'])} status={w['status']}",
    )
    honest = (
        w["status"] == "answered" and w["citations"] > 0 and w["basis"] == "oem_documentation"
    ) or (w["status"] == "insufficient_evidence" and w["citations"] == 0)
    row.check(
        "cited answer OR honest refusal (never uncited documentation claim)",
        honest,
        f"status={w['status']} cit={w['citations']} basis={w['basis']}",
    )
    common_checks(row, d, w)
    row.observed = f"{r['strategy']} n={r['candidate_count']} / {w['basis']} cit={w['citations']} / {w['status']}"
    if r["candidate_count"] == 0:
        # Non-gating by design (#4010 review): an honest abstain passes, but the
        # corpus still holds no manual for the bound model — keep that visible
        # so an all-green loop is never read as "the technician got an answer".
        row.observed += " | COVERAGE GAP: no manual in corpus for the bound model"
    row.packet, row.wire = p, {k: v for k, v in w.items() if k != "content"}
    rows.append(row)

    # 3 ---------------------------------------------------------------------
    row = Row(
        "3 notebook with attached manual",
        expected="notebook_sources_bm25; source_doc_count>0; ≥1 citation; notebook badge",
    )
    nb = hub.create_notebook(f"ACC3 {stamp}")
    doc_id = hub.attach_manual(nb, manual)
    time.sleep(4)
    row.trace_id, w = hub.chat(
        nb["id"],
        {
            "message": "what tags does the PLC expose for the VFD conveyor and what does each one mean",
            "sourceDocIds": [doc_id],
        },
    )
    d = hub.diagnostics(nb["id"], row.trace_id)
    row.turn_id = d["turnId"]
    p = d["packet"]
    r = p["retrieval"]
    row.check(
        "strategy notebook_sources_bm25 executed",
        r["strategy"] == "notebook_sources_bm25" and r["executed"],
        r["strategy"],
    )
    row.check(
        "source_doc_count > 0",
        p["request"]["source_doc_count"] > 0,
        str(p["request"]["source_doc_count"]),
    )
    row.check(
        "attached doc among returned ids",
        doc_id in r["returned_doc_ids"],
        str(r["returned_doc_ids"][:2]),
    )
    row.check(
        "≥1 citation shipped with notebook badge",
        w["citations"] >= 1
        and w["basis"] == "oem_documentation"
        and "notebook" in (w["label"] or ""),
        f"cit={w['citations']} label={w['label']!r}",
    )
    common_checks(row, d, w)
    row.observed = f"{r['strategy']} n={r['candidate_count']} / cit={w['citations']} / {w['label']}"
    row.packet, row.wire = p, {k: v for k, v in w.items() if k != "content"}
    rows.append(row)

    # 4 ---------------------------------------------------------------------
    row = Row(
        "4 photo turn → text-only follow-up",
        expected="follow-up recalls the earlier photo server-side: prior_visual_observations_considered ≥ 1, visual evidence in context, answer not general",
    )
    nb = hub.create_notebook(f"ACC4 {stamp}")
    thread = "thrd_" + uuid.uuid4().hex
    _, look = hub.look(nb["id"], photo)
    t_photo, w_photo = hub.chat(
        nb["id"],
        {
            "message": "What is this",
            "mode": "general",
            "threadId": thread,
            "visualEvidence": {
                "fileId": look["fileId"],
                "capturedAt": look["observation"]["capturedAt"],
            },
        },
    )
    d_photo = hub.diagnostics(nb["id"], t_photo)
    row.check(
        "photo turn: observation in context",
        d_photo["packet"]["visual_evidence"]["observation_in_context"]
        and d_photo["packet"]["context"]["visual_evidence_count"] >= 1,
        str(d_photo["packet"]["context"]["visual_evidence_count"]),
    )
    row.check(
        "photo turn: badge is the photo (workspace_evidence) or documentation with citations",
        w_photo["basis"] == "workspace_evidence"
        or (w_photo["basis"] == "oem_documentation" and w_photo["citations"] > 0),
        f"{w_photo['basis']} cit={w_photo['citations']}",
    )
    row.trace_id, w = hub.chat(
        nb["id"],
        {
            "message": "what voltage was it?",
            "mode": "general",
            "threadId": thread,
            "history": [
                {"role": "user", "content": "What is this"},
                {"role": "assistant", "content": w_photo["content"][:400]},
            ],
        },
    )
    d = hub.diagnostics(nb["id"], row.trace_id)
    row.turn_id = d["turnId"]
    p = d["packet"]
    v, c, r = p["visual_evidence"], p["context"], p["retrieval"]
    row.check(
        "prior_visual_observations_considered ≥ 1",
        r["prior_visual_observations_considered"] >= 1 and v["prior_turn_observation_count"] >= 1,
        str(r["prior_visual_observations_considered"]),
    )
    row.check(
        "prior file id recalled == the photo's file id",
        look["fileId"] in (v.get("prior_file_ids") or []),
        str(v.get("prior_file_ids")),
    )
    row.check(
        "visual evidence in context on the follow-up",
        c["visual_evidence_count"] >= 1 and v["observation_in_context"],
        str(c["visual_evidence_count"]),
    )
    row.check(
        "follow-up badge is not bare general", w["basis"] != "general_reasoning", str(w["basis"])
    )
    row.check(
        "VISUAL_EVIDENCE_DROPPED did not fire",
        "VISUAL_EVIDENCE_DROPPED" not in [a["code"] for a in d["anomalies"]],
        str([a["code"] for a in d["anomalies"]]),
    )
    common_checks(row, d, w)
    row.observed = f"prior={r['prior_visual_observations_considered']} files={v.get('prior_file_ids')} / {w['basis']} / {w['status']}"
    row.packet, row.wire = p, {k: v2 for k, v2 in w.items() if k != "content"}
    row.wire["photo_turn_trace"] = t_photo
    rows.append(row)

    # 5 ---------------------------------------------------------------------
    row = Row(
        "5 no evidence + exact rating requested",
        expected="no unit-bearing value asserted as this machine's fact; gate blocks or model declines",
    )
    nb = hub.create_notebook(f"ACC5 {stamp}")
    row.trace_id, w = hub.chat(
        nb["id"],
        {
            "message": "What is the operating temperature range of this screen outdoors in direct sunlight? Give me the exact rating.",
            "mode": "general",
        },
    )
    d = hub.diagnostics(nb["id"], row.trace_id)
    row.turn_id = d["turnId"]
    p = d["packet"]
    a = p["answer_gate"]
    row.check("evidence_sufficient=false", a["evidence_sufficient"] is False)
    # Contract: no exact value may be asserted as THIS machine's fact. Accepted
    # outcomes: the gate blocked it; the model refused; the answer gives no
    # number; or — tolerated — a HEDGED industry range ("typically … about
    # –20 °C to +50 °C") stated alongside an explicit "I can't give/verify the
    # rating for this unit". An unhedged number, or one without that
    # disclaimer, fails. Apostrophes are normalised (the model emits U+2019).
    text = w["content"].replace("\u2019", "'").replace("\u2018", "'")
    has_number = bool(UNIT_CLAIM.search(text))
    disclaimer = DISCLAIMER.search(text)
    hedged = HEDGE.search(text)
    declined = (
        a["decision"] == "blocked"
        or w["status"] == "insufficient_evidence"
        or not has_number
        or bool(disclaimer and hedged)
    )
    row.check(
        "no exact value asserted as this machine's fact",
        declined,
        f"decision={a['decision']} status={w['status']} number={has_number} hedged={bool(hedged)} disclaimer={bool(disclaimer)}",
    )
    row.check(
        "gate did not serve an unhedged exact rating",
        not (has_number and not hedged and not disclaimer),
        f"number={has_number} hedged={bool(hedged)} disclaimer={bool(disclaimer)}",
    )
    common_checks(row, d, w)
    row.observed = f"decision={a['decision']} status={w['status']} / {w['basis']}"
    row.packet, row.wire = p, {k: v for k, v in w.items() if k != "content"}
    rows.append(row)

    # report -----------------------------------------------------------------
    out = {"base": args.base, "ran_at": stamp, "rows": []}
    all_ok = True
    print(f"\nRetrieval acceptance — {args.base} — {stamp}\n")
    for r_ in rows:
        ok = r_.passed
        all_ok &= ok
        print(
            f"{'PASS' if ok else 'FAIL'}  {r_.scenario}\n      trace={r_.trace_id} turn={r_.turn_id}\n      expected: {r_.expected}\n      observed: {r_.observed}"
        )
        for name, cok, detail in r_.checks:
            if not cok or args.verbose:
                print(f"        [{'ok' if cok else 'FAIL'}] {name}  {detail}")
        out["rows"].append(
            {
                "scenario": r_.scenario,
                "pass": ok,
                "trace_id": r_.trace_id,
                "turn_id": r_.turn_id,
                "expected": r_.expected,
                "observed": r_.observed,
                "checks": [{"name": n, "ok": o, "detail": dt} for n, o, dt in r_.checks],
                "packet": r_.packet,
                "wire": r_.wire,
            }
        )
    Path(args.out).write_text(json.dumps(out, indent=1))
    print(f"\n{'ALL PASS' if all_ok else 'FAILURES'} — artifact: {args.out}")
    return 0 if all_ok else 1


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument(
        "--base", default=os.environ.get("ACCEPT_BASE", "https://app-staging.factorylm.com")
    )
    ap.add_argument(
        "--cookie", default=os.environ.get("ACCEPT_COOKIE") or os.environ.get("BETA_GATE_COOKIE")
    )
    ap.add_argument("--photo", required=True, help="nameplate photo (jpeg) for scenario 4")
    ap.add_argument("--manual", required=True, help="small text PDF for scenario 3")
    ap.add_argument("--out", default="/tmp/retrieval-acceptance.json")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()
    if not args.cookie:
        print(
            "ACCEPT_COOKIE / BETA_GATE_COOKIE is required (session cookie for the target)",
            file=sys.stderr,
        )
        return 2
    if "app.factorylm.com" in args.base.replace("app-staging", ""):
        print("refusing to run acceptance traffic against production", file=sys.stderr)
        return 2
    return run(args)


if __name__ == "__main__":
    sys.exit(main())
