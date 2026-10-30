"""MIRA Work Packet builder (draft, #4982).

Takes a packet JSON whose fields are labeled verified / proposed / unknown,
optionally applies a technician's review edits, validates the labels, and
renders the packet as HTML (phone-friendly, FactoryLM tokens) and Markdown.
No model calls. Nothing is invented: a field without a cited source cannot be
'verified', and an 'unknown' field cannot carry a value.

Usage:
    python tools/work-packet/build_packet.py packet.json [--edits edits.json] --out DIR

Writes DIR/packet.reviewed.json, DIR/packet.html, DIR/packet.md, DIR/summary.json.
Exit 1 (and no output) when validation fails.

An edits file is a JSON list of {path, action, value?, by, at, note?} where
action is "set" (technician supplies or corrects a value), "confirm" (accepts
a proposed/verified field) or "strike" (removes a step or item). Paths use
dots and [index], e.g. "steps.items[3].text".
"""

from __future__ import annotations

import html
import json
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any

LABELS = ("verified", "proposed", "unknown")
PATH_TOKEN = re.compile(r"([^.\[\]]+)|\[(\d+)\]")
# F3: the field a technician's `set` edit actually displays, by node type.
# Checked in order — a measurement-like node has `value`; a step has `text`;
# a part/simple-item node has `description`. A node with none of these is
# rejected rather than silently gaining an unused `value` key.
EDITABLE_FIELDS = ("value", "text", "description")


def _editable_field(node: dict) -> str | None:
    for f in EDITABLE_FIELDS:
        if f in node:
            return f
    return None


def iter_labeled(obj: Any, path: str = ""):
    """Yield (path, node) for every dict that carries a 'label'."""
    if isinstance(obj, dict):
        if "label" in obj:
            yield path, obj
        for k, v in obj.items():
            yield from iter_labeled(v, f"{path}.{k}" if path else k)
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            yield from iter_labeled(v, f"{path}[{i}]")


def validate(packet: dict) -> list[str]:
    problems: list[str] = []
    for path, node in iter_labeled(packet):
        label = node.get("label")
        if label not in LABELS:
            problems.append(f"{path}: label {label!r} is not one of {LABELS}")
            continue
        if label == "verified" and not (node.get("source") or node.get("basis")):
            problems.append(f"{path}: verified without a source/basis")
        if label == "unknown" and node.get("value") not in (None, ""):
            problems.append(f"{path}: unknown but carries a value")
    if packet.get("safety", {}).get("isolation", {}).get("generated_steps"):
        problems.append("safety.isolation.generated_steps must stay empty: isolation is site-owned")
    return problems


def resolve(packet: dict, path: str) -> tuple[Any, str | int]:
    """Return (container, key) for a dotted/[indexed] path."""
    tokens = [(m.group(1), m.group(2)) for m in PATH_TOKEN.finditer(path)]
    if not tokens:
        raise KeyError(path)
    cur: Any = packet
    for name, idx in tokens[:-1]:
        cur = cur[int(idx)] if idx is not None else cur[name]
    name, idx = tokens[-1]
    return cur, (int(idx) if idx is not None else name)


def apply_edits(packet: dict, edits: list[dict]) -> dict:
    approval = packet.setdefault("approval", {})
    review = approval.setdefault(
        "technician_review", {"state": "draft", "by": None, "at": None, "edits": []}
    )
    for e in edits:
        action = e.get("action")
        if action not in ("set", "confirm", "strike"):
            raise ValueError(f"unknown edit action {action!r} at {e.get('path')}")
        if not e.get("by") or not e.get("at"):
            raise ValueError(f"edit at {e.get('path')} needs 'by' and 'at'")
        container, key = resolve(packet, e["path"])
        target = container[key]
        record = {k: e.get(k) for k in ("path", "action", "by", "at", "note")}
        if action == "set":
            if isinstance(target, dict) and "label" in target:
                # Whole-node set (e.g. "steps.items[1]"): F3 — write the
                # field this node TYPE actually displays, not a hardcoded
                # "value" that steps/parts never render. Reject rather than
                # silently add an unused key when no editable field exists.
                field = _editable_field(target)
                if field is None:
                    raise ValueError(
                        f"set at {e['path']} needs a node with a "
                        f"value/text/description field to edit"
                    )
                target[field] = e["value"]
                target["label"] = (
                    "proposed"  # supplied by a person, still pending supervisor approval
                )
                target["review"] = {"by": e["by"], "at": e["at"], "action": "set"}
            elif isinstance(container, dict) and "label" in container:
                # F2: scalar sub-field set (e.g. "measurements[1].value") —
                # `target` itself isn't a labeled node, but its immediate
                # container is. The owning node's label/source/review must
                # downgrade too, or the exported packet keeps showing the
                # OLD value's "verified" label and source on the NEW value.
                container[key] = e["value"]
                container["label"] = "proposed"
                if container.get("source"):
                    container["source"] = f"(superseded by technician edit) {container['source']}"
                container["review"] = {"by": e["by"], "at": e["at"], "action": "set"}
            else:
                container[key] = e["value"]
            record["value"] = e["value"]
        elif action == "confirm":
            if not isinstance(target, dict):
                raise ValueError(f"confirm needs a labeled field at {e['path']}")
            target["review"] = {"by": e["by"], "at": e["at"], "action": "confirm"}
        elif action == "strike":
            if not isinstance(target, dict):
                raise ValueError(f"strike needs an object at {e['path']}")
            target["struck"] = True
            target["review"] = {"by": e["by"], "at": e["at"], "action": "strike"}
        if action in ("set", "strike"):
            # F5: any content change after approval invalidates it — an
            # approved packet whose measurements/steps/parts change must
            # lose `approved_for_use` and show the DRAFT banner again until
            # a supervisor re-approves the new content.
            supervisor = approval.setdefault(
                "supervisor_approval", {"state": "pending", "by": None, "at": None}
            )
            if supervisor.get("state") == "approved":
                supervisor["state"] = "pending"
                supervisor["invalidated_reason"] = (
                    f"content changed by '{action}' at {e['path']} after approval"
                )
                supervisor["previous_approval_by"] = supervisor.get("by")
                supervisor["previous_approval_at"] = supervisor.get("at")
                supervisor["by"] = None
                supervisor["at"] = None
        review["edits"].append(record)
        review["state"], review["by"], review["at"] = "reviewed", e["by"], e["at"]
    return packet


def summarize(packet: dict) -> dict:
    counts = Counter(node["label"] for _, node in iter_labeled(packet) if not node.get("struck"))
    struck = sum(1 for _, node in iter_labeled(packet) if node.get("struck"))
    approval = packet.get("approval", {})
    return {
        "labels": {k: counts.get(k, 0) for k in LABELS},
        "struck": struck,
        "technician_review": approval.get("technician_review", {}).get("state"),
        "supervisor_approval": approval.get("supervisor_approval", {}).get("state"),
        "isolation_signoff": approval.get("isolation_signoff", {}).get("state"),
        "approved_for_use": approval.get("supervisor_approval", {}).get("state") == "approved",
    }


# ---------- rendering ----------

STYLE = """
body{font-family:var(--fl-font);color:var(--fl-ink);background:var(--fl-bg);margin:0;padding:var(--fl-space-4);line-height:1.45}
main{max-width:820px;margin:0 auto}
h1{font-size:1.4rem;margin:0 0 .25rem} h2{font-size:1.05rem;margin:1.4rem 0 .5rem;border-bottom:1px solid var(--fl-line);padding-bottom:.25rem}
.muted{color:var(--fl-muted);font-size:.9rem} .mono{font-family:var(--fl-mono);font-size:.85rem}
.card{background:var(--fl-surface);border:1px solid var(--fl-line);border-radius:var(--fl-radius-card);padding:var(--fl-space-3);margin:.5rem 0}
.badge{display:inline-block;font-size:.72rem;font-weight:600;letter-spacing:.02em;text-transform:uppercase;border-radius:var(--fl-radius-pill);padding:.1rem .5rem;border:1px solid var(--fl-line);vertical-align:middle;margin-left:.35rem}
.badge-verified{background:var(--fl-ok-bg);color:var(--fl-ok-ink);border-color:var(--fl-ok)}
.badge-proposed{background:var(--fl-warn-bg);color:var(--fl-ink);border-color:var(--fl-warn)}
.badge-unknown{background:var(--fl-faint);color:var(--fl-muted);border-color:var(--fl-off)}
.required{border-left:4px solid var(--fl-fault);background:var(--fl-fault-bg)}
.watermark{border:2px dashed var(--fl-warn);color:var(--fl-ink);background:var(--fl-warn-bg);padding:.5rem .75rem;border-radius:var(--fl-radius);font-weight:600;margin:.5rem 0}
table{border-collapse:collapse;width:100%;font-size:.9rem} th,td{border:1px solid var(--fl-line);padding:.35rem .5rem;text-align:left;vertical-align:top} th{background:var(--fl-faint)}
.tablewrap{overflow-x:auto} ol.steps li{margin:.45rem 0} .struck{text-decoration:line-through;color:var(--fl-muted)}
.sig{display:flex;gap:1rem;flex-wrap:wrap} .sig div{flex:1 1 220px;border-top:1px solid var(--fl-line-strong);padding-top:.3rem;margin-top:1.6rem;font-size:.85rem}
@media print{body{padding:0} .card{break-inside:avoid}}
"""


def _esc(v: Any) -> str:
    return html.escape("" if v is None else str(v))


class Markup(str):
    """A string that is ALREADY safe HTML (built only by this module's own
    renderers, e.g. ``_badge``) and must never be re-escaped.

    F1: the old trust test was "does the cell's text start with '<span'" —
    any ordinary data value a technician typed (a part description, a step
    instruction) that happened to start with that literal substring was
    rendered verbatim, unescaped. Trust is now a distinct type, never a
    string-content sniff.
    """


def _badge(node: dict) -> Markup:
    label = node.get("label", "unknown")
    rv = node.get("review")
    extra = f" · {rv['action']} by {_esc(rv['by'])}" if rv else ""
    return Markup(f'<span class="badge badge-{label}">{label}{extra}</span>')


def _row(cells: list[Any], row_class: str = "") -> str:
    cls = f" class='{row_class}'" if row_class else ""
    return (
        f"<tr{cls}>"
        + "".join(f"<td>{c if isinstance(c, Markup) else _esc(c)}</td>" for c in cells)
        + "</tr>"
    )


def to_html(packet: dict, tokens_css: str) -> str:
    j, s, p = packet["job"], packet["safety"], packet["parts"]
    summ = summarize(packet)
    out: list[str] = [
        "<!doctype html><html lang='en'><head><meta charset='utf-8'>",
        "<meta name='viewport' content='width=device-width, initial-scale=1'>",
        f"<title>Work Packet {_esc(j['work_order']['id'])} — {_esc(j['asset']['model'])}</title>",
        f"<style>{tokens_css}\n{STYLE}</style></head><body><main>",
        f"<h1>Work Packet · {_esc(j['work_order']['id'])} · {_esc(j['asset']['manufacturer'])} {_esc(j['asset']['model'])} {_badge(j['asset'])}</h1>",
        f"<div class='muted'>{_esc(j['work_order']['site'])} · asset {_esc(j['asset']['tag'])} · generated {_esc(packet.get('generated_on'))} · packet {_esc(packet.get('packet_version'))}</div>",
    ]
    if not summ["approved_for_use"]:
        out.append(
            "<div class='watermark'>DRAFT — reviewed by a technician only when marked; not approved for use until the supervisor approval below is recorded.</div>"
        )
    out.append(
        "<div class='card'><b>Labels.</b> "
        + " ".join(
            f"<span class='badge badge-{k}'>{k}</span> {_esc(v)}"
            for k, v in packet["label_semantics"].items()
        )
        + "</div>"
    )
    out.append(
        f"<div class='card'><b>Scope</b> {_badge(j['scope'])}<br>{_esc(j['scope']['value'])}<br><span class='muted'>{_esc(j['scope'].get('basis'))}</span></div>"
    )
    out.append(
        f"<div class='card'><b>Seal material</b> {_badge(j['seal_material_suffix'])} <span class='muted'>{_esc(j['seal_material_suffix'].get('why'))}</span></div>"
    )

    out.append(
        "<h2>Sources</h2><div class='tablewrap'><table><tr><th>Id</th><th>Document</th><th>Revision</th><th>Pages used</th><th>Hash</th></tr>"
    )
    for src in packet["sources"]:
        out.append(
            _row(
                [
                    src["id"],
                    src["title"],
                    src.get("revision") or "unknown",
                    ", ".join(map(str, src.get("pages_used", []))),
                    src.get("sha256_prefix", "—"),
                ]
            )
        )
    out.append("</table></div>")

    out.append("<h2>Safety</h2>")
    iso = s["isolation"]
    out.append(
        f"<div class='card required'><b>Isolation — site procedure required</b> {_badge(iso)}<br>{_esc(iso['requirement'])}</div>"
    )
    out.append(
        "<div class='card'><b>Manufacturer warnings</b><ul>"
        + "".join(
            f"<li>{_badge(w)} <i>{_esc(w['quote'])}</i> <span class='muted'>({_esc(w['source'])})</span></li>"
            for w in s["manufacturer_warnings"]
        )
        + "</ul></div>"
    )
    hz = s["hazards_to_review"]
    out.append(
        f"<div class='card'><b>Hazards to review in the site JHA</b> {_badge(hz)}<ul>"
        + "".join(f"<li>{_esc(h)}</li>" for h in hz["items"])
        + f"</ul><span class='muted'>{_esc(hz.get('note'))}</span></div>"
    )
    out.append(
        f"<div class='card'><b>Qualifications</b> {_badge(s['qualifications'])} <span class='muted'>{_esc(s['qualifications'].get('note'))}</span></div>"
    )

    out.append(
        f"<h2>Parts {_badge(p)}</h2><div class='muted'>{_esc(p['source'])}</div><div class='tablewrap'><table><tr><th>Part</th><th>Description</th><th>Qty</th><th>Basis</th><th>Condition</th><th></th></tr>"
    )
    for r in p["required"]:
        # F4: a struck part must not render as an ordinary active
        # requirement. Mark it (consistent with struck steps below), don't
        # silently drop the strike state.
        out.append(
            _row(
                [
                    r["part"],
                    r["description"],
                    r["qty"],
                    r["basis"],
                    r.get("condition", "—"),
                    _badge(r),
                ],
                row_class="struck" if r.get("struck") else "",
            )
        )
    out.append("</table></div>")
    out.append(
        f"<div class='card'><b>Kit coverage check</b> {_badge(p['kit_contents_check'])}<br>{_esc(p['kit_contents_check']['detail'])}</div>"
    )
    out.append(
        "<div class='tablewrap'><table><tr><th>Item</th><th>Part</th><th>Inspect, replace if worn</th><th>Qty</th><th>Source</th><th></th></tr>"
    )
    for r in p["inspect_replace_if_worn"]:
        out.append(_row([r["item"], r["part"], r["description"], r["qty"], r["source"], _badge(r)]))
    out.append("</table></div>")

    t = packet["tools"]
    out.append(
        f"<h2>Tools {_badge(t)}</h2><div class='tablewrap'><table><tr><th>Tool</th><th>For</th><th>Source</th></tr>"
    )
    for r in t["items"]:
        out.append(_row([r["tool"], r["for"], r["source"]]))
    out.append("</table></div>")

    st = packet["steps"]
    out.append(
        f"<h2>Draft work steps {_badge(st)}</h2><div class='muted'>{_esc(st['note'])}</div><ol class='steps'>"
    )
    for step in st["items"]:
        cls = " class='struck'" if step.get("struck") else ""
        out.append(
            f"<li{cls}>{_esc(step['text'])} {_badge(step)}<br><span class='muted'>{_esc(step['source'])}</span></li>"
        )
    out.append("</ol>")

    out.append(
        "<h2>Measurements and tolerances</h2><div class='tablewrap'><table><tr><th>Measurement</th><th>Value</th><th>Source</th><th></th></tr>"
    )
    for m in packet["measurements"]:
        out.append(_row([m["name"], m.get("value") or "— (unknown)", m["source"], _badge(m)]))
    out.append("</table></div>")

    out.append("<h2>Exceptions and unknowns</h2><ul>")
    for e in packet["exceptions"]:
        out.append(
            f"<li>{_esc(e['text'])} {_badge(e)} <span class='muted'>→ {_esc(e.get('resolve_by'))}</span></li>"
        )
    out.append("</ul>")

    a = packet["approval"]
    out.append(
        "<h2>Review and sign-off</h2><div class='tablewrap'><table><tr><th>Role</th><th>State</th><th>By</th><th>At</th></tr>"
    )
    for k, title in (
        ("isolation_signoff", "Isolation (qualified person)"),
        ("technician_review", "Technician review"),
        ("supervisor_approval", "Supervisor approval"),
    ):
        out.append(_row([title, a[k]["state"], a[k].get("by") or "", a[k].get("at") or ""]))
    out.append("</table></div>")
    edits = a["technician_review"].get("edits", [])
    if edits:
        out.append(
            "<div class='card'><b>Technician edits</b><ul>"
            + "".join(
                f"<li class='mono'>{_esc(e['action'])} {_esc(e['path'])}{' = ' + _esc(e['value']) if 'value' in e else ''} — {_esc(e['by'])} {_esc(e['at'])}{' · ' + _esc(e['note']) if e.get('note') else ''}</li>"
                for e in edits
            )
            + "</ul></div>"
        )
    out.append(
        "<div class='sig'><div>Technician signature / date</div><div>Supervisor signature / date</div><div>Isolation verified by / date</div></div>"
    )
    out.append(
        f"<p class='muted'>Labels: verified {summ['labels']['verified']} · proposed {summ['labels']['proposed']} · unknown {summ['labels']['unknown']} · struck {summ['struck']}. A reviewed packet is still a draft until approved.</p>"
    )
    out.append("</main></body></html>")
    return "\n".join(out)


def to_markdown(packet: dict) -> str:
    j, s, p = packet["job"], packet["safety"], packet["parts"]
    tag = lambda n: f"[{n.get('label')}]"  # noqa: E731
    lines = [
        f"# Work Packet {j['work_order']['id']} — {j['asset']['manufacturer']} {j['asset']['model']} {tag(j['asset'])}",
        "",
        "DRAFT — not approved for use."
        if not summarize(packet)["approved_for_use"]
        else "APPROVED",
        "",
        f"Scope {tag(j['scope'])}: {j['scope']['value']}",
        f"Seal material {tag(j['seal_material_suffix'])}: {j['seal_material_suffix'].get('why')}",
        "",
        "## Sources",
    ]
    lines += [
        f"- {src['id']}: {src['title']} ({src.get('revision') or 'unknown'}) pages {src.get('pages_used', [])}"
        for src in packet["sources"]
    ]
    lines += [
        "",
        "## Safety",
        f"- ISOLATION {tag(s['isolation'])}: {s['isolation']['requirement']}",
    ]
    lines += [f"- {tag(w)} {w['quote']} ({w['source']})" for w in s["manufacturer_warnings"]]
    lines += [
        "",
        "## Parts",
        "| Part | Description | Qty | Label | Condition |",
        "|---|---|---|---|---|",
    ]
    for r in p["required"]:
        # F4: struck parts carry Markdown strikethrough rather than silently
        # rendering as an ordinary active requirement (mirrors the struck
        # step handling just below).
        cells = [
            str(r["part"]),
            r["description"],
            str(r["qty"]),
            r["label"],
            r.get("condition", ""),
        ]
        if r.get("struck"):
            cells = [f"~~{c}~~" if c else c for c in cells]
        lines.append("| " + " | ".join(cells) + " |")
    lines += [
        "",
        f"Kit coverage {tag(p['kit_contents_check'])}: {p['kit_contents_check']['detail']}",
        "",
        "## Tools",
    ]
    lines += [f"- {r['tool']} — {r['for']} ({r['source']})" for r in packet["tools"]["items"]]
    lines += ["", f"## Draft steps {tag(packet['steps'])}"]
    lines += [
        f"{st['n']}. {'~~' if st.get('struck') else ''}{st['text']}{'~~' if st.get('struck') else ''} {tag(st)} ({st['source']})"
        for st in packet["steps"]["items"]
    ]
    lines += ["", "## Measurements"]
    lines += [
        f"- {m['name']}: {m.get('value') or 'unknown'} {tag(m)} ({m['source']})"
        for m in packet["measurements"]
    ]
    lines += ["", "## Exceptions"]
    lines += [f"- {e['text']} {tag(e)} → {e.get('resolve_by')}" for e in packet["exceptions"]]
    a = packet["approval"]
    lines += [
        "",
        "## Sign-off",
        f"- isolation: {a['isolation_signoff']['state']}",
        f"- technician review: {a['technician_review']['state']}",
        f"- supervisor approval: {a['supervisor_approval']['state']}",
    ]
    # F4: the edit ledger is in the HTML export but was entirely missing
    # from Markdown — a reviewer reading only the .md file had no record of
    # what a technician changed.
    edits = a.get("technician_review", {}).get("edits", [])
    lines += ["", "## Technician edits"]
    if edits:
        lines += [
            f"- {e['action']} {e['path']}"
            f"{' = ' + str(e['value']) if 'value' in e else ''} — {e['by']} {e['at']}"
            f"{' · ' + e['note'] if e.get('note') else ''}"
            for e in edits
        ]
    else:
        lines.append("- none")
    return "\n".join(lines) + "\n"


def default_tokens_path() -> Path:
    return Path(__file__).resolve().parents[2] / "docs" / "design" / "factorylm-tokens.css"


def main(argv: list[str]) -> int:
    if not argv or "--out" not in argv:
        print(__doc__)
        return 2
    packet = json.loads(Path(argv[0]).read_text())
    if "--edits" in argv:
        packet = apply_edits(packet, json.loads(Path(argv[argv.index("--edits") + 1]).read_text()))
    problems = validate(packet)
    if problems:
        print("validation failed:\n  " + "\n  ".join(problems))
        return 1
    tokens = Path(argv[argv.index("--tokens") + 1]) if "--tokens" in argv else default_tokens_path()
    out = Path(argv[argv.index("--out") + 1])
    out.mkdir(parents=True, exist_ok=True)
    (out / "packet.reviewed.json").write_text(json.dumps(packet, indent=1, ensure_ascii=False))
    (out / "packet.html").write_text(to_html(packet, tokens.read_text() if tokens.exists() else ""))
    (out / "packet.md").write_text(to_markdown(packet))
    (out / "summary.json").write_text(json.dumps(summarize(packet), indent=1))
    print(json.dumps(summarize(packet)))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
