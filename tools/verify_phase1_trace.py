"""One-off verification that engine.process() emits a local AnswerTrace (Phase 1).

Sets MIRA_LOCAL_TRACE=1 + a temp MIRA_TRACE_DIR, drives a single real
Supervisor.process() turn (direct-connection preseed), and checks a JSONL trace
landed. Backends (Neon/Ollama/Open WebUI) are unreachable on a dev box → the
engine returns its fail-open fallback reply, but _schedule_decision_trace still
fires, so the trace must still be written. Run: python tools/verify_phase1_trace.py
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import time
import uuid
from pathlib import Path

_TRACE_DIR = Path(__file__).resolve().parent.parent / ".mira-phase1-traces"
os.environ["MIRA_LOCAL_TRACE"] = "1"
os.environ["MIRA_TRACE_DIR"] = str(_TRACE_DIR)
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "mira-bots"))

from shared.engine import Supervisor  # noqa: E402


def main() -> int:
    for f in _TRACE_DIR.glob("turns-*.jsonl") if _TRACE_DIR.exists() else []:
        f.unlink()

    sup = Supervisor(
        db_path="/tmp/mira_phase1.db",
        openwebui_url="http://localhost:3000",
        api_key="",
        collection_id="",
        tenant_id="phase1-tenant",
    )
    chat_id = f"phase1_{uuid.uuid4().hex[:8]}"
    sup.reset(chat_id)
    sup._save_state(
        chat_id,
        {
            "state": "Q1",
            "asset_identified": "conv_belt_01",
            # NOTE: we do NOT hand-craft state["context"]["uns_context"] — the
            # engine's uns_resolver owns that shape (confidence is a float band; a
            # string there crashes _merge_with_prior). On a backend-less dev box the
            # resolver can't fully populate it, so the emitted trace's asset/uns may
            # be null — that's faithful (decision_trace would record the same). The
            # Phase-1 assertion is only that a trace IS emitted with the 7 steps.
            "uns_context": {
                "source": "direct_connection",
                "confidence": "certified",
                "uns_path": "enterprise.plant1.packaging.line2.conv_belt_01",
            },
            "context": {
                "session_context": {
                    "machine_type": "conveyor",
                    "tag_state": {"vfd_gs20_01.output_hz": 0.0},
                },
            },
            "exchange_count": 0,
            "fault_category": None,
            "final_state": None,
        },
    )
    reply = asyncio.run(sup.process(chat_id, "Why did the conveyor stop?", photo_b64=None))
    print("REPLY:", (reply or "")[:80])
    time.sleep(1)  # let the fire-and-forget file append settle

    files = list(_TRACE_DIR.glob("turns-*.jsonl")) if _TRACE_DIR.exists() else []
    if not files:
        print("FAIL: no trace file — Phase 1 hook did not emit")
        return 1
    rows = [
        json.loads(line)
        for line in files[0].read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    print("TRACE FILE:", files[0].name, "| N:", len(rows))
    r = rows[-1]
    print(
        "asset:",
        r.get("asset_uns_path"),
        "| uns_source:",
        r.get("uns_source"),
        "| steps:",
        [s["name"] for s in r["steps"]],
        "| latency_ms:",
        r.get("total_latency_ms"),
    )
    gov = next((s for s in r["steps"] if s["name"] == "check_governance"), {})
    print(
        "model_used:", r.get("model_used"),
        "| check_governance:", gov.get("status"),
        "| warnings:", [w["code"] for w in r.get("warnings", [])],
    )
    # Phase-1 assertion: a trace was emitted with the 7 canonical steps and a real
    # total latency. (asset/uns populate only when the live resolver runs — needs
    # backends, out of scope for this dev-box smoke.)
    ok = [s["name"] for s in r["steps"]] == [
        "receive_question",
        "resolve_asset",
        "retrieve_context",
        "check_governance",
        "generate_answer",
        "validate_answer",
        "return_answer",
    ] and r.get("total_latency_ms") is not None
    print("RESULT:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
