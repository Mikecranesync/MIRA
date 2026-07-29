"""Single-shot ask — one question → one answer → one trace (Definition of Done #1).

This is the headline DoD: *ask MIRA a question and inspect the trace*. It runs a
single question through the same harness the eval runner uses, writes the trace
as JSONL, and renders it with the viewer.

Default is ``--live`` is OFF (mock) so the command runs anywhere; pass ``--live``
to drive the real engine (needs the bot deps + KB env). For a meaningful mock
answer, pass ``--answer`` (otherwise a placeholder is recorded and the governance
checks will, correctly, flag a missing citation).

Usage::

    python -m simlab.observe.ask "Why did the conveyor stop?" --live \\
        --asset enterprise.plant1.packaging.line2.conv_belt_01 \\
        --simlab conveyor_jam_01

    python -m simlab.observe.ask "Is the VFD running?" \\
        --asset …conv_belt_01 --answer "VFD output is 0 Hz [Source: troubleshooting.md]"
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from shared.observe.approval_registry import ApprovalRegistry

from simlab.observe.harness import AskContext, LiveAnswerer, MockAnswerer, trace_answer
from simlab.observe.viewer import render

_TRACES_DIR = Path(__file__).parent / "traces"
_DEFAULT_APPROVALS = Path(__file__).parent / "evalpacks" / "approvals.example.json"

_MOCK_PLACEHOLDER = "[mock answer — pass --answer to supply text, or --live to run the real engine]"


def _simlab_preseed(scenario_id: Optional[str]) -> tuple[dict, Optional[str]]:
    if not scenario_id:
        return {}, None
    try:
        from tests.simlab.schema import load_scenario  # type: ignore

        scen_dir = Path(__file__).resolve().parents[2] / "tests" / "simlab" / "scenarios"
        path = scen_dir / f"{scenario_id}.yaml"
        if path.exists():
            scen = load_scenario(path)
            return dict(scen.machine_context.tag_state), scen.machine_type
    except Exception:  # noqa: BLE001
        pass
    return {}, None


def ask(
    question: str,
    *,
    asset: Optional[str] = None,
    mode: str = "mock",
    mock_answer: Optional[str] = None,
    simlab_scenario_id: Optional[str] = None,
    approvals_path: Optional[Path] = None,
) -> Path:
    """Answer one question, write the trace JSONL, return its path."""
    registry = ApprovalRegistry.load(approvals_path or _DEFAULT_APPROVALS)
    tag_state, machine_type = _simlab_preseed(simlab_scenario_id)

    ctx = AskContext(
        asset=(asset.split(".")[-1] if asset else None),
        asset_uns_path=asset,
        tag_state=tag_state,
        machine_type=machine_type,
        expected_asset=asset,
    )

    if mode == "live":
        answerer = LiveAnswerer.build()
    else:
        answerer = MockAnswerer(mock_answer or _MOCK_PLACEHOLDER)

    trace = trace_answer(question, ctx, answerer, registry, mode=mode)

    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H%M%S")
    path = _TRACES_DIR / f"ask-{mode}-{ts}.jsonl"
    trace.write_jsonl(path)

    print(render(trace.to_dict()))
    print(f"\nTrace written: {path}")
    return path


def main() -> None:
    try:
        import sys

        sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    except Exception:  # noqa: BLE001
        pass
    p = argparse.ArgumentParser(description="Ask MIRA one question and inspect the trace.")
    p.add_argument("question", help="The question to ask")
    p.add_argument("--asset", help="Asset UNS path (direct-connection certified)")
    p.add_argument("--live", action="store_true", help="Use the real engine")
    p.add_argument("--answer", dest="mock_answer", help="Mock answer text (mock mode only)")
    p.add_argument("--simlab", dest="simlab", help="SimLab scenario id for live preseed")
    p.add_argument("--approvals", type=Path, help="Path to approvals JSON")
    args = p.parse_args()
    ask(
        args.question,
        asset=args.asset,
        mode="live" if args.live else "mock",
        mock_answer=args.mock_answer,
        simlab_scenario_id=args.simlab,
        approvals_path=args.approvals,
    )


if __name__ == "__main__":
    main()
