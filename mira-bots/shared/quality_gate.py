"""Runtime response quality gate for the MIRA Telegram bot.

Sits between Supervisor.process_full() and the user-facing return in
Supervisor.process(). Catches garbled output, repetition loops, format
artifacts, and (optionally) low-coherence replies before they reach
the user.

Two stages:

1. Heuristic checks (always on, ~1ms):
   - empty / over-long output
   - non-printable / control character ratio
   - repeated 5-gram detection (cascade-loop signal)
   - repeated long substring detection
   - raw JSON leakage from a failed parse
   - unbalanced markdown code fences

2. LLM-as-judge (off by default, opt in via QUALITY_GATE_JUDGE=1):
   - one Groq llama-3.1-8b-instant call (~250ms) when heuristics pass
   - returns coherence score 0.0-1.0 + brief reason
   - used as a soft signal for telemetry; only fails when score is very low

When the gate fails, the caller substitutes GRACEFUL_FALLBACK and logs
the original reply for offline review. The gate never raises — every
internal failure degrades to "pass" so a buggy gate cannot block the bot.

Constraints honored:
- No LangChain, no Anthropic SDK, no TensorFlow.
- Pure stdlib heuristics. Judge call goes through the existing
  InferenceRouter cascade (Groq → Cerebras → Gemini), so it inherits
  failover and PII sanitization.
- Apache-2.0 / MIT compatible (project hard constraint).
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
from collections import Counter
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Literal

if TYPE_CHECKING:
    from .inference.router import InferenceRouter

logger = logging.getLogger(__name__)

Verdict = Literal["pass", "fail"]


@dataclass
class GateResult:
    """Outcome of a single quality-gate evaluation."""

    verdict: Verdict
    reasons: list[str] = field(default_factory=list)
    elapsed_ms: float = 0.0
    judge_score: float | None = None
    judge_reason: str | None = None


# User-facing fallback when the gate fails. Intentionally generic and
# action-oriented: ask for a rephrase plus a concrete fact.
GRACEFUL_FALLBACK = (
    "Let me think about that differently — could you rephrase your question? "
    "If you have a fault code or equipment model number, that would help me focus."
)


# ---------------------------------------------------------------------------
# Tunables (env-overridable so we can dial without redeploying)
# ---------------------------------------------------------------------------

MIN_REPLY_CHARS = 1
# Telegram caps at 4096; allow some headroom because longer replies are
# split by the adapter, not silently dropped.
MAX_REPLY_CHARS = int(os.getenv("QUALITY_GATE_MAX_CHARS", "8000"))
# Anything above this control-char ratio is almost always garbled output.
MAX_CONTROL_CHAR_RATIO = 0.05
# A 5-gram repeating more than this is a cascade-loop tell.
MAX_NGRAM_REPEAT = 3
NGRAM_SIZE = 5
# A substring of this length appearing more than MAX_SUBSTR_REPEAT times
# is almost always pathological.
SUBSTR_LEN = 30
MAX_SUBSTR_REPEAT = 3
# Skip language / ratio checks below this size — short fallbacks
# ("ok", "no", "1") trip them spuriously.
SHORT_REPLY_CUTOFF = 50
# Below this score the judge says the reply is broken.
JUDGE_FAIL_THRESHOLD = 0.4

# Replacement char + common mojibake markers.
_REPLACEMENT_CHARS = {"�"}

# Allowed control chars: tab, newline, carriage return.
_ALLOWED_CONTROL = {"\t", "\n", "\r"}


# ---------------------------------------------------------------------------
# Heuristics
# ---------------------------------------------------------------------------


def _control_char_ratio(text: str) -> float:
    """Fraction of chars that are non-printable control chars (excluding tab/newline/CR)."""
    if not text:
        return 0.0
    bad = sum(1 for c in text if c not in _ALLOWED_CONTROL and ord(c) < 0x20)
    return bad / len(text)


def _has_repeated_ngram(text: str, n: int = NGRAM_SIZE, max_repeat: int = MAX_NGRAM_REPEAT) -> bool:
    """True if any whitespace-tokenized n-gram repeats more than max_repeat times."""
    tokens = text.split()
    if len(tokens) < n * (max_repeat + 1):
        return False
    grams = [" ".join(tokens[i : i + n]) for i in range(len(tokens) - n + 1)]
    counts = Counter(grams)
    most_common = counts.most_common(1)
    if not most_common:
        return False
    return most_common[0][1] > max_repeat


def _has_repeated_substring(
    text: str, length: int = SUBSTR_LEN, max_repeat: int = MAX_SUBSTR_REPEAT
) -> bool:
    """True if any character substring of given length appears more than max_repeat times."""
    if len(text) < length * (max_repeat + 1):
        return False
    counts: Counter[str] = Counter()
    for i in range(len(text) - length + 1):
        counts[text[i : i + length]] += 1
        if counts[text[i : i + length]] > max_repeat:
            return True
    return False


# Raw JSON leak detector: opening brace + a quoted field name we use in
# the diagnose schema. If we see this, parse_response() failed and the
# raw model envelope reached the user.
_JSON_LEAK_RE = re.compile(
    r'^\s*\{\s*"(?:reply|diagnosis|next_state|options|fault_code)"\s*:',
    re.IGNORECASE,
)


def _has_json_leak(text: str) -> bool:
    return bool(_JSON_LEAK_RE.match(text))


def _has_unbalanced_code_fence(text: str) -> bool:
    """Odd number of triple-backticks → fence didn't close."""
    return text.count("```") % 2 == 1


def _is_mostly_ascii(text: str, threshold: float = 0.85) -> bool:
    """Coarse English-ish check without pulling lingua-py.

    Returns True when the printable text is >= threshold ASCII. This is a
    weak signal — we only use it to flag obviously corrupted output, not
    to enforce English on legitimate non-ASCII (model numbers, ° symbols,
    etc. are well within the threshold).
    """
    if not text:
        return True
    printable = [c for c in text if c.isprintable() or c in _ALLOWED_CONTROL]
    if not printable:
        return False
    ascii_count = sum(1 for c in printable if ord(c) < 128)
    return ascii_count / len(printable) >= threshold


def heuristic_check(text: str) -> tuple[bool, list[str]]:
    """Synchronous heuristic battery. Returns (passed, reasons_failed).

    Order matters — cheapest checks first so we bail early on obvious garbage.
    """
    reasons: list[str] = []

    if text is None or not text.strip():
        return False, ["empty_reply"]

    if len(text) < MIN_REPLY_CHARS:
        reasons.append("too_short")

    if len(text) > MAX_REPLY_CHARS:
        reasons.append(f"too_long_{len(text)}")

    if any(c in text for c in _REPLACEMENT_CHARS):
        reasons.append("replacement_char")

    if _control_char_ratio(text) > MAX_CONTROL_CHAR_RATIO:
        reasons.append("control_char_ratio")

    if _has_json_leak(text):
        reasons.append("raw_json_leak")

    if _has_unbalanced_code_fence(text):
        reasons.append("unbalanced_code_fence")

    if _has_repeated_ngram(text):
        reasons.append("repeated_ngram")

    if _has_repeated_substring(text):
        reasons.append("repeated_substring")

    if len(text) >= SHORT_REPLY_CUTOFF and not _is_mostly_ascii(text):
        reasons.append("non_ascii_majority")

    return (len(reasons) == 0), reasons


# ---------------------------------------------------------------------------
# LLM-as-judge (optional)
# ---------------------------------------------------------------------------

_JUDGE_SYSTEM = (
    "You are a strict QA reviewer for an industrial maintenance assistant. "
    "Score whether the assistant's reply is coherent and on-topic for the user's message. "
    "Respond with ONLY compact JSON: "
    '{"score": <0.0-1.0>, "reason": "<10 words max>"} '
    "where 1.0 is fully coherent + on-topic and 0.0 is gibberish or unrelated. "
    "No prose, no preamble, no markdown."
)


def _judge_user_msg(user_message: str, reply: str) -> str:
    return f"USER: {user_message[:500]}\nREPLY: {reply[:1500]}\nScore the reply."


_JUDGE_JSON_RE = re.compile(r"\{[^{}]*\}", re.DOTALL)


def _parse_judge(raw: str) -> tuple[float | None, str | None]:
    """Extract score + reason from the judge response. Tolerant of stray prose."""
    if not raw:
        return None, None
    match = _JUDGE_JSON_RE.search(raw)
    payload = match.group(0) if match else raw
    try:
        parsed = json.loads(payload)
    except (ValueError, json.JSONDecodeError):
        return None, None
    score = parsed.get("score")
    reason = parsed.get("reason", "")
    if not isinstance(score, (int, float)):
        return None, None
    return max(0.0, min(1.0, float(score))), str(reason)[:120]


async def llm_judge(
    user_message: str,
    reply: str,
    router: "InferenceRouter | None",
    *,
    session_id: str = "quality_gate",
    timeout_s: float = 1.5,
) -> tuple[float | None, str | None]:
    """Single LLM-as-judge pass. Returns (score, reason) or (None, None) on failure.

    Uses the existing InferenceRouter cascade; small max_tokens keeps it cheap.
    Wrapped in its own timeout so a slow judge cannot delay the user.
    """
    if router is None or not getattr(router, "enabled", False):
        return None, None

    messages = [
        {"role": "system", "content": _JUDGE_SYSTEM},
        {"role": "user", "content": _judge_user_msg(user_message, reply)},
    ]

    try:
        raw, _ = await asyncio.wait_for(
            router.complete(messages, max_tokens=60, session_id=session_id),
            timeout=timeout_s,
        )
    except asyncio.TimeoutError:
        logger.warning("QUALITY_GATE_JUDGE_TIMEOUT session=%s", session_id)
        return None, None
    except Exception as exc:  # never let the judge crash the bot
        logger.warning("QUALITY_GATE_JUDGE_ERROR session=%s err=%s", session_id, exc)
        return None, None

    return _parse_judge(raw)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def is_known_fallback(text: str, fallbacks: set[str]) -> bool:
    """Skip gating known-trusted fallback strings (TIMEOUT_WARNING etc.)."""
    return text.strip() in fallbacks


async def evaluate(
    text: str,
    *,
    user_message: str = "",
    router: "InferenceRouter | None" = None,
    use_judge: bool | None = None,
    skip_strings: set[str] | None = None,
) -> GateResult:
    """Run the quality gate against `text`.

    Args:
        text: the user-facing reply produced by the engine.
        user_message: the originating user message (used by the judge).
        router: existing InferenceRouter for the optional judge call.
        use_judge: override env-controlled judge flag.
        skip_strings: trusted fallback strings that bypass gating entirely.

    Returns:
        GateResult — caller decides what to do on `verdict == "fail"`.
    """
    t0 = time.monotonic()

    if skip_strings and is_known_fallback(text, skip_strings):
        return GateResult(
            verdict="pass",
            reasons=["skip_known_fallback"],
            elapsed_ms=(time.monotonic() - t0) * 1000.0,
        )

    passed, reasons = heuristic_check(text)
    if not passed:
        return GateResult(
            verdict="fail",
            reasons=reasons,
            elapsed_ms=(time.monotonic() - t0) * 1000.0,
        )

    if use_judge is None:
        use_judge = os.getenv("QUALITY_GATE_JUDGE", "0") == "1"

    judge_score: float | None = None
    judge_reason: str | None = None
    if use_judge and router is not None:
        judge_score, judge_reason = await llm_judge(user_message, text, router)
        if judge_score is not None and judge_score < JUDGE_FAIL_THRESHOLD:
            return GateResult(
                verdict="fail",
                reasons=[f"judge_score_{judge_score:.2f}"],
                elapsed_ms=(time.monotonic() - t0) * 1000.0,
                judge_score=judge_score,
                judge_reason=judge_reason,
            )

    return GateResult(
        verdict="pass",
        reasons=[],
        elapsed_ms=(time.monotonic() - t0) * 1000.0,
        judge_score=judge_score,
        judge_reason=judge_reason,
    )


def is_enabled() -> bool:
    """Master switch — set QUALITY_GATE_ENABLED=0 to disable at runtime."""
    return os.getenv("QUALITY_GATE_ENABLED", "1") != "0"
