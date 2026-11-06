"""Offline evidence-package integrity; does not run a live acceptance test."""
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
acceptance = json.loads((HERE / "acceptance.json").read_text())
journey = json.loads((HERE / "browser-journey.json").read_text())
manifest = json.loads((HERE / "screenshots.json").read_text())
assert acceptance["live"]["workflows"] == ["BLOCKED", "BLOCKED", "FAIL", "BLOCKED", "BLOCKED", "BLOCKED"]
assert acceptance["live"]["newLiveTestsRun"] is False
assert not any(acceptance[k] for k in ("mergeReady", "deployed", "humanAccepted"))
assert len(acceptance["practice"]["workflows"]) == 6
for entry in manifest:
    path = HERE / entry["file"]
    assert hashlib.sha256(path.read_bytes()).hexdigest() == entry["sha256"], path
    archive = HERE.parents[1] / "promo-screenshots" / ("2026-11-06_cv101-walkthrough_" + path.name)
    assert archive.read_bytes() == path.read_bytes(), archive
for i in range(1, 7):
    for suffix, size in (("desktop", [1440, 900]), ("mobile", [412, 915])):
        assert next(e for e in manifest if e["file"] == f"workflow-{i}-{suffix}.jpg")["dimensions"] == size
assert journey["reloadReceipt"]["sameJob"] is True
mobile = next(e for e in journey["receipts"] if e.get("viewport") == "412x915" and e["workflow"] == 6)
assert mobile["same"] and mobile["before"] == mobile["after"]
assert journey["mobileMetrics"]["pageWidth"] == 412
assert journey["focus"]["escapeKeptOuterDialog"] is True
assert "memory only" in journey["negative"]["deniedWrite"]
assert "unreadable" in journey["negative"]["corruptRead"]
assert "No saved practice job" in journey["negative"]["otherViewer"]
requests = json.loads((HERE / "browser-requests.json").read_text())
assert not requests["truncated"] and not requests["hasMore"]
assert all(r["method"] == "GET" and r["url"].startswith("http://127.0.0.1:55821/") for r in requests["requests"])
assert not journey["finalSessionLogs"]
back = json.loads((HERE / "review-fix-browser.json").read_text())
assert back["red"]["outerVisible"] is False
assert back["green"]["outerVisible"] is True and back["green"]["sourceVisible"] is False
assert back["green"]["focus"] == "Open supporting manual citation"
assert back["same"] and back["secondBack"]["outerVisible"] is False
print(f"Evidence integrity PASS: {len(manifest)} screenshot hashes/archives; six desktop/mobile workflows; reload, negative cases and separate live blockers. Not live proof.")
