#!/usr/bin/env python3
"""Session sweep — turn a session of real app use into filed issues.

Reads the Turn Flight Recorder for every notebook the signed-in technician owns,
scores each turn against a fault table, groups identical faults, and writes one
ready-to-file issue body per fault. With --file it hands each body to
tools/qa/create_issue.sh (which dedupes against open+closed issues first).

The point is that "it did something dumb" stops depending on anyone remembering
what they typed. Every turn already writes a durable evidence packet; this reads
them back and says which ones were wrong, with the trace id to prove it.

NO question or answer text is ever read or filed — the packets do not carry it
(content capture is off) and the issue bodies carry ids, flags and timings only.

Usage:
  export MIRA_QA_EMAIL=... MIRA_QA_PASSWORD=...
  python3 tools/qa/session_issue_sweep.py --since 2h                # report only
  python3 tools/qa/session_issue_sweep.py --since 2h --file         # file issues
  python3 tools/qa/session_issue_sweep.py --base https://app.factorylm.com --since 30m
"""
from __future__ import annotations

import argparse
import http.cookiejar
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

DEFAULT_BASE = "https://app-staging.factorylm.com"

# Active-incident triggers are the ONE class where a stop is correct. A stop on
# anything else is the refusal behaviour the safety-pause contract removed.
INCIDENT_TRIGGER = re.compile(
    r"smoke|fire|arcing|shock|explod|burning|sparking|electrocut", re.I
)


def _severity_rank(sev: str) -> int:
    return {"P1": 0, "P2": 1, "P3": 2}.get(sev, 3)


# ── the fault table ──────────────────────────────────────────────────────────
# Each entry: (id, severity, predicate(packet, anomalies) -> detail|None, title)
def _faults(pkt: dict, anomalies: list) -> list[tuple[str, str, str, str]]:
    out: list[tuple[str, str, str, str]] = []
    gate = pkt.get("answer_gate") or {}
    gen = pkt.get("generation") or {}
    ret = pkt.get("retrieval") or {}
    vis = pkt.get("visual_evidence") or {}
    per = pkt.get("persistence") or {}
    ctx = pkt.get("context") or {}
    reason = gate.get("reason") or ""
    decision = gate.get("decision")

    if reason.startswith("safety_stop:"):
        trigger = reason.split(":", 1)[1]
        if not INCIDENT_TRIGGER.search(trigger):
            out.append(("refused-not-warned", "P1",
                        f"terminal stop on trigger `{trigger}` with no active incident",
                        f"MIRA stopped instead of warning (trigger: {trigger})"))
    elif decision == "blocked":
        sev = "P2" if reason.startswith("unsupported-specificity:") else "P1"
        out.append((f"gate-blocked:{reason}", sev,
                    f"the answer was replaced before display; gate reason `{reason}`",
                    f"Answer gate replaced a real answer ({reason})"))

    if decision == "insufficient_evidence" or (pkt.get("kind") == "chat" and decision == "abstained"):
        out.append(("abstained", "P2",
                    f"abstained with chunk_count={ctx.get('chunk_count')}, "
                    f"strategy={ret.get('strategy')}",
                    "MIRA abstained instead of answering"))

    if pkt.get("errors"):
        out.append(("turn-errors", "P1", f"errors={json.dumps(pkt['errors'])[:300]}",
                    "Turn recorded an error"))

    if per.get("outcome") not in (None, "ok"):
        out.append(("persist-failed", "P1",
                    f"outcome={per.get('outcome')} error_code={per.get('error_code')}",
                    "Turn failed to persist — the technician loses it on reload"))

    if gen.get("attempts") and not gen.get("served_model"):
        out.append(("provider-exhausted", "P1",
                    f"attempts={json.dumps(gen['attempts'])[:300]}",
                    "Every provider in the cascade failed"))

    if vis.get("observation_available") and not vis.get("observation_in_context"):
        out.append(("visual-dropped", "P1",
                    f"file_id={vis.get('file_id')} — a verified photo's observation "
                    "never reached the prompt",
                    "A verified photo was dropped before the model saw it"))

    if gate.get("ungrounded_unit_claim"):
        # P3, and deliberately so. This detector fired on 25 of 40 turns in the
        # 2026-09-22 sweep, almost all of them legitimate general engineering
        # ("a 120 V coil that sags to 70 V will drop out"). It is TELEMETRY —
        # it gates nothing and never changes what the technician sees — so a
        # P1/P2 sweep must not drown in it. Retune the detector before promoting.
        out.append(("ungrounded-unit-claim", "P3",
                    "a unit-bearing number was asserted with no evidence behind it "
                    "(telemetry only — this flag gates nothing)",
                    "Speculation escaped the gate (ungrounded unit claim)"))

    if ret.get("executed") and (ret.get("candidate_count") or 0) > 0 and not ret.get("returned_doc_ids"):
        out.append(("retrieval-dropped-all", "P2",
                    f"candidate_count={ret.get('candidate_count')} but zero docs returned "
                    f"(zero_result_reason={ret.get('zero_result_reason')})",
                    "Retrieval found candidates and returned none"))

    if ctx.get("chunk_count") == 0 and ret.get("executed") and not ret.get("zero_result_reason"):
        out.append(("retrieval-silent-zero", "P3",
                    "retrieval ran, returned nothing, and recorded no reason",
                    "Retrieval returned zero with no recorded reason"))

    # A warned answer is the DESIGNED outcome, not a fault — surfaced at P3 so a
    # sweep can confirm banners are actually reaching people.
    if gate.get("safety_classification") == "hazard_pause":
        out.append((f"ok-hazard-pause:{gate.get('hazard_banner')}", "P3",
                    f"answer served behind the `{gate.get('hazard_banner')}` banner "
                    "(this is the intended safety-pause behaviour, not a defect)",
                    f"OK — warned and answered ({gate.get('hazard_banner')})"))

    total = ((pkt.get("timings_ms") or {}).get("total") or 0)
    if total > 20000:
        out.append(("slow-turn", "P3", f"total={total}ms", "Turn took over 20 s"))

    for a in anomalies or []:
        code = a.get("code") if isinstance(a, dict) else str(a)
        # Same signal as `ungrounded_unit_claim` above — one fault, not two.
        if code == "GENERIC_ANSWER_UNGROUNDED_CLAIM":
            continue
        out.append((f"anomaly:{code}", "P2", f"anomaly {code}: {json.dumps(a)[:240]}",
                    f"Anomaly recorded: {code}"))
    return out


class Client:
    def __init__(self, base: str):
        self.base = base.rstrip("/")
        self.cj = http.cookiejar.CookieJar()
        self.op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cj))
        self.op.addheaders = [("User-Agent", "curl/8.7.1")]

    def get(self, path: str):
        return json.loads(self.op.open(self.base + path, timeout=60).read())

    def login(self, email: str, password: str) -> None:
        csrf = self.get("/api/auth/csrf/")["csrfToken"]
        data = urllib.parse.urlencode(
            {"csrfToken": csrf, "email": email, "password": password,
             "callbackUrl": self.base, "json": "true"}).encode()
        self.op.open(urllib.request.Request(
            self.base + "/api/auth/callback/credentials/", data=data,
            headers={"Content-Type": "application/x-www-form-urlencoded"}), timeout=60).read()
        if not self.get("/api/auth/session/").get("user"):
            sys.exit("login failed — check MIRA_QA_EMAIL / MIRA_QA_PASSWORD")

    def use_cookie(self, cookie: str) -> None:
        self.op.addheaders = [("User-Agent", "curl/8.7.1"), ("Cookie", cookie)]
        if not self.get("/api/auth/session/").get("user"):
            sys.exit("cookie did not authenticate")


def parse_since(s: str) -> datetime:
    m = re.fullmatch(r"(\d+)\s*([mhd])", s.strip(), re.I)
    if m:
        n, unit = int(m.group(1)), m.group(2).lower()
        delta = {"m": timedelta(minutes=n), "h": timedelta(hours=n), "d": timedelta(days=n)}[unit]
        return datetime.now(timezone.utc) - delta
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=os.environ.get("MIRA_QA_BASE", DEFAULT_BASE))
    ap.add_argument("--since", default="2h", help="30m | 2h | 1d | ISO timestamp")
    ap.add_argument("--limit", type=int, default=40, help="turns per notebook to scan")
    ap.add_argument("--out", default=None, help="directory for the report + issue bodies")
    ap.add_argument("--file", action="store_true", help="actually create GitHub issues")
    ap.add_argument("--min-severity", default="P3", choices=["P1", "P2", "P3"])
    a = ap.parse_args()

    since = parse_since(a.since)
    c = Client(a.base)
    cookie = os.environ.get("MIRA_SESSION_COOKIE")
    if cookie:
        c.use_cookie(cookie)
    else:
        email, pw = os.environ.get("MIRA_QA_EMAIL"), os.environ.get("MIRA_QA_PASSWORD")
        if not (email and pw):
            sys.exit("set MIRA_SESSION_COOKIE, or MIRA_QA_EMAIL + MIRA_QA_PASSWORD")
        c.login(email, pw)

    notebooks = c.get("/api/equipment-notebooks/")
    if isinstance(notebooks, dict):
        notebooks = notebooks.get("notebooks", [])
    print(f"scanning {len(notebooks)} notebook(s) since {since.isoformat()}", file=sys.stderr)

    scanned, findings = 0, {}
    for nb in notebooks:
        nid = nb.get("id")
        if not nid:
            continue
        try:
            turns = c.get(f"/api/equipment-notebooks/{nid}/turns/diagnostics/?limit={a.limit}")["turns"]
        except urllib.error.HTTPError as e:
            print(f"  notebook {nid}: HTTP {e.code}", file=sys.stderr)
            continue
        for t in turns:
            ts = datetime.fromisoformat(t["ts"].replace("Z", "+00:00"))
            if ts < since:
                continue
            scanned += 1
            try:
                d = c.get(f"/api/equipment-notebooks/{nid}/turns/{t['turnId']}/diagnostics/")
            except urllib.error.HTTPError:
                continue
            pkt = d.get("packet") or {}
            for fid, sev, detail, title in _faults(pkt, d.get("anomalies") or []):
                if _severity_rank(sev) > _severity_rank(a.min_severity):
                    continue
                f = findings.setdefault(fid, {"sev": sev, "title": title, "turns": []})
                f["turns"].append({
                    "turn_id": t["turnId"], "trace_id": t.get("traceId"), "ts": t["ts"],
                    "notebook_id": nid, "detail": detail,
                    "viewer": d.get("viewerUrl"), "git_sha": pkt.get("git_sha"),
                    "env": pkt.get("environment"),
                })

    out = Path(a.out or f"dogfood-output/session-sweeps/{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}")
    out.mkdir(parents=True, exist_ok=True)
    ordered = sorted(findings.items(), key=lambda kv: (_severity_rank(kv[1]["sev"]), -len(kv[1]["turns"])))

    lines = [f"# Session sweep — {a.base}", "",
             f"- window: since `{since.isoformat()}`",
             f"- turns scanned: **{scanned}**",
             f"- distinct faults: **{len(ordered)}**", ""]
    for fid, f in ordered:
        n = len(f["turns"])
        first = f["turns"][0]
        lines += [f"## [{f['sev']}] {f['title']} — {n}×", "",
                  f"- fault id: `{fid}`",
                  f"- detail: {first['detail']}",
                  f"- build: `{first.get('git_sha')}` ({first.get('env')})",
                  "- turns:"]
        for t in f["turns"][:10]:
            lines.append(f"  - `{t['ts']}` turn `{t['turn_id']}` trace `{t['trace_id']}`")
        if first.get("viewer"):
            lines.append(f"- trace viewer: {first['viewer']}")
        lines.append("")

        body = out / f"issue-{re.sub(r'[^a-z0-9]+', '-', fid.lower()).strip('-')}.md"
        body.write_text("\n".join([
            f"## What happened", "",
            f"{first['detail']}", "",
            f"Seen **{n}×** in this session on build `{first.get('git_sha')}` "
            f"({first.get('env')}), at `{a.base}`.", "",
            "## Evidence (Turn Flight Recorder)", "",
            *[f"- `{t['ts']}` — turn `{t['turn_id']}`, trace `{t['trace_id']}`, "
              f"notebook `{t['notebook_id']}`" for t in f["turns"][:10]],
            "",
            f"Trace viewer: {first.get('viewer') or 'n/a'}", "",
            "## How to reproduce", "",
            "Read the packet directly — it carries the routing, retrieval, generation "
            "and gate decision for the turn:", "",
            "```",
            f"GET {a.base}/api/equipment-notebooks/{first['notebook_id']}"
            f"/turns/{first['turn_id']}/diagnostics/",
            "```", "",
            "No question or answer text is captured or included (content capture is off).", "",
            f"Filed by `tools/qa/session_issue_sweep.py` (fault id `{fid}`).", "",
        ]) + "\n")

        if a.file:
            cmd = ["tools/qa/create_issue.sh",
                   "--title", f"{f['sev']}(hub): {f['title']}",
                   "--body-file", str(body),
                   "--labels", f"bug,{f['sev']},hub,needs-triage",
                   "--search", f["title"]]
            r = subprocess.run(cmd, capture_output=True, text=True)
            print(f"  {fid}: {(r.stdout or r.stderr).strip().splitlines()[-1] if (r.stdout or r.stderr) else r.returncode}",
                  file=sys.stderr)

    report = out / "REPORT.md"
    report.write_text("\n".join(lines))
    print("\n".join(lines))
    print(f"\nreport: {report}", file=sys.stderr)
    return 1 if any(f["sev"] == "P1" for _, f in ordered) else 0


if __name__ == "__main__":
    sys.exit(main())
