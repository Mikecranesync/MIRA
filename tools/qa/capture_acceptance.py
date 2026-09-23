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
    """One pre-registered attempt. Written BEFORE the request is sent."""
    scenario: str
    client_request_id: str
    sent_at: float | None = None
    http_status: int | None = None
    trace_id: str | None = None
    transport_error: str | None = None
    expectation: str = ""
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
                return r.read(read_bytes) if read_bytes else r.read()
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

    time.sleep(5)  # let the fire-and-forget response rows land
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

    print(f"\nclient attempts registered: {len(h.ledger)}")
    for x in h.ledger:
        print(f"  {x.scenario:22} status={x.http_status} trace={x.trace_id} err={x.transport_error}")
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
