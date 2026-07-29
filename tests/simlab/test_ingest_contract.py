"""Lane 3 §7 pre-work — the canonical ingest contract is single-sourced.

Proves the consolidation actually happened (no second normalizer/builder copy
survives) and that the canonical batch builder's output is accepted by the real
``ingest_batch``. Includes a FUTURE-FACING fixture showing how an MQTT message
would become the same canonical batch shape — WITHOUT implementing a subscriber.
"""
from __future__ import annotations

import ast
import importlib.util
import sys
from pathlib import Path

import pytest

_REPO_ROOT = Path(__file__).resolve().parents[2]
_RELAY_DIR = _REPO_ROOT / "mira-relay"


def _load_contract():
    path = _RELAY_DIR / "ingest_contract.py"
    spec = importlib.util.spec_from_file_location("ingest_contract_under_test", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # type: ignore[union-attr]
    return mod


# ── consolidation: one canonical normalizer, no surviving copies ──────────────


def test_relay_reexports_the_canonical_normalizer_by_identity():
    """tag_ingest.normalize_tag_path IS ingest_contract.normalize_tag_path (same
    object) — the relay matcher and the contract cannot drift."""
    sys.path.insert(0, str(_RELAY_DIR))
    try:
        import ingest_contract
        import tag_ingest
    finally:
        sys.path.remove(str(_RELAY_DIR))
    assert tag_ingest.normalize_tag_path is ingest_contract.normalize_tag_path


def _local_func_defs(py_path: Path, name: str) -> int:
    tree = ast.parse(py_path.read_text(encoding="utf-8"))
    return sum(isinstance(n, ast.FunctionDef) and n.name == name for n in ast.walk(tree))


def test_no_surviving_local_normalizer_copies():
    """The seed generator and SimLab publisher must NOT define their own
    normalize_tag_path — they route through the canonical contract."""
    seed = _REPO_ROOT / "tools" / "seeds" / "gen_approved_tags_simulator.py"
    pub = _REPO_ROOT / "simlab" / "publishers.py"
    assert _local_func_defs(seed, "normalize_tag_path") == 0, "seed gen still defines a normalizer"
    assert _local_func_defs(pub, "normalize_tag_path") == 0
    # tag_ingest holds the re-export import, not a def.
    assert _local_func_defs(_RELAY_DIR / "tag_ingest.py", "normalize_tag_path") == 0


def test_seed_generator_uses_the_canonical_normalizer():
    """The generator's bound normalize_tag_path equals the canonical one for all
    SimLab tags (it loads the canonical file at import)."""
    spec = importlib.util.spec_from_file_location(
        "gen_seed", _REPO_ROOT / "tools" / "seeds" / "gen_approved_tags_simulator.py"
    )
    gen = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(gen)  # type: ignore[union-attr]
    contract = _load_contract()
    from simlab.engine import SimEngine
    from simlab.lines.juice_bottling import build_line

    for r in SimEngine(build_line()).snapshot():
        assert gen.normalize_tag_path(r.uns_path) == contract.normalize_tag_path(r.uns_path)


# ── canonical batch builder output is accepted by ingest_batch ────────────────


class _InMemoryTagStore:
    def __init__(self, allow):
        self._allow = allow
        self.events: list = []
        self.state: dict = {}

    def load_allowlist(self, tenant_id, source_system):
        return dict(self._allow.get(source_system, {}))

    def current_state_simulated(self, tenant_id, tag_paths):
        return {t: self.state[t].simulated for t in tag_paths if t in self.state}

    def persist_batch(self, event_rows, state_rows):
        self.events.extend(event_rows)
        for r in state_rows:
            self.state[r.tag_path] = r
        return (len(event_rows), len(state_rows))


@pytest.fixture
def relay_ingest():
    sys.path.insert(0, str(_RELAY_DIR))
    try:
        from tag_ingest import ingest_batch, normalize_tag_path
    finally:
        sys.path.remove(str(_RELAY_DIR))
    return ingest_batch, normalize_tag_path


def test_canonical_builder_output_is_accepted_by_ingest_batch(relay_ingest):
    ingest_batch, normalize_tag_path = relay_ingest
    contract = _load_contract()

    tag_path = "enterprise.demo.line01.filler01.process.fill_level_oz"
    entry = contract.build_tag_entry(tag_path, 11.5, value_type="float", quality="good", ts="2025-01-01T00:00:01Z")
    batch = contract.build_ingest_batch("simulator", [entry])

    store = _InMemoryTagStore({"simulator": {normalize_tag_path(tag_path): tag_path}})
    result = ingest_batch(batch, "00000000-0000-0000-0000-000000515ab1", store)

    assert result.accepted == 1
    assert result.rejected == []
    assert result.simulated is True
    assert len(store.events) == 1
    assert store.state[tag_path].uns_path == tag_path  # UNS resolved from allowlist


# ── FUTURE-FACING: an MQTT message → the same canonical batch (no subscriber) ──


def test_future_mqtt_message_maps_to_the_same_canonical_batch(relay_ingest):
    """Documents the Lane 3 seam: a decoded MQTT/Sparkplug message becomes a
    canonical batch via the SAME builder a real subscriber will call. This is a
    SHAPE fixture only — it does NOT subscribe, connect a broker, or decode
    protobuf. It proves the contract is ready for a second transport.
    """
    ingest_batch, normalize_tag_path = relay_ingest
    contract = _load_contract()

    # Pretend a plain-JSON MQTT codec already produced these fields from a topic
    # + payload (topic→uns via simlab.uns.from_mqtt_topic in the real codec).
    decoded = {
        "uns_path": "enterprise.demo.line01.filler01.process.fill_level_oz",
        "value": 11.5,
        "value_type": "float",
        "quality": "good",
        "ts": "2025-01-01T00:00:01Z",
    }
    entry = contract.build_tag_entry(
        decoded["uns_path"], decoded["value"],
        value_type=decoded["value_type"], quality=decoded["quality"], ts=decoded["ts"],
        metadata={"transport": "mqtt", "topic": "FactoryLM/Demo/Line01/Filler01/process/fill_level_oz"},
    )
    batch = contract.build_ingest_batch("ignition", [entry], source_connection_id="edge-gw-1")

    # Same shape the HTTP path produces — accepted by the same pipeline.
    assert batch["source_system"] == "ignition"
    assert batch["tags"][0]["tag_path"] == decoded["uns_path"]
    assert batch["tags"][0]["metadata"]["transport"] == "mqtt"

    store = _InMemoryTagStore(
        {"ignition": {normalize_tag_path(decoded["uns_path"]): decoded["uns_path"]}}
    )
    result = ingest_batch(batch, "00000000-0000-0000-0000-000000515ab1", store)
    assert result.accepted == 1
    assert result.simulated is False  # ignition source, not simulator
