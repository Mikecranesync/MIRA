"""Ask real questions in a notebook and assert on the answers — the fast post-deploy
retest for a chat fix (staging first, then the same build on production).

Drives only the public Hub APIs the apps use. Reuses sign-in, SSE parsing and the
PDF builder from `tests/beta/_notebook_probe.py`.

Two modes:
  --notebook <id>        ask in an EXISTING notebook (its chat-ready sources).
  --manual-page "text"   (repeatable, one per PDF page) create a run-owned throwaway
                         notebook, upload that tiny manual, confirm it, wait until
                         chat-ready, ask, then delete everything it created.

    # staging, self-contained (cookie from mira-hub/scripts/provision-beta-gate.ts)
    BETA_PROBE_COOKIE=… python tools/qa/notebook_ask_probe.py \
      --base https://app-staging.factorylm.com \
      --manual-page "Fault F004 overcurrent. To reset the fault press RESET …" \
      --ask "The drive tripped on fault F004. How do I reset the fault?" \
      --control "What does fault F004 mean?" \
      --expect "Before you reset or restart" --out /tmp/retest.json

Auth: BETA_PROBE_COOKIE, or BETA_PROBE_EMAIL + BETA_PROBE_PASSWORD.
Each --ask turn must be HTTP 200 and contain every --expect string; each --control
turn must be HTTP 200 and contain none. A refused --ask turn fails (the fix was
not exercised), so green means the behaviour was observed, not merely deployed.
Exit 0 = all pass, 1 = a check failed, 2 = could not run (auth / setup / cleanup).
"""

from __future__ import annotations

import argparse
import json
import os
import secrets
import sys
import time
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "tests" / "beta"))
from _notebook_probe import ProbeConfig, _chat, _pdf, _sign_in  # noqa: E402


def _sources(client: httpx.Client, h: dict[str, str], nb: str) -> list[dict]:
    r = client.get(f"/api/equipment-notebooks/{nb}/", headers=h)
    r.raise_for_status()
    return r.json().get("sources", [])


def _ready_doc_ids(client: httpx.Client, h: dict[str, str], nb: str) -> list[str]:
    return [
        s["docId"]
        for s in _sources(client, h, nb)
        if (s.get("readiness") or {}).get("canChat") and s.get("docId")
    ]


class Fixture:
    """Run-owned notebook + uploaded manual; `close()` deletes all of it."""

    def __init__(self, client: httpx.Client, h: dict[str, str], pages: list[str]):
        self.c, self.h = client, h
        self.notebook = self.node = self.doc = self.file = None
        run = secrets.token_hex(4)
        r = client.post(
            "/api/equipment-notebooks/",
            json={
                "displayName": f"Retest {run}",
                "manufacturer": "FactoryLM",
                "model": f"RT-{run}",
            },
            headers=h,
        )
        if r.status_code != 201:
            raise RuntimeError(f"notebook create HTTP {r.status_code}")
        nb = r.json()["notebook"]
        self.notebook, self.node = nb["id"], nb.get("nodeId")
        pdf = _pdf([[f"FactoryLM retest manual {run}"] + _wrap(p) for p in pages])
        r = client.post(
            f"/api/namespace/node/{self.node}/files/",
            files={"file": (f"retest-{run}.pdf", pdf, "application/pdf")},
            headers=h,
        )
        body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
        self.doc, self.file = body.get("uploadId"), body.get("fileId")
        if r.status_code != 201 or not self.doc:
            raise RuntimeError(f"upload HTTP {r.status_code}")
        r = client.post(
            f"/api/equipment-notebooks/{self.notebook}/sources/",
            json={"docId": self.doc, "sourceRole": "manual"},
            headers=h,
        )
        if r.status_code != 201:
            raise RuntimeError(f"source confirm HTTP {r.status_code}")
        deadline = time.monotonic() + 240
        while time.monotonic() < deadline:
            src = next(
                (s for s in _sources(client, h, self.notebook) if s.get("docId") == self.doc), {}
            )
            rd = src.get("readiness") or {}
            if rd.get("canChat"):
                return
            if rd.get("state") in ("failed", "needs_ocr"):
                raise RuntimeError(f"manual readiness {rd.get('state')}")
            time.sleep(3)
        raise RuntimeError("manual never became chat-ready")

    def close(self) -> list[str]:
        problems, paths = [], []
        if self.file:
            fr = self.c.get(f"/api/files/{self.file}/", headers=self.h)
            if fr.status_code == 200:
                for ln in fr.json().get("links") or []:
                    if ln.get("id"):
                        paths.append(f"/api/files/{self.file}/links/{ln['id']}/")
        if self.notebook:
            paths.append(f"/api/equipment-notebooks/{self.notebook}/")
        if self.doc:
            paths.append(f"/api/uploads/{self.doc}/")
        if self.file:
            paths.append(f"/api/files/{self.file}/")
        if self.node:
            paths.append(f"/api/namespace/node/{self.node}/")
        for p in paths:
            code = self.c.delete(p, headers=self.h).status_code
            if not (200 <= code < 300 or code == 404):
                problems.append(f"DELETE {p} -> {code}")
        return problems


def _wrap(text: str, width: int = 80) -> list[str]:
    lines, cur = [], ""
    for w in text.split():
        if len(cur) + len(w) + 1 > width:
            lines.append(cur)
            cur = w
        else:
            cur = f"{cur} {w}".strip()
    return lines + ([cur] if cur else [])


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--base", required=True, help="Hub origin, e.g. https://app.factorylm.com")
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--notebook", help="existing notebook id")
    src.add_argument("--manual-page", action="append", help="page text for a throwaway manual")
    ap.add_argument("--ask", action="append", default=[], help="question that must show the fix")
    ap.add_argument("--control", action="append", default=[], help="question that must NOT")
    ap.add_argument("--expect", action="append", required=True, help="text the fix must produce")
    ap.add_argument("--out", default=None, help="write the JSON evidence here")
    a = ap.parse_args(argv)

    cfg = ProbeConfig(
        hub_base=a.base.rstrip("/"),
        cookie=os.getenv("BETA_PROBE_COOKIE") or None,
        email=os.getenv("BETA_PROBE_EMAIL") or None,
        password=os.getenv("BETA_PROBE_PASSWORD") or None,
    )
    rows, failed, fixture, cleanup = [], 0, None, []
    with httpx.Client(base_url=cfg.hub_base, timeout=180, follow_redirects=True) as client:
        try:
            cookie = cfg.cookie or _sign_in(client, cfg)
            token = cookie.split("session-token=", 1)[-1]
            # Production over HTTPS reads the __Secure- prefixed name; send both.
            h = {
                "cookie": f"next-auth.session-token={token}; __Secure-next-auth.session-token={token}"
            }
            health = client.get("/api/health/").json()
            if a.manual_page:
                fixture = Fixture(client, h, a.manual_page)
                nb = str(fixture.notebook)
            else:
                nb = str(a.notebook)
            docs = _ready_doc_ids(client, h, nb)
            if not docs:
                raise RuntimeError("notebook has no chat-ready sources")

            for role, questions in (("ask", a.ask), ("control", a.control)):
                for q in questions:
                    f = _chat(client, h, nb, q, docs)
                    text = f.content or ""
                    hits = [e for e in a.expect if e in text]
                    want = len(a.expect) if role == "ask" else 0
                    ok = f.http_status == 200 and len(hits) == want
                    failed += not ok
                    rows.append(
                        {
                            "role": role,
                            "question": q,
                            "pass": ok,
                            "http": f.http_status,
                            "status": f.status,
                            "expect_hits": hits,
                            "citations": len(f.citations or []),
                            "answer_head": text[:400],
                        }
                    )
                    print(
                        f"{'PASS' if ok else 'FAIL'} [{role}] http={f.http_status} "
                        f"hits={len(hits)}/{len(a.expect)} cites={len(f.citations or [])} :: {q}"
                    )
        except (httpx.HTTPError, RuntimeError, ValueError, KeyError) as e:
            print(f"UNAVAILABLE: {type(e).__name__}: {e}", file=sys.stderr)
            if fixture:
                fixture.close()
            return 2
        if fixture:
            cleanup = fixture.close()

    verdict = "PASS" if not failed and not cleanup else "FAIL"
    report = {
        "base": cfg.hub_base,
        "gitSha": health.get("gitSha"),
        "version": health.get("version"),
        "mode": "fixture" if fixture else "existing",
        "results": rows,
        "cleanup_problems": cleanup,
        "verdict": verdict,
    }
    if a.out:
        Path(a.out).write_text(json.dumps(report, indent=2))
    print(
        f"{verdict}: {len(rows) - failed}/{len(rows)} on {report['version']} {str(report['gitSha'])[:8]}"
    )
    for p in cleanup:
        print(f"CLEANUP: {p}")
    if failed:
        return 1
    return 2 if cleanup else 0


if __name__ == "__main__":
    sys.exit(main())
