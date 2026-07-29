"""
Deterministic unit tests for event_context.build_event_context.
Run: pytest plc/conv_simple_anomaly/test_event_context.py -v
"""
from difference_detectors import detect_out_of_baseline, group_observations
from event_context import build_event_context


def _event():
    obs = [
        detect_out_of_baseline("bowl_pressure", 5.1, 11.9, 12.1, ts=100.0),
        detect_out_of_baseline("fill_level", 12.6, 15.8, 16.2, ts=100.5),
    ]
    return group_observations([o for o in obs if o], window_s=2.0)[0]


def test_block_lists_signals_and_observations():
    block = build_event_context(_event(), resolved={"asset": "filler01",
                                                     "component": "fill valve"})
    assert "[MACHINE EVENT]" in block
    assert "filler01" in block and "fill valve" in block
    assert "bowl_pressure" in block and "fill_level" in block
    assert "Observations" in block and "normally stays" in block


def test_block_works_without_resolved_context():
    block = build_event_context(_event())
    assert "[MACHINE EVENT]" in block
    assert "Signals changed (2)" in block
    # no asset/component lines when unresolved
    assert "Asset:" not in block


def test_block_includes_manuals_when_present():
    block = build_event_context(_event(), resolved={"manuals": ["GS10 UM p.34"]})
    assert "Reference docs" in block and "GS10 UM p.34" in block
