"""Read-only projection of a versioned capability plan and its acceptance ledger."""
from __future__ import annotations

import base64
import datetime as dt
import hashlib
import json
import logging
import posixpath
import re

log = logging.getLogger("mission-control.workflow")
ROADMAP = "docs/plans/capability-roadmap.md"
SHA = re.compile(r"[0-9a-f]{40}")
CHECK_ID = re.compile(r"[A-Z][A-Z0-9-]*-\d+")
STATES = {"PASS", "FAIL", "BLOCKED", "NOT TESTED"}
PLAN_PATH = re.compile(r"[a-z0-9][a-z0-9-]*\.md")
BLOCK = re.compile(r"^```capability-results\s*\n(.*?)\n```\s*$", re.M | re.S)


def _tokens(markdown):
    # Lazy import keeps the existing cockpit usable if workflow dependencies are missing.
    from markdown_it import MarkdownIt

    return MarkdownIt("js-default", {"html": False}).parse(markdown)


def _plain(token):
    return "".join(
        " " if child.type in {"softbreak", "hardbreak"} else child.content
        for child in token.children or []
        if child.type in {"text", "code_inline", "softbreak", "hardbreak"}
    ).strip()


def _section(tokens, names):
    headings = [i for i, t in enumerate(tokens) if t.type == "heading_open" and t.tag == "h2"]
    for start, end in zip(headings, headings[1:] + [len(tokens)]):
        if _plain(tokens[start + 1]) in names:
            return tokens[start + 3:end]
    return []


def _table(tokens):
    """Extract the first table's body cells using Markdown tokens, not pipe splitting."""
    rows = []
    reading = False
    for token in tokens:
        if token.type == "tbody_open":
            reading = True
        if token.type == "table_close":
            break
        if reading and token.type == "tr_open":
            rows.append([])
        if reading and token.type == "inline" and rows:
            rows[-1].append(token)
    return rows


def _links(token):
    return [c.attrGet("href") for c in token.children or [] if c.type == "link_open"]


def load_documents(read, repo, revision):
    road = _tokens(read(ROADMAP))
    steps, current, seen = [], None, set()
    for cells in _table(_section(road, {"Capability sequence"})):
        if len(cells) != 4:
            raise ValueError("Invalid capability row")
        number, name, outcome, proof = map(_plain, cells)
        match = re.fullmatch(r"(\d+)( — current)?", number)
        if not match or not name or not outcome or not proof:
            raise ValueError("Invalid capability definition")
        number = int(match[1])
        if number in seen:
            raise ValueError("Duplicate capability number")
        seen.add(number)
        step = {"number": number, "name": name, "outcome": outcome, "proof": proof}
        steps.append(step)
        if match[2]:
            paths = [href for href in _links(cells[3]) if href and PLAN_PATH.fullmatch(href)]
            if current or len(paths) != 1:
                raise ValueError("The roadmap must name one current step with one local plan link")
            current = step
            path = posixpath.join(posixpath.dirname(ROADMAP), paths[0])
    if current is None or [s["number"] for s in steps] != sorted(seen):
        raise ValueError("Missing current capability or unordered roadmap")
    detail = _tokens(read(path))
    checks = []
    for cells in _table(_section(detail, {"Pass/fail contract", "Acceptance contract"})):
        if len(cells) < 3:
            raise ValueError("Invalid acceptance row")
        rid, expected, proof = map(_plain, cells[:3])
        if not CHECK_ID.fullmatch(rid) or not expected or not proof:
            raise ValueError("Invalid acceptance definition")
        checks.append({"id": rid, "expected": expected, "proof": proof})
    if not checks or len({row["id"] for row in checks}) != len(checks):
        raise ValueError("Missing or duplicate acceptance checks")
    action_section = _section(detail, {"Implement and verify in this order", "Work sequence"})
    actions = [_plain(t) for t in action_section if t.type == "inline"]
    owner_section = _section(detail, {"Existing owners and next deliverables"})
    owners = [{"name": _plain(c[0]), "deliverable": _plain(c[1])}
              for c in _table(owner_section) if len(c) >= 2]
    root = f"https://github.com/{repo}/blob/{revision}/"
    return {"revision": revision, "roadmap_url": root + ROADMAP, "plan_url": root + path,
            "steps": steps, "current": current, "checks": checks, "actions": actions, "owners": owners}


def refresh(old, get, repo, pin=None, now=None):
    """Publish both documents atomically. Keep the prior revision and clock on failure."""
    try:
        root = f"https://api.github.com/repos/{repo}"
        if pin is None:
            status, _, main = get(root + "/commits/main", headers={})
            pin_sha = main.get("sha") if status == 200 and isinstance(main, dict) else None
        else:
            pin_sha = pin
        if not isinstance(pin_sha, str) or not SHA.fullmatch(pin_sha):
            raise ValueError("Plan revision unavailable")
        docs = old.get("documents")
        if not docs or old.get("source_sha") != pin_sha:
            source_hashes = []
            def read(path):
                status, _, result = get(f"{root}/contents/{path}?ref={pin_sha}", headers={})
                if status != 200 or not isinstance(result, dict) or result.get("encoding") != "base64":
                    raise ValueError("Plan document unavailable")
                content = result.get("content")
                if not isinstance(content, str) or len(content) > 180_000:
                    raise ValueError("Invalid plan document size")
                decoded = base64.b64decode("".join(content.split()), validate=True)
                source_hashes.append(hashlib.sha256(decoded).hexdigest())
                return decoded.decode("utf-8")

            new_docs = load_documents(read, repo, pin_sha)
            if not docs or docs.get("source_hashes") != source_hashes or old.get("proposed") != (pin is not None):
                docs = {**new_docs, "source_hashes": source_hashes}
        return {"documents": docs, "at": (now or dt.datetime.now(dt.timezone.utc)).isoformat(),
                "proposed": pin is not None, "source_sha": pin_sha}
    except Exception as exc:
        log.warning("plan refresh failed: %s", type(exc).__name__)
        return {**old, "error": "Could not refresh the capability plan"}


def _fresh(at, now, limit):
    try:
        age = (now - dt.datetime.fromisoformat(at.replace("Z", "+00:00"))).total_seconds()
        return 0 <= age <= limit
    except (AttributeError, TypeError, ValueError):
        return False


def _receipt(value):
    if isinstance(value, str) and value.startswith("https://github.com/"):
        return value
    return None


def _read_report(report):
    # Keep old versions in the existing report's <details> history.
    current = re.split(r"(?mi)^\s*<details\b", report.get("raw") or "", maxsplit=1)[0]
    blocks = BLOCK.findall(current)
    if not blocks:
        return {}
    if len(blocks) != 1:
        return None
    try:
        data = json.loads(blocks[0])
    except ValueError:
        return None
    return data if isinstance(data, dict) else None


def _coordinator(reports, report_id, issue_url):
    return next((r for r in reports if r["id"] == report_id and r["trusted"]
                 and r["lane"] == "CHARLIE-CODEX"
                 and (not issue_url or r["url"] == f"{issue_url}#issuecomment-{report_id}")), {})


def _decision_envelope(data):
    return "\n".join((
        "[CAPABILITY-ACCEPTED]",
        f"Plan revision: {data.get('plan_revision')}",
        f"Step: {data.get('step')}",
        f"PR head: {data.get('head')}",
        f"Build: {data.get('build')}",
        f"Environment: {data.get('environment')}",
    ))


def verify_decision(get, repo, issue, reports, report_id, owner):
    """An owner-authored acceptance on the canonical issue binds the whole decision."""
    issue_url = f"https://github.com/{repo}/issues/{issue}"
    data = _read_report(_coordinator(reports, report_id, issue_url)) or {}
    url = data.get("decision")
    prefix = issue_url + "#issuecomment-"
    if not isinstance(url, str) or not url.startswith(prefix) or not re.fullmatch(r"[1-9]\d*", url[len(prefix):]):
        return None
    number = url[len(prefix):]
    expected = _decision_envelope(data)
    try:
        status, _, comment = get(f"https://api.github.com/repos/{repo}/issues/comments/{number}", headers={})
    except Exception as exc:
        log.warning("capability decision unavailable: %s", type(exc).__name__)
        return None
    if (status != 200 or not isinstance(comment, dict) or comment.get("html_url") != url
            or (comment.get("user") or {}).get("login") != owner
            or not isinstance(comment.get("body"), str)):
        return None
    envelope = "\n".join(comment["body"].splitlines()[:6])
    return {"url": url, "envelope": expected} if envelope == expected else None


def coordinator_pr(state, reports, report_id, issue_url=None):
    rep = _coordinator(reports, report_id, issue_url)
    data = _read_report(rep) or {}
    docs = state.get("documents") or {}
    pr = data.get("pr")
    if (type(pr) is int and pr > 0 and data.get("plan_revision") == docs.get("revision")
            and docs.get("current") and data.get("step") == docs["current"]["number"]):
        return pr
    return _candidate_pr(rep)


def _candidate_pr(report):
    raw = report.get("raw") or ""
    match = re.search(r"(?m)^Branch / SHA:[^\n]*?#([1-9]\d*)", raw.split("<details>", 1)[0])
    return int(match[1]) if match else None


def _ui_report(reports, row, pr):
    head = row.get("head_sha")
    if not head or not pr:
        return {}
    return next((r for r in reports if r["trusted"] and r["lane"] == "CHARLIE-CLAUDE"
                 and pr in r.get("parsed", {}).get("items", [])
                 and re.search(rf"(?<![0-9a-f]){head[:9]}[0-9a-f]*\b",
                               (r.get("raw") or "").split("<details>", 1)[0])), {})


def _action(block, report, review, current, ui):
    action = block.get("action")
    fields = ("title", "owner", "expected", "observed", "status", "next")
    if isinstance(action, dict) and all(isinstance(action.get(k), str) for k in fields) and action["status"] in STATES:
        result = {k: action[k] for k in fields}
        if review["label"].startswith("ISSUES_FOUND"):
            result.update(status="BLOCKED", observed=review["label"])
        return result
    failed = review["label"].startswith("ISSUES_FOUND")
    owner = ui.get("parsed") or {}
    if owner.get("state") == "BLOCKED" and not review["on"]:
        return {
            "title": "Resolve the current review findings" if failed else "Qualify the Hub candidate",
            "owner": "CHARLIE Claude · shared UI",
            "expected": "Current review and regression checks cover the same candidate.",
            "observed": review["label"],
            "status": "BLOCKED",
            "next": owner.get("decision") or owner.get("blocked_by") or "Read the UI owner's report",
        }
    return {
        "title": "Resolve the current review findings" if failed else "Next action from the coordinator",
        "owner": "CHARLIE Claude · shared UI" if failed else "CHARLIE Codex · integration",
        "expected": "A candidate that meets the review and regression checks." if failed else current["outcome"],
        "observed": review["label"] if failed else "No workflow result recorded",
        "status": "BLOCKED" if failed else "NOT TESTED",
        "next": "See the UI owner’s repair decision" if failed else report.get("parsed", {}).get("next") or "Record the next action in the acceptance ledger",
    }


def project(state, reports, evidence, now, *, report_id, max_age_seconds, reports_at, issue_url=None):
    docs = state.get("documents")
    if not docs:
        return {"status": "Plan unavailable", "error": state.get("error"), "ledger_url": issue_url}
    rep = _coordinator(reports, report_id, issue_url)
    raw = _read_report(rep)
    block = raw or {}
    bound = block.get("plan_revision") == docs["revision"] and block.get("step") == docs["current"]["number"]
    data = block if bound else {}
    pr = coordinator_pr(state, reports, report_id, issue_url)
    row = next((r for r in evidence.get("rows", []) if r["number"] == pr), {})
    cells = row.get("cells", {})
    review = cells.get("REVIEWED") or {"on": False, "label": "Review evidence unavailable"}
    ui = _ui_report(reports, row, pr)
    env, build = data.get("environment"), data.get("build")
    runtime = (evidence.get("envs") or {}).get(env) or {} if isinstance(env, str) else {}
    head = data.get("head")
    head_matches = isinstance(head, str) and SHA.fullmatch(head) and head == row.get("head_sha")
    matches = (head_matches and isinstance(build, str) and SHA.fullmatch(build) and runtime.get("ok")
               and runtime.get("git_sha") == build)
    fresh = (not state.get("error") and not evidence.get("error") and all(
        _fresh(at, now, max_age_seconds) for at in (state.get("at"), reports_at, evidence.get("at"))
    ))
    raw_results = block.get("results")
    check_ids = {r["id"] for r in docs["checks"]}
    rows = {}
    valid_results = isinstance(raw_results, list)
    if valid_results:
        for entry in raw_results:
            if not isinstance(entry, dict) or not isinstance(entry.get("id"), str) or entry["id"] not in check_ids or entry["id"] in rows:
                valid_results = False
                break
            result = entry.get("status")
            if not isinstance(result, str) or result not in STATES or not isinstance(entry.get("observed"), str):
                valid_results = False
                break
            if result == "PASS" and not _receipt(entry.get("receipt")):
                valid_results = False
                break
            rows[entry["id"]] = {k: entry.get(k) for k in ("status", "observed", "build", "environment")}
            rows[entry["id"]]["receipt"] = _receipt(entry.get("receipt"))
    checks = []
    for check in docs["checks"]:
        recorded = rows.get(check["id"]) if valid_results else None
        applicable = recorded and bound and matches and fresh and recorded["build"] == build and recorded["environment"] == env
        checks.append({**check, "status": recorded["status"] if applicable else "NO RECEIPT",
                       "observed": recorded["observed"] if applicable else None,
                       "receipt": recorded["receipt"] if applicable else None,
                       "history": recorded if recorded and not applicable else None})
    checked = state.get("decision") or {}
    expected = _decision_envelope(data)
    decision = (checked.get("url") if checked.get("envelope") == expected
                and checked.get("url") == data.get("decision") else None)
    reported_action = data.get("action")
    preflight_action = (build is None and head_matches and isinstance(reported_action, dict)
                        and reported_action.get("status") != "PASS")
    action = _action(data if fresh and (matches or preflight_action) else {}, rep,
                     review if fresh else {"on": False, "label": ""}, docs["current"],
                     ui if fresh and _fresh(ui.get("updated_at"), now, 9 * 3600) else {})
    accepted = (fresh and not state.get("proposed") and matches and decision and review["on"]
                and action["status"] not in {"FAIL", "BLOCKED"}
                and cells.get("TESTED", {}).get("on") and cells.get(f"DEPLOYED:{env}", {}).get("on")
                and all(c["status"] == "PASS" for c in checks))
    if accepted:
        action.update(title="Advance the roadmap", status="PASS",
                      owner="CHARLIE Codex · integration", observed="Acceptance recorded",
                      next="Publish the next capability through the reviewed roadmap")
    status = ("Evidence stale" if not fresh else "Accepted" if accepted
              else "Blocked" if review["label"].startswith("ISSUES_FOUND")
              or action["status"] in {"FAIL", "BLOCKED"}
              or any(c["status"] in {"FAIL", "BLOCKED"} for c in checks) else "In progress")
    return {
        **docs, "checks": checks, "status": status, "proposed": bool(state.get("proposed")),
        "fresh": fresh, "updated_at": state.get("at"), "error": state.get("error"),
        "result_error": "Acceptance record needs correction" if raw is None or raw_results is not None and not valid_results else None,
        "candidate_head": row.get("head_sha"), "build": build if isinstance(build, str) else None,
        "environment": env if isinstance(env, str) else None, "review": review,
        "review_fresh": fresh and bool(row), "decision": decision if accepted else None,
        "next_step": next((step for step in docs["steps"] if step["number"] > docs["current"]["number"]), None),
        "action": action,
        "ledger_url": rep.get("url") or issue_url,
        "ui_url": ui.get("url"),
    }
