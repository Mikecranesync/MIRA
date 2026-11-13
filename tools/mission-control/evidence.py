"""Gather lifecycle evidence for mission control v2 — read-only GitHub + env reads.

post(body) is the GraphQL poster (board.QUERY style); get(url, headers) returns
(status, headers, json). Only comments by trusted (owner) accounts count as ledgers,
follow-ups or field-verification markers. Everything degrades to "not proven".
"""

from __future__ import annotations

import datetime as dt
import hashlib
import importlib.util
import logging
import sys
from pathlib import Path
from typing import Callable, Optional

log = logging.getLogger("mission-control.evidence")
API = "https://api.github.com"


def _load(name: str):
    found = sys.modules.get(f"mission_control_{name}")
    if found is not None:
        return found
    spec = importlib.util.spec_from_file_location(
        f"mission_control_{name}", Path(__file__).resolve().parent / f"{name}.py"
    )
    mod = importlib.util.module_from_spec(spec)  # type: ignore[arg-type]
    sys.modules[spec.name] = mod  # type: ignore[union-attr]
    spec.loader.exec_module(mod)  # type: ignore[union-attr]
    return mod


lifecycle = _load("lifecycle")

PR_FIELDS = (
    "number title url state body headRefOid mergeCommit { oid } "
    "commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }"
)


def pr_query(owner: str, name: str, numbers: list[int]) -> str:
    aliases = " ".join(f"pr{n}: pullRequest(number: {n}) {{ {PR_FIELDS} }}" for n in numbers)
    return f'query {{ repository(owner: "{owner}", name: "{name}") {{ {aliases} }} }}'


def fetch_prs(post: Callable[[dict], dict], repo: str, numbers: list[int]) -> dict[int, dict]:
    """number -> item; a candidate the query could not resolve maps to {"error": ...} unless
    GitHub says NOT_FOUND (an issue number, not a PR), which is simply absent."""
    if not numbers:
        return {}
    if len(numbers) > 25:  # one query per 25 aliases; never drop a candidate
        out: dict[int, dict] = {}
        for i in range(0, len(numbers), 25):
            out.update(fetch_prs(post, repo, numbers[i : i + 25]))
        return out
    owner, name = repo.split("/", 1)
    data = post({"query": pr_query(owner, name, numbers), "variables": {}})
    if data.get("errors") and not data.get("data"):
        raise RuntimeError(str(data["errors"])[:200])
    failed: dict[int, str] = {}
    for err in data.get("errors") or []:
        alias = str((err.get("path") or ["", ""])[-1])
        if alias.startswith("pr") and alias[2:].isdigit() and err.get("type") != "NOT_FOUND":
            failed[int(alias[2:])] = f"{err.get('type', 'ERROR')}: {err.get('message', '')}"[:160]
    out: dict[int, dict] = {}
    for n in numbers:
        pr = ((data.get("data") or {}).get("repository") or {}).get(f"pr{n}")
        if not pr:
            if n in failed:
                out[n] = {"number": n, "error": failed[n]}
            continue
        nodes = (pr.get("commits") or {}).get("nodes") or []
        rollup = ((nodes[0].get("commit") or {}).get("statusCheckRollup") or {}) if nodes else {}
        out[n] = {
            "number": n,
            "title": pr.get("title"),
            "url": pr.get("url"),
            "kind": "pr",
            "state": pr.get("state"),
            "head_sha": pr.get("headRefOid"),
            "merge_sha": (pr.get("mergeCommit") or {}).get("oid"),
            "body_sha256": hashlib.sha256((pr.get("body") or "").encode()).hexdigest(),
            "rollup": {"state": rollup.get("state"), "sha": pr.get("headRefOid")},
        }
    return out


def fetch_comments(get, repo: str, number: int) -> list[dict]:
    """Every comment, or RuntimeError: a truncated read must never pass as complete."""
    out, page = [], 1
    while True:
        url = f"{API}/repos/{repo}/issues/{number}/comments?per_page=100&page={page}"
        status, _h, body = get(url, headers={"Accept": "application/vnd.github+json"})
        if status != 200 or not isinstance(body, list):
            raise RuntimeError(f"comments page {page}: {status}")
        out.extend(body)
        if len(body) < 100:
            return out
        page += 1


def markers(comments: list[dict], trusted: tuple[str, ...]) -> dict:
    """Owner-only ledgers/follow-ups/markers; `seq` keeps the comment order for recency rules."""
    ledgers, followups, verified = [], [], []
    for seq, c in enumerate(comments):
        if ((c.get("user") or {}).get("login") or "") not in trusted:
            continue
        body = c.get("body") or ""
        led = lifecycle.parse_ledger(body)
        if led:
            led["url"], led["seq"] = c.get("html_url"), seq
            ledgers.append(led)
            continue
        fu = lifecycle.followups(body)
        if fu:
            followups.append(dict(fu, seq=seq))
            continue
        fv = lifecycle.field_verified_sha(body)
        if fv:
            verified.append(fv)
    return {"ledgers": ledgers, "followups": followups, "field_verified": verified}


def env_version(get, url: str) -> dict:
    now = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    try:
        status, _h, body = get(url, headers={"Accept": "application/json"})
    except Exception as exc:  # unreachable host, timeout, TLS: all read as "not proven"
        log.info("env %s unreachable: %s", url, exc)
        status, body = 0, None
    ok = status == 200 and isinstance(body, dict) and bool(body.get("gitSha"))
    return {
        "git_sha": body.get("gitSha") if ok else None,
        "built_at": body.get("builtAt") if ok else None,
        "ok": 1 if ok else 0,
        "fetched_at": now,
        "url": url,
        "behind_by": None,
    }


def behind(get, repo: str, base: Optional[str], head: Optional[str]) -> Optional[int]:
    """How many commits `base` has that `head` lacks (0 = head contains base)."""
    if not base or not head:
        return None
    status, _h, body = get(f"{API}/repos/{repo}/compare/{base}...{head}", headers={})
    if status != 200 or not isinstance(body, dict) or "behind_by" not in body:
        return None
    return int(body["behind_by"])


def gather(
    post,
    get,
    repo: str,
    candidates: list[int],
    envs: dict[str, str],
    trusted: tuple[str, ...],
    reports_by_item: Optional[dict[int, list[dict]]] = None,
    main_sha: Optional[str] = None,
) -> dict:
    """Return {"rows": [lifecycle.derive(...)...], "envs": {...}, "at": iso, "error": str|None}."""
    at = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    env_rows = {name: env_version(get, url) for name, url in envs.items()}
    for name, row in env_rows.items():
        row["behind_by"] = behind(get, repo, main_sha, row["git_sha"]) if main_sha else None
    try:
        prs = fetch_prs(post, repo, candidates)
    except Exception as exc:
        log.warning("evidence fetch failed: %s", exc)
        return {"rows": [], "envs": env_rows, "at": at, "error": f"{type(exc).__name__}: {exc}"}
    rows = []
    for n in candidates:
        item = prs.get(n)
        if not item:
            continue
        ev: dict = {"ledgers": [], "followups": [], "field_verified": [], "envs": {}}
        error = item.get("error")
        if not error:
            try:
                ev = markers(fetch_comments(get, repo, n), trusted)
            except RuntimeError as exc:  # incomplete read: the row stays unproven, never certified
                error = str(exc)
        ev["reports"] = (reports_by_item or {}).get(n, [])
        if not error:
            ev["envs"] = {
                name: dict(row, behind_by=behind(get, repo, item.get("merge_sha"), row["git_sha"]))
                for name, row in env_rows.items()
            }
        row = lifecycle.derive(item, ev)
        row["title"], row["url"], row["state"] = (
            item.get("title"),
            item.get("url"),
            item.get("state"),
        )
        if error:
            row["error"] = error
            row["cells"] = {
                s: lifecycle._cell(False, "evidence incomplete") for s in lifecycle.STATES
            }
        rows.append(row)
    return {"rows": rows, "envs": env_rows, "at": at, "error": None}
