"""AgentReport — unified human-readable output for all MIRA digital employees.

Every agent call ends with report.save() which produces:
  - A Markdown file (always, at /opt/mira/reports/{agent}/{YYYY-MM-DD}_{agent}.md)
  - An HTML dashboard (single file, inline CSS, works on phone + desktop)
  - Optional Telegram summary (if TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID set)

Usage:
    from mira_crawler.reporting.agent_report import AgentReport

    report = AgentReport("morning-brief")
    report.add_metric("Overnight WOs", 3, trend="up")
    report.add_alert("ok", "No safety events")
    report.add_table("Work Orders", rows=[...], columns=["WO#", "Asset", "Priority"])
    report.add_action("Review overdue PM on Line 3")
    report.save()          # writes .md + .html, optionally pushes Telegram
    report.save(html=False)  # markdown only
"""

from __future__ import annotations

import html as html_module
import json
import logging
import os
import textwrap
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

logger = logging.getLogger("agent_report")

DEFAULT_REPORT_DIR = Path(os.environ.get("MIRA_REPORT_DIR", "/opt/mira/reports"))
TREND_ARROW = {"up": "▲", "down": "▼", "flat": "─", None: ""}
LEVEL_EMOJI = {"ok": "🟢", "warning": "🟡", "critical": "🔴"}
LEVEL_CSS   = {"ok": "status-ok", "warning": "status-warn", "critical": "status-crit"}


@dataclass
class Metric:
    name: str
    value: Any
    unit: str = ""
    trend: Literal["up", "down", "flat"] | None = None
    note: str = ""


@dataclass
class Table:
    title: str
    columns: list[str]
    rows: list[list[Any]]


@dataclass
class Chart:
    title: str
    chart_type: Literal["bar", "line", "pie"]
    data: dict[str, float]   # label -> value


@dataclass
class Alert:
    level: Literal["ok", "warning", "critical"]
    message: str


@dataclass
class Section:
    heading: str
    body: str    # markdown-formatted free text


class AgentReport:
    def __init__(self, agent_name: str, run_date: datetime | None = None) -> None:
        self.agent_name = agent_name
        self.run_date = run_date or datetime.now(timezone.utc)
        self.title: str = agent_name.replace("-", " ").title()
        self.subtitle: str = ""
        self.overall_status: Literal["ok", "warning", "critical"] = "ok"
        self.metrics: list[Metric] = []
        self.tables: list[Table] = []
        self.charts: list[Chart] = []
        self.alerts: list[Alert] = []
        self.actions: list[str] = []
        self.sections: list[Section] = []

    # ── Builder API ───────────────────────────────────────────────────────────

    def set_title(self, title: str, subtitle: str = "") -> "AgentReport":
        self.title = title
        self.subtitle = subtitle
        return self

    def set_status(self, level: Literal["ok", "warning", "critical"]) -> "AgentReport":
        self.overall_status = level
        return self

    def add_metric(
        self,
        name: str,
        value: Any,
        unit: str = "",
        trend: Literal["up", "down", "flat"] | None = None,
        note: str = "",
    ) -> "AgentReport":
        self.metrics.append(Metric(name=name, value=value, unit=unit, trend=trend, note=note))
        return self

    def add_table(self, title: str, rows: list[list[Any]], columns: list[str]) -> "AgentReport":
        self.tables.append(Table(title=title, columns=columns, rows=rows))
        return self

    def add_chart(
        self, title: str, chart_type: Literal["bar", "line", "pie"], data: dict[str, float]
    ) -> "AgentReport":
        self.charts.append(Chart(title=title, chart_type=chart_type, data=data))
        return self

    def add_alert(self, level: Literal["ok", "warning", "critical"], message: str) -> "AgentReport":
        self.alerts.append(Alert(level=level, message=message))
        if level == "critical" and self.overall_status != "critical":
            self.overall_status = "critical"
        elif level == "warning" and self.overall_status == "ok":
            self.overall_status = "warning"
        return self

    def add_action(self, description: str) -> "AgentReport":
        self.actions.append(description)
        return self

    def add_section(self, heading: str, body: str) -> "AgentReport":
        self.sections.append(Section(heading=heading, body=body))
        return self

    # ── Markdown rendering ────────────────────────────────────────────────────

    def to_markdown(self) -> str:
        date_str = self.run_date.strftime("%B %-d, %Y")
        status_emoji = LEVEL_EMOJI[self.overall_status]
        parts: list[str] = []

        parts.append(f"# {self.title}\n")
        if self.subtitle:
            parts.append(f"_{self.subtitle}_\n")
        parts.append(f"**{date_str}** · {status_emoji} {self.overall_status.upper()}\n")

        # Alerts
        if self.alerts:
            parts.append("\n## Status\n")
            for a in self.alerts:
                parts.append(f"{LEVEL_EMOJI[a.level]} {a.message}  ")
            parts.append("")

        # Metrics table
        if self.metrics:
            parts.append("\n## Key Metrics\n")
            parts.append("| Metric | Value | Trend |")
            parts.append("|--------|-------|-------|")
            for m in self.metrics:
                val = f"{m.value} {m.unit}".strip()
                arrow = TREND_ARROW[m.trend]
                note = f" _{m.note}_" if m.note else ""
                parts.append(f"| {m.name} | {val}{note} | {arrow} |")
            parts.append("")

        # Charts (ASCII bar)
        for ch in self.charts:
            parts.append(f"\n### {ch.title}\n")
            parts.append(_ascii_bar(ch.data))

        # Tables
        for t in self.tables:
            parts.append(f"\n## {t.title}\n")
            parts.append("| " + " | ".join(str(c) for c in t.columns) + " |")
            parts.append("|" + "|".join("---" for _ in t.columns) + "|")
            for row in t.rows:
                parts.append("| " + " | ".join(str(c) for c in row) + " |")
            parts.append("")

        # Free-text sections
        for s in self.sections:
            parts.append(f"\n## {s.heading}\n")
            parts.append(s.body)

        # Actions
        parts.append("\n## Actions for Mike\n")
        if self.actions:
            for i, a in enumerate(self.actions, 1):
                parts.append(f"{i}. {a}")
        else:
            parts.append("- None ✓")

        footer_ts = self.run_date.strftime("%Y-%m-%dT%H:%M:%SZ")
        parts.append(f"\n---\n_Generated {footer_ts} by {self.agent_name}_\n")
        return "\n".join(parts)

    # ── HTML rendering ────────────────────────────────────────────────────────

    def to_html(self) -> str:
        date_str = self.run_date.strftime("%B %-d, %Y")
        ts_str = self.run_date.strftime("%Y-%m-%dT%H:%M:%SZ")
        status_emoji = LEVEL_EMOJI[self.overall_status]
        status_css = LEVEL_CSS[self.overall_status]

        inner = ""

        # Status bar
        inner += f'<div class="status-bar {status_css}">{status_emoji} {self.overall_status.upper()}</div>\n'
        if self.subtitle:
            inner += f'<p class="subtitle">{html_module.escape(self.subtitle)}</p>\n'

        # Alerts
        if self.alerts:
            inner += '<div class="alerts">\n'
            for a in self.alerts:
                inner += f'<div class="alert alert-{a.level}">{LEVEL_EMOJI[a.level]} {html_module.escape(a.message)}</div>\n'
            inner += '</div>\n'

        # Metric cards
        if self.metrics:
            inner += '<div class="metrics-grid">\n'
            for m in self.metrics:
                val_str = f"{m.value} {m.unit}".strip()
                arrow = TREND_ARROW[m.trend]
                arrow_cls = f"trend-{m.trend}" if m.trend else ""
                note_html = f'<span class="metric-note">{html_module.escape(m.note)}</span>' if m.note else ""
                inner += textwrap.dedent(f"""\
                    <div class="metric-card">
                      <div class="metric-name">{html_module.escape(m.name)}</div>
                      <div class="metric-value">{html_module.escape(val_str)}</div>
                      <div class="metric-trend {arrow_cls}">{arrow}</div>
                      {note_html}
                    </div>
                """)
            inner += '</div>\n'

        # Charts
        for ch in self.charts:
            inner += f'<div class="section"><h2>{html_module.escape(ch.title)}</h2>\n'
            inner += _svg_bar(ch.data)
            inner += '</div>\n'

        # Tables
        for t in self.tables:
            inner += f'<div class="section"><h2>{html_module.escape(t.title)}</h2>\n'
            inner += '<div class="table-wrap"><table>\n<thead><tr>'
            for col in t.columns:
                inner += f'<th>{html_module.escape(str(col))}</th>'
            inner += '</tr></thead>\n<tbody>\n'
            for row in t.rows:
                inner += '<tr>'
                for cell in row:
                    inner += f'<td>{html_module.escape(str(cell))}</td>'
                inner += '</tr>\n'
            inner += '</tbody></table></div></div>\n'

        # Free-text sections
        for s in self.sections:
            safe_body = html_module.escape(s.body).replace("\n", "<br>")
            inner += f'<div class="section"><h2>{html_module.escape(s.heading)}</h2><p>{safe_body}</p></div>\n'

        # Actions
        inner += '<div class="section actions-section">\n<h2>Actions for Mike</h2>\n'
        if self.actions:
            inner += '<ol class="action-list">\n'
            for a in self.actions:
                inner += f'<li>{html_module.escape(a)}</li>\n'
            inner += '</ol>\n'
        else:
            inner += '<p class="no-actions">✓ No action required</p>\n'
        inner += '</div>\n'

        return _HTML_TEMPLATE.format(
            title=html_module.escape(self.title),
            date_str=html_module.escape(date_str),
            ts_str=html_module.escape(ts_str),
            agent_name=html_module.escape(self.agent_name),
            status_css=status_css,
            inner=inner,
        )

    # ── Telegram summary ──────────────────────────────────────────────────────

    def to_telegram(self) -> str:
        status_emoji = LEVEL_EMOJI[self.overall_status]
        date_str = self.run_date.strftime("%b %-d")
        lines = [f"*{self.title}* — {date_str} {status_emoji}"]
        if self.subtitle:
            lines.append(f"_{self.subtitle}_")
        lines.append("")
        for m in self.metrics[:5]:
            arrow = TREND_ARROW[m.trend]
            val = f"{m.value} {m.unit}".strip()
            lines.append(f"• {m.name}: *{val}* {arrow}".strip())
        if self.alerts:
            lines.append("")
            for a in self.alerts:
                lines.append(f"{LEVEL_EMOJI[a.level]} {a.message}")
        if self.actions:
            lines.append("")
            lines.append("*Actions:*")
            for a in self.actions:
                lines.append(f"→ {a}")
        return "\n".join(lines)

    def _push_telegram(self) -> bool:
        token = os.environ.get("TELEGRAM_BOT_TOKEN", "")
        chat_id = os.environ.get("TELEGRAM_REPORT_CHAT_ID", os.environ.get("TELEGRAM_CHAT_ID", ""))
        if not token or not chat_id:
            return False
        try:
            import urllib.request
            text = self.to_telegram()
            payload = json.dumps({
                "chat_id": chat_id,
                "text": text,
                "parse_mode": "Markdown",
            }).encode()
            req = urllib.request.Request(
                f"https://api.telegram.org/bot{token}/sendMessage",
                data=payload,
                headers={"Content-Type": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                ok = json.loads(resp.read()).get("ok", False)
                if ok:
                    logger.info("Telegram summary sent")
                return ok
        except Exception as exc:
            logger.warning("Telegram push failed: %s", exc)
            return False

    # ── Save ─────────────────────────────────────────────────────────────────

    def save(
        self,
        output_dir: str | Path | None = None,
        html: bool = True,
        telegram: bool = True,
    ) -> dict[str, Path]:
        base = Path(output_dir) if output_dir else DEFAULT_REPORT_DIR
        slug = self.agent_name.lower().replace(" ", "-")
        date_slug = self.run_date.strftime("%Y-%m-%d")
        out_dir = base / slug
        out_dir.mkdir(parents=True, exist_ok=True)

        stem = f"{date_slug}_{slug}"
        md_path = out_dir / f"{stem}.md"
        html_path = out_dir / f"{stem}.html"

        md_path.write_text(self.to_markdown(), encoding="utf-8")
        logger.info("Report saved: %s", md_path)

        paths: dict[str, Path] = {"markdown": md_path}

        if html:
            html_path.write_text(self.to_html(), encoding="utf-8")
            logger.info("HTML report saved: %s", html_path)
            paths["html"] = html_path

        if telegram:
            self._push_telegram()

        return paths

    def save_local(self, output_dir: str | Path = "reports") -> dict[str, Path]:
        """Convenience wrapper that saves to a local relative path."""
        return self.save(output_dir=output_dir, telegram=False)


# ── ASCII bar chart ──────────────────────────────────────────────────────────

def _ascii_bar(data: dict[str, float], width: int = 30) -> str:
    if not data:
        return "_No data_\n"
    max_val = max(data.values()) or 1
    lines = ["```"]
    label_w = max(len(k) for k in data) + 1
    for label, val in data.items():
        bar_len = int(val / max_val * width)
        bar = "█" * bar_len
        lines.append(f"{label:<{label_w}} {bar} {val:.1f}")
    lines.append("```")
    return "\n".join(lines) + "\n"


# ── SVG bar chart ────────────────────────────────────────────────────────────

def _svg_bar(data: dict[str, float]) -> str:
    if not data:
        return "<p><em>No data</em></p>"
    items = list(data.items())
    max_val = max(v for _, v in items) or 1
    bar_h = 160
    bar_w = max(40, min(80, 520 // len(items)))
    gap = 8
    pad_l, pad_b = 8, 40
    total_w = len(items) * (bar_w + gap) + pad_l
    total_h = bar_h + pad_b + 20
    bars = ""
    for i, (label, val) in enumerate(items):
        x = pad_l + i * (bar_w + gap)
        h = int(val / max_val * bar_h)
        y = bar_h - h + 10
        pct = f"{val:.1f}%"
        safe_label = html_module.escape(label[:12])
        safe_pct = html_module.escape(pct)
        bars += (
            f'<rect x="{x}" y="{y}" width="{bar_w}" height="{h}" rx="4" fill="#2563eb" opacity="0.85"/>\n'
            f'<text x="{x + bar_w//2}" y="{y - 4}" text-anchor="middle" font-size="11" fill="#374151">{safe_pct}</text>\n'
            f'<text x="{x + bar_w//2}" y="{bar_h + 24}" text-anchor="middle" font-size="10" fill="#6b7280">{safe_label}</text>\n'
        )
    return (
        f'<div class="chart-wrap">'
        f'<svg viewBox="0 0 {total_w} {total_h}" xmlns="http://www.w3.org/2000/svg" '
        f'style="width:100%;max-width:{total_w}px;height:auto">'
        f'{bars}</svg></div>\n'
    )


# ── HTML template ─────────────────────────────────────────────────────────────

_HTML_TEMPLATE = """\
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title>
<style>
  :root {{
    --bg: #f8fafc; --surface: #fff; --border: #e2e8f0;
    --text: #0f172a; --muted: #64748b; --brand: #2563eb;
    --ok: #16a34a; --warn: #d97706; --crit: #dc2626;
    --ok-bg: #dcfce7; --warn-bg: #fef3c7; --crit-bg: #fee2e2;
    --radius: 12px; --shadow: 0 1px 4px rgba(0,0,0,.08);
  }}
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{ font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
          background: var(--bg); color: var(--text); line-height: 1.6; }}
  a {{ color: var(--brand); }}

  .page {{ max-width: 860px; margin: 0 auto; padding: 16px; }}

  /* Header */
  .header {{ background: var(--brand); color: #fff; border-radius: var(--radius);
             padding: 24px 28px 20px; margin-bottom: 20px; }}
  .header h1 {{ font-size: clamp(1.2rem,4vw,1.8rem); font-weight: 700; }}
  .header .meta {{ opacity: .8; font-size: .85rem; margin-top: 4px; }}

  /* Status bar */
  .status-bar {{ display: inline-block; font-weight: 700; font-size: .9rem;
                 padding: 5px 14px; border-radius: 99px; margin-bottom: 12px; }}
  .status-ok   {{ background: var(--ok-bg);   color: var(--ok); }}
  .status-warn {{ background: var(--warn-bg); color: var(--warn); }}
  .status-crit {{ background: var(--crit-bg); color: var(--crit); }}
  .subtitle {{ color: var(--muted); font-size: .9rem; margin-bottom: 16px; }}

  /* Alerts */
  .alerts {{ display: flex; flex-direction: column; gap: 8px; margin-bottom: 20px; }}
  .alert {{ padding: 10px 14px; border-radius: 8px; font-size: .9rem; font-weight: 500; }}
  .alert-ok   {{ background: var(--ok-bg);   color: var(--ok); }}
  .alert-warning {{ background: var(--warn-bg); color: var(--warn); }}
  .alert-critical {{ background: var(--crit-bg); color: var(--crit); }}

  /* Metric cards */
  .metrics-grid {{ display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 12px; margin-bottom: 20px; }}
  .metric-card {{ background: var(--surface); border: 1px solid var(--border);
                  border-radius: var(--radius); padding: 16px 14px;
                  box-shadow: var(--shadow); }}
  .metric-name  {{ font-size: .75rem; color: var(--muted); text-transform: uppercase;
                   letter-spacing: .05em; margin-bottom: 6px; }}
  .metric-value {{ font-size: 1.5rem; font-weight: 700; color: var(--text); }}
  .metric-trend {{ font-size: .85rem; margin-top: 4px; }}
  .trend-up   {{ color: var(--ok); }}
  .trend-down {{ color: var(--crit); }}
  .trend-flat {{ color: var(--muted); }}
  .metric-note {{ font-size: .7rem; color: var(--muted); display: block; margin-top: 4px; }}

  /* Sections */
  .section {{ background: var(--surface); border: 1px solid var(--border);
              border-radius: var(--radius); padding: 20px;
              box-shadow: var(--shadow); margin-bottom: 16px; }}
  .section h2 {{ font-size: 1rem; font-weight: 600; color: var(--text);
                 margin-bottom: 14px; padding-bottom: 8px;
                 border-bottom: 1px solid var(--border); }}

  /* Tables */
  .table-wrap {{ overflow-x: auto; }}
  table {{ width: 100%; border-collapse: collapse; font-size: .875rem; }}
  th {{ background: var(--bg); color: var(--muted); font-weight: 600;
        font-size: .75rem; text-transform: uppercase; letter-spacing: .04em;
        padding: 8px 10px; text-align: left; white-space: nowrap; }}
  td {{ padding: 9px 10px; border-top: 1px solid var(--border); vertical-align: top; }}
  tr:hover td {{ background: #f1f5f9; }}

  /* Charts */
  .chart-wrap {{ width: 100%; overflow-x: auto; margin-top: 8px; }}

  /* Actions */
  .actions-section {{ border-left: 4px solid var(--brand); }}
  .action-list {{ padding-left: 20px; }}
  .action-list li {{ padding: 4px 0; font-size: .9rem; }}
  .no-actions {{ color: var(--ok); font-weight: 600; }}

  /* Footer */
  .footer {{ text-align: center; font-size: .75rem; color: var(--muted);
             padding: 24px 0 12px; }}

  @media (max-width: 480px) {{
    .metrics-grid {{ grid-template-columns: repeat(2, 1fr); }}
    .metric-value {{ font-size: 1.2rem; }}
    .header {{ padding: 18px 16px; }}
  }}
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <h1>{title}</h1>
    <div class="meta">{date_str} · {agent_name}</div>
  </div>
  <div class="body">
{inner}
  </div>
  <div class="footer">Generated {ts_str} by {agent_name} · FactoryLM</div>
</div>
</body>
</html>
"""
