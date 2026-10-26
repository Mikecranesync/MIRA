"""The SimLab budget meter must price every call and fail closed on one it cannot price.

uv run --no-project --python 3.12 --with pytest python -m pytest -q v02/test_simlab_meter.py
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import simlab_run as S  # noqa: E402


def ledger():
    return {"usd": 0.0, "calls": 0, "prompt_tokens": 0, "completion_tokens": 0}


def test_router_usage_shape_is_priced():
    lg = ledger()
    S.charge(lg, {"input_tokens": 1_000_000, "output_tokens": 0})
    assert lg["usd"] == pytest.approx(0.75) and lg["calls"] == 1


def test_openai_usage_shape_is_priced_too():
    lg = ledger()
    S.charge(lg, {"prompt_tokens": 0, "completion_tokens": 1_000_000})
    assert lg["usd"] == pytest.approx(4.5)


def test_a_call_without_token_counts_stops_the_run():
    with pytest.raises(S.BudgetExceeded, match="unmetered"):
        S.charge(ledger(), {"model": "x"})
    with pytest.raises(S.BudgetExceeded):
        S.charge(ledger(), None)
