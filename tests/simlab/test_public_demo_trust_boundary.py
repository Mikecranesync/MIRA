"""The public demo may read live machine evidence. It may never read the answer.

SimLab is BOTH the machine and the grader. ``Scenario`` carries the live tag
trajectory *and* ``expected_root_cause`` / ``expected_asset`` /
``expected_evidence_tags`` / ``expected_actions`` / ``expected_citations`` — the
rubric that decides whether MIRA got it right. The public demo's whole claim is
that MIRA diagnoses a machine it was not told the answer to, so the boundary
between those two halves is the demo's only real proof.

``simlab/diagnostic.py`` states the separation in prose ("NOT an answer engine…
does NOT peek at ``scenario.expected_*``"). Prose is not a guarantee: nothing in
the suite failed if a future edit widened ``/simlab/snapshot`` to carry the
scenario title, or if the browser bridge started reading ``/simlab/evidence/…``
because it was convenient. This file is that guarantee.

Two halves, and both are necessary:

* **The negative** — every payload the public demo is allowed to read carries no
  rubric content, for every scenario in ``simlab/scenarios.py``.
* **The positive control** — the two endpoints that DO carry ground truth are
  asserted to carry it. Without this, a test whose leak detector silently stopped
  working (a renamed field, a matcher that no longer matches) would stay green
  while proving nothing, which is the exact failure mode this file exists to
  prevent. See ``.claude/rules/prove-the-test-fails.md``.

What is deliberately NOT treated as a leak
------------------------------------------
``fault_code`` on a live tag (``"CP001"`` on ``casepacker01``) is real machine
evidence: a PLC publishes its active fault code, and a technician standing at the
machine reads it off the HMI. Withholding it would make the demo *less* faithful,
not more honest. The rubric's ``expected_root_cause`` — the sentence "Case packer
infeed jam causing upstream line stop" — is the answer, and that is what must
never cross. Alarm ``message`` text is likewise genuine machine output (it is
defined on the asset model in ``simlab/lines/``, not on the scenario).

The asset-scoping finding
-------------------------
``assemble_evidence`` returns ``asset_id=scenario.asset_id``, and every scenario
sets ``expected_asset=asset_id``. So that packet names the faulted asset — half
the rubric — by construction. That is not a bug in ``assemble_evidence`` (it is a
grading-harness input, and the harness is allowed to know), but it does make
``/simlab/evidence/{scenario_id}`` **unsafe to expose to the public demo**, and
``test_evidence_endpoint_names_the_faulted_asset`` pins that so the reason
survives.
"""

from __future__ import annotations

import json
import re
from typing import Any

import pytest

fastapi = pytest.importorskip("fastapi", reason="fastapi not installed")
httpx = pytest.importorskip("httpx", reason="httpx not installed")

from simlab.scenarios import SCENARIOS, Scenario  # noqa: E402

# The complete set of endpoints the public demo bridge is allowed to call.
# Anything outside this list is a scope change, not a bug fix: the demo's trust
# claim is exactly "it only ever read these".
PUBLIC_DEMO_ENDPOINTS: tuple[str, ...] = (
    "/simlab/healthz",
    "/simlab/snapshot",
    "/simlab/alarms",
    "/simlab/history",
    "/simlab/assets/{asset_id}/tags",
    "/simlab/assets/{asset_id}/docs",
    "/simlab/docs/{asset_id}/{filename}",
    "/simlab/lines/{line_id}/assets",
    "/simlab/scenario/{scenario_id}/start",
    "/simlab/scenario/reset",
    "/simlab/scenario/tick",
)

FLAGSHIP = "casepacker_jam_upstream_block"

# Ticks past the flagship jam onset (tick 10), so the payloads under test are the
# faulted ones — a healthy snapshot would pass trivially.
JAM_TICKS = 40

LINE_BASE = "enterprise.florida_natural_demo.plant1.juice_bottling.line01"

FOCUS_ASSETS = ["conveyorzone01", "conveyorzone02", "casepacker01"]


@pytest.fixture()
def client(tmp_path: Any) -> Any:
    from fastapi.testclient import TestClient

    from simlab.api import build_app
    from simlab.approval import ApprovalStore
    from simlab.engine import SimEngine
    from simlab.lines.juice_bottling import build_line

    engine = SimEngine(build_line(), seed=42)
    approvals = ApprovalStore(str(tmp_path / "approvals.db"))
    return TestClient(build_app(engine=engine, approvals=approvals))


# ---------------------------------------------------------------------------
# The leak detector
# ---------------------------------------------------------------------------


def _tokens(text: str) -> list[str]:
    """Whole words, lowercased — never substrings.

    Substring matching over a concatenated payload is the wrong instrument here
    and the first draft of this file proved it: matching ``"case"`` inside
    ``"casepacker01"`` and ``"drift"`` inside ``"drifting"``, then allowing the
    remaining words to be satisfied anywhere else in a multi-kilobyte blob,
    flagged two of the machine's OWN alarm strings —

        "CasePacker01: infeed jam detected — clear and restart."
        "Labeler01: registration error drifting — check web tension."

    — as rubric leaks. Those are asset-model text (``AlarmDef.message`` in
    ``simlab/lines/juice_bottling.py``), which is exactly what a technician reads
    off the HMI; a boundary that suppressed them would be hiding the machine, not
    the answer. Tokenising both sides and matching whole words removes the false
    positive without weakening the real check.
    """
    return re.findall(r"[a-z]+", text.lower())


def _significant_words(phrase: str) -> list[str]:
    """Words long enough to be evidence of a copied rubric phrase.

    Mirrors ``simlab.diagnostic._phrase_hit``'s >=4-char rule, which is how the
    grader itself decides a phrase was reproduced. A shorter threshold would
    match incidental words ("the", "at") in legitimate machine text.
    """
    return [w for w in _tokens(phrase) if len(w) >= 4]


def _leaf_strings(payload: Any) -> list[str]:
    """Every string in ``payload``, values and keys alike.

    Keys are included deliberately: a leak hidden in a field name
    (``{"root_cause_hint": …}``) is still a leak.
    """
    out: list[str] = []
    if isinstance(payload, str):
        out.append(payload)
    elif isinstance(payload, dict):
        for key, value in payload.items():
            out.append(str(key))
            out.extend(_leaf_strings(value))
    elif isinstance(payload, (list, tuple)):
        for item in payload:
            out.extend(_leaf_strings(item))
    return out


def _phrase_reproduced(phrase: str, leaves: list[list[str]]) -> bool:
    """True when ONE field reproduces every significant word of ``phrase``.

    Scoped to a single field on purpose. "All the words appear somewhere in the
    payload" is satisfied by chance once a payload is large enough — the rubric's
    vocabulary (jam, clear, infeed, pressure) is drawn from the same machine the
    telemetry describes. A field that carries all of them is a copied sentence.
    """
    words = set(_significant_words(phrase))
    if not words:
        return False
    return any(words <= set(leaf) for leaf in leaves)


def rubric_leaks(payload: Any, scenario: Scenario) -> list[str]:
    """Every piece of ``scenario``'s ground truth found inside ``payload``."""
    blob = json.dumps(payload, default=str).lower()
    leaves = [_tokens(s) for s in _leaf_strings(payload)]
    leaks: list[str] = []

    if _phrase_reproduced(scenario.expected_root_cause, leaves):
        leaks.append(f"expected_root_cause: {scenario.expected_root_cause!r}")

    for action in scenario.expected_actions:
        if _phrase_reproduced(action, leaves):
            leaks.append(f"expected_action: {action!r}")

    # The title names the fault in product language ("Jam Causes Upstream
    # Backpressure"). Guarded VERBATIM rather than by word-bag: the titles were
    # written from the machines' own alarm text, so a vocabulary test would
    # convict the alarms themselves (see ``_tokens``). A verbatim copy is an
    # unambiguous leak; shared industrial vocabulary is not.
    #
    # Matched against the DECODED field values, never the JSON blob. Mutation
    # MUT3 caught the difference: ``json.dumps`` escapes the title's em-dash to
    # ``—``, whose bare ``u`` then tokenises as a word and splits the needle
    # ("case packer u jam causes…"), so a title pasted straight into an alarm
    # payload slipped through a guard that looked correct.
    title_needle = " ".join(_tokens(scenario.title))
    if title_needle and any(title_needle in " ".join(leaf) for leaf in leaves):
        leaks.append(f"title (verbatim): {scenario.title!r}")

    # Scenario identity. The id may reach the control that STARTS a scenario; it
    # may never come back inside a payload the conversation or the visualization
    # reads, because the id names the fault ("casepacker_jam_upstream_block").
    if scenario.id.lower() in blob:
        leaks.append(f"scenario_id: {scenario.id!r}")

    # The rubric's evidence list is the answer key for "which tags prove it". A
    # single expected tag path appearing in a snapshot of ALL tags is not a leak;
    # the ordered list appearing as a list is.
    if json.dumps(scenario.expected_evidence_tags).lower() in blob:
        leaks.append("expected_evidence_tags (verbatim list)")

    if json.dumps(scenario.expected_citations).lower() in blob:
        leaks.append("expected_citations (verbatim list)")

    return leaks


def public_payloads(client: Any, asset_ids: list[str]) -> dict[str, Any]:
    """Everything the public demo is allowed to read, at the current tick."""
    payloads: dict[str, Any] = {
        "healthz": client.get("/simlab/healthz").json(),
        "snapshot": client.get("/simlab/snapshot").json(),
        "alarms": client.get("/simlab/alarms").json(),
        "line_assets": client.get("/simlab/lines/line01/assets").json(),
    }
    for asset_id in asset_ids:
        payloads[f"tags:{asset_id}"] = client.get(f"/simlab/assets/{asset_id}/tags").json()
        payloads[f"docs:{asset_id}"] = client.get(f"/simlab/assets/{asset_id}/docs").json()
        payloads[f"snapshot:{asset_id}"] = client.get(
            "/simlab/snapshot", params={"asset": asset_id}
        ).json()
    payloads["history"] = client.get(
        "/simlab/history",
        params={"tag": f"{LINE_BASE}.casepacker01.status.jam_detected"},
    ).json()
    return payloads


# ---------------------------------------------------------------------------
# 1. The negative — no rubric content in any public payload, every scenario
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("scenario_id", sorted(SCENARIOS))
def test_public_payloads_carry_no_rubric_content(client: Any, scenario_id: str) -> None:
    """Start each scenario, run it into its fault, read everything the demo may
    read, and find none of the answer in it."""
    scenario = SCENARIOS[scenario_id]
    assert client.post(f"/simlab/scenario/{scenario_id}/start").status_code == 200
    assert client.post("/simlab/scenario/tick", params={"n": 120}).status_code == 200

    assets = sorted({*FOCUS_ASSETS, scenario.asset_id})
    payloads = public_payloads(client, assets)

    for name, payload in payloads.items():
        leaks = rubric_leaks(payload, scenario)
        assert leaks == [], f"{scenario_id} leaked into {name}: {leaks}"


@pytest.mark.parametrize("scenario_id", sorted(SCENARIOS))
def test_asset_docs_are_the_machines_documents_not_the_answer_key(
    client: Any, scenario_id: str
) -> None:
    """Every asset offers the same document set regardless of which scenario is
    loaded, so the document list cannot be read as "these are the ones that
    matter"."""
    scenario = SCENARIOS[scenario_id]
    client.post(f"/simlab/scenario/{scenario_id}/start")
    client.post("/simlab/scenario/tick", params={"n": JAM_TICKS})
    docs_when_faulted = client.get(f"/simlab/assets/{scenario.asset_id}/docs").json()

    assert client.post("/simlab/scenario/reset").status_code == 200
    docs_when_healthy = client.get(f"/simlab/assets/{scenario.asset_id}/docs").json()

    assert docs_when_faulted == docs_when_healthy, (
        "the document list changed when a fault was loaded — that difference is "
        "itself a hint about the answer"
    )


def test_document_content_is_identical_whichever_fault_is_loaded(client: Any) -> None:
    """The citation corpus cannot encode the answer, because it never changes.

    ``expected_citations`` are filenames from the machine's own documentation, and
    the expected ACTIONS were written from those documents — so the rubric and the
    citable corpus legitimately share vocabulary, and a word-overlap test on
    document text would convict the documentation for being the source of the
    answer rather than a leak of it.

    The property that actually matters is invariance: the bytes a visitor can
    cite are the same whether the line is healthy, jammed, or running a different
    fault entirely. A document that changed with the loaded scenario would be
    smuggling ground truth into the corpus, and this is what would catch it.
    """
    filenames = client.get("/simlab/assets/casepacker01/docs").json()
    assert filenames, "casepacker01 must publish documents to cite"

    def corpus() -> dict[str, str]:
        return {
            name: client.get(f"/simlab/docs/casepacker01/{name}").text
            for name in filenames
        }

    client.post("/simlab/scenario/reset")
    healthy = corpus()

    client.post(f"/simlab/scenario/{FLAGSHIP}/start")
    client.post("/simlab/scenario/tick", params={"n": JAM_TICKS})
    jammed = corpus()

    client.post("/simlab/scenario/low_plant_air_multi_machine/start")
    client.post("/simlab/scenario/tick", params={"n": JAM_TICKS})
    other_fault = corpus()

    assert healthy == jammed == other_fault


def test_scenario_id_never_returns_from_the_endpoints_the_demo_reads(client: Any) -> None:
    """The one-way rule for the scenario id.

    The id goes OUT on ``/scenario/{id}/start`` (the control the visitor presses)
    and must not come back IN on anything the conversation or the visualization
    reads — it names the fault in plain English.
    """
    scenario = SCENARIOS[FLAGSHIP]
    start = client.post(f"/simlab/scenario/{FLAGSHIP}/start").json()
    # The start response is the control's own acknowledgement, not demo data; it
    # legitimately echoes the id, and the bridge must not forward it.
    assert start["scenario_id"] == FLAGSHIP

    client.post("/simlab/scenario/tick", params={"n": JAM_TICKS})
    blob = json.dumps(public_payloads(client, FOCUS_ASSETS), default=str).lower()
    assert scenario.id.lower() not in blob
    assert "scenario" not in blob


# ---------------------------------------------------------------------------
# 2. The positive control — the detector can actually see a leak
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("scenario_id", sorted(SCENARIOS))
def test_rubric_endpoint_is_full_of_ground_truth(client: Any, scenario_id: str) -> None:
    """``/scenario/{id}/rubric`` is the answer key, and the detector says so.

    If this ever goes green-by-accident — because ``rubric_leaks`` stopped
    matching — the negative tests above become meaningless. This is the canary
    for the canary.
    """
    scenario = SCENARIOS[scenario_id]
    rubric = client.get(f"/simlab/scenario/{scenario_id}/rubric").json()
    leaks = rubric_leaks(rubric, scenario)
    assert any(leak.startswith("expected_root_cause") for leak in leaks), leaks
    assert f"scenario_id: {scenario.id!r}" in leaks


def test_evidence_endpoint_names_the_faulted_asset(client: Any) -> None:
    """Why ``/simlab/evidence/{scenario_id}`` is not a public endpoint.

    ``assemble_evidence`` is scoped to ``scenario.asset_id`` and every scenario
    sets ``expected_asset = asset_id``, so the packet answers "which machine is at
    fault" before MIRA reasons at all. Legitimate for the grading harness;
    disqualifying for the public demo. Pinned so the reason cannot be lost.
    """
    scenario = SCENARIOS[FLAGSHIP]
    client.post(f"/simlab/scenario/{FLAGSHIP}/start")
    client.post("/simlab/scenario/tick", params={"n": JAM_TICKS})

    evidence = client.get(f"/simlab/evidence/{FLAGSHIP}").json()
    assert evidence["asset_id"] == scenario.expected_asset
    assert not any("evidence" in route for route in PUBLIC_DEMO_ENDPOINTS)
    assert not any("rubric" in route for route in PUBLIC_DEMO_ENDPOINTS)


def _cors_probe(client: Any, origin: str) -> Any:
    return client.get("/simlab/snapshot", headers={"Origin": origin})


def test_browser_access_is_off_by_default(monkeypatch: Any, tmp_path: Any) -> None:
    """No CORS headers unless someone asked for them.

    A page served from another origin cannot read these endpoints without CORS,
    and the public demo host is exactly that. But the default surface is
    headless (CI, the eval runner, `curl`), so the middleware is opt-in: nothing
    about existing behaviour moves unless ``SIMLAB_CORS_ORIGINS`` is set.
    """
    monkeypatch.delenv("SIMLAB_CORS_ORIGINS", raising=False)
    response = _cors_probe(_build_client(tmp_path), "http://localhost:4199")
    assert response.status_code == 200
    assert "access-control-allow-origin" not in {k.lower() for k in response.headers}


def test_browser_access_is_granted_only_to_the_named_origin(monkeypatch: Any, tmp_path: Any) -> None:
    """And when it is asked for, it is asked for by name — not `*`."""
    monkeypatch.setenv("SIMLAB_CORS_ORIGINS", "http://localhost:4199")
    client = _build_client(tmp_path)

    allowed = _cors_probe(client, "http://localhost:4199")
    assert allowed.headers.get("access-control-allow-origin") == "http://localhost:4199"

    other = _cors_probe(client, "http://evil.example")
    assert other.headers.get("access-control-allow-origin") != "http://evil.example"


def _build_client(tmp_path: Any) -> Any:
    from fastapi.testclient import TestClient

    from simlab.api import build_app
    from simlab.approval import ApprovalStore
    from simlab.engine import SimEngine
    from simlab.lines.juice_bottling import build_line

    return TestClient(build_app(
        engine=SimEngine(build_line(), seed=42),
        approvals=ApprovalStore(str(tmp_path / "approvals.db")),
    ))


@pytest.mark.parametrize("tag_name", ["run_state", "accumulation_percent"])
def test_undriven_tags_stay_undriven(client: Any, tag_name: str) -> None:
    """Two tags exist on these assets and never move, in any scenario.

    ``SimEngine._update_run_states`` assigns ``asset.packml_default`` at reset and
    nothing ever transitions it, so ``status.run_state`` is ``"Idle"`` on every
    asset in every scenario. Nothing writes ``process.accumulation_percent``, so
    it is ``0.0`` everywhere.

    The public demo therefore does NOT render either one — showing "Idle" beside
    a belt the same payload says is turning at 60 fpm, or a 0 % accumulation bar
    beside a zone the same payload calls blocked, is a contradiction a technician
    reads instantly. ``UNDRIVEN_TAGS`` in
    ``packages/factorylm-interaction/src/simlab.ts`` is the other half of this
    pair, and the TypeScript suite asserts they are absent from every rendered
    signal set.

    This test is the justification for that omission, and its expiry: if the
    simulator ever starts driving one of these, this goes red and the tag should
    be rendered rather than kept hidden.

    Sampled across ticks as well as scenarios. A single-tick sample is not enough:
    mutation MUT-P1 made ``run_state`` alternate with tick parity and a tick-120
    snapshot still saw one value on every asset in every scenario, so the guard
    passed while the tag had become genuinely dynamic.
    """
    observed: set[Any] = set()
    for scenario_id in sorted(SCENARIOS):
        client.post(f"/simlab/scenario/{scenario_id}/start")
        for step in (0, 1, 1, 8, 30, 80):
            if step:
                client.post("/simlab/scenario/tick", params={"n": step})
            tags = client.get("/simlab/snapshot").json()["tags"]
            observed |= {v for k, v in tags.items() if k.endswith(f".{tag_name}")}

    assert len(observed) == 1, (
        f"{tag_name} now varies ({sorted(observed)!r}) — the simulator drives it, so the "
        "public demo should render it instead of omitting it"
    )


def test_every_scenario_names_its_own_faulted_asset_as_the_expected_answer() -> None:
    """The coupling above is a property of every scenario, not one of them."""
    for scenario in SCENARIOS.values():
        assert scenario.expected_asset == scenario.asset_id, scenario.id


# ---------------------------------------------------------------------------
# 3. The live fault is still genuinely visible — the boundary did not gut the demo
# ---------------------------------------------------------------------------


def test_the_jam_is_visible_in_exactly_the_evidence_the_demo_may_read(client: Any) -> None:
    """Withholding the answer must not withhold the machine.

    A trust boundary that also hid the fault would pass every test above and
    leave nothing to diagnose, so this asserts the demo can still SEE the jam:
    the case-packer jam bit, its PLC fault code, the blocked upstream zone, and
    the fired alarms — all from the public endpoints alone.
    """
    client.post(f"/simlab/scenario/{FLAGSHIP}/start")
    client.post("/simlab/scenario/tick", params={"n": JAM_TICKS})

    tags = client.get("/simlab/snapshot").json()["tags"]
    assert tags[f"{LINE_BASE}.casepacker01.status.jam_detected"] is True
    assert tags[f"{LINE_BASE}.casepacker01.faults.fault_code"] == "CP001"
    assert tags[f"{LINE_BASE}.conveyorzone02.status.blocked"] is True

    codes = {a["code"] for a in client.get("/simlab/alarms").json()}
    assert "CP-JAM" in codes
    assert "C2-BLOCKED" in codes

    history = client.get(
        "/simlab/history",
        params={"tag": f"{LINE_BASE}.casepacker01.status.jam_detected"},
    ).json()["history"]
    assert any(point["value"] is False for point in history), "no healthy history to contrast"
    assert history[-1]["value"] is True


def test_reset_returns_a_deterministic_healthy_baseline(client: Any) -> None:
    """Reset is part of the boundary: a demo that cannot return to healthy cannot
    show the contrast the diagnosis depends on."""
    client.post(f"/simlab/scenario/{FLAGSHIP}/start")
    client.post("/simlab/scenario/tick", params={"n": JAM_TICKS})
    assert client.get("/simlab/alarms").json() != []

    assert client.post("/simlab/scenario/reset").json()["tick"] == 0
    client.post("/simlab/scenario/tick", params={"n": JAM_TICKS})

    tags = client.get("/simlab/snapshot").json()["tags"]
    assert tags[f"{LINE_BASE}.casepacker01.status.jam_detected"] is False
    assert tags[f"{LINE_BASE}.conveyorzone02.status.blocked"] is False
    assert tags[f"{LINE_BASE}.casepacker01.faults.fault_code"] == ""
    assert client.get("/simlab/alarms").json() == []
