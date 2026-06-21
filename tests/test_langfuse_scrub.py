"""PII scrub for the Langfuse trace path.

The Langfuse trace path ships free-text payloads to a third-party SaaS
(Langfuse Cloud). InferenceRouter.sanitize_context() does NOT cover it, so
shared/langfuse_setup._scrub() strips IPs / MACs / serial numbers before the
payload leaves. These tests lock that behaviour and keep it aligned with the
canonical router.sanitize_text patterns.
"""

from shared.langfuse_setup import _scrub


def test_scrub_strips_ipv4():
    assert _scrub("PLC at 192.168.1.11 is faulted") == "PLC at [IP] is faulted"


def test_scrub_strips_mac():
    assert _scrub("device 00:1B:44:11:3A:B7 offline") == "device [MAC] offline"


def test_scrub_strips_serial():
    out = _scrub("drive SN: AB12-3456 tripped")
    assert "AB12-3456" not in out
    assert "[SN]" in out


def test_scrub_leaves_clean_text_untouched():
    msg = "Why did the conveyor stop? No fault code on the VFD."
    assert _scrub(msg) == msg


def test_scrub_handles_non_string():
    assert _scrub(None) is None
    assert _scrub(1234) == 1234


def test_scrub_strips_multiple_in_one_string():
    out = _scrub("host 10.0.0.5 mac 00:1B:44:11:3A:B7 here")
    assert "10.0.0.5" not in out
    assert "00:1B:44:11:3A:B7" not in out
    assert "[IP]" in out and "[MAC]" in out
