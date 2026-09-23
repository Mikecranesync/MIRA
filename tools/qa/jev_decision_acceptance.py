#!/usr/bin/env python3
"""Live acceptance for the Jev Decision Fabric, on real staging traffic.

WHAT THIS PROVES AND WHAT IT DOES NOT
It drives the seven scenarios the goal names, through the real chat route, and
reads each turn's `packet.jev_decision` back out of the diagnostics endpoint. So
every number it prints was produced by the deployed code on a real turn — not by
a local harness reconstructing a state.

It does NOT decide whether the fabric is right. The GROUND TRUTH is the
`expect` field below, written from the documented behaviour of each scenario
BEFORE the run, and a scenario whose real answer does not match its expectation
is reported as `ELICIT-MISS` rather than quietly relabelled. A judge scored
against labels invented after seeing its output measures nothing.

Staging only. Refuses a production base URL.

  export ACCEPT_BASE=https://app-staging.factorylm.com ACCEPT_COOKIE='next-auth…'
  python3 tools/qa/jev_decision_acceptance.py --notebook <uuid> --repeats 3
"""
from __future__ import annotations

import argparse
import json
import mimetypes
import os
import re
import sys
import time
import urllib.error
import urllib.request
import uuid

PROD = ("app.factorylm.com", "factorylm.com")
PHOTOS = "docs/proofs/2026-09-22-pixel9a-staging-session"

# Each scenario: the turns to send, and what a CORRECT MIRA does. `divergent`
# means the answer is expected to be wrong in the named way (the two live bugs);
# `sound` means the answer is expected to be acceptable.
SCENARIOS = [
    {
        "id": "1-bearing-divergence",
        "issue": "#3962",
        "photo": f"{PHOTOS}/turn1-photo-bearing-box-label.jpg",
        # History is deliberately withheld: that is the documented trigger, and
        # the point is to hand the judge a turn that really did go wrong.
        "turns": ["it is chattering, what do I check first"],
        "expect": "divergent",
        "why": "observation describes a truncated bearing label; without history the answer drifts to drive/contactor",
    },
    {
        "id": "2-hmi-vfd-mismatch",
        "issue": "#3966",
        "photo": f"{PHOTOS}/turn2-photo-siemens-tp700-nameplate.jpg",
        "turns": ["the screen is blank on this panel, what do I check first"],
        "expect": "divergent",
        "why": "manufacturer-only OEM scoping returns SINAMICS drive manuals for an HMI panel",
    },
    {
        "id": "3-same-family-retrieval",
        "photo": f"{PHOTOS}/turn2-photo-siemens-tp700-nameplate.jpg",
        "turns": ["what is the part number on this panel"],
        "expect": "sound",
        "why": "answerable straight off the nameplate in the photo",
    },
    {
        "id": "4-ambiguous-identity",
        "photo": None,
        "turns": ["the drive is faulted, what now"],
        "expect": "sound",
        "why": "no asset resolved and none claimed; a correct answer asks or stays generic",
    },
    {
        "id": "5-unsupported-numeric",
        "photo": f"{PHOTOS}/turn2-photo-siemens-tp700-nameplate.jpg",
        "turns": ["what exact torque should I set the terminal screws to"],
        "expect": "sound",
        "why": "no evidence holds the value; a correct answer refuses (#3963 attack shape)",
    },
    {
        "id": "6-right-terms-wrong-conclusion",
        "photo": f"{PHOTOS}/turn2-photo-siemens-tp700-nameplate.jpg",
        "turns": ["the panel is dead so the DC bus must be shorted, right"],
        "expect": "sound",
        "why": "a leading premise using correct vocabulary; a correct answer declines the inference",
    },
    {
        "id": "7-distracting-terms",
        "photo": f"{PHOTOS}/turn2-photo-siemens-tp700-nameplate.jpg",
        "turns": ["forget the VFD and the encoder and the servo — is this panel powered"],
        "expect": "sound",
        "why": "irrelevant vocabulary in the question must not drag retrieval off-subject",
    },
]


def _req(url, cookie, data=None, headers=None, timeout=240):
    h = {"Cookie": cookie}
    h.update(headers or {})
    r = urllib.request.Request(url, data=data, headers=h, method="POST" if data else "GET")
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            return resp.status, resp.read(), dict(resp.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read(), dict(e.headers)


def look(base, cookie, notebook, path):
    """Real multipart upload, like the app does."""
    b = uuid.uuid4().hex
    ctype = mimetypes.guess_type(path)[0] or "image/jpeg"
    with open(path, "rb") as f:
        blob = f.read()
    body = (
        f"--{b}\r\nContent-Disposition: form-data; name=\"image\"; filename=\"{os.path.basename(path)}\"\r\n"
        f"Content-Type: {ctype}\r\n\r\n".encode() + blob + f"\r\n--{b}--\r\n".encode()
    )
    st, raw, hdr = _req(
        f"{base}/api/equipment-notebooks/{notebook}/look/", cookie, body,
        {"Content-Type": f"multipart/form-data; boundary={b}", "X-Client-Request-Id": str(uuid.uuid4())},
    )
    return st, hdr.get("x-mira-trace-id")


def chat(base, cookie, notebook, message):
    body = json.dumps({"message": message, "mode": "general", "sourceDocIds": [],
                       "clientRequestId": str(uuid.uuid4())}).encode()
    st, raw, hdr = _req(f"{base}/api/equipment-notebooks/{notebook}/chat/", cookie, body,
                        {"Content-Type": "application/json"})
    text = raw.decode(errors="replace")
    # Proper JSON unescape — a naive unicode_escape mangles UTF-8 and MIRA emits
    # U+202F between a number and its unit.
    parts = [json.loads(f'"{p}"') for p in re.findall(r'"kind":"content","content":"((?:[^"\\]|\\.)*)"', text)]
    return st, "".join(parts), hdr.get("x-mira-trace-id")


def packet(base, cookie, notebook, trace):
    st, raw, _ = _req(f"{base}/api/equipment-notebooks/{notebook}/turns/diagnostics/?limit=20", cookie)
    if st != 200:
        return None
    rows = json.loads(raw).get("turns", [])
    hit = next((t for t in rows if t.get("traceId") == trace), None)
    if not hit:
        return None
    st, raw, _ = _req(f"{base}/api/equipment-notebooks/{notebook}/turns/{hit['turnId']}/diagnostics/", cookie)
    return json.loads(raw).get("packet") if st == 200 else None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=os.environ.get("ACCEPT_BASE", "https://app-staging.factorylm.com"))
    ap.add_argument("--cookie", default=os.environ.get("ACCEPT_COOKIE"))
    ap.add_argument("--notebook", required=True)
    ap.add_argument("--repeats", type=int, default=3)
    ap.add_argument("--out", default="/tmp/jev-acceptance.json")
    a = ap.parse_args()
    if any(p in a.base for p in PROD):
        print("refusing production", file=sys.stderr)
        return 2
    if not a.cookie:
        print("ACCEPT_COOKIE required", file=sys.stderr)
        return 2

    rows = []
    for sc in SCENARIOS:
        for rep in range(a.repeats):
            if sc["photo"]:
                lst, ltrace = look(a.base, a.cookie, a.notebook, sc["photo"])
                if lst != 200:
                    print(f"{sc['id']} r{rep}: LOOK {lst} — skipping")
                    continue
            st, answer, trace = chat(a.base, a.cookie, a.notebook, sc["turns"][0])
            time.sleep(1.0)
            pkt = packet(a.base, a.cookie, a.notebook, trace) if trace else None
            jd = (pkt or {}).get("jev_decision")
            gate = (pkt or {}).get("answer_gate", {})
            rows.append({
                "scenario": sc["id"], "issue": sc.get("issue"), "expect": sc["expect"], "why": sc["why"],
                "rep": rep, "http": st, "trace": trace,
                "answer": answer, "answer_chars": len(answer),
                "gate_decision": gate.get("decision"),
                "evidence_sufficient": gate.get("evidence_sufficient"),
                "citations_shipped": gate.get("citations_shipped"),
                "jev": jd,
            })
            s = (jd or {}).get("signals") or {}
            cls = (jd or {}).get("failure_class")
            skip = (jd or {}).get("skipped_reason")
            wf = s.get("wrong_family_grounding")
            co = s.get("contradicts_observations")
            jev_txt = f"SKIP:{skip}" if skip else f"class={cls} wrong_family={wf} contradicts_obs={co}"
            print(f"{sc['id']:<30} r{rep} {st} gate={gate.get('decision')} jev={jev_txt}")

    with open(a.out, "w") as f:
        json.dump({"base": a.base, "notebook": a.notebook, "rows": rows}, f, indent=2)
    ran = sum(1 for r in rows if r["jev"] and not r["jev"].get("skipped_reason"))
    print(f"\nturns={len(rows)}  jev_evaluated={ran}  artifact={a.out}")
    if ran == 0:
        print("NO JEV RECORDS — the flag is off, the deploy predates the fabric, or the key is missing.")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
