# tests/ignition/test_live_snapshot.py
# Pytest suite for THE canonical Gateway live tag-snapshot adapter.
#
# Verifies that the chat path and the stream path now derive from ONE reading
# contract: typed values (not stringified), BANDED quality (not raw Ignition
# strings), and a FAIL-CLOSED allowlist. All Ignition I/O is injected — no
# Gateway, no PLC, no network, no DB.
#
# Run: python3 -m pytest tests/ignition/test_live_snapshot.py -v

import os
import sys

import pytest

# collector.py / allowlist.py / live_snapshot.py live together in api/tags;
# collector adds api/chat to sys.path for signing.py.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../ignition/webdev/FactoryLM/api/tags"))

import collector  # noqa: E402
import live_snapshot  # noqa: E402


# ── injected Ignition doubles ────────────────────────────────────────────────


class FakeTag(object):
    def __init__(self, full_path):
        self.fullPath = full_path


class FakeQV(object):
    """Stand-in for an Ignition QualifiedValue."""

    def __init__(self, value, quality, timestamp="2026-07-30T00:00:00Z"):
        self.value = value
        self.quality = quality
        self.timestamp = timestamp


def make_io(tag_values, folder_seen=None):
    """(browse_fn, read_fn) over an ordered {path: FakeQV} mapping."""
    paths = list(tag_values.keys())

    def browse_fn(folder):
        if folder_seen is not None:
            folder_seen.append(folder)
        return [FakeTag(p) for p in paths]

    def read_fn(requested):
        return [tag_values[p] for p in requested]

    return browse_fn, read_fn


ASSET = "cv_101"


def _paths(*names):
    return ["[default]Mira_Monitored/%s/%s" % (ASSET, n) for n in names]


# ── the core defect: values must stay TYPED, quality must be BANDED ──────────


def test_values_keep_their_type_and_quality_is_banded():
    """The chat path used to emit `str(qv.value)` and the raw Ignition quality.
    A float must stay a float, a bool a bool, and 'Good_Unspecified' must band
    to 'good' — otherwise the same physical reading has two shapes depending on
    which transport carried it."""
    p_speed, p_run, p_count = _paths("speed_hz", "running", "count")
    tag_values = {
        p_speed: FakeQV(48.5, "Good_Unspecified"),
        p_run: FakeQV(True, "Good"),
        p_count: FakeQV(1732, "Bad_Stale"),
    }
    browse_fn, read_fn = make_io(tag_values)
    allow = set(tag_values.keys())

    snap, stats = live_snapshot.collect_live_snapshot(browse_fn, read_fn, ASSET, allowlist=allow)

    assert stats == {"read": 3, "allowed": 3, "dropped": 0, "allowlist_loaded": True}

    assert snap[p_speed]["value"] == 48.5
    assert isinstance(snap[p_speed]["value"], float)
    assert snap[p_speed]["value_type"] == "float"
    assert snap[p_speed]["quality"] == "good"  # banded, not "Good_Unspecified"

    assert snap[p_run]["value"] is True
    assert snap[p_run]["value_type"] == "bool"

    assert snap[p_count]["value"] == 1732
    assert snap[p_count]["value_type"] == "int"
    assert snap[p_count]["quality"] == "stale"  # Bad_Stale bands to stale, not bad


def test_no_value_is_stringified():
    """Explicit regression guard for the exact old behaviour."""
    (p,) = _paths("speed_hz")
    browse_fn, read_fn = make_io({p: FakeQV(48.5, "Good")})
    snap, _ = live_snapshot.collect_live_snapshot(browse_fn, read_fn, ASSET, allowlist={p})
    assert snap[p]["value"] != "48.5"
    assert not isinstance(snap[p]["value"], str)


# ── FAIL-CLOSED allowlist (the security-shaped half) ────────────────────────


def test_empty_allowlist_drops_everything():
    """Fail-closed. The replaced path shipped the RAW snapshot when its allowlist
    import failed; an empty snapshot degrades the answer, an unfiltered one
    breaks the tag contract."""
    p1, p2 = _paths("speed_hz", "secret_recipe")
    browse_fn, read_fn = make_io({p1: FakeQV(1.0, "Good"), p2: FakeQV(2.0, "Good")})

    snap, stats = live_snapshot.collect_live_snapshot(browse_fn, read_fn, ASSET, allowlist=set())

    assert snap == {}
    assert stats["read"] == 2
    assert stats["allowed"] == 0
    assert stats["dropped"] == 2
    assert stats["allowlist_loaded"] is False


def test_non_allowlisted_tags_are_dropped():
    p_ok, p_no = _paths("speed_hz", "not_approved")
    browse_fn, read_fn = make_io({p_ok: FakeQV(1.0, "Good"), p_no: FakeQV(2.0, "Good")})

    snap, stats = live_snapshot.collect_live_snapshot(browse_fn, read_fn, ASSET, allowlist={p_ok})

    assert list(snap.keys()) == [p_ok]
    assert stats["dropped"] == 1


# ── degradation: never fabricate, never raise ───────────────────────────────


def test_missing_asset_id_yields_no_snapshot():
    browse_fn, read_fn = make_io({})
    snap, stats = live_snapshot.collect_live_snapshot(browse_fn, read_fn, "", allowlist={"x"})
    assert snap == {}
    assert stats["read"] == 0


@pytest.mark.parametrize("failing", ["browse", "read"])
def test_io_failure_degrades_to_empty_not_an_exception(failing):
    """A chat turn must stay answerable from documentation when the tag system is
    unreachable, so the adapter returns empty rather than raising."""

    def boom(*_a, **_k):
        raise RuntimeError("gateway unreachable")

    (p,) = _paths("speed_hz")
    ok_browse, ok_read = make_io({p: FakeQV(1.0, "Good")})
    browse_fn = boom if failing == "browse" else ok_browse
    read_fn = boom if failing == "read" else ok_read

    snap, stats = live_snapshot.collect_live_snapshot(browse_fn, read_fn, ASSET, allowlist={p})
    assert snap == {}
    assert stats["allowed"] == 0


def test_ragged_read_result_skips_rather_than_invents():
    """A short read result must never be padded with a made-up value — that would
    put a fabricated number in front of a technician."""
    p1, p2 = _paths("a", "b")

    def browse_fn(_folder):
        return [FakeTag(p1), FakeTag(p2)]

    def read_fn(_paths):
        return [FakeQV(1.0, "Good")]  # one value for two paths

    snap, stats = live_snapshot.collect_live_snapshot(
        browse_fn, read_fn, ASSET, allowlist={p1, p2}
    )
    assert list(snap.keys()) == [p1]
    assert stats["read"] == 1


def test_empty_browse_yields_no_snapshot():
    snap, stats = live_snapshot.collect_live_snapshot(
        lambda _f: [], lambda _p: [], ASSET, allowlist={"x"}
    )
    assert snap == {}
    assert stats["read"] == 0


# ── the unification claim, asserted ─────────────────────────────────────────


def test_chat_and_stream_paths_agree_on_every_reading():
    """THE POINT OF THIS MODULE.

    The same browse/read result must produce identical value / value_type /
    quality whether it is rendered for the chat turn (dict keyed by path) or for
    the relay stream (list of readings). Two transports, one reading contract.
    """
    p_speed, p_run = _paths("speed_hz", "running")
    tag_values = {p_speed: FakeQV(48.5, "Good_Unspecified"), p_run: FakeQV(False, "Bad_Stale")}
    browse_fn, read_fn = make_io(tag_values)
    allow = set(tag_values.keys())

    # CHAT rendering
    chat_snap, _ = live_snapshot.collect_live_snapshot(
        browse_fn, read_fn, ASSET, allowlist=allow
    )

    # STREAM rendering — same readings through collector.build_payload
    readings = live_snapshot.read_tag_readings(
        browse_fn, read_fn, live_snapshot.monitored_folder(ASSET)
    )
    stream_payload = collector.build_payload(
        "tenant-1", collector.filter_allowlisted(readings, allow)
    )

    assert stream_payload["source_system"] == "ignition"
    by_path = {r["tag_path"]: r for r in stream_payload["tags"]}
    assert set(by_path.keys()) == set(chat_snap.keys())
    for path, reading in by_path.items():
        for field in ("value", "value_type", "quality"):
            assert chat_snap[path][field] == reading[field], (
                "%s.%s diverged: chat=%r stream=%r"
                % (path, field, chat_snap[path][field], reading[field])
            )


def test_browse_uses_the_monitored_folder_convention():
    seen = []
    (p,) = _paths("a")
    browse_fn, read_fn = make_io({p: FakeQV(1, "Good")}, folder_seen=seen)
    live_snapshot.collect_live_snapshot(browse_fn, read_fn, ASSET, allowlist={p})
    assert seen == ["[default]Mira_Monitored/cv_101"]


def test_now_fn_overrides_timestamp_else_tag_timestamp_wins():
    """Default to the TAG's own timestamp — the truthful observation time — and
    allow an override only when the caller explicitly injects one."""
    (p,) = _paths("a")
    browse_fn, read_fn = make_io({p: FakeQV(1, "Good", timestamp="TAG-TS")})

    snap, _ = live_snapshot.collect_live_snapshot(browse_fn, read_fn, ASSET, allowlist={p})
    assert snap[p]["ts"] == "TAG-TS"

    snap2, _ = live_snapshot.collect_live_snapshot(
        browse_fn, read_fn, ASSET, allowlist={p}, now_fn=lambda: "INJECTED"
    )
    assert snap2[p]["ts"] == "INJECTED"


def test_snapshot_entries_match_the_pipeline_consumer_contract():
    """mira-pipeline/ignition_chat.py::_format_tag_preamble reads `value` and
    `quality` off each entry (and optional units/data_type added cloud-side).
    Keep those key names."""
    (p,) = _paths("a")
    browse_fn, read_fn = make_io({p: FakeQV(7, "Good")})
    snap, _ = live_snapshot.collect_live_snapshot(browse_fn, read_fn, ASSET, allowlist={p})
    entry = snap[p]
    assert "value" in entry and "quality" in entry
    assert isinstance(entry, dict)


# ── read-only gate: mechanical, not doctrinal ───────────────────────────────


FORBIDDEN_WRITE_TOKENS = (
    "system.tag.write",
    "writeBlocking",
    "writeAsync",
    "system.opc.write",
    "system.db.runUpdate",
    "runPrepUpdate",
    "pymodbus",
    "pycomm3",
    "write_register",
    "write_coil",
)

_REPO_IGNITION = os.path.join(os.path.dirname(__file__), "../../ignition")
ADAPTER_SRC = os.path.join(_REPO_IGNITION, "webdev/FactoryLM/api/tags/live_snapshot.py")
CHAT_SRC = os.path.join(_REPO_IGNITION, "webdev/FactoryLM/api/chat/doPost.py")


def code_only(path):
    """Return the file's CODE with comments and string literals BLANKED OUT.

    Two mistakes were made getting here, both worth recording because both
    produced a guard that looked fine:

    1. Matching raw file text made the guards fire on the explanatory comments
       *describing* the removed behaviour — a guard reading prose, not code.
    2. Stripping comment/string tokens and re-joining with `" ".join(...)` then
       made every MULTI-TOKEN assertion vacuous: `system.tag.write` tokenizes to
       `system . tag . write`, so the substring could never match. A mutation
       that reintroduced `str(qv.value)` PASSED. Only single-token names like
       `writeBlocking` were really being checked.

    So: blank the comment/string spans IN PLACE, preserving all other layout, so
    dotted paths and call syntax survive verbatim.
    """
    import io as _io
    import tokenize as _tokenize

    with open(path, "rb") as fh:
        raw = fh.read()
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:  # pragma: no cover
        pytest.fail("could not decode %s" % path)

    lines = text.splitlines(True)
    try:
        toks = list(_tokenize.tokenize(_io.BytesIO(raw).readline))
    except (_tokenize.TokenError, IndentationError, SyntaxError) as exc:  # pragma: no cover
        pytest.fail("could not tokenize %s: %s" % (path, exc))

    for tok in toks:
        if tok.type not in (_tokenize.COMMENT, _tokenize.STRING):
            continue
        (srow, scol), (erow, ecol) = tok.start, tok.end
        for row in range(srow, erow + 1):
            idx = row - 1
            if idx >= len(lines):
                continue
            line = lines[idx]
            start = scol if row == srow else 0
            end = ecol if row == erow else len(line)
            keep_nl = line.endswith("\n") and end >= len(line.rstrip("\n"))
            blanked = line[:start] + (" " * max(0, end - start)) + line[end:]
            lines[idx] = blanked if not keep_nl else blanked.rstrip("\n") + "\n"
    return "".join(lines)


def test_code_only_helper_actually_strips_prose():
    """Prove the stripper works before trusting the guards built on it —
    otherwise a guard that always passes looks identical to a clean file."""
    assert "str(qv.value)" in open(CHAT_SRC).read()  # present, in a comment
    assert "str(qv.value)" not in code_only(CHAT_SRC)  # absent from the code
    assert "browseTags" in open(ADAPTER_SRC).read()  # present, in a docstring
    assert "browseTags" not in code_only(ADAPTER_SRC)


def test_code_only_preserves_multi_token_syntax():
    """The regression that made the dotted-path guards vacuous: `system.tag.write`
    must survive as a contiguous substring, not become `system . tag . write`."""
    code = code_only(CHAT_SRC)
    # Real dotted calls in doPost.py must still be findable verbatim.
    assert "system.tag.browseTags" in code
    assert "system.tag.readBlocking" in code
    assert "collect_live_snapshot(" in code


def test_adapter_contains_no_write_or_fieldbus_path():
    """MIRA stays strictly read-only toward OT (.claude/rules/fieldbus-readonly.md).
    Asserted on the code rather than trusting review."""
    code = code_only(ADAPTER_SRC)
    for token in FORBIDDEN_WRITE_TOKENS:
        assert token not in code, "live_snapshot.py must never reference %r" % token


def test_adapter_imports_no_ignition_runtime():
    """It must stay Gateway-free so it is testable and cannot reach OT directly.
    Injected callables are the only route to a tag."""
    code = code_only(ADAPTER_SRC)
    assert "import system" not in code
    assert "system.tag" not in code


def test_chat_handler_no_longer_reads_tags_inline():
    """doPost.py must route through the adapter. If someone reintroduces an inline
    browse/read there, the two shapes diverge again — the whole defect this closes."""
    code = code_only(CHAT_SRC)
    raw = open(CHAT_SRC).read()
    assert "from live_snapshot import collect_live_snapshot" in raw
    # The old stringifying read and the fail-open allowlist API must be gone
    # from the executing code.
    assert "str(qv.value)" not in code
    assert "is_allowed_tag" not in code
    # browseTags/readBlocking may only appear inside the injected wrappers that
    # hand I/O to the adapter — never in a second inline snapshot build.
    assert code.count("browseTags") <= 1
    assert code.count("readBlocking") <= 1
