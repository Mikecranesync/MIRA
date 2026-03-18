#!/usr/bin/env python3
"""
MIRA Ingest Fallback Test Runner — standalone host script
Sends photos directly to mira-ingest endpoint (localhost:8002)
Scores results using 6-part pass condition
"""
import asyncio
import os
import sys
import time
import yaml
import httpx

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from judge import score
from report import write_report


async def run_ingest_fallback():
    """Run all cases via ingest endpoint."""
    HERE = os.path.dirname(os.path.abspath(__file__))
    manifest_path = os.path.join(HERE, "test_manifest.yaml")
    artifacts_dir = os.path.join(HERE, "..", "artifacts")

    with open(manifest_path) as f:
        data = yaml.safe_load(f)
        cases = data["cases"]

    print("[INGEST FALLBACK] No Telethon session detected. Using direct ingest endpoint.\n")

    results = []
    for case in cases:
        image_path = os.path.join(HERE, case["image"])
        caption = case.get("caption", "Identify this industrial component.")

        print(f"Testing {case['name']} via ingest endpoint...")
        t0 = time.time()
        reply = None
        elapsed = 0.0

        try:
            async with httpx.AsyncClient(timeout=60) as client:
                with open(image_path, "rb") as img:
                    resp = await client.post(
                        "http://localhost:8002/ingest/photo",
                        files={"image": (os.path.basename(image_path), img, "image/jpeg")},
                        data={"asset_tag": f"TEST-{case['name']}", "caption": caption}
                    )
            elapsed = time.time() - t0

            if resp.status_code == 200:
                data = resp.json()
                reply = data.get("description")
                if reply:
                    words = len(reply.split())
                    print(f"  Response ({words} words, {elapsed:.1f}s): {reply[:80]}...")
                else:
                    print(f"  HTTP 200 but no description field")
            else:
                print(f"  HTTP {resp.status_code}: {resp.text[:100]}")
        except Exception as e:
            print(f"  ERROR: {e}")

        result = score(case, reply, elapsed)
        result["image"] = case["image"]
        result["caption"] = caption
        result["reply"] = reply or "(no response)"
        results.append(result)

        status = "PASS ✅" if result["passed"] else f"FAIL ❌ [{result['failure_bucket']}]"
        print(f"  {status}\n")

    # Write report
    write_report(results, "@MIRABot-IngestFallback", dry_run=False, artifacts_dir=artifacts_dir)
    return results


if __name__ == "__main__":
    results = asyncio.run(run_ingest_fallback())
    passed = sum(1 for r in results if r["passed"])
    total = len(results)
    print(f"\nFinal: {passed}/{total} cases passed")
    sys.exit(0 if passed == total else 1)
