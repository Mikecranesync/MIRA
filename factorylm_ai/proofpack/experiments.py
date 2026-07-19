"""The four proofpack experiments (handoff §10).

ZTA role: this is where a task's real behavior gets exercised end to end —
load a fixture, build provider-agnostic requests via the task registry
(:mod:`factorylm_ai.tasks`), call a provider through the one seam that wires
the spend guard and telemetry (:func:`_call_and_record`), and score the
result with pure functions (:mod:`factorylm_ai.proofpack.scoring`). Dry-run
(the default, mock provider) makes every number here a fixture-determinism
check, not a quality signal — each experiment says so in its own
``notes``. Only a budget-capped, network-gated ``--live`` run against
``together.py`` produces a real quality signal; see
``docs/zta/factorylm-ai-model-lab.md``.

Four experiments, one per fixture file under ``proofpack/fixtures/``:

- **e01** (:func:`run_e01`) — M01 vision intake.
- **e02** (:func:`run_e02`) — M05 intent routing.
- **e03** (:func:`run_e03`) — M07 retrieval (keyword baseline vs. dense
  cosine; rerank is not exercised — zero serverless rerank models exist on
  Together, verified 2026-07-19).
- **e04** (:func:`run_e04`) — M09 tool selection, against six mocked
  deterministic tools, with a hard check that the model never claims
  ``answered_from_memory``.

``factorylm_ai.tasks`` (the task registry: prompts, output schemas, default
models per provider) is a sibling stage-2 module built in parallel with this
package — every reference to it in this file is a LAZY, function-body-local
import (never at module import time), so this module itself always imports
cleanly even in a checkout where ``factorylm_ai/tasks/`` has not landed yet;
only actually *running* an experiment requires it to be present. This
mirrors the same-stage-race pattern already used by
:func:`factorylm_ai.telemetry.log_model_run` for ``factorylm_ai/schemas/``.
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import TYPE_CHECKING, Any, TypedDict

from ..budget import BudgetGuard
from ..pricing import estimate_cost
from ..providers.base import ModelProvider, ModelRequest, ModelResponse
from ..schemas.validate import SchemaError, load_schema
from ..telemetry import log_model_run, model_run_from_response
from . import scoring

if TYPE_CHECKING:
    from ..tasks import TaskSpec

logger = logging.getLogger("factorylm-ai")

# schema_version recorded on every ModelRun logged here. There is no
# versioned-schema-evolution story yet for task_outputs/*.schema.json (each
# is a single unversioned file) -- "1" mirrors the convention already used
# in schemas/model_run.schema.json's own examples.
_SCHEMA_VERSION = "1"

_IMAGE_MIME_BY_EXT: dict[str, str] = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
}

_M09_TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "search_print_pages",
            "description": "Search the electrical print set for pages matching a device tag or keyword.",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "trace_wire",
            "description": "Trace a wire number or terminal across sheets to find its endpoints.",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "resolve_device",
            "description": "Resolve a device tag (e.g. K1, X4) to its type, location, and cross-references.",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "lookup_fault_code",
            "description": "Look up the meaning and recommended action for a drive/PLC fault code.",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "retrieve_page_crop",
            "description": "Retrieve a cropped region of a specific print page for close inspection.",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "ask_for_closeup",
            "description": "Ask the technician for a closer photo when the current image is unreadable.",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
            },
        },
    },
]


class ExperimentResult(TypedDict):
    """Shape every ``run_eNN`` function returns (build-contract §B4)."""

    experiment: str
    cases: int
    scored: int
    metrics: dict[str, Any]
    cost_usd: float
    notes: list[str]


# ---------------------------------------------------------------------------
# tasks/ access — lazy, function-body-local (see module docstring).
# ---------------------------------------------------------------------------


def _get_task(task_id: str) -> TaskSpec:
    try:
        from ..tasks import get_task
    except ImportError as exc:
        raise RuntimeError(
            "factorylm_ai.proofpack.experiments: could not import factorylm_ai.tasks "
            "(factorylm_ai/tasks/ may not be built yet in this checkout) -- cannot "
            f"resolve task {task_id!r} without it: {exc}"
        ) from exc
    return get_task(task_id)


def _render_prompt(task_id: str, **kwargs: str) -> str:
    try:
        from ..tasks import render_prompt
    except ImportError as exc:
        raise RuntimeError(
            "factorylm_ai.proofpack.experiments: could not import factorylm_ai.tasks "
            "(factorylm_ai/tasks/ may not be built yet in this checkout) -- cannot "
            f"render the {task_id!r} prompt without it: {exc}"
        ) from exc
    return render_prompt(task_id, **kwargs)


def _load_output_schema(task: TaskSpec) -> dict[str, Any] | None:
    """Best-effort load of a task's output JSON schema for live structured decoding.

    Used only to populate ``ModelRequest.json_schema`` so a ``--live``
    Together call gets the "response_format json_schema" structured-output
    path (see ``providers/together.py``). The mock provider ignores
    ``json_schema`` entirely, so dry-run scoring never depends on this
    succeeding -- a missing schema file only degrades a live call's
    structured-output reliability, it never breaks a dry run.
    """
    if task.output_schema is None:
        return None
    try:
        return load_schema(task.output_schema)
    except SchemaError as exc:
        logger.warning("proofpack: could not load output schema for task %s: %s", task.task_id, exc)
        return None


# ---------------------------------------------------------------------------
# Shared plumbing: fixtures, budget + telemetry wiring.
# ---------------------------------------------------------------------------


def _load_jsonl(path: Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as fh:
        for line in fh:
            stripped = line.strip()
            if not stripped:
                continue
            records.append(json.loads(stripped))
    return records


def _rough_token_estimate(req: ModelRequest) -> int:
    """Conservative pre-call token estimate for the budget precheck.

    Not the real usage count (that comes back on the response and is what
    actually gets recorded) -- just enough to make
    :meth:`~factorylm_ai.budget.BudgetGuard.precheck` a meaningful hard-stop
    BEFORE a live call spends anything.
    """
    if req.input_kind == "embedding":
        basis = "".join(req.embed_inputs or [])
    elif req.input_kind == "rerank":
        basis = (req.rerank_query or "") + "".join(req.rerank_documents or [])
    else:
        basis = json.dumps(req.messages, default=str)
    return max(1, len(basis) // 4)


def _request_hash(req: ModelRequest) -> str:
    basis = json.dumps(
        {
            "task_id": req.task_id,
            "model": req.model,
            "messages": req.messages,
            "input_kind": req.input_kind,
            "embed_inputs": req.embed_inputs,
            "rerank_query": req.rerank_query,
            "rerank_documents": req.rerank_documents,
        },
        sort_keys=True,
        default=str,
    )
    return hashlib.sha256(basis.encode("utf-8")).hexdigest()


def _response_has_output(resp: ModelResponse) -> bool:
    """Generalized "did this call come back with usable structured output" signal.

    Used as the ``json_valid`` field on the logged
    :class:`~factorylm_ai.telemetry.ModelRun`. For a chat call this means
    ``resp.parsed`` decoded to a dict; for embedding/rerank calls (which
    never populate ``parsed``) it means the corresponding vector/score list
    came back non-empty.
    """
    if resp.parsed is not None:
        return True
    if resp.embeddings is not None and len(resp.embeddings) > 0:
        return True
    if resp.rerank_scores is not None and len(resp.rerank_scores) > 0:
        return True
    return False


async def _call_and_record(
    provider: ModelProvider,
    req: ModelRequest,
    budget: BudgetGuard,
    *,
    task: TaskSpec,
) -> ModelResponse:
    """The one seam every experiment's ``provider.complete()`` call goes through.

    Prechecks the budget with a conservative pre-call estimate, makes the
    call, records the actual spend, and logs a
    :class:`~factorylm_ai.telemetry.ModelRun`. This is what "wires
    BudgetGuard through every live call" and "logs every call via
    telemetry.log_model_run" (CLI contract) mean in code -- and it is
    harmless on the mock provider too, since its ``estimated_cost_usd`` is
    always 0.0, so precheck/record are no-ops there and the exact same code
    path runs whether or not ``--live`` is set.
    """
    model_for_pricing = req.model or task.default_models.get(provider.name) or "unknown"
    pre_estimate = estimate_cost(model_for_pricing, _rough_token_estimate(req), req.max_tokens)
    budget.precheck(pre_estimate)

    resp = await provider.complete(req)

    budget.record(resp.estimated_cost_usd)

    run = model_run_from_response(
        task_id=task.task_id,
        req_hash=_request_hash(req),
        prompt_version=task.prompt_version,
        schema_version=_SCHEMA_VERSION,
        resp=resp,
        json_valid=_response_has_output(resp),
    )
    log_model_run(run)
    return resp


_IMAGE_EXTENSIONS = tuple(_IMAGE_MIME_BY_EXT)


def _find_case_image(images_dir: Path, case_id: str) -> Path | None:
    for ext in _IMAGE_EXTENSIONS:
        candidate = images_dir / f"{case_id}{ext}"
        if candidate.is_file():
            return candidate
    return None


def _image_to_data_uri(path: Path) -> str:
    mime = _IMAGE_MIME_BY_EXT.get(path.suffix.lower(), "application/octet-stream")
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{mime};base64,{encoded}"


def _build_chat_messages(
    system_prompt: str, user_content: str | list[dict[str, Any]], *, live: bool
) -> list[dict[str, Any]]:
    """Build a chat ``messages`` list, including the system prompt only when ``live``.

    The mock provider is a keyword/hash fixture, not an instruction-following
    model: its dry-run heuristics (M05's keyword router, M09's tool-name
    substring match) scan the ENTIRE flattened message text, system message
    included (see ``providers/mock.py::_message_text``). Every real task
    prompt necessarily enumerates its own route/tool names to instruct a
    real model -- e.g. M05's prompt lists "printsense_photo - ... wiring
    diagram ..." and M09's prompt embeds the full ``tools_json`` -- so
    sending that prompt to the mock would make the FIRST keyword group /
    tool name in priority order match on every single case (verified
    empirically: with the real M05 prompt included, every case routes to
    printsense_photo regardless of its own text), collapsing the fixture's
    entire per-case signal to one constant answer. A ``--live`` call, by
    contrast, genuinely needs the instructions -- a real model does not
    pattern-match keywords, it reads them. ``render_prompt()`` is still
    always called by the caller regardless of ``live`` (so a broken prompt
    file is caught in dry-run too); only whether its result is SENT differs.
    """
    if live:
        return [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ]
    return [{"role": "user", "content": user_content}]


# ---------------------------------------------------------------------------
# e01 -- M01 vision intake
# ---------------------------------------------------------------------------


async def run_e01(
    provider: ModelProvider,
    budget: BudgetGuard,
    *,
    fixtures_dir: Path,
    live: bool,
    images_dir: Path | None,
) -> ExperimentResult:
    """M01 vision intake over ``fixtures/m01_cases.jsonl``.

    Dry-run: no real images are used -- each case's ``description`` field is
    sent as plain user text ("text-described images through mock"), so the
    scored numbers are a fixture-determinism check on the mock provider, not
    a vision-quality signal (the report's dry-run banner says so explicitly).

    Live: requires ``images_dir``. A case is scored only if
    ``<images_dir>/<case_id>.<ext>`` exists (jpg/jpeg/png/webp/bmp) and loads
    as a base64 ``image_url`` part; a case with no matching file is skipped
    with a note. If ``images_dir`` is not supplied at all, the WHOLE
    experiment is skipped (0 cases scored) with a note, per the CLI contract.
    """
    cases = _load_jsonl(fixtures_dir / "m01_cases.jsonl")
    notes: list[str] = []

    if live and images_dir is None:
        notes.append("--live requires --images-dir; e01 skipped (0 cases scored).")
        return {
            "experiment": "e01",
            "cases": len(cases),
            "scored": 0,
            "metrics": {},
            "cost_usd": 0.0,
            "notes": notes,
        }

    if not live:
        notes.append(
            "dry-run: images are text-described (case['description'] sent as "
            "plain user text) through the mock provider, not real image bytes "
            "-- these numbers check the pipeline is wired correctly, not "
            "vision quality."
        )

    task = _get_task("M01")
    model = task.default_models.get(provider.name)
    json_schema = _load_output_schema(task)
    system_prompt = _render_prompt("M01", caption_hint="")

    predicted_types: list[str] = []
    expected_types: list[str] = []
    predicted_readability: list[str] = []
    expected_readability: list[str] = []
    valid_flags: list[bool] = []
    latency_total_ms = 0
    cost_usd = 0.0
    model_used = ""

    for case in cases:
        case_id = str(case["case_id"])
        user_content: str | list[dict[str, Any]]
        if live:
            assert images_dir is not None  # narrowed by the early-return above
            image_path = _find_case_image(images_dir, case_id)
            if image_path is None:
                notes.append(f"e01 {case_id}: no image file found in {images_dir}; skipped.")
                continue
            user_content = [
                {"type": "text", "text": "Classify this image per the system instructions."},
                {"type": "image_url", "image_url": {"url": _image_to_data_uri(image_path)}},
            ]
        else:
            user_content = str(case["description"])

        req = ModelRequest(
            task_id="M01",
            messages=_build_chat_messages(system_prompt, user_content, live=live),
            model=model,
            json_schema=json_schema,
        )
        resp = await _call_and_record(provider, req, budget, task=task)
        cost_usd += resp.estimated_cost_usd
        latency_total_ms += resp.latency_ms
        model_used = resp.model

        parsed = resp.parsed or {}
        valid_flags.append(resp.parsed is not None)
        predicted_types.append(str(parsed.get("image_type", "")))
        expected_types.append(str(case["expected_image_type"]))
        predicted_readability.append(str(parsed.get("readability", "")))
        expected_readability.append(str(case["expected_readability"]))

    metrics: dict[str, Any] = {
        "json_validity_rate": scoring.json_validity_rate(valid_flags),
        "latency_ms_total": latency_total_ms,
        "model": model_used or "n/a",
    }
    if expected_types:
        metrics["image_type_accuracy"] = scoring.route_accuracy(predicted_types, expected_types)
        metrics["readability_accuracy"] = scoring.route_accuracy(
            predicted_readability, expected_readability
        )

    return {
        "experiment": "e01",
        "cases": len(cases),
        "scored": len(expected_types),
        "metrics": metrics,
        "cost_usd": cost_usd,
        "notes": notes,
    }


# ---------------------------------------------------------------------------
# e02 -- M05 intent routing
# ---------------------------------------------------------------------------


async def run_e02(
    provider: ModelProvider,
    budget: BudgetGuard,
    *,
    fixtures_dir: Path,
    live: bool,
    images_dir: Path | None,
) -> ExperimentResult:
    """M05 intent routing over ``fixtures/m05_cases.jsonl``.

    ``images_dir`` is accepted (unused) so all four experiments share one
    call signature for uniform dispatch from ``run.py`` -- M05 is text-only.
    """
    del images_dir
    cases = _load_jsonl(fixtures_dir / "m05_cases.jsonl")
    task = _get_task("M05")
    model = task.default_models.get(provider.name)
    json_schema = _load_output_schema(task)
    system_prompt = _render_prompt("M05", recent_context="")

    predicted: list[str] = []
    expected: list[str] = []
    valid_flags: list[bool] = []
    latency_total_ms = 0
    cost_usd = 0.0
    model_used = ""

    for case in cases:
        req = ModelRequest(
            task_id="M05",
            messages=_build_chat_messages(system_prompt, str(case["text"]), live=live),
            model=model,
            json_schema=json_schema,
        )
        resp = await _call_and_record(provider, req, budget, task=task)
        cost_usd += resp.estimated_cost_usd
        latency_total_ms += resp.latency_ms
        model_used = resp.model

        parsed = resp.parsed or {}
        valid_flags.append(resp.parsed is not None)
        predicted.append(str(parsed.get("route", "")))
        expected.append(str(case["expected_route"]))

    notes: list[str] = []
    if not live:
        notes.append(
            "dry-run: the mock provider routes by a fixed keyword map; this "
            "fixture's expected_route values are written to match that map, "
            "so this is a determinism check, not a real router-accuracy "
            "measurement."
        )

    metrics: dict[str, Any] = {
        "route_accuracy": scoring.route_accuracy(predicted, expected),
        "json_validity_rate": scoring.json_validity_rate(valid_flags),
        "latency_ms_total": latency_total_ms,
        "model": model_used or "n/a",
    }

    return {
        "experiment": "e02",
        "cases": len(cases),
        "scored": len(expected),
        "metrics": metrics,
        "cost_usd": cost_usd,
        "notes": notes,
    }


# ---------------------------------------------------------------------------
# e03 -- M07 retrieval (keyword baseline vs. dense cosine)
# ---------------------------------------------------------------------------


async def run_e03(
    provider: ModelProvider,
    budget: BudgetGuard,
    *,
    fixtures_dir: Path,
    live: bool,
    images_dir: Path | None,
) -> ExperimentResult:
    """M07 retrieval over ``fixtures/m07_corpus.jsonl``.

    Embeds the 25 synthetic chunks and the 10 questions (two batched
    provider calls -- corpus passages get the ``"passage: "`` instruction
    prefix, queries get ``"query: "``, per the e5-instruct asymmetric
    convention documented in ``tasks/prompts/m07_embed_note_v1.txt``), then
    compares two rankers against each question's ``known_correct_chunk_ids``:
    a zero-model keyword-overlap baseline and dense cosine similarity over
    the embeddings. Rerank is never called -- zero serverless rerank models
    exist on Together (verified 2026-07-19); the report's ``rerank`` slot
    says so instead of a score.
    """
    del images_dir
    records = _load_jsonl(fixtures_dir / "m07_corpus.jsonl")
    chunks = [r for r in records if r.get("kind") == "chunk"]
    questions = [r for r in records if r.get("kind") == "question"]

    notes: list[str] = [
        "rerank: skipped -- no serverless rerank models on Together (verified 2026-07-19)."
    ]
    if not live:
        notes.append(
            "dry-run: embeddings are the mock provider's deterministic "
            "sha256-derived 8-dim vectors, not semantic -- hit rates here "
            "check the ranking pipeline is wired correctly, not retrieval "
            "quality."
        )

    if not chunks or not questions:
        notes.append("m07_corpus.jsonl is missing chunk or question rows; e03 skipped.")
        return {
            "experiment": "e03",
            "cases": len(questions),
            "scored": 0,
            "metrics": {},
            "cost_usd": 0.0,
            "notes": notes,
        }

    task = _get_task("M07")
    model = task.default_models.get(provider.name)

    chunk_texts = [str(c["text"]) for c in chunks]
    chunk_ids = [str(c["chunk_id"]) for c in chunks]
    question_texts = [str(q["text"]) for q in questions]

    chunk_req = ModelRequest(
        task_id="M07",
        messages=[],
        model=model,
        input_kind="embedding",
        embed_inputs=[f"passage: {t}" for t in chunk_texts],
    )
    chunk_resp = await _call_and_record(provider, chunk_req, budget, task=task)

    question_req = ModelRequest(
        task_id="M07",
        messages=[],
        model=model,
        input_kind="embedding",
        embed_inputs=[f"query: {t}" for t in question_texts],
    )
    question_resp = await _call_and_record(provider, question_req, budget, task=task)

    cost_usd = chunk_resp.estimated_cost_usd + question_resp.estimated_cost_usd
    latency_total_ms = chunk_resp.latency_ms + question_resp.latency_ms
    chunk_vectors = chunk_resp.embeddings or []
    question_vectors = question_resp.embeddings or []

    keyword_hits_1: list[bool] = []
    keyword_hits_5: list[bool] = []
    dense_hits_1: list[bool] = []
    dense_hits_5: list[bool] = []

    for i, question in enumerate(questions):
        correct_ids = {str(cid) for cid in question.get("known_correct_chunk_ids", [])}
        correct_positions = {chunk_ids.index(cid) for cid in correct_ids if cid in chunk_ids}

        kw_top5 = scoring.keyword_overlap_topk(question_texts[i], chunk_texts, 5)
        keyword_hits_1.append(scoring.hit_at_k(kw_top5[:1], correct_positions))
        keyword_hits_5.append(scoring.hit_at_k(kw_top5, correct_positions))

        if i < len(question_vectors) and chunk_vectors:
            dense_top5 = scoring.cosine_topk(question_vectors[i], chunk_vectors, 5)
            dense_hits_1.append(scoring.hit_at_k(dense_top5[:1], correct_positions))
            dense_hits_5.append(scoring.hit_at_k(dense_top5, correct_positions))

    metrics: dict[str, Any] = {
        "keyword_top1_hit_rate": scoring.mean_hit_rate(keyword_hits_1),
        "keyword_top5_hit_rate": scoring.mean_hit_rate(keyword_hits_5),
        "dense_top1_hit_rate": scoring.mean_hit_rate(dense_hits_1),
        "dense_top5_hit_rate": scoring.mean_hit_rate(dense_hits_5),
        "rerank": "skipped -- no serverless rerank models on Together (verified 2026-07-19)",
        "latency_ms_total": latency_total_ms,
        "model": question_resp.model,
    }

    return {
        "experiment": "e03",
        "cases": len(questions),
        "scored": len(keyword_hits_1),
        "metrics": metrics,
        "cost_usd": cost_usd,
        "notes": notes,
    }


# ---------------------------------------------------------------------------
# e04 -- M09 tool selection
# ---------------------------------------------------------------------------


async def run_e04(
    provider: ModelProvider,
    budget: BudgetGuard,
    *,
    fixtures_dir: Path,
    live: bool,
    images_dir: Path | None,
) -> ExperimentResult:
    """M09 tool selection over ``fixtures/m09_cases.jsonl``.

    Offers the six mocked deterministic tools named in the handoff
    (``search_print_pages``, ``trace_wire``, ``resolve_device``,
    ``lookup_fault_code``, ``retrieve_page_crop``, ``ask_for_closeup``) as
    OpenAI tool defs, scores the chosen tool against ``expected_tool``, and
    HARD-CHECKS ``answered_from_memory == False`` on every scored case -- a
    tool-using task must never claim it answered without looking anything
    up; a violation is surfaced as a note, not silently averaged away.
    """
    del images_dir
    cases = _load_jsonl(fixtures_dir / "m09_cases.jsonl")
    task = _get_task("M09")
    model = task.default_models.get(provider.name)
    json_schema = _load_output_schema(task)
    system_prompt = _render_prompt("M09", tools_json=json.dumps(_M09_TOOLS))

    predicted: list[str] = []
    expected: list[str] = []
    valid_flags: list[bool] = []
    memory_violations: list[str] = []
    latency_total_ms = 0
    cost_usd = 0.0
    model_used = ""
    notes: list[str] = []

    if not live:
        notes.append(
            "dry-run: the mock provider picks the tool whose exact name "
            "appears in the case text (else the first offered tool); "
            "fixtures are written to that rule, so this checks the pipeline, "
            "not real tool-use judgement."
        )

    for case in cases:
        case_id = str(case["case_id"])
        req = ModelRequest(
            task_id="M09",
            messages=_build_chat_messages(system_prompt, str(case["question"]), live=live),
            model=model,
            json_schema=json_schema,
            tools=_M09_TOOLS,
        )
        resp = await _call_and_record(provider, req, budget, task=task)
        cost_usd += resp.estimated_cost_usd
        latency_total_ms += resp.latency_ms
        model_used = resp.model

        parsed = resp.parsed
        valid_flags.append(parsed is not None)
        if parsed is None:
            notes.append(f"e04 {case_id}: no parsed tool_calls output; not scored.")
            continue

        tool_calls = parsed.get("tool_calls") or []
        chosen = str(tool_calls[0]["name"]) if tool_calls else ""
        predicted.append(chosen)
        expected.append(str(case["expected_tool"]))
        if parsed.get("answered_from_memory") is not False:
            memory_violations.append(case_id)

    if memory_violations:
        notes.append(
            "HARD CHECK FAILED: answered_from_memory was not False for cases: "
            + ", ".join(memory_violations)
        )

    metrics: dict[str, Any] = {
        "tool_choice_accuracy": scoring.tool_choice_accuracy(predicted, expected),
        "json_validity_rate": scoring.json_validity_rate(valid_flags),
        "answered_from_memory_pass_rate": (
            (len(predicted) - len(memory_violations)) / len(predicted) if predicted else 0.0
        ),
        "latency_ms_total": latency_total_ms,
        "model": model_used or "n/a",
    }

    return {
        "experiment": "e04",
        "cases": len(cases),
        "scored": len(predicted),
        "metrics": metrics,
        "cost_usd": cost_usd,
        "notes": notes,
    }


ALL_EXPERIMENT_IDS: tuple[str, ...] = ("e01", "e02", "e03", "e04")

ExperimentFn = Callable[..., Awaitable[ExperimentResult]]

EXPERIMENTS: dict[str, ExperimentFn] = {
    "e01": run_e01,
    "e02": run_e02,
    "e03": run_e03,
    "e04": run_e04,
}
