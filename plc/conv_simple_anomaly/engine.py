"""
Conv_Simple anomaly engine — additive subscriber.

Consumes the real PLC stream from `plc/live-plc-bridge` on the existing Mosquitto broker,
applies the machine-card invariants in `rules.py`, debounces, and routes anomalies the SAME
way the cv101 demo does so existing surfaces pick them up for free:
  - writes rows to the shared `conveyor_events` SQLite table (Telegram /fault + MCP /api/faults/active read it)
  - publishes the current top anomaly JSON to `{UNS_PREFIX}/diagnostics/conv_simple_anomaly`
  - ntfy push for HIGH/CRITICAL (NTFY_URL/NTFY_TOPIC)

It does NOT modify mira-fault-detective (the demo's cv101 rules) — it runs alongside.
Reuses the project's aiomqtt pattern (see plc/live-plc-bridge/bridge.py, mira-fault-detective/engine.py).

NOTE: not exercised in CI yet (needs a broker). The pure rule logic is covered by test_rules.py.
"""
from __future__ import annotations
import asyncio, json, logging, os, sqlite3, time, urllib.request
from pathlib import Path

import aiomqtt  # type: ignore

import rules

# Broker host must be set via env (MQTT_HOST) at deploy time; "localhost" is a safe
# default that does not hardcode any specific VPS/broker IP.
MQTT_HOST = os.environ.get("MQTT_HOST", "localhost")
MQTT_PORT = int(os.environ.get("MQTT_PORT", "1883"))
UNS_PREFIX = os.environ.get("UNS_PREFIX", "demo/cell1/conveyor/cv101")
BRIDGE_SUB = f"{UNS_PREFIX}/_streams/bridge/#"
DIAG_TOPIC = f"{UNS_PREFIX}/diagnostics/conv_simple_anomaly"
DB_PATH = os.environ.get("MIRA_DB", "/mira-db/mira.db")
TICK_MS = int(os.environ.get("TICK_MS", "500"))
CLEAR_S = float(os.environ.get("CLEAR_S", "3.0"))
NTFY_URL = os.environ.get("NTFY_URL", "")
NTFY_TOPIC = os.environ.get("NTFY_TOPIC", "")
LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO").upper()

logging.basicConfig(level=LOG_LEVEL, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("conv-simple-anomaly")


def load_cfg() -> dict:
    p = Path(__file__).with_name("config.yaml")
    cfg = dict(rules.DEFAULT_CFG)
    if p.exists():
        try:
            import yaml  # optional
            data = yaml.safe_load(p.read_text()) or {}
            cfg.update({k: v for k, v in data.items() if k in rules.DEFAULT_CFG})
        except Exception as e:  # pragma: no cover
            log.warning("config.yaml ignored (%s); using defaults", e)
    return cfg


class Tracker:
    """Latest snapshot + the temporal facts the rules need (derived)."""
    def __init__(self):
        self.snap: dict = {}
        self.last_seen: dict = {}
        self.last_any: float = 0.0
        self._freq_val = None
        self._freq_change_ts = 0.0
        self._cmd_run_since = 0.0

    def update(self, rel_topic: str, value, ts: float):
        self.snap[rel_topic] = value
        self.last_seen[rel_topic] = ts
        self.last_any = max(self.last_any, ts)
        if rel_topic == rules.T_FREQ:
            if value != self._freq_val:
                self._freq_val = value
                self._freq_change_ts = ts
        if rel_topic == rules.T_CMD:
            running_cmd = value in rules.DEFAULT_CFG["run_cmd_values"]
            if running_cmd and self._cmd_run_since == 0.0:
                self._cmd_run_since = ts
            elif not running_cmd:
                self._cmd_run_since = 0.0

    def derived(self, now: float) -> dict:
        return {
            "now": now,
            "max_stale_s": (now - self.last_any) if self.last_any else 1e9,
            "freq_frozen_s": (now - self._freq_change_ts) if self._freq_change_ts else 0.0,
            "cmd_run_for_s": (now - self._cmd_run_since) if self._cmd_run_since else 0.0,
        }


def _init_db():
    try:
        conn = sqlite3.connect(DB_PATH, timeout=5)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("""CREATE TABLE IF NOT EXISTS conveyor_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts TEXT NOT NULL, fault TEXT NOT NULL, confidence REAL NOT NULL,
            evidence_json TEXT NOT NULL DEFAULT '[]', affected_json TEXT NOT NULL DEFAULT '[]',
            resolved_ts TEXT)""")
        conn.commit()
        return conn
    except Exception as e:  # pragma: no cover
        log.warning("SQLite unavailable (%s) — events not persisted", e)
        return None


def _persist(conn, a: rules.Anomaly):
    if not conn:
        return
    # The conveyor_events table is shared with mira-fault-detective on the same SQLite
    # WAL, so an INSERT can lose the write lock momentarily. Retry up to 5 times with a
    # short backoff on "database is locked" (mirrors mira-fault-detective/engine.py).
    row = (time.strftime("%Y-%m-%dT%H:%M:%S"), f"{a.rule_id}: {a.title}", a.confidence,
           json.dumps(a.evidence, default=str), json.dumps(a.components))
    for attempt in range(5):
        try:
            conn.execute(
                "INSERT INTO conveyor_events (ts, fault, confidence, evidence_json, affected_json) "
                "VALUES (?,?,?,?,?)", row)
            conn.commit()
            return
        except sqlite3.OperationalError as e:  # pragma: no cover
            if attempt == 4:
                log.warning("persist failed after retries: %s", e)
                return
            time.sleep(0.2 * (attempt + 1))
        except Exception as e:  # pragma: no cover
            log.warning("persist failed: %s", e)
            return


def _ntfy(a: rules.Anomaly):
    if not (NTFY_URL and NTFY_TOPIC and a.severity in (rules.HIGH, rules.CRITICAL)):
        return
    # A0_OFFLINE is an infrastructure-liveness signal that false-fires whenever the
    # laptop bridge stops (restart/logout/network blip). De-prioritize it to "low" with
    # an [infra] title so it does not send a spurious URGENT page; all other
    # HIGH/CRITICAL anomalies keep "urgent".
    if a.rule_id == "A0_OFFLINE":
        title = f"[infra] [{a.severity}] {a.title}"
        priority = "low"
    else:
        title = f"[{a.severity}] {a.title}"
        priority = "urgent"
    try:  # pragma: no cover
        req = urllib.request.Request(
            f"{NTFY_URL.rstrip('/')}/{NTFY_TOPIC}", data=a.message.encode(),
            headers={"Title": title, "Priority": priority,
                     "Tags": "rotating_light"})
        urllib.request.urlopen(req, timeout=5)
    except Exception as e:
        log.warning("ntfy failed: %s", e)


async def run():  # pragma: no cover (needs a broker)
    cfg = load_cfg()
    conn = _init_db()
    tr = Tracker()
    active: dict[str, float] = {}   # rule_id -> last_seen_active ts
    log.info("subscribing %s @ %s:%s", BRIDGE_SUB, MQTT_HOST, MQTT_PORT)
    async with aiomqtt.Client(hostname=MQTT_HOST, port=MQTT_PORT) as client:
        await client.subscribe(BRIDGE_SUB)

        async def reader():
            async for m in client.messages:
                try:
                    payload = json.loads(m.payload)
                    value, ts = payload.get("value"), float(payload.get("ts", time.time()))
                except Exception:
                    continue
                rel = str(m.topic).split("/_streams/bridge/", 1)[-1]
                tr.update(rel, value, ts)

        async def ticker():
            while True:
                await asyncio.sleep(TICK_MS / 1000.0)
                now = time.time()
                found = {a.rule_id: a for a in rules.evaluate(tr.snap, tr.derived(now), cfg)}
                for rid, a in found.items():
                    if rid not in active:
                        log.warning("ANOMALY %s [%s] %s", rid, a.severity, a.message)
                        _persist(conn, a)
                        _ntfy(a)
                    active[rid] = now
                # publish current worst + clear stale latches
                order = {rules.CRITICAL: 0, rules.HIGH: 1, rules.MED: 2, rules.LOW: 3, rules.INFO: 4}
                worst = min(found.values(), key=lambda a: order.get(a.severity, 9), default=None)
                await client.publish(DIAG_TOPIC, json.dumps({
                    "ts": now,
                    "active": [{"rule_id": a.rule_id, "severity": a.severity, "title": a.title}
                               for a in found.values()],
                    "top": None if not worst else {"rule_id": worst.rule_id, "severity": worst.severity,
                                                   "title": worst.title, "message": worst.message},
                }, default=str))
                for rid in [r for r, t in active.items() if now - t > CLEAR_S]:
                    log.info("cleared %s", rid)
                    active.pop(rid, None)

        await asyncio.gather(reader(), ticker())


if __name__ == "__main__":  # pragma: no cover
    asyncio.run(run())
