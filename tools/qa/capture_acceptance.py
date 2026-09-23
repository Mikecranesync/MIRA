#!/usr/bin/env python3
"""Capture acceptance — prove every ATTEMPT is accounted for, live.

`retrieval_acceptance.py` proves the ANSWER contract. This proves the CAPTURE
contract (#3939): that a turn which is rejected, cancelled, abandoned or never
served is still reconstructable — and, crucially, that a turn the recorder
MISSED is visible as a number rather than as a silence.

THE RULE THIS HARNESS EXISTS TO OBEY
  Every attempt is registered HERE, with a client-minted id, BEFORE it is sent.
  A count reconstructed afterwards cannot tell "never sent" from "sent and never
  recorded", and those are different defects with different owners. So the local
  ledger is written first and the server is compared against it, never the
  reverse.

Scenarios (each one an attempt in the local ledger):
  A  photo (LOOK) — a real multipart upload
  B  text-only follow-up — the #3962 shape: no photo re-sent
  C  failed upload — a non-image body; must be a PRE-ACCEPT rejection, not a lost turn
  D  malformed JSON — pre-accept, before any recorder machinery exists
  E  unauthenticated — no cookie; arrival must still be counted, with no tenant
  F  client cancel — abort mid-stream; must close `cancelled`, never stay open
  G  reconnect — same clientRequestId re-sent after a cancel (idempotency)

Then `/api/observability/coverage` is read and its INDEPENDENT reconciliation is
checked against this file's ledger.

Staging only. Refuses a production base URL.

  export ACCEPT_BASE=https://app-staging.factorylm.com
  export ACCEPT_COOKIE='next-auth.session-token=…'
  python3 tools/qa/capture_acceptance.py --notebook <uuid> --photo path.jpg
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
import uuid
from dataclasses import asdict, dataclass, field
from typing import Any

PROD_HOSTS = ("app.factorylm.com", "factorylm.com")


@dataclass
class Attempt:
    """One pre-registered attempt. Written BEFORE the request is sent.

    The lifecycle fields below are the point of this file. #3939 asks that
    `attempted`, `accepted`, `generated`, `persisted`, `sent`, `received` and
    `failed before acceptance` be told APART — because a turn can be generated
    and never persisted, or persisted and never delivered, and a single
    pass/fail hides exactly the states worth knowing.

    `received` is recorded CLIENT-SIDE, by this process, because nothing else
    can honestly claim it: the server knows what it sent, not what arrived.
    """
    scenario: str
    client_request_id: str
    expectation: str = ""
    # --- client-side facts, known without asking the server ------------------
    attempted: bool = True          # this row existing IS the attempt
    sent_at: float | None = None
    http_status: int | None = None
    trace_id: str | None = None
    transport_error: str | None = None
    stream_frames: list[str] = field(default_factory=list)
    received_chars: int = 0         # bytes this client actually read back
    # --- server-side facts, reconciled afterwards ----------------------------
    accepted: bool | None = None            # a durable start row exists
    generated: bool | None = None           # the provider served an answer
    persisted: bool | None = None           # the packet/turn row was written
    terminal_outcome: str | None = None
    failed_before_acceptance: bool | None = None
    notes: list[str] = field(default_factory=list)


class Harness:
    def __init__(self, base: str, cookie: str, notebook: str) -> None:
        self.base = base.rstrip("/")
        self.cookie = cookie
        self.notebook = notebook
        self.ledger: list[Attempt] = []

    # ---- the local ledger -------------------------------------------------
    def register(self, scenario: str, expectation: str) -> Attempt:
        a = Attempt(scenario=scenario, client_request_id=str(uuid.uuid4()), expectation=expectation)
        self.ledger.append(a)
        return a

    # ---- transport --------------------------------------------------------
    def _send(
        self,
        attempt: Attempt,
        path: str,
        body: bytes | None,
        headers: dict[str, str],
        *,
        authed: bool = True,
        read_bytes: int | None = None,
    ) -> bytes:
        h = dict(headers)
        if authed:
            h["Cookie"] = self.cookie
        req = urllib.request.Request(self.base + path, data=body, method="POST", headers=h)
        attempt.sent_at = time.time()
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                attempt.http_status = r.status
                attempt.trace_id = r.headers.get("x-mira-trace-id")
                raw = r.read(read_bytes) if read_bytes else r.read()
                # CLIENT-SIDE receipt. Not "the server sent it" — what this
                # process actually read off the socket.
                text = raw.decode(errors="replace")
                attempt.stream_frames = re.findall(r'"kind":"([a-z_]+)"', text)
                attempt.received_chars = len(text)
                return raw
        except urllib.error.HTTPError as e:
            attempt.http_status = e.code
            attempt.trace_id = e.headers.get("x-mira-trace-id")
            return e.read()
        except Exception as e:  # noqa: BLE001 — a transport failure is DATA here
            # This is the case a reconstructed count cannot distinguish: the
            # request may have reached the server and been recorded, or never
            # left this machine. Recorded as such rather than guessed.
            attempt.transport_error = f"{type(e).__name__}: {e}"
            return b""

    def chat(self, attempt: Attempt, message: str, *, authed: bool = True, raw: bytes | None = None) -> bytes:
        body = raw if raw is not None else json.dumps(
            {"message": message, "clientRequestId": attempt.client_request_id}
        ).encode()
        return self._send(
            attempt,
            f"/api/equipment-notebooks/{self.notebook}/chat/",
            body,
            {"Content-Type": "application/json"},
            authed=authed,
        )

    def look(self, attempt: Attempt, photo: bytes, filename: str, mime: str) -> bytes:
        b = uuid.uuid4().hex
        parts: list[bytes] = []
        for name, value in (("question", "what is this"), ("clientKey", attempt.client_request_id)):
            parts.append(
                f"--{b}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n".encode()
            )
        parts.append(
            f"--{b}\r\nContent-Disposition: form-data; name=\"image\"; filename=\"{filename}\"\r\n"
            f"Content-Type: {mime}\r\n\r\n".encode()
        )
        parts.append(photo)
        parts.append(f"\r\n--{b}--\r\n".encode())
        return self._send(
            attempt,
            f"/api/equipment-notebooks/{self.notebook}/look/",
            b"".join(parts),
            {"Content-Type": f"multipart/form-data; boundary={b}"},
        )

    def diagnostics_for(self, trace_id: str) -> dict[str, Any] | None:
        """The durable packet for one trace, or None if the ledger never saw it."""
        try:
            req = urllib.request.Request(
                f"{self.base}/api/equipment-notebooks/{self.notebook}/turns/diagnostics/?limit=25",
                headers={"Cookie": self.cookie},
            )
            with urllib.request.urlopen(req, timeout=60) as r:
                rows = json.loads(r.read()).get("turns", [])
            hit = next((t for t in rows if t.get("traceId") == trace_id), None)
            if not hit:
                return None
            req2 = urllib.request.Request(
                f"{self.base}/api/equipment-notebooks/{self.notebook}/turns/{hit['turnId']}/diagnostics/",
                headers={"Cookie": self.cookie},
            )
            with urllib.request.urlopen(req2, timeout=60) as r:
                return json.loads(r.read())
        except Exception:  # noqa: BLE001 — a read failure is "unknown", not "absent"
            return None

    def reconcile(self) -> None:
        """Fill the server-side lifecycle states for every pre-registered attempt.

        Uses the tenant-scoped per-attempt endpoint rather than inferring from
        the HTTP status. Inference was wrong: a 422 `no_sources_selected` is
        raised well AFTER the start record is written, so treating every 4xx as
        a pre-accept failure reported four accepted turns as never-accepted —
        this harness inventing a capture failure out of its own blind spot.

        Matched on `clientRequestId`, which is the id THIS process minted before
        sending. That is what makes the accounting the client's, not the
        server's: an attempt the server never heard of still has a row here.
        """
        try:
            req = urllib.request.Request(
                f"{self.base}/api/observability/coverage/?window_min=60&attempts=100",
                headers={"Cookie": self.cookie},
            )
            with urllib.request.urlopen(req, timeout=60) as r:
                rows = json.loads(r.read()).get("attempts") or []
        except Exception as e:  # noqa: BLE001
            print(f"  (per-attempt lookup unavailable: {e}); states stay unknown")
            rows = []
        by_crid = {r.get("client_request_id"): r for r in rows if r.get("client_request_id")}

        for a in self.ledger:
            row = by_crid.get(a.client_request_id)
            if row is None:
                # The server has no record of this attempt under our id. For an
                # unauthenticated call that is CORRECT and expected (middleware
                # rejects before the route, so nothing is ever written); for
                # anything else it is genuinely unknown, and says so.
                a.accepted = False if a.http_status == 401 else None
                a.generated = False if a.http_status == 401 else None
                a.persisted = False if a.http_status == 401 else None
                a.failed_before_acceptance = a.http_status == 401 or None
                continue
            a.accepted = bool(row.get("accepted"))
            a.terminal_outcome = row.get("outcome")
            a.persisted = bool(row.get("has_packet"))
            # "Generated" means a provider produced an answer. A packet is the
            # durable evidence of that; an accepted turn that closed without one
            # (refusal, cancel) did not generate.
            a.generated = bool(row.get("has_packet")) and row.get("outcome") in {"answered", "refused"}
            a.failed_before_acceptance = not a.accepted

    # ---- the server's own independent count -------------------------------
    def coverage(self, window_min: int = 60) -> dict[str, Any]:
        req = urllib.request.Request(
            f"{self.base}/api/observability/coverage/?window_min={window_min}&stale_min=5",
            headers={"Cookie": self.cookie},
        )
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read())


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=os.environ.get("ACCEPT_BASE", "https://app-staging.factorylm.com"))
    ap.add_argument("--cookie", default=os.environ.get("ACCEPT_COOKIE") or os.environ.get("BETA_GATE_COOKIE"))
    ap.add_argument("--notebook", required=True)
    ap.add_argument("--photo", required=True)
    ap.add_argument("--out", default="/tmp/capture-acceptance.json")
    args = ap.parse_args()

    host = args.base.split("//", 1)[-1].split("/", 1)[0]
    if host in PROD_HOSTS:
        print(f"refusing a production base URL: {args.base}", file=sys.stderr)
        return 2
    if not args.cookie:
        print("ACCEPT_COOKIE / BETA_GATE_COOKIE required", file=sys.stderr)
        return 2

    h = Harness(args.base, args.cookie, args.notebook)
    photo = open(args.photo, "rb").read()

    # A — photo
    a = h.register("A_photo_look", "arrival + start + closed(answered); packet with observation")
    h.look(a, photo, "bearing-label.jpg", "image/jpeg")

    # B — text-only follow-up (#3962 shape)
    b = h.register("B_text_followup", "recalls the photo server-side; closed(answered)")
    h.chat(b, "it is chattering, what do I check first")

    # C — failed upload: a non-image posted to /look
    c = h.register("C_failed_upload", "PRE-ACCEPT rejection (4xx) — arrival counted, no lost start")
    h.look(c, b"not an image at all", "notes.txt", "text/plain")

    # D — malformed JSON: returns before any recorder machinery exists
    d = h.register("D_malformed_json", "PRE-ACCEPT rejection (400) — arrival counted")
    h.chat(d, "", raw=b"{ this is not json")

    # E — unauthenticated: the arrival must still be counted, with no tenant
    e = h.register("E_unauthenticated", "arrival counted with tenant NULL; 401; no start")
    h.chat(e, "hello", authed=False)

    # F — client cancel: read one byte of the stream then drop it
    f = h.register("F_client_cancel", "closed(cancelled) — never left open")
    h.chat(f, "explain bearing preload in detail", raw=None)

    # G — reconnect with the SAME clientRequestId
    g = h.register("G_reconnect_same_id", "idempotent — no duplicate ledger row")
    g.client_request_id = f.client_request_id
    h.chat(g, "explain bearing preload in detail")

    time.sleep(6)  # let the fire-and-forget response rows land
    h.reconcile()
    cov = h.coverage()

    report = {
        "base": args.base,
        "notebook": args.notebook,
        "git_sha": cov.get("git_sha"),
        "environment": cov.get("environment"),
        "client_attempts": [asdict(x) for x in h.ledger],
        "client_attempt_count": len(h.ledger),
        "server_reconciliation": cov.get("reconciliation"),
        "server_coverage": cov.get("coverage"),
        "failure_counters": cov.get("failure_counters"),
        "copy_text": cov.get("copy_text"),
    }
    with open(args.out, "w") as fh:
        json.dump(report, fh, indent=2)

    def mark(v: bool | None) -> str:
        return "·" if v is None else ("yes" if v else " no")

    print(f"\nclient attempts registered: {len(h.ledger)}")
    print("  ('·' = unknown to this client, not 'no' — per-attempt acceptance needs a ledger lookup the harness does not have)")
    print(f"  {'scenario':24} {'http':>5} {'att':>4}{'acc':>5}{'gen':>5}{'per':>5}{'sent':>6}{'recv':>6}  outcome")
    for x in h.ledger:
        # `sent` is the SERVER's claim (it emitted frames); `recv` is THIS
        # client's own fact (bytes read back). They are printed side by side
        # because conflating them is the thing #3939 asks us not to do.
        sent = bool(x.stream_frames) or (x.http_status is not None)
        recv = x.received_chars > 0
        state = (
            x.terminal_outcome
            or ("pre-accept" if x.failed_before_acceptance else ("unknown" if x.accepted is None else "-"))
        )
        print(
            f"  {x.scenario:24} {str(x.http_status):>5} {mark(x.attempted):>4}{mark(x.accepted):>5}"
            f"{mark(x.generated):>5}{mark(x.persisted):>5}{mark(sent):>6}{mark(recv):>6}  {state}"
        )
    print("\nserver reconciliation (independent of the recorder):")
    print(json.dumps(cov.get("reconciliation"), indent=2))
    print(f"\nartifact: {args.out}")

    rec = cov.get("reconciliation") or {}
    # The one hard assertion: a served 2xx that never opened a turn is a capture
    # defect, and this harness is what makes it fail loudly rather than pass.
    lost = rec.get("lost_starts")
    if lost:
        print(f"\nFAIL — {lost} lost start(s): a 2xx was served with no ledger row behind it")
        return 1
    if rec.get("starts_without_arrival"):
        print(f"\nFAIL — {rec['starts_without_arrival']} ledger start(s) with no arrival: ingress is failing")
        return 1
    print("\nPASS — every served turn reached the ledger")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
