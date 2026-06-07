#!/usr/bin/env python3
"""Render the orchestrator artifact HTML from state.json.

Outputs: wiki/orchestrator/artifact.html — a self-contained light-mode HTML
document that embeds the current state. The scheduled task re-runs scan + score
+ render every 4h and pushes the updated HTML via mcp__cowork__update_artifact.
"""
from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path

# Repo root = two levels up from tools/orchestrator/. MIRA_DIR env var overrides
# (Cowork sets it); fall back to the detected root so the routine runs anywhere.
REPO_ROOT = Path(__file__).resolve().parents[2]
mira = Path(os.environ.get("MIRA_DIR") or REPO_ROOT)
state = json.loads((mira / "wiki" / "orchestrator" / "state.json").read_text())
out = mira / "wiki" / "orchestrator" / "artifact.html"

# Inline the state as JS — Grid.js will render from it.
state_js = json.dumps(state)

generated_at = state.get("rendered_at", datetime.utcnow().isoformat())
counts = state.get("counts", {})
streams = state.get("streams", [])
drift = state.get("drift_alerts", [])

# Top 3
ships = [s for s in streams if s["decision"] == "SHIP"][:3]
finishes = [s for s in streams if s["decision"] == "FINISH"][:3]
top3 = ships + (finishes if len(ships) < 3 else [])
top3 = top3[:3]

HTML = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MIRA Orchestrator</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/gridjs@5.0.2/dist/theme/mermaid.min.css" integrity="sha384-jZvDSsmGB9oGGT/4l9bHXGoAv1OxvG/cFmSo0dZaSqmBgvQTKDBFAMftlXTmMbNW" crossorigin="anonymous">
<script src="https://cdn.jsdelivr.net/npm/gridjs@5.0.2/dist/gridjs.umd.js" integrity="sha384-/XXDzxe4FsGiAe50i/u9pY/Vy/uX654MHB1xoc1BJNnH1WXHhqHga9g3q5tF4gj7" crossorigin="anonymous"></script>
<style>
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #fafafa; color: #1a1a1a; }
.wrap { max-width: 1200px; margin: 0 auto; padding: 16px; }
header { display: flex; justify-content: space-between; align-items: baseline; padding-bottom: 12px; border-bottom: 1px solid #e3e3e3; margin-bottom: 16px; }
h1 { font-size: 18px; margin: 0; font-weight: 600; }
h2 { font-size: 14px; margin: 16px 0 8px; font-weight: 600; color: #555; letter-spacing: 0.02em; text-transform: uppercase; }
.ts { font-size: 12px; color: #888; }
.north-star { background: #1a1a1a; color: #fff; padding: 10px 14px; border-radius: 6px; margin-bottom: 16px; font-weight: 500; }
.counts { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 16px; }
.chip { padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: 600; }
.chip.SHIP   { background: #d1f5d1; color: #0a5d0a; }
.chip.FINISH { background: #fde9c8; color: #7a4d00; }
.chip.GATE   { background: #ffe1e1; color: #8a1f1f; }
.chip.DEFER  { background: #e0e7ff; color: #2a3990; }
.chip.KILL   { background: #f0f0f0; color: #555; }
.top3 { background: #fffce8; border-left: 3px solid #f0b800; padding: 12px 14px; border-radius: 4px; margin-bottom: 14px; }
.top3 .move { font-weight: 500; margin: 4px 0; }
.top3 code { background: rgba(0,0,0,0.05); padding: 1px 5px; border-radius: 3px; font-size: 12.5px; }
.drift { background: #fff3f3; border-left: 3px solid #d44; padding: 8px 14px; border-radius: 4px; margin-bottom: 14px; font-size: 13px; }
.drift .alert.info { color: #444; }
.drift .alert.warn { color: #8a1f1f; font-weight: 500; }
.tabs { display: flex; gap: 4px; border-bottom: 1px solid #ddd; margin-bottom: 12px; }
.tab { padding: 8px 14px; cursor: pointer; border: 0; background: transparent; font-size: 13px; font-weight: 500; color: #777; border-bottom: 2px solid transparent; }
.tab.active { color: #1a1a1a; border-bottom-color: #1a1a1a; }
.tab .count { color: #999; margin-left: 4px; font-weight: 400; }
.grid-host { background: #fff; border: 1px solid #e3e3e3; border-radius: 6px; padding: 8px; }
.gridjs-wrapper { box-shadow: none; }
.gridjs-th, .gridjs-td { padding: 8px 10px !important; font-size: 12.5px !important; }
.gridjs-th { background: #fafafa !important; }
.btn { padding: 6px 12px; font-size: 12px; border: 1px solid #ccc; background: #fff; border-radius: 4px; cursor: pointer; }
.btn:hover { background: #f5f5f5; }
.subj { color: #555; }
.footer { margin-top: 24px; font-size: 11px; color: #999; padding-top: 12px; border-top: 1px solid #eee; }
</style>
</head>
<body>
<div class="wrap">
<header>
  <div>
    <h1>MIRA Orchestrator</h1>
    <div class="ts" id="ts"></div>
  </div>
  <button class="btn" id="refreshBtn">Refresh now</button>
</header>

<div class="north-star">North Star: <strong>First paying customer.</strong> Everything off this path is debt.</div>

<div class="counts" id="counts"></div>

<h2>Top 3 moves (next hour)</h2>
<div class="top3" id="top3"></div>

<h2>Drift alerts</h2>
<div class="drift" id="drift"></div>

<h2>Work streams</h2>
<div class="tabs" id="tabs"></div>
<div class="grid-host" id="grid"></div>

<div class="footer">
  Generated by <code>tools/orchestrator/score.py</code> from <code>scan.json</code>.
  Source of truth: <code>wiki/orchestrator/state.json</code>.
  Append-only log: <code>wiki/orchestrator/HISTORY.md</code>.
  Doctrine: <code>.claude/skills/product-orchestrator/SKILL.md</code>.
</div>
</div>

<script>
const STATE = __STATE_JSON__;

function fmtTime(iso){
  try{ const d=new Date(iso); return d.toLocaleString(); }catch(e){ return iso; }
}

document.getElementById("ts").textContent = "Last scanned: " + fmtTime(STATE.rendered_at);

// counts chips
const order = ["SHIP","FINISH","GATE","DEFER","KILL"];
const countsEl = document.getElementById("counts");
order.forEach(k => {
  const v = STATE.counts[k] || 0;
  const span = document.createElement("span");
  span.className = "chip " + k;
  span.textContent = k + " " + v;
  countsEl.appendChild(span);
});

// top 3
const top3El = document.getElementById("top3");
const top3 = (STATE.streams.filter(s => s.decision === "SHIP").slice(0,3));
const need = 3 - top3.length;
if (need > 0) top3.push(...STATE.streams.filter(s => s.decision === "FINISH").slice(0, need));
if (top3.length === 0) {
  top3El.textContent = "Nothing actionable on the money path right now. Pick a FINISH-tier stream below.";
} else {
  top3.forEach(s => {
    const div = document.createElement("div");
    div.className = "move";
    div.innerHTML = `<strong>${s.decision}</strong> <code>${s.repo}/${s.id}</code> — ${escapeHtml(s.rationale)}`;
    top3El.appendChild(div);
  });
}

// drift alerts
const driftEl = document.getElementById("drift");
if (!STATE.drift_alerts.length) {
  driftEl.textContent = "No drift alerts.";
} else {
  STATE.drift_alerts.forEach(a => {
    const div = document.createElement("div");
    div.className = "alert " + a.severity;
    div.textContent = `[${a.severity.toUpperCase()}] ${a.repo}: ${a.message}`;
    driftEl.appendChild(div);
  });
}

// tabs + grid — default to the highest-priority bucket that actually has rows,
// so a snapshot never opens on an empty tab (SHIP is structurally often 0).
let currentTab = order.find(k => (STATE.counts[k] || 0) > 0) || "DEFER";
const tabsEl = document.getElementById("tabs");
order.forEach(k => {
  const count = (STATE.counts[k] || 0);
  const btn = document.createElement("button");
  btn.className = "tab" + (k === currentTab ? " active" : "");
  btn.innerHTML = `${k}<span class="count">${count}</span>`;
  btn.dataset.decision = k;
  btn.onclick = () => { currentTab = k; drawTabs(); drawGrid(); };
  tabsEl.appendChild(btn);
});
function drawTabs(){
  Array.from(tabsEl.children).forEach(b => {
    b.classList.toggle("active", b.dataset.decision === currentTab);
  });
}

let gridInstance = null;
function drawGrid(){
  const host = document.getElementById("grid");
  host.innerHTML = "";
  const rows = STATE.streams
    .filter(s => s.decision === currentTab)
    .map(s => [
      s.repo,
      s.kind,
      s.id,
      (s.subject || "").slice(0, 90),
      s.money_path_score,
      s.readiness_score,
      s.age_days,
      s.rationale
    ]);
  gridInstance = new gridjs.Grid({
    columns: [
      "Repo",
      "Kind",
      "ID",
      { name: "Subject", formatter: c => gridjs.html(`<span class="subj">${escapeHtml(c)}</span>`) },
      { name: "$/5", width: "60px" },
      { name: "Ready/5", width: "80px" },
      { name: "Age (d)", width: "75px" },
      "Rationale"
    ],
    data: rows,
    sort: true,
    search: true,
    pagination: { limit: 25 },
    style: { table: { fontSize: "12.5px" } },
  }).render(host);
}
drawGrid();

document.getElementById("refreshBtn").onclick = async () => {
  const btn = document.getElementById("refreshBtn");
  btn.textContent = "Refreshing…";
  btn.disabled = true;
  try {
    // Trigger the scheduled task by name; if the user hasn't created it yet, this is a no-op.
    if (window.cowork && window.cowork.runScheduledTask) {
      await window.cowork.runScheduledTask("orchestrator-pulse");
    }
    btn.textContent = "Queued — will refresh on next scan";
  } catch (e) {
    btn.textContent = "Refresh failed: " + (e.message || e);
  } finally {
    setTimeout(() => { btn.textContent = "Refresh now"; btn.disabled = false; }, 3000);
  }
};

function escapeHtml(s){
  if (s == null) return "";
  return String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
}
</script>
</body>
</html>
"""

out.write_text(HTML.replace("__STATE_JSON__", state_js))
print(f"artifact rendered: {out}")
print(f"size: {out.stat().st_size} bytes")
