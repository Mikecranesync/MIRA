"""Read-only projection of a versioned capability plan and its acceptance ledger."""
from __future__ import annotations

import base64
import datetime as dt
import hashlib
import json
import logging
import posixpath
import re

from mission_control_reports import live_report_text, read_capability_fields

log = logging.getLogger("mission-control.workflow")
ROADMAP = "docs/plans/capability-roadmap.md"
SHA = re.compile(r"[0-9a-f]{40}")
SHA256 = re.compile(r"[0-9a-f]{64}")
GENERATION = re.compile(r"[A-Za-z0-9_.:-]{1,100}")
CHECK_ID = re.compile(r"[A-Z][A-Z0-9-]*-\d+")
STATES = {"PASS", "FAIL", "BLOCKED", "NOT TESTED"}
PLAN_PATH = re.compile(r"[a-z0-9][a-z0-9-]*\.md")


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


def _table(tokens, part="tbody"):
    """Extract one part of the first table using Markdown tokens."""

    rows = []
    reading = False
    for token in tokens:
        if token.type == part + "_open":
            reading = True
        if token.type in {"table_close", part + "_close"}:
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
    table = _section(detail, {"Pass/fail contract", "Acceptance contract"})
    head = _table(table, part="thead")
    headers = tuple(map(_plain, head[0])) if len(head) == 1 else ()
    columns = {
        ("ID", "Test and expected result", "Required evidence"): (1, 2),
        ("ID", "Technician action or failure condition", "Expected observable result",
         "Proof level / owner", "Receipt and result"): (2, 3),
    }.get(headers)
    if columns is None:
        raise ValueError("Unrecognized acceptance table headings")
    for cells in _table(table):
        if len(cells) != len(headers):
            raise ValueError("Invalid acceptance row")
        rid, expected, proof = _plain(cells[0]), _plain(cells[columns[0]]), _plain(cells[columns[1]])
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
    # Evidence must name a concrete GitHub run, artifact, commit, issue or PR comment.
    if isinstance(value, str) and re.fullmatch(
        r"https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/"
        r"(?:(?:issues|pull)/[1-9]\d*#(?:issuecomment|discussion_r|pullrequestreview)-[1-9]\d*"
        r"|actions/runs/[1-9]\d*(?:/(?:job|artifacts)/[1-9]\d*)?"
        r"|commit/[0-9a-f]{40})", value,
    ):
        return value
    return None


def _results(data):
    entries = data.get("results")
    if not isinstance(entries, list):
        return None
    rows = {}
    for entry in entries:
        if not isinstance(entry, dict):
            return None
        rid, status, observed = (entry.get(k) for k in ("id", "status", "observed"))
        if (not isinstance(rid, str) or not CHECK_ID.fullmatch(rid) or rid in rows
                or not isinstance(status, str) or status not in STATES
                or not isinstance(observed, str) or not observed.strip()):
            return None
        receipt = _receipt(entry.get("receipt"))
        if status == "PASS" and not receipt:
            return None
        identity = ("build", "environment", "generation", "configuration_sha256")
        if any(entry.get(k) is not None and not isinstance(entry[k], str) for k in identity):
            return None
        rows[rid] = {**{k: entry.get(k) for k in identity}, "status": status,
                     "observed": observed.strip(), "receipt": receipt}
    return rows


def _results_digest(data):
    rows = _results(data)
    if not rows:
        return None
    return hashlib.sha256(json.dumps(rows, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def _read_report(report):
    fields = read_capability_fields(report.get("raw") or "")
    return None if fields.malformed else fields.results or {}


def _coordinator(reports, report_id, issue_url):
    return next((r for r in reports if r["id"] == report_id and r["trusted"]
                 and r["lane"] == "CHARLIE-CODEX"
                 and (not issue_url or r["url"] == f"{issue_url}#issuecomment-{report_id}")), {})


def _decision_envelope(data):
    digest = _results_digest(data)
    if digest is None:
        return None
    return "\n".join((
        "[CAPABILITY-ACCEPTED]",
        f"Plan revision: {data.get('plan_revision')}",
        f"Step: {data.get('step')}",
        f"PR: {data.get('pr')}",
        f"PR head: {data.get('head')}",
        f"Build: {data.get('build')}",
        f"Environment: {data.get('environment')}",
        f"Runtime generation: {data.get('generation')}",
        f"Configuration SHA-256: {data.get('configuration_sha256')}",
        f"Results SHA-256: {digest}",
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
    if not expected:
        return None
    try:
        status, _, comment = get(f"https://api.github.com/repos/{repo}/issues/comments/{number}", headers={})
    except Exception as exc:
        log.warning("capability decision unavailable: %s", type(exc).__name__)
        return None
    if (status != 200 or not isinstance(comment, dict) or comment.get("html_url") != url
            or (comment.get("user") or {}).get("login") != owner
            or not isinstance(comment.get("body"), str)):
        return None
    envelope = "\n".join(comment["body"].splitlines()[:10])
    return {"url": url, "envelope": expected} if envelope == expected else None


def coordinator_pr(state, reports, report_id, issue_url=None):
    rep = _coordinator(reports, report_id, issue_url)
    return _candidate_number(rep, read_capability_fields(rep.get("raw") or ""))


def _candidate_number(rep, fields):
    if fields.malformed:
        return None
    if fields.candidate_provided:
        return fields.candidate[0] if fields.candidate else None
    # Before the first structured result, the old report can guide the action
    # display. It cannot establish the current candidate for acceptance.
    if fields.results is not None:
        return None
    live = live_report_text(rep.get("raw") or "")
    match = re.search(r"(?m)^Branch / SHA:[^\n]*?#([1-9]\d*)", live)
    return int(match[1]) if match else None


def _ui_report(reports, row, pr):
    head = row.get("head_sha")
    if not head or not pr:
        return {}
    return next((r for r in reports if r["trusted"] and r["lane"] == "CHARLIE-CLAUDE"
                 and pr in r.get("parsed", {}).get("items", [])
                 and re.search(rf"(?<![0-9a-f]){head[:9]}[0-9a-f]*\b",
                               live_report_text(r.get("raw") or ""))), {})


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
    fields = read_capability_fields(rep.get("raw") or "")
    raw = None if fields.malformed else fields.results or {}
    block = raw or {}
    bound = block.get("plan_revision") == docs["revision"] and block.get("step") == docs["current"]["number"]
    data = block if bound else {}
    pr = _candidate_number(rep, fields)
    row = next((r for r in evidence.get("rows", []) if r["number"] == pr), {})
    cells = row.get("cells", {})
    review = cells.get("REVIEWED") or {"on": False, "label": "Review evidence unavailable"}
    ui = _ui_report(reports, row, pr)
    env, build = data.get("environment"), data.get("build")
    runtime = (evidence.get("envs") or {}).get(env) or {} if isinstance(env, str) else {}
    head = data.get("head")
    explicit = fields.candidate
    candidate_conflict = bound and (explicit is None or explicit != (data.get("pr"), head))
    head_matches = (not candidate_conflict and isinstance(head, str) and SHA.fullmatch(head)
                    and head == row.get("head_sha"))
    generation, configuration = data.get("generation"), data.get("configuration_sha256")
    runtime_bound = (
        isinstance(generation, str) and GENERATION.fullmatch(generation)
        and isinstance(configuration, str) and SHA256.fullmatch(configuration)
        and generation == runtime.get("generation")
        and configuration == runtime.get("configuration_sha256")
    )
    matches = (head_matches and isinstance(build, str) and SHA.fullmatch(build)
               and runtime.get("ok") and runtime.get("git_sha") == build and runtime_bound)
    fresh = (not state.get("error") and not evidence.get("error") and all(
        _fresh(at, now, max_age_seconds) for at in (state.get("at"), reports_at, evidence.get("at"))
    ))
    raw_results = block.get("results")
    check_ids = {r["id"] for r in docs["checks"]}
    rows = _results(block)
    valid_results = rows is not None and set(rows) <= check_ids
    checks = []
    for check in docs["checks"]:
        recorded = rows.get(check["id"]) if valid_results else None
        applicable = (recorded and bound and matches and fresh
                      and recorded["build"] == build and recorded["environment"] == env
                      and recorded["generation"] == generation
                      and recorded["configuration_sha256"] == configuration)
        checks.append({**check, "status": recorded["status"] if applicable else "NO RECEIPT",
                       "observed": recorded["observed"] if applicable else None,
                       "receipt": recorded["receipt"] if applicable else None,
                       "history": recorded if recorded and not applicable else None})
    checked = state.get("decision") or {}
    expected = _decision_envelope(data)
    decision = (checked.get("url") if expected and checked.get("envelope") == expected
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
              else "Blocked" if candidate_conflict or review["label"].startswith("ISSUES_FOUND")
              or action["status"] in {"FAIL", "BLOCKED"}
              or any(c["status"] in {"FAIL", "BLOCKED"} for c in checks) else "In progress")
    result_error = None
    if candidate_conflict:
        result_error = "The capability candidate is missing, ambiguous, or differs from these results"
    elif raw is None or raw_results is not None and not valid_results:
        result_error = "Acceptance record needs correction"
    elif raw_results and not runtime_bound:
        result_error = "Current runtime configuration proof is unavailable or differs"
    return {
        **docs, "checks": checks, "status": status, "proposed": bool(state.get("proposed")),
        "fresh": fresh, "updated_at": state.get("at"), "error": state.get("error"),
        "result_error": result_error,
        "results_digest": _results_digest(data) if valid_results and matches and fresh else None,
        "candidate_head": row.get("head_sha"), "build": build if isinstance(build, str) else None,
        "environment": env if isinstance(env, str) else None, "review": review,
        "review_fresh": fresh and bool(row), "decision": decision if accepted else None,
        "next_step": next((step for step in docs["steps"] if step["number"] > docs["current"]["number"]), None),
        "action": action,
        "ledger_url": rep.get("url") or issue_url,
        "ui_url": ui.get("url"),
    }
