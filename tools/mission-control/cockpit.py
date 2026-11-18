"""HTML rendering for mission control (v1 board sections + v2 cockpit panels).

string.Template over page.html; every value passes through _e(); no inline JS (CSP).
Colour is state only: on/off cells, fresh/stale/missing chips, GO/NO-GO badge.
"""

from __future__ import annotations

import html
import os
import re
import string
from pathlib import Path
from typing import List, Optional

HERE = Path(__file__).resolve().parent
SEND_DISABLED_REASON = (
    "Nothing on this page can start an agent yet: the dispatcher, its permissions "
    "and delivery receipts are not built or approved."
)
STATES = (
    "IMPLEMENTED",
    "TESTED",
    "REVIEWED",
    "DEPLOYED:staging",
    "DEPLOYED:production",
    "FIELD-VERIFIED",
)


def _e(s: object) -> str:
    return html.escape(str(s), quote=True)


# Separate from _link()'s GitHub-only card guard (#4982): this is one operator-configured
# header link to the GTM plan, never a card ref, so it must not widen _link()'s allowlist.
_PLAN_URL_RE = re.compile(r"https://claude\.ai/artifact/[A-Za-z0-9_-]+")


def _plan_url() -> Optional[str]:
    url = os.getenv("MC_PLAN_URL", "")
    return url if _PLAN_URL_RE.fullmatch(url) else None


def _gh(url: object) -> str:
    return str(url) if str(url).startswith("https://github.com/") else "#"


def _link(item: dict) -> str:
    return f'<a href="{_e(_gh(item["url"]))}" target="_blank" rel="noopener">{_e(item["repo"].split("/")[-1])} #{_e(item["number"])}</a>'


def _card(item: dict, with_decision: bool) -> str:
    rec = item.get("rec", {})
    labels = "".join(f'<span class="chip">{_e(lb)}</span>' for lb in item["labels"][:4])
    decision = ""
    if with_decision:
        decision = (
            f'<div class="decide"><span class="rec">Recommended: <b>{_e(rec.get("option", ""))}</b>'
            f" &middot; {_e(rec.get('why', ''))}</span>"
            f'<button type="button" disabled aria-disabled="true" title="{_e(SEND_DISABLED_REASON)}">Send</button></div>'
        )
    return (
        f'<li class="card state-{_e(item["state"].lower())}"><div class="row"><span class="ref">{_link(item)}</span>'
        f'<span class="status">{_e(item["status"])}</span></div>'
        f'<p class="title">{_e(item["title"])}</p><div class="chips">{labels}</div>{decision}</li>'
    )


def _section(
    title: str, hint: str, items: List[dict], with_decision: bool = False, limit: int = 60
) -> str:
    body = (
        "".join(_card(i, with_decision) for i in items[:limit])
        or '<li class="empty">Nothing here right now.</li>'
    )
    more = f'<p class="more">Showing {limit} of {len(items)}.</p>' if len(items) > limit else ""
    return f'<section><h2>{_e(title)} <span class="count">{len(items)}</span></h2><p class="hint">{_e(hint)}</p><ul>{body}</ul>{more}</section>'


def _when(stamp: Optional[str]) -> str:
    return _e(stamp.replace("T", " ").replace("+00:00", "Z")) if stamp else "never"


def _lane_card(ln: dict) -> str:
    trust = "" if ln["trusted"] else '<span class="chip warn">untrusted author</span>'
    src = (
        f'<a href="{_e(_gh(ln["url"]))}" target="_blank" rel="noopener">source</a>'
        if ln.get("url")
        else ""
    )
    rows = "".join(
        f'<div><span class="k">{_e(k)}</span><span class="v">{_e(ln.get(key) or "—")}</span></div>'
        for k, key in (
            ("Goal", "goal"),
            ("Next", "next"),
            ("Blocked by", "blocked_by"),
            ("Decision", "decision"),
        )
    )
    return (
        f'<li class="lane" data-fresh="{_e(ln["freshness"])}"><div class="row"><b>{_e(ln["lane"])}</b>'
        f'<span class="chip state">{_e(ln["state"])}</span><span class="chip ev-{_e(ln["evidence"]).replace(" ", "-").lower()}">{_e(ln["evidence"])}</span>'
        f'<span class="chip">{_e(ln["stage"])}</span>{trust}</div>'
        f'<div class="kv">{rows}</div><div class="meta">updated {_when(ln["updated_at"])} &middot; {_e(ln["freshness"])} {src}</div></li>'
    )


def _cell(c: dict) -> str:
    cls = "cell on" if c.get("on") else "cell off"
    label = _e(c.get("label", ""))
    if c.get("source"):
        label = f'<a href="{_e(_gh(c["source"]))}" target="_blank" rel="noopener">{label}</a>'
    return f'<td class="{cls}">{label}</td>'


def _lifecycle_rows(rows: List[dict]) -> str:
    if not rows:
        return f'<tr><td colspan="{len(STATES) + 2}" class="empty">No candidate item has evidence yet.</td></tr>'
    out = []
    for r in rows:
        item = f'<a href="{_e(_gh(r.get("url")))}" target="_blank" rel="noopener">#{_e(r["number"])}</a> {_e(r.get("title") or "")}'
        cells = "".join(_cell(r["cells"].get(s, {"on": False, "label": "—"})) for s in STATES)
        out.append(
            f'<tr><td class="item">{item}</td>{cells}<td class="reported">{_e(r.get("reported", "no report"))}</td></tr>'
        )
    return "".join(out)


def _env_card(name: str, e: Optional[dict]) -> str:
    if not e:
        return f'<li class="env off"><b>{_e(name)}</b><span class="v">not polled</span></li>'
    if not e.get("ok"):
        return f'<li class="env off"><b>{_e(name)}</b><span class="v">unreachable from this host</span></li>'
    sha = str(e.get("git_sha") or "")
    behind = e.get("behind_by")
    pending = (
        f"{behind} merged, not deployed" if isinstance(behind, int) else "ancestry not checked"
    )
    return (
        f'<li class="env on"><b>{_e(name)}</b><span class="v mono">{_e(sha[:9])}</span>'
        f'<span class="v">built {_when(e.get("built_at"))}</span><span class="v">{_e(pending)}</span></li>'
    )


def _feed(events: List[dict]) -> str:
    if not events:
        return '<li class="empty">No GitHub events received yet.</li>'
    out = []
    for ev in events:
        ref = f"#{_e(ev['number'])}" if ev.get("number") else ""
        link = (
            f'<a href="{_e(_gh(ev["url"]))}" target="_blank" rel="noopener">{ref or _e(ev["kind"])}</a>'
            if ev.get("url")
            else ref
        )
        out.append(
            f'<li><span class="t">{_when(ev["received_at"])}</span><span class="src {_e(ev["source"])}">{_e(ev["source"])}</span>'
            f"<span>{_e(ev.get('actor') or '')} {_e(ev['kind'])} {_e(ev.get('action') or '')} {link}</span></li>"
        )
    return "".join(out)


def _tiles(m: dict) -> str:
    st, ci = m["tiles"]["stages"], m["tiles"]["ci"]
    rate = f"{ci['pass']}/{ci['total']}" if ci["total"] else "n/a"
    tiles = (
        ("Reviewed", st.get("REVIEWED", 0), "#lifecycle"),
        ("CI pass (last 50)", rate, "#feed"),
        ("Decisions for Mike", m["tiles"]["decisions"], "#decisions"),
        ("Blocked lanes", m["tiles"]["blocked"], "#lanes"),
    )
    return "".join(
        f'<a class="tile" href="{h}"><span class="n">{_e(v)}</span><span class="l">{_e(k)}</span></a>'
        for k, v, h in tiles
    )


def render_cockpit(m: dict) -> dict:
    h = m["header"]
    live = "LIVE" if h["live"] else "STALE"
    r = m["readiness"]
    badge_cls = "go" if r["decision"] == "GO" else "no-go"
    decisions = (
        "".join(
            f'<li><b>{_e(d["lane"])}</b> {_e(d["text"])} <a href="{_e(_gh(d["url"]))}" target="_blank" rel="noopener">source</a></li>'
            for d in m["decisions"]
        )
        or '<li class="empty">No decisions requested in a current trusted report.</li>'
    )
    return {
        "live": f'<span class="pill {live.lower()}">{live}</span>',
        "poll_time": _when(h["last_poll"]),
        "webhook_time": _when(h["last_webhook"]),
        "evidence_time": _when(h.get("evidence_at")),
        "evidence_error": f'<p class="error">{_e(h["evidence_error"])}</p>'
        if h.get("evidence_error")
        else "",
        "go_badge": f'<span class="go-badge {badge_cls}">{_e(r["decision"])}</span>',
        "go_reason": _e(r["reason"]),
        "tiles": _tiles(m),
        "envs": "".join(_env_card(n, m["envs"].get(n)) for n in ("staging", "production")),
        "lanes": "".join(_lane_card(ln) for ln in m["lanes"]),
        "decisions": decisions,
        "lifecycle_rows": _lifecycle_rows(m["lifecycle"]),
        "feed": _feed(m["feed"]),
    }


def _source(url: object, label: str) -> str:
    return f'<a href="{_e(_gh(url))}">{_e(label)}</a>' if _gh(url) != "#" else ""


def _check(row: dict) -> str:
    history = row.get("history")
    prior = (
        f'<p class="meta">Earlier evidence: {_e(history["status"])} · {_e(history.get("environment") or "unknown")} · '
        f'{_e(str(history.get("build") or "")[:9])}. {_e(history["observed"])} '
        f'{_source(history.get("receipt"), "Earlier receipt")}</p>' if history else ""
    )
    observed = f'<p>{_e(row["observed"])}</p>' if row.get("observed") else ""
    return (
        f'<li class="workflow-check"><div class="row"><b>{_e(row["id"])}</b> '
        f'<span class="chip">{_e(row["status"])}</span></div><p>{_e(row["expected"])}</p>'
        f'<p class="meta">Proof required: {_e(row["proof"])}</p>{observed}'
        f'{_source(row.get("receipt"), "View receipt")}{prior}</li>'
    )


def render_workflow(plan: dict) -> str:
    if not plan.get("current"):
        return (
            '<section class="workflow" aria-labelledby="workflow-title"><h2 id="workflow-title">'
            f'Capability plan</h2><p>{_e(plan.get("error") or "Waiting for the first plan refresh.")}</p>'
            f'{_source(plan.get("ledger_url"), "Open acceptance ledger")}</section>'
        )
    current, action = plan["current"], plan["action"]
    adoption = "Proposed plan" if plan["proposed"] else "Repository plan"
    source = _source(plan["plan_url"], "Full step plan")
    ledger = _source(plan.get("ledger_url"), "Open acceptance record")
    repair = _source(plan.get("ui_url"), "Open UI owner’s report") if action["status"] == "BLOCKED" else ""
    checks = "".join(_check(row) for row in plan["checks"])
    steps = "".join(
        f'<li><b>{_e(step["name"])}</b><p>{_e(step["outcome"])}</p>'
        f'<p class="meta">Proof required: {_e(step["proof"])}</p></li>' for step in plan["steps"]
    )
    actions = "".join(f'<li>{_e(step)}</li>' for step in plan["actions"])
    review = plan["review"]
    review_label = "Current review" if plan["review_fresh"] else "Last seen review"
    warnings = "".join(f'<p class="error">{_e(plan[key])}</p>' for key in ("error", "result_error") if plan.get(key))
    next_step = plan.get("next_step")
    up_next = f'<p><b>Up next</b> · {_e(next_step["name"])}</p>' if next_step else ""
    decision = _source(plan.get("decision"), "Acceptance decision")
    evidence = (
        f'<p class="meta">{_e(review_label)} · {_e(review["label"])} '
        f'{_source(review.get("source"), "Review record")}</p>'
    )
    return (
        '<section class="workflow" aria-labelledby="workflow-title">'
        '<p class="hint">FactoryLM builds trusted maintenance context one piece of equipment at a time. '
        + _source("https://github.com/Mikecranesync/MIRA/blob/main/NORTH_STAR.md", "FactoryLM vision") + '</p>'
        f'<h2 id="workflow-title">Step {_e(current["number"])} · {_e(current["name"])}</h2>'
        f'<p>{_e(current["outcome"])}</p><p class="meta">{_e(adoption)} · '
        f'{_e(plan["revision"][:9])} · checked {_when(plan["updated_at"])} · {_e(plan["status"])}</p>{warnings}'
        f'<section class="work-action"><h3>{_e(action["title"])}</h3>'
        f'<p class="meta">{_e(action["owner"])} · {_e(action["status"])}</p>'
        f'<dl><dt>Expected</dt><dd>{_e(action["expected"])}</dd>'
        f'<dt>Observed</dt><dd>{_e(action["observed"])}</dd><dt>Next</dt><dd>{_e(action["next"])}</dd></dl>'
        f'{evidence}<p class="meta">Candidate {_e(str(plan["candidate_head"] or "unavailable")[:12])} · '
        f'{_e(plan["environment"] or "No acceptance environment")} · '
        f'{_e(str(plan["build"] or "No accepted build")[:20])}</p>'
        f'<div class="workflow-links">{ledger}{repair}{decision}</div></section>'
        f'{up_next}<div class="workflow-links">{source}{_source(plan["roadmap_url"], "Roadmap source")}</div>'
        f'<details><summary>What proves this step</summary><ul class="workflow-checks">{checks}</ul></details>'
        f'<details><summary>Work sequence</summary><ol>{actions}</ol></details>'
        f'<details><summary>Capability roadmap</summary><ol>{steps}</ol></details></section>'
    )


def render(snap, board, model: dict) -> str:
    v = board.build_views(list(snap.items))
    when = snap.at.strftime("%Y-%m-%d %H:%M UTC") if snap.at else "never"
    status = "".join(f"<li><b>{n}</b> {_e(s)}</li>" for s, n in v["by_status"].items())
    error = f'<p class="error" role="alert">{_e(snap.error)}</p>' if snap.error else ""
    if snap.at is None and not snap.error:
        error = '<p class="error" role="status">Loading the board for the first time; reload in about 30 seconds.</p>'
    plan_url = _plan_url()
    plan_link = (
        f'<a class="plan" href="{_e(plan_url)}" target="_blank" rel="noopener">View GTM plan</a>'
        if plan_url
        else ""
    )
    fields = dict(
        snapshot_time=_e(when),
        total=v["total"],
        status_list=status,
        error=error,
        send_reason=_e(SEND_DISABLED_REASON),
        plan_link=plan_link,
        workflow=render_workflow(model.get("plan") or {}),
        focus=_section(
            "In progress",
            "Open cards with Status = In Progress (matches saved View 2).",
            v["focus"],
            True,
        ),
        needs=_section(
            "Needs Mike", "Open cards labelled for an owner decision.", v["needs_owner"], True
        ),
        blocked=_section("Blocked", "Open cards labelled blocked.", v["blocked"], True),
        mismatched=_section(
            "Card and record disagree",
            "The card status contradicts the issue or PR state.",
            v["mismatched"],
            True,
        ),
    )
    plan = model.get("plan") or {}
    fields["plan_owners"] = "".join(
        f'<li><b>{_e(owner["name"])}</b><p>{_e(owner["deliverable"])}</p></li>'
        for owner in plan.get("owners", [])
    )
    fields.update(render_cockpit(model))
    return string.Template((HERE / "page.html").read_text()).substitute(fields)
