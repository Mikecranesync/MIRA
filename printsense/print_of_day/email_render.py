"""Print of the Day — mobile-first review email renderer (v2).

PRD §9 information architecture + §14 visual design. Renders the versioned
``print_of_day_email_v2`` HTML + plain-text from the ONE view model
(view_model.build_view_model). Both formats carry equivalent information
(FR-9). No JavaScript, no forms, no advanced CSS (PRD §13.6); single-column,
inline styles, a max ~640 px content width that reflows full-width on mobile
(PRD §14); status is conveyed by TEXT + shape label, never colour alone
(PRD §14 / §13.7). The evaluated print is embedded via a ``cid:`` reference so
it renders inline without a public URL (PRD §13.5).

Pure: takes a ViewModel + an optional inline-image CID; returns strings.
"""

from __future__ import annotations

from html import escape

from .view_model import ViewModel

_PREHEADER_MAX = 120

# Neutral, high-contrast inline palette (design-token spirit; email clients
# strip <style>, so inline is required). Colour is decorative only — every
# status also carries its text label + a shape glyph.
_INK = "#1A1D23"
_MUTED = "#5B6472"
_LINE = "#D7DCE3"
_ACCENT = "#2563EB"
_CARD_BG = "#F5F7FA"


def _verdict_glyph(verdict: str) -> str:
    # Shape/text, never colour alone (accessibility, §13.7).
    return {
        "gold_candidate": "◆",
        "correction_required": "▲",
        "hold_for_review": "■",
        "rejected": "✕",
        "unsafe": "⚠",
        "rights_blocked": "⦸",
    }.get(verdict, "•")


def _claims_line(vm: ViewModel) -> str:
    c = vm.claim_counts
    if all(v is None for v in c.values()):
        return "claim-level judging unavailable — reviewer confirmation needed"
    parts = []
    if c.get("confirmed") is not None:
        parts.append(f"{c['confirmed']} confirmed")
    if c.get("incorrect") is not None:
        parts.append(f"{c['incorrect']} incorrect")
    if c.get("unsupported"):
        parts.append(f"{c['unsupported']} unsupported")
    if c.get("nuance"):
        parts.append(f"{c['nuance']} nuance")
    return " · ".join(parts) or "no claims scored"


def subject(vm: ViewModel) -> str:
    """PRD §9.1 — 'Print of the Day #NNN — [title] — [Verdict]'."""
    seq = f"#{vm.sequence_number:03d}" if vm.sequence_number is not None else vm.case_id
    return f"Print of the Day {seq} — {vm.title} — {vm.verdict_label}"


def preheader(vm: ViewModel) -> str:
    """PRD §9.2 — subtle preview string."""
    return f"{_claims_line(vm)}. Review and approve in under 30 seconds."[:_PREHEADER_MAX]


def render_text(vm: ViewModel) -> str:
    """PRD §9 / FR-9 — plain-text equivalent with usable action URLs."""
    L: list[str] = []
    seq = f"#{vm.sequence_number:03d}" if vm.sequence_number is not None else vm.case_id
    L.append(f"PRINT OF THE DAY {seq}")
    L.append(vm.title)
    L.append(f"Evaluated {vm.evaluation_date}")
    L.append("")
    L.append(f"VERDICT: {vm.verdict_label.upper()}  [{_verdict_glyph(vm.verdict)}]")
    L.append(_claims_line(vm))
    d = vm.dimension_grades
    L.append(
        f"Accuracy: {d['accuracy']} · Evidence: {d['evidence']} · Honesty: {d['honesty']} "
        f"· Safety: {d['safety']} · Rights: {d['rights']}"
    )
    if vm.promotion_blocked:
        L.append("PROMOTION BLOCKED — reviewer decision required.")
    L.append("")
    if vm.blind_summary:
        L.append("WHAT PRINTSENSE CONCLUDED BEFORE SEEING THE ANSWER KEY")
        L.append(vm.blind_summary)
        L.append("")
    L.append("KEY FINDINGS")
    for i, f in enumerate(vm.key_findings, 1):
        L.append(f"{i}. [{f.type.upper()}] {f.title}: {f.summary}")
    L.append("")
    L.append("ACTIONS")
    for label, key in (
        ("Approve", "approve"),
        ("Request correction", "correct"),
        ("Reject for promotion", "reject"),
        ("Hold", "hold"),
    ):
        val = vm.actions.get(key) or ""
        L.append(f"- {label}: {val}")
    if vm.actions.get("report"):
        L.append(f"- Open full evidence report: {vm.actions['report']}")
    L.append("")
    h = vm.pipeline_health
    L.append(f"PIPELINE HEALTH: {h['status'].replace('_', ' ').upper()}")
    for m in h["messages"]:
        L.append(f"  - {m}")
    L.append("")
    L.append(
        f"case {vm.case_id} · report v{vm.report['version']} · rights {vm.dimension_grades['rights']} "
        f"· template {vm.template_versions['email']}"
    )
    return "\n".join(L)


def _btn(label: str, href: str) -> str:
    # >=44px tall touch target (PRD §13.7). Reply-command "hrefs" become mailto
    # bodies so the button still works in Phase 1.
    if href.startswith("reply:"):
        href = f"mailto:?subject=RE%3A%20PrintSense&body={escape(href[6:])}"
    return (
        f'<a href="{escape(href)}" style="display:block;box-sizing:border-box;'
        f"width:100%;padding:14px 16px;margin:6px 0;background:{_CARD_BG};"
        f"border:1px solid {_LINE};border-radius:8px;color:{_INK};"
        f'text-decoration:none;font-weight:600;font-size:16px;text-align:center;">'
        f"{escape(label)}</a>"
    )


def render_html(vm: ViewModel, *, image_cid: str | None = None) -> str:
    """PRD §9 verdict-first mobile email. Single column, inline styles, CID image."""
    d = vm.dimension_grades
    glyph = _verdict_glyph(vm.verdict)
    findings_html = "".join(
        f'<li style="margin:10px 0;"><strong>{escape(f.type.title())}:</strong> '
        f"{escape(f.title)} — {escape(f.summary)}</li>"
        for f in vm.key_findings
    )
    img_html = ""
    if image_cid:
        img_html = (
            f'<img src="cid:{escape(image_cid)}" alt="Evaluated print: {escape(vm.title)}" '
            f'style="width:100%;max-width:100%;height:auto;border:1px solid {_LINE};'
            'border-radius:8px;display:block;" />'
        )
    blocked_html = (
        f'<p style="margin:8px 0 0;color:{_INK};font-weight:700;">'
        "⚠ Promotion blocked — reviewer decision required.</p>"
        if vm.promotion_blocked
        else ""
    )
    blind_html = (
        f'<h2 style="font-size:15px;color:{_MUTED};margin:20px 0 6px;">'
        "What PrintSense concluded before seeing the answer key</h2>"
        f'<p style="margin:0;font-size:15px;line-height:1.5;">{escape(vm.blind_summary)}</p>'
        if vm.blind_summary
        else ""
    )
    h = vm.pipeline_health
    health_msgs = " ".join(escape(m) for m in h["messages"]) or "All checks healthy."

    return f"""<div style="margin:0;padding:0;background:#FFFFFF;">
<div style="max-width:640px;margin:0 auto;padding:16px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:{_INK};">
  <div style="font-size:12px;color:{_MUTED};letter-spacing:.06em;text-transform:uppercase;">FactoryLM · PrintSense</div>
  <h1 style="font-size:20px;margin:4px 0 2px;">Print of the Day{" #" + f"{vm.sequence_number:03d}" if vm.sequence_number is not None else ""}</h1>
  <div style="font-size:15px;color:{_MUTED};margin-bottom:14px;">{escape(vm.title)} · {escape(vm.evaluation_date)}</div>

  <div style="background:{_CARD_BG};border:1px solid {_LINE};border-radius:10px;padding:16px;">
    <div style="font-size:13px;color:{_MUTED};text-transform:uppercase;letter-spacing:.06em;">Verdict</div>
    <div style="font-size:22px;font-weight:800;margin:2px 0;">{glyph} {escape(vm.verdict_label)}</div>
    <div style="font-size:15px;color:{_INK};">{escape(_claims_line(vm))}</div>
    <table role="presentation" style="width:100%;margin-top:12px;border-collapse:collapse;font-size:13px;">
      <tr>
        <td style="padding:4px 0;color:{_MUTED};">Accuracy</td><td style="text-align:right;font-weight:600;">{escape(str(d["accuracy"]))}</td>
        <td style="padding:4px 0 4px 12px;color:{_MUTED};">Honesty</td><td style="text-align:right;font-weight:600;">{escape(str(d["honesty"]))}</td>
      </tr>
      <tr>
        <td style="padding:4px 0;color:{_MUTED};">Evidence</td><td style="text-align:right;font-weight:600;">{escape(str(d["evidence"]))}</td>
        <td style="padding:4px 0 4px 12px;color:{_MUTED};">Safety</td><td style="text-align:right;font-weight:600;">{escape(str(d["safety"]))}</td>
      </tr>
      <tr>
        <td style="padding:4px 0;color:{_MUTED};">Rights</td><td style="text-align:right;font-weight:600;">{escape(str(d["rights"]))}</td>
        <td style="padding:4px 0 4px 12px;color:{_MUTED};">Promotion</td><td style="text-align:right;font-weight:600;">{"blocked" if vm.promotion_blocked else "reviewer approval"}</td>
      </tr>
    </table>
    {blocked_html}
  </div>

  <div style="margin:16px 0;">{img_html}</div>

  {blind_html}

  <h2 style="font-size:15px;color:{_MUTED};margin:20px 0 6px;">Key findings</h2>
  <ol style="margin:0;padding-left:18px;font-size:15px;line-height:1.5;">{findings_html}</ol>

  <h2 style="font-size:15px;color:{_MUTED};margin:22px 0 6px;">Review</h2>
  {_btn("Approve case", vm.actions.get("approve", ""))}
  {_btn("Request correction", vm.actions.get("correct", ""))}
  {_btn("Reject for promotion", vm.actions.get("reject", ""))}
  {_btn("Open full evidence report", vm.actions.get("report", "") or "reply:REPORT")}

  <div style="margin-top:24px;padding-top:12px;border-top:1px solid {_LINE};font-size:12px;color:{_MUTED};">
    <strong style="color:{_INK};">Pipeline health: {escape(h["status"].replace("_", " "))}.</strong> {health_msgs}
    <div style="margin-top:8px;">Pipeline status is not the model-quality grade.</div>
  </div>

  <div style="margin-top:12px;font-size:11px;color:{_MUTED};">
    case {escape(vm.case_id)} · report v{vm.report["version"]} · rights {escape(str(d["rights"]))} · template {escape(vm.template_versions["email"])}
  </div>
</div>
</div>"""
