"""Per-turn deterministic auto-eval for print-translator replies.

$0, truth-free, fail-open. Runs AFTER a print reply is delivered and grades it
with the SAME primitives the offline lanes use — no LLM judge, no paid calls
(the zero-token-architecture spend law). Live turns have no frozen truth, so
only the truth-free subset applies; tag grounding uses the live photo's own
OCR items as the reference set.

Meta contract (consumed by mira-crawler/tasks/eval_scorer.py when its beat
lands): rows carry ``meta.surface="print_translator"`` + ``meta.autoeval``
(this module's result dict, ``version`` pinned below). ``auto_score`` stays
NULL — a future scorer change may self-label these rows deterministically
instead of LLM-judging them.

Design doc: docs/plans/2026-07-18-print-autoeval-hook.md
"""

from __future__ import annotations

import logging
import os
import time
from collections import deque
from collections.abc import Sequence

from .print_translator import _CAVEAT_MARKERS, _CONTACT_VERDICT_RE

logger = logging.getLogger("mira-print-autoeval")

AUTOEVAL_VERSION = 1

_DETAIL_CAP = 160  # chars — flag details are model-output snippets, keep them short


def enabled() -> bool:
    """Default-ON kill switch. Compose maps ``${PRINT_AUTOEVAL_ENABLED:-}``,
    which delivers an EMPTY STRING in-container — the ``or``-form makes empty
    mean ON; only the literal ``"0"`` (or any other non-"1" value) disables."""
    return (os.getenv("PRINT_AUTOEVAL_ENABLED") or "1") == "1"


def _cap(text: str) -> str:
    return text[:_DETAIL_CAP]


def evaluate_print_turn(
    question: str,
    answer: str,
    vision_data: dict | None,
    usage: dict | None,
    latency_s: float | None,
    *,
    branch: str = "theory",
    interpreter_configured: bool = False,
) -> dict:
    """Grade one delivered print reply. Pure and synchronous (regex/set ops,
    microseconds) — safe on the event loop. Never raises past its own guard.

    ``branch`` is "deterministic_fastpath" or "theory" (which rung answered).
    """
    flags: list[dict] = []
    skipped: list[str] = []
    answer = answer or ""
    low = answer.lower()
    ocr_items = [str(t) for t in ((vision_data or {}).get("ocr_items") or [])]

    grader_available = True
    try:
        from printsense.benchmarks import single_photo_grader as _g
    except Exception:  # noqa: BLE001 — degraded result beats a dead hook
        _g = None
        grader_available = False

    prose_tag_count = 0
    cost = 0.0
    if _g is not None:
        # P0 — the answer asserts a present-tense observed state a print cannot
        # show ("K44 is energized"). Negation-aware: honest "does not show
        # whether…" passes; a contrast after the negator re-arms it.
        m = _g._state_claim_asserted(answer)
        if m:
            flags.append(
                {
                    "class": "unsupported_state_claim",
                    "severity": "P0",
                    "detail": _cap(repr(m.group(0))),
                }
            )

        # P0 — paid spend where the free path was mandatory (spend-law tripwire).
        # Sanctioned paid spend (theory branch with the interpreter configured)
        # is recorded as info via estimated_cost_usd, not flagged.
        cost = float(_g.estimate_cost_usd(usage) or 0.0)
        if cost > 0 and (branch == "deterministic_fastpath" or not interpreter_configured):
            flags.append(
                {
                    "class": "paid_spend_on_free_path",
                    "severity": "P0",
                    "detail": _cap(f"${cost:.4f} via {(usage or {}).get('provider')}"),
                }
            )

        prose_tags = _g.extract_prose_tags(answer)
        prose_tag_count = len(prose_tags)
        if ocr_items:
            # P1 — OCR letter-drift: a tag in the answer one edit away from a
            # tag the vision pass actually read (the -W7301→V7301 class).
            drift = _g.detect_identifier_drift(answer, tuple(ocr_items))
            if drift:
                flags.append(
                    {
                        "class": "ocr_identifier_drift",
                        "severity": "P1",
                        "detail": _cap(
                            "; ".join(f"{d['answer_token']}~{d['truth_token']}" for d in drift[:4])
                        ),
                    }
                )
            # P1 — tag-shaped claims with no grounding in what the vision pass
            # read from THIS photo. Drifted tags are already flagged above —
            # don't double-count them here.
            ocr_blob = " ".join(ocr_items)
            drifted = {d["answer_token"] for d in drift}
            invented = sorted(
                t for t in prose_tags if t not in drifted and t.lstrip("-") not in ocr_blob
            )
            if invented:
                flags.append(
                    {
                        "class": "invented_tags",
                        "severity": "P1",
                        "detail": _cap(", ".join(invented[:6])),
                    }
                )
        else:
            # Live turns can produce 0 OCR items (seen 2026-07-18) — with no
            # reference set every tag would read as "invented". Skip, loudly.
            skipped.extend(["ocr_identifier_drift", "invented_tags"])
    else:
        skipped.extend(
            [
                "unsupported_state_claim",
                "paid_spend_on_free_path",
                "ocr_identifier_drift",
                "invented_tags",
            ]
        )

    # P1 — a contact-convention verdict shipped without any verify/measure
    # language. format_theory_reply appends the caveat deterministically
    # (UNSEEN-4), so this firing means that duty regressed — a tripwire.
    if _CONTACT_VERDICT_RE.search(answer) and not any(c in low for c in _CAVEAT_MARKERS):
        flags.append(
            {
                "class": "missing_caveat",
                "severity": "P1",
                "detail": "contact verdict without verification language",
            }
        )

    refusal = False
    safety_language = False
    if _g is not None:
        refusal = any(mk in low for mk in _g._REFUSAL_MARKERS)
        safety_language = any(mk in low for mk in _g._SAFETY_MARKERS)

    severity = "ok"
    if any(f["severity"] == "P1" for f in flags):
        severity = "P1"
    if any(f["severity"] == "P0" for f in flags):
        severity = "P0"

    return {
        "version": AUTOEVAL_VERSION,
        "branch": branch,
        "severity": severity,
        "flags": flags,
        "skipped": skipped,
        "grader_available": grader_available,
        "refusal": refusal,
        "safety_language": safety_language,
        "prose_tag_count": prose_tag_count,
        "ocr_item_count": len(ocr_items),
        "provider": (usage or {}).get("provider"),
        "model": (usage or {}).get("model"),
        "estimated_cost_usd": cost,
        "latency_s": round(latency_s, 3) if latency_s is not None else None,
    }


def should_alert(result: dict) -> bool:
    return result.get("severity") == "P0"


def format_alert(result: dict) -> str:
    """Push-notification body. No question text, no chat id (ntfy topics can be
    public); details are already snippet-capped. Total stays well under 500
    chars."""
    lines = [
        f"{f['class']}: {f.get('detail', '')}".strip()
        for f in result.get("flags", [])
        if f.get("severity") == "P0"
    ]
    tail = (
        f"branch={result.get('branch')} provider={result.get('provider')}"
        f" cost=${result.get('estimated_cost_usd', 0):.4f}"
        " (best-effort attribution)"
    )
    return "\n".join([*lines, tail])[:500]


class AlertRateLimiter:
    """Flood guard between a regressed check and a kb_cron-style alert storm
    (v3.159.1 lesson). Global cap of ``max_per_hour`` pushes, plus a per-flag-
    class cooldown so repeats of one class collapse to ~1 per window. In-memory,
    stdlib only — a restart resets it, which is fine for an alert limiter."""

    def __init__(self, max_per_hour: int = 5, per_flag_cooldown_s: float = 900.0):
        self.max_per_hour = max_per_hour
        self.per_flag_cooldown_s = per_flag_cooldown_s
        self._sent: deque[float] = deque()
        self._last_by_class: dict[str, float] = {}

    def allow(self, flag_classes: Sequence[str], now: float | None = None) -> bool:
        ts = time.monotonic() if now is None else now
        while self._sent and ts - self._sent[0] > 3600.0:
            self._sent.popleft()
        if len(self._sent) >= self.max_per_hour:
            return False
        fresh = [
            c
            for c in flag_classes
            if ts - self._last_by_class.get(c, -1e12) >= self.per_flag_cooldown_s
        ]
        if not fresh:
            return False
        self._sent.append(ts)
        for c in fresh:
            self._last_by_class[c] = ts
        return True


ALERT_LIMITER = AlertRateLimiter()
