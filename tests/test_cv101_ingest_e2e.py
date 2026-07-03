"""No-infra proof: real CV-101 tag paths -> mira-relay's tag_ingest.ingest_batch
-> an in-memory TagStore, using an allowlist built from the ACTUAL committed
SQL seed (not a hand-rolled fixture). This also proves the seed admits real
CV-101 traffic end-to-end without a live NeonDB or a running relay process --
the no-infra confidence floor for the bench-to-cloud path, mirroring
tests/simlab/test_relay_ingest_e2e.py's approach for the SimLab line.
"""

from __future__ import annotations

import os
import re
import sys

import pytest

_REPO_ROOT = os.path.dirname(os.path.dirname(__file__))
_SEED_PATH = os.path.join(_REPO_ROOT, "tools", "seeds", "approved_tags_conveyor.sql")
_CV101_UNS = "enterprise.home_garage.conveyor_lab.conveyor_1"
_TENANT = "e88bd0e8-8a84-4e30-9803-c0dc6efb07fe"

_ROW_RE = re.compile(r"'ignition',\s*'([^']*)',\s*'([^']*)',\s*'([^']*)'::ltree")


def _load_relay_modules():
    """Import mira-relay's ingest_contract + tag_ingest by sys.path insert,
    same pattern as tests/test_northwind_cv200_seed_and_config.py::_real_normalize
    and tests/simlab/test_relay_ingest_e2e.py."""
    relay_dir = os.path.join(_REPO_ROOT, "mira-relay")
    sys.path.insert(0, relay_dir)
    try:
        import ingest_contract
        import tag_ingest
    finally:
        sys.path.remove(relay_dir)
    return ingest_contract, tag_ingest


ingest_contract, tag_ingest = _load_relay_modules()


def _seed_allowlist() -> dict[str, str | None]:
    with open(_SEED_PATH, encoding="utf-8") as fh:
        sql = fh.read()
    return {norm: uns for _src, norm, uns in _ROW_RE.findall(sql)}


class _InMemoryTagStore:
    """Minimal TagStore double (the tag_ingest.TagStore Protocol contract) --
    mirrors mira-relay/tests/test_tag_ingest.py::InMemoryTagStore."""

    def __init__(self, allowlist: dict[str, str | None]) -> None:
        self._allow = allowlist
        self.events: list = []
        self.state: dict = {}

    def load_allowlist(self, tenant_id, source_system):
        return dict(self._allow)

    def current_state_simulated(self, tenant_id, tag_paths):
        return {t: self.state[t].simulated for t in tag_paths if t in self.state}

    def persist_batch(self, event_rows, state_rows):
        self.events.extend(event_rows)
        for r in state_rows:
            self.state[r.tag_path] = r
        return (len(event_rows), len(state_rows))


def _batch(tags):
    return ingest_contract.build_ingest_batch("ignition", tags, tenant_id=_TENANT)


@pytest.fixture
def seeded_store():
    return _InMemoryTagStore(_seed_allowlist())


def test_cv101_batch_lands_via_ingest_batch(seeded_store):
    tags = [
        ingest_contract.build_tag_entry(
            "[default]Conveyor/VFD_Hz", 60.0, value_type="float", quality="good",
        ),
        ingest_contract.build_tag_entry(
            "[default]Mira_Monitored/conveyor_demo/Motor_Current_A", 8.3,
            value_type="float", quality="good",
        ),
    ]
    result = tag_ingest.ingest_batch(_batch(tags), _TENANT, seeded_store)

    assert result.accepted == 2
    assert result.rejected == []
    assert result.simulated is False
    assert len(seeded_store.events) == 2
    for row in seeded_store.events:
        assert row.uns_path == _CV101_UNS
        assert row.simulated is False
    assert len(seeded_store.state) == 2
    for row in seeded_store.state.values():
        assert row.uns_path == _CV101_UNS
        assert row.simulated is False


def test_unapproved_tag_rejected_and_not_stored(seeded_store):
    tags = [
        ingest_contract.build_tag_entry(
            "[default]Conveyor/Not_A_Real_Tag", 1, value_type="int", quality="good",
        )
    ]
    result = tag_ingest.ingest_batch(_batch(tags), _TENANT, seeded_store)

    assert result.accepted == 0
    assert len(result.rejected) == 1
    assert result.rejected[0].reason == "not_allowlisted"
    assert seeded_store.events == []
    assert seeded_store.state == {}


def test_mixed_batch_accepts_approved_and_rejects_unapproved(seeded_store):
    tags = [
        ingest_contract.build_tag_entry("[default]Conveyor/VFD_Hz", 60.0, value_type="float"),
        ingest_contract.build_tag_entry("[default]Conveyor/Not_A_Real_Tag", 1, value_type="int"),
    ]
    result = tag_ingest.ingest_batch(_batch(tags), _TENANT, seeded_store)

    assert result.accepted == 1
    assert len(result.rejected) == 1
    assert result.rejected[0].tag_path == "[default]Conveyor/Not_A_Real_Tag"
    assert len(seeded_store.events) == 1
    assert seeded_store.events[0].tag_path == "[default]Conveyor/VFD_Hz"
