"""Dependency-light observability core (shared by engine, adapters, and SimLab eval).

This is the importable home for the trace/checks/approval primitives so that
``mira-bots/shared`` (the engine and every bot adapter) can emit an ``AnswerTrace``
and run governance/incident checks WITHOUT depending on ``simlab``. The
simlab-dependent harness/eval/runner/viewer live in ``simlab/observe`` and import
from here.

Nothing here imports ``simlab``. Nothing here writes to a PLC. Everything is
observational and fail-open by contract.
"""

from shared.observe.agent_checks import run_agent_contract  # noqa: F401
from shared.observe.agent_registry import (  # noqa: F401
    DEFAULT_AGENT_ID,
    AgentManifest,
    AgentManifestError,
    all_manifests,
    get_manifest,
    is_write_tool,
    load_registry,
    route_agent,
)
from shared.observe.approval_registry import ApprovalRegistry, DocumentApproval  # noqa: F401
from shared.observe.checks import dedupe, run_governance, run_incidents  # noqa: F401
from shared.observe.trace import (  # noqa: F401
    ALL_STEPS,
    SEVERITY_CRITICAL,
    SEVERITY_INFO,
    SEVERITY_WARN,
    STEP_CHECK_GOVERNANCE,
    STEP_GENERATE_ANSWER,
    STEP_RECEIVE_QUESTION,
    STEP_RESOLVE_ASSET,
    STEP_RETRIEVE_CONTEXT,
    STEP_RETURN_ANSWER,
    STEP_VALIDATE_ANSWER,
    AnswerTrace,
    Step,
    Warning,
    citations_present_in,
    extract_citations,
    read_jsonl,
)

__all__ = [
    "AnswerTrace",
    "Step",
    "Warning",
    "ALL_STEPS",
    "STEP_RECEIVE_QUESTION",
    "STEP_RESOLVE_ASSET",
    "STEP_RETRIEVE_CONTEXT",
    "STEP_CHECK_GOVERNANCE",
    "STEP_GENERATE_ANSWER",
    "STEP_VALIDATE_ANSWER",
    "STEP_RETURN_ANSWER",
    "SEVERITY_INFO",
    "SEVERITY_WARN",
    "SEVERITY_CRITICAL",
    "citations_present_in",
    "extract_citations",
    "read_jsonl",
    "ApprovalRegistry",
    "DocumentApproval",
    "run_governance",
    "run_incidents",
    "dedupe",
    "AgentManifest",
    "AgentManifestError",
    "load_registry",
    "all_manifests",
    "get_manifest",
    "route_agent",
    "is_write_tool",
    "run_agent_contract",
    "DEFAULT_AGENT_ID",
]
