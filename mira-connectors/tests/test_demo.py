"""Smoke test: the end-to-end demo runs cleanly and produces the expected join.

This also exercises the cross-connector merge + cross-reference path that the
demo narrates, asserting the OT↔enterprise link actually forms."""

from __future__ import annotations

import asyncio

from cmms.maximo_mock import MaximoMockConnector
from canonical import NormalizedGraph
from scada.ignition_mock import IgnitionMockConnector


def test_end_to_end_join_produces_unified_proposed_graph():
    maximo = MaximoMockConnector()
    ignition = IgnitionMockConnector()

    mx = maximo.normalize(asyncio.run(maximo.import_records()))
    ig = ignition.normalize(asyncio.run(ignition.import_records()))

    # both validate clean
    assert maximo.validate(mx).ok
    assert ignition.validate(ig).ok

    links = ignition.propose_asset_links(ig, mx)
    assert links, "cross-reference should propose SCADA↔CMMS links"

    unified = NormalizedGraph()
    unified.merge(mx)
    unified.merge(ig)
    for p in links:
        unified.add_proposal(p)

    s = unified.summary()
    assert s["entities"] > len(mx.entities)  # SCADA entities folded in
    # every edge in the unified graph is still proposed (no auto-verify)
    assert s["proposed_relationships"] == s["relationships"]
    # raw records from BOTH systems are preserved
    systems = {so.system_kind for so in unified.source_objects}
    assert {"maximo", "ignition"} <= systems


def test_demo_main_runs():
    import demo

    asyncio.run(demo.main())  # raises if anything in the flow breaks
