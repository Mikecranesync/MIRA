"""LLM-judge scorer for the MIRA vs ungrounded-LLM benchmark.

The judge is the same Groq model the engine uses, accessed via the
production InferenceRouter. We rate each answer on six 1-5 dimensions
and ask the judge to emit a strict JSON object.

v2 (2026-05-23) — Phase 2 changes to fix judge bias:

  * Added `factual_accuracy` dimension. This is computed deterministically
    from `expected_answer_components` (each question carries an expected
    fact list in mira_bench_questions.yaml). The score is 5 * (matched /
    total expected). It does NOT depend on the LLM judge — so a
    confidently-wrong-but-well-written answer can't out-score a less
    fluent answer that names the right registers / baud rate / params.

  * Added `fabrication_penalty`. We scan the candidate answer for
    specific technical patterns (Modbus register numbers, baud rates,
    parameter codes, fault codes). For each one that is NOT supported
    by `expected_answer_components` or by the rough manufacturer/family
    we expect, we deduct from the answer's total. This is the
    counterweight to the LLM judge's bias toward confidence: a baseline
    LLM that invents `register 40001 at 19200/E/8/2` for a GS10
    (which the manual says is `0x2000` / `9600/N/8/1`) takes a real hit.

  * `total` now uses an 8-component formula:
      total_raw  = sum(LLM 1-5 scores for 6 dimensions) + factual_accuracy_1to5
      total      = max(0, total_raw - fabrication_penalty)
    Max raw is 7*5 = 35. We report it on /35 to keep the v1 dimensions
    comparable (the LLM-only sum is still /30 and rendered alongside).

Read-only: never writes to NeonDB. Only outbound LLM calls.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import sys
from pathlib import Path
from typing import Any

# Order matters: append (not insert) so stdlib (email/...) wins over
# mira-bots/email/ when httpx pulls urllib.
ROOT = Path(__file__).resolve().parent.parent
sys.path.append(str(ROOT / "mira-bots"))

from shared.inference.router import InferenceRouter  # noqa: E402

logger = logging.getLogger("mira-bench.scorer")

# Six LLM-judged dimensions (unchanged from v1) + the new objective ones.
LLM_DIMENSIONS: list[str] = [
    "correctness",
    "citation_quality",
    "completeness",
    "safety",
    "hallucination_resistance",
    "usefulness",
]

# Backwards-compatible alias — runner imports `DIMENSIONS` for the per-dim
# table. We render the full 7-dim table (LLM 6 + factual_accuracy) +
# fabrication_penalty separately.
DIMENSIONS: list[str] = LLM_DIMENSIONS + ["factual_accuracy"]

MAX_LLM_TOTAL = 5 * len(LLM_DIMENSIONS)  # 30
MAX_TOTAL = 5 * len(DIMENSIONS)  # 35 — LLM 6 + factual_accuracy

JUDGE_SYSTEM = """You are an expert industrial maintenance engineer grading answers about
PLC programming, VFD configuration, and Modbus communications.

You will be shown a maintenance question, a list of expected answer
components (technical facts that ought to appear), and a candidate
answer. Rate the candidate on six 1-5 dimensions, where 5 is best:

  correctness            — Are the technical facts right? (registers, baud
                            rate, parity, wiring, CCW steps.) Penalize
                            wrong facts heavily.
  citation_quality       — Does the answer cite specific manual pages,
                            sections, or document chunks? Vague "see the
                            manual" is 1; per-fact citations is 5.
  completeness           — Does it cover the question's scope (wiring,
                            params, programming, testing, etc.)?
  safety                 — Does it include appropriate safety warnings
                            (de-energize, LOTO, qualified person, DC bus)
                            when the task warrants them? If the task
                            involves wiring / power / drives, missing
                            safety is 1-2.
  hallucination_resistance — When information is missing or uncertain,
                            does the answer admit it instead of making
                            things up? Confidently-wrong facts are 1.
  usefulness             — Could a maintenance tech actually follow this?
                            Concrete, ordered steps with units = high.

Respond with ONLY a strict JSON object:

{
  "correctness": <int 1-5>,
  "citation_quality": <int 1-5>,
  "completeness": <int 1-5>,
  "safety": <int 1-5>,
  "hallucination_resistance": <int 1-5>,
  "usefulness": <int 1-5>,
  "notes": "<2-3 sentence rationale>"
}

No prose outside the JSON object.
"""

_JSON_RE = re.compile(r"\{.*\}", re.DOTALL)


def _extract_json(text: str) -> dict[str, Any] | None:
    if not text:
        return None
    try:
        return json.loads(text)
    except Exception:
        pass
    m = _JSON_RE.search(text)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except Exception:
        return None


def _clamp(v: Any) -> int:
    try:
        i = int(v)
    except Exception:
        return 0
    return max(1, min(5, i))


# ---------------------------------------------------------------------------
# Objective scoring — factual accuracy + fabrication penalty
# ---------------------------------------------------------------------------

_WS = re.compile(r"\s+")


def _norm(s: str) -> str:
    """Lowercase + collapse whitespace + drop punctuation noise."""
    s = s.lower()
    s = re.sub(r"[^\w\s/.\-+]", " ", s)
    s = _WS.sub(" ", s).strip()
    return s


def _component_matches(component: str, answer: str) -> bool:
    """Does this expected component appear in the answer?

    We support a few permissive shapes:

      * exact-substring after normalization (handles "Modbus RTU" vs
        "Modbus-RTU" vs "MODBUS RTU").
      * token-set containment: every token of `component` (length >= 2)
        appears somewhere in the answer. Lets "function code 03" match
        "function code 0x03" or "FC 03 (read holding register)".
      * numeric-with-unit aliases for common Modbus things:
          "9600 baud" ↔ "9600bps", "9600", "baud rate 9600"
          "8 data bits" ↔ "8 bits", "8N1"
          "1 stop bit"  ↔ "8N1"
          "no parity"   ↔ "none parity", "8N1"
    """
    a = _norm(answer)
    c = _norm(component)
    if not c:
        return False
    if c in a:
        return True

    # 8N1 alias handling — covers Q02 ("8 data bits"/"1 stop bit"/"no parity")
    eight_n_one = "8n1" in a or "8-n-1" in a or "8,n,1" in a
    if c in {"8 data bits", "1 stop bit", "no parity"} and eight_n_one:
        return True

    # Token-set containment — "function code 03" → tokens {function, code, 03}
    toks = [t for t in c.split() if len(t) >= 2]
    if toks and all(t in a for t in toks):
        return True

    # Hex / decimal register-number aliases — "0x2000" ↔ "8192" ↔ "register 2000h"
    m = re.fullmatch(r"0x([0-9a-f]+)", c)
    if m:
        dec = str(int(m.group(1), 16))
        if dec in a or m.group(1) in a:
            return True

    return False


def score_factual_accuracy(answer: str, expected_components: list[str]) -> dict[str, Any]:
    """Deterministic factual-accuracy score, no LLM call.

    Returns a dict:
      score_1to5  : 1-5 (1 = nothing matched, 5 = every component matched)
      matched     : list[str] of components matched
      missing     : list[str] of components not found
      ratio       : matched / total
    """
    if not expected_components:
        return {"score_1to5": 0, "matched": [], "missing": [], "ratio": 0.0}
    matched: list[str] = []
    missing: list[str] = []
    for c in expected_components:
        if _component_matches(c, answer):
            matched.append(c)
        else:
            missing.append(c)
    ratio = len(matched) / len(expected_components)
    # 1 = nothing right, 5 = perfect. Linear band, but anchored at 1 not 0
    # so "scored" still shows up in the per-dim average even on a miss.
    score = 1 + int(round(ratio * 4))
    if ratio == 0:
        score = 1
    return {
        "score_1to5": score,
        "matched": matched,
        "missing": missing,
        "ratio": round(ratio, 3),
    }


# Patterns we use to detect "specific technical claim" in the answer.
# Each pattern returns capture groups we can compare to expected_components.
_REGISTER_RE = re.compile(
    r"(?:register|holding\s*register|coil|addr(?:ess)?)\s*[:=#]?\s*(0x[0-9a-fA-F]+|\d{3,5})",
    re.IGNORECASE,
)
_BAUD_RE = re.compile(r"\b(\d{3,6})\s*(?:bps|baud)\b", re.IGNORECASE)
_PARITY_RE = re.compile(r"\bparity\s*[:=]?\s*(none|no|even|odd)\b", re.IGNORECASE)
_FRAMING_RE = re.compile(r"\b([78])[\s,/-]*([neo])[\s,/-]*([12])\b", re.IGNORECASE)
_FAULT_CODE_RE = re.compile(r"\b([EFA])[\s-]?(\d{2,4})\b")
_HEX_PARAM_RE = re.compile(r"\b(0x[0-9a-fA-F]{3,4})\b")


def _claims_in_answer(answer: str) -> list[tuple[str, str]]:
    """Extract `(kind, value)` claim tuples from a candidate answer.

    `kind` is one of {register, baud, parity, framing, fault, hex_param}.
    `value` is the normalized canonical form.
    """
    claims: list[tuple[str, str]] = []
    for m in _REGISTER_RE.finditer(answer):
        v = m.group(1).lower()
        claims.append(("register", v))
    for m in _BAUD_RE.finditer(answer):
        claims.append(("baud", m.group(1)))
    for m in _PARITY_RE.finditer(answer):
        p = m.group(1).lower()
        claims.append(("parity", "none" if p in {"no", "none"} else p))
    for m in _FRAMING_RE.finditer(answer):
        bits, par, stop = m.group(1), m.group(2).lower(), m.group(3)
        claims.append(("framing", f"{bits}{par}{stop}"))
    for m in _FAULT_CODE_RE.finditer(answer):
        claims.append(("fault", f"{m.group(1).upper()}{m.group(2)}"))
    for m in _HEX_PARAM_RE.finditer(answer):
        claims.append(("hex_param", m.group(1).lower()))
    return claims


def _claim_supported(kind: str, value: str, expected_blob: str) -> bool:
    """Is this claim consistent with the expected-components blob?

    Conservative: we only mark a claim "unsupported" if the expected
    components mention the same KIND of fact (so we have a reference)
    AND this specific value is not present.

    For `baud`: if expected mentions any "<num> baud" / "<num> bps", the
    claim's number must match.

    For `parity`: if expected mentions "no parity" / "even" / "odd",
    the claim's parity must match.

    For `framing` (8N1): if expected mentions 8N1, claim must be 8n1.

    For `register` / `hex_param`: if expected mentions any register number
    (decimal 3-5 digits or 0x…), claim must match one of them.

    For `fault`: GS10/GS11 fault codes are 2-letter mnemonics like OC, OV,
    OL, OH — NOT E001 / F0004 (those are PowerFlex). If expected mentions
    any 2-letter fault code AND the claim is a numeric Exxxx/Fxxxx code,
    that's a fabrication.
    """
    exp = expected_blob.lower()

    if kind == "baud":
        bauds = re.findall(r"\b(\d{3,6})\s*(?:bps|baud)\b", exp)
        if not bauds:
            return True  # no reference — don't penalize
        return value in bauds

    if kind == "parity":
        has_ref = bool(re.search(r"\b(no parity|even parity|odd parity|parity)\b", exp))
        if not has_ref:
            return True
        if value == "none" and ("no parity" in exp or "none" in exp):
            return True
        if value in {"even", "odd"} and value in exp:
            return True
        return False

    if kind == "framing":
        if "8n1" not in exp:
            return True
        return value == "8n1"

    if kind == "register":
        regs_dec = re.findall(r"\b(\d{3,5})\b", exp)
        regs_hex = re.findall(r"\b(0x[0-9a-f]+)\b", exp)
        if not regs_dec and not regs_hex:
            return True
        if value.startswith("0x"):
            try:
                dec = str(int(value, 16))
            except ValueError:
                dec = ""
            return value in regs_hex or dec in regs_dec
        # decimal claim
        if value in regs_dec:
            return True
        try:
            hx = hex(int(value)).lower()
            if hx in regs_hex:
                return True
        except ValueError:
            pass
        return False

    if kind == "hex_param":
        if "0x" not in exp:
            return True
        return value in exp

    if kind == "fault":
        # If the expected fault codes are 2-letter mnemonics (OC, OV, OL,
        # OH, GF), then a 4-digit Exxxx/Fxxxx claim is foreign.
        has_letter_codes = bool(re.search(r"\b(oc|ov|ol|oh|gf|uv)\b", exp))
        if not has_letter_codes:
            return True
        return value.lower() in exp

    return True  # unknown kind — don't penalize


def score_fabrication(answer: str, expected_components: list[str]) -> dict[str, Any]:
    """Penalize specific technical claims the answer can't support.

    Returns:
      penalty  : int, points to subtract from total_raw (capped at 6)
      claims   : list[(kind, value, supported)]
      flagged  : list[str] human-readable explanations
    """
    expected_blob = " ".join(expected_components) if expected_components else ""
    claims = _claims_in_answer(answer)
    flagged: list[str] = []
    unsupported = 0
    seen: set[tuple[str, str]] = set()
    for kind, value in claims:
        if (kind, value) in seen:
            continue
        seen.add((kind, value))
        supported = _claim_supported(kind, value, expected_blob)
        if not supported:
            unsupported += 1
            flagged.append(f"{kind}={value}")
    # 1 point per unsupported specific claim, capped at 6 (so it can't
    # zero a fluent-but-wrong answer below "barely worse than baseline").
    penalty = min(unsupported, 6)
    return {
        "penalty": penalty,
        "n_claims": len(claims),
        "n_unsupported": unsupported,
        "flagged": flagged,
    }


# ---------------------------------------------------------------------------
# LLM judge — six dimensions (unchanged) — wrapped with the objective scores
# ---------------------------------------------------------------------------


async def _llm_judge(
    router: InferenceRouter,
    question: str,
    expected_components: list[str],
    answer: str,
    candidate_label: str,
) -> dict[str, Any]:
    user_msg = (
        f"QUESTION:\n{question}\n\n"
        f"EXPECTED COMPONENTS (facts that ought to appear, partial credit OK):\n"
        + "\n".join(f"- {c}" for c in expected_components)
        + f"\n\nCANDIDATE ({candidate_label}) ANSWER:\n{answer}\n\n"
        "Score the candidate on the six dimensions. Return ONLY the JSON object."
    )
    messages = [
        {"role": "system", "content": JUDGE_SYSTEM},
        {"role": "user", "content": user_msg},
    ]
    content, usage = await router.complete(
        messages, max_tokens=512, session_id=f"bench-judge-{candidate_label}"
    )
    parsed = _extract_json(content)
    if not parsed:
        return {
            "scores": {d: 0 for d in LLM_DIMENSIONS},
            "llm_total": 0,
            "notes": "",
            "error": "judge returned unparseable output",
            "raw": content[:400],
            "provider": usage.get("provider", "?"),
        }
    scores = {d: _clamp(parsed.get(d, 0)) for d in LLM_DIMENSIONS}
    return {
        "scores": scores,
        "llm_total": sum(scores.values()),
        "notes": str(parsed.get("notes", ""))[:600],
        "error": None,
        "provider": usage.get("provider", "?"),
    }


async def score_answer(
    router: InferenceRouter,
    question: str,
    expected_components: list[str],
    answer: str,
    candidate_label: str,
) -> dict[str, Any]:
    """Score one answer.

    Combines:
      * LLM-judged dimensions (correctness, citation_quality, completeness,
        safety, hallucination_resistance, usefulness) — 6 × 1-5.
      * `factual_accuracy` — deterministic, based on expected_components.
      * `fabrication_penalty` — deterministic, deducted from total.

    Returns a dict with:
      scores            : {dim: 1-5 for all 7 dims (LLM 6 + factual_accuracy)}
      llm_total         : sum of the six LLM dims (1-30) — back-compat
      factual           : full factual-accuracy detail dict
      fabrication       : full fabrication-penalty detail dict
      total_raw         : llm_total + factual_accuracy_1to5 (1-35)
      total             : max(0, total_raw - fabrication.penalty)
      notes             : LLM judge rationale
      provider          : which cascade tier scored this
      error             : str or None
    """
    judge_task = _llm_judge(router, question, expected_components, answer, candidate_label)
    # Objective scores run in parallel — they're CPU-only.
    fact = score_factual_accuracy(answer, expected_components)
    fab = score_fabrication(answer, expected_components)
    judge = await judge_task

    scores = dict(judge["scores"])
    scores["factual_accuracy"] = fact["score_1to5"]
    llm_total = judge["llm_total"]
    total_raw = llm_total + fact["score_1to5"]
    total = max(0, total_raw - fab["penalty"])
    return {
        "scores": scores,
        "llm_total": llm_total,
        "factual": fact,
        "fabrication": fab,
        "total_raw": total_raw,
        "total": total,
        "notes": judge.get("notes", ""),
        "error": judge.get("error"),
        "provider": judge.get("provider", "?"),
        # raw judge content if it failed to parse
        "raw": judge.get("raw", ""),
    }


# ---------------------------------------------------------------------------
# Retrieval scoring (unchanged from v1)
# ---------------------------------------------------------------------------


def score_retrieval(retrieved: list[dict], required_docs: list[str]) -> dict[str, Any]:
    """Heuristic scoring of the retrieved chunk set (no LLM call)."""
    if not retrieved:
        return {
            "n_chunks": 0,
            "relevance": 0.0,
            "coverage": 0.0,
            "citation_quality": 0.0,
            "sources": [],
        }
    required_tokens: list[set[str]] = []
    for doc in required_docs:
        toks = {t for t in re.findall(r"[A-Za-z0-9]+", doc.lower()) if len(t) >= 4}
        required_tokens.append(toks)

    hits = 0
    covered: set[int] = set()
    cited = 0
    sources: list[str] = []
    for ch in retrieved:
        body = (ch.get("content") or "").lower()
        any_match = False
        for idx, toks in enumerate(required_tokens):
            if toks and any(tok in body for tok in toks):
                any_match = True
                covered.add(idx)
        if any_match:
            hits += 1
        if ch.get("source_page") or ch.get("source_url") or ch.get("source_type"):
            cited += 1
        src = (
            f"{ch.get('manufacturer') or '?'} / "
            f"{ch.get('model_number') or '?'} / "
            f"p.{ch.get('source_page') or '?'} "
            f"({ch.get('source_type') or '?'})"
        )
        sources.append(src)

    n = len(retrieved)
    return {
        "n_chunks": n,
        "relevance": round(hits / n, 3),
        "coverage": round(len(covered) / max(1, len(required_docs)), 3),
        "citation_quality": round(cited / n, 3),
        "sources": sources,
    }


if __name__ == "__main__":
    # Smoke-test the judge with a synthetic answer.
    async def _main():
        os.environ.setdefault("INFERENCE_BACKEND", "cloud")
        r = InferenceRouter()
        if not r.enabled:
            print("InferenceRouter disabled — set INFERENCE_BACKEND=cloud and API keys")
            return
        out = await score_answer(
            r,
            question="What is the default baud rate of the GS10 serial port?",
            expected_components=["9600 baud", "8 data bits", "no parity", "1 stop bit"],
            answer="The GS10 default baud rate is 9600 with 8N1 framing per the manual.",
            candidate_label="smoke",
        )
        print(json.dumps(out, indent=2))

    asyncio.run(_main())
