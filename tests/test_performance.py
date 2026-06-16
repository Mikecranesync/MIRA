"""Performance regression guards.

Two tiers:
1. Unit guards (always run): guardrails, memory strip, and state I/O must
   complete within tight CPU budgets — these are hot paths called on every turn.
2. E2E guards (doppler run required): pipeline P50/P95 latency budgets against live VPS.
   Skipped automatically when PIPELINE_API_KEY is not set.
"""

from __future__ import annotations

import sys
import time

sys.path.insert(0, "mira-bots")

import os
import statistics

import pytest

from shared.guardrails import classify_intent, expand_abbreviations, strip_mentions
from shared.engine import Supervisor


# ── Unit performance guards ───────────────────────────────────────────────────

_SAMPLE_MESSAGES = [
    "Motor tripped on overcurrent fault E.OC.3",
    "VFD shows underVoltage — DC bus below threshold",
    "There is exposed wire near the panel",
    "What does fault code 72 mean on a PowerFlex 525?",
    "The conveyor belt stopped and I see smoke from the drive",
    "Check the pressure sensor reading",
    "de-energize the circuit before touching anything",
    "How do I clear an overcurrent fault?",
    "Upload the nameplate photo of this motor",
    "The GS10 VFD shows E.OL.1 after 10 minutes of operation",
]


def test_classify_intent_throughput():
    """classify_intent must handle 1000 classifications in under 500ms."""
    msgs = _SAMPLE_MESSAGES * 100  # 1000 calls
    start = time.perf_counter()
    for msg in msgs:
        classify_intent(msg)
    elapsed = time.perf_counter() - start
    assert elapsed < 0.5, (
        f"classify_intent throughput regression: 1000 calls took {elapsed:.3f}s (budget: 0.5s)"
    )


def test_expand_abbreviations_throughput():
    """expand_abbreviations must handle 1000 expansions in under 200ms."""
    msgs = _SAMPLE_MESSAGES * 100
    start = time.perf_counter()
    for msg in msgs:
        expand_abbreviations(msg)
    elapsed = time.perf_counter() - start
    assert elapsed < 0.2, (
        f"expand_abbreviations throughput regression: {elapsed:.3f}s (budget: 0.2s)"
    )


def test_strip_mentions_throughput():
    """strip_mentions must handle 1000 calls in under 100ms."""
    msgs = ["@MIRA " + m for m in _SAMPLE_MESSAGES] * 100
    start = time.perf_counter()
    for msg in msgs:
        strip_mentions(msg)
    elapsed = time.perf_counter() - start
    assert elapsed < 0.1, (
        f"strip_mentions throughput regression: {elapsed:.3f}s (budget: 0.1s)"
    )


def test_strip_memory_block_throughput():
    """_strip_memory_block must handle 1000 calls in under 200ms."""
    with_memory = (
        "[MIRA MEMORY — facts from this session]\n"
        "Asset: GS10 VFD, Vendor: AutomationDirect\n"
        "[END MEMORY]\n\n"
        "What is the rated current?"
    )
    msgs = [with_memory, "What is the rated current?"] * 500
    start = time.perf_counter()
    for msg in msgs:
        Supervisor._strip_memory_block(msg)
    elapsed = time.perf_counter() - start
    assert elapsed < 0.2, (
        f"_strip_memory_block throughput regression: {elapsed:.3f}s (budget: 0.2s)"
    )


def test_state_load_save_throughput(tmp_path):
    """State load+save roundtrip must handle 100 cycles in under 2s."""
    from unittest.mock import patch
    db_path = str(tmp_path / "perf.db")
    with patch.dict("os.environ", {"INFERENCE_BACKEND": "local"}):
        with patch("shared.engine.VisionWorker"), \
             patch("shared.engine.NameplateWorker"), \
             patch("shared.engine.RAGWorker"), \
             patch("shared.engine.PrintWorker"), \
             patch("shared.engine.PLCWorker"), \
             patch("shared.engine.NemotronClient"), \
             patch("shared.engine.InferenceRouter"):
            sv = Supervisor(
                db_path=db_path,
                openwebui_url="http://localhost:3000",
                api_key="test",
                collection_id="test",
            )

    state_template = {
        "chat_id": "perf_user",
        "state": "Q1",
        "context": {"session_context": {}, "history": [
            {"role": "user", "content": "Motor tripped"},
            {"role": "assistant", "content": "Check current draw."},
        ]},
        "asset_identified": "GS10 VFD",
        "fault_category": "electrical",
        "exchange_count": 1,
        "final_state": None,
    }

    start = time.perf_counter()
    for i in range(100):
        sv._save_state(f"perf_user_{i}", {**state_template, "chat_id": f"perf_user_{i}"})
        sv._load_state(f"perf_user_{i}")
    elapsed = time.perf_counter() - start
    assert elapsed < 2.0, (
        f"State load/save throughput regression: 100 cycles took {elapsed:.3f}s (budget: 2.0s)"
    )


# ── E2E latency guards (requires PIPELINE_API_KEY) ───────────────────────────

_API_KEY = os.getenv("PIPELINE_API_KEY", "")
_BASE_URL = os.getenv("WEB_URL", "https://app.factorylm.com")
_PIPELINE_URL = os.getenv("PIPELINE_URL", _BASE_URL)

_requires_pipeline = pytest.mark.skipif(
    not _API_KEY,
    reason="PIPELINE_API_KEY not set — run via: doppler run -p factorylm -c prd -- pytest",
)

_E2E_SCENARIOS = [
    ("simple_greeting", "Hello"),
    ("fault_code", "VFD shows E.OC.3 fault code"),
    ("safety_check", "There is exposed wire near the panel"),
    ("documentation", "Find me the GS10 manual"),
    ("industrial_q", "What does an overcurrent fault mean on a VFD?"),
]

_P50_BUDGET_S = float(os.getenv("MIRA_P50_BUDGET", "4.0"))
_P95_BUDGET_S = float(os.getenv("MIRA_P95_BUDGET", "8.0"))


@_requires_pipeline
def test_pipeline_p50_latency():
    """Pipeline P50 response time must be under budget (default 4s)."""
    import httpx
    import uuid

    headers = {"Authorization": f"Bearer {_API_KEY}", "Content-Type": "application/json"}
    client = httpx.Client(timeout=httpx.Timeout(30.0))
    latencies = []

    for name, msg in _E2E_SCENARIOS:
        uid = uuid.uuid4().hex[:8]
        payload = {
            "model": "mira-diagnostic",
            "messages": [{"role": "user", "content": msg}],
            "stream": False,
            "user": f"perf_{uid}",
        }
        t0 = time.perf_counter()
        resp = client.post(f"{_PIPELINE_URL}/v1/chat/completions", json=payload, headers=headers)
        latency = time.perf_counter() - t0
        assert resp.status_code == 200, f"Scenario {name!r} returned {resp.status_code}"
        latencies.append(latency)

    p50 = statistics.median(latencies)
    p95 = sorted(latencies)[int(len(latencies) * 0.95)] if len(latencies) >= 20 else max(latencies)
    print(f"\nLatency P50={p50:.2f}s  P95(max)={p95:.2f}s  samples={latencies}")

    assert p50 < _P50_BUDGET_S, f"P50 regression: {p50:.2f}s > {_P50_BUDGET_S}s budget"


@_requires_pipeline
def test_pipeline_p95_latency():
    """Pipeline P95 latency measured over 20 calls must be under budget (default 8s)."""
    import httpx
    import uuid

    headers = {"Authorization": f"Bearer {_API_KEY}", "Content-Type": "application/json"}
    client = httpx.Client(timeout=httpx.Timeout(45.0))
    latencies = []
    msgs = [m for _, m in _E2E_SCENARIOS] * 4  # 20 calls

    for i, msg in enumerate(msgs):
        uid = uuid.uuid4().hex[:8]
        payload = {
            "model": "mira-diagnostic",
            "messages": [{"role": "user", "content": msg}],
            "stream": False,
            "user": f"p95_{uid}",
        }
        t0 = time.perf_counter()
        resp = client.post(f"{_PIPELINE_URL}/v1/chat/completions", json=payload, headers=headers)
        latency = time.perf_counter() - t0
        if resp.status_code == 200:
            latencies.append(latency)

    assert latencies, "No successful responses collected"
    p95 = sorted(latencies)[int(len(latencies) * 0.95)]
    print(f"\nP95 latency: {p95:.2f}s over {len(latencies)} calls")
    assert p95 < _P95_BUDGET_S, f"P95 regression: {p95:.2f}s > {_P95_BUDGET_S}s budget"
