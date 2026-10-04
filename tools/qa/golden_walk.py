#!/usr/bin/env python3
"""Golden Walk — the manual-first journey, end to end, against a deployed Hub.

For each machine in tools/qa/golden_walk_machines.json this replays the exact
request sequence the phone makes, asserting only from the live wire:

  1. new notebook, no identity
  2. chat turn naming the part        -> expect an `identity_proposal` frame
  3. POST identity/confirm            -> "Use its manuals" (the proposal's own values)
  4. poll GET notebook                -> manual search resolves; a ready manual source
  5. ask a fault-code question        -> cited answer, sourceDocIds = enabled sources
  6. citation truth                   -> GET passage for each cited (doc, page);
                                         PASS only if a cited passage contains the code
                                         AND one meaning keyword

Honesty rows (`expect_manual: false`) pass only when no citation is shown and
the search status is reported, never invented.

Reuses tools/qa/retrieval_acceptance.py's Hub client and the same stranger
provisioning (mira-hub/scripts/provision-beta-gate.ts). Prints a markdown table
and writes JSON; exit 0 always (it is a measurement, not a gate) unless
--min-success is given.

  ACCEPT_BASE=https://app-staging.factorylm.com ACCEPT_COOKIE='…' \\
    python3 tools/qa/golden_walk.py --out .planning/golden-walk/run.json
"""

from __future__ import annotations

import argparse
import json
import os
import re
import statistics
import subprocess
import sys
import time
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import quote

sys.path.insert(0, str(Path(__file__).resolve().parent))
from retrieval_acceptance import Hub  # noqa: E402

MACHINES = Path(__file__).resolve().parent / "golden_walk_machines.json"
HUB_DIR = Path(__file__).resolve().parents[2] / "mira-hub"
PROVISION = ["bun", "run", "scripts/provision-beta-gate.ts"]


def provision(base: str, doppler_config: str) -> tuple[str, str]:
    """A fresh stranger (tenant + session cookie) through the same provisioner the
    staging acceptance job uses. The manual search is capped per user per day
    (MANUAL_SEARCH_USER_DAILY_CAP) and registration is limited to 5 per hour
    per IP, so one stranger serves a whole run — size the cap to the run."""
    out = subprocess.run(
        ["doppler", "run", "-p", "factorylm", "-c", doppler_config, "--", *PROVISION],
        cwd=HUB_DIR,
        env={**os.environ, "HUB_BASE": base},
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    env = dict(line[4:].split("=", 1) for line in out.splitlines() if line.startswith("ENV:"))
    return env["BETA_GATE_TENANT"], env["BETA_GATE_COOKIE"]


def cleanup(tenant: str, doppler_config: str) -> None:
    subprocess.run(
        [
            "doppler",
            "run",
            "-p",
            "factorylm",
            "-c",
            doppler_config,
            "--",
            *PROVISION,
            "--cleanup",
            tenant,
        ],
        cwd=HUB_DIR,
        capture_output=True,
        check=False,
    )


def frames_of(
    hub: Hub, notebook_id: str, message: str, source_doc_ids: list[str]
) -> tuple[int, list[dict[str, Any]], float]:
    body = {
        "message": message,
        "sourceDocIds": source_doc_ids,
        "clientRequestId": str(uuid.uuid4()),
    }
    # Mirror NotebookScreen.tsx: an empty scope is sent as an explicit general turn.
    if not source_doc_ids:
        body["mode"] = "general"
    t0 = time.monotonic()
    st, _, raw = hub._req(
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
    return st, frames, time.monotonic() - t0


def first(frames: list[dict[str, Any]], kind: str) -> dict[str, Any]:
    return next((f for f in frames if f.get("kind") == kind), {})


def ready_manuals(sources: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        s
        for s in sources
        if (s.get("readiness") or {}).get("canChat")
        and s.get("enabledByDefault")
        and s.get("sourceRole") == "manual"
    ]


def code_in(text: str, code: str) -> bool:
    """The fault code as a whole token, not a substring: `ov` must not match "overvoltage"."""
    pat = r"\s+".join(re.escape(part) for part in code.split())
    return re.search(rf"(?<![A-Za-z0-9]){pat}(?![A-Za-z0-9])", text, re.I) is not None


def classify(
    expect_manual: bool,
    proposed: bool,
    had_manual: bool,
    truths: list[bool],
    search_message: str | None,
) -> tuple[str, str]:
    """Outcome classes. PASS = a cited answer whose cited passage holds the code and
    its meaning. HONEST_STOP = no citation shown and the search said why (a trust or
    applicability gate working as designed). HONESTY_VIOLATION = a citation that does
    not support the answer, or any citation for a machine that does not exist."""
    if not expect_manual:
        return (
            ("HONESTY_VIOLATION", "citation for a nonexistent machine") if truths else ("PASS", "")
        )
    if truths and any(truths):
        return (
            "PASS",
            "" if had_manual else "cited from the shared library, not the acquired manual",
        )
    if truths:
        return "HONESTY_VIOLATION", "cited passage does not contain the code and its meaning"
    if not proposed:
        return "FAIL", "no_identity_proposal"
    if not had_manual and search_message:
        return "HONEST_STOP", search_message
    if not had_manual:
        return "FAIL", "no_ready_manual"
    return "FAIL", "manual ready but no citation (wrong document or retrieval miss)"


def passage_hits(
    hub: Hub, notebook_id: str, cit: dict[str, Any], m: dict[str, Any]
) -> tuple[bool, str]:
    doc, page = cit.get("docId"), cit.get("page")
    texts = [str(cit.get("quote") or "")]
    if doc:
        q = f"?page={int(page)}" if isinstance(page, int) else ""
        st, _, j = hub.json(
            "GET", f"/api/equipment-notebooks/{notebook_id}/sources/{quote(str(doc))}/passage/{q}"
        )
        if st == 200 and isinstance(j, dict):
            texts += [str(p.get("text") or "") for p in j.get("passages") or []]
    blob = " ".join(texts).lower()
    code_ok = code_in(blob, m["code"])
    meaning_ok = any(k.lower() in blob for k in m["meaning"])
    return (
        code_ok and meaning_ok,
        f"code={'y' if code_ok else 'n'} meaning={'y' if meaning_ok else 'n'} p={page}",
    )


def walk(hub: Hub, m: dict[str, Any], search_timeout: int) -> dict[str, Any]:
    r: dict[str, Any] = {
        "id": m["id"],
        "machine": f"{m['manufacturer']} {m['model']}",
        "expect_manual": m["expect_manual"],
        "steps": {},
    }
    nb = hub.create_notebook(f"GW {m['manufacturer']} {m['model']} {uuid.uuid4().hex[:4]}")
    nid = r["notebook_id"] = nb["id"]

    st, frames, _ = frames_of(hub, nid, m["opener"], [])
    prop = first(frames, "identity_proposal")
    r["steps"]["proposal"] = {
        "http": st,
        "kinds": [f.get("kind") for f in frames],
        "proposal": {k: prop.get(k) for k in ("manufacturer", "model", "catalogNumber")}
        if prop
        else None,
        "search_frame": first(frames, "manual_search_status") or None,
    }

    # "Use its manuals" — only when MIRA proposed a machine, exactly like the phone.
    t_confirm = time.monotonic()
    last_search: dict[str, Any] | None = None
    manuals: list[dict[str, Any]] = []
    if prop:
        cst, _, cj = hub.json(
            "POST",
            f"/api/equipment-notebooks/{nid}/identity/confirm/",
            {
                "manufacturer": prop.get("manufacturer"),
                "model": prop.get("model"),
                "catalogNumber": prop.get("catalogNumber") or "",
            },
        )
        r["steps"]["confirm"] = {
            "http": cst,
            "body": {k: (cj or {}).get(k) for k in ("manualReady", "searching", "error")},
        }
        deadline = time.monotonic() + search_timeout
        polls, all_sources = 0, None
        while cst == 200:
            gst, _, g = hub.json("GET", f"/api/equipment-notebooks/{nid}/")
            polls += 1
            if gst == 200 and isinstance(g, dict):
                last_search = g.get("manualSearch")
                manuals = ready_manuals(g.get("sources") or [])
                all_sources = [
                    {
                        k: s.get(k)
                        for k in (
                            "docId",
                            "filename",
                            "status",
                            "matchState",
                            "sourceRole",
                            "enabledByDefault",
                        )
                    }
                    | {"canChat": (s.get("readiness") or {}).get("canChat")}
                    for s in g.get("sources") or []
                ]
                if manuals or (last_search is not None and not last_search.get("running")):
                    break
            if time.monotonic() > deadline:
                break
            time.sleep(5)
        r["steps"]["search"] = {
            "polls": polls,
            "seconds": round(time.monotonic() - t_confirm, 1),
            "final": last_search,
            "sources": all_sources,
        }

    # Always ask: a missing proposal or manual must still be checked for an honest answer.
    doc_ids = [str(s["docId"]) for s in manuals]
    st, frames, ask_s = frames_of(hub, nid, m["ask"], doc_ids)
    cits = first(frames, "sources").get("citations") or []
    status = first(frames, "status").get("status")
    content = "".join(f.get("content", "") for f in frames if f.get("kind") == "content")
    truths = [passage_hits(hub, nid, c, m) for c in cits]
    r["steps"]["ask"] = {
        "http": st,
        "seconds": round(ask_s, 1),
        "source_doc_ids": doc_ids,
        "citations": [
            {
                "title": c.get("sourceTitle"),
                "page": c.get("page"),
                "docId": c.get("docId"),
                "truth": t[1],
                "quote": str(c.get("quote") or "")[:240],
            }
            for c, t in zip(cits, truths)
        ],
        "status": status,
        "answer_head": content[:400],
    }
    r["time_to_cited_answer_s"] = round(time.monotonic() - t_confirm, 1)
    r["outcome"], r["cause"] = classify(
        m["expect_manual"],
        bool(prop),
        bool(manuals),
        [t[0] for t in truths],
        (last_search or {}).get("message"),
    )
    return r


def table(rows: list[dict[str, Any]]) -> str:
    out = [
        "| Machine | Outcome | Cause | Search s | Cited answer s | Citations |",
        "|---|---|---|---|---|---|",
    ]
    for r in rows:
        s = r["steps"]
        cits = (
            "; ".join(
                f"p{c['page']} {c['truth']}" for c in (s.get("ask") or {}).get("citations", [])
            )
            or "—"
        )
        out.append(
            f"| {r['machine']}{'' if r['expect_manual'] else ' (honesty)'} | {r['outcome']} | {r.get('cause', '')} | {(s.get('search') or {}).get('seconds', '—')} | {r.get('time_to_cited_answer_s', '—')} | {cits} |"
        )
    return "\n".join(out)


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Golden Walk — manual-first journey against a deployed Hub"
    )
    ap.add_argument("--base", default=os.environ.get("ACCEPT_BASE", ""))
    ap.add_argument("--cookie", default=os.environ.get("ACCEPT_COOKIE", ""))
    ap.add_argument("--only", default="", help="comma-separated machine ids")
    ap.add_argument("--search-timeout", type=int, default=240)
    ap.add_argument("--out", default="")
    ap.add_argument(
        "--fresh-tenant",
        default="",
        metavar="DOPPLER_CONFIG",
        help="provision one new stranger for the run (and sweep it after) via mira-hub's provisioner, e.g. stg",
    )
    ap.add_argument(
        "--min-success",
        type=int,
        default=0,
        help="exit 1 below this many PASS of the expect_manual rows",
    )
    a = ap.parse_args()
    if not a.base or not (a.cookie or a.fresh_tenant):
        print("ACCEPT_BASE and ACCEPT_COOKIE are required", file=sys.stderr)
        return 2
    tenant = None
    if a.fresh_tenant:
        tenant, cookie = provision(a.base, a.fresh_tenant)
        a.cookie = cookie
    hub = Hub(a.base, a.cookie, timeout=240)
    machines = json.loads(MACHINES.read_text())["machines"]
    if a.only:
        want = set(a.only.split(","))
        machines = [m for m in machines if m["id"] in want]
    rows = []
    for m in machines:
        try:
            r = walk(hub, m, a.search_timeout)
        except Exception as e:  # a crashed walk is a measured failure, not a harness abort
            r = {
                "id": m["id"],
                "machine": f"{m['manufacturer']} {m['model']}",
                "expect_manual": m["expect_manual"],
                "steps": {},
                "outcome": "FAIL",
                "cause": f"harness_error: {e}"[:300],
            }
        rows.append(r)
        print(f"{r['outcome']:4} {r['machine']}: {r.get('cause', '')}", flush=True)
    if tenant:
        cleanup(tenant, a.fresh_tenant)
    real = [r for r in rows if r["expect_manual"]]
    passed = [r for r in real if r["outcome"] == "PASS"]
    times = [r["time_to_cited_answer_s"] for r in passed if "time_to_cited_answer_s" in r]
    summary = {
        "base": a.base,
        "ran_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "journey_success": f"{len(passed)}/{len(real)}",
        "median_time_to_cited_answer_s": statistics.median(times) if times else None,
        "honesty": all(r["outcome"] == "PASS" for r in rows if not r["expect_manual"]),
        "honest_stops": sum(1 for r in real if r["outcome"] == "HONEST_STOP"),
        "honesty_violations": sum(1 for r in rows if r["outcome"] == "HONESTY_VIOLATION"),
        "rows": rows,
    }
    print("\n" + table(rows))
    print(
        f"\njourney_success={summary['journey_success']} median_s={summary['median_time_to_cited_answer_s']} honesty={summary['honesty']}"
    )
    if a.out:
        Path(a.out).parent.mkdir(parents=True, exist_ok=True)
        Path(a.out).write_text(json.dumps(summary, indent=2))
    return 1 if a.min_success and len(passed) < a.min_success else 0


if __name__ == "__main__":
    sys.exit(main())
