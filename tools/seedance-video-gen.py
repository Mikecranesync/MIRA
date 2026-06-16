#!/usr/bin/env python3
"""MIRA Demo Video Generator — Seedance 2.0 via BytePlus ModelArk API.

Usage:
  python3 tools/seedance-video-gen.py --scenario qr-scan-demo
  python3 tools/seedance-video-gen.py --scenario vfd-fault-diagnosis --resolution 1080p
  python3 tools/seedance-video-gen.py --prompt "Custom prompt here" --duration 10
  python3 tools/seedance-video-gen.py --list
  python3 tools/seedance-video-gen.py --batch all
  python3 tools/seedance-video-gen.py --scenario qr-scan-demo --dry-run
"""
from __future__ import annotations

import argparse
import base64
import json
import logging
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests
import yaml

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("seedance")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

REPO_ROOT = Path(__file__).parent.parent
SCENARIOS_FILE = REPO_ROOT / "tools" / "seedance-scenarios.yaml"
VIDEO_OUT_DIR = REPO_ROOT / "marketing" / "videos"
SPEND_LOG = VIDEO_OUT_DIR / "spend.json"

API_BASE = "https://ark.ap-southeast.byteplus.com/api/v3"
MODEL = "seedance-1-0-lite-t2v-250428"  # Seedance 2.0 / ModelArk endpoint

# Approximate cost table: (resolution, seconds) → USD
COST_TABLE: dict[tuple[str, int], float] = {
    ("720p", 5): 0.05,
    ("720p", 10): 0.09,
    ("720p", 15): 0.13,
    ("1080p", 5): 0.09,
    ("1080p", 8): 0.14,
    ("1080p", 10): 0.18,
    ("1080p", 12): 0.22,
    ("1080p", 15): 0.27,
}

POLL_INTERVAL = 10   # seconds between status checks
JOB_TIMEOUT = 180    # 3 minutes max per job


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def load_scenarios() -> dict:
    with open(SCENARIOS_FILE) as f:
        return yaml.safe_load(f)["scenarios"]


def estimate_cost(resolution: str, duration: int) -> float:
    # Find closest match in cost table
    key = (resolution, duration)
    if key in COST_TABLE:
        return COST_TABLE[key]
    # Interpolate from nearest lower duration
    durations = [d for (r, d) in COST_TABLE if r == resolution]
    if not durations:
        return 0.0
    nearest = max(d for d in durations if d <= duration) if any(d <= duration for d in durations) else min(durations)
    base_cost = COST_TABLE.get((resolution, nearest), 0.18)
    return round(base_cost * duration / nearest, 3)


def encode_image(path: Path) -> str | None:
    if not path.exists():
        log.warning("Reference image not found: %s", path)
        return None
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode()


def build_payload(scenario: dict, resolution: str | None = None, duration: int | None = None) -> dict:
    res = resolution or scenario.get("resolution", "1080p")
    dur = duration or scenario.get("duration", 10)
    aspect = scenario.get("aspect_ratio", "16:9")

    # Map resolution string to width/height
    res_map = {
        "720p": (1280, 720),
        "1080p": (1920, 1080),
    }
    width, height = res_map.get(res, (1920, 1080))

    payload: dict = {
        "model": MODEL,
        "content": [
            {
                "type": "text",
                "text": scenario["prompt"],
            }
        ],
        "parameters": {
            "duration": dur,
            "resolution": f"{width}x{height}",
            "aspect_ratio": aspect,
            "fps": 24,
        },
    }

    if "negative_prompt" in scenario:
        payload["parameters"]["negative_prompt"] = scenario["negative_prompt"]

    # Attach reference images
    refs = scenario.get("references", [])
    for ref in refs:
        img_path = REPO_ROOT / ref["path"]
        b64 = encode_image(img_path)
        if b64:
            payload["content"].append({
                "type": "image_url",
                "image_url": {
                    "url": f"data:image/png;base64,{b64}",
                    "role": ref.get("role", "reference"),
                },
            })
            log.info("  Attached reference image: %s", ref["path"])
        else:
            log.warning("  Skipping missing reference: %s", ref["path"])

    return payload, res, dur


def submit_job(api_key: str, payload: dict) -> str:
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    resp = requests.post(f"{API_BASE}/contents/generations/tasks", json=payload, headers=headers, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    task_id = data.get("id") or data.get("task_id")
    if not task_id:
        raise ValueError(f"No task_id in response: {data}")
    return task_id


def poll_job(api_key: str, task_id: str) -> dict:
    headers = {"Authorization": f"Bearer {api_key}"}
    deadline = time.time() + JOB_TIMEOUT
    attempt = 0

    while time.time() < deadline:
        attempt += 1
        resp = requests.get(
            f"{API_BASE}/contents/generations/tasks/{task_id}",
            headers=headers,
            timeout=30,
        )

        if resp.status_code == 429:
            wait = min(60, 5 * 2**attempt)
            log.warning("Rate limited — waiting %ds before retry", wait)
            time.sleep(wait)
            continue

        resp.raise_for_status()
        data = resp.json()
        status = data.get("status", "").lower()
        log.info("  Job %s: %s (attempt %d)", task_id[:12], status, attempt)

        if status in ("succeeded", "completed"):
            return data
        if status in ("failed", "cancelled"):
            raise RuntimeError(f"Job {task_id} ended with status: {status}\n{data}")

        time.sleep(POLL_INTERVAL)

    raise TimeoutError(f"Job {task_id} did not complete within {JOB_TIMEOUT}s")


def download_video(result: dict, output_path: Path) -> None:
    # Extract video URL from result — field name varies by API version
    video_url = (
        result.get("video_url")
        or result.get("output", {}).get("video_url")
        or (result.get("content", [{}])[0] or {}).get("video_url")
    )
    if not video_url:
        raise ValueError(f"No video_url in result: {json.dumps(result, indent=2)[:500]}")

    log.info("Downloading video → %s", output_path)
    resp = requests.get(video_url, timeout=120, stream=True)
    resp.raise_for_status()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "wb") as f:
        for chunk in resp.iter_content(chunk_size=8192):
            f.write(chunk)
    size_kb = output_path.stat().st_size // 1024
    log.info("Saved: %s (%d KB)", output_path, size_kb)


def log_spend(scenario_name: str, resolution: str, duration: int, cost: float, output_path: Path) -> None:
    SPEND_LOG.parent.mkdir(parents=True, exist_ok=True)
    records = []
    if SPEND_LOG.exists():
        with open(SPEND_LOG) as f:
            records = json.load(f)
    records.append({
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "scenario": scenario_name,
        "resolution": resolution,
        "duration": duration,
        "cost_usd": cost,
        "output": str(output_path),
    })
    with open(SPEND_LOG, "w") as f:
        json.dump(records, f, indent=2)
    total = sum(r["cost_usd"] for r in records)
    log.info("Spend logged. Session cost: $%.3f | All-time total: $%.3f", cost, total)


def run_scenario(
    api_key: str,
    scenario_name: str,
    scenario: dict,
    resolution: str | None = None,
    duration: int | None = None,
    dry_run: bool = False,
) -> Path | None:
    log.info("=== Scenario: %s ===", scenario_name)
    payload, res, dur = build_payload(scenario, resolution, duration)
    cost = estimate_cost(res, dur)

    log.info("Resolution: %s | Duration: %ds | Est. cost: $%.3f", res, dur, cost)

    if dry_run:
        print("\n--- DRY RUN PAYLOAD ---")
        # Truncate base64 image data for readability
        display = json.loads(json.dumps(payload))
        for item in display.get("content", []):
            if item.get("type") == "image_url":
                url = item["image_url"]["url"]
                item["image_url"]["url"] = url[:60] + f"... [{len(url)} chars]"
        print(json.dumps(display, indent=2))
        print(f"\nEstimated cost: ${cost:.3f}")
        print("--- END DRY RUN ---\n")
        return None

    log.info("Submitting job...")
    task_id = submit_job(api_key, payload)
    log.info("Task ID: %s", task_id)

    result = poll_job(api_key, task_id)

    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
    output_path = VIDEO_OUT_DIR / f"{scenario_name}-{ts}.mp4"
    download_video(result, output_path)
    log_spend(scenario_name, res, dur, cost, output_path)
    return output_path


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="MIRA Seedance 2.0 Video Generator")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--scenario", help="Scenario name from seedance-scenarios.yaml")
    mode.add_argument("--prompt", help="Custom text prompt (bypasses scenario config)")
    mode.add_argument("--list", action="store_true", help="List available scenarios")
    mode.add_argument("--batch", metavar="SCENARIOS", help="Comma-separated scenario names, or 'all'")

    parser.add_argument("--resolution", choices=["720p", "1080p"], help="Override resolution")
    parser.add_argument("--duration", type=int, help="Override duration in seconds")
    parser.add_argument("--dry-run", action="store_true", help="Print payload without submitting")
    args = parser.parse_args()

    scenarios = load_scenarios()

    if args.list:
        print("\nAvailable scenarios:\n")
        total_cost = 0.0
        for name, cfg in scenarios.items():
            res = cfg.get("resolution", "1080p")
            dur = cfg.get("duration", 10)
            cost = estimate_cost(res, dur)
            total_cost += cost
            refs = [r["path"] for r in cfg.get("references", [])]
            ref_str = f" | refs: {refs}" if refs else ""
            print(f"  {name:<22} {res} {dur}s  ~${cost:.3f}{ref_str}")
        print(f"\n  Total if all generated at listed resolutions: ~${total_cost:.3f}\n")
        return

    api_key = os.environ.get("BYTEPLUS_API_KEY", "")
    if not api_key and not args.dry_run:
        sys.exit(
            "BYTEPLUS_API_KEY not set.\n"
            "Set it via: doppler secrets set BYTEPLUS_API_KEY=<key> --project factorylm --config prd\n"
            "Then run: doppler run --project factorylm --config prd -- python3 tools/seedance-video-gen.py ...\n"
            "Or use --dry-run to test without submitting."
        )

    VIDEO_OUT_DIR.mkdir(parents=True, exist_ok=True)

    if args.prompt:
        scenario_name = "custom"
        scenario = {
            "prompt": args.prompt,
            "duration": args.duration or 10,
            "resolution": args.resolution or "1080p",
            "aspect_ratio": "16:9",
        }
        run_scenario(api_key, scenario_name, scenario, args.resolution, args.duration, args.dry_run)

    elif args.scenario:
        if args.scenario not in scenarios:
            sys.exit(f"Unknown scenario '{args.scenario}'. Use --list to see available scenarios.")
        run_scenario(api_key, args.scenario, scenarios[args.scenario], args.resolution, args.duration, args.dry_run)

    elif args.batch:
        names = list(scenarios.keys()) if args.batch == "all" else [s.strip() for s in args.batch.split(",")]
        unknown = [n for n in names if n not in scenarios]
        if unknown:
            sys.exit(f"Unknown scenarios: {unknown}. Use --list to see available scenarios.")
        for name in names:
            try:
                run_scenario(api_key, name, scenarios[name], args.resolution, args.duration, args.dry_run)
            except Exception as e:
                log.error("Scenario %s failed: %s — continuing batch", name, e)


if __name__ == "__main__":
    main()
