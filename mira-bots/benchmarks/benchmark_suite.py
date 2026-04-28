"""MIRA Benchmark Suite v1 — comprehensive quality measurement system.

5 dimensions, 70 cases, Groq-judged + programmatic scoring.
Versioned JSON results saved to benchmarks/results/.

Usage (inside mira-bot-telegram container):
    docker exec mira-bot-telegram python3 /app/benchmarks/benchmark_suite.py --version 1.0.0

Or locally:
    cd mira-bots
    INFERENCE_BACKEND=cloud MIRA_DB_PATH=/tmp/bench_test.db \\
        python3 benchmarks/benchmark_suite.py --version 1.0.0

Compare two runs:
    python3 benchmarks/benchmark_suite.py --compare results/v1.0.0_*.json results/v1.1.0_*.json
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import re
import sys
import time
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

# ---------------------------------------------------------------------------
# Path setup — container (/app) or repo root
# ---------------------------------------------------------------------------
_HERE = Path(__file__).parent.resolve()
_BOTS_ROOT = _HERE.parent
if str(_BOTS_ROOT) not in sys.path:
    sys.path.insert(0, str(_BOTS_ROOT))

logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s")
for _noisy in ("httpx", "httpcore", "urllib3", "asyncio", "httpx._client"):
    logging.getLogger(_noisy).setLevel(logging.ERROR)

import httpx

# ---------------------------------------------------------------------------
# Dimension weights (must sum to 1.0)
# ---------------------------------------------------------------------------
WEIGHTS = {
    "technical": 0.30,
    "conversational": 0.25,
    "wo_quality": 0.20,
    "fsm": 0.15,
    "response_quality": 0.10,
}

GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
MSG_TIMEOUT = 60  # seconds per turn
_RESULTS_DIR = _HERE / "results"

# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------


@dataclass
class BenchmarkCase:
    id: str
    dimension: str
    messages: list[str]
    metadata: dict = field(default_factory=dict)
    expected_states: Optional[list[str]] = None
    expected_final_state: Optional[str] = None
    response_checks: Optional[list[str]] = None  # for response_quality dimension


@dataclass
class CaseResult:
    case_id: str
    dimension: str
    score: float  # 0.0–1.0
    latency_ms: int
    error: Optional[str] = None
    reasoning: str = ""
    turns: list[dict] = field(default_factory=list)
    passed_checks: list[str] = field(default_factory=list)
    failed_checks: list[str] = field(default_factory=list)


@dataclass
class BenchmarkRun:
    version: str
    timestamp: str
    dimension_scores: dict[str, float] = field(default_factory=dict)
    dimension_case_counts: dict[str, int] = field(default_factory=dict)
    overall_score: float = 0.0
    grade: str = ""
    total_cases: int = 0
    passed_cases: int = 0
    total_ms: int = 0
    groq_model: str = ""
    case_results: list[CaseResult] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Test cases — embedded inline
# ---------------------------------------------------------------------------

TECHNICAL_CASES: list[BenchmarkCase] = [
    BenchmarkCase(
        id="tech-01",
        dimension="technical",
        messages=["My VFD is showing E-OC fault code, what does that mean?"],
        metadata={"equipment": "VFD", "topic": "fault codes", "ref": "E-OC = overcurrent"},
    ),
    BenchmarkCase(
        id="tech-02",
        dimension="technical",
        messages=["What are the symptoms of a failing motor bearing?"],
        metadata={"equipment": "electric motor", "topic": "bearing failure"},
    ),
    BenchmarkCase(
        id="tech-03",
        dimension="technical",
        messages=["Centrifugal pump is cavitating. What's causing it and how do I fix it?"],
        metadata={"equipment": "pump", "topic": "cavitation"},
    ),
    BenchmarkCase(
        id="tech-04",
        dimension="technical",
        messages=["How do I do a LOTO procedure on a 480V motor starter?"],
        metadata={"equipment": "motor starter", "topic": "LOTO safety"},
    ),
    BenchmarkCase(
        id="tech-05",
        dimension="technical",
        messages=["Belt drive is slipping on conveyor. What should I check?"],
        metadata={"equipment": "conveyor", "topic": "belt drive"},
    ),
    BenchmarkCase(
        id="tech-06",
        dimension="technical",
        messages=["What does OL trip mean on a motor overload relay?"],
        metadata={"equipment": "overload relay", "topic": "OL trip"},
    ),
    BenchmarkCase(
        id="tech-07",
        dimension="technical",
        messages=["Air compressor is short cycling. What are the causes?"],
        metadata={"equipment": "air compressor", "topic": "short cycling"},
    ),
    BenchmarkCase(
        id="tech-08",
        dimension="technical",
        messages=["How do I calibrate a 4-20mA pressure transmitter?"],
        metadata={"equipment": "pressure transmitter", "topic": "calibration"},
    ),
    BenchmarkCase(
        id="tech-09",
        dimension="technical",
        messages=["What is the difference between a contactor and a motor starter?"],
        metadata={"equipment": "electrical controls", "topic": "fundamentals"},
    ),
    BenchmarkCase(
        id="tech-10",
        dimension="technical",
        messages=["Gearbox temperature is 95°C. Is that normal?"],
        metadata={"equipment": "gearbox", "topic": "temperature"},
    ),
    BenchmarkCase(
        id="tech-11",
        dimension="technical",
        messages=["What causes insulation resistance to drop on a motor winding?"],
        metadata={"equipment": "electric motor", "topic": "insulation"},
    ),
    BenchmarkCase(
        id="tech-12",
        dimension="technical",
        messages=["Hydraulic system pressure drops when load increases. Why?"],
        metadata={"equipment": "hydraulic system", "topic": "pressure loss"},
    ),
    BenchmarkCase(
        id="tech-13",
        dimension="technical",
        messages=["PLC input card showing no LED on channel 4. Steps to diagnose?"],
        metadata={"equipment": "PLC", "topic": "I/O diagnosis"},
    ),
    BenchmarkCase(
        id="tech-14",
        dimension="technical",
        messages=["What PPE is required when working on energized 480V equipment?"],
        metadata={"equipment": "electrical", "topic": "PPE requirements"},
    ),
    BenchmarkCase(
        id="tech-15",
        dimension="technical",
        messages=["Cooling tower fan vibration spiked to 12mm/s RMS. Acceptable?"],
        metadata={"equipment": "cooling tower", "topic": "vibration"},
    ),
    BenchmarkCase(
        id="tech-16",
        dimension="technical",
        messages=["How do I megger test a 3-phase motor?"],
        metadata={"equipment": "electric motor", "topic": "megger test"},
    ),
    BenchmarkCase(
        id="tech-17",
        dimension="technical",
        messages=["What is power factor and why does it matter for motors?"],
        metadata={"equipment": "electric motor", "topic": "power factor"},
    ),
    BenchmarkCase(
        id="tech-18",
        dimension="technical",
        messages=["Chiller showing high refrigerant head pressure alarm. Common causes?"],
        metadata={"equipment": "chiller", "topic": "head pressure"},
    ),
    BenchmarkCase(
        id="tech-19",
        dimension="technical",
        messages=["What is the correct torque sequence for flange bolts on a 6-inch pipe?"],
        metadata={"equipment": "piping", "topic": "flange torque"},
    ),
    BenchmarkCase(
        id="tech-20",
        dimension="technical",
        messages=["Servo drive fault STO active but e-stop is released. Debug steps?"],
        metadata={"equipment": "servo drive", "topic": "STO fault"},
    ),
]


CONVERSATIONAL_CASES: list[BenchmarkCase] = [
    BenchmarkCase(
        id="conv-01",
        dimension="conversational",
        messages=[
            "Compressor not working",
            "It's a Sullair 185, about 5 years old",
            "Yes it was running fine yesterday",
        ],
        metadata={"test": "context retention across turns", "equipment": "compressor"},
    ),
    BenchmarkCase(
        id="conv-02",
        dimension="conversational",
        messages=["vfd shows err 14", "yes that's the fault code on the display"],
        metadata={"test": "typo tolerance + follow-up", "equipment": "VFD"},
    ),
    BenchmarkCase(
        id="conv-03",
        dimension="conversational",
        messages=["motor tripping on overload", "460V 30HP", "Yes checked and it's correct"],
        metadata={"test": "multi-turn diagnosis", "equipment": "motor"},
    ),
    BenchmarkCase(
        id="conv-04",
        dimension="conversational",
        messages=["hello"],
        metadata={"test": "greeting handled gracefully"},
    ),
    BenchmarkCase(
        id="conv-05",
        dimension="conversational",
        messages=["pump is leaking", "it's a centrifugal pump on the cooling loop"],
        metadata={"test": "equipment clarification flow"},
    ),
    BenchmarkCase(
        id="conv-06",
        dimension="conversational",
        messages=["explain what a VFD does like I'm new to the job"],
        metadata={"test": "instructional clarity"},
    ),
    BenchmarkCase(
        id="conv-07",
        dimension="conversational",
        messages=["how do i check if the contactor is bad", "it clicks but motor doesn't start"],
        metadata={"test": "symptom-based narrowing"},
    ),
    BenchmarkCase(
        id="conv-08",
        dimension="conversational",
        messages=["BEARING IS MAKING LOUD NOISE ON LINE 2 PUMP"],
        metadata={"test": "uppercase urgent message handling"},
    ),
    BenchmarkCase(
        id="conv-09",
        dimension="conversational",
        messages=["thanks for the help"],
        metadata={"test": "polite close handled gracefully"},
    ),
    BenchmarkCase(
        id="conv-10",
        dimension="conversational",
        messages=["bomba de agua no enciende", "no, I don't speak much Spanish"],
        metadata={"test": "language switch handled gracefully"},
    ),
    BenchmarkCase(
        id="conv-11",
        dimension="conversational",
        messages=[
            "heat exchanger fouling up",
            "yes we run cooling water through it",
            "about every 6 months",
        ],
        metadata={"test": "maintenance history elicitation"},
    ),
    BenchmarkCase(
        id="conv-12",
        dimension="conversational",
        messages=["what should I do first when a machine trips?"],
        metadata={"test": "procedural guidance clarity"},
    ),
    BenchmarkCase(
        id="conv-13",
        dimension="conversational",
        messages=["the screen is blank on the HMI panel"],
        metadata={"test": "vague symptom → useful questions"},
    ),
    BenchmarkCase(
        id="conv-14",
        dimension="conversational",
        messages=["gearbox oil looks milky", "No leaks visible from outside"],
        metadata={"test": "multi-symptom diagnosis"},
    ),
    BenchmarkCase(
        id="conv-15",
        dimension="conversational",
        messages=["how often should I grease the motor bearings?", "It's a 30HP TEFC"],
        metadata={"test": "PM schedule guidance"},
    ),
    BenchmarkCase(
        id="conv-16",
        dimension="conversational",
        messages=["is it safe to bypass the thermal overload?"],
        metadata={"test": "safety refusal is correct response"},
    ),
    BenchmarkCase(
        id="conv-17",
        dimension="conversational",
        messages=["vibration on the fan is getting worse over the last week"],
        metadata={"test": "trending symptom handling"},
    ),
    BenchmarkCase(
        id="conv-18",
        dimension="conversational",
        messages=["motor smells burnt", "no smoke visible"],
        metadata={"test": "urgent symptom escalation"},
    ),
    BenchmarkCase(
        id="conv-19",
        dimension="conversational",
        messages=["what's the difference between grease nipple sizes?"],
        metadata={"test": "OEM terminology answer quality"},
    ),
    BenchmarkCase(
        id="conv-20",
        dimension="conversational",
        messages=["we just installed a new VFD and it faults immediately on start"],
        metadata={"test": "commissioning issue diagnosis"},
    ),
]


WO_QUALITY_CASES: list[BenchmarkCase] = [
    BenchmarkCase(
        id="wo-01",
        dimension="wo_quality",
        messages=[
            "Pump-7 on cooling loop is cavitating badly",
            "yes create the work order",
        ],
        metadata={"expected_fields": ["title", "asset", "priority", "description"]},
    ),
    BenchmarkCase(
        id="wo-02",
        dimension="wo_quality",
        messages=[
            "URGENT: Main compressor completely seized, production stopped",
            "yes",
        ],
        metadata={"expected_fields": ["HIGH priority", "urgency captured"]},
    ),
    BenchmarkCase(
        id="wo-03",
        dimension="wo_quality",
        messages=[
            "VFD-3 on conveyor line 2 showing E-OV fault",
            "create a work order for it",
            "yes confirm",
        ],
        metadata={"expected_fields": ["VFD-3 in title or asset", "fault code in description"]},
    ),
    BenchmarkCase(
        id="wo-04",
        dimension="wo_quality",
        messages=[
            "bearing noise on motor M-12",
            "it started this morning",
            "yes, please log it",
        ],
        metadata={"expected_fields": ["M-12 asset", "bearing in description"]},
    ),
    BenchmarkCase(
        id="wo-05",
        dimension="wo_quality",
        messages=[
            "schedule PM on chiller unit 3 — 6-month service is due",
            "yes",
        ],
        metadata={"expected_fields": ["PM or preventive in title", "chiller 3 asset"]},
    ),
    BenchmarkCase(
        id="wo-06",
        dimension="wo_quality",
        messages=[
            "oil leak under gearbox GB-4",
            "yes create it",
        ],
        metadata={"expected_fields": ["GB-4 asset", "leak in description"]},
    ),
    BenchmarkCase(
        id="wo-07",
        dimension="wo_quality",
        messages=[
            "fan motor on cooling tower CT-1 won't start",
            "create work order",
            "yes",
        ],
        metadata={"expected_fields": ["CT-1 or cooling tower asset", "won't start in description"]},
    ),
    BenchmarkCase(
        id="wo-08",
        dimension="wo_quality",
        messages=[
            "pressure relief valve on boiler B-2 is weeping",
            "yes log it",
        ],
        metadata={"expected_fields": ["B-2 or boiler asset", "PRV mentioned"]},
    ),
    BenchmarkCase(
        id="wo-09",
        dimension="wo_quality",
        messages=[
            "Conveyor belt on line 4 is tracking to one side",
            "yes",
        ],
        metadata={"expected_fields": ["line 4 or conveyor asset", "tracking in description"]},
    ),
    BenchmarkCase(
        id="wo-10",
        dimension="wo_quality",
        messages=[
            "electrical panel P-3 has a burning smell",
            "yes create work order immediately",
        ],
        metadata={"expected_fields": ["HIGH priority for burning smell", "P-3 asset"]},
    ),
    BenchmarkCase(
        id="wo-11",
        dimension="wo_quality",
        messages=[
            "robot arm RA-2 keeps faulting mid-cycle",
            "it's an intermittent error",
            "yes",
        ],
        metadata={"expected_fields": ["RA-2 asset", "intermittent in description"]},
    ),
    BenchmarkCase(
        id="wo-12",
        dimension="wo_quality",
        messages=[
            "hydraulic press HP-1 pressure dropping during stroke",
            "yes log it",
        ],
        metadata={"expected_fields": ["HP-1 asset", "pressure drop in description"]},
    ),
    BenchmarkCase(
        id="wo-13",
        dimension="wo_quality",
        messages=[
            "no create work order, just give me troubleshooting steps",
            "pump noise on P-11",
        ],
        metadata={"test": "user declines WO — bot should provide diagnosis instead"},
    ),
    BenchmarkCase(
        id="wo-14",
        dimension="wo_quality",
        messages=[
            "Air dryer AD-2 is not reducing dew point",
            "yes",
        ],
        metadata={"expected_fields": ["AD-2 asset", "dew point or dryer in description"]},
    ),
    BenchmarkCase(
        id="wo-15",
        dimension="wo_quality",
        messages=[
            "dust collector DC-7 filter differential high",
            "create WO",
            "yes",
        ],
        metadata={"expected_fields": ["DC-7 asset", "filter or differential in description"]},
    ),
]


FSM_CASES: list[BenchmarkCase] = [
    BenchmarkCase(
        id="fsm-01",
        dimension="fsm",
        messages=["VFD on pump 5 showing OC fault"],
        expected_final_state="diagnosis",
        metadata={"test": "cold message lands in diagnosis state"},
    ),
    BenchmarkCase(
        id="fsm-02",
        dimension="fsm",
        messages=["Pump P-8 bearing noise", "yes create a work order"],
        expected_final_state="wo_pending",
        metadata={"test": "diagnosis → wo_pending on yes"},
    ),
    BenchmarkCase(
        id="fsm-03",
        dimension="fsm",
        messages=["Motor M-3 overheating", "yes log it", "yes confirm"],
        expected_final_state="idle",
        metadata={"test": "full WO flow → back to idle after confirm"},
    ),
    BenchmarkCase(
        id="fsm-04",
        dimension="fsm",
        messages=["Conveyor belt tracking issue", "no don't create a work order"],
        expected_final_state="diagnosis",
        metadata={"test": "WO declined → stays in diagnosis"},
    ),
    BenchmarkCase(
        id="fsm-05",
        dimension="fsm",
        messages=["hello"],
        expected_final_state="idle",
        metadata={"test": "greeting stays idle"},
    ),
    BenchmarkCase(
        id="fsm-06",
        dimension="fsm",
        messages=["arc flash hazard on panel P-1", "I need to work on it now"],
        expected_final_state="safety_hold",
        metadata={"test": "safety keyword → safety_hold state"},
    ),
    BenchmarkCase(
        id="fsm-07",
        dimension="fsm",
        messages=["VFD-5 fault E-OV", "what causes that", "what else", "any other causes"],
        expected_final_state="diagnosis",
        metadata={"test": "multi-turn Q&A stays in diagnosis"},
    ),
    BenchmarkCase(
        id="fsm-08",
        dimension="fsm",
        messages=["Compressor C-2 pressure low", "yes work order please", "cancel"],
        expected_final_state="idle",
        metadata={"test": "cancel during WO → back to idle"},
    ),
    BenchmarkCase(
        id="fsm-09",
        dimension="fsm",
        messages=["pump P-9 cavitation", "yes", "yes"],
        expected_final_state="idle",
        metadata={"test": "double-yes completes WO flow"},
    ),
    BenchmarkCase(
        id="fsm-10",
        dimension="fsm",
        messages=["confined space entry required for tank inspection"],
        expected_final_state="safety_hold",
        metadata={"test": "confined space → safety halt"},
    ),
    BenchmarkCase(
        id="fsm-11",
        dimension="fsm",
        messages=["Motor M-22 failing"],
        expected_states=["diagnosis"],
        expected_final_state="diagnosis",
        metadata={"test": "state is set after first turn"},
    ),
    BenchmarkCase(
        id="fsm-12",
        dimension="fsm",
        messages=["fan bearing noise", "yes create WO", "no wait don't"],
        expected_final_state="idle",
        metadata={"test": "late cancel still lands idle"},
    ),
    BenchmarkCase(
        id="fsm-13",
        dimension="fsm",
        messages=["what time is it"],
        expected_final_state="idle",
        metadata={"test": "off-topic question stays idle"},
    ),
    BenchmarkCase(
        id="fsm-14",
        dimension="fsm",
        messages=["LOTO required on MCC-4", "yes proceed anyway"],
        expected_final_state="safety_hold",
        metadata={"test": "safety hold is sticky even after yes"},
    ),
    BenchmarkCase(
        id="fsm-15",
        dimension="fsm",
        messages=["pump P-1 leaking", "yes", "done"],
        expected_final_state="idle",
        metadata={"test": "post-WO confirmation → idle"},
    ),
]


RESPONSE_QUALITY_CASES: list[BenchmarkCase] = [
    BenchmarkCase(
        id="rq-01",
        dimension="response_quality",
        messages=["Pump P-3 cavitating"],
        response_checks=["not_empty", "max_length_2000", "no_raw_json", "no_stack_trace"],
        metadata={"test": "basic response quality"},
    ),
    BenchmarkCase(
        id="rq-02",
        dimension="response_quality",
        messages=["VFD fault E-OC"],
        response_checks=["not_empty", "no_apology_cant_help", "max_length_2000"],
        metadata={"test": "no unhelpful apology on known fault"},
    ),
    BenchmarkCase(
        id="rq-03",
        dimension="response_quality",
        messages=["motor tripping"],
        response_checks=["not_empty", "min_length_50", "no_repeated_sentences"],
        metadata={"test": "minimum useful length"},
    ),
    BenchmarkCase(
        id="rq-04",
        dimension="response_quality",
        messages=["how do I change a bearing?"],
        response_checks=["not_empty", "no_raw_json", "max_length_2000", "min_length_50"],
        metadata={"test": "procedural answer is substantive"},
    ),
    BenchmarkCase(
        id="rq-05",
        dimension="response_quality",
        messages=["hello"],
        response_checks=["not_empty", "max_length_500"],
        metadata={"test": "greeting is brief"},
    ),
    BenchmarkCase(
        id="rq-06",
        dimension="response_quality",
        messages=["bearing noise on motor M-7", "yes create work order"],
        response_checks=["not_empty", "no_raw_json", "no_stack_trace"],
        metadata={"test": "WO reply quality"},
    ),
    BenchmarkCase(
        id="rq-07",
        dimension="response_quality",
        messages=["arc flash on panel A-3"],
        response_checks=["not_empty", "contains_safety_word"],
        metadata={"test": "safety reply contains safety language"},
    ),
    BenchmarkCase(
        id="rq-08",
        dimension="response_quality",
        messages=["what's a PLC?"],
        response_checks=["not_empty", "min_length_30", "no_raw_json"],
        metadata={"test": "educational response is substantive"},
    ),
    BenchmarkCase(
        id="rq-09",
        dimension="response_quality",
        messages=["compressor won't start, won't start, won't start"],
        response_checks=["not_empty", "no_repeated_sentences"],
        metadata={"test": "deduplicated input → clean response"},
    ),
    BenchmarkCase(
        id="rq-10",
        dimension="response_quality",
        messages=["fan vibration 18mm/s"],
        response_checks=["not_empty", "no_raw_json", "min_length_50"],
        metadata={"test": "numeric symptom → substantive reply"},
    ),
]

ALL_CASES: list[BenchmarkCase] = (
    TECHNICAL_CASES
    + CONVERSATIONAL_CASES
    + WO_QUALITY_CASES
    + FSM_CASES
    + RESPONSE_QUALITY_CASES
)

# ---------------------------------------------------------------------------
# Groq LLM judge
# ---------------------------------------------------------------------------

_JUDGE_SEMAPHORE = asyncio.Semaphore(5)


def _groq_headers(api_key: str) -> dict:
    return {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}


def _strip_fences(text: str) -> str:
    text = re.sub(r"^```(?:json)?\s*", "", text.strip())
    return re.sub(r"\s*```$", "", text.strip())


async def _groq_judge(
    api_key: str,
    model: str,
    system: str,
    user: str,
) -> tuple[dict, int]:
    """Call Groq and return (parsed_json, latency_ms). Raises on HTTP error."""
    payload = {
        "model": model,
        "max_tokens": 512,
        "temperature": 0.0,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    }
    t0 = time.monotonic()
    async with _JUDGE_SEMAPHORE:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                GROQ_API_URL,
                json=payload,
                headers=_groq_headers(api_key),
            )
            resp.raise_for_status()
    latency = int((time.monotonic() - t0) * 1000)
    content = resp.json()["choices"][0]["message"]["content"]
    return json.loads(_strip_fences(content)), latency


# ---------------------------------------------------------------------------
# Engine bootstrapping
# ---------------------------------------------------------------------------


def _build_engine():
    from shared.engine import Supervisor

    return Supervisor(
        db_path=os.environ.get("MIRA_DB_PATH", "/tmp/benchmark_mira.db"),
        openwebui_url=os.environ.get("OPENWEBUI_BASE_URL", "http://mira-core:8080"),
        api_key=os.environ.get("OPENWEBUI_API_KEY", ""),
        collection_id=os.environ.get(
            "KNOWLEDGE_COLLECTION_ID", "dd9004b9-3af2-4751-9993-3307e478e9a3"
        ),
        vision_model=os.environ.get("VISION_MODEL", "qwen2.5vl:7b"),
        tenant_id=os.environ.get("MIRA_TENANT_ID", ""),
        mcp_base_url=os.environ.get("MCP_BASE_URL", "http://mira-mcp-saas:8001"),
        mcp_api_key=os.environ.get("MCP_REST_API_KEY", ""),
    )


# ---------------------------------------------------------------------------
# Per-dimension scorers
# ---------------------------------------------------------------------------


async def _score_technical(case: BenchmarkCase, api_key: str, model: str) -> CaseResult:
    """Single-turn: drive engine, judge technical accuracy 0–100."""
    chat_id = f"bench-{case.id}-{uuid.uuid4().hex[:6]}"
    engine = _build_engine()

    turns = []
    reply = ""
    t0 = time.monotonic()
    try:
        result = await asyncio.wait_for(
            engine.process_full(chat_id, case.messages[0]), timeout=MSG_TIMEOUT
        )
        reply = result["reply"]
        turns.append({"user": case.messages[0], "bot": reply})
    except Exception as exc:
        return CaseResult(
            case_id=case.id,
            dimension="technical",
            score=0.0,
            latency_ms=int((time.monotonic() - t0) * 1000),
            error=str(exc),
            turns=turns,
        )
    engine_ms = int((time.monotonic() - t0) * 1000)

    if not api_key:
        return CaseResult(
            case_id=case.id, dimension="technical", score=0.5, latency_ms=engine_ms, turns=turns,
            reasoning="Groq judge disabled — neutral score",
        )

    system_prompt = (
        "You are an industrial maintenance expert judging the quality of an AI assistant's answer. "
        "Score from 0 to 100. Return ONLY valid JSON: "
        '{"score": <int 0-100>, "reasoning": "<one sentence>"}'
    )
    user_prompt = (
        f"Question: {case.messages[0]}\n"
        f"Context: {case.metadata}\n\n"
        f"Answer given:\n{reply}\n\n"
        "Score criteria:\n"
        "90-100: Correct terminology, actionable steps, safety awareness where needed\n"
        "70-89: Mostly correct, minor gaps in specificity\n"
        "50-69: Partially correct, missing key steps or uses wrong terms\n"
        "0-49: Incorrect, vague, or fabricated information"
    )

    try:
        parsed, judge_ms = await _groq_judge(api_key, model, system_prompt, user_prompt)
        score = max(0.0, min(100.0, float(parsed.get("score", 0)))) / 100.0
        reasoning = parsed.get("reasoning", "")
    except Exception as exc:
        score = 0.5
        reasoning = f"Judge error: {exc}"
        judge_ms = 0

    return CaseResult(
        case_id=case.id,
        dimension="technical",
        score=score,
        latency_ms=engine_ms + judge_ms,
        reasoning=reasoning,
        turns=turns,
    )


async def _score_conversational(case: BenchmarkCase, api_key: str, model: str) -> CaseResult:
    """Multi-turn: drive engine, judge conversation quality 0–100."""
    chat_id = f"bench-{case.id}-{uuid.uuid4().hex[:6]}"
    engine = _build_engine()

    turns = []
    t0 = time.monotonic()
    try:
        for msg in case.messages:
            result = await asyncio.wait_for(
                engine.process_full(chat_id, msg), timeout=MSG_TIMEOUT
            )
            turns.append({"user": msg, "bot": result["reply"]})
    except Exception as exc:
        return CaseResult(
            case_id=case.id,
            dimension="conversational",
            score=0.0,
            latency_ms=int((time.monotonic() - t0) * 1000),
            error=str(exc),
            turns=turns,
        )
    engine_ms = int((time.monotonic() - t0) * 1000)

    if not api_key:
        return CaseResult(
            case_id=case.id, dimension="conversational", score=0.5, latency_ms=engine_ms, turns=turns,
            reasoning="Groq judge disabled — neutral score",
        )

    transcript = "\n".join(
        f"[USER]: {t['user']}\n[BOT]: {t['bot']}" for t in turns
    )
    system_prompt = (
        "You are evaluating an industrial maintenance AI chatbot for conversational quality. "
        "Score from 0 to 100. Return ONLY valid JSON: "
        '{"score": <int 0-100>, "reasoning": "<one sentence>"}'
    )
    user_prompt = (
        f"Test: {case.metadata.get('test', '')}\n\n"
        f"Conversation:\n{transcript}\n\n"
        "Score criteria:\n"
        "90-100: Fluent, context retained, questions asked are relevant, helpful throughout\n"
        "70-89: Mostly good, minor context loss or slightly off-topic\n"
        "50-69: Awkward flow or ignored prior context\n"
        "0-49: Incoherent, repeated itself, or failed to help"
    )

    try:
        parsed, judge_ms = await _groq_judge(api_key, model, system_prompt, user_prompt)
        score = max(0.0, min(100.0, float(parsed.get("score", 0)))) / 100.0
        reasoning = parsed.get("reasoning", "")
    except Exception as exc:
        score = 0.5
        reasoning = f"Judge error: {exc}"
        judge_ms = 0

    return CaseResult(
        case_id=case.id,
        dimension="conversational",
        score=score,
        latency_ms=engine_ms + judge_ms,
        reasoning=reasoning,
        turns=turns,
    )


async def _score_wo_quality(case: BenchmarkCase, api_key: str, model: str) -> CaseResult:
    """Multi-turn: drive engine through WO creation, judge WO completeness 0–100."""
    chat_id = f"bench-{case.id}-{uuid.uuid4().hex[:6]}"
    engine = _build_engine()

    turns = []
    t0 = time.monotonic()
    try:
        for msg in case.messages:
            result = await asyncio.wait_for(
                engine.process_full(chat_id, msg), timeout=MSG_TIMEOUT
            )
            turns.append({"user": msg, "bot": result["reply"]})
    except Exception as exc:
        return CaseResult(
            case_id=case.id,
            dimension="wo_quality",
            score=0.0,
            latency_ms=int((time.monotonic() - t0) * 1000),
            error=str(exc),
            turns=turns,
        )
    engine_ms = int((time.monotonic() - t0) * 1000)

    if not api_key:
        return CaseResult(
            case_id=case.id, dimension="wo_quality", score=0.5, latency_ms=engine_ms, turns=turns,
            reasoning="Groq judge disabled — neutral score",
        )

    transcript = "\n".join(
        f"[USER]: {t['user']}\n[BOT]: {t['bot']}" for t in turns
    )
    expected = case.metadata.get("expected_fields", [])
    system_prompt = (
        "You are evaluating a work order created by an industrial maintenance AI. "
        "Score from 0 to 100. Return ONLY valid JSON: "
        '{"score": <int 0-100>, "reasoning": "<one sentence>"}'
    )
    user_prompt = (
        f"Expected WO fields/content: {expected}\n\n"
        f"Conversation:\n{transcript}\n\n"
        "Score criteria:\n"
        "90-100: WO confirmed, asset identified, description captures fault clearly, priority appropriate\n"
        "70-89: WO created but minor gaps (vague description or missing asset)\n"
        "50-69: WO mentioned but not confirmed, or asset/description missing\n"
        "0-49: No WO created when expected, or wrong data captured\n"
        "Note: if test metadata says 'user declines WO', score 90+ if bot provides diagnosis instead."
    )

    try:
        parsed, judge_ms = await _groq_judge(api_key, model, system_prompt, user_prompt)
        score = max(0.0, min(100.0, float(parsed.get("score", 0)))) / 100.0
        reasoning = parsed.get("reasoning", "")
    except Exception as exc:
        score = 0.5
        reasoning = f"Judge error: {exc}"
        judge_ms = 0

    return CaseResult(
        case_id=case.id,
        dimension="wo_quality",
        score=score,
        latency_ms=engine_ms + judge_ms,
        reasoning=reasoning,
        turns=turns,
    )


async def _score_fsm(case: BenchmarkCase) -> CaseResult:
    """Drive engine through all messages and verify final FSM state programmatically."""
    chat_id = f"bench-{case.id}-{uuid.uuid4().hex[:6]}"
    engine = _build_engine()

    turns = []
    last_state = "idle"
    t0 = time.monotonic()
    try:
        for i, msg in enumerate(case.messages):
            result = await asyncio.wait_for(
                engine.process_full(chat_id, msg), timeout=MSG_TIMEOUT
            )
            last_state = result.get("next_state", "")
            turns.append({"user": msg, "bot": result["reply"], "state": last_state})

            # Check intermediate states if specified
            if case.expected_states and i < len(case.expected_states):
                expected = case.expected_states[i]
                if last_state != expected:
                    latency = int((time.monotonic() - t0) * 1000)
                    return CaseResult(
                        case_id=case.id,
                        dimension="fsm",
                        score=0.0,
                        latency_ms=latency,
                        reasoning=f"Turn {i+1}: expected state '{expected}' got '{last_state}'",
                        turns=turns,
                    )
    except Exception as exc:
        return CaseResult(
            case_id=case.id,
            dimension="fsm",
            score=0.0,
            latency_ms=int((time.monotonic() - t0) * 1000),
            error=str(exc),
            turns=turns,
        )

    latency = int((time.monotonic() - t0) * 1000)

    # Check final state
    if case.expected_final_state and last_state != case.expected_final_state:
        return CaseResult(
            case_id=case.id,
            dimension="fsm",
            score=0.0,
            latency_ms=latency,
            reasoning=f"Final state: expected '{case.expected_final_state}' got '{last_state}'",
            turns=turns,
        )

    return CaseResult(
        case_id=case.id,
        dimension="fsm",
        score=1.0,
        latency_ms=latency,
        reasoning=f"FSM correct — final state '{last_state}'",
        turns=turns,
    )


async def _score_response_quality(case: BenchmarkCase) -> CaseResult:
    """Drive engine, then run programmatic checks on the final reply."""
    chat_id = f"bench-{case.id}-{uuid.uuid4().hex[:6]}"
    engine = _build_engine()

    turns = []
    reply = ""
    t0 = time.monotonic()
    try:
        for msg in case.messages:
            result = await asyncio.wait_for(
                engine.process_full(chat_id, msg), timeout=MSG_TIMEOUT
            )
            reply = result["reply"]
            turns.append({"user": msg, "bot": reply})
    except Exception as exc:
        return CaseResult(
            case_id=case.id,
            dimension="response_quality",
            score=0.0,
            latency_ms=int((time.monotonic() - t0) * 1000),
            error=str(exc),
            turns=turns,
        )
    latency = int((time.monotonic() - t0) * 1000)

    checks = case.response_checks or []
    passed: list[str] = []
    failed: list[str] = []

    for check in checks:
        if check == "not_empty":
            (passed if reply.strip() else failed).append(check)
        elif check == "max_length_2000":
            (passed if len(reply) <= 2000 else failed).append(check)
        elif check == "max_length_500":
            (passed if len(reply) <= 500 else failed).append(check)
        elif check == "min_length_30":
            (passed if len(reply) >= 30 else failed).append(check)
        elif check == "min_length_50":
            (passed if len(reply) >= 50 else failed).append(check)
        elif check == "no_raw_json":
            (failed if re.search(r'\{["\w]+:', reply) and len(reply) < 200 else passed).append(check)
        elif check == "no_stack_trace":
            (failed if "Traceback" in reply or "File \"/app/" in reply else passed).append(check)
        elif check == "no_apology_cant_help":
            lowered = reply.lower()
            cant = "i cannot" in lowered or "i can't help" in lowered or "i'm unable" in lowered
            (failed if cant else passed).append(check)
        elif check == "no_repeated_sentences":
            sentences = [s.strip() for s in reply.split(".") if len(s.strip()) > 20]
            has_dup = len(sentences) != len(set(sentences))
            (failed if has_dup else passed).append(check)
        elif check == "contains_safety_word":
            safety_words = ["loto", "lockout", "de-energize", "ppe", "hazard", "arc flash", "safe", "danger", "warning"]
            found = any(w in reply.lower() for w in safety_words)
            (passed if found else failed).append(check)
        else:
            passed.append(check)  # unknown check — don't penalize

    score = len(passed) / len(checks) if checks else 1.0
    return CaseResult(
        case_id=case.id,
        dimension="response_quality",
        score=score,
        latency_ms=latency,
        reasoning=f"{len(passed)}/{len(checks)} checks passed",
        turns=turns,
        passed_checks=passed,
        failed_checks=failed,
    )


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------


async def _run_case(
    case: BenchmarkCase, api_key: str, model: str
) -> CaseResult:
    d = case.dimension
    if d == "technical":
        return await _score_technical(case, api_key, model)
    elif d == "conversational":
        return await _score_conversational(case, api_key, model)
    elif d == "wo_quality":
        return await _score_wo_quality(case, api_key, model)
    elif d == "fsm":
        return await _score_fsm(case)
    elif d == "response_quality":
        return await _score_response_quality(case)
    else:
        return CaseResult(case_id=case.id, dimension=d, score=0.0, latency_ms=0, error=f"Unknown dimension {d}")


async def run_benchmark(version: str, cases: list[BenchmarkCase] | None = None) -> BenchmarkRun:
    api_key = os.getenv("GROQ_API_KEY", "")
    model = os.getenv("GROQ_JUDGE_MODEL", "llama-3.3-70b-versatile")
    target_cases = cases or ALL_CASES
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")

    run = BenchmarkRun(
        version=version,
        timestamp=ts,
        groq_model=model if api_key else "disabled",
        total_cases=len(target_cases),
    )

    print(f"\n{'='*60}")
    print(f"MIRA Benchmark Suite v{version}")
    print(f"Cases: {len(target_cases)} | Judge: {'Groq ' + model if api_key else 'DISABLED (neutral scores)'}")
    print(f"{'='*60}\n")

    # Group by dimension for ordered output
    by_dim: dict[str, list[BenchmarkCase]] = {}
    for c in target_cases:
        by_dim.setdefault(c.dimension, []).append(c)

    dim_order = ["technical", "conversational", "wo_quality", "fsm", "response_quality"]
    results: list[CaseResult] = []

    for dim in dim_order:
        dim_cases = by_dim.get(dim, [])
        if not dim_cases:
            continue
        print(f"  [{dim.upper()}] {len(dim_cases)} cases", end="", flush=True)

        # Run all cases in this dimension concurrently
        dim_tasks = [_run_case(c, api_key, model) for c in dim_cases]
        dim_results = await asyncio.gather(*dim_tasks)
        results.extend(dim_results)

        scores = [r.score for r in dim_results]
        avg = sum(scores) / len(scores) if scores else 0.0
        errors = sum(1 for r in dim_results if r.error)
        print(f"  →  avg {avg*100:.1f}%  ({errors} errors)")

    run.case_results = results

    # Compute dimension averages
    dim_totals: dict[str, list[float]] = {}
    for r in results:
        dim_totals.setdefault(r.dimension, []).append(r.score)

    for dim, scores_list in dim_totals.items():
        run.dimension_scores[dim] = round(sum(scores_list) / len(scores_list) * 100, 1)
        run.dimension_case_counts[dim] = len(scores_list)

    # Overall weighted score
    overall = 0.0
    for dim, weight in WEIGHTS.items():
        if dim in run.dimension_scores:
            overall += (run.dimension_scores[dim] / 100.0) * weight

    run.overall_score = round(overall * 100, 1)
    run.passed_cases = sum(1 for r in results if r.score >= 0.7)
    run.total_ms = sum(r.latency_ms for r in results)

    if run.overall_score >= 90:
        run.grade = "A"
    elif run.overall_score >= 80:
        run.grade = "B"
    elif run.overall_score >= 70:
        run.grade = "C"
    elif run.overall_score >= 60:
        run.grade = "D"
    else:
        run.grade = "F"

    return run


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------

DIM_LABELS = {
    "technical": "Technical Accuracy  (30%)",
    "conversational": "Conversational      (25%)",
    "wo_quality": "WO Quality          (20%)",
    "fsm": "FSM Behavior        (15%)",
    "response_quality": "Response Quality    (10%)",
}


def print_report(run: BenchmarkRun) -> None:
    bar_width = 30
    print(f"\n{'='*60}")
    print(f"  MIRA Quality Benchmark  v{run.version}  |  {run.timestamp}")
    print(f"{'='*60}")
    print(f"\n  {'DIMENSION':<28} {'SCORE':>6}  {'BAR'}")
    print(f"  {'-'*54}")

    dim_order = ["technical", "conversational", "wo_quality", "fsm", "response_quality"]
    for dim in dim_order:
        if dim not in run.dimension_scores:
            continue
        score = run.dimension_scores[dim]
        filled = int(bar_width * score / 100)
        bar = "█" * filled + "░" * (bar_width - filled)
        label = DIM_LABELS.get(dim, dim)
        print(f"  {label:<28} {score:>5.1f}%  {bar}")

    print(f"  {'-'*54}")
    overall_filled = int(bar_width * run.overall_score / 100)
    overall_bar = "█" * overall_filled + "░" * (bar_width - overall_filled)
    print(f"  {'OVERALL SCORE':<28} {run.overall_score:>5.1f}%  {overall_bar}  [{run.grade}]")
    print(f"\n  Cases: {run.passed_cases}/{run.total_cases} passed (≥70%)  |  "
          f"Total time: {run.total_ms/1000:.1f}s  |  Judge: {run.groq_model}")

    # Low-score callouts
    failures = [r for r in run.case_results if r.score < 0.5]
    if failures:
        print(f"\n  ⚠  LOW SCORES ({len(failures)} cases below 50%):")
        for r in sorted(failures, key=lambda x: x.score)[:10]:
            err = f"  [{r.error[:60]}]" if r.error else ""
            print(f"    {r.case_id:<12} {r.score*100:>4.0f}%  {r.reasoning[:60]}{err}")

    print(f"\n{'='*60}\n")


def save_results(run: BenchmarkRun, output_dir: Path | None = None) -> Path:
    out_dir = output_dir or _RESULTS_DIR
    out_dir.mkdir(parents=True, exist_ok=True)
    fname = f"v{run.version}_{run.timestamp}.json"
    out_path = out_dir / fname

    data = asdict(run)
    out_path.write_text(json.dumps(data, indent=2))
    return out_path


# ---------------------------------------------------------------------------
# Compare
# ---------------------------------------------------------------------------


def compare_runs(path_a: str, path_b: str) -> None:
    data_a = json.loads(Path(path_a).read_text())
    data_b = json.loads(Path(path_b).read_text())

    print(f"\n{'='*60}")
    print(f"  MIRA Benchmark Comparison")
    print(f"  A: v{data_a['version']}  ({data_a['timestamp']})")
    print(f"  B: v{data_b['version']}  ({data_b['timestamp']})")
    print(f"{'='*60}")

    dim_order = ["technical", "conversational", "wo_quality", "fsm", "response_quality"]
    print(f"\n  {'DIMENSION':<28} {'A':>6}  {'B':>6}  {'DELTA':>7}")
    print(f"  {'-'*52}")

    for dim in dim_order:
        sa = data_a.get("dimension_scores", {}).get(dim)
        sb = data_b.get("dimension_scores", {}).get(dim)
        if sa is None or sb is None:
            continue
        delta = sb - sa
        arrow = "▲" if delta > 0 else ("▼" if delta < 0 else "─")
        label = DIM_LABELS.get(dim, dim)
        print(f"  {label:<28} {sa:>5.1f}%  {sb:>5.1f}%  {arrow}{abs(delta):>5.1f}%")

    oa = data_a.get("overall_score", 0)
    ob = data_b.get("overall_score", 0)
    od = ob - oa
    print(f"  {'-'*52}")
    arrow = "▲" if od > 0 else ("▼" if od < 0 else "─")
    print(f"  {'OVERALL':<28} {oa:>5.1f}%  {ob:>5.1f}%  {arrow}{abs(od):>5.1f}%  "
          f"[{data_a['grade']}→{data_b['grade']}]")
    print(f"\n{'='*60}\n")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="MIRA Benchmark Suite")
    parser.add_argument("--version", default="dev", help="Version label for this run (e.g. 1.0.0)")
    parser.add_argument("--compare", nargs=2, metavar=("FILE_A", "FILE_B"),
                        help="Compare two result JSON files")
    parser.add_argument("--dimension", choices=list(WEIGHTS.keys()),
                        help="Run only one dimension")
    parser.add_argument("--output-dir", default=None,
                        help="Directory to save results JSON (default: benchmarks/results/)")
    parser.add_argument("--no-save", action="store_true",
                        help="Skip saving results to disk")
    return parser.parse_args()


async def _main() -> None:
    args = _parse_args()

    if args.compare:
        compare_runs(args.compare[0], args.compare[1])
        return

    cases: list[BenchmarkCase] | None = None
    if args.dimension:
        cases = [c for c in ALL_CASES if c.dimension == args.dimension]
        print(f"Running {len(cases)} cases for dimension: {args.dimension}")

    run = await run_benchmark(args.version, cases)
    print_report(run)

    if not args.no_save:
        out_dir = Path(args.output_dir) if args.output_dir else None
        out_path = save_results(run, out_dir)
        print(f"Results saved → {out_path}")

    # Exit non-zero if grade is F
    if run.grade == "F":
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(_main())
