"""Core async runner — drives Supervisor.process() through a fixture's turns.

Returns a ScenarioRun with per-turn replies, state snapshots, and timing.
Evaluator (evaluator.py) consumes the ScenarioRun and emits checkpoints + scores.
"""

from __future__ import annotations

import asyncio

# IMPORTANT: import stdlib `email` (and its httpx-transitive deps) BEFORE we
# add mira-bots to sys.path. The mira-bots/ tree contains an `email/` subpackage
# that would otherwise shadow the stdlib module when httpx → urllib.request →
# import email resolves.
import email as _stdlib_email  # noqa: F401  — load before sys.path mutation
import logging
import os
import sys
import tempfile
import time
import urllib.request as _stdlib_urllib_request  # noqa: F401
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

# Ensure mira-bots is on sys.path (matches tests/conftest.py pattern).
REPO_ROOT = Path(__file__).resolve().parents[2]
MIRA_BOTS = REPO_ROOT / "mira-bots"
if str(MIRA_BOTS) not in sys.path:
    sys.path.insert(0, str(MIRA_BOTS))

from .mock_router import (  # noqa: E402
    FakeInferenceRouter,
    FakeNameplateWorker,
    FakeNemotronClient,
    FakeRAGWorker,
    FakeVisionWorker,
)

logger = logging.getLogger("mira-conv-suite")

FIXTURES_DIR = Path(__file__).parent / "fixtures"
CASES_DIR = FIXTURES_DIR / "cases"
KB_DIR = FIXTURES_DIR / "kb_chunks"
RESPONSES_DIR = FIXTURES_DIR / "mock_responses"


# ─────────────────────────────────────────────────────────────────────────────
# Data structures
# ─────────────────────────────────────────────────────────────────────────────


@dataclass
class TurnResult:
    turn_index: int
    user_message: str
    reply: str
    fsm_state: str
    asset_identified: str
    latency_ms: int
    platform: str = "harness"
    error: str | None = None


@dataclass
class ScenarioRun:
    fixture_id: str
    fixture_path: Path
    fixture: dict[str, Any]
    turns: list[TurnResult] = field(default_factory=list)
    total_latency_ms: int = 0
    error: str | None = None
    mode: str = "mock"

    @property
    def final_state(self) -> str:
        return self.turns[-1].fsm_state if self.turns else ""

    @property
    def final_asset(self) -> str:
        return self.turns[-1].asset_identified if self.turns else ""

    @property
    def last_reply(self) -> str:
        return self.turns[-1].reply if self.turns else ""

    @property
    def all_replies(self) -> str:
        return "\n".join(t.reply for t in self.turns)


# ─────────────────────────────────────────────────────────────────────────────
# Fixture discovery + loading
# ─────────────────────────────────────────────────────────────────────────────


def discover_fixtures(filter_spec: str = "") -> list[Path]:
    """List all fixture YAML files, optionally filtered by `category:X` or `id:Y`."""
    fixtures = sorted(CASES_DIR.rglob("*.yaml"))
    if not filter_spec:
        return fixtures

    key, _, value = filter_spec.partition(":")
    if not value:
        # Bare filter — treat as id substring
        return [p for p in fixtures if value in p.stem or filter_spec in p.stem]

    filtered: list[Path] = []
    for path in fixtures:
        try:
            data = yaml.safe_load(path.read_text()) or {}
        except yaml.YAMLError:
            continue
        if key == "category" and data.get("category") == value:
            filtered.append(path)
        elif key == "id" and data.get("id") == value:
            filtered.append(path)
        elif key == "tag" and value in (data.get("tags") or []):
            filtered.append(path)
    return filtered


def load_fixture(path: Path) -> dict[str, Any]:
    data = yaml.safe_load(path.read_text()) or {}
    if "id" not in data:
        data["id"] = path.stem
    if "category" not in data:
        # Infer category from parent dir
        data["category"] = path.parent.name
    return data


# ─────────────────────────────────────────────────────────────────────────────
# Supervisor construction
# ─────────────────────────────────────────────────────────────────────────────


def _resolve_path_list(refs: list[str] | str | None, base: Path, ext: str) -> list[Path]:
    if refs is None:
        return []
    if isinstance(refs, str):
        refs = [refs]
    paths: list[Path] = []
    for ref in refs:
        # Bare ref like "garage/wiring_question" → base/garage/wiring_question.<ext>
        candidate = base / f"{ref}{ext}"
        if candidate.exists():
            paths.append(candidate)
        else:
            logger.warning("missing fixture asset: %s (looked at %s)", ref, candidate)
    return paths


def build_mock_supervisor(fixture: dict[str, Any]) -> Any:
    """Construct a Supervisor with all workers swapped for fakes."""
    from shared.engine import Supervisor  # noqa: E402

    # Per-fixture ephemeral sqlite — keeps each scenario state-isolated.
    tmp_db = tempfile.NamedTemporaryFile(  # noqa: SIM115 — intentionally kept open for run
        prefix=f"conv-suite-{fixture['id']}-",
        suffix=".db",
        delete=False,
    )
    tmp_db.close()

    sup = Supervisor(
        db_path=tmp_db.name,
        openwebui_url="http://localhost:0",
        api_key="mock",
        collection_id="mock-collection",
        vision_model="qwen2.5vl:7b",
        tenant_id=fixture.get("tenant_id", "conv-suite"),
    )

    response_paths = _resolve_path_list(
        fixture.get("mock_responses"), RESPONSES_DIR, ".yaml"
    )
    chunk_paths = _resolve_path_list(
        fixture.get("mock_kb_chunks"), KB_DIR, ".json"
    )

    fake_router = FakeInferenceRouter(response_paths)
    sup.router = fake_router
    sup.rag = FakeRAGWorker(
        chunk_paths,
        router=fake_router,
        tenant_id=fixture.get("tenant_id", "conv-suite"),
    )
    sup.vision = FakeVisionWorker()
    sup.nameplate = FakeNameplateWorker()
    sup.nemotron = FakeNemotronClient()

    # Stash temp db path on the supervisor so callers can clean up.
    sup._conv_suite_tmp_db = tmp_db.name  # type: ignore[attr-defined]
    return sup


def build_live_supervisor(fixture: dict[str, Any]) -> Any:
    """Real Supervisor — uses live InferenceRouter + Open WebUI test collection."""
    from shared.engine import Supervisor  # noqa: E402

    tmp_db = tempfile.NamedTemporaryFile(  # noqa: SIM115
        prefix=f"conv-suite-live-{fixture['id']}-",
        suffix=".db",
        delete=False,
    )
    tmp_db.close()

    openwebui_url = os.environ.get("OPENWEBUI_URL", "http://localhost:3000")
    api_key = os.environ.get("OPENWEBUI_API_KEY", "")
    collection_id = os.environ.get("MIRA_TEST_COLLECTION_ID", "")
    if not (api_key and collection_id):
        raise RuntimeError(
            "Live mode requires OPENWEBUI_API_KEY and MIRA_TEST_COLLECTION_ID env vars."
        )

    sup = Supervisor(
        db_path=tmp_db.name,
        openwebui_url=openwebui_url,
        api_key=api_key,
        collection_id=collection_id,
        tenant_id=fixture.get("tenant_id", "conv-suite"),
    )
    sup._conv_suite_tmp_db = tmp_db.name  # type: ignore[attr-defined]
    return sup


# ─────────────────────────────────────────────────────────────────────────────
# Scenario execution
# ─────────────────────────────────────────────────────────────────────────────


async def run_scenario(
    fixture: dict[str, Any],
    *,
    mode: str = "mock",
    platform: str = "harness",
) -> ScenarioRun:
    """Execute all turns in a fixture against a fresh Supervisor."""
    run = ScenarioRun(
        fixture_id=fixture["id"],
        fixture_path=Path(fixture.get("__path__", fixture["id"])),
        fixture=fixture,
        mode=mode,
    )

    builder = build_mock_supervisor if mode == "mock" else build_live_supervisor
    try:
        sup = builder(fixture)
    except Exception as exc:
        run.error = f"build_supervisor: {exc!r}"
        logger.exception("failed to build supervisor for %s", fixture["id"])
        return run

    chat_id = f"conv-suite-{fixture['id']}"
    turns = fixture.get("turns") or []

    # Fixture's `platform:` field overrides the CLI default — adapter_parity
    # cases set this to telegram/slack/hub so engine sees the real platform arg.
    effective_platform = fixture.get("platform") or platform

    try:
        for idx, turn in enumerate(turns):
            if turn.get("role") != "user":
                continue
            message = str(turn.get("content", ""))
            t0 = time.monotonic()
            try:
                reply = await sup.process(chat_id, message, platform=effective_platform)
            except Exception as exc:
                reply = ""
                turn_error: str | None = repr(exc)
                logger.exception(
                    "process() raised for %s turn %d", fixture["id"], idx
                )
            else:
                turn_error = None
            latency_ms = int((time.monotonic() - t0) * 1000)

            state = sup._load_state(chat_id) or {}
            run.turns.append(
                TurnResult(
                    turn_index=idx,
                    user_message=message,
                    reply=reply,
                    fsm_state=str(state.get("state", "")),
                    asset_identified=str(state.get("asset_identified") or ""),
                    latency_ms=latency_ms,
                    platform=effective_platform,
                    error=turn_error,
                )
            )
            run.total_latency_ms += latency_ms
    finally:
        tmp_db = getattr(sup, "_conv_suite_tmp_db", None)
        if tmp_db:
            try:
                os.unlink(tmp_db)
            except OSError:
                pass

    return run


async def run_all(
    fixture_paths: list[Path],
    *,
    mode: str = "mock",
    platform: str = "harness",
    concurrency: int = 1,
) -> list[ScenarioRun]:
    """Run a batch of fixtures. Concurrency=1 by default so state writes don't race."""
    loaded = []
    for p in fixture_paths:
        try:
            fx = load_fixture(p)
            fx["__path__"] = str(p)
            loaded.append(fx)
        except yaml.YAMLError as exc:
            logger.error("skipping %s — yaml error: %s", p, exc)

    if concurrency <= 1:
        return [
            await run_scenario(fx, mode=mode, platform=platform) for fx in loaded
        ]

    sem = asyncio.Semaphore(concurrency)

    async def _bounded(fx: dict[str, Any]) -> ScenarioRun:
        async with sem:
            return await run_scenario(fx, mode=mode, platform=platform)

    return await asyncio.gather(*[_bounded(fx) for fx in loaded])
