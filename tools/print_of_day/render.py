"""Print of the Day v2 — email + report renderer (PRD 9, 12, 14).

Renders a mobile-first, verdict-first email (HTML + plain-text) and the full
evidence report from ONE PODViewModel, so they can never disagree (PRD 19).

Email must survive real clients: single column, <=640px, table layout, INLINE
styles only (many clients strip <style>), no JS. Colors are the FactoryLM tokens
(docs/design/factorylm-tokens.css) inlined; status is always TEXT + a shape,
never color alone (.claude/rules/ui-style.md + PRD 14).
"""
from __future__ import annotations

import html as _html

# FactoryLM state tokens (inlined; muted normal, color = state only).
_INK = "#1f2937"
_MUTED = "#6b7280"
_LINE = "#e5e7eb"
_BG = "#f3f4f6"
_SURFACE = "#ffffff"
_OK, _OK_INK, _OK_BG = "#16a34a", "#15803d", "#f0fdf4"
_WARN, _WARN_BG = "#d97706", "#fffbeb"
_FAULT, _FAULT_BG = "#dc2626", "#fef2f2"
_OFF = "#6b7280"
_FONT = "'Segoe UI',system-ui,-apple-system,Arial,sans-serif"

# verdict -> (accent, ink, bg) state color
_STATE = {
    "gold_candidate": (_OK, _OK_INK, _OK_BG),
    "approved_gold": (_OK, _OK_INK, _OK_BG),
    "correction_required": (_WARN, _WARN, _WARN_BG),
    "hold_for_review": (_OFF, _OFF, _BG),
    "rejected": (_FAULT, _FAULT, _FAULT_BG),
    "unreadable": (_OFF, _OFF, _BG),
    "unsafe": (_FAULT, _FAULT, _FAULT_BG),
    "rights_blocked": (_FAULT, _FAULT, _FAULT_BG),
    "pipeline_degraded": (_OFF, _OFF, _BG),
}
_PIPELINE_LABEL = {"healthy": "Healthy", "degraded": "Degraded",
                   "manual_review_required": "Manual review required", "blocked": "Blocked"}


def _esc(s) -> str:
    return _html.escape(str(s), quote=True)


def render_subject(vm) -> str:
    return f"Print of the Day #{vm.sequence_number:03d} — {vm.title} — {vm.verdict_label()}"


def render_preheader(vm) -> str:
    cc = vm.claim_counts
    return (f"{cc['confirmed']} confirmed, {cc['incorrect']} incorrect, {cc['nuance']} nuance. "
            f"Review and approve in under 30 seconds.")


def _counts_line(vm) -> str:
    cc = vm.claim_counts
    return f"{cc['confirmed']} confirmed · {cc['incorrect']} incorrect · {cc['nuance']} nuance"


def _pipeline_messages(ph) -> list[str]:
    msgs: list[str] = []
    if ph.get("judge") == "manual_fallback":
        msgs.append("Independent LLM judge unavailable; hand review required.")
    elif ph.get("judge") and ph.get("judge") != "ok":
        msgs.append(f"Judge: {ph['judge']}.")
    if ph.get("ocr_crosscheck") == "unavailable":
        msgs.append("OCR cross-check unavailable.")
    msgs.extend(ph.get("messages", []) or [])
    return msgs


# ── HTML email ────────────────────────────────────────────────────────────────

def render_email_html(vm, image_cid: str | None = None) -> str:
    accent, ink, bg = _STATE[vm.verdict]
    dg = vm.dimension_grades
    box = f"max-width:640px;margin:0 auto;background:{_SURFACE};font-family:{_FONT};color:{_INK}"

    # verdict card (FIRST — verdict-first, FR-3)
    grade_cells = "".join(
        f'<td style="padding:6px 8px;border:1px solid {_LINE};text-align:center;font-size:12px">'
        f'<div style="color:{_MUTED};font-size:11px">{_esc(k.title())}</div>'
        f'<div style="font-weight:700">{_esc(str(v).upper() if len(str(v))==1 else str(v).title())}</div></td>'
        for k, v in (("accuracy", dg.get("accuracy")), ("evidence", dg.get("evidence")),
                     ("honesty", dg.get("honesty")), ("safety", dg.get("safety")),
                     ("rights", dg.get("rights")))
    )
    verdict_card = f"""
    <div style="border:2px solid {accent};background:{bg};border-radius:8px;padding:14px 16px;margin:16px">
      <div style="font-size:12px;color:{_MUTED};letter-spacing:.04em">VERDICT</div>
      <div style="font-size:22px;font-weight:800;color:{ink};margin:2px 0">
        <span aria-hidden="true">{vm.verdict_glyph()}</span> {_esc(vm.verdict_label())}</div>
      <div style="font-size:15px;color:{_INK}">{_esc(_counts_line(vm))}</div>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0"
             style="border-collapse:collapse;margin-top:10px"><tr>{grade_cells}</tr></table>
    </div>"""

    # source print (inline CID + alt; attachment is the fallback)
    if image_cid:
        img = (f'<img src="cid:{_esc(image_cid)}" width="100%" '
               f'style="max-width:608px;height:auto;border:1px solid {_LINE};border-radius:6px" '
               f'alt="Evaluated print: {_esc(vm.title)} — {_esc(vm.source.get("sheet_label",""))}">')
    else:
        img = (f'<div style="color:{_MUTED};font-size:13px">Evaluated print attached: '
               f'{_esc(vm.title)}.</div>')
    sheet = vm.source.get("sheet_label")
    print_block = f"""
    <div style="padding:0 16px 8px">
      <a href="cid:{_esc(image_cid)}" style="text-decoration:none">{img}</a>
      <div style="color:{_MUTED};font-size:12px;margin-top:4px">{_esc(sheet or "")} ·
        rights: {_esc(vm.source.get("rights_label",""))}</div>
    </div>""" if image_cid else f'<div style="padding:0 16px 8px">{img}</div>'

    # blind interpretation (labeled; verbatim, never rewritten)
    blind_block = f"""
    <div style="padding:8px 16px">
      <div style="font-size:12px;color:{_MUTED};text-transform:uppercase;letter-spacing:.03em">
        What PrintSense concluded before seeing the answer key</div>
      <div style="font-size:14px;line-height:1.5;margin-top:4px">{_esc(vm.blind_summary)}</div>
    </div>"""

    # up to three key findings
    finding_rows = []
    for i, f in enumerate(vm.key_findings, start=1):
        finding_rows.append(
            f'<li data-finding="{i}" style="margin:6px 0">'
            f'<strong>{_esc(f.type.title())}:</strong> {_esc(f.title)} — {_esc(f.summary)}</li>')
    findings_block = f"""
    <div style="padding:8px 16px">
      <div style="font-size:12px;color:{_MUTED};text-transform:uppercase;letter-spacing:.03em">Key findings</div>
      <ul style="margin:6px 0 0;padding-left:18px;font-size:14px;line-height:1.5">{''.join(finding_rows)}</ul>
    </div>"""

    # reviewer actions — reply commands (Phase 1)
    actions = ("APPROVE CASE", "CORRECT CASE: <comment>", "REJECT CASE: <reason>", "HOLD CASE")
    action_labels = ("Approve case", "Request correction", "Reject for promotion", "Hold for review")
    act_rows = "".join(
        f'<div style="border:1px solid {_LINE};border-radius:6px;padding:10px 12px;margin:6px 0;font-size:14px">'
        f'<strong>{_esc(lbl)}</strong> — reply <code style="background:{_BG};padding:1px 4px;border-radius:3px">{_esc(cmd)}</code></div>'
        for lbl, cmd in zip(action_labels, actions))
    actions_block = f"""
    <div style="padding:8px 16px">
      <div style="font-size:12px;color:{_MUTED};text-transform:uppercase;letter-spacing:.03em">Reviewer actions</div>
      {act_rows}
      <div style="font-size:13px;color:{_MUTED};margin-top:4px">Open full evidence report — attached to this email.</div>
    </div>"""

    # pipeline-health footer (AFTER actions; separated from grade — FR-10)
    ph = vm.pipeline_health
    ph_label = _PIPELINE_LABEL.get(ph.get("status", ""), ph.get("status", "").title())
    ph_msgs = " ".join(_esc(m) for m in _pipeline_messages(ph))
    pipeline_footer = f"""
    <div style="padding:10px 16px;background:{_BG};border-top:1px solid {_LINE};margin-top:8px">
      <div style="font-size:12px;color:{_MUTED}">
        <strong>Pipeline health:</strong> {_esc(ph_label)}. {ph_msgs}</div>
    </div>"""

    meta_footer = f"""
    <div style="padding:8px 16px;color:{_MUTED};font-size:11px;line-height:1.5">
      Case {_esc(vm.case_id)} · report v{_esc(vm.report.get("version"))} ·
      rights {_esc(dg.get("rights"))} · {_esc(vm.evaluation_date)} · template {_esc(vm.template_version)}.
      No auto-promotion — reviewer approval required.</div>"""

    header = f"""
    <div style="padding:16px 16px 0">
      <div style="font-size:12px;color:{_MUTED};letter-spacing:.06em">FACTORYLM · PRINTSENSE</div>
      <div style="font-size:18px;font-weight:700">Print of the Day #{vm.sequence_number:03d}</div>
      <div style="font-size:14px;color:{_MUTED}">{_esc(vm.title)}</div>
    </div>"""

    preheader = (f'<div style="display:none;max-height:0;overflow:hidden;opacity:0">'
                 f'{_esc(render_preheader(vm))}</div>')

    return (f'<div style="background:{_BG};padding:12px 0;font-family:{_FONT}">{preheader}'
            f'<div style="{box}">{header}{verdict_card}{print_block}{blind_block}'
            f'{findings_block}{actions_block}{pipeline_footer}{meta_footer}</div></div>')


# ── plain-text email (FR-9) ─────────────────────────────────────────────────────

def render_email_text(vm) -> str:
    dg = vm.dimension_grades
    lines = [
        f"PRINT OF THE DAY #{vm.sequence_number:03d} — {vm.title}",
        "",
        f"VERDICT: {vm.verdict_glyph()} {vm.verdict_label()}",
        _counts_line(vm),
        (f"Accuracy: {dg.get('accuracy')} · Evidence: {dg.get('evidence')} · "
         f"Honesty: {dg.get('honesty')} · Safety: {dg.get('safety')} · Rights: {dg.get('rights')}"),
        "",
        "What PrintSense concluded before seeing the answer key:",
        vm.blind_summary,
        "",
        "KEY FINDINGS:",
    ]
    for i, f in enumerate(vm.key_findings, start=1):
        lines.append(f"  {i}. {f.type.title()}: {f.title} — {f.summary}")
    lines += [
        "",
        "REVIEWER ACTIONS (reply with one command):",
        "  APPROVE CASE",
        "  CORRECT CASE: <comment>",
        "  REJECT CASE: <reason>",
        "  HOLD CASE",
        "  (Full evidence report is attached.)",
        "",
        "PIPELINE HEALTH: " + _PIPELINE_LABEL.get(vm.pipeline_health.get("status", ""),
                                                  vm.pipeline_health.get("status", "")),
    ]
    for m in _pipeline_messages(vm.pipeline_health):
        lines.append("  - " + m)
    lines += [
        "",
        (f"Case {vm.case_id} · report v{vm.report.get('version')} · rights {dg.get('rights')} · "
         f"{vm.evaluation_date}. No auto-promotion — reviewer approval required."),
    ]
    return "\n".join(lines)


# ── full evidence report (PRD 10) ───────────────────────────────────────────────

def render_report_html(vm, report_detail: dict | None = None) -> str:
    d = report_detail or {}
    accent, ink, bg = _STATE[vm.verdict]

    def sec(title, body):
        return (f'<h2 style="font-size:16px;border-bottom:1px solid {_LINE};padding-bottom:4px;'
                f'margin-top:22px">{_esc(title)}</h2>{body}')

    claims = d.get("claims") or []
    claim_rows = "".join(
        f'<tr><td style="border:1px solid {_LINE};padding:6px">{_esc(c.get("claim",""))}</td>'
        f'<td style="border:1px solid {_LINE};padding:6px">{_esc(c.get("status",""))}</td>'
        f'<td style="border:1px solid {_LINE};padding:6px">{_esc(c.get("truth",""))}</td></tr>'
        for c in claims)
    claim_table = (f'<table style="border-collapse:collapse;width:100%;font-size:13px">'
                   f'<tr><th style="border:1px solid {_LINE};padding:6px;text-align:left">Claim</th>'
                   f'<th style="border:1px solid {_LINE};padding:6px">Status</th>'
                   f'<th style="border:1px solid {_LINE};padding:6px;text-align:left">Truth</th></tr>'
                   f'{claim_rows}</table>') if claims else "<p>(see claim summary)</p>"

    body = "".join([
        f'<div style="font-family:{_FONT};color:{_INK};max-width:820px;margin:0 auto;padding:16px">',
        f'<h1 style="font-size:20px">Print of the Day #{vm.sequence_number:03d} — {_esc(vm.title)}</h1>',
        f'<div style="display:inline-block;border:2px solid {accent};background:{bg};color:{ink};'
        f'border-radius:6px;padding:4px 10px;font-weight:700">'
        f'<span aria-hidden="true">{vm.verdict_glyph()}</span> {_esc(vm.verdict_label())} · {_esc(_counts_line(vm))}</div>',
        sec("1 · Case identity & source", f'<p>Case {_esc(vm.case_id)} · {_esc(vm.evaluation_date)} · '
            f'source sha256 {_esc(vm.source.get("sha256"))} · rights {_esc(vm.source.get("rights_label"))}.</p>'),
        sec("2 · Blind interpretation (immutable, verbatim)",
            f'<pre style="white-space:pre-wrap;background:{_BG};padding:10px;border-radius:6px;'
            f'font-size:13px">{_esc(d.get("blind_verbatim","(not recorded)"))}</pre>'),
        sec("3 · Withheld answer key", f'<div style="font-size:14px">{_esc(d.get("answer_key","(not recorded)"))}</div>'),
        sec("4 · Claim-by-claim comparison", claim_table),
        sec("5 · Safety analysis", f'<p>{_esc(d.get("safety","(not recorded)"))}</p>'),
        sec("6 · Corrected interpretation", f'<p>{_esc(d.get("corrected","(not recorded)"))}</p>'),
        sec("7 · Reusable lessons", f'<p>{_esc(d.get("lessons","(not recorded)"))}</p>'),
        sec("8 · Pipeline health", f'<p>{_esc(vm.pipeline_health.get("status"))} — '
            f'{_esc(" ".join(_pipeline_messages(vm.pipeline_health)))}</p>'),
        sec("9 · Provenance & versions",
            f'<p>report v{_esc(vm.report.get("version"))} · report sha256 {_esc(vm.report.get("sha256"))} · '
            f'template {_esc(vm.template_version)} · {_esc(d.get("versions",""))}</p>'),
        "</div>",
    ])
    return body
