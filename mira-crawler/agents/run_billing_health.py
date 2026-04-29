"""
Marcus (Billing) — 14:00 ET daily.
Checks Stripe for MRR, failed payments, expiring cards.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

_HERE = Path(__file__).parent.resolve()
_CRAWLER_ROOT = _HERE.parent
_REPO = _CRAWLER_ROOT.parent
sys.path.insert(0, str(_CRAWLER_ROOT))

from agents.orchestrator import run_agent  # noqa: E402


def _run() -> dict:
    stripe_key = os.environ.get("STRIPE_SECRET_KEY", "")
    if not stripe_key:
        return {"mrr": 0, "issues": 0, "note": "STRIPE_SECRET_KEY not set"}

    try:
        import stripe  # type: ignore[import]
        stripe.api_key = stripe_key

        # Active subscriptions → MRR
        subs = stripe.Subscription.list(status="active", limit=100)
        mrr = sum(
            sub["items"]["data"][0]["price"]["unit_amount"] / 100
            for sub in subs.auto_paging_iter()
        )

        # Past-due subscriptions
        past_due = stripe.Subscription.list(status="past_due", limit=10)
        issues = len(past_due.data)

        return {"mrr": round(mrr, 2), "issues": issues, "active_subs": len(subs.data)}
    except ImportError:
        return {"mrr": 0, "issues": 0, "note": "stripe package not installed"}
    except Exception as exc:
        raise RuntimeError(str(exc)) from exc


def _telegram(result: dict) -> str:
    if result.get("note"):
        return f"_{result['note']}_"
    issues_line = (
        f" · ⚠️ {result['issues']} past-due" if result["issues"] else " · No issues"
    )
    return (
        f"MRR: *${result['mrr']}*"
        f" ({result.get('active_subs', 0)} active subscriptions)"
        f"{issues_line}\nStripe mode: {'test' if 'test' in os.environ.get('STRIPE_SECRET_KEY', '') else 'live'}"
    )


if __name__ == "__main__":
    run_agent("billing_health", _run, name="Marcus (Billing)", emoji="💰",
              telegram_template=_telegram)
