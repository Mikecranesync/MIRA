"""Honest POTD judge-independence classification + strict judge config.

The independent judge grades the interpreter's reading of a print. Its value is
only as good as its *independence*: a judge that is the SAME model as the
interpreter is reviewing itself, and a judge with no recorded identity cannot be
trusted at all. The 2026-07-22 benchmark showed the judge silently unavailable
in-container; this module makes the judge's provider/model identity and
independence explicit and gold-gating.

Config (strict by default):
* ``POTD_JUDGE_PROVIDER`` — the judge transport (default ``free_cascade``: the
  Groq→Cerebras→Together free vision cascade, No-Anthropic/No-OpenAI).
* ``POTD_JUDGE_MODEL`` — the EXPECTED judge model (default empty = cascade-
  selected). When set, the returned model must match it (identity check).
* ``POTD_JUDGE_POLICY`` — ``strict`` (default) never accepts a self-review as an
  independent verdict; a same-model / missing-identity / unavailable judge is
  recorded but **blocks gold**.

The interpreter stays MiniMax-M3 (``together``). The judge PREFERS a different
model — on this account the only serverless vision model on the free cascade is
``google/gemma-3n-E4B-it`` (Together), which is a DIFFERENT model from the
interpreter, so the realistic class is "different model, same provider" (reduced
independence), never self-review.

Pure: identities in, a classification dict out. No I/O, no network.
"""

from __future__ import annotations

import os

# Config env keys (read at call time).
ENV_PROVIDER = "POTD_JUDGE_PROVIDER"
ENV_MODEL = "POTD_JUDGE_MODEL"
ENV_POLICY = "POTD_JUDGE_POLICY"

DEFAULT_PROVIDER = "free_cascade"
DEFAULT_POLICY = "strict"

# Independence values (fine-grained, persisted).
UNAVAILABLE = "unavailable"
UNKNOWN_IDENTITY = "unknown_identity"
SELF_REVIEW = "same_model"
REDUCED_SAME = "reduced_same_cascade"
DIFFERENT = "different_provider_model"

# The three coarse buckets the directive names (requirement 5).
CLASS_DIFFERENT = "different"  # different provider/model
CLASS_REDUCED = "reduced_same"  # reduced same provider/cascade/model
CLASS_UNAVAILABLE = "unavailable"

_CLASS_OF = {
    DIFFERENT: CLASS_DIFFERENT,
    REDUCED_SAME: CLASS_REDUCED,
    SELF_REVIEW: CLASS_REDUCED,
    UNKNOWN_IDENTITY: CLASS_REDUCED,
    UNAVAILABLE: CLASS_UNAVAILABLE,
}

# Independence values that block gold_candidate + automatic promotion (req 6).
_GOLD_BLOCKING = {UNAVAILABLE, UNKNOWN_IDENTITY, SELF_REVIEW}


def judge_config() -> dict:
    """The active strict judge config (call-time env)."""
    return {
        "provider": (os.getenv(ENV_PROVIDER) or DEFAULT_PROVIDER).strip(),
        "model": (os.getenv(ENV_MODEL) or "").strip(),
        "policy": (os.getenv(ENV_POLICY) or DEFAULT_POLICY).strip().lower(),
    }


def classify_independence(
    *,
    interpreter_provider: str | None,
    interpreter_model: str | None,
    judge_provider: str | None,
    judge_model: str | None,
    judge_error: str | None = None,
    expected_model: str | None = None,
) -> dict:
    """Classify the judge's independence from the interpreter, honestly.

    Returns a dict with the fine-grained ``independence`` value, the coarse
    ``independence_class`` (different / reduced_same / unavailable), and the
    ``self_review`` / ``identity_verified`` / ``gold_blocked`` gates + reasons.
    """
    reasons: list[str] = []

    if judge_error:
        indep = UNAVAILABLE
        reasons.append(f"judge unavailable: {judge_error}")
        return _result(indep, self_review=False, identity_verified=False, reasons=reasons)

    identity_verified = bool(judge_provider) and bool(judge_model)
    if not identity_verified:
        reasons.append("judge identity incomplete (provider and/or model not recorded)")
        return _result(
            UNKNOWN_IDENTITY, self_review=False, identity_verified=False, reasons=reasons
        )

    # Identity is known — check the configured expectation (identity match).
    if expected_model and judge_model != expected_model:
        reasons.append(
            f"judge model {judge_model!r} != configured POTD_JUDGE_MODEL {expected_model!r}"
        )
        # A mismatch against the pinned model is an identity failure, not a
        # silent acceptance: treat as unknown identity (gold-blocking).
        return _result(
            UNKNOWN_IDENTITY, self_review=False, identity_verified=False, reasons=reasons
        )

    self_review = bool(interpreter_model) and judge_model == interpreter_model
    if self_review:
        reasons.append(
            f"self-review: judge model {judge_model!r} is the interpreter model — not independent"
        )
        return _result(SELF_REVIEW, self_review=True, identity_verified=True, reasons=reasons)

    if judge_provider != interpreter_provider:
        reasons.append(
            f"different provider ({judge_provider!r} vs interpreter {interpreter_provider!r}) and model"
        )
        return _result(DIFFERENT, self_review=False, identity_verified=True, reasons=reasons)

    reasons.append(
        f"same provider ({judge_provider!r}), different model "
        f"({judge_model!r} vs interpreter {interpreter_model!r}) — reduced independence"
    )
    return _result(REDUCED_SAME, self_review=False, identity_verified=True, reasons=reasons)


def _result(
    independence: str, *, self_review: bool, identity_verified: bool, reasons: list[str]
) -> dict:
    gold_blocked = independence in _GOLD_BLOCKING
    return {
        "independence": independence,
        "independence_class": _CLASS_OF[independence],
        "self_review": self_review,
        "identity_verified": identity_verified,
        "gold_blocked": gold_blocked,
        "reasons": reasons,
    }
