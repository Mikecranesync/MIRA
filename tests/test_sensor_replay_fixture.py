"""tools/qa/sensor_replay_fixture.py — the pure `rekey` step.

Pins the contract the S5 Sensor acceptance relies on: the CV-101 e-stop fixture is
re-keyed to a caller-supplied tenant, relative event spacing is preserved, the batch
is the canonical `ingest_contract` shape (source_system='ignition' so it matches the
`approved_tags_conveyor.sql` allowlist), and no fixture-owned identity leaks through.
No DB, no network.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
TOOL = REPO / "tools" / "qa" / "sensor_replay_fixture.py"
FIXTURE = REPO / "mira-crawler" / "tests" / "fixtures" / "machine_memory" / "cv101_estop.json"
TENANT = "9dd9145e-8591-4718-b0c5-97f1b88dde17"

spec = importlib.util.spec_from_file_location("sensor_replay_fixture", TOOL)
mod = importlib.util.module_from_spec(spec)
sys.modules["sensor_replay_fixture"] = mod
spec.loader.exec_module(mod)  # type: ignore[union-attr]


def _stamps(batch: dict) -> list[datetime]:
    return [datetime.fromisoformat(t["ts"]) for t in batch["tags"]]


def test_rekey_is_canonical_ignition_batch_for_the_caller_tenant():
    batch = mod.rekey(FIXTURE, TENANT, minutes_ago=20)
    rows = json.loads(FIXTURE.read_text(encoding="utf-8"))

    assert batch["source_system"] == "ignition"
    assert batch["tenant_id"] == TENANT
    assert len(batch["tags"]) == len(rows) == 12
    # Every fixture tag survives, in order, with its typed value + quality.
    assert [t["tag_path"] for t in batch["tags"]] == [r["tag_path"] for r in rows]
    assert [t["value"] for t in batch["tags"]] == [r["value"] for r in rows]
    assert {t["value_type"] for t in batch["tags"]} == {"bool", "float", "int"}
    assert all(t["quality"] == "good" for t in batch["tags"])
    # The fixture's own tenant / uns_path never ride along — the allowlist resolves uns_path.
    for t in batch["tags"]:
        assert "tenant_id" not in t and "uns_path" not in t
        assert t["metadata"]["replay_fixture"] == "cv101_estop.json"


def test_rekey_preserves_relative_spacing_and_anchors_last_event():
    before = datetime.now(timezone.utc)
    batch = mod.rekey(FIXTURE, TENANT, minutes_ago=20)
    after = datetime.now(timezone.utc)

    stamps = _stamps(batch)
    orig = [datetime.fromisoformat(r["event_timestamp"]) for r in json.loads(FIXTURE.read_text())]
    # Same deltas as the fixture (5 s cadence, 20 s gap before the e-stop trip).
    assert [s - stamps[0] for s in stamps] == [o - orig[0] for o in orig]
    assert stamps[-1] - stamps[0] == timedelta(seconds=70)
    # The LAST event lands `minutes_ago` before now (within the call's own wall time).
    assert before - timedelta(minutes=20) <= stamps[-1] <= after - timedelta(minutes=20)
    # The e-stop trip (the anchor S4 /history should find) is the 11th event, at +65 s.
    trip = next(
        t
        for t in batch["tags"]
        if t["tag_path"] == "default_conveyor_estop_active" and t["value"] == "true"
    )
    assert datetime.fromisoformat(trip["ts"]) - stamps[0] == timedelta(seconds=65)
