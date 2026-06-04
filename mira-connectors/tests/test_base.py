"""Base-interface contract: read_only vs dry_run are distinct axes, and the
write-guard only opens when a connector is explicitly live."""

from __future__ import annotations

import asyncio

from cmms.maximo_mock import MaximoMockConnector


def test_defaults_are_safe():
    c = MaximoMockConnector()
    assert c.dry_run is True
    assert c.read_only is True
    assert c._may_write_source() is False


def test_read_only_blocks_source_write_even_when_not_dry_run():
    c = MaximoMockConnector(dry_run=False, read_only=True)
    assert c._may_write_source() is False  # read_only guards the SOURCE


def test_dry_run_blocks_source_write_even_when_writable():
    c = MaximoMockConnector(dry_run=True, read_only=False)
    assert c._may_write_source() is False  # dry_run guards persistence


def test_live_connector_may_write():
    c = MaximoMockConnector(dry_run=False, read_only=False)
    assert c._may_write_source() is True


def test_dry_run_run_helper_returns_graph_without_persisting():
    c = MaximoMockConnector()  # dry_run
    graph = asyncio.run(c.run())
    # run() returns the in-memory graph; nothing is persisted (no DB at all here)
    assert graph.summary()["entities"] > 0
    assert all(e.approval_state == "proposed" for e in graph.entities.values())


def test_export_respects_dry_run():
    dry = MaximoMockConnector()
    res = asyncio.run(dry.export_enriched({"wonum": "WO-1"}))
    assert res.supported and res.written is False

    live = MaximoMockConnector(dry_run=False, read_only=False)
    res2 = asyncio.run(live.export_enriched({"wonum": "WO-1"}))
    assert res2.written is True
