"""Cross-tenant isolation probe — can customer B reach customer A's notebook, manual,
cited passage, chat or files on a deployed Hub? (readiness board gate 7).

Two pre-existing sessions (e.g. two strangers from
`mira-hub/scripts/provision-beta-gate.ts` on STAGING):

    TENANT_A_COOKIE=… TENANT_B_COOKIE=… python tools/qa/tenant_isolation_probe.py \
      --base https://app-staging.factorylm.com --out /tmp/isolation.json

A uploads a run-unique manual carrying a secret SENTINEL phrase, confirms it,
chats about it (control: A must get 2xx and see the sentinel). B then tries
every read, write and injection door with A's ids. Each B attempt PASSES only
if it is refused (>=400, or 2xx with none of A's ids / sentinel in the body).
Unauthenticated attempts must be refused too. A's data is re-read at the end to
prove B's delete attempts changed nothing. Run-owned rows are deleted.

Exit 0 = isolation held everywhere, 1 = a leak / unrefused write, 2 = could not run.
"""

from __future__ import annotations

import argparse
import json
import os
import secrets
import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "tests" / "beta"))
from _notebook_probe import _chat  # noqa: E402
from notebook_ask_probe import Fixture  # noqa: E402


def _hdr(raw: str) -> dict[str, str]:
    t = raw.split("session-token=", 1)[-1]
    return {"cookie": f"next-auth.session-token={t}; __Secure-next-auth.session-token={t}"}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--base", required=True)
    ap.add_argument("--out", default=None)
    ap.add_argument(
        "--self-test",
        action="store_true",
        help="add one deliberately wrong check (A must be refused its own notebook); the run must FAIL",
    )
    a = ap.parse_args(argv)
    ca, cb = os.getenv("TENANT_A_COOKIE", ""), os.getenv("TENANT_B_COOKIE", "")
    if not ca or not cb or ca == cb:
        print("UNAVAILABLE: need two distinct TENANT_A_COOKIE / TENANT_B_COOKIE", file=sys.stderr)
        return 2
    A, B, NONE = _hdr(ca), _hdr(cb), {}
    sentinel = f"ISOLATION-{secrets.token_hex(6).upper()}"
    rows: list[dict] = []
    fa = fb = None

    with httpx.Client(base_url=a.base.rstrip("/"), timeout=180, follow_redirects=False) as c:
        try:
            health = c.get("/api/health/").json()
            fa = Fixture(
                c,
                A,
                [
                    f"Section 4 Coupling. Secret calibration phrase {sentinel}: "
                    f"tighten the coupling bolts to 77 newton meters."
                ],
            )
            fb = Fixture(c, B, ["Section 1 General. This unit is a conveyor gearbox."])
            nb, doc, fid, node = fa.notebook, fa.doc, fa.file, fa.node
            q = "What is the secret calibration phrase and the coupling bolt torque?"
            fr = _chat(c, A, nb, q, [doc])
            if sentinel not in (fr.content or ""):
                raise RuntimeError(
                    f"control failed: A's own answer lacks the sentinel (http {fr.http_status})"
                )
            det = c.get(f"/api/equipment-notebooks/{nb}/", headers=A).json()
            thread = next((t.get("id") for t in det.get("threads") or [] if t.get("id")), None)
        except (httpx.HTTPError, RuntimeError, ValueError, KeyError) as e:
            print(f"UNAVAILABLE: setup: {type(e).__name__}: {e}", file=sys.stderr)
            for f in (fa, fb):
                if f:
                    f.close()
            return 2

        secrets_in_body = [sentinel, str(nb), str(doc), str(fid), str(node)] + (
            [str(thread)] if thread else []
        )

        def probe(
            name: str,
            method: str,
            path: str,
            actor: str,
            body: dict | None = None,
            must: str = "refuse",
            files: dict | None = None,
        ) -> None:
            h = {"A": A, "B": B, "anon": NONE}[actor]
            r = c.request(method, path, headers=h, json=None if files else body, files=files)
            text = (
                r.text
                if "pdf" not in r.headers.get("content-type", "")
                else ("<pdf bytes>" if r.status_code < 300 else r.text)
            )
            leaked = [s for s in secrets_in_body if s and s in text]
            is_pdf = "application/pdf" in r.headers.get("content-type", "")
            if must == "allow":
                ok = r.status_code < 300
            elif must == "no-leak":  # B's own surfaces: 2xx fine, A's ids/sentinel must not appear
                ok = r.status_code < 500 and not leaked and not is_pdf
            else:
                ok = r.status_code >= 400 and not leaked and not is_pdf
            rows.append(
                {
                    "name": name,
                    "actor": actor,
                    "method": method,
                    "path": path.replace(str(nb), "{nbA}")
                    .replace(str(doc), "{docA}")
                    .replace(str(fid), "{fileA}")
                    .replace(str(node), "{nodeA}")
                    .replace(str(thread), "{threadA}"),
                    "expect": must,
                    "http": r.status_code,
                    "leaked": [x == sentinel and "SENTINEL" or "A-id" for x in leaked],
                    "pdf": is_pdf,
                    "pass": ok,
                }
            )
            print(
                f"{'PASS' if ok else 'FAIL'} {actor:4} {method:6} {rows[-1]['path']:<62} http={r.status_code} leak={bool(leaked)} {name}"
            )

        nbB = fb.notebook
        if a.self_test:
            probe(
                "SELF-TEST: A refused own notebook (must FAIL)",
                "GET",
                f"/api/equipment-notebooks/{nb}/",
                "A",
            )
        # control — A reaches its own data
        probe("A reads own notebook", "GET", f"/api/equipment-notebooks/{nb}/", "A", must="allow")
        probe(
            "A reads own cited passage",
            "GET",
            f"/api/equipment-notebooks/{nb}/sources/{doc}/passage/?page=1",
            "A",
            must="allow",
        )
        probe("A opens own PDF", "GET", f"/api/namespace/files/{fid}/", "A", must="allow")
        # B — direct reads of A's records
        probe("B reads A notebook", "GET", f"/api/equipment-notebooks/{nb}/", "B")
        if thread:
            probe(
                "B reads A thread", "GET", f"/api/equipment-notebooks/{nb}/?threadId={thread}", "B"
            )
        probe(
            "B reads A cited passage",
            "GET",
            f"/api/equipment-notebooks/{nb}/sources/{doc}/passage/?page=1",
            "B",
        )
        probe("B reads A source row", "GET", f"/api/equipment-notebooks/{nb}/sources/{doc}/", "B")
        probe("B opens A PDF bytes", "GET", f"/api/namespace/files/{fid}/", "B")
        probe("B reads A file record", "GET", f"/api/files/{fid}/", "B")
        probe("B reads A upload", "GET", f"/api/uploads/{doc}/", "B")
        probe("B reads A node", "GET", f"/api/namespace/node/{node}/", "B")
        probe("B reads A node files", "GET", f"/api/namespace/node/{node}/files/", "B")
        probe(
            "B reads A turn diagnostics",
            "GET",
            f"/api/equipment-notebooks/{nb}/turns/diagnostics/",
            "B",
        )
        # B — acting on A's records
        probe(
            "B chats in A notebook",
            "POST",
            f"/api/equipment-notebooks/{nb}/chat/",
            "B",
            {"message": q, "sourceDocIds": [doc], "history": []},
        )
        probe(
            "A chats on own node (control)",
            "POST",
            f"/api/namespace/node/{node}/chat/",
            "A",
            {"messages": [{"role": "user", "content": q}]},
            must="allow",
        )
        probe(
            "B chats on A node",
            "POST",
            f"/api/namespace/node/{node}/chat/",
            "B",
            {"messages": [{"role": "user", "content": q}]},
        )
        probe(
            "B attaches A doc to own notebook",
            "POST",
            f"/api/equipment-notebooks/{nbB}/sources/",
            "B",
            {"docId": doc, "sourceRole": "manual"},
        )
        probe(
            "B asks own notebook citing A doc",
            "POST",
            f"/api/equipment-notebooks/{nbB}/chat/",
            "B",
            {"message": q, "sourceDocIds": [doc], "history": []},
            must="no-leak",
        )
        probe(
            "B uploads into A node",
            "POST",
            f"/api/namespace/node/{node}/files/",
            "B",
            files={"file": ("intrude.pdf", b"%PDF-1.4 intrude", "application/pdf")},
        )
        # B — its own list/search surfaces must not surface A
        for path in (
            "/api/equipment-notebooks/",
            "/api/conversations/",
            "/api/documents/?limit=200",
            "/api/namespace/tree/",
            "/api/uploads/",
        ):
            probe(f"B list {path}", "GET", path, "B", must="no-leak")
        # anonymous
        probe("anon reads A notebook", "GET", f"/api/equipment-notebooks/{nb}/", "anon")
        probe("anon opens A PDF", "GET", f"/api/namespace/files/{fid}/", "anon")
        probe(
            "anon reads A passage",
            "GET",
            f"/api/equipment-notebooks/{nb}/sources/{doc}/passage/?page=1",
            "anon",
        )
        # B — destructive attempts, then prove A is intact
        probe("B deletes A notebook", "DELETE", f"/api/equipment-notebooks/{nb}/", "B")
        probe("B deletes A upload", "DELETE", f"/api/uploads/{doc}/", "B")
        probe("B deletes A file", "DELETE", f"/api/namespace/files/{fid}/", "B")
        probe("B deletes A node", "DELETE", f"/api/namespace/node/{node}/", "B")
        probe(
            "A notebook intact after B deletes",
            "GET",
            f"/api/equipment-notebooks/{nb}/",
            "A",
            must="allow",
        )
        probe(
            "A PDF intact after B deletes", "GET", f"/api/namespace/files/{fid}/", "A", must="allow"
        )
        fr2 = _chat(c, A, nb, q, [doc])
        ok = sentinel in (fr2.content or "")
        rows.append(
            {
                "name": "A still gets cited answer after B attacks",
                "actor": "A",
                "pass": ok,
                "http": fr2.http_status,
            }
        )
        print(f"{'PASS' if ok else 'FAIL'} A     chat still answers with its own manual")

        cleanup = (fa.close() if fa else []) + (fb.close() if fb else [])

    failed = [r for r in rows if not r["pass"]]
    report = {
        "base": a.base,
        "gitSha": health.get("gitSha"),
        "version": health.get("version"),
        "checks": len(rows),
        "failed": len(failed),
        "cleanup_problems": cleanup,
        "results": rows,
        "verdict": "PASS" if not failed else "FAIL",
    }
    if a.out:
        Path(a.out).write_text(json.dumps(report, indent=2))
    print(
        f"{report['verdict']}: {len(rows) - len(failed)}/{len(rows)} on {report['version']} {str(report['gitSha'])[:8]}"
    )
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
