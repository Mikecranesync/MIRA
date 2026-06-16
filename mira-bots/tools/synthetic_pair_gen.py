"""synthetic_pair_gen.py — Synthetic preference pair + eval fixture generator.

Generates (scenario, good_response, bad_response) triples covering every FSM state ×
industrial domain. Outputs:
  - Eval fixtures  → tests/eval/fixtures/synthetic/NN_domain_state.yaml
  - DPO JSONL      → data/dpo_pairs/YYYY-MM-DD.jsonl

Usage:
    python synthetic_pair_gen.py \\
        --domains vfd motor pump plc sensor safety \\
        --states Q1 Q2 DIAGNOSIS SAFETY_ALERT \\
        --fixture-dir tests/eval/fixtures/synthetic \\
        --dpo-dir data/dpo_pairs

Environment:
    ANTHROPIC_API_KEY   Required — used to generate all pairs
    CLAUDE_MODEL        Override (default: claude-sonnet-4-6)
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import httpx
import yaml

logger = logging.getLogger("mira-synth")

_ANTHROPIC_API = "https://api.anthropic.com/v1/messages"
_DEFAULT_MODEL = "claude-sonnet-4-6"

# ── Domain × state matrix ─────────────────────────────────────────────────────

ALL_DOMAINS = ["vfd", "motor", "pump", "plc", "sensor", "safety"]

# FSM states for which scenarios make sense (IDLE and RESOLVED are endpoints)
ALL_STATES = ["Q1", "Q2", "Q3", "DIAGNOSIS", "FIX_STEP", "SAFETY_ALERT"]

# Domain-specific vocab injected into prompts to ground generation
_DOMAIN_CONTEXT = {
    "vfd": "Variable frequency drive (VFD/inverter). Brands: AutomationDirect GS10/GS20, "
    "Yaskawa V1000, Siemens G120, ABB ACS880. Common faults: OC (overcurrent), "
    "OV (overvoltage), UV (undervoltage), E7 (CPU), F004.",
    "motor": "AC induction motor. Parameters: HP, voltage, FLA, insulation class. "
    "Tests: megger (insulation resistance), winding resistance, amp draw. "
    "Common faults: winding failure, bearing seizure, thermal overload.",
    "pump": "Centrifugal or positive-displacement pump. Components: impeller, mechanical seal, "
    "bearing, coupling. Common faults: cavitation, seal leak, no prime, bearing failure.",
    "plc": "Programmable logic controller. Brands: Allen-Bradley MicroLogix/CompactLogix, "
    "Siemens S7-300/1200, AutomationDirect Do-more. Common issues: I/O module fault, "
    "communication error, program fault, power supply failure.",
    "sensor": "Industrial sensor. Types: proximity (inductive/capacitive), photoelectric, "
    "pressure transducer, thermocouple, encoder. Common faults: wiring open, "
    "voltage mismatch, incorrect setpoint, debris on face.",
    "safety": "Industrial safety scenario involving electrical hazards. LOTO (Lockout/Tagout), "
    "arc flash, energized conductors, MCC work. MIRA must issue STOP immediately.",
}

# State-specific behavior summary for the generator
_STATE_BEHAVIOR = {
    "Q1": "First diagnostic question after equipment is identified. Ask exactly ONE question with "
    "2-4 numbered options. Target: narrow from zero info to one diagnostic branch. "
    "confidence=LOW (no code/cause confirmed yet).",
    "Q2": "Second question — asset known, narrowing cause. Reflect their Q1 answer in one clause, "
    "then ONE next question. confidence=MEDIUM.",
    "Q3": "Third question — cause narrowed, confirming specific component or parameter. "
    "confidence=MEDIUM.",
    "DIAGNOSIS": "Cause identified. Lead with the fault meaning (Rule 1). Cite source if "
    "documentation matches. Give ONE action step starting with a verb. "
    "confidence=HIGH. options=[].",
    "FIX_STEP": "Repair in progress. Give exactly ONE concrete action step. Confirm when done "
    "before giving the next. confidence=HIGH. options=[].",
    "SAFETY_ALERT": "Live hazard detected. FIRST WORD must be STOP. Name the hazard. "
    "Give de-energize action. NO diagnostic questions. next_state=SAFETY_ALERT.",
}


# ── Data structures ───────────────────────────────────────────────────────────


@dataclass
class ScenarioPair:
    domain: str
    fsm_state: str
    scenario_text: str  # The tech's message(s) that lead to this state
    good_response: str  # Ideal MIRA JSON response (str — the raw JSON)
    bad_responses: list[str]  # 3 bad variant strings


@dataclass
class SynthResult:
    pairs: list[ScenarioPair] = field(default_factory=list)
    fixture_count: int = 0
    dpo_count: int = 0
    errors: int = 0


# ── System prompts ────────────────────────────────────────────────────────────

_GEN_SYSTEM = """\
You are a scenario generator for MIRA, an industrial maintenance diagnostic assistant.
Your job is to produce realistic training data in exact JSON format.

MIRA response format (always exactly this structure):
{"next_state": "<STATE>", "reply": "<text ≤30 words except DIAGNOSIS/SAFETY>", "options": ["1. ...", "2. ..."], "confidence": "HIGH|MEDIUM|LOW"}

Valid next_state values: Q1, Q2, Q3, DIAGNOSIS, FIX_STEP, RESOLVED, SAFETY_ALERT

MIRA rules summary:
- ONE question per turn, 2-4 numbered options (or [] for DIAGNOSIS/FIX_STEP/SAFETY_ALERT)
- ≤30 words total for Q1/Q2/Q3/FIX_STEP; DIAGNOSIS may be longer if citing a source
- DIAGNOSIS must cite source: [Source: Manufacturer Model, Section]
- SAFETY_ALERT: first word STOP, name hazard, give de-energize action, no questions
- confidence: HIGH=doc match confirmed, MEDIUM=likely cause, LOW=insufficient info
- Peer tone: direct, no "Great question!", no "Certainly!"

Return ONLY valid JSON — no commentary outside the JSON block:
{
  "scenario": "<2-4 sentences describing the context that leads to this diagnostic state>",
  "tech_messages": ["<first tech message>", "<optional follow-up message>"],
  "good_response": "<ideal MIRA JSON string>",
  "bad_responses": {
    "too_verbose": "<MIRA JSON string — exceeds 30 words, hedges, over-explains>",
    "invents_data": "<MIRA JSON string — cites a fault code or part number not given by tech>",
    "wrong_state": "<MIRA JSON string — uses wrong next_state for this situation>"
  },
  "why_good": "<one sentence explaining what makes the good response correct>"
}"""

_GEN_USER = """\
Domain: {domain}
Domain context: {domain_context}
Target FSM state: {fsm_state}
State behavior: {state_behavior}

Generate one realistic scenario where MIRA should produce a {fsm_state} response.
The tech's messages must be authentic — use abbreviations for senior techs (OC, FLA, VFD),
full sentences for junior techs. At least one scenario per 6 should involve a junior tech."""


# ── Core generator ────────────────────────────────────────────────────────────


class SyntheticPairGen:
    def __init__(self, api_key: str, model: str = _DEFAULT_MODEL) -> None:
        self.api_key = api_key
        self.model = model

    async def _call_claude(self, user: str) -> dict | None:
        try:
            async with httpx.AsyncClient(timeout=90) as client:
                resp = await client.post(
                    _ANTHROPIC_API,
                    headers={
                        "x-api-key": self.api_key,
                        "anthropic-version": "2023-06-01",
                        "anthropic-beta": "prompt-caching-2024-07-31",
                        "content-type": "application/json",
                    },
                    json={
                        "model": self.model,
                        "max_tokens": 2048,
                        "system": [
                            {
                                "type": "text",
                                "text": _GEN_SYSTEM,
                                "cache_control": {"type": "ephemeral"},
                            },
                        ],
                        "messages": [{"role": "user", "content": user}],
                    },
                )
                resp.raise_for_status()
                text = resp.json()["content"][0]["text"].strip()
                text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.DOTALL)
                return json.loads(text)
        except httpx.HTTPStatusError as e:
            logger.error("Claude HTTP %s: %s", e.response.status_code, e.response.text[:200])
        except json.JSONDecodeError as e:
            logger.error("Claude returned non-JSON: %s", e)
        except Exception as e:
            logger.error("Claude call failed: %s", e)
        return None

    async def generate_scenario(self, domain: str, fsm_state: str) -> ScenarioPair | None:
        """Generate one (scenario, good, 3×bad) pair for domain×state."""
        user = _GEN_USER.format(
            domain=domain,
            domain_context=_DOMAIN_CONTEXT.get(domain, domain),
            fsm_state=fsm_state,
            state_behavior=_STATE_BEHAVIOR.get(fsm_state, fsm_state),
        )
        result = await self._call_claude(user)
        if not result:
            return None

        bad = result.get("bad_responses", {})
        bad_list = [
            bad.get("too_verbose", ""),
            bad.get("invents_data", ""),
            bad.get("wrong_state", ""),
        ]
        return ScenarioPair(
            domain=domain,
            fsm_state=fsm_state,
            scenario_text=result.get("scenario", ""),
            good_response=result.get("good_response", ""),
            bad_responses=[b for b in bad_list if b],
        )

    async def run_batch(
        self,
        domains: list[str],
        states: list[str],
        concurrency: int = 5,
    ) -> SynthResult:
        """Generate all domain×state pairs with bounded concurrency."""
        result = SynthResult()
        sem = asyncio.Semaphore(concurrency)
        tasks = [(d, s) for d in domains for s in states]

        async def _bounded(domain: str, state: str) -> ScenarioPair | None:
            async with sem:
                pair = await self.generate_scenario(domain, state)
                if pair:
                    logger.info(
                        "Generated %s×%s (%d bad variants)", domain, state, len(pair.bad_responses)
                    )
                else:
                    logger.warning("Failed to generate %s×%s", domain, state)
                    result.errors += 1
                return pair

        pairs = await asyncio.gather(*[_bounded(d, s) for d, s in tasks])
        result.pairs = [p for p in pairs if p is not None]
        return result


# ── Output writers ────────────────────────────────────────────────────────────


def write_eval_fixtures(pairs: list[ScenarioPair], fixture_dir: str | Path) -> int:
    """Write one YAML fixture per (domain, state) pair. Returns count written."""
    out = Path(fixture_dir)
    out.mkdir(parents=True, exist_ok=True)

    # Find highest existing index in the directory
    existing = list(out.glob("*.yaml"))
    existing_nums = []
    for f in existing:
        m = re.match(r"^(\d+)", f.name)
        if m:
            existing_nums.append(int(m.group(1)))
    next_idx = (max(existing_nums) + 1) if existing_nums else 1

    written = 0
    for pair in pairs:
        fname = f"{next_idx:02d}_{pair.domain}_{pair.fsm_state.lower()}.yaml"
        next_idx += 1

        # Extract tech messages to build fixture turns
        # good_response is a JSON string — parse to get expected_final_state
        expected_state = pair.fsm_state
        try:
            good_json = json.loads(pair.good_response)
            expected_state = good_json.get("next_state", pair.fsm_state)
        except (json.JSONDecodeError, TypeError):
            pass

        fixture = {
            "id": f"synth_{pair.domain}_{pair.fsm_state.lower()}_{next_idx - 1:02d}",
            "description": f"Synthetic: {pair.domain} — {pair.fsm_state} state ({pair.scenario_text[:80]}...)",
            "synthetic": True,
            "auto_generated": True,
            "generated_date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            "expected_final_state": expected_state,
            "max_turns": 6,
            "expected_keywords": [],  # Grader uses state check; keywords populated from good_response
            "wo_expected": False,
            "safety_expected": pair.fsm_state == "SAFETY_ALERT",
            "tags": ["synthetic", pair.domain, pair.fsm_state.lower()],
            "good_response_example": pair.good_response,
            "turns": [{"role": "user", "content": pair.scenario_text}],
        }

        (out / fname).write_text(
            yaml.dump(fixture, default_flow_style=False, allow_unicode=True, sort_keys=False)
        )
        written += 1

    return written


def write_dpo_jsonl(pairs: list[ScenarioPair], output_path: str | Path) -> int:
    """Write DPO preference pairs as JSONL. Returns count written."""
    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)

    written = 0
    with open(out, "w", encoding="utf-8") as f:
        for pair in pairs:
            for bad in pair.bad_responses:
                record = {
                    "domain": pair.domain,
                    "fsm_state": pair.fsm_state,
                    "scenario": pair.scenario_text,
                    "chosen": pair.good_response,
                    "rejected": bad,
                    "generated_at": datetime.now(timezone.utc).isoformat(),
                }
                f.write(json.dumps(record, ensure_ascii=False) + "\n")
                written += 1

    return written


# ── CLI ───────────────────────────────────────────────────────────────────────


async def _main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    parser = argparse.ArgumentParser(description="MIRA synthetic preference pair generator")
    parser.add_argument(
        "--domains",
        nargs="+",
        default=ALL_DOMAINS,
        help=f"Domains to generate (default: {' '.join(ALL_DOMAINS)})",
    )
    parser.add_argument(
        "--states",
        nargs="+",
        default=ALL_STATES,
        help=f"FSM states to generate (default: {' '.join(ALL_STATES)})",
    )
    parser.add_argument(
        "--fixture-dir",
        default="tests/eval/fixtures/synthetic",
        help="Output directory for eval fixture YAMLs",
    )
    parser.add_argument(
        "--dpo-dir",
        default="data/dpo_pairs",
        help="Output directory for DPO JSONL files",
    )
    parser.add_argument(
        "--concurrency",
        type=int,
        default=5,
        help="Max concurrent Claude calls (default: 5)",
    )
    args = parser.parse_args()

    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        logger.error("ANTHROPIC_API_KEY not set")
        return

    model = os.getenv("CLAUDE_MODEL", _DEFAULT_MODEL)
    gen = SyntheticPairGen(api_key=api_key, model=model)

    logger.info(
        "Generating %d×%d=%d scenarios (concurrency=%d)",
        len(args.domains),
        len(args.states),
        len(args.domains) * len(args.states),
        args.concurrency,
    )
    result = await gen.run_batch(args.domains, args.states, concurrency=args.concurrency)
    logger.info("Generated %d pairs (%d errors)", len(result.pairs), result.errors)

    fixture_count = write_eval_fixtures(result.pairs, args.fixture_dir)
    logger.info("Wrote %d fixture YAMLs → %s", fixture_count, args.fixture_dir)

    date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    dpo_path = Path(args.dpo_dir) / f"{date_str}.jsonl"
    dpo_count = write_dpo_jsonl(result.pairs, dpo_path)
    logger.info("Wrote %d DPO pairs → %s", dpo_count, dpo_path)

    print(
        json.dumps(
            {
                "pairs_generated": len(result.pairs),
                "errors": result.errors,
                "fixture_count": fixture_count,
                "dpo_count": dpo_count,
                "fixture_dir": args.fixture_dir,
                "dpo_path": str(dpo_path),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    asyncio.run(_main())
