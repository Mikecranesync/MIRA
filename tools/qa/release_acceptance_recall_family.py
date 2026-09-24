#!/usr/bin/env python3
"""Live acceptance for the capture -> recall -> right-family chain (staging only).

WHAT THIS ADDS, AND WHAT IT DELIBERATELY DOES NOT DUPLICATE
`capture_acceptance.py` already proves the CAPTURE contract (#3939): every
attempt registered client-side BEFORE it is sent, then reconciled against
`/api/observability/coverage` so a turn the recorder MISSED shows up as a
number rather than a silence. Nothing here re-implements that; run it first and
this second.

This harness proves the two things that one cannot:

  R  RECALL WITHOUT THE CLIENT RIDER (#3967 / #3968)
     A LOOK, then a text-only follow-up carrying NO `visualEvidence` rider.
     The observation must still reach the model, recalled SERVER-side from the
     turn row. This is the exact shape that filed #3967, and the exact shape a
     harness that silently sends the rider cannot test -- which is how #3967 was
     first filed with the wrong headline.

  F  RIGHT FAMILY, OR NOTHING (#3966 / #3970 / #3950)
     With HMI identity resolved, an HMI question must not cite a VFD manual.
     Empty citations are an ACCEPTABLE outcome here (honest refusal); a V20 /
     GH6 / SINAMICS citation is not.

Both carry negative controls, because each assertion has a trivially-passing
degenerate case:
  R-neg  a fresh notebook with no prior LOOK must NOT report a recalled
         observation -- otherwise "recall" could just be a field that is always
         set, and R would pass without recalling anything.
  F-neg  a same-family question must still RETRIEVE (retrieval.candidate_count
         > 0) -- otherwise a filter that returns empty for EVERYTHING passes F
         trivially. Note this asserts retrieval, not rendered citations: the
         packet carries candidate counts and doc ids, never titles. If the
         corpus simply holds no same-family manual the control reports
         INCONCLUSIVE, because it then cannot tell an over-aggressive filter
         from an empty corpus.

It also asserts two invariants that must hold on every turn:
  J  Jev is SHADOW ONLY -- present in the packet, never the gate.
  S  the deterministic safety check RAN, whatever Jev triage thought.

Staging only. Refuses a production host outright.

  export ACCEPT_BASE=https://app-staging.factorylm.com ACCEPT_COOKIE='next-auth…'
  python3 tools/qa/release_acceptance_recall_family.py --notebook <uuid> \
      --hmi-photo path/to/tp700.jpg
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
import urllib.parse
import urllib.request
import uuid

PROD_HOSTS = {"app.factorylm.com", "factorylm.com", "www.factorylm.com"}
# Families that must never be cited for an HMI turn.
#
# WORD-BOUNDARY, not substring: a bare `in` test for "vfd" matches any JSON key
# or prose containing those letters and reports a wrong-family citation that
# never happened.
#
# And these are matched against the ANSWER BODY, not the packet. The Turn
# Evidence Packet carries `returned_doc_ids` / `evidence_doc_ids` — opaque uuids
# — and NO manual titles or urls, so scanning the packet for "v20" can almost
# never match and the check passes vacuously. The citations with human-readable
# titles live in the chat response.
WRONG_FAMILY = ("v20", "gh6", "sinamics", "powerflex", "vfd", "inverter")
_WRONG_FAMILY_RE = re.compile(r"\b(" + "|".join(WRONG_FAMILY) + r")\b", re.I)


def refuse_prod(base: str) -> str:
    host = (urllib.parse.urlparse(base).hostname or "").lower()
    if not host:
        sys.exit(f"ACCEPT_BASE has no host: {base!r}")
    # Host-EXACT. A substring test ("factorylm.com" in base) matches
    # app-staging.factorylm.com and would refuse the only target we want.
    if host in PROD_HOSTS:
        sys.exit(f"REFUSING production host {host!r}. Staging only.")
    return base.rstrip("/")


class Client:
    def __init__(self, base: str, cookie: str, notebook: str) -> None:
        self.base, self.cookie, self.notebook = base, cookie, notebook

    def _req(self, path, *, data=None, headers=None, method=None):
        h = {"Cookie": self.cookie}
        h.update(headers or {})
        req = urllib.request.Request(f"{self.base}{path}", data=data, headers=h, method=method)
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                return r.status, r.read()
        except urllib.error.HTTPError as e:
            return e.code, e.read()

    def look(self, photo: str, question: str):
        """Multipart LOOK upload. Returns (status, fileId, clientRequestId)."""
        crid = str(uuid.uuid4())
        boundary = "----mira" + uuid.uuid4().hex
        mime = mimetypes.guess_type(photo)[0] or "image/jpeg"
        with open(photo, "rb") as fh:
            blob = fh.read()
        parts = []
        for name, val in (("question", question), ("clientRequestId", crid)):
            parts.append(
                f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{val}\r\n".encode()
            )
        parts.append(
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"photo\"; "
            f"filename=\"{os.path.basename(photo)}\"\r\nContent-Type: {mime}\r\n\r\n".encode()
            + blob + b"\r\n"
        )
        parts.append(f"--{boundary}--\r\n".encode())
        status, body = self._req(
            f"/api/equipment-notebooks/{self.notebook}/look/",
            data=b"".join(parts),
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
            method="POST",
        )
        file_id = None
        try:
            file_id = json.loads(body.decode("utf8", "replace")).get("fileId")
        except Exception:
            pass
        return status, file_id, crid

    def ask(self, message: str, *, notebook: str | None = None, rider_file_id: str | None = None):
        """Text turn. rider_file_id=None means NO visualEvidence rider is sent.

        The rider is the whole point of the R scenario: omitting it is what makes
        the test prove SERVER-side recall instead of client re-supply.
        """
        crid = str(uuid.uuid4())
        payload: dict = {"message": message, "mode": "general", "clientRequestId": crid}
        if rider_file_id:
            payload["visualEvidence"] = {"fileId": rider_file_id}
        nb = notebook or self.notebook
        status, body = self._req(
            f"/api/equipment-notebooks/{nb}/chat/",
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        return status, body.decode("utf8", "replace"), crid

    def packet(self, client_request_id: str, *, tries: int = 12) -> dict | None:
        """Read the turn's evidence packet back out of the recorder."""
        for _ in range(tries):
            status, body = self._req(
                f"/api/observability/turns/?client_request_id={urllib.parse.quote(client_request_id)}"
            )
            if status == 200:
                try:
                    rows = json.loads(body.decode("utf8", "replace"))
                except Exception:
                    rows = None
                if isinstance(rows, dict):
                    rows = rows.get("turns") or rows.get("rows") or []
                if rows:
                    p = rows[0].get("packet") if isinstance(rows[0], dict) else None
                    if p:
                        return p
            time.sleep(2)
        return None


def cites_wrong_family(answer_body: str) -> list[str]:
    """Wrong-family tokens in the ANSWER the technician actually saw."""
    return sorted({m.group(1).lower() for m in _WRONG_FAMILY_RE.finditer(answer_body or "")})


def cited_anything(answer_body: str) -> bool:
    """Did the turn cite at all? An answer citing NOTHING trivially satisfies the
    wrong-family ban, so that outcome must be reported distinctly rather than as
    a clean PASS."""
    b = (answer_body or "").lower()
    return ('"sources"' in b) or ("[1]" in b) or ('"citations"' in b)


def check(results: list, name: str, ok, detail: str) -> None:
    """ok=True PASS, ok=False FAIL, ok=None INCONCLUSIVE.

    A control that could not discriminate is NOT a pass. Folding it into the
    pass count is how a harness reports success for work it never did.
    """
    results.append({"check": name, "ok": None if ok is None else bool(ok), "detail": detail})
    print(f"  {'PASS' if ok else ('INCONCLUSIVE' if ok is None else 'FAIL')}  {name}: {detail}")


def invariants(results: list, tag: str, p: dict) -> None:
    """J and S must hold on EVERY turn, so they are asserted per-turn."""
    gate = p.get("answer_gate") or {}
    # J — Jev shadow only. Its fields may be present; the gate decision must not
    # be explained by Jev. `jev_sufficient` being null (not run) is fine; what is
    # NOT fine is a gate reason that cites Jev.
    reason = json.dumps(gate.get("reason") or "")
    check(results, f"{tag}/J jev-shadow-only", "jev" not in reason.lower(),
          f"answer_gate.reason={gate.get('reason')!r} jev_sufficient={gate.get('jev_sufficient')!r}")
    # S — the deterministic safety classification is present on every served turn.
    check(results, f"{tag}/S safety-ran", "safety_classification" in gate,
          f"safety_classification={gate.get('safety_classification')!r}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--notebook", required=True, help="notebook with the HMI asset")
    ap.add_argument("--fresh-notebook", help="an EMPTY notebook, for the R negative control")
    ap.add_argument("--hmi-photo", required=True, help="a TP700/HMI nameplate photo")
    ap.add_argument("--hmi-question", default="it keeps rebooting, what do I check first")
    ap.add_argument("--same-family-question", default="what is the supply voltage for this panel")
    ap.add_argument("--out", default="/tmp/release-acceptance.json")
    a = ap.parse_args()

    base = refuse_prod(os.environ.get("ACCEPT_BASE", ""))
    cookie = os.environ.get("ACCEPT_COOKIE", "")
    if not cookie:
        sys.exit("ACCEPT_COOKIE is required")
    c = Client(base, cookie, a.notebook)
    results: list = []
    print(f"target {base} (staging)")

    # ---- R: capture, then recall with NO rider -----------------------------
    print("\nR — capture a photo, then recall it with NO client rider")
    st, file_id, _ = c.look(a.hmi_photo, "what is this")
    check(results, "R/look-accepted", st == 200 and bool(file_id), f"status={st} fileId={file_id}")
    if st != 200:
        print("  aborting R: the LOOK itself did not land")
    else:
        st2, body2, crid2 = c.ask(a.hmi_question)      # <- no rider, on purpose
        p = c.packet(crid2)
        check(results, "R/follow-up-served", st2 == 200, f"status={st2}")
        check(results, "R/packet-readable", p is not None, "recorder returned the turn's packet")
        if p:
            ve = p.get("visual_evidence") or {}
            rt = p.get("retrieval") or {}
            ctx = p.get("context") or {}
            check(results, "R/recalled-without-rider",
                  (ve.get("prior_turn_observation_count") or 0) >= 1,
                  f"prior_turn_observation_count={ve.get('prior_turn_observation_count')}")
            check(results, "R/considered-in-retrieval",
                  (rt.get("prior_visual_observations_considered") or 0) >= 1,
                  f"prior_visual_observations_considered={rt.get('prior_visual_observations_considered')}")
            check(results, "R/reached-model-context",
                  (ctx.get("visual_evidence_count") or 0) >= 1,
                  f"context.visual_evidence_count={ctx.get('visual_evidence_count')}")
            # ---- F: right family, or nothing ---------------------------------
            print("\nF — identity-bound retrieval must not cite another family")
            bad = cites_wrong_family(body2)
            if not bad and not cited_anything(body2):
                # Honest refusal satisfies the BAN but proves nothing about the
                # filter, so it is not a pass.
                check(results, "F/no-wrong-family-citation", None,
                      "answer cited NOTHING — the ban is trivially satisfied and this "
                      "run cannot distinguish a correct filter from a broken one")
            else:
                check(results, "F/no-wrong-family-citation", not bad,
                      f"wrong-family tokens in the ANSWER: {bad or 'none'}; cited={cited_anything(body2)}")
            check(results, "F/identity-bound",
                  rt.get("oem_model") is not None,
                  f"oem_model={rt.get('oem_model')!r} source={rt.get('oem_model_source')!r}")
            invariants(results, "R", p)

    # ---- F-neg: a same-family question must still retrieve ------------------
    print("\nF-neg — NEGATIVE CONTROL: same-family question still retrieves")
    st3, body3, crid3 = c.ask(a.same_family_question)
    p3 = c.packet(crid3)
    if p3:
        rt3 = p3.get("retrieval") or {}
        searched = bool(rt3.get("oem_corpus_searched"))
        candidates = rt3.get("candidate_count") or 0
        # `oem_corpus_searched` only says retrieval was ATTEMPTED. A filter that
        # returned empty for EVERYTHING would still set it true and sail past.
        # The control has to assert the RESULT.
        if not searched:
            check(results, "F-neg/still-retrieves", False,
                  "OEM corpus was not even searched for a same-family question")
        elif candidates > 0:
            check(results, "F-neg/still-retrieves", True,
                  f"candidate_count={candidates} — the filter did not empty everything")
        else:
            # Cannot tell "filter too aggressive" from "no same-family manual in
            # this corpus". Neither pass nor fail.
            check(results, "F-neg/still-retrieves", None,
                  "searched but candidate_count=0 — INCONCLUSIVE: either the filter is "
                  "over-aggressive or this corpus holds no same-family manual. Seed one "
                  "and re-run, or this control proves nothing")
        invariants(results, "F-neg", p3)
    else:
        check(results, "F-neg/still-retrieves", False, "no packet")

    # ---- R-neg: no prior LOOK => nothing recalled ---------------------------
    if a.fresh_notebook:
        print("\nR-neg — NEGATIVE CONTROL: empty notebook recalls nothing")
        st4, _, crid4 = c.ask(a.hmi_question, notebook=a.fresh_notebook)
        p4 = c.packet(crid4)
        if p4:
            ve4 = p4.get("visual_evidence") or {}
            check(results, "R-neg/nothing-recalled",
                  (ve4.get("prior_turn_observation_count") or 0) == 0,
                  f"prior_turn_observation_count={ve4.get('prior_turn_observation_count')} "
                  "(must be 0, else 'recall' is a field that is always set)")
        else:
            check(results, "R-neg/nothing-recalled", False, "no packet")
    else:
        print("\nR-neg SKIPPED — pass --fresh-notebook to run the negative control")
        results.append({"check": "R-neg/nothing-recalled", "ok": None,
                        "detail": "not run: --fresh-notebook not supplied"})

    failed = [r for r in results if r["ok"] is False]
    skipped = [r for r in results if r["ok"] is None]
    with open(a.out, "w") as fh:
        json.dump({"base": base, "results": results}, fh, indent=2)
    print(f"\nartifact: {a.out}")
    print(f"{len(results) - len(failed) - len(skipped)} passed, {len(failed)} failed, "
          f"{len(skipped)} inconclusive/not-run")
    if skipped:
        print("INCONCLUSIVE or NOT RUN — these prove nothing and are NOT passes:")
        for r in skipped:
            print(f"  - {r['check']}: {r['detail']}")
    if failed:
        print("FAILED:")
        for r in failed:
            print(f"  - {r['check']}: {r['detail']}")
        return 1
    return 0 if not skipped else 2


if __name__ == "__main__":
    raise SystemExit(main())
