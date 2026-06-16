"""
Playwright-driven verification for v2 video output.

Loads the final MP4 in headless Chromium, seeks to the midpoint of every
narration beat, and screenshots — so we can confirm the camera is parked
at the expected focal at each beat. Generates an HTML report alongside
the screenshots so a reviewer can scan beat-by-beat at a glance.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger("comic.v2.verify")


def build_expectations(*, manifest: dict, storyboard: dict) -> list[dict[str, Any]]:
    """Compute (timestamp, expected focal, narration) for each beat midpoint.

    `manifest` is the build_manifest.json saved by build_video_v2.py and
    contains the actual measured beat audio durations + pauses.
    """
    beats_data = manifest["beats"]
    pauses = manifest["pauses"]

    flat_focals: list[dict[str, Any]] = []
    for shot in storyboard["shots"]:
        for beat in shot["beats"]:
            flat_focals.append({
                "focal": beat["focal"],
                "target": beat["target"],
                "narration": beat["text"],
            })
    if len(flat_focals) != len(beats_data):
        raise RuntimeError(
            f"manifest has {len(beats_data)} beats but storyboard has {len(flat_focals)}"
        )

    expectations: list[dict[str, Any]] = []
    cumulative = 0.0
    for i, b in enumerate(beats_data):
        # Probe the MIDDLE of the narration portion — camera should be parked
        # at focal_in (no panning yet; pan only kicks in during the trailing pause).
        mid_t = cumulative + b["duration"] / 2.0
        expectations.append({
            "timestamp": round(mid_t, 3),
            "shot_id": b["shot_id"],
            "beat_index": b["beat_index"],
            "expected_focal": flat_focals[i]["focal"],
            "expected_target": flat_focals[i]["target"],
            "narration": b["text"],
        })
        cumulative += b["duration"] + pauses[i]
    return expectations


def run_verification(
    *,
    video_path: Path,
    expectations: list[dict[str, Any]],
    out_dir: Path,
) -> dict[str, Any]:
    """Spawn headless Chromium, capture a screenshot per expectation, write report.

    Imported lazily so the rest of the pipeline doesn't pay the playwright
    import cost (~200ms) on every run.
    """
    from playwright.sync_api import sync_playwright

    out_dir.mkdir(parents=True, exist_ok=True)
    shots_dir = out_dir / "frames"
    shots_dir.mkdir(exist_ok=True)

    # Embed the video at exact 1920x1080 so playwright's locator screenshot
    # captures the full frame (no scaling artifacts from CSS resize).
    html = (
        "<!DOCTYPE html><html><head><meta charset='utf-8'><title>verify</title>"
        "<style>body{margin:0;background:black;}"
        "video{width:1920px;height:1080px;display:block;}</style>"
        "</head><body>"
        f"<video id='v' src='{video_path.as_uri()}' preload='auto' muted></video>"
        "</body></html>"
    )
    html_path = out_dir / "player.html"
    html_path.write_text(html)

    results: dict[str, Any] = {
        "video_path": str(video_path),
        "expectations_total": len(expectations),
        "screenshots": [],
        "metadata": {},
    }

    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(
            viewport={"width": 1920, "height": 1080},
            device_scale_factor=1,
        )
        page = ctx.new_page()
        logger.info("[verify] navigating to %s", html_path.name)
        page.goto(html_path.as_uri())

        # Wait for HAVE_CURRENT_DATA (readyState >= 2) so we can seek.
        page.wait_for_function(
            "document.getElementById('v').readyState >= 2",
            timeout=30_000,
        )
        # Probe the loaded video metadata for the JSON record.
        meta = page.evaluate(
            "() => { const v = document.getElementById('v'); "
            "return {duration: v.duration, videoWidth: v.videoWidth, "
            "videoHeight: v.videoHeight, error: v.error ? v.error.code : null}; }"
        )
        results["metadata"] = meta
        logger.info(
            "[verify] video loaded: %.2fs, %dx%d, error=%s",
            meta["duration"], meta["videoWidth"], meta["videoHeight"], meta["error"],
        )

        for exp in expectations:
            t = float(exp["timestamp"])
            page.evaluate(f"document.getElementById('v').currentTime = {t}")
            page.wait_for_function(
                f"document.getElementById('v').readyState >= 2 && "
                f"Math.abs(document.getElementById('v').currentTime - {t}) < 0.1",
                timeout=10_000,
            )
            # Force a paint then settle one frame.
            page.wait_for_timeout(250)

            shot_path = shots_dir / (
                f"t{t:06.2f}_shot{exp['shot_id']}_beat{exp['beat_index']}.png"
            )
            page.locator("#v").screenshot(path=str(shot_path))
            logger.info("[verify] t=%.2fs shot %s beat %s -> %s",
                        t, exp["shot_id"], exp["beat_index"], shot_path.name)
            results["screenshots"].append({
                **exp,
                "screenshot_path": str(shot_path),
            })

        browser.close()

    (out_dir / "verification.json").write_text(json.dumps(results, indent=2))
    _write_html_report(results, out_dir / "report.html")
    return results


def _write_html_report(results: dict[str, Any], out_path: Path) -> None:
    rows: list[str] = []
    for s in results["screenshots"]:
        rel = Path(s["screenshot_path"]).name
        focal = s["expected_focal"]
        focal_str = (
            f"cx={focal['cx']:.3f} cy={focal['cy']:.3f} zoom={focal['zoom']:.2f}"
        )
        rows.append(
            "<tr>"
            f"<td><b>{s['timestamp']:.2f}s</b></td>"
            f"<td>shot {s['shot_id']}<br/>beat {s['beat_index']}</td>"
            f"<td><b>{s['expected_target']}</b><br/>"
            f"<small>{focal_str}</small><br/><br/>"
            f"<i>{s['narration']}</i></td>"
            f'<td><img src="frames/{rel}" style="width:480px;border:1px solid #444"/></td>'
            "</tr>"
        )
    meta = results.get("metadata", {})
    html = (
        "<!DOCTYPE html><html><head><meta charset='utf-8'>"
        "<title>v2 verification report</title>"
        "<style>body{font:13px -apple-system,monospace;max-width:1280px;margin:24px auto;padding:0 16px;}"
        "table{width:100%;border-collapse:collapse;}"
        "td,th{padding:10px;vertical-align:top;border-bottom:1px solid #ccc;text-align:left;}"
        "th{background:#222;color:#eee;}"
        "h1{margin-bottom:4px;}.meta{color:#666;margin-bottom:24px;}</style>"
        "</head><body>"
        "<h1>MIRA Comic v2 — verification report</h1>"
        f"<div class='meta'>video: {results['video_path']}<br/>"
        f"loaded duration: {meta.get('duration', 0):.2f}s · "
        f"resolution: {meta.get('videoWidth', 0)}×{meta.get('videoHeight', 0)} · "
        f"error: {meta.get('error', 'none')} · "
        f"frames captured: {len(results['screenshots'])}/{results['expectations_total']}"
        "</div><table>"
        "<tr><th>t</th><th>id</th><th>expected · narration</th><th>actual frame</th></tr>"
        + "".join(rows) + "</table></body></html>"
    )
    out_path.write_text(html)
