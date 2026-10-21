"""Executable form of the proposed citation gate A1 (docs/evals/retrieval-eval/release-gates.md).

Calibrated on the observed noise floor: two full Stranger Walk repeats on one
unchanged staging build flipped 3 and 1 of 50 CORRECT rows (#4460). A rule a
no-op change can fail is not a gate, so the null cases are tests
(``tests/retrieval_eval/test_gates.py``), and so are the regressions it must catch.
"""

from __future__ import annotations

from retrieval_eval import stats

# The worst same-build repeat lost 3 rows with nothing gained.
NOISE_FLOOR_NET_LOSS = 3


def a1_citation(lost: int, gained: int) -> tuple[bool, str]:
    """Pass unless the change's net loss exceeds the noise floor.

    A significant McNemar loss needs at least 6 net losses, so it is always caught here too.
    At n = 50 this rule can only catch a net loss of 4 or more rows, about 8 points; a finer
    margin needs more questions, not a tighter threshold.
    """
    net = lost - gained
    p = stats.mcnemar_exact(lost, gained)
    if net > NOISE_FLOOR_NET_LOSS:
        return False, f"net loss {net} exceeds the same-build noise floor of {NOISE_FLOOR_NET_LOSS}"
    return True, f"-{lost}/+{gained} (net {-net:+d}), McNemar p={p:.3f}"
