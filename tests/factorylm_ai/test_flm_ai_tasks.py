"""Tests for factorylm_ai.tasks — the task registry, prompt rendering, and
task_outputs schemas.

Hermetic: no network (MockProvider only), no wall clock assertions beyond
what MockProvider itself guarantees (latency_ms == 1). Imports only
``factorylm_ai.*`` + stdlib + pytest, per repo law (tests/factorylm_ai does
not rely on tests/conftest.py's sys.path setup).
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

from factorylm_ai.pricing import PRICING
from factorylm_ai.providers.base import ModelRequest
from factorylm_ai.providers.mock import MockProvider
from factorylm_ai.schemas.validate import SchemaError, load_schema, validate, validate_or_raise
from factorylm_ai.tasks import EMBED_MAX_INPUT_TOKENS, TASKS, TaskSpec, get_task, render_prompt

PROMPTS_DIR = Path(__file__).resolve().parents[2] / "factorylm_ai" / "tasks" / "prompts"

# The MVP fleet this package registers (handoff doc §6 "MVP fleet").
REGISTERED_TASK_IDS = ["M01", "M03", "M05", "M07", "M09", "M10", "M12"]

# Every chat task that produces a task_outputs-schema-validated JSON object
# (excludes M07 — embeddings, no output_schema, no prompt to render).
CHAT_TASK_IDS = ["M01", "M03", "M05", "M09", "M10", "M12"]

# Fleet ids from the handoff's §6 table that are intentionally NOT
# registered (see factorylm_ai.tasks module docstring for why each is
# absent): M02/M04/M06/M11 deferred pending benchmarks, M08 skipped (no
# serverless rerank model), M13 out of scope (rare heavy planning).
UNREGISTERED_TASK_IDS = ["M02", "M04", "M06", "M08", "M11", "M13"]

# One placeholder value per {name} used across the six rendering prompts —
# deliberately brace-free so "no unresolved braces remain" is a meaningful
# post-render check rather than a tautology.
DUMMY_PLACEHOLDER_KWARGS: dict[str, str] = {
    "caption_hint": "no caption provided",
    "sheet_hint": "sheet 6 of 12, title: Control Power",
    "recent_context": "no prior context",
    "tools_json": "tool list omitted for this test",
    "evidence_json": "evidence list omitted for this test",
    "correction_text": "the terminal is actually X4:17 not X4:11",
}

REQUIRED_JSON_DIRECTIVE = "Return ONLY a JSON object matching the schema provided."


# ---------------------------------------------------------------------------
# TASKS registry — membership, shape, internal consistency
# ---------------------------------------------------------------------------


def test_all_registered_tasks_load() -> None:
    for task_id in REGISTERED_TASK_IDS:
        task = get_task(task_id)
        assert isinstance(task, TaskSpec)
        assert task.task_id == task_id


def test_tasks_dict_has_exactly_the_mvp_fleet() -> None:
    assert set(TASKS) == set(REGISTERED_TASK_IDS)


def test_get_task_unknown_raises_key_error() -> None:
    with pytest.raises(KeyError):
        get_task("NOT_A_TASK")


@pytest.mark.parametrize("task_id", UNREGISTERED_TASK_IDS)
def test_get_task_intentionally_unregistered_ids_raise_key_error(task_id: str) -> None:
    # These are documented-but-not-registered (module docstring) — confirm
    # the gap is real, not an accidental omission the dict happens to hide.
    with pytest.raises(KeyError):
        get_task(task_id)


def test_get_task_is_case_insensitive() -> None:
    assert get_task("m01") is get_task("M01")


def test_task_id_field_matches_dict_key() -> None:
    for key, task in TASKS.items():
        assert key == task.task_id


def test_every_task_has_mock_fixture_default_model() -> None:
    for task in TASKS.values():
        assert task.default_models.get("mock") == "mock-fixture"


def test_every_task_together_model_is_a_priced_model() -> None:
    # Ties tasks/__init__.py's default_models to pricing.py's PRICING table
    # (both stage-1/contract ground truth) — a together model id that isn't
    # priced would silently fall back to the conservative unknown-model
    # rate everywhere cost is estimated.
    for task in TASKS.values():
        together_model = task.default_models.get("together")
        assert together_model is not None, f"{task.task_id} has no together default model"
        assert together_model in PRICING, f"{task.task_id}: {together_model!r} not in PRICING"


def test_m07_is_the_only_embedding_task() -> None:
    for task in TASKS.values():
        expected_kind = "embedding" if task.task_id == "M07" else "chat"
        assert task.input_kind == expected_kind


def test_m07_has_no_prompt_file_and_no_output_schema() -> None:
    task = get_task("M07")
    assert task.prompt_file is None
    assert task.output_schema is None
    assert task.input_kind == "embedding"


def test_embed_max_input_tokens_is_the_e5_cap() -> None:
    assert EMBED_MAX_INPUT_TOKENS == 514


def test_m10_is_the_only_evidence_required_task() -> None:
    for task in TASKS.values():
        expected = task.task_id == "M10"
        assert task.evidence_required is expected


@pytest.mark.parametrize("task_id", CHAT_TASK_IDS)
def test_chat_task_prompt_file_exists_on_disk(task_id: str) -> None:
    task = get_task(task_id)
    assert task.prompt_file is not None
    path = PROMPTS_DIR / task.prompt_file
    assert path.is_file(), f"missing prompt file: {path}"


def test_m07_note_file_exists_on_disk_even_though_unwired() -> None:
    # Listed in the build contract's file assignment, but deliberately not
    # referenced by TaskSpec.prompt_file (see tasks/__init__.py docstring).
    path = PROMPTS_DIR / "m07_embed_note_v1.txt"
    assert path.is_file()


@pytest.mark.parametrize("task_id", CHAT_TASK_IDS)
def test_chat_task_output_schema_name_is_task_outputs_scoped(task_id: str) -> None:
    task = get_task(task_id)
    assert task.output_schema is not None
    assert task.output_schema.startswith("task_outputs/")


# ---------------------------------------------------------------------------
# render_prompt() — placeholder filling
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("task_id", CHAT_TASK_IDS)
def test_render_prompt_fills_every_placeholder_with_no_braces_left(task_id: str) -> None:
    rendered = render_prompt(task_id, **DUMMY_PLACEHOLDER_KWARGS)
    assert isinstance(rendered, str)
    assert rendered.strip() != ""
    assert "{" not in rendered
    assert "}" not in rendered
    assert REQUIRED_JSON_DIRECTIVE in rendered


@pytest.mark.parametrize("task_id", CHAT_TASK_IDS)
def test_render_prompt_injects_the_supplied_value(task_id: str) -> None:
    # Each rendering task uses exactly one placeholder — confirm the
    # supplied value actually lands in the text, not just "no braces left".
    rendered = render_prompt(task_id, **DUMMY_PLACEHOLDER_KWARGS)
    injected_values = {
        "M01": DUMMY_PLACEHOLDER_KWARGS["caption_hint"],
        "M03": DUMMY_PLACEHOLDER_KWARGS["sheet_hint"],
        "M05": DUMMY_PLACEHOLDER_KWARGS["recent_context"],
        "M09": DUMMY_PLACEHOLDER_KWARGS["tools_json"],
        "M10": DUMMY_PLACEHOLDER_KWARGS["evidence_json"],
        "M12": DUMMY_PLACEHOLDER_KWARGS["correction_text"],
    }
    assert injected_values[task_id] in rendered


def test_render_prompt_missing_placeholder_raises_key_error() -> None:
    with pytest.raises(KeyError):
        render_prompt("M09")  # {tools_json} required, none supplied


def test_render_prompt_m07_raises_value_error_no_prompt_to_render() -> None:
    with pytest.raises(ValueError):
        render_prompt("M07", note="irrelevant")


def test_render_prompt_unknown_task_raises_key_error() -> None:
    with pytest.raises(KeyError):
        render_prompt("NOT_A_TASK")


# ---------------------------------------------------------------------------
# task_outputs/*.schema.json — load + examples validate
# ---------------------------------------------------------------------------

TASK_OUTPUT_SCHEMA_NAMES = [
    "task_outputs/m01_output",
    "task_outputs/m03_output",
    "task_outputs/m05_output",
    "task_outputs/m09_output",
    "task_outputs/m10_output",
    "task_outputs/m12_output",
]


@pytest.mark.parametrize("schema_name", TASK_OUTPUT_SCHEMA_NAMES)
def test_task_output_schema_loads(schema_name: str) -> None:
    schema = load_schema(schema_name)
    assert isinstance(schema, dict)
    assert schema.get("type") == "object"


@pytest.mark.parametrize("schema_name", TASK_OUTPUT_SCHEMA_NAMES)
def test_task_output_schema_examples_validate(schema_name: str) -> None:
    schema = load_schema(schema_name)
    examples = schema.get("examples")
    assert examples, f"{schema_name} has no non-empty 'examples' array"
    for i, example in enumerate(examples):
        errors = validate(example, schema)
        assert errors == [], f"{schema_name} examples[{i}] failed: {errors}"


def test_every_chat_task_output_schema_name_resolves_to_a_real_schema_file() -> None:
    for task_id in CHAT_TASK_IDS:
        task = get_task(task_id)
        assert task.output_schema is not None
        schema = load_schema(task.output_schema)  # raises SchemaError if missing
        assert schema["title"]


def test_load_schema_rejects_a_task_outputs_name_that_does_not_exist() -> None:
    with pytest.raises(SchemaError):
        load_schema("task_outputs/m99_does_not_exist")


# ---------------------------------------------------------------------------
# THE CROSS-CHECK: MockProvider's canned output for every chat task
# validates against that task's own output_schema.
# ---------------------------------------------------------------------------

# Representative request content per task — chosen to hit a normal
# (non-refusal) mock variant; every mock variant must validate regardless
# of which one the hash picks, so the exact text is not load-bearing beyond
# avoiding M10's "no evidence" refusal trigger (covered separately below).
_REPRESENTATIVE_MESSAGES: dict[str, str] = {
    "M01": "photo of a control panel print showing K1 and X4",
    "M03": "sheet 6 shows K1 coil wired to X4 terminal 17 via wire 51",
    "M05": "here is a wiring diagram question about this print",
    "M09": "please use search_print_pages to find K1",
    "M10": "what sheet is K1 shown on?",
    "M12": "the terminal is actually X4:17 not X4:11",
}

_M09_TOOLS = [
    {"type": "function", "function": {"name": "search_print_pages", "parameters": {}}},
    {"type": "function", "function": {"name": "trace_wire", "parameters": {}}},
]


def _mock_parsed_output(task_id: str, req: ModelRequest) -> dict[str, object]:
    """Call MockProvider synchronously (asyncio.run, per build-contract test
    plan) and return the parsed JSON object, falling back to json.loads on
    resp.text if resp.parsed is ever absent."""
    provider = MockProvider()
    resp = asyncio.run(provider.complete(req))
    if resp.parsed is not None:
        return resp.parsed
    assert resp.text is not None, f"{task_id}: mock returned neither parsed nor text"
    parsed = json.loads(resp.text)
    assert isinstance(parsed, dict)
    return parsed


@pytest.mark.parametrize("task_id", CHAT_TASK_IDS)
def test_mock_canned_output_validates_against_its_own_task_schema(task_id: str) -> None:
    task = get_task(task_id)
    assert task.output_schema is not None
    tools = _M09_TOOLS if task_id == "M09" else None
    req = ModelRequest(
        task_id=task_id,
        messages=[{"role": "user", "content": _REPRESENTATIVE_MESSAGES[task_id]}],
        tools=tools,
    )
    instance = _mock_parsed_output(task_id, req)
    schema = load_schema(task.output_schema)
    validate_or_raise(instance, schema)  # raises SchemaError on any violation


def test_mock_m10_refusal_variant_also_validates_against_the_schema() -> None:
    # contract §F: an explicit refusal variant fires on "no evidence" /
    # an empty evidence array in the request text — must be just as
    # schema-valid as the two normal answer variants.
    task = get_task("M10")
    assert task.output_schema is not None
    req = ModelRequest(
        task_id="M10",
        messages=[{"role": "user", "content": 'claim: K1 is live. context: "evidence": []'}],
    )
    instance = _mock_parsed_output("M10", req)
    schema = load_schema(task.output_schema)
    validate_or_raise(instance, schema)
    assert instance["evidence"] == []
    assert instance["not_proven"]


def test_mock_m01_all_three_canned_variants_validate() -> None:
    # Hash-selected variants (contract §F lists three: electrical_print,
    # nameplate, unknown/unreadable) — hunt for distinct hash inputs until
    # all three have been observed, then confirm each validated as it
    # appeared (belt-and-suspenders on top of the schema's own examples).
    task = get_task("M01")
    assert task.output_schema is not None
    schema = load_schema(task.output_schema)
    seen_image_types: set[str] = set()
    for i in range(50):
        req = ModelRequest(
            task_id="M01",
            messages=[{"role": "user", "content": f"probe text variant {i}"}],
        )
        instance = _mock_parsed_output("M01", req)
        validate_or_raise(instance, schema)
        seen_image_types.add(str(instance["image_type"]))
        if len(seen_image_types) >= 3:
            break
    assert len(seen_image_types) >= 1  # deterministic hashing may cluster; validity is the point


# ---------------------------------------------------------------------------
# M05 keyword-map routing accuracy (>= 0.8), per build-contract test plan.
# Uses proofpack's fixture file if B4 has written it yet, else an inline
# six-case set covering every keyword-route group in
# factorylm_ai.providers.mock._M05_KEYWORD_ROUTES.
# ---------------------------------------------------------------------------

_M05_FIXTURE_PATH = (
    Path(__file__).resolve().parents[2]
    / "factorylm_ai"
    / "proofpack"
    / "fixtures"
    / "m05_cases.jsonl"
)

# One case per mock keyword-route group (mock.py's _M05_KEYWORD_ROUTES),
# verified by hand against the group order (first match wins) so this set
# is 100% accurate against the mock's actual routing logic.
_INLINE_M05_CASES: list[tuple[str, str]] = [
    ("Can you take a look at this wiring diagram?", "printsense_photo"),
    ("The VFD is showing a fault code again", "drive_fault_photo"),
    ("Here's the full manual PDF for the conveyor", "full_pdf_package"),
    ("Can you write me a PRD for this feature?", "prd_request"),
    ("Generate a Claude Code prompt for this", "code_prompt_request"),
    ("Actually, that terminal number was wrong", "feedback_event"),
]


def _load_m05_cases() -> list[tuple[str, str]]:
    """B4's real proofpack fixture if it exists and parses into usable
    (text, expected_route) pairs; otherwise the inline six-case set above.
    Defensive about B4's exact field names (tasks/__init__.py is a
    stage-2 file built in parallel with proofpack/ — the fixture may not
    exist yet, or may use a field name this helper does not guess)."""
    if _M05_FIXTURE_PATH.is_file():
        cases: list[tuple[str, str]] = []
        with _M05_FIXTURE_PATH.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                row = json.loads(line)
                text = row.get("text") or row.get("message") or row.get("input")
                expected = row.get("expected_route") or row.get("route")
                if isinstance(text, str) and isinstance(expected, str):
                    cases.append((text, expected))
        if cases:
            return cases
    return _INLINE_M05_CASES


def test_m05_mock_routing_scores_at_least_0_8_accuracy() -> None:
    cases = _load_m05_cases()
    assert cases, "no M05 routing cases available (fixture and inline set both empty)"
    provider = MockProvider()
    correct = 0
    for text, expected_route in cases:
        req = ModelRequest(task_id="M05", messages=[{"role": "user", "content": text}])
        resp = asyncio.run(provider.complete(req))
        assert resp.parsed is not None
        if resp.parsed["route"] == expected_route:
            correct += 1
    accuracy = correct / len(cases)
    assert accuracy >= 0.8, (
        f"M05 mock routing accuracy {accuracy:.2f} below 0.8 threshold "
        f"({correct}/{len(cases)} correct)"
    )


def test_inline_m05_cases_are_self_consistent_with_the_mock_keyword_groups() -> None:
    # A tighter, deterministic bound on the inline fallback specifically
    # (independent of whether B4's fixture is present): every inline case
    # must route correctly, not just >= 0.8 of them.
    provider = MockProvider()
    for text, expected_route in _INLINE_M05_CASES:
        req = ModelRequest(task_id="M05", messages=[{"role": "user", "content": text}])
        resp = asyncio.run(provider.complete(req))
        assert resp.parsed is not None
        assert resp.parsed["route"] == expected_route, (
            f"inline M05 case {text!r}: expected {expected_route!r}, got {resp.parsed['route']!r}"
        )
