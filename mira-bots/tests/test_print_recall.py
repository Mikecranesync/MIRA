"""``shared.print_recall`` — the production recall gate around the paid PrintSense
interpretation (behavior-preserving; wraps ``interpret_print`` at the engine seam).

Every test mocks the paid boundary — ZERO model calls. Covers: enablement +
import fall-through (once-per-process warning), persistent path resolution, CAS
singleton, per-key single-flight (concurrent identical -> one paid call; concurrent
different -> both), failure-by-phase (never a second paid call), corrupt-registry
recovery, missing-CAS-object recompute, and atomic snapshot persistence.
"""

from __future__ import annotations

import json
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, "mira-bots")

import pytest  # noqa: E402

pytest.importorskip("pydantic")

from printsense.models import Entity, PrintSynthGraph  # noqa: E402
from shared import print_recall  # noqa: E402


def _graph(tag: str = "-3/F1") -> PrintSynthGraph:
    return PrintSynthGraph(devices=[Entity(tag=tag, type="fuse", evidence=tag, confidence=0.9)])


def _pages(payload: bytes = b"page-A") -> list[tuple[bytes, str]]:
    return [(payload, "image/jpeg")]


def _call(gate, interpret_fn, *, pages=None, question="what is F1", package_context=None):
    return gate.interpret_with_recall(
        pages=pages or _pages(),
        question=question,
        package_context=package_context if package_context is not None else {"drawing_type": "sch"},
        model="m1",
        preprocess=True,
        interpret_fn=interpret_fn,
    )


def _counting(tag="-3/F1"):
    calls = {"n": 0}
    lock = threading.Lock()

    def fake(pages, **kw):
        with lock:
            calls["n"] += 1
        return _graph(tag)

    return fake, calls


@pytest.fixture
def gate(tmp_path, monkeypatch):
    """Enabled gate pointed at an isolated recall dir; CAS singleton reset per test
    (it is keyed on the resolved root, so a new tmp dir invalidates the cache)."""
    monkeypatch.setenv("PRINT_RECALL_ENABLED", "1")
    monkeypatch.setenv("PRINT_RECALL_DIR", str(tmp_path / "print_recall"))
    monkeypatch.setenv("PRINT_RECALL_ENV", "staging")
    print_recall._cas_singleton = None
    return print_recall


# ── enablement + import fall-through ────────────────────────────────────────────


def test_disabled_when_flag_unset(monkeypatch):
    monkeypatch.delenv("PRINT_RECALL_ENABLED", raising=False)
    assert print_recall.enabled() is False


def test_enabled_when_flag_on_and_imports_available(monkeypatch):
    monkeypatch.setenv("PRINT_RECALL_ENABLED", "1")
    print_recall._imports_ok_cache = None  # re-probe (imports are present in the venv)
    assert print_recall.enabled() is True


def test_disabled_when_imports_absent(monkeypatch):
    monkeypatch.setenv("PRINT_RECALL_ENABLED", "1")
    monkeypatch.setattr(print_recall, "_imports_ok", lambda: False)
    assert print_recall.enabled() is False


def test_unavailable_warning_emitted_once_per_process(caplog):
    print_recall._unavailable_warned = False
    with caplog.at_level("WARNING"):
        print_recall._warn_unavailable_once("import_error")
        print_recall._warn_unavailable_once("import_error")
    hits = [r for r in caplog.records if "PRINT_RECALL_UNAVAILABLE" in r.getMessage()]
    assert len(hits) == 1


def test_recall_dir_resolves_under_mira_db(monkeypatch):
    monkeypatch.delenv("PRINT_RECALL_DIR", raising=False)
    monkeypatch.setenv("MIRA_DB_PATH", "/mira-db/mira.db")
    assert print_recall._recall_dir() == Path("/mira-db") / "print_recall"


def test_cas_is_process_singleton(gate):
    assert gate._get_cas() is gate._get_cas()


# ── core behavior-preserving recall ─────────────────────────────────────────────


def test_second_identical_turn_makes_no_model_call(gate):
    fake, calls = _counting("-7/F7")
    g1 = _call(gate, fake)
    g2 = _call(gate, fake)
    assert calls["n"] == 1  # second turn recalled — model not paid again
    assert g2.model_dump() == g1.model_dump()  # byte-identical graph


def test_different_question_recomputes(gate):
    fake, calls = _counting()
    _call(gate, fake, question="what is F1")
    _call(gate, fake, question="trace the E-stop")
    assert calls["n"] == 2  # behavior-preserving: question shapes the graph -> recompute


def test_different_package_context_recomputes(gate):
    fake, calls = _counting()
    _call(gate, fake, package_context={"drawing_type": "schematic"})
    _call(gate, fake, package_context={"drawing_type": "panel_layout"})
    assert calls["n"] == 2


# ── concurrency: per-key single-flight ──────────────────────────────────────────


def test_concurrent_identical_calls_pay_once(gate):
    entered = threading.Event()
    release = threading.Event()
    calls = {"n": 0}
    lock = threading.Lock()

    def fake(pages, **kw):
        with lock:
            calls["n"] += 1
        entered.set()
        release.wait(3)
        return _graph("-9/F9")

    out: dict[str, PrintSynthGraph] = {}

    def worker(name):
        out[name] = _call(gate, fake)

    a = threading.Thread(target=worker, args=("a",))
    a.start()
    assert entered.wait(3)  # A is inside the (single) paid call, holding the key lock
    b = threading.Thread(target=worker, args=("b",))
    b.start()
    time.sleep(0.15)  # let B queue on the per-key lock
    release.set()
    a.join(5)
    b.join(5)
    assert calls["n"] == 1  # single-flight: B recalled A's result
    assert out["a"].model_dump() == out["b"].model_dump()


def test_concurrent_different_keys_both_compute(gate):
    calls = {"n": 0}
    lock = threading.Lock()

    def fake_tag(tag):
        def fake(pages, **kw):
            with lock:
                calls["n"] += 1
            return _graph(tag)

        return fake

    out: dict[str, PrintSynthGraph] = {}

    def worker(name, payload, tag):
        out[name] = _call(gate, fake_tag(tag), pages=_pages(payload))

    a = threading.Thread(target=worker, args=("a", b"AAA", "-1/F1"))
    b = threading.Thread(target=worker, args=("b", b"BBB", "-2/F2"))
    a.start()
    b.start()
    a.join(5)
    b.join(5)
    assert calls["n"] == 2  # distinct keys -> not coalesced
    assert out["a"].devices[0].tag == "-1/F1"
    assert out["b"].devices[0].tag == "-2/F2"  # no cross-key result sharing


# ── failure-by-phase: never a second paid call ──────────────────────────────────


def test_cas_write_failure_returns_graph_one_paid_call(gate, monkeypatch):
    class _CASPutBoom:
        root = Path("x")

        def put(self, *a, **k):
            raise RuntimeError("cas down")

        def get(self, *a, **k):
            raise KeyError

    monkeypatch.setattr(gate, "_get_cas", lambda: _CASPutBoom())
    fake, calls = _counting("-5/F5")
    g = _call(gate, fake)
    assert calls["n"] == 1  # paid exactly once
    assert g.devices[0].tag == "-5/F5"  # the computed graph is still returned


def test_registry_write_failure_returns_graph_one_paid_call(gate, tmp_path, monkeypatch):
    from materialized_evidence.backends import FileRegistry

    reg = FileRegistry(tmp_path / "boom.json")
    monkeypatch.setattr(
        reg, "register", lambda m: (_ for _ in ()).throw(RuntimeError("registry down"))
    )
    monkeypatch.setattr(gate, "_open_registry_fresh", lambda: reg)
    fake, calls = _counting("-6/F6")
    g = _call(gate, fake)
    assert calls["n"] == 1
    assert g.devices[0].tag == "-6/F6"


def test_paid_interpreter_failure_propagates_one_paid_call(gate):
    calls = {"n": 0}

    def fake(pages, **kw):
        calls["n"] += 1
        raise RuntimeError("vision 500")

    with pytest.raises(RuntimeError, match="vision 500"):
        _call(gate, fake)
    assert calls["n"] == 1  # propagated the original failure, no retry / second model call


# ── crash-safe persistence ──────────────────────────────────────────────────────


def test_corrupt_registry_snapshot_recovers(gate):
    reg_path = gate._recall_dir() / "registry.json"
    reg_path.parent.mkdir(parents=True, exist_ok=True)
    reg_path.write_text("{ this is not json", "utf-8")  # corrupt snapshot
    fake, calls = _counting("-8/F8")
    g = _call(gate, fake)  # must not raise; quarantine + treat empty + compute
    assert calls["n"] == 1
    assert g.devices[0].tag == "-8/F8"
    quarantined = list(reg_path.parent.glob("registry.json.corrupt*"))
    assert quarantined, "corrupt snapshot should be quarantined, not left in place"


def test_missing_cas_object_is_a_clean_miss(gate):
    fake, calls = _counting("-4/F4")
    _call(gate, fake)  # materialize (calls == 1)
    cas_dir = gate._recall_dir() / "cas"
    for obj in cas_dir.rglob("*"):
        if obj.is_file():
            obj.unlink()  # registry entry now points at a missing CAS object
    _call(gate, fake)  # same inputs: lookup can't load -> clean miss -> recompute
    assert calls["n"] == 2


def test_snapshot_write_is_atomic_and_valid(gate):
    fake, _ = _counting()
    _call(gate, fake)
    reg_path = gate._recall_dir() / "registry.json"
    assert reg_path.exists()
    json.loads(reg_path.read_text("utf-8"))  # atomic write left a valid, parseable snapshot
    assert not reg_path.with_suffix(".json.tmp").exists()  # no temp file left behind
