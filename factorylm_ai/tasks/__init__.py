"""ZTA task registry — maps a task id to its prompt, output schema, and default models.

ZTA role: this is the seam every caller (proofpack experiments, the future
production-graduation wiring, tests) uses to answer "what prompt renders
task X, what schema must its JSON answer validate against, and which model
does provider Y serve it with by default." :data:`TASKS` is the single
source of truth; :func:`get_task` and :func:`render_prompt` are the only
sanctioned ways to read it or turn it into an actual prompt string.

Task numbering follows the ZTA model fleet in the source handoff doc's
"Required Model Fleet by Workflow Phase" table
(``factorylm_zta_together_liquid_handoff.md`` §6). Only the MVP fleet is
registered here — the seven ids the handoff's "MVP fleet" section names to
build first: M01, M03, M05, M07, M09, M10, M12 ("Add M02, M04, M08, M11
after benchmarks prove the need").

Two fleet ids are deliberately NOT registered, and are worth naming here so
a future reader does not mistake the numbering gap (M01..M13, only seven
present) for a bug:

- **M08 (Reranker)** is SKIPPED, not merely deferred: zero serverless
  rerank models exist on Together as of the 2026-07-19 recon (rerank is
  dedicated-endpoint-only, a $5.49/hr floor with no cheap proving ground).
  See ``docs/zta/together-liquid-model-strategy.md``.
- **M13 (Enterprise Planner)** is out of scope for this package entirely:
  the handoff's fleet table marks it "Rare heavy planning ... used only for
  complex PRDs, package strategy, multi-doc synthesis" and it is absent
  from both the MVP fleet AND the "add after benchmarks" follow-up list.

M02 (drive keypad/nameplate reader), M04 (touch-selection crop extractor),
M06 (OCR cleanup/field parser), and M11 (reasoning verifier) are the
remaining non-MVP fleet ids — the handoff defers them the same way as M08,
until the seven MVP tasks prove themselves in the proofpack.

Prompt files live in ``tasks/prompts/`` and are named
``<task_id>_<short_name>_v<n>.txt``; :attr:`TaskSpec.prompt_version` is
always that file's stem (e.g. ``"m01_vision_intake_v1"``) — the same string
:mod:`factorylm_ai.telemetry` records on every :class:`~factorylm_ai.telemetry.ModelRun`.
M07 (embeddings) has no prompt to render — see
``tasks/prompts/m07_embed_note_v1.txt`` for its input contract instead of a
system instruction, and :data:`EMBED_MAX_INPUT_TOKENS` below for the hard
per-input token cap that contract documents.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger("factorylm-ai")

_PROMPTS_DIR = Path(__file__).resolve().parent / "prompts"

# The e5 embedding model's hard input cap (contract addendum §B: "HARD
# 514-token input cap -> chunk law"). A caller building M07's
# ModelRequest.embed_inputs MUST chunk any text longer than this before
# embedding it — this module does not chunk for you; see
# factorylm_ai/flywheel/splits.py and tasks/prompts/m07_embed_note_v1.txt.
EMBED_MAX_INPUT_TOKENS = 514


@dataclass
class TaskSpec:
    """One ZTA task's identity: which prompt renders it, which schema its
    JSON output must validate against, and which model each provider
    serves it with by default.

    Mirrors the pinned build-contract shape exactly — other builders
    (proofpack, flywheel, the future promotion/graduation wiring) import
    ``TaskSpec``/``TASKS``/``get_task`` by these exact names and field
    shapes; do not rename or reshape without updating every caller.
    """

    task_id: str  # "M01".."M13"
    name: str  # short human-readable label, e.g. "Vision Intake"
    prompt_file: str | None  # filename under tasks/prompts/, or None (M07: embeddings, no prompt)
    prompt_version: str  # the prompt file's stem, e.g. "m01_vision_intake_v1"
    output_schema: (
        str | None
    )  # schemas/task_outputs name, e.g. "task_outputs/m01_output"; None for embeddings
    default_models: dict[str, str]  # provider name -> model id ("mock" -> "mock-fixture" always)
    input_kind: str = "chat"  # "chat" | "embedding" | "rerank"
    evidence_required: bool = False  # True only for M10 — the no-evidence-no-claim answer contract


TASKS: dict[str, TaskSpec] = {
    "M01": TaskSpec(
        task_id="M01",
        name="Vision Intake",
        prompt_file="m01_vision_intake_v1.txt",
        prompt_version="m01_vision_intake_v1",
        output_schema="task_outputs/m01_output",
        default_models={"mock": "mock-fixture", "together": "google/gemma-3n-E4B-it"},
    ),
    "M03": TaskSpec(
        task_id="M03",
        name="Print Region Extract",
        prompt_file="m03_print_region_extract_v1.txt",
        prompt_version="m03_print_region_extract_v1",
        output_schema="task_outputs/m03_output",
        default_models={"mock": "mock-fixture", "together": "google/gemma-3n-E4B-it"},
    ),
    "M05": TaskSpec(
        task_id="M05",
        name="Intent Router",
        prompt_file="m05_intent_router_v1.txt",
        prompt_version="m05_intent_router_v1",
        output_schema="task_outputs/m05_output",
        default_models={"mock": "mock-fixture", "together": "LiquidAI/LFM2.5-8B-A1B"},
    ),
    "M07": TaskSpec(
        task_id="M07",
        name="Embeddings",
        prompt_file=None,
        prompt_version="m07_embed_note_v1",
        output_schema=None,
        default_models={
            "mock": "mock-fixture",
            "together": "intfloat/multilingual-e5-large-instruct",
        },
        input_kind="embedding",
    ),
    "M09": TaskSpec(
        task_id="M09",
        name="Tool Selector",
        prompt_file="m09_tool_selector_v1.txt",
        prompt_version="m09_tool_selector_v1",
        output_schema="task_outputs/m09_output",
        default_models={"mock": "mock-fixture", "together": "openai/gpt-oss-20b"},
    ),
    "M10": TaskSpec(
        task_id="M10",
        name="Answer Writer",
        prompt_file="m10_answer_contract_v1.txt",
        prompt_version="m10_answer_contract_v1",
        output_schema="task_outputs/m10_output",
        default_models={"mock": "mock-fixture", "together": "LiquidAI/LFM2.5-8B-A1B"},
        evidence_required=True,
    ),
    "M12": TaskSpec(
        task_id="M12",
        name="Feedback Curator",
        prompt_file="m12_feedback_curator_v1.txt",
        prompt_version="m12_feedback_curator_v1",
        output_schema="task_outputs/m12_output",
        default_models={"mock": "mock-fixture", "together": "LiquidAI/LFM2.5-8B-A1B"},
    ),
}

# Internal consistency guard: every dict key must match its own TaskSpec.task_id.
# Cheap, always true by construction — catches a future copy/paste typo at
# import time instead of silently misrouting get_task() callers.
assert all(key == spec.task_id for key, spec in TASKS.items()), (
    "factorylm_ai.tasks.TASKS: a dict key does not match its TaskSpec.task_id"
)


def get_task(task_id: str) -> TaskSpec:
    """Look up a :class:`TaskSpec` by id.

    Case-insensitive (``"m01"`` and ``"M01"`` both resolve) to match
    :mod:`factorylm_ai.providers.mock`'s own ``req.task_id.upper()``
    convention. Raises :class:`KeyError` when ``task_id`` is not registered
    — including the intentionally-unregistered fleet ids (M02, M04, M06,
    M08, M11, M13; see the module docstring for why each is absent).
    """
    key = task_id.upper()
    try:
        return TASKS[key]
    except KeyError:
        raise KeyError(
            f"unknown factorylm_ai task_id {task_id!r} — registered tasks: {sorted(TASKS)}"
        ) from None


def render_prompt(task_id: str, **kwargs: str) -> str:
    """Load ``tasks/prompts/<task.prompt_file>`` and interpolate it via
    ``str.format(**kwargs)``.

    Every prompt file documents its placeholders in a leading block of
    ``#``-prefixed comment lines; callers must supply a value for each one
    named there, or ``str.format`` raises ``KeyError`` (no silent partial
    render). Raises :class:`KeyError` when ``task_id`` is not registered
    (via :func:`get_task`). Raises :class:`ValueError` when the task has no
    ``prompt_file`` — today only M07 (embeddings): it has no chat prompt to
    render, see ``tasks/prompts/m07_embed_note_v1.txt`` for its input
    contract instead.
    """
    task = get_task(task_id)
    if task.prompt_file is None:
        raise ValueError(
            f"task {task.task_id} ({task.name}) has no prompt_file "
            f"(input_kind={task.input_kind!r}) — nothing to render"
        )
    path = _PROMPTS_DIR / task.prompt_file
    text = path.read_text(encoding="utf-8")
    rendered = text.format(**kwargs)
    logger.debug("render_prompt task=%s prompt_file=%s", task.task_id, task.prompt_file)
    return rendered
