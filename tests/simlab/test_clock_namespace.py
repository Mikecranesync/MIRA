"""SimLab namespace_type classification + controller clock tags.

Proves the Walker namespace taxonomy layered over SimLab's maintenance category
axis, and that the controller clock tag (REALTIME) is present and renders a
tag_path whose basename the relay clock_resolver recognizes as a PLC clock.
"""

from __future__ import annotations

from simlab.baselines import bottle_filler_tags, controller_clock_tags
from simlab.lines.juice_bottling import build_line
from simlab.models import (
    NamespaceType,
    Reading,
    TagCategory,
    ValueType,
    namespace_type_for,
)


def test_category_namespace_type_mapping():
    # Functional: real-time operational data.
    for c in (TagCategory.STATUS, TagCategory.PROCESS, TagCategory.MOTOR, TagCategory.PRODUCTION):
        assert namespace_type_for(c) is NamespaceType.FUNCTIONAL
    # Informative: derived/aggregated (OEE inputs).
    assert namespace_type_for(TagCategory.QUALITY) is NamespaceType.INFORMATIVE
    # Maintenance: MIRA's wedge — no Walker equivalent.
    for c in (
        TagCategory.FAULTS,
        TagCategory.ALARMS,
        TagCategory.MAINTENANCE,
        TagCategory.DOCS,
        TagCategory.TRAINING,
    ):
        assert namespace_type_for(c) is NamespaceType.MAINTENANCE


def test_tagdef_override_beats_category_default():
    clk = controller_clock_tags()["controller_time"]
    # STATUS would default to FUNCTIONAL; the explicit override wins.
    assert clk.category is TagCategory.STATUS
    assert clk.namespace_type is NamespaceType.REALTIME
    assert clk.resolved_namespace_type is NamespaceType.REALTIME


def test_tags_without_override_derive_from_category():
    for td in bottle_filler_tags().values():
        assert td.namespace_type is None
        assert td.resolved_namespace_type is namespace_type_for(td.category)


def test_filler_carries_controller_clock_as_realtime():
    line = build_line()
    filler = line.asset("filler01")
    assert "controller_time" in filler.tags
    assert filler.tags["controller_time"].resolved_namespace_type is NamespaceType.REALTIME


def test_reading_renders_namespace_type_and_clock_basename():
    r = Reading(
        asset_id="filler01",
        tag="controller_time",
        category=TagCategory.STATUS,
        value="2026-06-11T12:00:00+00:00",
        value_type=ValueType.STRING,
        uns_path=(
            "enterprise.florida_natural_demo.plant1.juice_bottling.line01"
            ".filler01.status.controller_time"
        ),
        ts="2026-06-11T12:00:00+00:00",
        namespace_type=NamespaceType.REALTIME.value,
    )
    tag = r.to_ingest_tag()
    # The basename the relay clock_resolver matches on must survive rendering.
    assert tag["tag_path"].rsplit(".", 1)[-1] == "controller_time"
    assert tag["metadata"]["namespace_type"] == "realtime"


def test_non_realtime_reading_omits_metadata_when_unset():
    r = Reading(
        asset_id="filler01",
        tag="fill_level_oz",
        category=TagCategory.PROCESS,
        value=8.3,
        value_type=ValueType.FLOAT,
        uns_path="enterprise.x.filler01.process.fill_level_oz",
        ts="2026-06-11T12:00:00+00:00",
    )
    # namespace_type unset → no metadata key injected (backwards-compatible).
    assert "metadata" not in r.to_ingest_tag()
