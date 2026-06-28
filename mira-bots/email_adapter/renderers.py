"""Email HTML renderer — NormalizedChatResponse → mobile-friendly HTML email.

Returns a (plain_text, html) tuple.
plain_text is the multipart/alternative fallback.
html is a fully self-contained document with inline CSS (600px max-width,
MIRA branding, and a reply CTA footer).
"""

from __future__ import annotations

import html as _html

from shared.chat.types import NormalizedChatResponse, ResponseBlock

_LOGO_URL = "https://app.factorylm.com/static/mira-avatar.png"

_STYLE = (
    "body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;"
    "background:#f5f5f5;margin:0;padding:20px 0}"
    ".wrap{max-width:600px;margin:0 auto;background:#fff;border-radius:8px;"
    "overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.1)}"
    ".hdr{background:#1E40AF;padding:20px 24px}"
    ".hdr-inner{display:flex;align-items:center;gap:12px}"
    ".hdr img{width:40px;height:40px;border-radius:50%}"
    ".hdr h1{color:#fff;font-size:18px;margin:0;font-weight:600}"
    ".hdr p{color:#93C5FD;font-size:12px;margin:2px 0 0}"
    ".body{padding:24px}"
    ".bh{font-size:18px;font-weight:700;color:#111827;margin:0 0 16px;"
    "padding-bottom:8px;border-bottom:2px solid #E5E7EB}"
    ".bp{color:#374151;line-height:1.6;margin:0 0 16px;white-space:pre-wrap}"
    ".bkv{border:1px solid #E5E7EB;border-radius:6px;overflow:hidden;margin:0 0 16px}"
    ".bkv table{width:100%;border-collapse:collapse}"
    ".bkv td{padding:8px 12px;font-size:14px}"
    ".bkv tr:nth-child(even) td{background:#F9FAFB}"
    ".kk{color:#6B7280;font-weight:500;width:40%}"
    ".kv{color:#111827}"
    ".bw{background:#FEF3C7;border-left:4px solid #D97706;padding:12px 16px;"
    "border-radius:0 6px 6px 0;margin:0 0 16px;color:#92400E}"
    ".bc{background:#1E293B;color:#E2E8F0;padding:16px;border-radius:6px;"
    "font-family:'Courier New',monospace;font-size:13px;overflow-x:auto;"
    "margin:0 0 16px;white-space:pre-wrap}"
    ".bci{color:#6B7280;font-size:12px;font-style:italic;margin:0 0 8px;"
    "padding-left:12px;border-left:3px solid #D1D5DB}"
    ".bhr{border:none;border-top:1px solid #E5E7EB;margin:16px 0}"
    ".bl{color:#374151;line-height:1.8;padding-left:20px;margin:0 0 16px}"
    ".ft{background:#F9FAFB;padding:16px 24px;text-align:center;"
    "font-size:12px;color:#6B7280;border-top:1px solid #E5E7EB}"
    ".ft a{color:#1E40AF;text-decoration:none}"
    ".cta{background:#EFF6FF;border:1px solid #BFDBFE;border-radius:6px;"
    "padding:12px 16px;margin:16px 0 0;font-size:13px;color:#1E40AF}"
    ".fb{color:#374151;line-height:1.6;white-space:pre-wrap}"
)


def render_email(
    response: NormalizedChatResponse,
    subject: str = "MIRA Response",
) -> tuple[str, str]:
    """Return (plain_text, html) for a NormalizedChatResponse."""
    plain = response.text

    if response.blocks:
        body_html = _render_blocks(response.blocks)
    else:
        body_html = f'<div class="fb">{_e(response.text)}</div>'

    cta = '<div class="cta">💬 Reply to this email to continue your conversation with MIRA.</div>'

    full_html = (
        "<!DOCTYPE html>\n"
        '<html lang="en">\n'
        "<head>"
        '<meta charset="UTF-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        f"<title>{_e(subject)}</title>"
        f"<style>{_STYLE}</style>"
        "</head>\n"
        "<body>"
        '<div class="wrap">'
        '<div class="hdr">'
        '<div class="hdr-inner">'
        f'<img src="{_LOGO_URL}" alt="MIRA">'
        "<div><h1>MIRA</h1><p>AI Maintenance Copilot</p></div>"
        "</div></div>"
        '<div class="body">'
        f"{body_html}"
        f"{cta}"
        "</div>"
        '<div class="ft">'
        'Powered by <a href="https://factorylm.com">FactoryLM</a> · '
        '<a href="https://factorylm.com/privacy">Privacy</a>'
        "</div>"
        "</div>"
        "</body></html>"
    )

    return plain, full_html


def _e(text: str) -> str:
    return _html.escape(str(text))


def _render_blocks(blocks: list[ResponseBlock]) -> str:
    return "\n".join(_render_block(b) for b in blocks)


def _render_block(block: ResponseBlock) -> str:
    d = block.data
    k = block.kind

    if k == "header":
        return f'<h2 class="bh">{_e(d.get("text", ""))}</h2>'

    if k == "paragraph":
        return f'<p class="bp">{_e(d.get("text", ""))}</p>'

    if k == "bullet_list":
        items = "".join(f"<li>{_e(str(i))}</li>" for i in d.get("items", []))
        return f'<ul class="bl">{items}</ul>'

    if k == "key_value":
        rows = "".join(
            f'<tr><td class="kk">{_e(str(p[0]))}</td><td class="kv">{_e(str(p[1]))}</td></tr>'
            for p in d.get("pairs", [])
        )
        return f'<div class="bkv"><table>{rows}</table></div>'

    if k == "warning":
        return f'<div class="bw">⚠️ {_e(d.get("text", ""))}</div>'

    if k == "code":
        return f'<div class="bc">{_e(d.get("code", ""))}</div>'

    if k == "citation":
        return f'<div class="bci">📎 {_e(d.get("source", ""))}</div>'

    if k == "divider":
        return '<hr class="bhr">'

    return ""
