"""TEMP staging integration test — mock_tag_stream -> relay -> tag_events.

Run under staging Doppler:
    doppler run -p factorylm -c stg -- /opt/homebrew/bin/python3.12 tools/_staging_integ.py

Seeds approved_tags for a throwaway UUID tenant, starts the REAL relay
(RELAY_TAG_EVENTS=1) in a thread, runs mock_tag_stream against it, verifies
rows land in staging tag_events, then deletes everything it created.
Not committed — delete after.
"""
from __future__ import annotations

import importlib.util
import os
import pathlib
import re
import subprocess
import sys
import threading
import time

import httpx
import yaml
from sqlalchemy import create_engine, text

REPO = pathlib.Path(__file__).resolve().parent.parent
RELAY_DIR = REPO / "mira-relay"
SCENARIO = REPO / "tools" / "scenarios" / "conveyor_flicker.yaml"
TENANT = "11111111-1111-1111-1111-111111111111"  # throwaway test tenant
EQUIP = "CONV-001"  # must match scenario equipment_id
KEY = "stg-integ-test-key"
PORT = 8799

DB_URL = os.getenv("NEON_DATABASE_URL") or os.getenv("DATABASE_URL")
assert DB_URL, "no staging DB url in env (run under doppler -c stg)"
engine = create_engine(DB_URL, connect_args={"sslmode": "require"}, pool_pre_ping=True)


def _seg(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")


def seed_approved_tags() -> int:
    scn = yaml.safe_load(SCENARIO.read_text())
    dt_map = {"bool": "bool", "int": "int", "float": "float", "fault": "enum"}
    rows = []
    for tag in scn["tags"]:
        rows.append({
            "tenant_id": TENANT,
            "tag_id": f"{EQUIP}.{tag['name']}",
            "uns_path": f"enterprise.garage.demo_cell.conveyor.gs10.{_seg(tag['name'])}",
            "data_type": dt_map.get(tag.get("type", "bool"), "enum"),
        })
    with engine.begin() as c:
        for r in rows:
            c.execute(text("""
                INSERT INTO approved_tags (tenant_id, tag_id, uns_path, data_type)
                VALUES (:tenant_id, :tag_id, CAST(:uns_path AS ltree), :data_type)
                ON CONFLICT (tenant_id, tag_id) DO UPDATE
                  SET uns_path = EXCLUDED.uns_path, data_type = EXCLUDED.data_type
            """), r)
    return len(rows)


def start_relay() -> "object":
    os.environ["RELAY_TAG_EVENTS"] = "1"
    os.environ["RELAY_API_KEY"] = KEY
    os.environ["RELAY_LEGACY_BEARER"] = "1"
    os.environ["MIRA_DB_PATH"] = "/tmp/relay_integ.db"  # writable local sqlite for equipment_status cache
    sys.path.insert(0, str(RELAY_DIR))
    spec = importlib.util.spec_from_file_location("relay_server", RELAY_DIR / "relay_server.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # type: ignore
    import uvicorn

    config = uvicorn.Config(mod.app, host="127.0.0.1", port=PORT, log_level="warning")
    server = uvicorn.Server(config)
    threading.Thread(target=server.run, daemon=True).start()
    for _ in range(40):
        try:
            if httpx.get(f"http://127.0.0.1:{PORT}/health", timeout=1).status_code == 200:
                return server
        except Exception:
            pass
        time.sleep(0.25)
    raise RuntimeError("relay did not come up")


def run_mock() -> str:
    tmp = REPO / "tools" / "scenarios" / "_integ_tmp.yaml"
    text_body = SCENARIO.read_text()
    text_body = re.sub(r"tenant_id:\s*\S+", f"tenant_id: {TENANT}", text_body, count=1)
    tmp.write_text(text_body)
    try:
        out = subprocess.run(
            [sys.executable, "-m", "tools.mock_tag_stream",
             "--scenario", str(tmp), "--relay-url", f"http://127.0.0.1:{PORT}",
             "--relay-api-key", KEY, "--once"],
            cwd=str(REPO), capture_output=True, text=True, timeout=180,
        )
        return (out.stdout + out.stderr)[-800:]
    finally:
        tmp.unlink(missing_ok=True)


def verify() -> dict:
    with engine.connect() as c:
        total = c.execute(text("SELECT count(*) FROM tag_events WHERE tenant_id=:t"), {"t": TENANT}).scalar()
        by_type = c.execute(text("""
            SELECT event_type, count(*) FROM tag_events WHERE tenant_id=:t
            GROUP BY event_type ORDER BY 2 DESC"""), {"t": TENANT}).fetchall()
        pe101 = c.execute(text("""
            SELECT count(*) FROM tag_events WHERE tenant_id=:t AND tag_id LIKE '%pe101'
            AND event_type IN ('rising_edge','falling_edge')"""), {"t": TENANT}).scalar()
        sample = c.execute(text("""
            SELECT tag_id, event_type, uns_path::text, raw_quality FROM tag_events
            WHERE tenant_id=:t ORDER BY ts LIMIT 3"""), {"t": TENANT}).fetchall()
    return {"total": total, "by_type": [tuple(r) for r in by_type],
            "pe101_edges": pe101, "sample": [tuple(r) for r in sample]}


def cleanup() -> None:
    with engine.begin() as c:
        c.execute(text("DELETE FROM tag_events WHERE tenant_id=:t"), {"t": TENANT})
        c.execute(text("DELETE FROM approved_tags WHERE tenant_id=:t"), {"t": TENANT})


def main() -> int:
    try:
        n = seed_approved_tags()
        print(f"[seed] approved_tags rows for test tenant: {n}")
        start_relay()
        print(f"[relay] up on :{PORT} (RELAY_TAG_EVENTS=1, staging DB)")
        tail = run_mock()
        print(f"[mock] mock_tag_stream done. tail:\n{tail}")
        res = verify()
        print(f"[verify] tag_events total={res['total']}  pe101_edges={res['pe101_edges']}")
        print(f"[verify] by_type={res['by_type']}")
        print(f"[verify] sample={res['sample']}")
        ok = res["total"] > 0 and res["pe101_edges"] >= 5 and any(
            "fault_window" in t[0] or t[0] in ("rising_edge", "falling_edge", "value_changed")
            for t in res["by_type"])
        print("RESULT:", "PASS ✅" if ok else "FAIL ❌")
        return 0 if ok else 1
    finally:
        cleanup()
        print("[cleanup] deleted test tenant rows from staging tag_events + approved_tags")


if __name__ == "__main__":
    sys.exit(main())
