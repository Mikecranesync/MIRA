# tests/ignition/test_gateway_live_snapshot.py
# Pytest suite for THE canonical Gateway live tag-snapshot adapter.
#
# Verifies that the chat path and the stream path now derive from ONE reading
# contract: typed values (not stringified), BANDED quality (not raw Ignition
# strings), and a FAIL-CLOSED allowlist. All Ignition I/O is injected — no
# Gateway, no PLC, no network, no DB.
#
# Run: python3 -m pytest tests/ignition/test_gateway_live_snapshot.py -v

import os
import re
import sys

import pytest

# collector.py / allowlist.py / gateway_live_snapshot.py live together in api/tags;
# collector adds api/chat to sys.path for signing.py.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../ignition/webdev/FactoryLM/api/tags"))

import allowlist  # noqa: E402
import collector  # noqa: E402
import gateway_live_snapshot as gls  # noqa: E402


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

    snap, stats = gls.collect_live_snapshot(browse_fn, read_fn, ASSET, allowlist=allow)

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
    snap, _ = gls.collect_live_snapshot(browse_fn, read_fn, ASSET, allowlist={p})
    assert snap[p]["value"] != "48.5"
    assert not isinstance(snap[p]["value"], str)


# ── FAIL-CLOSED allowlist (the security-shaped half) ────────────────────────


def test_empty_allowlist_drops_everything():
    """Fail-closed. The replaced path shipped the RAW snapshot when its allowlist
    import failed; an empty snapshot degrades the answer, an unfiltered one
    breaks the tag contract."""
    p1, p2 = _paths("speed_hz", "secret_recipe")
    browse_fn, read_fn = make_io({p1: FakeQV(1.0, "Good"), p2: FakeQV(2.0, "Good")})

    snap, stats = gls.collect_live_snapshot(browse_fn, read_fn, ASSET, allowlist=set())

    assert snap == {}
    assert stats["read"] == 2
    assert stats["allowed"] == 0
    assert stats["dropped"] == 2
    assert stats["allowlist_loaded"] is False


def test_non_allowlisted_tags_are_dropped():
    p_ok, p_no = _paths("speed_hz", "not_approved")
    browse_fn, read_fn = make_io({p_ok: FakeQV(1.0, "Good"), p_no: FakeQV(2.0, "Good")})

    snap, stats = gls.collect_live_snapshot(browse_fn, read_fn, ASSET, allowlist={p_ok})

    assert list(snap.keys()) == [p_ok]
    assert stats["dropped"] == 1


# ── degradation: never fabricate, never raise ───────────────────────────────


def test_missing_asset_id_yields_no_snapshot():
    """An assetless turn must SHORT-CIRCUIT, not browse the bare monitored root.

    Written this way deliberately: the first version used `make_io({})`, whose
    browse_fn returns [] for any folder, so the assertions held whether or not
    the guard existed — deleting `if not asset_id` kept the suite green. The
    fixture must be able to return tags, and the proof is that browse was never
    CALLED. (`monitored_folder("")` is `[default]Mira_Monitored/`, i.e. every
    monitored asset on the Gateway.)
    """
    (p,) = _paths("speed_hz")
    folder_seen = []
    browse_fn, read_fn = make_io({p: FakeQV(48.5, "Good")}, folder_seen=folder_seen)

    snap, stats = gls.collect_live_snapshot(browse_fn, read_fn, "", allowlist={p})

    assert snap == {}
    assert stats["read"] == 0
    assert folder_seen == [], (
        "assetless turn browsed %r — the short-circuit is gone" % folder_seen
    )


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

    snap, stats = gls.collect_live_snapshot(browse_fn, read_fn, ASSET, allowlist={p})
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

    snap, stats = gls.collect_live_snapshot(
        browse_fn, read_fn, ASSET, allowlist={p1, p2}
    )
    assert list(snap.keys()) == [p1]
    assert stats["read"] == 1


def test_empty_browse_yields_no_snapshot():
    snap, stats = gls.collect_live_snapshot(
        lambda _f: [], lambda _p: [], ASSET, allowlist={"x"}
    )
    assert snap == {}
    assert stats["read"] == 0


# ── the unification claim, asserted ─────────────────────────────────────────


def test_chat_and_stream_paths_agree_on_every_reading():
    """Both RENDERINGS of one set of readings agree, field by field.

    Scope, stated precisely because the first version of this docstring claimed
    more than the test does: this exercises `read_tag_readings` and renders the
    result two ways. It does NOT execute `gateway-scripts/tag-stream.py`, which
    is a Gateway timer script that calls `run()` at import and needs a live
    `system`. While the stream owned a SECOND browse/read loop, this test was
    therefore proof of nothing about the stream — the two agreed only because
    both loops happened to call `collector.build_reading`, and they differed in
    recursion and in ragged-read handling.

    What closes that gap is the delegation itself, asserted structurally by
    `test_stream_delegates_to_the_shared_reader` below.
    """
    p_speed, p_run = _paths("speed_hz", "running")
    tag_values = {p_speed: FakeQV(48.5, "Good_Unspecified"), p_run: FakeQV(False, "Bad_Stale")}
    browse_fn, read_fn = make_io(tag_values)
    allow = set(tag_values.keys())

    # CHAT rendering
    chat_snap, _ = gls.collect_live_snapshot(
        browse_fn, read_fn, ASSET, allowlist=allow
    )

    # STREAM rendering — same readings through collector.build_payload
    readings = gls.read_tag_readings(
        browse_fn, read_fn, gls.monitored_folder(ASSET)
    )
    stream_payload = collector.build_payload(
        "tenant-1", collector.filter_allowlisted(readings, allow)
    )

    assert stream_payload["source_system"] == "ignition"
    by_path = {r["tag_path"]: r for r in stream_payload["tags"]}
    assert set(by_path.keys()) == set(chat_snap.keys())
    for path, reading in by_path.items():
        # `ts` is in the loop on purpose: it is the observation time a technician
        # reads a value against. Without it the two renderings could disagree on
        # when the reading happened and this test would still pass.
        for field in ("value", "value_type", "quality", "ts"):
            assert chat_snap[path][field] == reading[field], (
                "%s.%s diverged: chat=%r stream=%r"
                % (path, field, chat_snap[path][field], reading[field])
            )


# ── the branch PRODUCTION actually takes: allowlist resolved internally ─────
#
# Every fail-closed test above passes an explicit `allowlist=`. doPost.py does
# NOT — it calls collect_live_snapshot(_browse, _read, asset_id), so production
# takes the `allowlist is None` branch, which had ZERO coverage: a fail-open
# reintroduction inside it passed the whole suite. These two tests cover it.
#
# MIRA_ALLOWLIST_PATH is pinned in both, because the real resolver falls back to
# the installed-Gateway path (`C:/Program Files/.../approved_tags.json`, present
# on the bench laptop) and then to the in-repo file — so an unpinned test would
# assert against whatever the machine happens to have. Pinning keeps the suite
# hermetic, which is the header's claim.


def test_internally_resolved_allowlist_filters_fail_closed(tmp_path, monkeypatch):
    """With no allowlist argument, the adapter loads one and STILL filters."""
    p_ok, p_no = _paths("speed_hz", "not_approved")
    approved = tmp_path / "approved_tags.json"
    approved.write_text('{"tags": ["%s"]}' % p_ok)
    monkeypatch.setenv("MIRA_ALLOWLIST_PATH", str(approved))

    browse_fn, read_fn = make_io(
        {p_ok: FakeQV(48.5, "Good"), p_no: FakeQV(1, "Good")}
    )
    snap, stats = gls.collect_live_snapshot(browse_fn, read_fn, ASSET)

    assert list(snap.keys()) == [p_ok]
    assert stats["dropped"] == 1
    assert stats["allowlist_loaded"] is True


def test_unresolvable_allowlist_drops_everything_not_fail_open(tmp_path, monkeypatch):
    """No loadable allowlist ANYWHERE => EMPTY snapshot, never an unfiltered one.

    This is the load-bearing claim of the module, asserted on the branch the
    Gateway actually uses. An empty snapshot degrades the answer; an unfiltered
    one breaks the tag contract, so empty is the correct failure.

    Pointing MIRA_ALLOWLIST_PATH at a missing file is NOT enough to reach this
    branch, which is worth writing down: `resolve_allowlist_path()` honours the
    override only `if override and os.path.isfile(override)` and otherwise falls
    through to `_DEFAULT_PATHS` — the installed-Gateway allowlist (58 tags on the
    bench laptop) or the in-repo copy. A typo'd override therefore silently
    substitutes a DIFFERENT allowlist rather than failing closed. So the search
    path is emptied too, which is what "no allowlist deployed" actually means.
    """
    monkeypatch.setenv("MIRA_ALLOWLIST_PATH", str(tmp_path / "does_not_exist.json"))
    monkeypatch.setattr(allowlist, "_DEFAULT_PATHS", [], raising=True)

    (p,) = _paths("speed_hz")
    browse_fn, read_fn = make_io({p: FakeQV(48.5, "Good")})
    snap, stats = gls.collect_live_snapshot(browse_fn, read_fn, ASSET)

    assert snap == {}
    assert stats["read"] == 1          # the tags WERE readable …
    assert stats["allowed"] == 0       # … and were dropped on purpose
    assert stats["allowlist_loaded"] is False  # what doPost.py logs at ERROR


def test_browse_uses_the_monitored_folder_convention():
    seen = []
    (p,) = _paths("a")
    browse_fn, read_fn = make_io({p: FakeQV(1, "Good")}, folder_seen=seen)
    gls.collect_live_snapshot(browse_fn, read_fn, ASSET, allowlist={p})
    assert seen == ["[default]Mira_Monitored/cv_101"]


def test_now_fn_overrides_timestamp_else_tag_timestamp_wins():
    """Default to the TAG's own timestamp — the truthful observation time — and
    allow an override only when the caller explicitly injects one."""
    (p,) = _paths("a")
    browse_fn, read_fn = make_io({p: FakeQV(1, "Good", timestamp="TAG-TS")})

    snap, _ = gls.collect_live_snapshot(browse_fn, read_fn, ASSET, allowlist={p})
    assert snap[p]["ts"] == "TAG-TS"

    snap2, _ = gls.collect_live_snapshot(
        browse_fn, read_fn, ASSET, allowlist={p}, now_fn=lambda: "INJECTED"
    )
    assert snap2[p]["ts"] == "INJECTED"


def test_snapshot_entries_match_the_pipeline_consumer_contract():
    """mira-pipeline/ignition_chat.py::_format_tag_preamble reads `value` and
    `quality` off each entry (and optional units/data_type added cloud-side).
    Keep those key names."""
    (p,) = _paths("a")
    browse_fn, read_fn = make_io({p: FakeQV(7, "Good")})
    snap, _ = gls.collect_live_snapshot(browse_fn, read_fn, ASSET, allowlist={p})
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
ADAPTER_SRC = os.path.join(_REPO_IGNITION, "webdev/FactoryLM/api/tags/gateway_live_snapshot.py")
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
        assert token not in code, "gateway_live_snapshot.py must never reference %r" % token


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
    assert "from gateway_live_snapshot import collect_live_snapshot" in raw
    # The old stringifying read and the fail-open allowlist API must be gone
    # from the executing code.
    assert "str(qv.value)" not in code
    assert "is_allowed_tag" not in code
    # browseTags/readBlocking may only appear inside the injected wrappers that
    # hand I/O to the adapter — never in a second inline snapshot build.
    assert code.count("browseTags") <= 1
    assert code.count("readBlocking") <= 1


# ── the guards below exist because the ones above were proved insufficient ────
#
# Mutation testing of this file (2026-07-30) found that the read-only gate was
# pointed at the ONE file that cannot violate it. `gateway_live_snapshot.py` is
# read-only by construction — it imports nothing from Ignition and reaches a tag
# only through injected callables. `doPost.py` is the file with real `system.*`
# access, and it was checked for three literal spellings. Both of these passed:
#
#   * `system.tag.write([asset_id], [0])` added to doPost.py            → green
#   * the entire original defect re-added to doPost.py, using `unicode()`
#     instead of `str()` and reusing the existing _browse/_read wrappers → green
#
# So the assertions below check the CLASS, over EVERY handler that could violate
# it, not the previous spelling in one hand-picked module.
#
# HONEST LIMITS (do not read these guards as more than they are): this is a
# token scan over source text. A write reached through `getattr(system, "tag")`
# indirection, or through a callable injected by the caller, is NOT detected —
# both were confirmed to slip through. Those need review, not grep. What this
# does catch is the accidental reintroduction, which is the actual failure mode
# observed twice in this file's own history.

# OT/fieldbus writes — never permitted anywhere in the WebDev request surface.
# Deliberately NOT including DB writes: `system.db.runPrepUpdate` is legitimate
# here (doPost.py persists chat history; alerts/doGet.py acknowledges alarms).
# .claude/rules/fieldbus-readonly.md is about tags and fieldbuses, not the audit
# trail — conflating them would make the guard un-passable and get it deleted.
_OT_WRITE_TOKENS = (
    "system.tag.write",
    "writeBlocking",
    "writeAsync",
    "system.opc.write",
    "pymodbus",
    "pycomm3",
    "python-snap7",
    "write_register",
    "write_coil",
)

_WEBDEV_ROOT = os.path.join(_REPO_IGNITION, "webdev")


def _webdev_python_files():
    found = []
    for dirpath, _dirnames, filenames in os.walk(_WEBDEV_ROOT):
        if "__pycache__" in dirpath:
            continue
        for name in sorted(filenames):
            if name.endswith(".py"):
                found.append(os.path.join(dirpath, name))
    return sorted(found)


# The read-only rule stated as DEFAULT-DENY over the tag/OPC namespaces, because
# a token blocklist was refuted: `system.tag.configure` and `system.tag.editTag`
# both mutate tags, neither was in the list, and both passed. Any future
# `system.tag.<something>` would too. So instead: only these members may be
# touched from the WebDev surface, and anything else is a violation whether or
# not anyone thought of it.
_TAG_READ_MEMBERS = frozenset({
    "browseTags", "browse", "readBlocking", "read", "exists", "getConfiguration",
})
_OPC_READ_MEMBERS = frozenset({"readValue", "readValues", "browse", "browseSimple", "getServers"})

_SYSTEM_MEMBER_RE = re.compile(r"\bsystem\.(tag|opc)\.([A-Za-z_]\w*)")


def test_no_webdev_handler_touches_a_non_read_tag_api():
    """DEFAULT-DENY over system.tag.* / system.opc.* across the WebDev surface.

    Replaces a token blocklist that was proved evadable: `system.tag.configure`
    and `system.tag.editTag` mutate tags, were absent from the blocklist, and
    passed. Enumerating writes is a losing game — enumerate the permitted READS
    and deny the rest, so an API nobody anticipated fails closed.
    """
    offenders = []
    for path in _webdev_python_files():
        code = code_only(path)
        for ns, member in _SYSTEM_MEMBER_RE.findall(code):
            allowed = _TAG_READ_MEMBERS if ns == "tag" else _OPC_READ_MEMBERS
            if member not in allowed:
                offenders.append(
                    "%s: system.%s.%s" % (os.path.relpath(path, _REPO_IGNITION), ns, member)
                )
    assert not offenders, (
        "non-read tag/OPC API in the WebDev request surface — MIRA is read-only "
        "toward OT (.claude/rules/fieldbus-readonly.md). If a member is genuinely "
        "read-only, add it to _TAG_READ_MEMBERS/_OPC_READ_MEMBERS with a reason: %s"
        % offenders
    )


def test_no_webdev_handler_writes_to_ot():
    """Every WebDev handler, not just the adapter — the gate must cover the files
    that CAN violate the invariant, not only the one that cannot.

    Scope note: `ignition/gateway-scripts/` is deliberately excluded.
    tag-change-fsm-monitor.py and timer-stuck-state.py write anomaly JSON to an
    HMI *memory* alert tag — a pre-existing, separate case (not a fieldbus or
    control write). Widening this sweep to cover it is a judgement call about
    memory-tag writes that belongs in its own change, not smuggled in here.
    """
    files = _webdev_python_files()
    assert len(files) >= 5, "webdev tree not found — the sweep would vacuously pass"

    violations = []
    for path in files:
        code = code_only(path)
        for token in _OT_WRITE_TOKENS:
            if token in code:
                violations.append("%s: %s" % (os.path.relpath(path, _REPO_IGNITION), token))
    assert not violations, (
        "OT write in the WebDev request surface (MIRA is read-only toward OT — "
        ".claude/rules/fieldbus-readonly.md): %s" % violations
    )


def test_chat_handler_builds_no_second_snapshot():
    """The defect CLASS, not its previous spelling.

    The original bug was an inline snapshot build in doPost.py that stringified
    values and applied its allowlist fail-open. Re-adding it with `unicode()`
    instead of `str()`, reusing the wrappers already defined for the adapter,
    evaded every earlier assertion. Two structural facts kill the whole class:

      1. `filtered_snapshot` is only ever assigned WHOLE (from the adapter, or
         `{}` on failure). Any `filtered_snapshot[...] = ...` is a second build.
      2. Nothing in this handler stringifies a `.value`, under any spelling.
    """
    code = code_only(CHAT_SRC)

    assert "filtered_snapshot[" not in code, (
        "doPost.py assigns into filtered_snapshot — that is a second, inline "
        "snapshot build; the adapter is the only permitted source"
    )

    # The `filtered_snapshot[` check alone was refuted: a second loop can build a
    # DIFFERENTLY-NAMED dict (`_inline = {}`) and merge it later. What it cannot do
    # is avoid touching the injected I/O wrappers. Each is defined once and used
    # once — as an argument to collect_live_snapshot — so a count of 2 is exact and
    # any extra reference is a second read path.
    for wrapper in ("_browse", "_read"):
        assert code.count(wrapper) == 2, (
            "%s is referenced %d times in doPost.py (expected exactly 2: its "
            "definition and the single collect_live_snapshot call). An extra "
            "reference means a second tag-read path, which is how the two "
            "evidence shapes diverged in the first place."
            % (wrapper, code.count(wrapper))
        )

    stringified = re.findall(r"\b(?:str|unicode|unicode_type)\(\s*[A-Za-z_][\w.]*\.value\b", code)
    assert not stringified, (
        "doPost.py stringifies a tag value (%r) — values must keep their Python "
        "type; that divergence is the whole defect this module closes" % stringified
    )


def _unguarded_dunder_file(path):
    """Every `__file__` reference NOT lexically inside a try/except that catches
    NameError. Structural (AST), because a substring check is a decoy magnet."""
    import ast

    tree = ast.parse(open(path, encoding="utf-8").read())

    guarded: set[int] = set()
    for node in ast.walk(tree):
        if not isinstance(node, ast.Try):
            continue
        catches_nameerror = False
        for handler in node.handlers:
            names = []
            if isinstance(handler.type, ast.Name):
                names = [handler.type.id]
            elif isinstance(handler.type, ast.Tuple):
                names = [e.id for e in handler.type.elts if isinstance(e, ast.Name)]
            elif handler.type is None:
                names = ["BaseException"]  # bare except catches it
            if "NameError" in names or "BaseException" in names:
                catches_nameerror = True
        if not catches_nameerror:
            continue
        # only the protected body counts — not the handlers/else/finally
        for stmt in node.body:
            for sub in ast.walk(stmt):
                if isinstance(sub, ast.Name) and sub.id == "__file__":
                    guarded.add(sub.lineno)

    return [
        n.lineno
        for n in ast.walk(tree)
        if isinstance(n, ast.Name) and n.id == "__file__" and n.lineno not in guarded
    ]


def test_chat_handler_survives_an_ignition_script_resource():
    """`__file__` is UNDEFINED in an Ignition script resource.

    collector.py:35-43 documents this trap and guards it with `except NameError`.
    doPost.py does the same path dance TWICE — once for the adapter, once for
    signing.py — and the second one sits outside any try, so on a Gateway it
    raises an UNCAUGHT NameError: HTTP 500 on every turn, not a degraded answer.
    No CPython test can observe either, because `__file__` always exists under
    pytest (and `tests/regime7_ignition/` also runs doPost under CPython).

    Asserted STRUCTURALLY, over the AST. The first version of this test was
    `assert "except NameError" in code` — a bare substring, unbound to the
    `__file__` expression, so a decoy handler elsewhere in the file satisfied it
    while the real dance went unguarded. That is the third generation of the same
    mistake this file keeps making: matching text that DESCRIBES the invariant
    instead of the code that carries it.
    """
    unguarded = _unguarded_dunder_file(CHAT_SRC)
    assert not unguarded, (
        "doPost.py dereferences __file__ at line(s) %s outside a try/except "
        "NameError — undefined in an Ignition script resource" % unguarded
    )

    code = code_only(CHAT_SRC)
    assert "__file__" in code, "test is stale — the path dance is gone"
    assert "except ImportError" in code, (
        "a missing adapter is a deployment fault and must be logged at ERROR, "
        "not folded into the best-effort warn path"
    )


def test_collector_also_guards_dunder_file():
    """The adapter's own dependency chain must survive a script resource too —
    it is the module that documented the trap in the first place."""
    for src in (ADAPTER_SRC, os.path.join(_REPO_IGNITION, "webdev/FactoryLM/api/tags/collector.py")):
        unguarded = _unguarded_dunder_file(src)
        assert not unguarded, "%s: unguarded __file__ at %s" % (os.path.basename(src), unguarded)


# ── the deployment contract: one credential, one meaning ────────────────────
#
# A reviewer found that the two transports read DIFFERENT property names for the
# same two secrets, and that the guide and the activation handler wrote only the
# stream's pair. A gateway set up from the documentation streamed tags correctly
# and returned HTTP 503 on every chat turn. Same defect shape as the two tag
# payloads this module unifies, one layer down: two names for one thing, with
# only one of them written down.

STREAM_SRC = os.path.join(_REPO_IGNITION, "gateway-scripts/tag-stream.py")
CONNECT_SRC = os.path.join(_REPO_IGNITION, "webdev/FactoryLM/api/connect/doPost.py")
PROPS_TEMPLATE = os.path.join(_REPO_IGNITION, "config/factorylm.properties.template")

_CANONICAL = ("MIRA_TENANT_ID", "MIRA_IGNITION_HMAC_KEY")
_LEGACY = ("TENANT_ID", "MIRA_HMAC_KEY")


@pytest.mark.parametrize("src,label", [(CHAT_SRC, "chat"), (STREAM_SRC, "stream")])
def test_both_transports_accept_both_property_spellings(src, label):
    """Neither transport may recognise only one spelling of a shared credential.

    Canonical first, legacy second. If a reader drops the legacy name, every
    gateway already in the field goes dark on upgrade; if it drops the canonical
    name, the two transports disagree again.
    """
    # Raw source, not code_only(): property names ARE string literals, and
    # code_only blanks those by design. Matching the CALL SITE
    # (`getMiraConfig("NAME"`) keeps this precise — a mention in a comment
    # cannot satisfy it.
    raw = open(src, encoding="utf-8").read()
    for name in _CANONICAL + _LEGACY:
        assert re.search(r'getMiraConfig\(\s*"%s"' % re.escape(name), raw), (
            "%s handler never calls getMiraConfig(%r) — a gateway configured "
            "with that property name would silently lose this transport"
            % (label, name)
        )


def test_activation_writes_the_canonical_tenant_id():
    """Activation is what a real deployment runs, so it must leave the gateway in
    a state BOTH transports can read. Writing only TENANT_ID is what produced a
    streaming-but-503-on-chat gateway."""
    raw = open(CONNECT_SRC, encoding="utf-8").read()
    assert re.search(r'_write_config\(\s*"MIRA_TENANT_ID"', raw), (
        "api/connect/doPost.py does not write MIRA_TENANT_ID — activation would "
        "again leave the chat path unconfigured"
    )


def test_properties_template_documents_every_credential_both_transports_need():
    """The template is the deployment contract. A credential a transport requires
    but the template never mentions is a 503 waiting for a first customer."""
    text = open(PROPS_TEMPLATE, encoding="utf-8").read()
    # The DECLARATION (`NAME=` at line start), not a mention. A substring
    # check passed here even with the real key line deleted, because the
    # surrounding comment prose still named it — the same reading-the-prose
    # mistake this file has now made four times. Caught by mutation, not review.
    for name in _CANONICAL + ("MIRA_CLOUD_URL",):
        assert re.search(r"(?m)^%s=" % re.escape(name), text), (
            "factorylm.properties.template has no `%s=` line — a credential a "
            "transport requires but the deployment contract never declares" % name
        )


# ── the unification claim, asserted on the STREAM as well ───────────────────


def test_stream_delegates_to_the_shared_reader():
    """tag-stream.py must not own a second browse/read loop.

    This is the assertion the parity test could not make. `tag-stream.py` calls
    `run()` at import and needs a live `system`, so it cannot be imported in a
    unit test; the claim is therefore asserted on its source.

    Before the delegation the two loops differed in ways that would have shown up
    on any nested tag structure: the stream recursed into folders and UDT
    instances, the chat path browsed one level and would have read a folder node
    as a tag. `system.tag.*` may still appear here — but only inside the injected
    wrappers handed to the shared reader.
    """
    code = code_only(STREAM_SRC)

    assert "read_tag_readings" in code, (
        "tag-stream.py no longer delegates to the shared reader — the 'one "
        "adapter, both transports' claim is false again"
    )
    assert "build_reading" not in code, (
        "tag-stream.py constructs readings itself; building a reading is the "
        "shared reader's job, and doing it in two places is how the two "
        "transports drifted apart"
    )
    # exactly one browse and one read, inside the injected wrappers
    assert code.count("browseTags") == 1, "more than one browse site in tag-stream.py"
    assert code.count("readBlocking") == 1, "more than one read site in tag-stream.py"


def test_recursive_browse_finds_tags_the_old_flat_browse_missed():
    """The behavioural half of the same fix.

    The chat path used to take `.fullPath` of each direct child, so a tag nested
    under a subfolder was invisible to it while the stream saw it. That is
    exactly 'the two transports disagree about what exists'.
    """
    class Node(object):
        def __init__(self, full_path, type_="AtomicTag"):
            self.fullPath = full_path
            self.type = type_

    root = "[default]Mira_Monitored/cv_101"
    tree = {
        root: [Node(root + "/speed_hz"), Node(root + "/drive", "Folder")],
        root + "/drive": [Node(root + "/drive/dc_bus"), Node(root + "/drive/fault")],
    }

    seen = []

    def browse_fn(folder):
        seen.append(folder)
        return tree.get(folder, [])

    paths = gls.browse_leaf_paths(browse_fn, root)

    assert paths == [
        root + "/speed_hz",
        root + "/drive/dc_bus",
        root + "/drive/fault",
    ], "nested leaves missing — the chat path would not see what the stream sees"
    assert root + "/drive" not in paths, "a folder node was returned as if it were a tag"
    assert seen == [root, root + "/drive"], "did not recurse exactly once into the subfolder"
