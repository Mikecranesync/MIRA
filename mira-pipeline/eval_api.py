"""MIRA Eval API — /eval/latest endpoint.

Reads the most recent eval scorecard from EVAL_RUNS_DIR and serves it as
JSON (machine-readable) and HTML (human-readable).

Mounted in main.py:
    from eval_api import router as eval_router
    app.include_router(eval_router)

Env vars:
    EVAL_RUNS_DIR   Directory containing YYYY-MM-DDTHHMM.md scorecards.
                    Default: /eval-runs (mounted from /opt/mira/tests/eval/runs on VPS).
"""

from __future__ import annotations

import os
import re
from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import HTMLResponse, JSONResponse

router = APIRouter()

EVAL_RUNS_DIR = Path(os.getenv("EVAL_RUNS_DIR", "/eval-runs"))

# Minimal CSS for the HTML view — no external deps
_HTML_STYLE = """
<style>
  body { font-family: monospace; max-width: 900px; margin: 2rem auto; padding: 0 1rem; background: #0d1117; color: #c9d1d9; }
  h1 { color: #58a6ff; }
  h2 { color: #8b949e; border-bottom: 1px solid #30363d; padding-bottom: .25rem; }
  h3 { color: #f0883e; }
  table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
  th { background: #161b22; color: #8b949e; text-align: left; padding: .4rem .6rem; }
  td { padding: .4rem .6rem; border-top: 1px solid #21262d; }
  td:nth-child(n+2) { text-align: center; }
  .pass { color: #3fb950; font-weight: bold; }
  .fail { color: #f85149; font-weight: bold; }
  code { background: #161b22; padding: .15rem .3rem; border-radius: 3px; }
  blockquote { border-left: 3px solid #30363d; margin-left: 0; padding-left: 1rem; color: #8b949e; }
  pre { background: #161b22; padding: 1rem; border-radius: 6px; overflow-x: auto; }
</style>
"""


def _latest_scorecard() -> tuple[Path | None, str]:
    """Return (path, content) of the most recent scorecard, or (None, '')."""
    if not EVAL_RUNS_DIR.exists():
        return None, ""
    candidates = sorted(EVAL_RUNS_DIR.glob("*.md"), reverse=True)
    if not candidates:
        return None, ""
    p = candidates[0]
    return p, p.read_text()


def _parse_scorecard(content: str) -> dict:
    """Extract structured data from markdown scorecard."""
    result: dict = {
        "pass_rate": None,
        "total": None,
        "passed": None,
        "mode": None,
        "failures": [],
        "regressions": [],
        "recoveries": [],
        "scenarios": [],
    }

    # Pass rate: "**Pass rate:** 8/10 scenarios (80%)"
    m = re.search(r"\*\*Pass rate:\*\*\s*(\d+)/(\d+).*?\((\d+)%\)", content)
    if m:
        result["passed"] = int(m.group(1))
        result["total"] = int(m.group(2))
        result["pass_rate"] = int(m.group(3))

    # Mode
    m = re.search(r"\*\*Mode:\*\*\s*(\S+)", content)
    if m:
        result["mode"] = m.group(1)

    # Scenario rows: | `id` | PASS | PASS | FAIL | ... |
    for row in re.finditer(r"\|\s*`([\w_]+)`\s*\|(.*?)\|", content):
        sid = row.group(1)
        cells = [c.strip() for c in row.group(2).split("|")]
        result["scenarios"].append(
            {
                "id": sid,
                "checkpoints": cells[:5] if len(cells) >= 5 else cells,
                "score": cells[5] if len(cells) > 5 else None,
                "fsm_state": cells[6] if len(cells) > 6 else None,
            }
        )

    # Failures section
    for m in re.finditer(r"### ([\w_]+)\n(.*?)(?=###|\Z)", content, re.DOTALL):
        sid = m.group(1)
        body = m.group(2).strip()
        cp_fails = re.findall(r"\*\*(cp_\w+)\*\* FAILED: (.+)", body)
        resp_m = re.search(r"Last response: `(.+?)\.\.\.", body)
        result["failures"].append(
            {
                "id": sid,
                "checkpoint_failures": [{"name": n, "reason": r} for n, r in cp_fails],
                "last_response_preview": resp_m.group(1) if resp_m else None,
            }
        )

    # Delta
    reg_m = re.search(r"\*\*Regressions.*?\*\*\n(.*?)(?=\*\*Recoveries|\Z)", content, re.DOTALL)
    if reg_m:
        result["regressions"] = re.findall(r"- ([\w_]+)", reg_m.group(1))

    rec_m = re.search(r"\*\*Recoveries.*?\*\*\n(.*?)(?=##|\Z)", content, re.DOTALL)
    if rec_m:
        result["recoveries"] = re.findall(r"- ([\w_]+)", rec_m.group(1))

    return result


def _markdown_to_html(content: str, title: str) -> str:
    """Very lightweight markdown → HTML (tables, headers, bold, code, lists)."""
    lines = content.splitlines()
    html_lines: list[str] = [f"<html><head><title>{title}</title>{_HTML_STYLE}</head><body>"]
    in_table = False

    for line in lines:
        # Table row
        if line.strip().startswith("|"):
            if not in_table:
                html_lines.append("<table>")
                in_table = True
            if re.match(r"^\|[-| :]+\|$", line.strip()):
                continue  # separator row
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            is_header = not any(c in ("PASS", "FAIL") for c in cells)
            tag = "th" if is_header else "td"
            row = (
                "<tr>"
                + "".join(
                    f'<{tag}><span class="{c.lower() if c in ("PASS", "FAIL") else ""}">{c}</span></{tag}>'
                    for c in cells
                )
                + "</tr>"
            )
            html_lines.append(row)
            continue

        if in_table:
            html_lines.append("</table>")
            in_table = False

        # Headers
        if line.startswith("### "):
            html_lines.append(f"<h3>{line[4:]}</h3>")
        elif line.startswith("## "):
            html_lines.append(f"<h2>{line[3:]}</h2>")
        elif line.startswith("# "):
            html_lines.append(f"<h1>{line[2:]}</h1>")
        elif line.startswith("> "):
            html_lines.append(f"<blockquote>{line[2:]}</blockquote>")
        elif line.startswith("- "):
            body = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", line[2:])
            body = re.sub(r"`(.+?)`", r"<code>\1</code>", body)
            html_lines.append(f"<li>{body}</li>")
        elif line.startswith("---"):
            html_lines.append("<hr>")
        elif line.strip() == "":
            html_lines.append("<br>")
        else:
            body = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", line)
            body = re.sub(r"`(.+?)`", r"<code>\1</code>", body)
            body = re.sub(r"\*(.+?)\*", r"<em>\1</em>", body)
            html_lines.append(f"<p>{body}</p>")

    if in_table:
        html_lines.append("</table>")

    html_lines.append("</body></html>")
    return "\n".join(html_lines)


# ── Routes ────────────────────────────────────────────────────────────────────


@router.get("/eval/latest", tags=["eval"])
async def eval_latest(format: str = "json"):
    """Return the most recent eval scorecard.

    ?format=json  (default) — structured JSON
    ?format=html            — rendered HTML scorecard
    ?format=raw             — raw markdown
    """
    path, content = _latest_scorecard()

    if path is None:
        return JSONResponse(
            status_code=404,
            content={"error": "No scorecards found", "eval_runs_dir": str(EVAL_RUNS_DIR)},
        )

    if format == "html":
        html = _markdown_to_html(content, path.stem)
        return HTMLResponse(content=html)

    if format == "raw":
        from fastapi.responses import PlainTextResponse

        return PlainTextResponse(content=content, media_type="text/markdown")

    # JSON (default)
    parsed = _parse_scorecard(content)
    return JSONResponse(
        content={
            "scorecard_file": path.name,
            **parsed,
            "raw_url": "/eval/latest?format=raw",
            "html_url": "/eval/latest?format=html",
        }
    )


@router.get("/eval/list", tags=["eval"])
async def eval_list():
    """List all available eval scorecard files."""
    if not EVAL_RUNS_DIR.exists():
        return JSONResponse(content={"scorecards": [], "eval_runs_dir": str(EVAL_RUNS_DIR)})
    files = sorted(EVAL_RUNS_DIR.glob("*.md"), reverse=True)
    return JSONResponse(
        content={
            "count": len(files),
            "scorecards": [f.name for f in files],
        }
    )
