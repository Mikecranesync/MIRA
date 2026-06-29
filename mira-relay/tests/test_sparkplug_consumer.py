"""Sparkplug consumer — the 12 acceptance behaviours (no broker, no NeonDB).

Drives ``Consumer`` with encoded Sparkplug payloads through the REAL
``ingest_batch`` against an in-memory store. The conveyor/discharge demo tags are
the fixture. Covers: birth discovery, data → live cache, death → stale,
seen-vs-approved, approved → historian samples, tenant scoping, malformed/loop
resilience, idempotent rebirth, and historian retrieval of normalized tags.
"""

from __future__ import annotations

from ingest_contract import normalize_tag_path
from mqtt_ingest.codecs import sparkplug_b as spb
from mqtt_ingest.config import SparkplugConfig
from mqtt_ingest.subscriber import Consumer

GROUP, EDGE, DEVICE = "FactoryLM", "ConveyorEdge", "Conv_Simple"

# The conveyor/discharge demo metrics (spec §E).
M_MOTOR = "Conveyor/Motor_Running"
M_VFD_HZ = "Conveyor/VFD_Hz"
M_PHOTO = "Conveyor/Photo_Eye"
M_UNKNOWN = "Conveyor/Undeclared_Tag"  # NOT in the allowlist


def _path(metric: str, device: str = DEVICE) -> str:
    parts = [GROUP, EDGE] + ([device] if device else []) + [metric]
    return "/".join(parts)


def _topic(mtype: str) -> str:
    return f"spBv1.0/{GROUP}/{mtype}/{EDGE}/{DEVICE}"


# ── in-memory store: ingest TagStore Protocol + lifecycle surface ────────────
class FakeStore:
    def __init__(self, allow: dict[str, dict[str, str | None]]):
        self._allow = allow
        self.events: list = []  # tag_events rows
        self.state: dict[str, dict] = {}  # plc_tag -> {"row":…, "freshness":…}
        self.seen: list[str] = []  # discovered (enabled=false) raw paths

    def load_allowlist(self, tenant_id, source_system):
        return dict(self._allow.get(source_system, {}))

    def current_state_simulated(self, tenant_id, tag_paths):
        return {t: self.state[t]["row"].simulated for t in tag_paths if t in self.state}

    def persist_batch(self, event_rows, state_rows):
        self.events.extend(event_rows)
        for r in state_rows:
            self.state[r.tag_path] = {"row": r, "freshness": "live"}
        return (len(event_rows), len(state_rows))

    def mark_tags_stale(self, tenant_id, tag_paths):
        n = 0
        for p in tag_paths:
            if p in self.state:
                self.state[p]["freshness"] = "stale"
                n += 1
        return n

    def record_seen_tags(self, tenant_id, source_system, tag_paths):
        approved = self._allow.get(source_system, {})
        n = 0
        for p in dict.fromkeys(tag_paths):
            if normalize_tag_path(p) in approved:
                continue  # already approved → ON CONFLICT DO NOTHING
            if p not in self.seen:
                self.seen.append(p)
                n += 1
        return n


def _allowlist(*metrics: str, uns: str | None = "enterprise.home_garage.conveyor_lab.conveyor_1"):
    return {"ignition": {normalize_tag_path(_path(m)): uns for m in metrics}}


def _config(**kw) -> SparkplugConfig:
    base = dict(
        tenant_id="t-conveyor",
        source_system="ignition",
        flush_size=10_000,
        flush_interval_s=10_000,  # flush only when we call it
        auto_discover=True,
    )
    base.update(kw)
    return SparkplugConfig(**base)


def _birth(*metrics) -> bytes:
    return spb.encode_payload(list(metrics), timestamp=1_700_000_000_000, seq=0)


def _m(name, alias, dt, value):
    return spb.encode_metric(name=name, alias=alias, datatype=dt, value=value)


# ── 1 + 5: BIRTH discovers + approved tag generates a historian sample ───────
def test_birth_lands_approved_tag_as_historian_sample():
    store = FakeStore(_allowlist(M_MOTOR, M_VFD_HZ))
    c = Consumer(_config(), store)
    c.feed(
        _topic("DBIRTH"),
        _birth(
            _m(M_MOTOR, 1, spb.DT_BOOLEAN, True),
            _m(M_VFD_HZ, 2, spb.DT_FLOAT, 60.0),
        ),
    )
    result = c.flush()
    assert result is not None and result.accepted == 2
    # tag_events (the historian's raw stream) got both approved tags
    landed = {e.tag_path for e in store.events}
    assert _path(M_MOTOR) in landed and _path(M_VFD_HZ) in landed
    # tag_events rows carry Sparkplug provenance + resolved UNS from the allowlist
    motor = next(e for e in store.events if e.tag_path == _path(M_MOTOR))
    assert motor.source_system == "ignition"
    assert motor.metadata["source_protocol"] == "sparkplug_b"
    assert motor.uns_path == "enterprise.home_garage.conveyor_lab.conveyor_1"


# ── 2: DATA updates the live tag cache ───────────────────────────────────────
def test_data_updates_live_cache_latest_value():
    store = FakeStore(_allowlist(M_VFD_HZ))
    c = Consumer(_config(), store)
    c.feed(_topic("DBIRTH"), _birth(_m(M_VFD_HZ, 2, spb.DT_FLOAT, 60.0)))
    c.flush()
    # alias-only DDATA carries the new value
    c.feed(
        _topic("DDATA"),
        spb.encode_payload([spb.encode_metric(alias=2, datatype=spb.DT_FLOAT, value=49.5)]),
    )
    c.flush()
    cached = store.state[_path(M_VFD_HZ)]
    assert cached["row"].value == "49.5"  # canonical TEXT form in cache
    assert cached["freshness"] == "live"


# ── 3: DEATH marks tags stale/offline ────────────────────────────────────────
def test_death_marks_tags_stale():
    store = FakeStore(_allowlist(M_MOTOR, M_VFD_HZ))
    c = Consumer(_config(), store)
    c.feed(
        _topic("DBIRTH"),
        _birth(
            _m(M_MOTOR, 1, spb.DT_BOOLEAN, True),
            _m(M_VFD_HZ, 2, spb.DT_FLOAT, 60.0),
        ),
    )
    c.flush()
    assert all(v["freshness"] == "live" for v in store.state.values())
    c.feed(_topic("DDEATH"), spb.encode_payload([]))
    assert store.state[_path(M_MOTOR)]["freshness"] == "stale"
    assert store.state[_path(M_VFD_HZ)]["freshness"] == "stale"
    assert c.stats["stale_marked"] == 2


# ── 4 + 6: unknown tags enter SEEN, never the historian stream ───────────────
def test_unknown_tag_recorded_seen_not_historized():
    store = FakeStore(_allowlist(M_MOTOR))  # M_UNKNOWN deliberately NOT allowlisted
    c = Consumer(_config(auto_discover=True), store)
    c.feed(
        _topic("DBIRTH"),
        _birth(
            _m(M_MOTOR, 1, spb.DT_BOOLEAN, True),
            _m(M_UNKNOWN, 9, spb.DT_INT32, 7),
        ),
    )
    result = c.flush()
    # approved one landed; unknown rejected fail-closed
    assert result.accepted == 1
    landed = {e.tag_path for e in store.events}
    assert _path(M_MOTOR) in landed
    assert _path(M_UNKNOWN) not in landed  # NOT historized (test 6)
    # unknown recorded as seen/proposed (enabled=false) for human promotion
    assert _path(M_UNKNOWN) in store.seen  # (test 4)
    assert c.stats["seen_recorded"] == 1


def test_auto_discover_off_does_not_record_seen():
    store = FakeStore(_allowlist(M_MOTOR))
    c = Consumer(_config(auto_discover=False), store)
    c.feed(_topic("DBIRTH"), _birth(_m(M_UNKNOWN, 9, spb.DT_INT32, 7)))
    c.flush()
    assert store.seen == []


# ── 7: tenant comes from config; never from the topic ────────────────────────
def test_tenant_scoping_from_config_only():
    store = FakeStore(_allowlist(M_MOTOR))
    seen_tenants = []

    def spy_ingest(payload, tenant_id, st):
        seen_tenants.append(tenant_id)
        from tag_ingest import ingest_batch as real

        return real(payload, tenant_id, st)

    c = Consumer(_config(tenant_id="tenant-A"), store, ingest_fn=spy_ingest)
    c.feed(_topic("DBIRTH"), _birth(_m(M_MOTOR, 1, spb.DT_BOOLEAN, True)))
    c.flush()
    # the Sparkplug topic carries NO tenant — it can only have come from config
    assert seen_tenants == ["tenant-A"]
    assert all(e.tenant_id == "tenant-A" for e in store.events)


# ── 10: malformed payloads + store errors never kill the loop ────────────────
def test_malformed_and_nonspb_messages_are_survived():
    store = FakeStore(_allowlist(M_MOTOR))
    c = Consumer(_config(), store)
    c.feed("FactoryLM/not/sparkplug", b"{}")  # non-Sparkplug topic
    c.feed(_topic("DDATA"), b"\x08\xff\xff")  # corrupt protobuf
    c.feed(_topic("NCMD"), b"")  # command topic (read-only)
    # nothing buffered, nothing raised
    assert c.flush() is None
    assert c.stats["ignored"] >= 3


def test_store_error_on_flush_does_not_raise():
    class BoomStore(FakeStore):
        def persist_batch(self, *a, **k):
            raise RuntimeError("db down")

    store = BoomStore(_allowlist(M_MOTOR))
    c = Consumer(_config(), store)
    c.feed(_topic("DBIRTH"), _birth(_m(M_MOTOR, 1, spb.DT_BOOLEAN, True)))
    assert c.flush() is None  # swallowed; loop survives


# ── 11: repeated BIRTH is idempotent (no crash, no corruption) ───────────────
def test_repeated_birth_is_idempotent():
    store = FakeStore(_allowlist(M_VFD_HZ))
    c = Consumer(_config(), store)
    birth = _birth(_m(M_VFD_HZ, 2, spb.DT_FLOAT, 60.0))
    r1 = c.feed(_topic("DBIRTH"), birth) or c.flush()
    r2 = c.feed(_topic("DBIRTH"), birth) or c.flush()
    assert r1.accepted == 1 and r2.accepted == 1  # both fine, no error
    # alias table still good after rebirth
    c.feed(
        _topic("DDATA"),
        spb.encode_payload([spb.encode_metric(alias=2, datatype=spb.DT_FLOAT, value=51.0)]),
    )
    res = c.flush()
    assert res.accepted == 1 and store.state[_path(M_VFD_HZ)]["row"].value == "51.0"


# ── 12: normalized tags are retrievable via the historian's tables ───────────
def test_historian_can_retrieve_current_and_history():
    """The consumer lands into the SAME live_signal_cache + tag_events the
    PostgresHistorianAdapter reads (list_tags / get_history). Proven here against
    the in-memory store standing in for those tables."""
    store = FakeStore(_allowlist(M_VFD_HZ))
    c = Consumer(_config(), store)
    c.feed(_topic("DBIRTH"), _birth(_m(M_VFD_HZ, 2, spb.DT_FLOAT, 60.0)))
    c.flush()
    c.feed(
        _topic("DDATA"),
        spb.encode_payload([spb.encode_metric(alias=2, datatype=spb.DT_FLOAT, value=58.0)]),
    )
    c.flush()

    # list_tags (live current value)
    current = {tag: s["row"].value for tag, s in store.state.items()}
    assert current[_path(M_VFD_HZ)] == "58.0"
    # get_history (time-ordered samples for the tag)
    history = [e.value for e in store.events if e.tag_path == _path(M_VFD_HZ)]
    assert history == ["60.0", "58.0"]  # both readings retained


# ── run-diff feed shape (spec §E): numeric conveyor tag is run-engine ready ───
def test_vfd_freq_event_is_numeric_for_run_diff():
    store = FakeStore(_allowlist(M_VFD_HZ))
    c = Consumer(_config(), store)
    c.feed(_topic("DBIRTH"), _birth(_m(M_VFD_HZ, 2, spb.DT_FLOAT, 60.0)))
    c.flush()
    row = next(e for e in store.events if e.tag_path == _path(M_VFD_HZ))
    # run_engine.Reading parses tag_events.value as float — must be numeric-parseable
    assert row.value_type == "float"
    assert float(row.value) == 60.0
