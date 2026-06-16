"""Regime 1 — Telethon Replay Loop.

Sends photos/messages to @MIRABot via Telethon, captures responses,
scores them with the deterministic judge + optional LLM-as-judge.

Modes:
  - dry-run: validate golden case parsing + scoring logic (no network)
  - http: POST to mira-ingest HTTP API directly (needs BRAVO services)
  - telethon: full end-to-end via Telethon client (needs auth session)

Set MIRA_REPLAY_MODE env var to control mode. Default: dry-run.
"""

from __future__ import annotations

import asyncio
import os
import time
from pathlib import Path

import pytest

from tests.conftest import REPO_ROOT, load_golden_file, load_photo_b64
from tests.scoring.contains_check import score_case
from tests.scoring.composite import CaseResult, build_case_result


# ── Golden case loading ─────────────────────────────────────────────────────

def _load_vision_cases() -> list[dict]:
    """Load manufactured-photo golden cases (with full ground truth)."""
    data = load_golden_file("regime1_telethon", "vision_cases.yaml")
    return data.get("cases", []) if isinstance(data, dict) else data


def _load_real_photo_cases() -> list[dict]:
    """Load real factory photo cases (minimal pass conditions)."""
    data = load_golden_file("regime1_telethon", "case1_real_photos.yaml")
    return data.get("cases", []) if isinstance(data, dict) else data


def _load_all_regime1_cases() -> list[dict]:
    """Load all Regime 1 golden cases."""
    return _load_vision_cases() + _load_real_photo_cases()


# ── Mock response for dry-run mode ──────────────────────────────────────────

_DRY_RUN_RESPONSES: dict[str, str] = {
    "ab_micro820_tag": (
        "I can see this is an Allen-Bradley Micro820 PLC (catalog 2080-LC20-20QWB). "
        "The most common issue with these is I/O module failure due to loose terminal connections. "
        "Check the I/O terminals and verify the program is running."
    ),
    "gs10_vfd_tag": (
        "This is an AutomationDirect GS10 VFD (model GS10-20P5). "
        "Drive faults are often caused by motor overload or overvoltage conditions. "
        "Check motor connections and reset the drive."
    ),
    "generic_cabinet_tag": (
        "This appears to be a Square D MCC-003 motor control center panel rated at 480VAC. "
        "Panel faults typically involve tripped breakers due to overload conditions. "
        "Check the main breaker and verify load balance."
    ),
    "bad_glare_tag": (
        "Despite the glare I can make out an Allen-Bradley Micro820 PLC. "
        "Programming faults or I/O issues are likely. Check power and verify the program."
    ),
    "cropped_tight_tag": (
        "From the partial nameplate I can identify an AutomationDirect GS10 VFD. "
        "Motor faults or drive parameter issues are common. Check motor and reset drive."
    ),
}


def _get_dry_run_response(case: dict) -> str:
    """Return a mock response for dry-run testing."""
    name = case.get("name", "")
    return _DRY_RUN_RESPONSES.get(name, "Equipment identified. Check for common fault causes and inspect the system.")


# ── HTTP fallback mode ──────────────────────────────────────────────────────

async def _send_http(case: dict, base_url: str) -> tuple[str | None, float]:
    """Send photo via HTTP to mira-ingest and get response."""
    import httpx

    image_path = REPO_ROOT / case["image"]
    if not image_path.exists():
        return None, 0.0

    t0 = time.monotonic()
    async with httpx.AsyncClient(timeout=60) as client:
        with open(image_path, "rb") as f:
            resp = await client.post(
                f"{base_url}/ingest/photo",
                files={"image": (image_path.name, f, "image/jpeg")},
                data={
                    "asset_tag": case.get("name", "test"),
                    "notes": case.get("caption", ""),
                },
            )
        elapsed = time.monotonic() - t0

        if resp.status_code == 200:
            data = resp.json()
            return data.get("description", ""), elapsed
        return None, elapsed


# ── Telethon live mode ──────────────────────────────────────────────────────

async def _send_telethon(case: dict, bot_username: str, timeout: int) -> tuple[str | None, float]:
    """Send photo via Telethon to the actual bot and collect reply."""
    # Import Telethon session from the existing test runner
    try:
        from telegram_test_runner.session import get_client
    except ImportError:
        pytest.skip("Telethon session module not available")

    client = await get_client()
    bot_entity = await client.get_entity(bot_username)

    image_path = REPO_ROOT / case["image"]
    if not image_path.exists():
        return None, 0.0

    t0 = time.monotonic()
    sent = await client.send_file(bot_entity, str(image_path), caption=case.get("caption", ""))

    # Silence-detection polling (from run_test.py pattern)
    collected: list[str] = []
    last_id = sent.id
    silence_ticks = 0
    elapsed = 0.0

    while elapsed < timeout:
        await asyncio.sleep(2)
        elapsed = time.monotonic() - t0
        new = []
        async for msg in client.iter_messages(bot_entity, limit=20, min_id=last_id):
            if not msg.out and msg.text:
                new.append(msg)
        new.sort(key=lambda m: m.id)
        if new:
            collected.extend(m.text for m in new)
            last_id = new[-1].id
            silence_ticks = 0
        else:
            silence_ticks += 1
            if silence_ticks >= 3:
                break

    reply = "\n".join(collected) if collected else None
    return reply, time.monotonic() - t0


# ── Test parametrization ────────────────────────────────────────────────────

def _get_case_ids() -> list[str]:
    """Get case IDs for parametrization."""
    try:
        cases = _load_all_regime1_cases()
        return [c.get("name", f"case_{i}") for i, c in enumerate(cases)]
    except Exception:
        return ["no_cases_loaded"]


@pytest.mark.regime1
class TestReplayLoop:
    """Parametrized test over Regime 1 vision golden cases (manufactured photos)."""

    @pytest.fixture(autouse=True)
    def _setup(self, replay_mode, bot_username, telethon_timeout):
        self.mode = replay_mode
        self.bot_username = bot_username
        self.timeout = telethon_timeout
        self.vision_cases = _load_vision_cases()

    @pytest.mark.parametrize("case_index", range(5), ids=[
        "ab_micro820_tag", "gs10_vfd_tag", "generic_cabinet_tag",
        "bad_glare_tag", "cropped_tight_tag",
    ])
    def test_vision_case(self, case_index):
        """Test a vision (manufactured photo) golden case."""
        if case_index >= len(self.vision_cases):
            pytest.skip(f"Case index {case_index} not available")

        case = self.vision_cases[case_index]
        reply, elapsed = self._run_case(case)
        result = score_case(case, reply, elapsed)

        assert result["passed"], (
            f"Case {case['name']} FAILED: bucket={result['failure_bucket']}, "
            f"fix={result['fix_suggestion']}"
        )

    def _run_case(self, case: dict) -> tuple[str | None, float]:
        """Execute a case in the configured mode."""
        if self.mode == "dry-run":
            return _get_dry_run_response(case), 1.0

        if self.mode == "http":
            base_url = os.getenv("MIRA_INGEST_URL", "http://localhost:8002")
            return asyncio.get_event_loop().run_until_complete(
                _send_http(case, base_url)
            )

        if self.mode == "telethon":
            return asyncio.get_event_loop().run_until_complete(
                _send_telethon(case, self.bot_username, self.timeout)
            )

        pytest.fail(f"Unknown replay mode: {self.mode}")


@pytest.mark.regime1
@pytest.mark.network
class TestReplayLoopLive:
    """Live Telethon tests — only run when MIRA_REPLAY_MODE=telethon."""

    @pytest.fixture(autouse=True)
    def _setup(self, replay_mode):
        if replay_mode != "telethon":
            pytest.skip("Live tests require MIRA_REPLAY_MODE=telethon")

    def test_placeholder(self):
        """Placeholder for live parametrized tests — activated by mode."""
        pass


# ── Regime runner (called by synthetic_eval.py) ─────────────────────────────

async def regime1_runner(
    mode: str = "dry-run",
    bot_username: str = "@MIRABot",
    timeout: int = 60,
    ingest_url: str = "http://localhost:8002",
) -> list[CaseResult]:
    """Run all Regime 1 cases and return scored results.

    This is the entry point called by synthetic_eval.py.
    """
    cases = _load_all_regime1_cases()
    results: list[CaseResult] = []

    for case in cases:
        t0 = time.monotonic()

        if mode == "dry-run":
            reply = _get_dry_run_response(case)
            elapsed = 1.0
        elif mode == "http":
            reply, elapsed = await _send_http(case, ingest_url)
        elif mode == "telethon":
            reply, elapsed = await _send_telethon(case, bot_username, timeout)
        else:
            reply, elapsed = None, 0.0

        latency_ms = int(elapsed * 1000)

        # Deterministic scoring
        det_result = score_case(case, reply, elapsed)

        result = build_case_result(
            case_id=case.get("name", "unknown"),
            regime="regime1_telethon",
            contains_score=det_result["contains_score"],
            failure_bucket=det_result["failure_bucket"] if not det_result["passed"] else None,
            latency_ms=latency_ms,
            raw_response=reply or "",
            metadata={
                "conditions": det_result["conditions"],
                "extracted_facts": det_result["extracted_facts"],
                "mode": mode,
            },
        )
        results.append(result)

    return results
