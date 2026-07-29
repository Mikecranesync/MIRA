"""Fail-closed pin: the live Sparkplug decoder must emit exactly what the
``approved_tags`` seed allowlists — normalized identically.

The relay is fail-closed: if ``normalize_tag_path`` of a live metric's tag path
isn't in ``approved_tags``, the metric is silently rejected (zero rows, no log).
So three artifacts must agree: the **decoder** (what live traffic emits), the
**seed generator** (what's allowlisted), and the **relay normalizer** (the match
key). This test drives the real decoder for every conveyor metric and asserts its
emitted tag path is present in the GENERATED seed file with a byte-identical
``normalized_tag_path``. If the decoder's path construction ever drifts from the
seed generator, this goes red instead of dropping data on the floor in prod.
"""

from __future__ import annotations

import importlib.util
import re
import sys
from pathlib import Path

from ingest_contract import normalize_tag_path
from mqtt_ingest.codecs import sparkplug_b as spb
from mqtt_ingest.decode import SparkplugDecoder

_REPO_ROOT = Path(__file__).resolve().parents[2]


def _load_generator():
    path = _REPO_ROOT / "tools" / "seeds" / "gen_approved_tags_sparkplug.py"
    spec = importlib.util.spec_from_file_location("gen_sparkplug_seed", path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["gen_sparkplug_seed"] = mod
    spec.loader.exec_module(mod)
    return mod


_GEN = _load_generator()
_NODE = _GEN.CONVEYOR_NODE

# Parse the GENERATED seed file: (source_tag_path, normalized_tag_path) per row.
_SEED_SQL = (
    _REPO_ROOT / "tools" / "seeds" / f"approved_tags_sparkplug_{_NODE['edge_node_id'].lower()}.sql"
).read_text(encoding="utf-8")
_ROW = re.compile(r"'ignition',\s*'([^']+)',\s*'([^']+)'")
_SEED = dict(_ROW.findall(_SEED_SQL))  # {source_tag_path: normalized_tag_path}


def _birth_for(metric_name: str) -> bytes:
    return spb.encode_payload(
        [spb.encode_metric(name=metric_name, alias=1, datatype=spb.DT_FLOAT, value=1.0)]
    )


def test_seed_file_has_every_manifest_metric():
    assert len(_SEED) == len(_NODE["metrics"]), "seed row count != manifest metric count"


def test_decoder_paths_match_the_generated_seed_exactly():
    """For every conveyor metric, the live decoder's tag path is allowlisted by
    the seed AND normalizes to the seed's stored key (the fail-closed contract)."""
    dec = SparkplugDecoder()
    topic = f"spBv1.0/{_NODE['group_id']}/DBIRTH/{_NODE['edge_node_id']}/{_NODE['device_id']}"
    for metric_name in _NODE["metrics"]:
        res = dec.handle(topic, _birth_for(metric_name))
        assert len(res.entries) == 1, f"{metric_name} did not decode to one entry"
        tag_path = res.entries[0]["tag_path"]
        # the decoder's emitted path is present in the seed …
        assert tag_path in _SEED, (
            f"decoder path {tag_path!r} is NOT in the seed (would be rejected)"
        )
        # … and normalizes byte-identically to the seed's stored match key
        assert normalize_tag_path(tag_path) == _SEED[tag_path], (
            f"normalize drift for {metric_name}: "
            f"live={normalize_tag_path(tag_path)!r} seed={_SEED[tag_path]!r}"
        )


def test_seed_normalized_keys_are_what_the_relay_would_match():
    """Independently recompute the match key — the seed's stored normalized value
    must equal normalize_tag_path(source_tag_path), i.e. the relay's hot-path."""
    for raw, stored_norm in _SEED.items():
        assert normalize_tag_path(raw) == stored_norm
